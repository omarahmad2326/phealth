"""Prove the categories register and its service and inspection jobs behave as agreed.

A site's equipment sits under Electrical, Plumbing, Mechanical or HVAC with a
name, a type and where exactly it is. The lists start empty: older assets are
not shown. Services and inspections are work orders with three statuses, a due
date and, for inspections, a pass or fail. Technicians update only their own
jobs, and nothing crosses between sites.

    DATABASE_URL=sqlite:// python backend/tests/test_site_categories.py
"""
from __future__ import annotations

import ast
import os
import pathlib
import sys
from datetime import date, datetime, timedelta

os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.models  # noqa: E402,F401
from app.api.v1.endpoints import equipment_maintenance as jobs_api  # noqa: E402
from app.api.v1.endpoints import site_categories as api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.models.discipline import Discipline  # noqa: E402
from app.models.equipment import Equipment  # noqa: E402
from app.models.facility import Facility  # noqa: E402
from app.models.notification import Notification  # noqa: E402
from app.models.service_request import (  # noqa: E402
    NON_BILLABLE_TYPES, ServiceRequest, ServiceRequestStatus, WorkOrderType,
)
from app.models.user import User, UserRole, UserType  # noqa: E402
from app.models.user_facility import UserFacility  # noqa: E402
from app.schemas.site_categories import (  # noqa: E402
    CategoryEquipmentCreate, CategoryEquipmentUpdate, EquipmentJobCreate, EquipmentJobUpdate,
)
from app.services import sla  # noqa: E402

engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
Session = sessionmaker(bind=engine)
TODAY = datetime.utcnow().date()  # the server's day: every "today" in the app is UTC


def build():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = Session()

    def site(name):
        f = Facility(name=name, phone="1", email=f"{name[:3]}@x.c", address="1",
                     city="X", state="GA", zip_code="1", country="USA")
        db.add(f)
        db.flush()
        return f

    lahore, karachi = site("Lahore Office"), site("Karachi Hospital")

    def person(username, role, facility=None):
        u = User(username=username, email=f"{username}@x.c", full_name=username.title(),
                 hashed_password="x", user_type=UserType.EMPLOYEE, role=role, is_active=True,
                 facility_id=facility.id if facility else None)
        db.add(u)
        db.flush()
        if facility:
            db.add(UserFacility(user_id=u.id, facility_id=facility.id))
        return u

    people = {
        "admin": person("boss", UserRole.SUPERADMIN),
        "manager": person("fm", UserRole.FACILITY_MANAGER, lahore),
        "tech": person("sam", UserRole.TECHNICIAN, lahore),
        "other_tech": person("ali", UserRole.TECHNICIAN, lahore),
        "far_tech": person("zed", UserRole.TECHNICIAN, karachi),
        "far_manager": person("kfm", UserRole.FACILITY_MANAGER, karachi),
    }
    db.commit()
    return db, lahore, karachi, people


def refused(call, status):
    try:
        call()
    except HTTPException as exc:
        assert exc.status_code == status, f"expected {status}, got {exc.status_code}: {exc.detail}"
        return exc.detail
    raise AssertionError(f"expected a {status} refusal")


# Endpoint functions called directly: every Query() parameter is passed, or its
# default would be the Query object itself.
def overview(db, user, site):
    return api.overview(facility_id=site.id, db=db, current_user=user)


def listing(db, user, site, code, search=None, building=None, floor=None, condition=None, department=None):
    return api.list_category_equipment(code, facility_id=site.id, search=search, building=building,
                                       floor=floor, department=department, condition=condition,
                                       db=db, current_user=user)


def add(db, user, site, code, **fields):
    fields.setdefault("name", "Generator 1")
    fields.setdefault("type", "Generator")
    fields.setdefault("building", "Main block")
    return api.add_category_equipment(code, CategoryEquipmentCreate(facility_id=site.id, **fields),
                                      db=db, current_user=user)


def jobs(db, user, site, kind, status=None, category=None, search=None, equipment_id=None):
    return jobs_api.list_jobs(facility_id=site.id, kind=kind, status=status, category=category,
                              search=search, equipment_id=equipment_id, db=db, current_user=user)


def raise_job(db, user, site, kind, equipment_id, **fields):
    fields.setdefault("title", "Quarterly service")
    return jobs_api.create_job(EquipmentJobCreate(facility_id=site.id, kind=kind, equipment_id=equipment_id,
                                                  **fields), db=db, current_user=user)


def change_job(db, user, job_id, **fields):
    return jobs_api.update_job(job_id, EquipmentJobUpdate(**fields), db=db, current_user=user)


