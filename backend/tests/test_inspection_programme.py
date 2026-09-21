"""Prove the inspection programme: departments, the clock, visits, red tags and fleet.

A site has departments; every item carries one frequency and the date it next
falls due; a visit contains what is due and is filled in one item at a time;
a red tag outlives its inspection; and when something falls due the
maintenance is raised and the people who must act are told.

    DATABASE_URL=sqlite:// python backend/tests/test_inspection_programme.py
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
from app.api.v1.endpoints import fleet as fleet_api  # noqa: E402
from app.api.v1.endpoints import inspection_programme as api  # noqa: E402
from app.api.v1.endpoints import site_categories as categories_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.models.department import Department  # noqa: E402
from app.models.equipment import Equipment  # noqa: E402
from app.models.facility import Facility  # noqa: E402
from app.models.inspection_form import InspectionForm  # noqa: E402
from app.models.notification import Notification  # noqa: E402
from app.models.red_tag import RedTag  # noqa: E402
from app.models.service_request import ServiceRequest, WorkOrderType  # noqa: E402
from app.models.user import User, UserRole, UserType  # noqa: E402
from app.models.user_facility import UserFacility  # noqa: E402
from app.models.vehicle import Vehicle  # noqa: E402
from app.schemas.inspection_programme import (  # noqa: E402
    BulkAssignIn, ClearRedTagIn, FinishVisitIn, FormAttachIn, ItemScheduleIn, RecordItemIn, VehicleIn, VisitIn,
)
from app.schemas.site_categories import CategoryEquipmentCreate  # noqa: E402
from app.services import inspection_due, inspection_programme as programme  # noqa: E402

engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
Session = sessionmaker(bind=engine)
TODAY = datetime.utcnow().date()  # the server's day, as everywhere else


def build():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = Session()

    site = Facility(name="Texas Pain Facility", phone="1", email="tex@x.c", address="1", city="Austin",
                    state="TX", zip_code="1", country="USA", beds=120, area_sqft=48000, size_band="large")
    other = Facility(name="Karachi Hospital", phone="1", email="kar@x.c", address="1", city="Karachi",
                     state="SD", zip_code="1", country="PK")
    db.add_all([site, other])
    db.flush()

    def person(username, role, facility=None):
        user = User(username=username, email=f"{username}@x.c", full_name=username.title(),
                    hashed_password="x", user_type=UserType.EMPLOYEE, role=role, is_active=True,
                    facility_id=facility.id if facility else None)
        db.add(user)
        db.flush()
        if facility:
            db.add(UserFacility(user_id=user.id, facility_id=facility.id))
        return user

    people = {
        "boss": person("boss", UserRole.SUPERADMIN),
        "ali": person("ali", UserRole.TECHNICIAN, site),
        "sam": person("sam", UserRole.TECHNICIAN, site),
        "manager": person("manager", UserRole.FACILITY_MANAGER, site),
    }

    radiology = Department(name="Radiology", facility_id=site.id)
    pharmacy = Department(name="Pharmacy", facility_id=site.id)
    db.add_all([radiology, pharmacy])
    db.flush()

    safety = InspectionForm(name="Radiation safety", description="Monthly safety walk",
                            schema={"fields": [{"label": "Lead aprons checked", "type": "radio"}]})
    readiness = InspectionForm(name="Equipment readiness", schema={"fields": []})
    fleet_form = InspectionForm(name="Vehicle daily check", schema={"fields": []})
    db.add_all([safety, readiness, fleet_form])
    db.commit()

    for form, department, frequency in ((safety, radiology, "quarterly"), (readiness, radiology, "semi_annual"),
                                        (safety, pharmacy, "annual")):
        api.attach_form(department.id, FormAttachIn(form_id=form.id, default_frequency=frequency),
                        db=db, current_user=people["boss"])
    fleet_api.attach_fleet_form(FormAttachIn(form_id=fleet_form.id, default_frequency="monthly"),
                                facility_id=site.id, db=db, current_user=people["boss"])

    def add(code, name, kind, department, *, frequency=None, first_due=None, task=None, assignee=None):
        return categories_api.add_category_equipment(code, CategoryEquipmentCreate(
            facility_id=site.id, name=name, type=kind, building="Main block", floor="Ground",
            unit_cost=1000, department_id=department.id if department else None, frequency=frequency,
            first_due_on=first_due, pm_task=task,
            pm_assignee_id=assignee.id if assignee else None,
        ), db=db, current_user=people["boss"])

    equipment = {
        # Due yesterday, with maintenance to raise and somebody to raise it for.
        "ct": add("electrical", "CT scanner GE-01", "X-ray / CT", radiology, frequency="quarterly",
                  first_due=TODAY - timedelta(days=1), task="Filter change and calibration",
                  assignee=people["ali"]),
        # Due in a week: the warning, not the work.
        "xray": add("electrical", "X-ray XR-02", "X-ray / CT", radiology, frequency="quarterly",
                    first_due=TODAY + timedelta(days=7)),
        # Not due for months.
        "ultrasound": add("electrical", "Ultrasound US-03", "Ultrasound", radiology, frequency="annual",
                          first_due=TODAY + timedelta(days=200)),
        # In a department, but nobody put it on the clock.
        "fridge": add("hvac", "Fridge PH-02", "Split / package AC", pharmacy),
        # Not in a department at all: the state every existing site starts in.
        "generator": add("electrical", "Generator 1", "Generator", None),
    }
    db.commit()
    return db, site, other, people, {"radiology": radiology, "pharmacy": pharmacy}, equipment, \
        {"safety": safety, "readiness": readiness, "fleet": fleet_form}


def refused(call, status):
    try:
        call()
    except HTTPException as exc:
        assert exc.status_code == status, f"expected {status}, got {exc.status_code}: {exc.detail}"
        return exc.detail
    raise AssertionError(f"expected a {status} refusal")


def test_the_clock_is_one_frequency_per_item():
    assert programme.next_due(date(2026, 1, 31), "quarterly") == date(2026, 4, 30), "a short month is respected"
    assert programme.next_due(date(2026, 3, 15), "semi_annual") == date(2026, 9, 15)
    assert programme.next_due(date(2026, 3, 15), "annual") == date(2027, 3, 15)
    assert programme.next_due(date(2026, 3, 15), "custom", 45) == date(2026, 4, 29)
    assert programme.next_due(date(2026, 3, 15), None) is None
    try:
        programme.frequency_or_422("fortnightly", None)
        raise AssertionError("an unknown frequency was accepted")
    except HTTPException as exc:
        assert "Frequency is one of" in exc.detail
    refused(lambda: programme.frequency_or_422("custom", None), 422)
    print("ok  a frequency is quarterly, every 6 months, annually or a custom number of days")


def test_equipment_is_added_with_its_department_and_clock():
    db, site, _, people, departments, equipment, _ = build()
    ct = db.get(Equipment, equipment["ct"]["id"])
    assert ct.department_id == departments["radiology"].id
    assert (ct.pm_scheduling, ct.next_generated_pm_date) == ("quarterly", TODAY - timedelta(days=1))
    assert ct.pm_task == "Filter change and calibration" and ct.pm_assignee_id == people["ali"].id
    assert equipment["ct"]["department"] == "Radiology" and equipment["ct"]["due_state"] == "overdue"
    assert equipment["ultrasound"]["due_state"] == "scheduled"
    assert equipment["fridge"]["due_state"] == "not_scheduled"

    # An existing site's items are put in a department and on the clock together.
    result = api.bulk_assign(BulkAssignIn(
        equipment_ids=[equipment["generator"]["id"], equipment["fridge"]["id"]],
        department_id=departments["pharmacy"].id, frequency="semi_annual",
        first_due_on=TODAY + timedelta(days=3), pm_task="Load test"),
        db=db, current_user=people["boss"])
    assert result["updated"] == 2
    generator = db.get(Equipment, equipment["generator"]["id"])
    assert generator.department_id == departments["pharmacy"].id and generator.pm_scheduling == "semi_annual"
    assert generator.next_generated_pm_date == TODAY + timedelta(days=3)

    refused(lambda: api.set_item_schedule(equipment["ct"]["id"], ItemScheduleIn(
        department_id=9999), db=db, current_user=people["boss"]), 404)
    db.close()
    print("ok  an item is added with its department, its frequency and its first date, and many at once")


def test_a_department_shows_what_it_holds_and_where_it_stands():
    db, site, _, people, departments, equipment, _ = build()
    rows = {row["name"]: row for row in api.list_departments(facility_id=site.id, db=db,
                                                             current_user=people["boss"])["items"]}
    assert rows["Radiology"]["items"] == 3 and rows["Radiology"]["forms"] == 2
    assert rows["Radiology"]["overdue"] == 1 and rows["Radiology"]["due"] == 1
    assert rows["Pharmacy"]["unscheduled"] == 1
    assert rows["Not in a department"]["items"] == 1, "an unassigned item is visible, not hidden"

    detail = api.department_detail(departments["radiology"].id, db=db, current_user=people["boss"])
    assert {form["name"] for form in detail["forms"]} == {"Radiation safety", "Equipment readiness"}
    assert {item["name"] for item in detail["items"]} == {"CT scanner GE-01", "X-ray XR-02", "Ultrasound US-03"}
    ct = next(item for item in detail["items"] if item["name"] == "CT scanner GE-01")
    assert (ct["frequency_label"], ct["due_state"]) == ("Quarterly", "overdue")
    db.close()
    print("ok  a department lists its forms, its items and how many are due or overdue")


def test_a_visit_contains_what_is_due_and_nothing_else():
    db, site, _, people, departments, equipment, _ = build()
    preview = api.due_preview(facility_id=site.id, scope="department", department_id=departments["radiology"].id,
                              by=TODAY, db=db, current_user=people["boss"])
    assert preview["total"] == 1 and preview["items"][0]["name"] == "CT scanner GE-01"

    later = api.due_preview(facility_id=site.id, scope="department", department_id=departments["radiology"].id,
                            by=TODAY + timedelta(days=7), db=db, current_user=people["boss"])
    assert later["total"] == 2, "a date further out pulls in what is due by then"

    visit = api.create_visit(VisitIn(facility_id=site.id, scope="department",
                                     department_id=departments["radiology"].id, scheduled_on=TODAY,
                                     inspector_id=people["ali"].id), db=db, current_user=people["boss"])
    assert visit["number"].startswith("VIS-") and visit["items"] == 1 and visit["done"] == 0
    assert visit["inspector"]["name"] == "Ali" and visit["department"] == "Radiology"
    assert visit["item_list"][0]["name"] == "CT scanner GE-01"
    assert {form["name"] for form in visit["forms"]} == {"Radiation safety", "Equipment readiness"}

    refused(lambda: api.create_visit(VisitIn(facility_id=site.id, scope="department",
                                             department_id=departments["pharmacy"].id, scheduled_on=TODAY),
                                     db=db, current_user=people["boss"]), 422)
    empty = refused(lambda: api.create_visit(VisitIn(facility_id=site.id, scope="department",
                                                     department_id=departments["radiology"].id,
                                                     scheduled_on=TODAY - timedelta(days=30)),
                                             db=db, current_user=people["boss"]), 422)
    assert "Nothing is due" in empty, empty
    db.close()
    print("ok  a visit is scheduled for a date and holds the items due by then")


def test_a_whole_site_visit_covers_every_department():
    db, site, _, people, departments, equipment, _ = build()
    api.bulk_assign(BulkAssignIn(equipment_ids=[equipment["fridge"]["id"]],
                                 department_id=departments["pharmacy"].id, frequency="annual",
                                 first_due_on=TODAY), db=db, current_user=people["boss"])
    visit = api.create_visit(VisitIn(facility_id=site.id, scope="facility", scheduled_on=TODAY),
                             db=db, current_user=people["boss"])
    assert visit["scope"] == "facility" and visit["department"] is None
    assert {item["name"] for item in visit["item_list"]} == {"CT scanner GE-01", "Fridge PH-02"}
    assert {item["department"] for item in visit["item_list"]} == {"Radiology", "Pharmacy"}
    db.close()
    print("ok  a whole-site visit pulls the due items of every department, each on its own forms")


def test_recording_an_item_moves_its_clock_and_a_failure_comes_back():
    db, site, _, people, departments, equipment, forms = build()
    visit = api.create_visit(VisitIn(facility_id=site.id, scope="department",
                                     department_id=departments["radiology"].id,
                                     scheduled_on=TODAY + timedelta(days=7),
                                     inspector_id=people["ali"].id), db=db, current_user=people["boss"])
    items = {item["name"]: item for item in visit["item_list"]}

    passed = api.record_item(visit["id"], items["CT scanner GE-01"]["id"], RecordItemIn(
        result="pass", answers=[{"form_id": forms["safety"].id, "name": "Radiation safety",
                                 "answers": {"Lead aprons checked": "Pass"}}]),
        db=db, current_user=people["ali"])
    assert passed["item"]["result"] == "pass" and passed["visit"]["status"] == "in_progress"
    assert passed["service"] is None, "a pass asks for no work"
    ct = db.get(Equipment, equipment["ct"]["id"])
    assert ct.last_pm_date == TODAY and ct.last_inspection_result == "pass"
    assert ct.next_generated_pm_date == programme.next_due(TODAY, "quarterly"), "a pass moves the clock on"
    assert ct.condition == "working"

    failed = api.record_item(visit["id"], items["X-ray XR-02"]["id"], RecordItemIn(
        result="fail", note="Collimator lamp out"), db=db, current_user=people["ali"])
    assert failed["item"]["result"] == "fail"
    xray = db.get(Equipment, equipment["xray"]["id"])
    assert xray.next_generated_pm_date == TODAY, "a failure is due again at once"
    assert xray.condition == "needs_attention"
    assert failed["visit"]["result"] == "fail", "a visit reads as its worst item"
    db.close()
    print("ok  a pass moves the clock on, a failure comes back at once and needs attention")


def test_service_is_raised_only_when_the_inspector_asks_for_it():
    db, site, _, people, departments, equipment, _ = build()
    visit = api.create_visit(VisitIn(facility_id=site.id, scope="department",
                                     department_id=departments["radiology"].id,
                                     scheduled_on=TODAY + timedelta(days=7),
                                     inspector_id=people["ali"].id), db=db, current_user=people["boss"])
    items = {item["name"]: item for item in visit["item_list"]}
    before = db.query(ServiceRequest).count()

    # Fixed on the spot: a failure, and nothing left for anybody to close.
    quiet = api.record_item(visit["id"], items["CT scanner GE-01"]["id"], RecordItemIn(
        result="fail", note="Lamp replaced on the spot"), db=db, current_user=people["ali"])
    assert quiet["service"] is None and db.query(ServiceRequest).count() == before

    asked = api.record_item(visit["id"], items["X-ray XR-02"]["id"], RecordItemIn(
        result="fail", note="Shutter jammed open", raise_service=True),
        db=db, current_user=people["ali"])
    assert asked["service"] is not None, asked
    job = db.query(ServiceRequest).order_by(ServiceRequest.id.desc()).first()
    assert db.query(ServiceRequest).count() == before + 1
    assert job.problem_description == "Shutter jammed open"
    assert job.equipment_id == equipment["xray"]["id"] and job.work_order_type == WorkOrderType.PREVENTIVE.value
    assert job.inspection_id == items["X-ray XR-02"]["id"], "the job says which inspection found it"
    assert asked["item"]["service"]["number"] == job.request_number

    # Recording it again does not raise a second job for the same finding.
    again = api.record_item(visit["id"], items["X-ray XR-02"]["id"], RecordItemIn(
        result="red_tag", note="Shutter jammed open", raise_service=True),
        db=db, current_user=people["ali"])
    assert again["service"]["number"] == job.request_number
    assert db.query(ServiceRequest).count() == before + 1
    db.close()
    print("ok  service is raised once, only when the inspector asks, and says which inspection found it")


def test_a_red_tag_outlives_its_inspection_and_is_cleared_with_a_note():
    db, site, _, people, departments, equipment, _ = build()
    visit = api.create_visit(VisitIn(facility_id=site.id, scope="department",
                                     department_id=departments["radiology"].id, scheduled_on=TODAY,
                                     inspector_id=people["ali"].id), db=db, current_user=people["boss"])
    item = visit["item_list"][0]

    refused(lambda: api.record_item(visit["id"], item["id"], RecordItemIn(result="red_tag"),
                                    db=db, current_user=people["ali"]), 422)
    api.record_item(visit["id"], item["id"], RecordItemIn(
        result="red_tag", note="Radiation leak at the door interlock"), db=db, current_user=people["ali"])

    ct = db.get(Equipment, equipment["ct"]["id"])
    assert ct.condition == "out_of_service" and ct.last_inspection_result == "red_tag"
    tags = api.list_red_tags(facility_id=site.id, include_cleared=False, db=db, current_user=people["boss"])
    assert tags["total"] == 1
    tag = tags["items"][0]
    assert (tag["name"], tag["department"], tag["raised_by"]) == ("CT scanner GE-01", "Radiology", "Ali")
    assert tag["note"].startswith("Radiation leak") and tag["cleared_at"] is None

    counts = api.site_overview(site.id, db=db, current_user=people["boss"])["counts"]
    assert counts["red_tagged"] == 1 and counts["passed"] == 0

    # Blank, once the spaces are taken off: nothing was said about what was done.
    refused(lambda: api.clear_red_tag(tag["id"], ClearRedTagIn(note="   "), db=db,
                                      current_user=people["boss"]), 422)
    cleared = api.clear_red_tag(tag["id"], ClearRedTagIn(note="Interlock replaced and retested"),
                               db=db, current_user=people["ali"])
    assert cleared["cleared_by"] == "Ali" and cleared["clear_note"].startswith("Interlock replaced")
    db.refresh(ct)
    assert ct.condition == "needs_attention", "usable again, but still carrying a failure"
    assert api.list_red_tags(facility_id=site.id, include_cleared=False, db=db, current_user=people["boss"])["total"] == 0
    assert api.list_red_tags(facility_id=site.id, include_cleared=True, db=db,
                             current_user=people["boss"])["total"] == 1, "the history stays"
    refused(lambda: api.clear_red_tag(tag["id"], ClearRedTagIn(note="Again"), db=db,
                                      current_user=people["boss"]), 409)
    db.close()
    print("ok  a red tag stands until somebody clears it with a note, and the history is kept")


def test_only_the_inspector_admins_and_super_admins_fill_a_visit():
    db, site, _, people, departments, equipment, _ = build()
    visit = api.create_visit(VisitIn(facility_id=site.id, scope="department",
                                     department_id=departments["radiology"].id, scheduled_on=TODAY,
                                     inspector_id=people["ali"].id), db=db, current_user=people["boss"])
    item = visit["item_list"][0]
    refused(lambda: api.record_item(visit["id"], item["id"], RecordItemIn(result="pass"),
                                    db=db, current_user=people["sam"]), 403)
    assert api.record_item(visit["id"], item["id"], RecordItemIn(result="pass"),
                           db=db, current_user=people["boss"])["item"]["result"] == "pass"

    finished = api.finish_visit(visit["id"], FinishVisitIn(notes="All clear"),
                                db=db, current_user=people["boss"])
    assert finished["status"] == "completed" and finished["result"] == "pass" and finished["notes"] == "All clear"
    refused(lambda: api.delete_visit(visit["id"], db=db, current_user=people["boss"]), 409)
    db.close()
    print("ok  filling in a visit is for its inspector, admins and Super Admins; a finished visit is kept")


def test_the_dashboard_counts_items_across_sites():
    db, site, other, people, departments, equipment, _ = build()
    visit = api.create_visit(VisitIn(facility_id=site.id, scope="department",
                                     department_id=departments["radiology"].id,
                                     scheduled_on=TODAY + timedelta(days=7),
                                     inspector_id=people["ali"].id), db=db, current_user=people["boss"])
    items = {item["name"]: item for item in visit["item_list"]}
    api.record_item(visit["id"], items["CT scanner GE-01"]["id"], RecordItemIn(result="pass"),
                    db=db, current_user=people["boss"])
    api.record_item(visit["id"], items["X-ray XR-02"]["id"], RecordItemIn(
        result="red_tag", note="Shutter jammed open"), db=db, current_user=people["boss"])

    board = api.dashboard(db=db, current_user=people["boss"])
    rows = {row["name"]: row for row in board["sites"]}
    assert set(rows) == {"Texas Pain Facility", "Karachi Hospital"}
    texas = rows["Texas Pain Facility"]
    assert (texas["passed"], texas["red_tagged"]) == (1, 1)
    assert texas["beds"] == 120 and texas["size_band"] == "large" and texas["departments"] == 2
    assert board["sites"][0]["name"] == "Texas Pain Facility", "the site with red tags comes first"
    assert board["totals"]["red_tagged"] == 1
    assert {f["value"] for f in board["frequencies"]} == set(programme.FREQUENCIES)
    db.close()
    print("ok  the dashboard counts items per site, worst first, with the site's size")


def test_falling_due_tells_people_and_creates_nothing():
    db, site, _, people, departments, equipment, _ = build()
    before = db.query(ServiceRequest).count()
    summary = inspection_due.run(db, facility_ids=[site.id], today=TODAY)
    db.commit()

    assert "jobs_raised" not in summary, "falling due raises nothing: the visit is the record"
    assert db.query(ServiceRequest).count() == before, summary

    notices = db.query(Notification).filter(Notification.notification_type == "inspection").all()
    titles = {notice.title for notice in notices}
    assert "Inspection due today" in titles, titles
    assert "Inspection due in 7 days" in titles, "the X-ray due next week gets a warning"
    assert people["ali"].id in {notice.user_id for notice in notices}
    assert people["boss"].id in {notice.user_id for notice in notices}, "admins hear about it too"

    again = inspection_due.run(db, facility_ids=[site.id], today=TODAY)
    db.commit()
    assert again["notified"] == 0, "running it twice does not tell people twice"
    assert db.query(ServiceRequest).count() == before
    db.close()
    print("ok  a due item tells its people once, a week ahead and on the day, and creates nothing")


def test_the_fleet_is_inspected_the_same_way():
    db, site, _, people, departments, equipment, forms = build()
    vehicle = fleet_api.add_vehicle(VehicleIn(
        facility_id=site.id, name="Ambulance 1", registration="TX-1129", vehicle_type="Ambulance",
        make="Ford", model="Transit", year=2023, driver_name="Bilal", odometer=41000,
        frequency="monthly", first_due_on=TODAY, pm_task="Daily walkaround"),
        db=db, current_user=people["boss"])
    assert vehicle["kind"] == "vehicle" and vehicle["registration"] == "TX-1129"
    assert vehicle["due_state"] == "due" and vehicle["frequency_label"] == "Monthly"

    listed = fleet_api.list_vehicles(facility_id=site.id, search=None, due_only=False, db=db,
                                      current_user=people["boss"])
    assert listed["total"] == 1 and listed["counts"]["due"] == 1
    assert {form["name"] for form in listed["forms"]} == {"Vehicle daily check"}

    visit = api.create_visit(VisitIn(facility_id=site.id, scope="fleet", scheduled_on=TODAY,
                                     inspector_id=people["ali"].id), db=db, current_user=people["boss"])
    assert visit["scope"] == "fleet" and visit["item_list"][0]["name"] == "Ambulance 1"
    api.record_item(visit["id"], visit["item_list"][0]["id"], RecordItemIn(
        result="red_tag", note="Brake light out"), db=db, current_user=people["ali"])

    stored = db.query(Vehicle).one()
    assert stored.condition == "out_of_service" and stored.next_generated_pm_date == TODAY
    tag = db.query(RedTag).filter(RedTag.vehicle_id == stored.id).one()
    assert tag.note == "Brake light out"
    detail = fleet_api.get_vehicle(stored.id, db=db, current_user=people["boss"])
    assert detail["vehicle"]["red_tagged"] is True and len(detail["inspections"]) == 1

    counts = api.site_overview(site.id, db=db, current_user=people["boss"])
    assert counts["fleet"] == {"vehicles": 1, "due": 1}
    assert counts["counts"]["red_tagged"] == 1, "a red-tagged vehicle counts on the site's numbers"

    refused(lambda: fleet_api.remove_vehicle(stored.id, db=db, current_user=people["boss"]), 409)
    db.close()
    print("ok  a vehicle is added, inspected, red-tagged and counted exactly like equipment")


def test_another_sites_records_are_out_of_reach():
    db, site, other, people, departments, equipment, _ = build()
    scoped = people["manager"]
    refused(lambda: api.site_overview(other.id, db=db, current_user=scoped), 403)
    refused(lambda: api.list_departments(facility_id=other.id, db=db, current_user=scoped), 403)
    refused(lambda: fleet_api.list_vehicles(facility_id=other.id, search=None, due_only=False, db=db,
                                            current_user=scoped), 403)
    board = api.dashboard(db=db, current_user=scoped)
    assert [row["name"] for row in board["sites"]] == ["Texas Pain Facility"]
    db.close()
    print("ok  a site-scoped manager sees only their own site, on every screen")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"\n{len(tests)} checks passed")
