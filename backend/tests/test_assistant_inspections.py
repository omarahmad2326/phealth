"""Phia reads and changes the inspection-led product the way its screens do.

Reads come from the same classification as the cards, so a number Phia gives
is the number on screen. Every change is prepared first, runs only on Confirm,
and names things the way people say them - "Radiology", "Ali", "Generator 1" -
rather than by the database's own ids.

    DATABASE_URL=sqlite:// python tests/test_assistant_inspections.py
"""
from __future__ import annotations

import os
import pathlib
import re
import sys
from datetime import timedelta

os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import test_inspection_programme as base  # noqa: E402  (the same hospital, departments and forms)
from sqlalchemy import event  # noqa: E402
from app.assistant import actions  # noqa: E402
from app.assistant.tools import registry  # noqa: E402
from app.assistant.tools.base import ToolContext  # noqa: E402
from app.models.department import Department  # noqa: E402
from app.models.equipment import Equipment  # noqa: E402
from app.models.facility import Facility  # noqa: E402
from app.models.inspection import InspectionBatch  # noqa: E402
from app.models.red_tag import RedTag  # noqa: E402
from app.models.vehicle import Vehicle  # noqa: E402
from app.schemas.inspection_programme import RecordItemIn, VisitIn  # noqa: E402
from app.services import inspection_programme as programme  # noqa: E402

TODAY, refused, api = base.TODAY, base.refused, base.api


# Registering a site tidies its name with Postgres's regexp_replace; SQLite
# has none, so the test database is given one that behaves the same.
@event.listens_for(base.engine, "connect")
def _regexp_replace(connection, _record):
    connection.create_function("regexp_replace", 4, lambda text, pattern, repl, flags: re.sub(
        pattern, repl, text or "", count=0 if "g" in (flags or "") else 1))
    connection.create_function("btrim", 1, lambda text: (text or "").strip())


def read(db, user, tool, **arguments):
    return registry.dispatch(tool, ToolContext(db=db, user=user), arguments).to_dict()


def prepare(db, user, action, **arguments):
    return actions.card_of(actions.propose(db, user, action, arguments))


def confirm(db, user, card):
    return actions.card_of(actions.confirm(db, user, card["action_id"]))


def line(card, label):
    return next((row["value"] for row in card["lines"] if row["label"] == label), None)


def red_tag(db, site, people, departments, name, note):
    visit = api.create_visit(VisitIn(facility_id=site.id, scope="department", department_id=departments["radiology"].id,
                                     scheduled_on=TODAY + timedelta(days=7)), db=db, current_user=people["boss"])
    row = next(item for item in visit["item_list"] if item["name"] == name)
    api.record_item(visit["id"], row["id"], RecordItemIn(result="red_tag", note=note), db=db, current_user=people["boss"])


def test_the_status_phia_reads_is_the_status_on_the_cards():
    db, site, other, people, departments, equipment, _ = base.build()
    red_tag(db, site, people, departments, "X-ray XR-02", "Shutter jammed open")
    boss = people["boss"]

    overview = read(db, boss, "inspection_status")
    board = programme.dashboard(db, [site, other])
    assert overview["aggregates"]["sites_by_status"]["failed"] == board["site_totals"]["failed"] == 1
    texas = next(item for item in overview["items"] if item["site"] == "Texas Pain Facility")
    assert texas["status"] == "Failed" and texas["red_tagged"] == 1
    assert {part["name"] for part in texas["departments"]} >= {"Radiology", "Pharmacy"}

    tagged = read(db, boss, "inspection_status", facility_id=site.id, state="red_tagged")
    assert tagged["total_count"] == 1
    assert (tagged["items"][0]["name"], tagged["items"][0]["red_tag_reason"]) == ("X-ray XR-02", "Shutter jammed open")
    assert tagged["items"][0]["department"] == "Radiology"
    overdue = read(db, boss, "inspection_status", facility_id=site.id, state="overdue")
    assert overdue["total_count"] == board["sites"][0]["overdue"] if board["sites"][0]["name"] == site.name \
        else overdue["total_count"] >= 0

    # A department by the name people use, whatever the case.
    radiology = read(db, boss, "inspection_status", department="radiology")
    assert radiology["items"][0]["department"] == "Radiology" and radiology["items"][0]["red_tagged"] == 1
    detail = refused(lambda: read(db, boss, "inspection_status", department="Cardiology"), 422)
    assert "Radiology" in detail and "Pharmacy" in detail, "it says which departments there are"

    # Nothing in any answer is a database id.
    for result in (overview, tagged, radiology):
        for item in result["items"]:
            assert "id" not in item and not any(key.endswith("_id") for key in item), item
    db.close()
    print("ok  inspection status reads the same numbers as the cards, by site, department and state")


