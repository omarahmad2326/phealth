"""Prove the assistant's actions write nothing until a person confirms, and then run once.

    DATABASE_URL=sqlite:// python backend/tests/test_assistant_actions.py
"""
from __future__ import annotations

import os
import pathlib
import sys
from datetime import datetime, timedelta

os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.models  # noqa: E402,F401
from app.assistant import actions  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.models.assistant_action import ActionStatus, AssistantAction  # noqa: E402
from app.models.discipline import Discipline  # noqa: E402
from app.models.equipment import Equipment, EquipmentStatus  # noqa: E402
from app.models.facility import Facility  # noqa: E402
from app.models.fixture import Fixture  # noqa: E402
from app.models.location import Location  # noqa: E402
from app.models.maintenance_schedule import MaintenanceSchedule  # noqa: E402
from app.models.service_request import ServiceRequest, ServiceRequestStatus  # noqa: E402
from app.models.user import User, UserRole, UserType  # noqa: E402
from app.models.user_facility import UserFacility  # noqa: E402
from app.services import fixture as fixture_service  # noqa: E402

engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
Session = sessionmaker(bind=engine)


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

    lahore, karachi = site("Lahore Office"), site("Karachi Hospital")
    for code, name in (("electrical", "Electrical"), ("mechanical", "Mechanical / HVAC")):
        db.add(Discipline(code=code, name=name, sort_order=1))
    db.flush()

    def room(code, facility, crit="critical"):
        loc = Location(facility_id=facility.id, location_type="room", code=code, name=code,
                       criticality=crit, path="/", depth=0)
        db.add(loc)
        db.flush()
        loc.path = f"/{loc.id}/"
        return loc

    or2, theirs = room("OR-2", lahore), room("OR-2K", karachi)

    def person(username, role, facility=None):
        u = User(username=username, email=f"{username}@x.c", full_name=username.title(), hashed_password="x",
                 user_type=UserType.EMPLOYEE, role=role, facility_id=facility.id if facility else None)
        db.add(u)
        db.flush()
        if facility:
            db.add(UserFacility(user_id=u.id, facility_id=facility.id))
        return u

    people = {
        "boss": person("boss", UserRole.SUPERADMIN),
        "other_boss": person("other", UserRole.SUPERADMIN),
        "sam": person("sam", UserRole.TECHNICIAN, lahore),
        "manager": person("manager", UserRole.FACILITY_MANAGER, lahore),
    }
    sockets = fixture_service.bulk_create(db, location=or2, fixture_type="receptacle", count=3)
    their_socket = fixture_service.bulk_create(db, location=theirs, fixture_type="receptacle", count=1)[0]
    ahu = Equipment(asset_tag="AHU-2", make="Trane", model="M", serial_number="T1", facility_id=lahore.id,
                    location_id=or2.id, status=EquipmentStatus.ACTIVE,
                    discipline_id=db.query(Discipline).filter_by(code="mechanical").one().id)
    db.add(ahu)
    db.commit()
    return db, dict(lahore=lahore, or2=or2), people, dict(sockets=sockets, theirs=their_socket, ahu=ahu)


def refused(call, status):
    try:
        call()
    except HTTPException as exc:
        assert exc.status_code == status, f"expected {status}, got {exc.status_code}: {exc.detail}"
        return exc.detail
    raise AssertionError(f"expected a {status} refusal")


def test_preparing_writes_only_the_proposal():
    db, where, people, things = build()
    socket = things["sockets"][0]
    action = actions.propose(db, people["boss"], "prepare_fault_report",
                             {"fixture_id": socket.id, "description": "Dead socket behind the boom"})
    card = actions.card_of(action)
    lines = {line["label"]: line["value"] for line in card["lines"]}
    assert card["status"] == "proposed" and card["title"] == "Raise a work order"
    assert lines["What"].startswith("SKT-01") and lines["Goes to"] == "Electrical"
    assert lines["Priority"] == "high (from the room)", lines["Priority"]
    assert db.query(ServiceRequest).count() == 0, "nothing is raised until confirmed"
    db.refresh(socket)
    assert socket.status == "working"
    assert timedelta(minutes=9) < action.expires_at - datetime.utcnow() <= timedelta(minutes=10)
    db.close()
    print("ok  preparing a fault report shows the card and writes no work order")


