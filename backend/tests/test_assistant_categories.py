"""Prove the assistant answers from, and prepares work on, the site categories.

Phia reads the same queries the Categories and Equipment Maintenance screens
use, finds equipment by the name people give it, prepares a service or
inspection job that only a person's Confirm raises, and quotes written guides
for the two screens.

    DATABASE_URL=sqlite:// python backend/tests/test_assistant_categories.py
"""
from __future__ import annotations

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
from app.assistant import actions  # noqa: E402
from app.assistant.kb.guides import guide_documents  # noqa: E402
from app.assistant.tools.base import ToolContext  # noqa: E402
from app.assistant.tools.registry import dispatch  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.models.equipment import Equipment  # noqa: E402
from app.models.facility import Facility  # noqa: E402
from app.models.service_request import ServiceRequest, WorkOrderType  # noqa: E402
from app.models.user import User, UserRole, UserType  # noqa: E402
from app.models.user_facility import UserFacility  # noqa: E402
from app.schemas.site_categories import CategoryEquipmentCreate, EquipmentJobCreate  # noqa: E402

engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
Session = sessionmaker(bind=engine)
TODAY = datetime.utcnow().date()  # the server's day: every "today" in the app is UTC


def build():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = Session()

    def site(name):
        f = Facility(name=name, phone="1", email=f"{name[:4]}@x.c", address="1",
                     city="X", state="GA", zip_code="1", country="USA")
        db.add(f)
        db.flush()
        return f

    medpro, other = site("Medpro Regional"), site("Karachi Hospital")

    def person(username, role, facility=None):
        u = User(username=username, email=f"{username}@x.c", full_name=username.title(), hashed_password="x",
                 user_type=UserType.EMPLOYEE, role=role, is_active=True,
                 facility_id=facility.id if facility else None)
        db.add(u)
        db.flush()
        if facility:
            db.add(UserFacility(user_id=u.id, facility_id=facility.id))
        return u

    people = {"boss": person("boss", UserRole.SUPERADMIN), "sam": person("sam", UserRole.TECHNICIAN, medpro),
              "zed": person("zed", UserRole.TECHNICIAN, other),
              "far_manager": person("kfm", UserRole.FACILITY_MANAGER, other)}
    db.commit()

    def add(code, **fields):
        return api.add_category_equipment(code, CategoryEquipmentCreate(facility_id=medpro.id, **fields),
                                          db=db, current_user=people["boss"])

    equipment = {
        "generator": add("electrical", name="Generator 1", type="Generator", building="Main block",
                         floor="Basement", spot="Plant room 2"),
        "chiller": add("hvac", name="Chiller 1", type="Chiller", building="Main block", floor="Roof",
                       condition="needs_attention"),
        "ahu": add("hvac", name="AHU-3", type="Air handling unit", building="OPD block", condition="out_of_service"),
    }
    jobs_api.create_job(EquipmentJobCreate(facility_id=medpro.id, kind="service",
                                           equipment_id=equipment["generator"]["id"], title="Load test",
                                           due_on=TODAY - timedelta(days=1)), db=db, current_user=people["boss"])
    jobs_api.create_job(EquipmentJobCreate(facility_id=medpro.id, kind="inspection",
                                           equipment_id=equipment["chiller"]["id"], title="Annual inspection",
                                           status="done", inspection_result="fail", findings="Leak at valve 3"),
                        db=db, current_user=people["boss"])
    return db, medpro, other, people, equipment


def ask(db, user, tool, **arguments):
    return dispatch(tool, ToolContext(db=db, user=user), arguments)


def refused(call, status):
    try:
        call()
    except HTTPException as exc:
        assert exc.status_code == status, f"expected {status}, got {exc.status_code}: {exc.detail}"
        return exc.detail
    raise AssertionError(f"expected a {status} refusal")


def test_phia_reads_the_categories_as_the_screen_shows_them():
    db, site, other, people, _ = build()
    result = ask(db, people["boss"], "category_equipment", facility_id=site.id, category="hvac")
    assert result.total_count == 2
    assert {i["name"] for i in result.items} == {"Chiller 1", "AHU-3"}
    chiller = next(i for i in result.items if i["name"] == "Chiller 1")
    assert (chiller["where"], chiller["condition"], chiller["route"]) == ("Main block · Roof", "Needs attention",
                                                                       "/categories/hvac")
    by_category = {c["category"]: c for c in result.aggregates["by_category"]}
    assert by_category["HVAC"]["needs_attention"] == 1 and by_category["HVAC"]["out_of_service"] == 1
    assert by_category["Electrical"]["open_jobs"] == 1 and by_category["Electrical"]["overdue_jobs"] == 1

    attention = ask(db, people["boss"], "category_equipment", facility_id=site.id, condition="out_of_service")
    assert [i["name"] for i in attention.items] == ["AHU-3"]
    generator = ask(db, people["boss"], "category_equipment", facility_id=site.id, query="plant room").items[0]
    assert generator["name"] == "Generator 1" and generator["open_jobs"] == 1
    assert generator["next_service_on"] == (TODAY - timedelta(days=1)).isoformat()

    refused(lambda: ask(db, people["far_manager"], "category_equipment", facility_id=site.id), 422)
    refused(lambda: ask(db, people["boss"], "category_equipment", facility_id=site.id, category="lifts"), 422)
    db.close()
    print("ok  category_equipment gives each item, where it is, and the counts the site page shows")