def test_scheduling_a_visit_is_prepared_by_name_and_runs_once():
    db, site, _, people, departments, _, _ = base.build()
    boss = people["boss"]
    card = prepare(db, boss, "prepare_inspection_visit", facility_id=site.id, department="Radiology",
                   on=(TODAY + timedelta(days=7)).isoformat(), inspector="ali")
    assert card["title"] == "Schedule an inspection · Radiology"
    assert "CT scanner GE-01" in line(card, "Items due by then") and "X-ray XR-02" in line(card, "Items due by then")
    assert line(card, "Inspector") == "Ali"
    assert db.query(InspectionBatch).count() == 0, "nothing is scheduled until confirmed"

    done = confirm(db, boss, card)
    assert done["status"] == "executed", done
    assert done["result"]["route"].startswith("/inspection-visits/")
    assert db.query(InspectionBatch).count() == 1

    visits = read(db, boss, "inspection_visits", facility_id=site.id, status="open")
    assert visits["total_count"] == 1 and visits["items"][0]["covers"] == "Radiology"
    assert visits["items"][0]["inspector"] == "Ali"

    # What cannot be scheduled says why, in the screen's words.
    cardiology = Department(name="Cardiology", facility_id=site.id)
    db.add(cardiology)
    db.commit()
    assert "no inspection form" in refused(lambda: prepare(
        db, boss, "prepare_inspection_visit", facility_id=site.id, department="Cardiology",
        on=(TODAY + timedelta(days=7)).isoformat()), 422)
    assert "today or a later day" in refused(lambda: prepare(
        db, boss, "prepare_inspection_visit", facility_id=site.id, department="Radiology",
        on=(TODAY - timedelta(days=1)).isoformat()), 422)
    assert "Nobody called 'Zed'" in refused(lambda: prepare(
        db, boss, "prepare_inspection_visit", facility_id=site.id, department="Radiology",
        on=(TODAY + timedelta(days=7)).isoformat(), inspector="Zed"), 422)
    db.close()
    print("ok  a visit is scheduled by department, date and inspector name, and only on Confirm")


def test_one_item_is_inspected_now_by_its_name_or_tag():
    db, site, _, people, _, equipment, _ = base.build()
    boss = people["boss"]
    # Generator 1 is in no department: it has no form of its own, so Phia asks which.
    detail = refused(lambda: prepare(db, boss, "prepare_inspect_now", facility_id=site.id, equipment="Generator 1"), 422)
    assert "not in a department" in detail and "Equipment readiness" in detail
    card = prepare(db, boss, "prepare_inspect_now", facility_id=site.id, equipment="generator 1",
                   form="equipment readiness")
    assert card["title"] == "Inspect Generator 1 now" and line(card, "Inspected on") == "Equipment readiness"
    done = confirm(db, boss, card)
    assert done["status"] == "executed" and done["result"]["route"].startswith("/inspection-visits/")

    # By its asset tag, in a department: its department's form, and the open one is mentioned.
    tag = db.get(Equipment, equipment["ct"]["id"]).asset_tag
    first = confirm(db, boss, prepare(db, boss, "prepare_inspect_now", facility_id=site.id, equipment=tag))
    assert first["status"] == "executed"
    again = prepare(db, boss, "prepare_inspect_now", facility_id=site.id, equipment="CT scanner GE-01")
    assert any("already has an open inspection" in warning for warning in again["warnings"])
    assert "Nothing called 'Kettle'" in refused(lambda: prepare(
        db, boss, "prepare_inspect_now", facility_id=site.id, equipment="Kettle"), 422)
    db.close()
    print("ok  one item is inspected now by name or tag, asking for a form only when it has none")


def test_a_red_tag_is_cleared_with_a_note():
    db, site, _, people, departments, _, _ = base.build()
    boss = people["boss"]
    assert "no red tag" in refused(lambda: prepare(
        db, boss, "prepare_clear_red_tag", facility_id=site.id, equipment="X-ray XR-02", note="Fixed it"), 422)
    red_tag(db, site, people, departments, "X-ray XR-02", "Shutter jammed open")
    assert "what was done" in refused(lambda: prepare(
        db, boss, "prepare_clear_red_tag", facility_id=site.id, equipment="X-ray XR-02", note="ok"), 422)
    card = prepare(db, boss, "prepare_clear_red_tag", facility_id=site.id, equipment="x-ray xr-02",
                   note="Shutter replaced and tested")
    assert line(card, "Reason") == "Shutter jammed open" and line(card, "What was done") == "Shutter replaced and tested"
    assert db.query(RedTag).filter(RedTag.cleared_at.is_(None)).count() == 1, "still tagged until confirmed"
    assert confirm(db, boss, card)["status"] == "executed"
    tag = db.query(RedTag).one()
    assert tag.cleared_at is not None and tag.clear_note == "Shutter replaced and tested"
    db.close()
    print("ok  a red tag is cleared by the item's name with a note, and only on Confirm")