def test_confirming_runs_it_once():
    db, where, people, things = build()
    socket = things["sockets"][0]
    action = actions.propose(db, people["boss"], "prepare_fault_report",
                             {"fixture_id": socket.id, "description": "Dead socket behind the boom"})
    done = actions.confirm(db, people["boss"], action.id)
    assert done.status == "executed", (done.status, done.error)
    assert done.result["record"].startswith("SR-") and done.result["route"].startswith("/service-requests/")
    assert db.query(ServiceRequest).count() == 1
    db.refresh(socket)
    assert socket.status == "faulty" and socket.work_order_id == done.result["work_order_id"]

    again = actions.confirm(db, people["boss"], action.id)
    assert again.result == done.result and db.query(ServiceRequest).count() == 1, "a double click runs once"
    db.close()
    print("ok  confirming raises the work order through the real endpoint, and only once")


def test_cancelled_expired_tampered_and_foreign_proposals_do_not_run():
    db, where, people, things = build()
    socket = things["sockets"][1]
    propose = lambda: actions.propose(db, people["boss"], "prepare_fault_report",  # noqa: E731
                                      {"fixture_id": socket.id, "description": "Light flickering badly"})

    cancelled = propose()
    actions.cancel(db, people["boss"], cancelled.id)
    refused(lambda: actions.confirm(db, people["boss"], cancelled.id), 409)

    expired = propose()
    expired.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db.commit()
    refused(lambda: actions.confirm(db, people["boss"], expired.id), 410)
    assert db.get(AssistantAction, expired.id).status == ActionStatus.EXPIRED.value

    tampered = propose()
    tampered.payload = {**tampered.payload, "fixture_id": things["sockets"][2].id}
    db.commit()
    refused(lambda: actions.confirm(db, people["boss"], tampered.id), 409)

    theirs = propose()
    refused(lambda: actions.confirm(db, people["other_boss"], theirs.id), 404)
    refused(lambda: actions.cancel(db, people["other_boss"], theirs.id), 404)

    assert db.query(ServiceRequest).count() == 0
    db.close()
    print("ok  cancelled, expired, altered or someone else's proposals never run")


def test_a_booking_assigns_the_technician():
    db, where, people, things = build()
    action = actions.propose(db, people["boss"], "prepare_service_booking", {
        "asset_id": things["ahu"].id, "description": "Belt squeal on start-up",
        "priority": "high", "assigned_technician_id": people["sam"].id,
    })
    lines = {line["label"]: line["value"] for line in actions.card_of(action)["lines"]}
    assert lines["Assigned to"] == "Sam" and lines["Trade"] == "Mechanical / HVAC"
    done = actions.confirm(db, people["boss"], action.id)
    assert done.status == "executed", done.error
    order = db.query(ServiceRequest).one()
    assert order.equipment_id == things["ahu"].id and order.assigned_technician_id == people["sam"].id
    assert order.status == ServiceRequestStatus.ASSIGNED

    refused_tech = lambda: actions.propose(db, people["boss"], "prepare_service_booking", {  # noqa: E731
        "asset_id": things["ahu"].id, "description": "Belt squeal", "assigned_technician_id": people["manager"].id})
    try:
        refused_tech()
        raise AssertionError("a manager was accepted as a technician")
    except HTTPException as exc:
        assert "technician" in exc.detail
    db.close()
    print("ok  a service booking creates the work order and assigns the technician")