def test_phia_reads_services_and_inspections():
    db, site, _, people, _ = build()
    overdue = ask(db, people["boss"], "equipment_jobs", facility_id=site.id, kind="service", status="overdue")
    assert overdue.total_count == 1
    job = overdue.items[0]
    assert (job["what_needs_doing"], job["equipment"], job["where"], job["overdue"]) == \
        ("Load test", "Generator 1", "Main block · Basement · Plant room 2", True)
    assert overdue.aggregates["by_status"]["overdue"] == 1

    inspections = ask(db, people["boss"], "equipment_jobs", facility_id=site.id, kind="inspection")
    assert inspections.items[0]["result"] == "fail" and inspections.items[0]["findings"] == "Leak at valve 3"
    assert inspections.items[0]["status"] == "Done"
    db.close()
    print("ok  equipment_jobs lists overdue services and failed inspections with their equipment and place")


def test_equipment_is_found_by_the_name_people_use():
    db, site, _, people, equipment = build()
    found = ask(db, people["boss"], "resolve_entity", kind="asset", query="generator 1")
    assert found.total_count == 1
    item = found.items[0]
    assert (item["asset_id"], item["name"], item["where"]) == (equipment["generator"]["id"], "Generator 1",
                                                              "Main block · Basement · Plant room 2")
    db.close()
    print("ok  resolve_entity finds equipment by its name and says where it is")


def test_phia_prepares_a_service_that_only_confirm_raises():
    db, site, other, people, equipment = build()
    before = db.query(ServiceRequest).count()
    due = (TODAY + timedelta(days=6)).isoformat()
    action = actions.propose(db, people["boss"], "prepare_equipment_job", {
        "asset_id": equipment["chiller"]["id"], "kind": "service", "what_needs_doing": "Clean condenser coils",
        "due_on": due, "assigned_to_id": people["sam"].id})
    card = actions.card_of(action)
    lines = {line["label"]: line["value"] for line in card["lines"]}
    assert card["title"] == "Raise a service on Chiller 1"
    assert (lines["Category"], lines["Where"], lines["Due"], lines["Assigned to"]) == \
        ("HVAC", "Main block · Roof", due, "Sam")
    assert db.query(ServiceRequest).count() == before, "nothing is raised until confirmed"

    done = actions.confirm(db, people["boss"], action.id)
    assert done.status == "executed", (done.status, done.error)
    job = db.get(ServiceRequest, done.result["work_order_id"])
    assert job.work_order_type == WorkOrderType.PREVENTIVE.value and job.due_on.isoformat() == due
    assert job.assigned_technician_id == people["sam"].id and done.result["route"] == "/equipment-maintenance/service"

    old = Equipment(facility_id=site.id, asset_tag="OLD-1", make="", model="", serial_number="")
    db.add(old)
    db.commit()
    refused(lambda: actions.propose(db, people["boss"], "prepare_equipment_job", {
        "asset_id": old.id, "kind": "service", "what_needs_doing": "Clean it properly"}), 422)
    refused(lambda: actions.propose(db, people["boss"], "prepare_equipment_job", {
        "asset_id": equipment["generator"]["id"], "kind": "inspection", "what_needs_doing": "Annual check",
        "assigned_to_id": people["zed"].id}), 422)
    db.close()
    print("ok  a service job is prepared as a card, raised once on Confirm, and refused for the wrong target")


def test_the_written_guides_describe_the_screens_and_are_generated():
    from app.assistant.kb import generator

    guides = {doc.doc_id: doc for doc in guide_documents()}
    assert set(guides) == {"guide.site_categories", "guide.inspections", "guide.service"}
    for words in ("Add equipment", "Where is it?", "Building", "Room / exact spot", "Out of service",
                  "Open Facility and choose", "Cost & value", "In service since", "Useful life", "Book value today",
                  "View asset & value history", "Add to a category", "$38,250", "Inspections and PM"):
        assert words in guides["guide.site_categories"].body, words
    # An inspection is the schedule; service is the fault. The guides must not
    # blur the two, or Phia will explain a product that no longer exists.
    for words in ("Add department", "Assign items", "Attach a form", "Schedule inspection", "Schedule visit",
                  "Raise a service job for this", "Finish visit", "Red tag", "Fleet", "Overdue",
                  "Inspect it now", "New inspection", "Start inspection"):
        assert words in guides["guide.inspections"].body, words
    assert "maintenance plan" in guides["guide.inspections"].body.lower()
    for words in ("New service", "Raise service", "What needs doing", "Labour", "Parts",
                  "Major work that extends its life", "From inspection"):
        assert words in guides["guide.service"].body, words
    assert "Maintenance Plans" not in guides["guide.service"].body, "that screen is gone"
    source = pathlib.Path(generator.__file__).read_text(encoding="utf-8")
    assert "documents.extend(guide_documents())" in source

    # The labels quoted in the guides are the labels on the screens.
    pages = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages"
    if pages.is_dir():
        screens = "".join(page.read_text(encoding="utf-8") for folder in
                          ("Categories", "Service", "Departments", "InspectionVisits", "Fleet", "RedTags", "InspectionStatus",
                           "Inspections/programme")
                          for page in (pages / folder).glob("*.tsx"))
        for label in ("Add equipment", "Where is it?", "Room / exact spot", "What needs doing", "Assigned to",
                      "Cost & value", "In service since", "Useful life", "Book value today",
                      "View asset & value history", "Add to a category", "Labour", "Parts",
                      "Major work that extends its life", "Inspections and PM", "Add department", "Assign items",
                      "Attach a form", "Schedule inspection", "Schedule visit", "Finish visit",
                      "Raise a service job for this", "Clear red tag", "Add vehicle",
                      "Inspect it now", "New inspection", "Start inspection"):
            assert label in screens, label
    print("ok  the guides use the screens' own words and are part of the knowledge base")


if __name__ == "__main__":
    tests = [v for k, v in globals().items() if k.startswith("test_")]
    for t in tests:
        t()
    print(f"\n{len(tests)} checks passed")
