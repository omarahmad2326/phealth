"""Prove Phia can make the everyday changes on Facility and Equipment Maintenance.

Each change is prepared as a card that writes nothing, shows what changes from
what to what, and is made on Confirm through the screen's own endpoint.
Arguments are given the way open models send them - ids as strings, labels for
codes, "$45,000" for an amount - because that is what reaches the backend.

    DATABASE_URL=sqlite:// python backend/tests/test_assistant_writes.py
"""
from __future__ import annotations

import os
import pathlib
import sys
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_assistant_categories import build, refused  # noqa: E402

from app.assistant import actions  # noqa: E402
from app.models.equipment import Equipment  # noqa: E402
from app.models.service_request import ServiceRequest  # noqa: E402
from app.services import equipment_jobs  # noqa: E402


def lines_of(action):
    return {line["label"]: line["value"] for line in actions.card_of(action)["lines"]}


def test_equipment_is_added_only_when_confirmed():
    db, site, _, people, _ = build()
    before = db.query(Equipment).count()
    action = actions.propose(db, people["boss"], "prepare_add_equipment", {
        "facility_id": str(site.id), "category": "HVAC", "name": "Chiller 2", "type": "Chiller",
        "building": "main block", "floor": "roof", "quantity": "2", "unit_cost": "$45,000",
        "in_service_on": "2024-01-15", "status": "Working", "make": None, "notes": "",
    })
    card = actions.card_of(action)
    lines = lines_of(action)
    assert card["title"] == "Add Chiller 2 to HVAC" and card["facility_id"] == site.id, card
    assert lines["Where"] == "Main block · Roof", "the site's own spelling of the place is used"
    assert lines["Purchase cost"] == "$45,000 each, $90,000 in all", lines["Purchase cost"]
    assert lines["Useful life"] == "15 years (HVAC default)" and lines["Status"] == "Working", lines
    assert card["warnings"] == [], card["warnings"]
    assert db.query(Equipment).count() == before, "nothing is added until confirmed"

    done = actions.confirm(db, people["boss"], action.id)
    assert done.status == "executed", (done.status, done.error)
    added = db.get(Equipment, done.result["equipment_id"])
    assert (added.name, added.building, added.floor, added.quantity) == ("Chiller 2", "Main block", "Roof", 2)
    assert Decimal(str(added.cost)) == Decimal("90000.00") and added.installation_date.isoformat() == "2024-01-15"
    assert added.asset_tag and done.result["route"] == "/categories/hvac" and done.result["facility_id"] == site.id
    assert done.result["message"] == "Chiller 2 added to HVAC as {}.".format(added.asset_tag), done.result

    # Equipment is placed by its department now: a building is never required.
    placed = lines_of(actions.propose(db, people["boss"], "prepare_add_equipment", {
        "facility_id": site.id, "category": "electrical", "name": "Generator 2", "type": "Generator"}))
    assert placed["Department"] == "Not in a department" and "Where" not in placed, placed
    twin = actions.propose(db, people["boss"], "prepare_add_equipment", {
        "facility_id": site.id, "category": "electrical", "name": "generator 1", "type": "Generator",
        "building": "Annex", "unit_cost": 1000})
    assert any("already has a Generator 1" in w for w in actions.card_of(twin)["warnings"]), actions.card_of(twin)
    refused(lambda: actions.propose(db, people["boss"], "prepare_add_equipment", {
        "category": "hvac", "name": "Chiller 3", "type": "Chiller", "building": "Main block"}), 422)
    db.close()
    print("ok  new equipment is prepared with its department, place if given, and cost, and added once on Confirm")


def test_equipment_changes_show_what_changes_and_are_made_on_confirm():
    db, site, _, people, equipment = build()
    generator = equipment["generator"]
    action = actions.propose(db, people["boss"], "prepare_equipment_update", {
        "asset_id": str(generator["id"]), "status": "out of service", "unit_cost": 30000,
        "in_service_on": "2023-06-01", "floor": "Basement",
    })
    lines = lines_of(action)
    card = actions.card_of(action)
    assert card["title"] == "Change Generator 1"
    assert lines["Status"] == "Working → Out of service", lines
    assert lines["Cost of one item"] == "Not recorded → $30,000", lines
    assert "Floor" not in lines, "what already matches is not shown as a change"
    assert "It has 1 open job." in card["warnings"], card["warnings"]
    assert db.get(Equipment, generator["id"]).condition == "working", "nothing changes until confirmed"

    done = actions.confirm(db, people["boss"], action.id)
    assert done.status == "executed", done.error
    changed = db.get(Equipment, generator["id"])
    db.refresh(changed)
    assert changed.condition == "out_of_service" and Decimal(str(changed.cost)) == Decimal("30000.00")
    assert changed.installation_date.isoformat() == "2023-06-01"
    assert done.result["route"] == "/categories/electrical", done.result

    detail = refused(lambda: actions.propose(db, people["boss"], "prepare_equipment_update", {
        "asset_id": generator["id"], "status": "out_of_service"}), 422)
    assert "Nothing to change" in detail, detail
    old = Equipment(facility_id=site.id, asset_tag="OLD-7", make="", model="", serial_number="")
    db.add(old)
    db.commit()
    detail = refused(lambda: actions.propose(db, people["boss"], "prepare_equipment_update", {
        "asset_id": old.id, "status": "working"}), 422)
    assert "Add to a category" in detail, detail
    db.close()
    print("ok  a change to equipment shows before and after, and is made through the screen's endpoint")