def test_the_four_categories_exist_even_on_a_database_without_disciplines():
    db, site, _, people = build()
    assert db.query(Discipline).count() == 0
    result = overview(db, people["manager"], site)
    assert [c["name"] for c in result["categories"]] == ["Electrical", "Plumbing", "Mechanical", "HVAC", "Building", "Landscaping", "Parking"]
    assert all(c["equipment"] == 0 and c["open_jobs"] == 0 for c in result["categories"])
    assert "Generator" in result["categories"][0]["types"] and "Chiller" in result["categories"][3]["types"]
    assert {d.code for d in db.query(Discipline).all()} == {"electrical", "plumbing", "mechanical", "hvac", "building", "landscaping", "parking"}
    overview(db, people["manager"], site)
    assert db.query(Discipline).count() == 7, "asking twice creates nothing twice"
    db.close()
    print("ok  the categories are there on a fresh database, created once")


def test_equipment_is_added_with_a_tag_and_where_exactly_it_is():
    db, site, _, people = build()
    item = add(db, people["manager"], site, "electrical", name="  Generator   1 ", building="Main Block",
               floor="Basement", spot="Plant room 2, north wall", make="Cummins", model="C500", quantity=2)
    assert item["asset_tag"] == "LO-000001"
    assert (item["name"], item["type"], item["quantity"]) == ("Generator 1", "Generator", 2)
    assert item["location_label"] == "Main Block · Basement · Plant room 2, north wall"
    assert (item["condition"], item["condition_label"]) == ("working", "Working")

    # The site's spelling of a place is reused, whatever the case typed.
    second = add(db, people["manager"], site, "electrical", name="DB-2", type="Distribution board",
                 building="main block", floor="BASEMENT")
    assert (second["building"], second["floor"]) == ("Main Block", "Basement")
    assert api.suggestions(facility_id=site.id, db=db, current_user=people["tech"]) == {
        "buildings": ["Main Block"], "floors": ["Basement"], "spots": ["Plant room 2, north wall"]}

    refused(lambda: add(db, people["manager"], site, "electrical", name="   "), 422)
    refused(lambda: add(db, people["manager"], site, "lifts"), 404)
    db.close()
    print("ok  equipment gets a tag, a tidy name and one spelling per building and floor")


def test_equipment_is_placed_by_its_department_not_where_it_is():
    """The form asks which department, not which building: a name and a type
    are all that is required, and the list is filtered by department."""
    from app.models.department import Department
    from app.models.equipment import Equipment
    from app.schemas.site_categories import CategoryAdopt

    db, site, far, people = build()
    radiology = Department(name="Radiology", facility_id=site.id)
    elsewhere = Department(name="Wards", facility_id=far.id)
    db.add_all([radiology, elsewhere])
    db.commit()

    xray = add(db, people["manager"], site, "electrical", name="X-ray 1", type="X-ray", building=None,
               department_id=radiology.id)
    assert (xray["department_id"], xray["department"]) == (radiology.id, "Radiology")
    assert xray["building"] is None and xray["location_label"] in (None, ""), "no building asked, none invented"
    loose = add(db, people["manager"], site, "electrical", name="Generator 1", type="Generator", building=None)
    assert loose["department"] is None

    def names(**filters):
        return [i["name"] for i in listing(db, people["tech"], site, "electrical", **filters)["items"]]

    assert names(department=str(radiology.id)) == ["X-ray 1"]
    assert names(department="none") == ["Generator 1"]
    refused(lambda: names(department="radiology"), 422)
    refused(lambda: add(db, people["manager"], site, "electrical", name="Z", type="Z", building=None,
                        department_id=elsewhere.id), 422)

    # Editing never asks for a building either, and what one had is kept.
    placed = add(db, people["manager"], site, "electrical", name="UPS 1", type="UPS", building="Main block")
    edited = api.update_category_equipment(placed["id"], CategoryEquipmentUpdate(
        department_id=radiology.id), db=db, current_user=people["manager"])
    assert (edited["department"], edited["building"]) == ("Radiology", "Main block")

    # An older asset joins a category by its department.
    old = Equipment(facility_id=site.id, asset_tag="OLD-1", make="M", model="M", serial_number="S")
    db.add(old)
    db.commit()
    joined = api.adopt_into_category("electrical", old.id, CategoryAdopt(
        name="Old panel", type="Distribution board", department_id=radiology.id), db=db, current_user=people["manager"])
    assert (joined["name"], joined["department"]) == ("Old panel", "Radiology")
    db.close()
    print("ok  equipment needs only a name and a type, and is placed and filtered by its department")