def test_an_inspection_frequency_is_set():
    """The one clock: how often an item is inspected, and when it is next due.

    There are no maintenance plans any more, so this is what "every quarter"
    means - the item's own frequency, which the visits are built from.
    """
    db, where, people, things = build()
    ahu = things["ahu"]
    # Category equipment: the inspection programme covers what has a name.
    ahu.name, ahu.equipment_type, ahu.building = "AHU 2", "Air handling unit", "Main block"
    db.commit()

    action = actions.propose(db, people["boss"], "prepare_inspection_schedule", {
        "asset_id": ahu.id, "frequency": "quarterly", "pm_task": "Quarterly filter change",
    })
    lines = {line["label"]: line["value"] for line in actions.card_of(action)["lines"]}
    assert lines["Every"] == "Quarterly" and lines["Maintenance when due"] == "Quarterly filter change"
    assert db.get(Equipment, ahu.id).pm_scheduling is None, "nothing is set until confirmed"

    done = actions.confirm(db, people["boss"], action.id)
    assert done.status == "executed", done.error
    db.refresh(ahu)
    assert ahu.pm_scheduling == "quarterly" and ahu.pm_task == "Quarterly filter change"
    assert ahu.next_generated_pm_date is not None
    assert db.query(MaintenanceSchedule).count() == 0, "no plan is created: the item is the schedule"

    refused(lambda: actions.propose(db, people["boss"], "prepare_inspection_schedule", {
        "asset_id": ahu.id, "frequency": "fortnightly"}), 422)
    db.close()
    print("ok  Phia sets an item's inspection frequency, and no maintenance plan is created")


def test_a_work_order_update_follows_the_workflow():
    db, where, people, things = build()
    raise_it = actions.propose(db, people["boss"], "prepare_fault_report",
                               {"fixture_id": things["sockets"][0].id, "description": "Dead socket"})
    order_id = actions.confirm(db, people["boss"], raise_it.id).result["work_order_id"]

    try:
        actions.propose(db, people["boss"], "prepare_work_order_update",
                        {"work_order_id": order_id, "status": "completed"})
        raise AssertionError("a new work order was allowed straight to completed")
    except HTTPException as exc:
        assert "can move to" in exc.detail and "assigned" in exc.detail, exc.detail

    update = actions.propose(db, people["boss"], "prepare_work_order_update", {
        "work_order_id": order_id, "assigned_technician_id": people["sam"].id,
        "note": "Isolated at panel EM-3, awaiting parts",
    })
    lines = {line["label"]: line["value"] for line in actions.card_of(update)["lines"]}
    assert lines["Assign to"] == "Sam" and "Isolated" in lines["Add note"]
    done = actions.confirm(db, people["boss"], update.id)
    assert done.status == "executed", done.error
    order = db.get(ServiceRequest, order_id)
    db.refresh(order)
    assert order.assigned_technician_id == people["sam"].id and order.status == ServiceRequestStatus.ASSIGNED
    assert any(h.get("action") == "service_note"
               and (h.get("changes") or {}).get("note") == "Isolated at panel EM-3, awaiting parts"
               for h in (order.history or [])), order.history
    db.close()
    print("ok  a work order update respects the workflow, assigns and adds the note")


def test_bad_requests_are_refused_before_anything_is_stored():
    db, where, people, things = build()
    for name, arguments, expect in (
        ("prepare_fault_report", {"location_id": where["or2"].id, "description": "Leak from ceiling"}, "trade"),
        ("prepare_fault_report", {"description": "No target given"}, "exactly one"),
        ("prepare_fault_report", {"fixture_id": things["sockets"][0].id, "description": "x"}, "5 characters"),
        ("prepare_fault_report", {"fixture_id": things["sockets"][0].id, "description": "Dead socket",
                                  "delete_everything": True}, "Unexpected"),
        ("prepare_everything", {}, "Unknown action"),
    ):
        try:
            actions.propose(db, people["boss"], name, arguments)
            raise AssertionError(f"{name} {arguments} was accepted")
        except HTTPException as exc:
            assert expect in exc.detail, (expect, exc.detail)
    # A site-scoped user cannot prepare work on another hospital's fixture.
    try:
        actions.propose(db, people["manager"], "prepare_fault_report",
                        {"fixture_id": things["theirs"].id, "description": "Dead socket over there"})
        raise AssertionError("prepared work on another site")
    except HTTPException:
        pass
    assert db.query(AssistantAction).count() == 0
    db.close()
    print("ok  bad or out-of-site requests are refused and store nothing")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"\n{len(tests)} checks passed")