def test_a_service_is_closed_with_its_costs():
    db, site, _, people, _ = build()
    job = db.query(ServiceRequest).filter(ServiceRequest.problem_description == "Load test").one()
    action = actions.propose(db, people["boss"], "prepare_equipment_job_update", {
        "job_id": str(job.id), "status": "Done", "labour_cost": "1200", "parts_cost": 300.5,
        "assigned_to_id": str(people["sam"].id), "notes": "Ran at full load for two hours",
    })
    lines = lines_of(action)
    assert (lines["Status"], lines["Labour"], lines["Parts"], lines["Job cost"], lines["Assigned to"]) == \
        ("Open → Done", "Not recorded → $1,200", "Not recorded → $300.50", "$1,500.50", "Nobody → Sam"), lines
    assert equipment_jobs.simple_status(db.get(ServiceRequest, job.id).status) == "open", "not until confirmed"

    done = actions.confirm(db, people["boss"], action.id)
    assert done.status == "executed", done.error
    closed = db.get(ServiceRequest, job.id)
    db.refresh(closed)
    assert equipment_jobs.simple_status(closed.status) == "done" and closed.assigned_technician_id == people["sam"].id
    assert Decimal(str(closed.labour_cost)) == Decimal("1200.00") and Decimal(str(closed.total_cost)) == Decimal("1500.50")
    assert closed.notes == "Ran at full load for two hours"
    assert done.result["route"] == "/service" and done.result["facility_id"] == site.id

    detail = refused(lambda: actions.propose(db, people["boss"], "prepare_equipment_job_update", {
        "job_id": job.id, "inspection_result": "pass"}), 422)
    assert "Only an inspection" in detail, detail
    detail = refused(lambda: actions.propose(db, people["boss"], "prepare_work_order_update", {
        "work_order_id": job.id, "status": "completed"}), 422)
    assert "prepare_equipment_job_update" in detail, detail
    db.close()
    print("ok  a service is marked done with labour and parts, and the general work order path points to it")


def test_an_inspection_result_is_recorded():
    """Inspections are no longer raised as jobs, but one raised before still closes with its result."""
    from app.api.v1.endpoints import equipment_maintenance as jobs_api
    from app.schemas.site_categories import EquipmentJobCreate

    db, site, _, people, equipment = build()
    detail = refused(lambda: actions.propose(db, people["boss"], "prepare_equipment_job", {
        "asset_id": equipment["ahu"]["id"], "kind": "inspection", "what_needs_doing": "Quarterly inspection"}), 422)
    assert "prepare_inspect_now" in detail
    old_job = jobs_api.create_job(EquipmentJobCreate(
        facility_id=site.id, kind="inspection", equipment_id=equipment["ahu"]["id"],
        title="Quarterly inspection", assigned_to_id=people["sam"].id), db=db, current_user=people["boss"])
    action = actions.propose(db, people["boss"], "prepare_equipment_job_update", {
        "job_id": old_job["id"], "status": "done", "inspection_result": "Fail",
        "findings": "Belt worn through"})
    assert lines_of(action)["Result"] == "Not recorded → Fail"
    done = actions.confirm(db, people["boss"], action.id)
    assert done.status == "executed", done.error
    job = db.get(ServiceRequest, old_job["id"])
    db.refresh(job)
    assert (job.inspection_result, job.findings) == ("fail", "Belt worn through")
    db.close()
    print("ok  an old inspection job closes with its result and findings; a new one is sent to inspect-now")


def test_the_new_changes_are_offered_to_the_agent():
    db, _, _, people, _ = build()
    from app.api.v1.endpoints.assistant_internal import list_tools

    offered = {tool["name"] for tool in list_tools(current_user=people["boss"])["action_tools"]}
    assert {"prepare_add_equipment", "prepare_equipment_update", "prepare_equipment_job_update",
            "prepare_equipment_job"} <= offered, offered
    db.close()
    print("ok  the agent is offered adding and changing equipment and updating its jobs")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)
             and v.__module__ == "__main__"]
    for t in tests:
        t()
    print(f"\n{len(tests)} checks passed")