def test_the_lists_start_empty_and_only_show_their_own_category():
    db, site, _, people = build()
    ids = {c["code"]: c for c in overview(db, people["admin"], site)["categories"]}
    electrical = db.query(Discipline).filter_by(code="electrical").one()
    # Registered the old way: no name, so not part of the new register.
    db.add(Equipment(facility_id=site.id, discipline_id=electrical.id, asset_tag="OLD-1",
                     make="", model="", serial_number=""))
    db.commit()
    assert ids["electrical"]["equipment"] == 0
    assert listing(db, people["tech"], site, "electrical")["total"] == 0

    add(db, people["manager"], site, "electrical")
    add(db, people["manager"], site, "hvac", name="Chiller 1", type="Chiller", building="Roof")
    assert [i["name"] for i in listing(db, people["tech"], site, "electrical")["items"]] == ["Generator 1"]
    assert [i["name"] for i in listing(db, people["tech"], site, "hvac")["items"]] == ["Chiller 1"]
    counts = {c["code"]: c["equipment"] for c in overview(db, people["tech"], site)["categories"]}
    assert counts == {"electrical": 1, "plumbing": 0, "mechanical": 0, "hvac": 1, "building": 0, "landscaping": 0, "parking": 0}
    db.close()
    print("ok  older assets stay out; each category lists only its own equipment")


def test_a_list_can_be_searched_and_filtered_by_place_and_condition():
    db, site, _, people = build()
    add(db, people["manager"], site, "plumbing", name="Pump A", type="Water pump", building="Main block",
        floor="Basement")
    add(db, people["manager"], site, "plumbing", name="Tank 1", type="Water tank", building="Main block",
        floor="Roof", condition="needs_attention")
    add(db, people["manager"], site, "plumbing", name="Heater", type="Water heater", building="OPD block",
        floor="Ground", condition="out_of_service")

    def names(**filters):
        return [i["name"] for i in listing(db, people["tech"], site, "plumbing", **filters)["items"]]

    assert names() == ["Heater", "Pump A", "Tank 1"], "in name order"
    assert names(search="tank") == ["Tank 1"]
    assert names(search="opd") == ["Heater"]
    assert names(building="MAIN BLOCK", floor="roof") == ["Tank 1"]
    assert names(condition="out_of_service") == ["Heater"]
    refused(lambda: names(condition="broken"), 422)
    plumbing = overview(db, people["tech"], site)["categories"][1]
    assert (plumbing["needs_attention"], plumbing["out_of_service"]) == (1, 1)
    db.close()
    print("ok  search, building, floor and condition narrow a list; the tile counts what is wrong")


def test_equipment_can_be_edited_and_moved_to_another_category():
    db, site, _, people = build()
    item = add(db, people["manager"], site, "mechanical", name="AHU-1", type="Boiler")
    edited = api.update_category_equipment(item["id"], CategoryEquipmentUpdate(
        category="hvac", type="Air handling unit", condition="needs_attention", floor="", make=None,
    ), db=db, current_user=people["manager"])
    assert (edited["category"], edited["type"], edited["condition"]) == ("hvac", "Air handling unit",
                                                                      "needs_attention")
    assert edited["floor"] is None and edited["make"] is None
    assert listing(db, people["tech"], site, "mechanical")["total"] == 0
    refused(lambda: api.update_category_equipment(item["id"], CategoryEquipmentUpdate(name="  "),
                                                  db=db, current_user=people["manager"]), 422)
    db.close()
    print("ok  equipment can be edited, and moved when it was put in the wrong category")


def test_nothing_crosses_between_sites_and_viewers_cannot_write():
    db, site, other, people = build()
    item = add(db, people["manager"], site, "electrical")
    refused(lambda: listing(db, people["far_manager"], site, "electrical"), 403)
    refused(lambda: add(db, people["far_manager"], site, "electrical"), 403)
    refused(lambda: api.update_category_equipment(item["id"], CategoryEquipmentUpdate(name="Mine"),
                                                  db=db, current_user=people["far_manager"]), 403)
    # Technicians see the register but do not change it.
    refused(lambda: add(db, people["tech"], site, "electrical"), 403)
    refused(lambda: api.delete_category_equipment(item["id"], db=db, current_user=people["manager"]), 403)
    db.close()
    print("ok  another site's manager is refused, and technicians and managers cannot add or delete")