def test_departments_vehicles_and_sites_are_added():
    db, site, _, people, _, _, _ = base.build()
    boss = people["boss"]

    card = prepare(db, boss, "prepare_add_department", facility_id=site.id, name="  Cardiology ")
    assert line(card, "Department") == "Cardiology"
    assert confirm(db, boss, card)["status"] == "executed"
    assert db.query(Department).filter(Department.name == "Cardiology").count() == 1
    assert "already has a department" in refused(lambda: prepare(
        db, boss, "prepare_add_department", facility_id=site.id, name="cardiology"), 422)
    # A facility manager cannot change sites at all, so it is refused before any question of role.
    refused(lambda: prepare(db, people["manager"], "prepare_add_department", facility_id=site.id, name="Oncology"), 403)

    van = prepare(db, boss, "prepare_add_vehicle", facility_id=site.id, name="Ambulance 2", registration="tx-4410",
                  vehicle_type="Ambulance", frequency="monthly")
    assert (line(van, "Registration"), line(van, "Inspected")) == ("TX-4410", "Monthly")
    assert confirm(db, boss, van)["status"] == "executed"
    added = db.query(Vehicle).filter(Vehicle.registration == "TX-4410").one()
    assert added.pm_scheduling == "monthly" and added.next_generated_pm_date is not None
    assert "already has a vehicle registered" in refused(lambda: prepare(
        db, boss, "prepare_add_vehicle", facility_id=site.id, name="Van", registration="TX-4410"), 422)

    detail = refused(lambda: prepare(db, boss, "prepare_register_site", name="Lahore General"), 422)
    assert "street address" in detail and "ZIP code" in detail and "zip_code" not in detail
    assert "email address" in refused(lambda: prepare(
        db, boss, "prepare_register_site", name="Lahore General", address="1 Mall Rd", city="Lahore",
        state="Punjab", zip_code="54000", country="Pakistan", phone="0421234567", email="not-an-email"), 422)
    card = prepare(db, boss, "prepare_register_site", name="Lahore General", address="1 Mall Rd", city="Lahore",
                   state="Punjab", zip_code="54000", country="Pakistan", phone="0421234567",
                   email="lahore@example.com", beds=80, size="medium")
    assert line(card, "Address") == "1 Mall Rd, Lahore, Punjab 54000, Pakistan"
    assert db.query(Facility).filter(Facility.name == "Lahore General").count() == 0
    done = confirm(db, boss, card)
    assert done["status"] == "executed", done
    made = db.query(Facility).filter(Facility.name == "Lahore General").one()
    assert done["result"]["route"] == "/sites/{}".format(made.id) and made.beds == 80
    assert "already exists" in refused(lambda: prepare(
        db, boss, "prepare_register_site", name="lahore general", address="x", city="x", state="x", zip_code="1",
        country="x", phone="1", email="a@b.co"), 422)
    db.close()
    print("ok  a department, a vehicle and a site are added from a few words, asking plainly for what is missing")


def test_equipment_moves_department_and_inspections_are_not_jobs():
    db, site, _, people, departments, equipment, _ = base.build()
    boss = people["boss"]
    card = prepare(db, boss, "prepare_equipment_update", asset_id=equipment["generator"]["id"], department="pharmacy")
    assert line(card, "Department") == "Not in a department → Pharmacy"
    assert confirm(db, boss, card)["status"] == "executed"
    assert db.get(Equipment, equipment["generator"]["id"]).department_id == departments["pharmacy"].id
    out = prepare(db, boss, "prepare_equipment_update", asset_id=equipment["generator"]["id"], department="none")
    assert line(out, "Department") == "Pharmacy → Not in a department"

    listed = read(db, boss, "category_equipment", facility_id=site.id, department="Radiology")
    assert {item["name"] for item in listed["items"]} == {"CT scanner GE-01", "X-ray XR-02", "Ultrasound US-03"}
    assert all(item["department"] == "Radiology" for item in listed["items"])

    detail = refused(lambda: prepare(db, boss, "prepare_equipment_job", asset_id=equipment["ct"]["id"],
                                     kind="inspection", what_needs_doing="Quarterly check"), 422)
    assert "prepare_inspect_now" in detail, "an inspection goes to the inspection programme, not a job"
    service = prepare(db, boss, "prepare_equipment_job", asset_id=equipment["ct"]["id"],
                      what_needs_doing="Replace the cooling fan")
    assert service["title"] == "Raise a service on CT scanner GE-01"
    assert confirm(db, boss, service)["result"]["route"] == "/service"
    db.close()
    print("ok  equipment moves between departments, and an inspection is never raised as a job")


def test_a_failed_change_is_told_plainly():
    assert actions.plain_error("No department with that id at this site.") == "No department at this site."
    for raw in ("Name either equipment_id or vehicle_id.", "Traceback (most recent call last): ...",
                "{'loc': ['body', 'facility_id']}", None, ""):
        assert actions.plain_error(raw).startswith("It could not be completed and nothing was changed")
    assert actions.plain_error("That red tag was already cleared.") == "That red tag was already cleared."
    print("ok  a change that fails says so in plain words, never field names, ids or a trace")


if __name__ == "__main__":
    tests = [value for key, value in list(globals().items()) if key.startswith("test_")]
    for test in tests:
        test()
    print(f"\n{len(tests)} checks passed")