def test_equipment_with_jobs_is_kept_and_equipment_without_is_removed():
    db, site, _, people = build()
    kept = add(db, people["manager"], site, "electrical")
    spare = add(db, people["manager"], site, "electrical", name="Spare panel", type="Distribution board")
    raise_job(db, people["manager"], site, "service", kept["id"])
    detail = refused(lambda: api.delete_category_equipment(kept["id"], db=db, current_user=people["admin"]),
                     409)
    assert "Out of service" in detail
    api.delete_category_equipment(spare["id"], db=db, current_user=people["admin"])
    assert [i["name"] for i in listing(db, people["tech"], site, "electrical")["items"]] == ["Generator 1"]
    db.close()
    print("ok  equipment with jobs cannot be deleted, so its history stays")


def test_a_service_is_a_planned_work_order_that_shows_on_the_equipment():
    db, site, _, people = build()
    generator = add(db, people["manager"], site, "electrical")
    later = raise_job(db, people["manager"], site, "service", generator["id"], title="Oil change",
                      due_on=TODAY + timedelta(days=30), assigned_to_id=people["tech"].id)
    sooner = raise_job(db, people["manager"], site, "service", generator["id"], title="Load test",
                       due_on=TODAY - timedelta(days=2))

    row = db.get(ServiceRequest, later["id"])
    assert row.work_order_type == WorkOrderType.PREVENTIVE.value and row.is_billable is False
    assert row.status == ServiceRequestStatus.ASSIGNED and row.discipline_id == \
        db.query(Discipline).filter_by(code="electrical").one().id
    assert row.request_number.startswith("SR-") and later["equipment"]["location_label"] == "Main block"
    assert db.query(Notification).filter_by(user_id=people["tech"].id).count() == 1

    listed = jobs(db, people["tech"], site, "service")
    assert [j["title"] for j in listed["items"]] == ["Load test", "Oil change"], "soonest due first"
    assert listed["counts"] == {"open": 2, "in_progress": 0, "done": 0, "overdue": 1}
    assert [j["title"] for j in jobs(db, people["tech"], site, "service", status="overdue")["items"]] == \
        ["Load test"]
    assert sooner["overdue"] is True and later["overdue"] is False
    assert jobs(db, people["tech"], site, "inspection")["total"] == 0

    item = listing(db, people["tech"], site, "electrical")["items"][0]
    assert item["open_jobs"] == 2 and item["next_service_on"] == TODAY - timedelta(days=2)
    tile = overview(db, people["tech"], site)["categories"][0]
    assert (tile["open_jobs"], tile["overdue_jobs"]) == (2, 1)
    summary = jobs_api.summary(facility_id=site.id, db=db, current_user=people["tech"])
    assert summary["service"] == {"open": 2, "overdue": 1, "failed": 0}
    db.close()
    print("ok  a service is an unbilled planned work order, listed soonest first and counted on the site")


def test_an_inspection_records_pass_or_fail_and_a_service_does_not():
    db, site, _, people = build()
    chiller = add(db, people["manager"], site, "hvac", name="Chiller 1", type="Chiller")
    service = raise_job(db, people["manager"], site, "service", chiller["id"], inspection_result="fail",
                        findings="ignored")
    assert service["inspection_result"] is None and service["findings"] is None

    inspection = raise_job(db, people["manager"], site, "inspection", chiller["id"],
                           title="Annual inspection", status="done", inspection_result="fail",
                           findings="Refrigerant leak at valve 3")
    row = db.get(ServiceRequest, inspection["id"])
    assert row.work_order_type == "inspection" and row.completed_at is not None
    assert (inspection["inspection_result"], inspection["status_label"]) == ("fail", "Done")
    assert jobs_api.summary(facility_id=site.id, db=db, current_user=people["tech"])["inspection"] == \
        {"open": 0, "overdue": 0, "failed": 1}
    assert WorkOrderType.INSPECTION.value in NON_BILLABLE_TYPES
    assert WorkOrderType.INSPECTION.value in sla._UNCLOCKED_TYPES
    db.close()
    print("ok  an inspection keeps its result and findings; neither is billed nor put on a response clock")


def test_a_job_moves_freely_between_open_in_progress_and_done():
    db, site, _, people = build()
    pump = add(db, people["manager"], site, "plumbing", name="Pump A", type="Water pump")
    job = raise_job(db, people["manager"], site, "service", pump["id"])
    assert job["status"] == "open" and db.get(ServiceRequest, job["id"]).status == ServiceRequestStatus.NEW

    done = change_job(db, people["manager"], job["id"], status="done")
    row = db.get(ServiceRequest, job["id"])
    assert done["status"] == "done" and row.completed_at is not None

    reopened = change_job(db, people["manager"], job["id"], status="in_progress")
    db.refresh(row)
    assert reopened["status"] == "in_progress" and row.completed_at is None and row.started_at is not None

    assigned = change_job(db, people["manager"], job["id"], status="open", assigned_to_id=people["tech"].id)
    db.refresh(row)
    assert assigned["assigned_to"]["name"] == "Sam" and row.status == ServiceRequestStatus.ASSIGNED
    assert [e["action"] for e in row.history] == ["created", "updated", "updated", "updated"]
    refused(lambda: change_job(db, people["manager"], job["id"], title=" "), 422)
    db.close()
    print("ok  Open, In progress and Done move either way, and each change is kept in the history")


def test_technicians_update_only_the_progress_of_their_own_jobs():
    db, site, _, people = build()
    lift = add(db, people["manager"], site, "mechanical", name="Lift 2", type="Lift")
    mine = raise_job(db, people["manager"], site, "inspection", lift["id"], assigned_to_id=people["tech"].id)

    updated = change_job(db, people["tech"], mine["id"], status="done", inspection_result="pass",
                         findings="All good", notes="Brakes tested")
    assert (updated["status"], updated["inspection_result"], updated["notes"]) == ("done", "pass",
                                                                                   "Brakes tested")
    refused(lambda: change_job(db, people["tech"], mine["id"], title="Something else"), 403)
    refused(lambda: change_job(db, people["other_tech"], mine["id"], status="open"), 403)
    refused(lambda: jobs(db, people["far_tech"], site, "inspection"), 403)
    db.close()
    print("ok  a technician records progress on their own jobs and nothing more")


def test_jobs_go_to_people_at_the_site_on_equipment_at_the_site():
    db, site, other, people = build()
    here = add(db, people["manager"], site, "electrical")
    there = add(db, people["admin"], other, "electrical")
    names = [a["name"] for a in jobs_api.assignees(facility_id=site.id, db=db, current_user=people["manager"])]
    assert names[:2] == ["Ali", "Sam"], "technicians first"
    assert "Zed" not in names and "Kfm" not in names and "Boss" in names

    refused(lambda: raise_job(db, people["manager"], site, "service", here["id"],
                              assigned_to_id=people["far_tech"].id), 422)
    refused(lambda: raise_job(db, people["manager"], site, "service", there["id"]), 422)
    old = Equipment(facility_id=site.id, asset_tag="OLD-1", make="", model="", serial_number="")
    db.add(old)
    db.commit()
    refused(lambda: raise_job(db, people["manager"], site, "service", old.id), 422)
    assert db.query(ServiceRequest).count() == 0, "refusals wrote nothing"
    db.close()
    print("ok  a job needs this site's category equipment and someone who works here")


def test_an_unfinished_job_can_be_removed_but_a_finished_one_is_the_record():
    db, site, _, people = build()
    tank = add(db, people["manager"], site, "plumbing", name="Tank 1", type="Water tank")
    mistake = raise_job(db, people["manager"], site, "service", tank["id"])
    finished = raise_job(db, people["manager"], site, "service", tank["id"], status="done")
    refused(lambda: jobs_api.delete_job(finished["id"], db=db, current_user=people["admin"]), 409)
    refused(lambda: jobs_api.delete_job(mistake["id"], db=db, current_user=people["manager"]), 403)
    jobs_api.delete_job(mistake["id"], db=db, current_user=people["admin"])
    assert [j["id"] for j in jobs(db, people["admin"], site, "service")["items"]] == [finished["id"]]
    db.close()
    print("ok  a job raised by mistake can be removed; a finished one cannot")


def test_the_migration_adds_exactly_what_the_models_gained():
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "w8b9c0d1e2f3_site_categories.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    upgrade = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade")
    added: dict[str, set[str]] = {}
    for node in ast.walk(upgrade):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "add_column":
            table = ast.literal_eval(node.args[0])
            added.setdefault(table, set()).add(ast.literal_eval(node.args[1].args[0]))
    assert added == {
        "equipment": {"name", "equipment_type", "quantity", "building", "floor", "condition"},
        "service_requests": {"due_on", "notes", "inspection_result", "findings"},
    }, added
    for table, columns in added.items():
        missing = columns - {c.name for c in Base.metadata.tables[table].columns}
        assert not missing, f"{table}: model lacks {missing}"
    print("ok  the migration and the models describe the same new columns")


if __name__ == "__main__":
    tests = [v for k, v in globals().items() if k.startswith("test_")]
    for t in tests:
        t()
    print(f"\n{len(tests)} checks passed")
