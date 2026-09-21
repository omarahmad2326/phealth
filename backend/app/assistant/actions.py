"""Actions the assistant can prepare for a person to confirm.

The changes a person makes on the everyday screens: add equipment to a
category or change its details (its department, what one item cost), raise a
service job or update one (status, labour and parts cost), report a fault, book
an asset for service, set how often something is inspected, schedule an
inspection visit, inspect one item now, clear a red tag, add a department or a
vehicle, register a site, and update a work order. Each touches one record.
Deleting, bulk changes, ledger entries and anything about users or permissions
stay on their own screens, with their own previews; so does marking a job as
major work, which posts to the ledger.

Every action has two halves:

* ``prepare`` checks the target exists within the person's sites and that they
  may do this, resolves everything to ids, and builds the confirmation card.
  Nothing is written except the proposal itself.
* ``execute`` runs on Confirm by calling the endpoint function the screen
  calls, as that person. Numbering, response deadlines, notifications and
  history therefore happen exactly as they would from the screen, and there is
  no second write path to drift out of step.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Optional

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.assistant.tools.base import ToolContext, ToolInputError
from app.models.assistant_action import ActionStatus, AssistantAction
from app.models.discipline import Discipline
from app.models.equipment import Equipment
from app.models.fixture import Fixture
from app.models.location import Location
from app.models.service_request import Priority, ServiceRequest, ServiceRequestStatus
from app.models.user import User, UserRole
from app.utils.clock import utc_today

logger = logging.getLogger("assistant.actions")

PROPOSAL_LIFETIME = timedelta(minutes=10)
PRIORITIES = [p.value for p in Priority]


@dataclass
class Prepared:
    payload: dict[str, Any]
    title: str
    lines: list[tuple[str, str]]
    facility_id: Optional[int]
    warnings: list[str]


@dataclass(frozen=True)
class ActionDefinition:
    name: str
    description: str
    parameters: dict[str, Any]
    module: str
    permission: str
    prepare: Callable[[ToolContext, dict[str, Any]], Prepared]
    execute: Callable[[Session, User, dict[str, Any]], dict[str, Any]]

    def tool_schema(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.parameters}


# ── shared lookups ───────────────────────────────────────────────────────────

def _within_sites(ctx: ToolContext, facility_id: int, what: str) -> None:
    allowed = ctx.facility_ids()
    if allowed is not None and facility_id not in allowed:
        raise ToolInputError("No {} with that id.".format(what))


def _space(ctx: ToolContext, location_id: Optional[int]) -> Optional[Location]:
    if not location_id:
        return None
    space = ctx.db.get(Location, location_id)
    if space is None or not space.is_active:
        raise ToolInputError("No space with id {}.".format(location_id))
    _within_sites(ctx, space.facility_id, "space")
    return space


def _label(space: Optional[Location]) -> str:
    if space is None:
        return "Not placed"
    return "{} · {}".format(space.code, space.name) if space.name else space.code


def _trade_name(ctx: ToolContext, discipline_id: Optional[int]) -> str:
    if not discipline_id:
        return "Not set"
    row = ctx.db.query(Discipline.name).filter(Discipline.id == discipline_id).first()
    return row[0] if row else "Not set"


def _trade_id(ctx: ToolContext, code: Optional[str]) -> Optional[int]:
    if not code:
        return None
    row = ctx.db.query(Discipline.id).filter(Discipline.code == code).first()
    if row is None:
        raise ToolInputError("Unknown trade '{}'.".format(code))
    return row[0]


def _technician(ctx: ToolContext, user_id: Optional[int]) -> Optional[User]:
    if not user_id:
        return None
    person = ctx.db.get(User, user_id)
    if person is None or not person.is_active or person.role != UserRole.TECHNICIAN:
        raise ToolInputError("No active technician with id {}. Find one with search_users.".format(user_id))
    return person


def _priority(value: Optional[str]) -> Optional[str]:
    if value in (None, ""):
        return None
    if value not in PRIORITIES:
        raise ToolInputError("Priority must be one of: {}.".format(", ".join(PRIORITIES)))
    return value


def _description(value: Optional[str]) -> str:
    text = (value or "").strip()
    if len(text) < 5:
        raise ToolInputError("Say what is wrong in a few words (at least 5 characters).")
    return text[:2000]


def _asset(ctx: ToolContext, asset_id: Optional[int]) -> Equipment:
    asset = ctx.db.get(Equipment, asset_id) if asset_id else None
    if asset is None:
        raise ToolInputError("No asset with that id. Resolve it with resolve_entity(kind=asset).")
    _within_sites(ctx, asset.facility_id, "asset")
    return asset


# ── report a fault ───────────────────────────────────────────────────────────

def _prepare_fault(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.services import fixture_catalog
    from app.services import work_order as work_order_service

    description = _description(args.get("description"))
    priority = _priority(args.get("priority"))
    out_of_service = bool(args.get("takes_room_out_of_service", False))
    targets = [k for k in ("fixture_id", "asset_id", "location_id") if args.get(k)]
    if len(targets) != 1:
        raise ToolInputError("Name exactly one of fixture_id, asset_id or location_id.")

    warnings: list[str] = []
    if args.get("fixture_id"):
        fixture = ctx.db.get(Fixture, args["fixture_id"])
        if fixture is None or not fixture.is_active:
            raise ToolInputError("No fixture with that id. Find it with search_fixtures.")
        _within_sites(ctx, fixture.facility_id, "fixture")
        space = ctx.db.get(Location, fixture.location_id)
        label = fixture_catalog.BY_TYPE.get(fixture.fixture_type, {}).get("label") or fixture.fixture_type
        if fixture.work_order_id:
            open_order = ctx.db.get(ServiceRequest, fixture.work_order_id)
            if open_order and open_order.status not in (ServiceRequestStatus.COMPLETED, ServiceRequestStatus.CANCELLED):
                warnings.append("{} already has an open work order, {}.".format(fixture.code, open_order.request_number))
        payload = {"kind": "fixture", "fixture_id": fixture.id, "description": description,
                   "priority": priority, "takes_room_out_of_service": out_of_service}
        what = "{} · {}".format(fixture.code, label)
        trade = _trade_name(ctx, fixture.discipline_id)
        facility_id = fixture.facility_id
    elif args.get("asset_id"):
        asset = _asset(ctx, args["asset_id"])
        space = ctx.db.get(Location, asset.location_id) if asset.location_id else None
        payload = {"kind": "asset", "asset_id": asset.id, "description": description,
                   "priority": priority, "takes_room_out_of_service": out_of_service}
        what = "{} · {}".format(asset.asset_tag, asset.type_label or " ".join(
            p for p in (asset.make, asset.model) if p) or "asset")
        trade = _trade_name(ctx, asset.discipline_id)
        facility_id = asset.facility_id
    else:
        space = _space(ctx, args["location_id"])
        trade_id = _trade_id(ctx, args.get("trade"))
        if trade_id is None:
            raise ToolInputError("A fault on a room needs the trade it goes to (trade).")
        payload = {"kind": "space", "location_id": space.id, "discipline_id": trade_id,
                   "description": description, "priority": priority,
                   "takes_room_out_of_service": out_of_service}
        what = "The room itself"
        trade = _trade_name(ctx, trade_id)
        facility_id = space.facility_id

    shown_priority = priority or "{} (from the room)".format(work_order_service.default_priority(space))
    return Prepared(
        payload=payload,
        title="Raise a work order",
        lines=[("What", what), ("Where", _label(space)), ("Goes to", trade),
               ("Priority", shown_priority), ("Problem", description),
               ("Takes the room out of service", "Yes" if out_of_service else "No")],
        facility_id=facility_id,
        warnings=warnings,
    )


def _execute_fault(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    if payload["kind"] == "fixture":
        from app.api.v1.endpoints.fixtures import report_fault
        from app.schemas.fixture import ReportFaultRequest

        created = report_fault(payload["fixture_id"], ReportFaultRequest(
            description=payload["description"], priority=payload.get("priority"),
            takes_out_of_service=payload["takes_room_out_of_service"],
        ), db=db, current_user=user)
        return _work_order_result(created.work_order_id, created.request_number, "raised")

    from app.api.v1.endpoints.service_requests import create_service_request
    from app.schemas.service_request import ServiceRequestCreate

    if payload["kind"] == "asset":
        asset = db.get(Equipment, payload["asset_id"])
        body = ServiceRequestCreate(
            facility_id=asset.facility_id, equipment_id=asset.id,
            problem_description=payload["description"], priority=payload.get("priority"),
            takes_space_out_of_service=payload["takes_room_out_of_service"],
        )
    else:
        space = db.get(Location, payload["location_id"])
        body = ServiceRequestCreate(
            facility_id=space.facility_id, location_id=space.id, discipline_id=payload["discipline_id"],
            problem_description=payload["description"], priority=payload.get("priority"),
            takes_space_out_of_service=payload["takes_room_out_of_service"],
        )
    created = create_service_request(body, db=db, current_user=user)
    return _work_order_result(_get(created, "id"), _get(created, "request_number"), "raised")


def _get(record: Any, key: str) -> Any:
    """A field from an endpoint response, whether it returned a model or a dict."""
    return record.get(key) if isinstance(record, dict) else getattr(record, key, None)


def _work_order_result(order_id: int, number: str, verb: str) -> dict[str, Any]:
    return {"message": "Work order {} {}.".format(number, verb), "record": number,
            "route": "/service-requests/{}".format(order_id), "work_order_id": order_id}


# ── book an asset for service ────────────────────────────────────────────────

def _prepare_booking(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    asset = _asset(ctx, args.get("asset_id"))
    description = _description(args.get("description"))
    priority = _priority(args.get("priority")) or "medium"
    technician = _technician(ctx, args.get("assigned_technician_id"))
    space = ctx.db.get(Location, asset.location_id) if asset.location_id else None
    warnings = []
    if technician is None:
        warnings.append("No technician named: it will wait in the queue to be assigned.")
    return Prepared(
        payload={"asset_id": asset.id, "description": description, "priority": priority,
                 "assigned_technician_id": technician.id if technician else None},
        title="Book {} in for service".format(asset.asset_tag),
        lines=[("Asset", "{} · {}".format(asset.asset_tag, asset.type_label or " ".join(
                   p for p in (asset.make, asset.model) if p) or "asset")),
               ("Where", _label(space)), ("Trade", _trade_name(ctx, asset.discipline_id)),
               ("What needs doing", description), ("Priority", priority),
               ("Assigned to", technician.full_name if technician else "Not yet")],
        facility_id=asset.facility_id,
        warnings=warnings,
    )


def _execute_booking(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.service_requests import create_service_request, update_service_request
    from app.schemas.service_request import ServiceRequestCreate, ServiceRequestUpdate

    asset = db.get(Equipment, payload["asset_id"])
    created = create_service_request(ServiceRequestCreate(
        facility_id=asset.facility_id, equipment_id=asset.id, location_id=asset.location_id,
        problem_description=payload["description"], priority=payload["priority"],
    ), db=db, current_user=user)
    result = _work_order_result(_get(created, "id"), _get(created, "request_number"), "booked")
    if payload.get("assigned_technician_id"):
        # The same two steps the asset page takes: create, then assign. The work
        # order exists once the first succeeds, so a failed assignment is said
        # plainly rather than reported as the booking having failed.
        try:
            update_service_request(_get(created, "id"), ServiceRequestUpdate(
                assigned_technician_id=payload["assigned_technician_id"], status="assigned",
            ), db=db, current_user=user)
        except HTTPException as exc:
            db.rollback()
            result["message"] = "Work order {} booked, but not assigned: {}".format(
                _get(created, "request_number"), exc.detail)
    return result


# ── put an item on its inspection clock ──────────────────────────────────────

def _prepare_schedule(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.models.department import Department
    from app.services import inspection_programme as programme
    from app.services import site_categories

    asset = _category_item(ctx, args.get("asset_id"))
    frequency, interval = programme.frequency_or_422(args.get("frequency"), args.get("interval_days"))
    if frequency is None:
        raise ToolInputError("Say how often it is inspected: {}.".format(", ".join(programme.FREQUENCIES)))
    first_due = _date_arg(args["first_due_on"], "first_due_on") if args.get("first_due_on") else None
    if first_due is None:
        first_due = programme.next_due(asset.last_pm_date or utc_today(), frequency, interval)
    task = (args.get("pm_task") or "").strip()[:500] or None
    person = None
    if args.get("assigned_to_id"):
        from app.services import equipment_jobs

        person = next((u for u in equipment_jobs.assignable_users(ctx.db, asset.facility_id)
                       if u.id == args["assigned_to_id"]), None)
        if person is None:
            raise ToolInputError("That person cannot be given work at this site. Find someone with search_users.")

    department = ctx.db.get(Department, asset.department_id) if asset.department_id else None
    warnings: list[str] = []
    if department is None:
        warnings.append("It is not in a department yet, so it will not be part of any visit until it is.")
    was = programme.schedule_of(asset)
    if was["frequency"]:
        warnings.append("It is currently inspected {} ({}).".format(
            was["frequency_label"].lower(), was["next_due_on"] or "no date"))

    return Prepared(
        payload={"asset_id": asset.id, "frequency": frequency, "interval_days": interval,
                 "first_due_on": first_due.isoformat() if first_due else None,
                 "pm_task": task, "assigned_to_id": person.id if person else None},
        title="Inspect {} {}".format(asset.name, programme.FREQUENCIES[frequency].lower()),
        lines=[("Equipment", "{} · {}".format(asset.name, asset.asset_tag)),
               ("Department", department.name if department else "Not in a department"),
               ("Where", site_categories.location_label(asset) or "Not recorded"),
               ("Every", programme.FREQUENCIES[frequency] + (" ({} days)".format(interval) if interval else "")),
               ("Next due", first_due.isoformat() if first_due else "Not set"),
               ("Maintenance when due", task or "Not described"),
               ("Assigned to", person.full_name if person else "Nobody")],
        facility_id=asset.facility_id,
        warnings=warnings,
    )


def _execute_schedule(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.inspection_programme import set_item_schedule
    from app.schemas.inspection_programme import ItemScheduleIn

    item = set_item_schedule(payload["asset_id"], ItemScheduleIn(
        frequency=payload["frequency"], interval_days=payload.get("interval_days"),
        first_due_on=date.fromisoformat(payload["first_due_on"]) if payload.get("first_due_on") else None,
        pm_task=payload.get("pm_task"), pm_assignee_id=payload.get("assigned_to_id"),
    ), db=db, current_user=user)
    return {"message": "{} is now inspected {} · next due {}.".format(
                item["name"], item["frequency_label"].lower(), item["next_due_on"] or "not set"),
            "record": item["name"], "route": "/departments", "equipment_id": item["id"],
            "facility_id": db.get(Equipment, payload["asset_id"]).facility_id}


# ── update a work order ──────────────────────────────────────────────────────

def _prepare_update(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.api.v1.endpoints.service_requests import VALID_TRANSITIONS
    from app.services import equipment_jobs

    order = ctx.db.get(ServiceRequest, args.get("work_order_id")) if args.get("work_order_id") else None
    if order is None:
        raise ToolInputError("No work order with that id. Resolve it with resolve_entity(kind=service_request).")
    _within_sites(ctx, order.facility_id, "work order")
    # A service or inspection has its own statuses, costs and result; moving it
    # through the general workflow would skip them.
    if order.work_order_type in equipment_jobs.KIND_OF_TYPE and order.equipment and order.equipment.name:
        raise ToolInputError("{} is a {} under Equipment Maintenance: change it with "
                             "prepare_equipment_job_update (job_id={}).".format(
                                 order.request_number, equipment_jobs.KIND_OF_TYPE[order.work_order_type], order.id))

    payload: dict[str, Any] = {"work_order_id": order.id}
    lines: list[tuple[str, str]] = [("Work order", "{} · {}".format(order.request_number,
                                                                     (order.problem_description or "")[:80]))]
    current = order.status if isinstance(order.status, ServiceRequestStatus) else ServiceRequestStatus(order.status)

    status = args.get("status")
    if status:
        try:
            wanted = ServiceRequestStatus(status)
        except ValueError:
            raise ToolInputError("Unknown status '{}'.".format(status))
        if wanted != current and wanted not in VALID_TRANSITIONS.get(current, []):
            allowed = ", ".join(s.value for s in VALID_TRANSITIONS.get(current, [])) or "none - it is closed"
            raise ToolInputError("A work order that is {} can move to: {}.".format(current.value, allowed))
        if wanted != current:
            payload["status"] = wanted.value
            lines.append(("Status", "{} → {}".format(current.value.replace("_", " "), wanted.value.replace("_", " "))))
    technician = _technician(ctx, args.get("assigned_technician_id"))
    if technician:
        payload["assigned_technician_id"] = technician.id
        lines.append(("Assign to", technician.full_name))
    priority = _priority(args.get("priority"))
    if priority and priority != getattr(order.priority, "value", order.priority):
        payload["priority"] = priority
        lines.append(("Priority", "{} → {}".format(getattr(order.priority, "value", order.priority), priority)))
    note = (args.get("note") or "").strip()
    if note:
        payload["note"] = note[:2000]
        lines.append(("Add note", note[:2000]))
    if len(payload) == 1:
        raise ToolInputError("Say what to change: status, assigned_technician_id, priority or a note.")
    return Prepared(payload=payload, title="Update {}".format(order.request_number), lines=lines,
                    facility_id=order.facility_id, warnings=[])


def _execute_update(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.service_requests import add_service_request_note, update_service_request
    from app.schemas.service_request import ServiceRequestNoteCreate, ServiceRequestUpdate

    order_id = payload["work_order_id"]
    changes = {k: payload[k] for k in ("status", "assigned_technician_id", "priority") if k in payload}
    if "assigned_technician_id" in changes and "status" not in changes:
        order = db.get(ServiceRequest, order_id)
        if order.status == ServiceRequestStatus.NEW:
            changes["status"] = "assigned"
    updated = None
    if changes:
        updated = update_service_request(order_id, ServiceRequestUpdate(**changes), db=db, current_user=user)
    if payload.get("note"):
        updated = add_service_request_note(order_id, ServiceRequestNoteCreate(note=payload["note"]),
                                           db=db, current_user=user)
    number = _get(updated, "request_number") or db.get(ServiceRequest, order_id).request_number
    return _work_order_result(order_id, number, "updated")


# ── raise a service or inspection job ────────────────────────────────────────

def _prepare_equipment_job(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.services import equipment_jobs, site_categories

    asset = _asset(ctx, args.get("asset_id"))
    if asset.name is None:
        raise ToolInputError("That asset is not in a site category. Find it with category_equipment.")
    kind = args.get("kind") or "service"
    if kind == "inspection":
        # Inspections are no longer jobs: each item is inspected on its own
        # schedule, and a job of that kind would sit where no screen shows it.
        raise ToolInputError("Inspections are not raised as jobs any more. To inspect this item now use "
                             "prepare_inspect_now; to schedule a visit use prepare_inspection_visit.")
    if kind not in equipment_jobs.KINDS:
        raise ToolInputError("kind is service.")
    title = _description(args.get("what_needs_doing"))[:500]
    due_on = None
    if args.get("due_on"):
        try:
            due_on = date.fromisoformat(str(args["due_on"]))
        except ValueError:
            raise ToolInputError("due_on must be YYYY-MM-DD.")
    person = None
    if args.get("assigned_to_id"):
        person = next((u for u in equipment_jobs.assignable_users(ctx.db, asset.facility_id)
                       if u.id == args["assigned_to_id"]), None)
        if person is None:
            raise ToolInputError("That person cannot be given jobs at this site. Find someone with search_users.")
    code = next((c for c, pk in site_categories.ensure_disciplines(ctx.db).items() if pk == asset.discipline_id), None)
    warnings = [] if person else ["Nobody is assigned: it will show as open until someone takes it."]
    return Prepared(
        payload={"asset_id": asset.id, "kind": kind, "title": title,
                 "due_on": due_on.isoformat() if due_on else None,
                 "assigned_to_id": person.id if person else None},
        title="Raise a {} on {}".format(kind, asset.name),
        lines=[("Equipment", "{} · {}".format(asset.name, asset.asset_tag)),
               ("Category", site_categories.BY_CODE[code].name if code else "Not set"),
               ("Where", site_categories.location_label(asset) or "Not recorded"),
               ("What needs doing", title),
               ("Due", due_on.isoformat() if due_on else "No date"),
               ("Assigned to", person.full_name if person else "Nobody yet")],
        facility_id=asset.facility_id,
        warnings=warnings,
    )


def _execute_equipment_job(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.equipment_maintenance import create_job
    from app.schemas.site_categories import EquipmentJobCreate

    asset = db.get(Equipment, payload["asset_id"])
    job = create_job(EquipmentJobCreate(
        facility_id=asset.facility_id, kind=payload["kind"], equipment_id=asset.id, title=payload["title"],
        due_on=date.fromisoformat(payload["due_on"]) if payload.get("due_on") else None,
        assigned_to_id=payload.get("assigned_to_id"),
    ), db=db, current_user=user)
    return {"message": "{} {} raised on {}.".format(payload["kind"].capitalize(), job["number"], asset.name),
            "record": job["number"], "route": "/service",
            "work_order_id": job["id"], "facility_id": asset.facility_id}


# ── equipment under Facility ─────────────────────────────────────────────────

def _money_arg(value: Any, what: str) -> Decimal:
    """An amount as a model sends it: 45000, "45000", "45,000" or "$45,000"."""
    text = re.sub(r"[^\d.\-]", "", str(value))
    try:
        amount = Decimal(text).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise ToolInputError("{} must be an amount, e.g. 45000.".format(what))
    if amount < 0:
        raise ToolInputError("{} cannot be negative.".format(what))
    return amount


def _date_arg(value: Any, what: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise ToolInputError("{} must be YYYY-MM-DD.".format(what))


def _dollars(value: Any) -> str:
    if value is None:
        return "Not recorded"
    text = "${:,.2f}".format(Decimal(str(value)))
    return text[:-3] if text.endswith(".00") else text


def _checked(schema: type, fields: dict[str, Any]) -> None:
    """Refuse what the screen's own form would refuse, while it can still be corrected."""
    try:
        schema(**fields)
    except ValidationError as exc:
        problems = ["{}: {}".format(".".join(str(p) for p in error["loc"]), error["msg"]) for error in exc.errors()]
        raise ToolInputError("Not accepted - " + "; ".join(problems))


def _category_code(ctx: ToolContext, asset: Equipment) -> Optional[str]:
    from app.services import site_categories

    return next((c for c, pk in site_categories.ensure_disciplines(ctx.db).items() if pk == asset.discipline_id), None)


def _category_item(ctx: ToolContext, asset_id: Any) -> Equipment:
    asset = _asset(ctx, asset_id)
    if asset.name is None:
        raise ToolInputError("{} is not under Facility yet. It is added to a category from the Asset Register "
                             "with Add to a category.".format(asset.asset_tag))
    return asset


def _site(ctx: ToolContext, facility_id: Any):
    from app.models.facility import Facility

    if not facility_id:
        allowed = ctx.facility_ids()
        if allowed is not None and len(allowed) == 1:
            facility_id = next(iter(allowed))
        else:
            raise ToolInputError("Say which site: pass facility_id (the site the person is working in).")
    site = ctx.db.get(Facility, facility_id)
    if site is None:
        raise ToolInputError("No site with that id.")
    _within_sites(ctx, site.id, "site")
    return site


_EQUIPMENT_TEXT = {"name": 160, "type": 80, "building": 120, "floor": 80, "spot": 255,
                   "make": 120, "model": 120, "notes": 4000}


def _equipment_fields(ctx: ToolContext, args: dict[str, Any], facility_id: int) -> dict[str, Any]:
    """The form's fields from a model's arguments, tidied the way the form tidies them."""
    from app.services import site_categories

    fields: dict[str, Any] = {}
    for key in _EQUIPMENT_TEXT:
        if key in args:
            value = site_categories.tidy(str(args[key]))
            if value is not None:
                if key in ("building", "floor"):
                    value = site_categories.match_existing_spelling(ctx.db, facility_id, key, value)
                fields[key] = value
    if "category" in args:
        if args["category"] not in site_categories.BY_CODE:
            raise ToolInputError("category is one of: {}.".format(", ".join(site_categories.BY_CODE)))
        fields["category"] = args["category"]
    if "status" in args:
        if args["status"] not in site_categories.CONDITIONS:
            raise ToolInputError("status is one of: {}.".format(", ".join(site_categories.CONDITIONS)))
        fields["condition"] = args["status"]
    if "quantity" in args:
        if not isinstance(args["quantity"], int) or not 1 <= args["quantity"] <= 100000:
            raise ToolInputError("quantity must be a whole number from 1.")
        fields["quantity"] = args["quantity"]
    if "unit_cost" in args:
        fields["unit_cost"] = str(_money_arg(args["unit_cost"], "unit_cost"))
    if "in_service_on" in args:
        fields["in_service_on"] = _date_arg(args["in_service_on"], "in_service_on").isoformat()
    if "useful_life_years" in args:
        try:
            life = Decimal(str(args["useful_life_years"])).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError):
            raise ToolInputError("useful_life_years must be a number of years.")
        fields["useful_life_years"] = str(life)
    return fields


def _place(building: Optional[str], floor: Optional[str], spot: Optional[str]) -> str:
    return " · ".join(part for part in (building, floor, spot) if part) or "Not recorded"


def _department_named(ctx: ToolContext, facility_id: int, name: Any):
    """The site's department by the name the person used: an exact match, or
    the only one whose name contains it."""
    from app.models.department import Department

    if name in (None, ""):
        return None
    wanted = str(name).strip().lower()
    departments = ctx.db.query(Department).filter(Department.facility_id == facility_id).all()
    exact = [row for row in departments if row.name.strip().lower() == wanted]
    if exact:
        return exact[0]
    partial = [row for row in departments if wanted in row.name.lower()]
    if len(partial) == 1:
        return partial[0]
    names = ", ".join(sorted(row.name for row in departments)) or "none yet"
    raise ToolInputError("No single department called '{}' at this site. Its departments: {}.".format(name, names))


def _prepare_add_equipment(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.api.v1.endpoints.site_categories import MAX_TOTAL_COST
    from app.schemas.site_categories import CategoryEquipmentCreate
    from app.services import site_categories

    site = _site(ctx, args.get("facility_id"))
    fields = _equipment_fields(ctx, args, site.id)
    missing = [label for key, label in (("category", "category"), ("name", "name"), ("type", "type"))
               if not fields.get(key)]
    if missing:
        raise ToolInputError("New equipment needs its {}. Ask the person for it.".format(", ".join(missing)))
    department = _department_named(ctx, site.id, args.get("department"))
    if department is not None:
        fields["department_id"] = department.id
    category = site_categories.BY_CODE[fields.pop("category")]
    fields.setdefault("quantity", 1)
    fields.setdefault("condition", "working")
    _checked(CategoryEquipmentCreate, {"facility_id": site.id, **fields})
    total = site_categories.total_cost(Decimal(fields["unit_cost"]), fields["quantity"]) \
        if "unit_cost" in fields else None
    if total is not None and total > MAX_TOTAL_COST:
        raise ToolInputError("The total cost is too large to record.")

    warnings: list[str] = []
    ids = site_categories.ensure_disciplines(ctx.db)
    same_name = (
        site_categories.items_query(ctx.db, site.id, ids[category.code])
        .filter(func.lower(Equipment.name) == fields["name"].lower())
        .first()
    )
    if same_name is not None:
        warnings.append("{} already has a {} ({}, {}).".format(
            category.name, same_name.name, same_name.asset_tag, site_categories.location_label(same_name) or "no place"))
    if total is None:
        warnings.append("No purchase cost given, so it will show no book value until one is added.")

    quantity = fields["quantity"]
    life = fields.get("useful_life_years")
    lines = [
        ("Site", site.name), ("Category", category.name), ("Name", fields["name"]), ("Type", fields["type"]),
        ("Department", department.name if department is not None else "Not in a department"),
        ("Quantity", str(quantity)), ("Status", site_categories.CONDITIONS[fields["condition"]]),
    ]
    if fields.get("building") or fields.get("floor") or fields.get("spot"):
        lines.append(("Where", _place(fields.get("building"), fields.get("floor"), fields.get("spot"))))
    if fields.get("make") or fields.get("model"):
        lines.append(("Make and model", " ".join(p for p in (fields.get("make"), fields.get("model")) if p)))
    if total is not None:
        lines.append(("Purchase cost", _dollars(total) if quantity == 1 else "{} each, {} in all".format(
            _dollars(fields["unit_cost"]), _dollars(total))))
    if fields.get("in_service_on"):
        lines.append(("In service since", fields["in_service_on"]))
    lines.append(("Useful life", "{} years".format(Decimal(life).normalize()) if life else
                  "{} years ({} default)".format(site_categories.default_useful_life(category.code), category.name)))
    if fields.get("notes"):
        lines.append(("Notes", fields["notes"]))
    return Prepared(
        payload={"facility_id": site.id, "category": category.code, **fields},
        title="Add {} to {}".format(fields["name"], category.name),
        lines=lines, facility_id=site.id, warnings=warnings,
    )


def _execute_add_equipment(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.site_categories import add_category_equipment
    from app.schemas.site_categories import CategoryEquipmentCreate

    fields = dict(payload)
    code = fields.pop("category")
    created = add_category_equipment(code, CategoryEquipmentCreate(**fields), db=db, current_user=user)
    return {"message": "{} added to {} as {}.".format(created["name"], created["category_name"], created["asset_tag"]),
            "record": created["asset_tag"], "route": "/categories/{}".format(code),
            "equipment_id": created["id"], "facility_id": payload["facility_id"]}


def _prepare_equipment_update(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.api.v1.endpoints.site_categories import MAX_TOTAL_COST
    from app.schemas.site_categories import CategoryEquipmentUpdate
    from app.services import site_categories

    asset = _category_item(ctx, args.get("asset_id"))
    code = _category_code(ctx, asset)
    wanted = _equipment_fields(ctx, {k: v for k, v in args.items() if k not in ("asset_id", "department")},
                               asset.facility_id)
    # Moving it to another department, or out of any.
    from app.models.department import Department

    current_department = ctx.db.get(Department, asset.department_id) if asset.department_id else None
    new_department = current_department
    if "department" in args:
        text = str(args["department"]).strip()
        new_department = None if text.lower() in _NO_DEPARTMENT else _department_named(ctx, asset.facility_id, text)
    value = site_categories.value_facts(ctx.db, [asset]).get(asset.id) or {}
    current: dict[str, Any] = {
        "category": code, "name": asset.name, "type": asset.equipment_type, "building": asset.building,
        "floor": asset.floor, "spot": asset.location, "quantity": asset.quantity or 1,
        "condition": asset.condition or "working", "make": asset.make or None, "model": asset.model or None,
        "notes": asset.description,
        "unit_cost": str(site_categories.unit_cost(asset)) if asset.cost is not None else None,
        "in_service_on": value.get("in_service_on").isoformat() if value.get("in_service_on") else None,
        "useful_life_years": str(Decimal(str(asset.useful_life_years)).quantize(Decimal("0.01")))
        if asset.useful_life_years is not None else None,
    }
    changes = {k: v for k, v in wanted.items() if str(v) != str(current.get(k))}
    moved = (new_department.id if new_department else None) != (current_department.id if current_department else None)
    if moved:
        changes["department_id"] = new_department.id if new_department else None
    if not changes:
        raise ToolInputError("Nothing to change: {} already has those details. Say what should change.".format(asset.name))
    _checked(CategoryEquipmentUpdate, changes)
    quantity = changes.get("quantity", current["quantity"])
    unit = changes.get("unit_cost", current["unit_cost"])
    if unit is not None and site_categories.total_cost(Decimal(unit), quantity) > MAX_TOTAL_COST:
        raise ToolInputError("The total cost is too large to record.")

    labels = {"category": "Category", "name": "Name", "type": "Type", "building": "Building", "floor": "Floor",
              "spot": "Room / exact spot", "quantity": "Quantity", "condition": "Status", "make": "Make",
              "model": "Model", "notes": "Notes", "unit_cost": "Cost of one item",
              "in_service_on": "In service since", "useful_life_years": "Useful life (years)"}

    def shown(key: str, raw: Any) -> str:
        if raw in (None, ""):
            return "Not recorded"
        if key == "category":
            return site_categories.BY_CODE[raw].name
        if key == "condition":
            return site_categories.CONDITIONS[raw]
        if key == "unit_cost":
            return _dollars(raw)
        if key == "useful_life_years":
            return str(Decimal(str(raw)).normalize())
        return str(raw)

    lines = [("Equipment", "{} · {}".format(asset.name, asset.asset_tag))]
    if moved:
        lines.append(("Department", "{} → {}".format(
            current_department.name if current_department else "Not in a department",
            new_department.name if new_department else "Not in a department")))
    else:
        lines.append(("Department", current_department.name if current_department else "Not in a department"))
    lines += [(labels[k], "{} → {}".format(shown(k, current.get(k)), shown(k, v)))
              for k, v in changes.items() if k != "department_id"]
    if moved and new_department is not None:
        from app.services import inspection_programme as programme

        if not programme.forms_for(ctx.db, department_id=new_department.id):
            warnings_moved = ["{} has no inspection form yet.".format(new_department.name)]
        else:
            warnings_moved = []
    else:
        warnings_moved = []
    warnings: list[str] = list(warnings_moved)
    if "unit_cost" in changes or "quantity" in changes:
        if unit is not None:
            lines.append(("Purchase cost in all", _dollars(site_categories.total_cost(Decimal(unit), quantity))))
    if {"unit_cost", "in_service_on", "useful_life_years", "quantity"} & set(changes):
        warnings.append("Its book value is worked out again from the new figures.")
    if changes.get("condition") == "out_of_service":
        from app.services.site_categories import job_facts
        open_jobs = (job_facts(ctx.db, [asset.id]).get(asset.id) or {}).get("open_jobs", 0)
        if open_jobs:
            warnings.append("It has {} open job{}.".format(open_jobs, "s" if open_jobs != 1 else ""))
    return Prepared(
        payload={"asset_id": asset.id, "changes": changes},
        title="Change {}".format(asset.name), lines=lines, facility_id=asset.facility_id, warnings=warnings,
    )


def _execute_equipment_update(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.site_categories import update_category_equipment
    from app.schemas.site_categories import CategoryEquipmentUpdate

    updated = update_category_equipment(payload["asset_id"], CategoryEquipmentUpdate(**payload["changes"]),
                                        db=db, current_user=user)
    return {"message": "{} updated.".format(updated["name"]), "record": updated["asset_tag"],
            "route": "/categories/{}".format(updated["category"]), "equipment_id": updated["id"],
            "facility_id": db.get(Equipment, payload["asset_id"]).facility_id}


# ── update a service or inspection job ───────────────────────────────────────

def _prepare_job_update(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.schemas.site_categories import EquipmentJobUpdate
    from app.services import equipment_jobs, site_categories

    job = ctx.db.get(ServiceRequest, args.get("job_id")) if args.get("job_id") else None
    if job is None or job.work_order_type not in equipment_jobs.KIND_OF_TYPE:
        raise ToolInputError("No service or inspection job with that id. Find it with equipment_jobs (job_id).")
    _within_sites(ctx, job.facility_id, "job")
    kind = equipment_jobs.KIND_OF_TYPE[job.work_order_type]

    wanted: dict[str, Any] = {}
    if "status" in args:
        if args["status"] not in ("open", "in_progress", "done"):
            raise ToolInputError("status is open, in_progress or done.")
        wanted["status"] = args["status"]
    if "due_on" in args:
        wanted["due_on"] = _date_arg(args["due_on"], "due_on").isoformat()
    if "assigned_to_id" in args:
        person = next((u for u in equipment_jobs.assignable_users(ctx.db, job.facility_id)
                       if u.id == args["assigned_to_id"]), None)
        if person is None:
            raise ToolInputError("That person cannot be given jobs at this site. Find someone with search_users.")
        wanted["assigned_to_id"] = person.id
    for source, target in (("what_needs_doing", "title"), ("notes", "notes"), ("findings", "findings")):
        if source in args:
            text = site_categories.tidy(str(args[source]))
            if text:
                wanted[target] = text
    if "inspection_result" in args:
        if args["inspection_result"] not in ("pass", "fail"):
            raise ToolInputError("inspection_result is pass or fail.")
        wanted["inspection_result"] = args["inspection_result"]
    if kind != "inspection" and ({"inspection_result", "findings"} & set(wanted)):
        raise ToolInputError("Only an inspection has a result and findings; {} is a service.".format(job.request_number))
    for field in ("labour_cost", "parts_cost"):
        if field in args:
            wanted[field] = str(_money_arg(args[field], field))

    person = job.assigned_technician
    current = {
        "status": equipment_jobs.simple_status(job.status),
        "due_on": job.due_on.isoformat() if job.due_on else None,
        "assigned_to_id": job.assigned_technician_id, "title": job.problem_description, "notes": job.notes,
        "findings": job.findings, "inspection_result": job.inspection_result,
        "labour_cost": str(Decimal(str(job.labour_cost)).quantize(Decimal("0.01"))) if job.labour_cost is not None else None,
        "parts_cost": str(Decimal(str(job.parts_cost)).quantize(Decimal("0.01"))) if job.parts_cost is not None else None,
    }
    changes = {k: v for k, v in wanted.items() if str(v) != str(current.get(k))}
    if not changes:
        raise ToolInputError("Nothing to change: {} already has those details. Say what should change.".format(
            job.request_number))
    _checked(EquipmentJobUpdate, changes)

    def shown(key: str, raw: Any) -> str:
        if raw in (None, ""):
            return "Nobody" if key == "assigned_to_id" else "Not recorded"
        if key == "status":
            return equipment_jobs.STATUS_LABELS.get(raw, raw)
        if key == "inspection_result":
            return equipment_jobs.RESULTS.get(raw, raw)
        if key in ("labour_cost", "parts_cost"):
            return _dollars(raw)
        if key == "assigned_to_id":
            found = ctx.db.get(User, raw)
            return found.full_name if found else "Nobody"
        return str(raw)

    labels = {"status": "Status", "due_on": "Due", "assigned_to_id": "Assigned to", "title": "What needs doing",
              "notes": "Notes", "findings": "Findings", "inspection_result": "Result",
              "labour_cost": "Labour", "parts_cost": "Parts"}
    asset = job.equipment
    lines = [("Job", "{} · {}".format(job.request_number, (job.problem_description or "")[:80])),
             ("Equipment", "{} · {}".format(asset.name or asset.asset_tag, site_categories.location_label(asset))
              if asset else "Not recorded")]
    lines += [(labels[k], "{} → {}".format(shown(k, current.get(k)), shown(k, v))) for k, v in changes.items()]
    if {"labour_cost", "parts_cost"} & set(changes):
        labour = Decimal(changes.get("labour_cost", current["labour_cost"]) or 0)
        parts = Decimal(changes.get("parts_cost", current["parts_cost"]) or 0)
        lines.append(("Job cost", _dollars(labour + parts)))

    warnings: list[str] = []
    if job.is_major_work and ({"labour_cost", "parts_cost", "status"} & set(changes)):
        warnings.append("This is major work: the equipment's value in the asset ledger is corrected to match.")
    if changes.get("status") == "done" and current["labour_cost"] is None and current["parts_cost"] is None \
            and not ({"labour_cost", "parts_cost"} & set(changes)):
        warnings.append("No labour or parts cost is recorded for it.")
    if kind == "inspection" and changes.get("status") == "done" and not (current["inspection_result"] or
                                                                        changes.get("inspection_result")):
        warnings.append("No Pass or Fail result is recorded.")
    return Prepared(
        payload={"job_id": job.id, "changes": changes},
        title="Update {} {}".format(kind, job.request_number), lines=lines,
        facility_id=job.facility_id, warnings=warnings,
    )


def _execute_job_update(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.equipment_maintenance import update_job
    from app.schemas.site_categories import EquipmentJobUpdate

    job = update_job(payload["job_id"], EquipmentJobUpdate(**payload["changes"]), db=db, current_user=user)
    return {"message": "{} {} updated.".format(job["kind"].capitalize(), job["number"]), "record": job["number"],
            "route": "/service", "work_order_id": job["id"],
            "facility_id": db.get(ServiceRequest, payload["job_id"]).facility_id}


# ── inspections, departments, the fleet and sites ────────────────────────────
# Named the way people say them - "Radiology", "Ali", "Generator 1", "the
# ambulance" - and resolved here, so a conversation never has to carry the
# database's own numbers to get something done.

_NO_DEPARTMENT = ("none", "no department", "not in a department", "no")


def _day(value: date) -> str:
    return "{} {}".format(value.day, value.strftime("%b %Y"))


def _person_named(ctx: ToolContext, facility_id: int, name: Any) -> Optional[User]:
    """Somebody who can be given an inspection at this site, by the name used."""
    from app.services import inspection_programme as programme

    if name in (None, ""):
        return None
    people = programme.assignable_inspectors(ctx.db, facility_id)
    wanted = str(name).strip().lower()
    if wanted in ("me", "myself", "i", "mine"):
        if any(person.id == ctx.user.id for person in people):
            return ctx.user
        raise ToolInputError("The person asking cannot be given inspections at this site.")
    exact = [p for p in people if (p.full_name or "").strip().lower() == wanted or (p.username or "").lower() == wanted]
    if len(exact) == 1:
        return exact[0]
    partial = exact or [p for p in people if wanted in (p.full_name or "").lower()]
    if len(partial) == 1:
        return partial[0]
    if len(partial) > 1:
        raise ToolInputError("More than one person matches '{}': {}. Ask which.".format(
            name, ", ".join(sorted(p.full_name for p in partial))))
    raise ToolInputError("Nobody called '{}' can be given inspections at this site. Those who can: {}.".format(
        name, ", ".join(sorted(p.full_name for p in people)) or "nobody yet"))


def _item_label(row: Any, kind: str) -> str:
    tag = row.asset_tag if kind == "equipment" else row.registration
    return "{} · {}".format(row.name, tag) if tag else row.name


def _item_named(ctx: ToolContext, facility_id: Optional[int], *, equipment: Any = None, vehicle: Any = None,
                asset_id: Any = None) -> tuple[Any, str]:
    """The equipment or vehicle meant, by its name, asset tag or registration."""
    from app.models.vehicle import Vehicle

    if asset_id:
        return _category_item(ctx, asset_id), "equipment"
    text = equipment or vehicle
    if not text or not str(text).strip():
        raise ToolInputError("Say which equipment or vehicle, by its name or tag.")
    wanted = str(text).strip().lower()
    candidates: list[tuple[Any, str]] = []
    if equipment or not vehicle:
        candidates += [(row, "equipment") for row in ctx.db.query(Equipment).filter(
            Equipment.facility_id == facility_id, Equipment.name.isnot(None)).all()]
    if vehicle or not equipment:
        candidates += [(row, "vehicle") for row in ctx.db.query(Vehicle).filter(Vehicle.facility_id == facility_id).all()]

    def keys(row: Any, kind: str) -> list[str]:
        tag = row.asset_tag if kind == "equipment" else row.registration
        return [key for key in ((row.name or "").lower(), (tag or "").lower()) if key]

    exact = [c for c in candidates if wanted in keys(*c)]
    if len(exact) == 1:
        return exact[0]
    partial = exact or [c for c in candidates if any(wanted in key for key in keys(*c))]
    if len(partial) == 1:
        return partial[0]
    if len(partial) > 1:
        raise ToolInputError("More than one matches '{}': {}. Ask which.".format(
            text, "; ".join(sorted(_item_label(row, kind) for row, kind in partial[:8]))))
    raise ToolInputError("Nothing called '{}' at this site. Look it up with category_equipment or "
                         "inspection_status first.".format(text))


def _form_named(ctx: ToolContext, name: Any):
    from app.models.inspection_form import InspectionForm

    forms = ctx.db.query(InspectionForm).filter(InspectionForm.archived_at.is_(None)).order_by(InspectionForm.name).all()
    wanted = str(name).strip().lower()
    exact = [form for form in forms if form.name.strip().lower() == wanted]
    partial = exact or [form for form in forms if wanted in form.name.lower()]
    if len(partial) == 1:
        return partial[0]
    listed = ", ".join(form.name for form in forms[:20]) or "none are built yet"
    if len(partial) > 1:
        raise ToolInputError("More than one form matches '{}': {}. Ask which.".format(
            name, ", ".join(form.name for form in partial[:10])))
    raise ToolInputError("No inspection form called '{}'. The forms are: {}.".format(name, listed))


def _open_inspection_number(ctx: ToolContext, item: Any, kind: str) -> Optional[str]:
    from app.models.inspection import Inspection, InspectionBatch, InspectionStatus

    column = Inspection.equipment_id if kind == "equipment" else Inspection.vehicle_id
    row = (ctx.db.query(InspectionBatch.batch_number)
           .join(Inspection, Inspection.batch_id == InspectionBatch.id)
           .filter(column == item.id,
                   Inspection.status.in_([InspectionStatus.UPCOMING, InspectionStatus.IN_PROGRESS]))
           .first())
    return row[0] if row else None


# ── schedule an inspection visit ─────────────────────────────────────────────

def _prepare_inspection_visit(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.services import inspection_programme as programme

    site = _site(ctx, args.get("facility_id"))
    department = _department_named(ctx, site.id, args.get("department"))
    scope = args.get("covers") or ("department" if department else None)
    if scope is None:
        raise ToolInputError("Say what the visit covers: a department (by name), the whole site, or the fleet.")
    if scope not in programme.SCOPES:
        raise ToolInputError("covers is department, facility (the whole site) or fleet.")
    if scope == "department" and department is None:
        raise ToolInputError("Say which department the visit is for.")
    if scope != "department":
        department = None
    if not args.get("on"):
        raise ToolInputError("Say the date of the visit.")
    on = _date_arg(args["on"], "on")
    if on < utc_today():
        raise ToolInputError("A visit is scheduled for today or a later day, not {}.".format(_day(on)))
    inspector = _person_named(ctx, site.id, args.get("inspector"))

    if scope == "fleet":
        links, where = programme.forms_for(ctx.db, facility_id=site.id), "The fleet"
    elif scope == "department":
        links, where = programme.forms_for(ctx.db, department_id=department.id), department.name
    else:
        links, where = None, site.name
    if links is not None and not links:
        raise ToolInputError("{} has no inspection form attached yet, so a visit cannot be scheduled. A form "
                             "is attached on {}.".format(where, "the Fleet page" if scope == "fleet"
                                                         else "the department's page"))
    items = programme.due_items(ctx.db, site.id, scope=scope,
                                department_id=department.id if department else None, by=on)
    if not items:
        raise ToolInputError("Nothing {} is due by {}, so the visit would be empty. Offer a later date, or "
                             "inspecting one item now.".format(
                                 "in " + where if scope == "department" else "at " + where, _day(on)))

    covers = department.name if department else ("Whole site" if scope == "facility" else "Fleet")
    names = [row.name for row in items]
    shown = ", ".join(names[:6]) + (" and {} more".format(len(names) - 6) if len(names) > 6 else "")
    overdue = sum(1 for row in items if row.next_generated_pm_date and row.next_generated_pm_date < utc_today())
    warnings = []
    if overdue:
        warnings.append("{} of them {} already overdue.".format(overdue, "is" if overdue == 1 else "are"))
    if inspector is None:
        warnings.append("No inspector is set, so anyone who inspects at this site can take it.")
    return Prepared(
        payload={"facility_id": site.id, "scope": scope, "department_id": department.id if department else None,
                 "scheduled_on": on.isoformat(), "inspector_id": inspector.id if inspector else None},
        title="Schedule an inspection · {}".format(covers),
        lines=[("Site", site.name), ("Covers", covers), ("Date", _day(on)),
               ("Items due by then", "{} - {}".format(len(names), shown)),
               ("Inspected on", ", ".join(form.name for _, form in links) if links else "Each department's own forms"),
               ("Inspector", inspector.full_name if inspector else "Not set")],
        facility_id=site.id, warnings=warnings,
    )


def _execute_inspection_visit(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.inspection_programme import create_visit
    from app.schemas.inspection_programme import VisitIn

    visit = create_visit(VisitIn(
        facility_id=payload["facility_id"], scope=payload["scope"], department_id=payload.get("department_id"),
        scheduled_on=date.fromisoformat(payload["scheduled_on"]), inspector_id=payload.get("inspector_id"),
    ), db=db, current_user=user)
    return {"message": "Inspection {} is scheduled for {} with {} item{}.".format(
                visit["number"], _day(date.fromisoformat(payload["scheduled_on"])), visit["items"],
                "" if visit["items"] == 1 else "s"),
            "record": visit["number"], "route": "/inspection-visits/{}".format(visit["id"]),
            "facility_id": payload["facility_id"]}


# ── inspect one item now ─────────────────────────────────────────────────────

def _prepare_inspect_now(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.models.department import Department
    from app.models.facility import Facility
    from app.services import inspection_programme as programme

    if args.get("asset_id"):
        item, kind = _item_named(ctx, None, asset_id=args["asset_id"])
        site = ctx.db.get(Facility, item.facility_id)
    else:
        site = _site(ctx, args.get("facility_id"))
        item, kind = _item_named(ctx, site.id, equipment=args.get("equipment"), vehicle=args.get("vehicle"))
    department = ctx.db.get(Department, item.department_id) if kind == "equipment" and item.department_id else None
    if kind == "vehicle":
        links = programme.forms_for(ctx.db, facility_id=site.id)
    else:
        links = programme.forms_for(ctx.db, department_id=department.id) if department else []

    form = _form_named(ctx, args["form"]) if args.get("form") else None
    if form is None and not links:
        from app.models.inspection_form import InspectionForm

        library = [f.name for f in ctx.db.query(InspectionForm).filter(InspectionForm.archived_at.is_(None))
                   .order_by(InspectionForm.name).limit(20)]
        reason = ("is not in a department" if kind == "equipment" and department is None
                  else "has no inspection form of its own")
        raise ToolInputError("{} {}, so ask which form to inspect it on: {}.".format(
            item.name, reason, ", ".join(library) or "none are built yet - one is built under Inspection forms"))
    on = _date_arg(args["on"], "on") if args.get("on") else utc_today()
    inspector = _person_named(ctx, site.id, args.get("inspector"))
    warnings = ["It opens as a visit of one, ready to fill in, whether or not it was due."]
    already = _open_inspection_number(ctx, item, kind)
    if already:
        warnings.insert(0, "It already has an open inspection in visit {}.".format(already))
    return Prepared(
        payload={"facility_id": site.id, "equipment_id": item.id if kind == "equipment" else None,
                 "vehicle_id": item.id if kind == "vehicle" else None, "form_id": form.id if form else None,
                 "scheduled_on": on.isoformat(), "inspector_id": inspector.id if inspector else None},
        title="Inspect {} now".format(item.name),
        lines=[("Item", _item_label(item, kind)),
               ("Department", department.name if department else ("Fleet" if kind == "vehicle" else "Not in a department")),
               ("Inspected on", form.name if form else ", ".join(f.name for _, f in links)),
               ("Date", _day(on)),
               ("Inspector", inspector.full_name if inspector else "Not set")],
        facility_id=site.id, warnings=warnings,
    )


def _execute_inspect_now(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.inspection_programme import inspect_now
    from app.schemas.inspection_programme import InspectNowIn

    visit = inspect_now(InspectNowIn(
        facility_id=payload["facility_id"], equipment_id=payload.get("equipment_id"),
        vehicle_id=payload.get("vehicle_id"), form_id=payload.get("form_id"),
        scheduled_on=date.fromisoformat(payload["scheduled_on"]), inspector_id=payload.get("inspector_id"),
    ), db=db, current_user=user)
    return {"message": "Inspection {} is open and ready to fill in.".format(visit["number"]),
            "record": visit["number"], "route": "/inspection-visits/{}".format(visit["id"]),
            "facility_id": payload["facility_id"]}


# ── clear a red tag ──────────────────────────────────────────────────────────

_CAN_CLEAR_RED_TAGS = (UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.FACILITY_ADMIN,
                       UserRole.FACILITY_MANAGER, UserRole.TECHNICIAN)


def _prepare_clear_red_tag(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.models.facility import Facility
    from app.models.red_tag import RedTag

    if ctx.user.role not in _CAN_CLEAR_RED_TAGS:
        raise ToolInputError("Only an inspector, an admin or a Super Admin can clear a red tag.")
    note = (args.get("note") or "").strip()
    if len(note) < 3:
        raise ToolInputError("Say what was done to put it right: that note is kept with the red tag.")
    if args.get("asset_id"):
        item, kind = _item_named(ctx, None, asset_id=args["asset_id"])
        site = ctx.db.get(Facility, item.facility_id)
    else:
        site = _site(ctx, args.get("facility_id"))
        item, kind = _item_named(ctx, site.id, equipment=args.get("equipment"), vehicle=args.get("vehicle"))
    column = RedTag.equipment_id if kind == "equipment" else RedTag.vehicle_id
    tag = (ctx.db.query(RedTag).filter(RedTag.facility_id == site.id, column == item.id, RedTag.cleared_at.is_(None))
           .order_by(RedTag.raised_at.desc()).first())
    if tag is None:
        raise ToolInputError("{} has no red tag to clear.".format(item.name))
    warnings = []
    if (item.condition or "") == "out_of_service":
        warnings.append("It goes back to Needs attention, not Working: it still has a failure until it passes "
                        "an inspection.")
    return Prepared(
        payload={"red_tag_id": tag.id, "note": note[:2000]},
        title="Clear the red tag on {}".format(item.name),
        lines=[("Item", _item_label(item, kind)), ("Red tagged on", _day(tag.raised_at.date())),
               ("Reason", tag.note), ("What was done", note[:2000])],
        facility_id=site.id, warnings=warnings,
    )


def _execute_clear_red_tag(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.inspection_programme import clear_red_tag
    from app.models.red_tag import RedTag
    from app.schemas.inspection_programme import ClearRedTagIn

    tag = db.get(RedTag, payload["red_tag_id"])
    facility_id = tag.facility_id if tag else None
    clear_red_tag(payload["red_tag_id"], ClearRedTagIn(note=payload["note"]), db=db, current_user=user)
    return {"message": "The red tag is cleared and the note is kept with it.", "record": "Red tag",
            "route": "/red-tags", "facility_id": facility_id}


# ── add a department ─────────────────────────────────────────────────────────

def _prepare_add_department(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.models.department import Department

    if ctx.user.role not in (UserRole.SUPERADMIN, UserRole.ADMIN):
        raise ToolInputError("Only an admin or a Super Admin can add a department.")
    site = _site(ctx, args.get("facility_id"))
    name = re.sub(r"\s+", " ", str(args.get("name") or "")).strip()[:120]
    if not name:
        raise ToolInputError("Say what the department is called.")
    existing = ctx.db.query(Department).filter(
        Department.facility_id == site.id, func.lower(Department.name) == name.lower()).first()
    if existing is not None:
        raise ToolInputError("{} already has a department called {}.".format(site.name, existing.name))
    description = str(args.get("description") or "").strip()[:1000] or None
    return Prepared(
        payload={"facility_id": site.id, "name": name, "description": description},
        title="Add the {} department".format(name),
        lines=[("Site", site.name), ("Department", name), ("Description", description or "None")],
        facility_id=site.id,
        warnings=["Attach an inspection form to it on its page before scheduling its visits."],
    )


def _execute_add_department(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.departments import create_department
    from app.schemas.department import DepartmentCreate

    department = create_department(DepartmentCreate(
        name=payload["name"], description=payload.get("description"), facility_id=payload["facility_id"],
    ), db=db, current_user=user)
    return {"message": "{} is added.".format(_get(department, "name")), "record": _get(department, "name"),
            "route": "/departments/{}".format(_get(department, "id")), "facility_id": payload["facility_id"]}


# ── add a vehicle ────────────────────────────────────────────────────────────

def _prepare_add_vehicle(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.models.vehicle import Vehicle
    from app.schemas.inspection_programme import VehicleIn
    from app.services import inspection_programme as programme

    site = _site(ctx, args.get("facility_id"))
    tidy = lambda key, size: (re.sub(r"\s+", " ", str(args.get(key) or "")).strip()[:size] or None)  # noqa: E731
    name = tidy("name", 160)
    if not name:
        raise ToolInputError("Say what the vehicle is called, for example 'Ambulance 2'.")
    registration = (tidy("registration", 40) or "").upper() or None
    frequency, interval = (None, None)
    if args.get("frequency"):
        frequency, interval = programme.frequency_or_422(args.get("frequency"), args.get("interval_days"))
    first_due = _date_arg(args["first_due_on"], "first_due_on") if args.get("first_due_on") else None
    fields = {"facility_id": site.id, "name": name, "registration": registration,
              "vehicle_type": tidy("vehicle_type", 60), "make": tidy("make", 120), "model": tidy("model", 120),
              "year": args.get("year"), "frequency": frequency, "interval_days": interval,
              "first_due_on": first_due.isoformat() if first_due else None}
    _checked(VehicleIn, fields)
    if registration and ctx.db.query(Vehicle).filter(
            Vehicle.facility_id == site.id, func.upper(Vehicle.registration) == registration).first():
        raise ToolInputError("{} already has a vehicle registered {}.".format(site.name, registration))
    warnings = []
    if not programme.forms_for(ctx.db, facility_id=site.id):
        warnings.append("The fleet has no inspection form yet; one is attached on the Fleet page.")
    if frequency is None:
        warnings.append("No inspection frequency is set, so it will show as having no schedule.")
    make_model = " ".join(p for p in (fields["make"], fields["model"]) if p)
    return Prepared(
        payload=fields,
        title="Add {} to the fleet".format(name),
        lines=[("Site", site.name), ("Vehicle", name), ("Registration", registration or "Not given"),
               ("Type", fields["vehicle_type"] or "Not given"), ("Make and model", make_model or "Not given"),
               ("Year", str(fields["year"]) if fields["year"] else "Not given"),
               ("Inspected", programme.FREQUENCIES[frequency] + (" ({} days)".format(interval) if interval else "")
                if frequency else "No schedule")],
        facility_id=site.id, warnings=warnings,
    )


def _execute_add_vehicle(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.fleet import add_vehicle
    from app.schemas.inspection_programme import VehicleIn

    vehicle = add_vehicle(VehicleIn(**payload), db=db, current_user=user)
    return {"message": "{} is added to the fleet.".format(payload["name"]), "record": payload["name"],
            "route": "/fleet", "vehicle_id": _get(vehicle, "id"), "facility_id": payload["facility_id"]}


# ── register a site ──────────────────────────────────────────────────────────

_SITE_FIELDS = (("name", "name"), ("address", "street address"), ("city", "city"), ("state", "state"),
                ("zip_code", "ZIP code"), ("country", "country"), ("phone", "phone number"),
                ("email", "email address"))


def _prepare_register_site(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.schemas.facility import FacilityCreate

    fields = {key: re.sub(r"\s+", " ", str(args.get(key) or "")).strip() for key, _ in _SITE_FIELDS}
    missing = [label for key, label in _SITE_FIELDS if not fields[key]]
    if missing:
        raise ToolInputError("A new site needs its {}. Ask for {} in one short question.".format(
            ", ".join(missing), "it" if len(missing) == 1 else "them"))
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", fields["email"]):
        raise ToolInputError("'{}' does not look like an email address. Ask for it again.".format(fields["email"]))
    from app.api.v1.endpoints.facilities import _facility_name_exists

    # The same comparison the Register a site form makes: case and spacing aside.
    if _facility_name_exists(ctx.db, fields["name"]):
        raise ToolInputError("A site called {} already exists.".format(fields["name"]))
    extra: dict[str, Any] = {}
    if args.get("beds") not in (None, ""):
        extra["beds"] = args["beds"]
    if args.get("size") not in (None, ""):
        extra["size_band"] = str(args["size"]).strip().lower()
    _checked(FacilityCreate, {**fields, **extra})
    return Prepared(
        payload={**fields, **extra},
        title="Register {}".format(fields["name"]),
        lines=[("Name", fields["name"]),
               ("Address", "{}, {}, {} {}, {}".format(fields["address"], fields["city"], fields["state"],
                                                      fields["zip_code"], fields["country"])),
               ("Phone", fields["phone"]), ("Email", fields["email"]),
               ("Beds", str(extra["beds"]) if "beds" in extra else "Not given"),
               ("Size", extra["size_band"].capitalize() if "size_band" in extra else "Not given")],
        facility_id=None,
        warnings=["It appears on the Sites page. Its departments, equipment and people are added from there."],
    )


def _execute_register_site(db: Session, user: User, payload: dict[str, Any]) -> dict[str, Any]:
    from app.api.v1.endpoints.facilities import create_facility
    from app.schemas.facility import FacilityCreate

    site = create_facility(db=db, facility_in=FacilityCreate(**payload), auto_unique_name=False, current_user=user)
    site_id = _get(site, "id")
    return {"message": "{} is registered.".format(_get(site, "name")), "record": _get(site, "name"),
            "route": "/sites/{}".format(site_id), "facility_id": site_id}


# ── registry ─────────────────────────────────────────────────────────────────

_TRADE_CODES = ["mechanical", "hvac", "electrical", "plumbing", "vertical_transport", "fire_life_safety",
                "medical_gas", "building_envelope", "it_low_voltage", "biomedical"]

ACTION_DEFINITIONS: tuple[ActionDefinition, ...] = (
    ActionDefinition(
        name="prepare_fault_report",
        module="service-requests", permission="add",
        description=(
            "Prepare a work order for something broken, for the person to confirm. "
            "Target exactly one of: a fixture (socket, light - find with search_fixtures), "
            "an asset (resolve_entity kind=asset), or a room itself with the trade it "
            "goes to. Priority defaults from the room. Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "fixture_id": {"type": "integer"},
            "asset_id": {"type": "integer"},
            "location_id": {"type": "integer"},
            "trade": {"type": "string", "enum": _TRADE_CODES, "description": "Only for a fault on a room itself."},
            "description": {"type": "string", "description": "What is wrong, in the reporter's words."},
            "priority": {"type": "string", "enum": PRIORITIES},
            "takes_room_out_of_service": {"type": "boolean", "default": False},
        }, "required": ["description"]},
        prepare=_prepare_fault, execute=_execute_fault,
    ),
    ActionDefinition(
        name="prepare_service_booking",
        module="service-requests", permission="add",
        description=(
            "Prepare booking an asset in for service, optionally assigned to a technician "
            "(find one with search_users role=technician). Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "asset_id": {"type": "integer"},
            "description": {"type": "string", "description": "What needs doing."},
            "priority": {"type": "string", "enum": PRIORITIES},
            "assigned_technician_id": {"type": "integer"},
        }, "required": ["asset_id", "description"]},
        prepare=_prepare_booking, execute=_execute_booking,
    ),
    ActionDefinition(
        name="prepare_inspection_schedule",
        module="facility-inventory", permission="edit",
        description=(
            "Prepare how often a piece of equipment is inspected: quarterly, every 6 months, "
            "annually, monthly, or a custom number of days. Its next date is worked out from the "
            "frequency unless one is given. Optionally the maintenance to do when it falls due and "
            "who it is assigned to. This is the only schedule there is - there are no separate "
            "maintenance plans. Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "asset_id": {"type": "integer"},
            "frequency": {"type": "string",
                          "enum": ["monthly", "quarterly", "semi_annual", "annual", "custom"]},
            "interval_days": {"type": "integer", "minimum": 1, "maximum": 3650,
                              "description": "Only for a custom frequency."},
            "first_due_on": {"type": "string", "format": "date"},
            "pm_task": {"type": "string", "description": "e.g. 'Quarterly filter change'."},
            "assigned_to_id": {"type": "integer"},
        }, "required": ["asset_id", "frequency"]},
        prepare=_prepare_schedule, execute=_execute_schedule,
    ),
    ActionDefinition(
        name="prepare_work_order_update",
        module="service-requests", permission="edit",
        description=(
            "Prepare a change to an existing work order: move its status along its "
            "workflow, assign a technician, change priority, or add a note. Resolve the "
            "work order first. Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "work_order_id": {"type": "integer"},
            "status": {"type": "string", "enum": [s.value for s in ServiceRequestStatus]},
            "assigned_technician_id": {"type": "integer"},
            "priority": {"type": "string", "enum": PRIORITIES},
            "note": {"type": "string"},
        }, "required": ["work_order_id"]},
        prepare=_prepare_update, execute=_execute_update,
    ),
    ActionDefinition(
        name="prepare_equipment_job",
        module="service-requests", permission="add",
        description=(
            "Prepare a service job - work raised because a piece of equipment is at fault or "
            "malfunctioning - for the Service screen. Find the equipment with category_equipment or "
            "resolve_entity kind=asset. Optionally a due date and a person to assign (search_users). "
            "This is NOT for inspections: use prepare_inspect_now or prepare_inspection_visit. "
            "Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "asset_id": {"type": "integer"},
            "kind": {"type": "string", "enum": ["service"]},
            "what_needs_doing": {"type": "string"},
            "due_on": {"type": "string", "format": "date"},
            "assigned_to_id": {"type": "integer"},
        }, "required": ["asset_id", "what_needs_doing"]},
        prepare=_prepare_equipment_job, execute=_execute_equipment_job,
    ),
    ActionDefinition(
        name="prepare_equipment_job_update",
        module="service-requests", permission="edit",
        description=(
            "Prepare a change to a service job (or an old-style inspection job): its status "
            "(open, in_progress, done), due date, who it is assigned to (search_users), what needs doing, "
            "notes, labour and parts cost, and for an inspection the pass/fail result and findings. Find the "
            "job with equipment_jobs (job_id). Pass only what changes. Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "job_id": {"type": "integer"},
            "status": {"type": "string", "enum": ["open", "in_progress", "done"]},
            "due_on": {"type": "string", "format": "date"},
            "assigned_to_id": {"type": "integer"},
            "what_needs_doing": {"type": "string"},
            "notes": {"type": "string"},
            "inspection_result": {"type": "string", "enum": ["pass", "fail"]},
            "findings": {"type": "string"},
            "labour_cost": {"type": "number", "minimum": 0},
            "parts_cost": {"type": "number", "minimum": 0},
        }, "required": ["job_id"]},
        prepare=_prepare_job_update, execute=_execute_job_update,
    ),
    ActionDefinition(
        name="prepare_add_equipment",
        module="facility-inventory", permission="add",
        description=(
            "Prepare adding equipment to one of a site's categories under Facility (Electrical, Plumbing, "
            "Mechanical, HVAC, Building, Landscaping, Parking). Needs the "
            "category, a name (e.g. 'Generator 2') and its type (e.g. Generator, Chiller); ask for any of these "
            "that the person did not give. The department it belongs to (by name, e.g. 'Radiology'), quantity, "
            "status, make, model, the purchase cost of one item, the in-service date, useful life and notes are "
            "optional. Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer", "description": "The site. Defaults to the one the person is in."},
            "category": {"type": "string", "enum": ["electrical", "plumbing", "mechanical", "hvac", "building", "landscaping", "parking"]},
            "name": {"type": "string"},
            "type": {"type": "string"},
            "department": {"type": "string", "description": "The department it belongs to, by name."},
            "building": {"type": "string", "description": "Only if the person says where it is."},
            "floor": {"type": "string"},
            "spot": {"type": "string", "description": "Room or exact spot, only if given."},
            "quantity": {"type": "integer", "minimum": 1},
            "status": {"type": "string", "enum": ["working", "needs_attention", "out_of_service"]},
            "make": {"type": "string"},
            "model": {"type": "string"},
            "unit_cost": {"type": "number", "minimum": 0, "description": "Purchase cost of one item."},
            "in_service_on": {"type": "string", "format": "date"},
            "useful_life_years": {"type": "number", "exclusiveMinimum": 0, "maximum": 100},
            "notes": {"type": "string"},
        }, "required": ["category", "name", "type"]},
        prepare=_prepare_add_equipment, execute=_execute_add_equipment,
    ),
    ActionDefinition(
        name="prepare_equipment_update",
        module="facility-inventory", permission="edit",
        description=(
            "Prepare a change to equipment under Facility: the department it belongs to (by name, or 'none'), "
            "its status (working, needs_attention, out_of_service), name, type, category, quantity, make, model, "
            "purchase cost of one item, in-service date, useful life or notes. Find it with category_equipment "
            "or resolve_entity kind=asset. Pass only what changes. Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "asset_id": {"type": "integer"},
            "department": {"type": "string", "description": "Its department by name, or 'none' for no department."},
            "status": {"type": "string", "enum": ["working", "needs_attention", "out_of_service"]},
            "name": {"type": "string"},
            "type": {"type": "string"},
            "category": {"type": "string", "enum": ["electrical", "plumbing", "mechanical", "hvac", "building", "landscaping", "parking"]},
            "building": {"type": "string"},
            "floor": {"type": "string"},
            "spot": {"type": "string"},
            "quantity": {"type": "integer", "minimum": 1},
            "make": {"type": "string"},
            "model": {"type": "string"},
            "unit_cost": {"type": "number", "minimum": 0},
            "in_service_on": {"type": "string", "format": "date"},
            "useful_life_years": {"type": "number", "exclusiveMinimum": 0, "maximum": 100},
            "notes": {"type": "string"},
        }, "required": ["asset_id"]},
        prepare=_prepare_equipment_update, execute=_execute_equipment_update,
    ),
    ActionDefinition(
        name="prepare_inspection_visit",
        module="inspections", permission="add",
        description=(
            "Prepare scheduling an inspection visit on a date: for a department (by name), the whole site "
            "(covers=facility) or the fleet (covers=fleet). It holds everything due by that date. Optionally "
            "an inspector by name ('me' for the person asking). Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer", "description": "The site. Defaults to the one the person is in."},
            "covers": {"type": "string", "enum": ["department", "facility", "fleet"]},
            "department": {"type": "string", "description": "The department by name, when covers=department."},
            "on": {"type": "string", "format": "date", "description": "The day of the visit, YYYY-MM-DD."},
            "inspector": {"type": "string", "description": "Who inspects, by name."},
        }, "required": ["on"]},
        prepare=_prepare_inspection_visit, execute=_execute_inspection_visit,
    ),
    ActionDefinition(
        name="prepare_inspect_now",
        module="inspections", permission="add",
        description=(
            "Prepare inspecting one piece of equipment or one vehicle now, whether or not it is due. Name it "
            "(equipment: its name or asset tag; vehicle: its name or registration). It uses its department's "
            "form, or the form named (form) when it has none. Optionally a date and an inspector by name. It "
            "opens as a visit of one, ready to fill in. Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer", "description": "The site. Defaults to the one the person is in."},
            "equipment": {"type": "string", "description": "Equipment by name or asset tag."},
            "vehicle": {"type": "string", "description": "A vehicle by name or registration."},
            "asset_id": {"type": "integer"},
            "form": {"type": "string", "description": "An inspection form by name."},
            "on": {"type": "string", "format": "date"},
            "inspector": {"type": "string", "description": "Who inspects, by name."},
        }},
        prepare=_prepare_inspect_now, execute=_execute_inspect_now,
    ),
    ActionDefinition(
        name="prepare_clear_red_tag",
        module="inspections", permission="edit",
        description=(
            "Prepare clearing the red tag on a piece of equipment or a vehicle, with a note saying what was "
            "done to put it right (required). Name the item (equipment: name or asset tag; vehicle: name or "
            "registration). Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer", "description": "The site. Defaults to the one the person is in."},
            "equipment": {"type": "string"},
            "vehicle": {"type": "string"},
            "asset_id": {"type": "integer"},
            "note": {"type": "string", "description": "What was done, in the person's words."},
        }, "required": ["note"]},
        prepare=_prepare_clear_red_tag, execute=_execute_clear_red_tag,
    ),
    ActionDefinition(
        name="prepare_add_department",
        module="facilities", permission="edit",
        description=(
            "Prepare adding a department to a site, by name, with an optional description. Nothing happens "
            "until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer", "description": "The site. Defaults to the one the person is in."},
            "name": {"type": "string"},
            "description": {"type": "string"},
        }, "required": ["name"]},
        prepare=_prepare_add_department, execute=_execute_add_department,
    ),
    ActionDefinition(
        name="prepare_add_vehicle",
        module="inspections", permission="add",
        description=(
            "Prepare adding a vehicle to a site's fleet: its name (required), registration, type, make, model, "
            "year, and how often it is inspected (monthly, quarterly, semi_annual, annual, or custom with "
            "interval_days) with an optional first due date. Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer", "description": "The site. Defaults to the one the person is in."},
            "name": {"type": "string"},
            "registration": {"type": "string"},
            "vehicle_type": {"type": "string", "description": "e.g. Ambulance, Van, Car."},
            "make": {"type": "string"},
            "model": {"type": "string"},
            "year": {"type": "integer", "minimum": 1900, "maximum": 2100},
            "frequency": {"type": "string", "enum": ["monthly", "quarterly", "semi_annual", "annual", "custom"]},
            "interval_days": {"type": "integer", "minimum": 1, "maximum": 3650},
            "first_due_on": {"type": "string", "format": "date"},
        }, "required": ["name"]},
        prepare=_prepare_add_vehicle, execute=_execute_add_vehicle,
    ),
    ActionDefinition(
        name="prepare_register_site",
        module="facilities", permission="add",
        description=(
            "Prepare registering a new site (hospital). Needs its name, street address, city, state, ZIP code, "
            "country, phone number and email address - ask for whichever the person did not give, in one short "
            "question. Beds and size (small, medium, large) are optional. Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "name": {"type": "string"},
            "address": {"type": "string"},
            "city": {"type": "string"},
            "state": {"type": "string"},
            "zip_code": {"type": "string"},
            "country": {"type": "string"},
            "phone": {"type": "string"},
            "email": {"type": "string"},
            "beds": {"type": "integer", "minimum": 0},
            "size": {"type": "string", "enum": ["small", "medium", "large"]},
        }, "required": ["name"]},
        prepare=_prepare_register_site, execute=_execute_register_site,
    ),
)

ACTIONS_BY_NAME: dict[str, ActionDefinition] = {a.name: a for a in ACTION_DEFINITIONS}


# ── lifecycle ────────────────────────────────────────────────────────────────

def fingerprint(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def card_of(action: AssistantAction) -> dict[str, Any]:
    """The confirmation card as the browser and the agent see it."""
    return {
        "action_id": action.id,
        "action_type": action.action_type,
        "status": action.status,
        "expires_at": action.expires_at.isoformat() + "Z",
        # The browser opens the record inside this site.
        "facility_id": action.facility_id,
        **(action.card or {}),
        "result": action.result,
        "error": action.error,
    }


def _as_schema_types(parameters: dict[str, Any], arguments: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Arguments as the schema declares them, whatever the model sent.

    Open models call tools with {"assigned_to_id": "12"} or {"due_on": null}.
    Taken literally, "12" matched nobody and the change was refused as "that
    person cannot be given jobs"; an empty optional argument is "not given".
    """
    properties = parameters.get("properties", {})
    out: dict[str, Any] = {}
    for key, value in (arguments or {}).items():
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        kind = properties.get(key, {}).get("type")
        if kind == "integer":
            if isinstance(value, str) and re.fullmatch(r"\s*\d+\s*", value):
                value = int(value)
            elif isinstance(value, float) and value.is_integer():
                value = int(value)
        elif kind == "boolean" and isinstance(value, str) and value.strip().lower() in ("true", "false"):
            value = value.strip().lower() == "true"
        elif kind == "string" and isinstance(value, str):
            value = value.strip()
            # "Needs attention", "HVAC", "In progress": the label, where the code was meant.
            choices = properties[key].get("enum")
            if choices and value not in choices:
                code = re.sub(r"[\s\-]+", "_", value.lower())
                value = code if code in choices else value
        out[key] = value
    return out


def propose(db: Session, user: User, name: str, arguments: dict[str, Any]) -> AssistantAction:
    """Validate and store a proposal. Raises ToolInputError or a permission error."""
    definition = ACTIONS_BY_NAME.get(name)
    if definition is None:
        raise ToolInputError("Unknown action: {}".format(name))
    arguments = _as_schema_types(definition.parameters, arguments)
    allowed = set(definition.parameters.get("properties", {}))
    unexpected = set(arguments or {}) - allowed
    if unexpected:
        raise ToolInputError("Unexpected argument(s) for {}: {}".format(name, ", ".join(sorted(unexpected))))

    ctx = ToolContext(db=db, user=user)
    ctx.require_module(definition.module, definition.permission)
    prepared = definition.prepare(ctx, dict(arguments or {}))
    now = datetime.utcnow()
    action = AssistantAction(
        id=str(uuid.uuid4()),
        user_id=user.id,
        facility_id=prepared.facility_id,
        action_type=name,
        payload=prepared.payload,
        payload_hash=fingerprint(prepared.payload),
        card={"title": prepared.title,
              "lines": [{"label": k, "value": v} for k, v in prepared.lines],
              "warnings": prepared.warnings},
        status=ActionStatus.PROPOSED.value,
        created_at=now,
        expires_at=now + PROPOSAL_LIFETIME,
    )
    db.add(action)
    db.commit()
    return action


def _load_for_decision(db: Session, user: User, action_id: str) -> AssistantAction:
    action = (
        db.query(AssistantAction)
        .filter(AssistantAction.id == action_id)
        .with_for_update()
        .first()
    )
    # Someone else's proposal is indistinguishable from none at all.
    if action is None or action.user_id != user.id:
        raise HTTPException(status_code=404, detail="No such action.")
    return action


def confirm(db: Session, user: User, action_id: str) -> AssistantAction:
    """Run a proposal, once. Confirming an already executed action returns it unchanged."""
    action = _load_for_decision(db, user, action_id)
    if action.status == ActionStatus.EXECUTED.value:
        return action
    if action.status != ActionStatus.PROPOSED.value:
        raise HTTPException(status_code=409, detail="This action was already {}.".format(action.status))
    if datetime.utcnow() > action.expires_at:
        action.status = ActionStatus.EXPIRED.value
        action.decided_at = datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=410, detail="This expired. Ask again to prepare it afresh.")
    if fingerprint(action.payload) != action.payload_hash:
        raise HTTPException(status_code=409, detail="The details changed after they were shown. Ask again.")

    definition = ACTIONS_BY_NAME[action.action_type]
    ctx = ToolContext(db=db, user=user)
    ctx.require_module(definition.module, definition.permission)

    # Claimed before running, so a double click cannot run it twice.
    action.status = ActionStatus.EXECUTED.value
    action.decided_at = datetime.utcnow()
    db.commit()
    try:
        action.result = definition.execute(db, user, action.payload)
    except HTTPException as exc:
        db.rollback()
        action = db.get(AssistantAction, action_id)
        action.status = ActionStatus.FAILED.value
        action.error = plain_error(exc.detail if isinstance(exc.detail, str) else None)
    except Exception:  # noqa: BLE001 - logged in full, told plainly on the card
        logger.exception("Confirmed action %s (%s) failed", action_id, action.action_type)
        db.rollback()
        action = db.get(AssistantAction, action_id)
        action.status = ActionStatus.FAILED.value
        action.error = plain_error(None)
    db.commit()
    return action


_ID_WORDING = re.compile(r"\s*\b(with (that|this|the given) id|id\s*#?\d+|#\d+)\b", re.IGNORECASE)
_CODE_WORDING = re.compile(r"\b[a-z]+(?:_[a-z]+)+\b")


def plain_error(detail: Optional[str]) -> str:
    """What went wrong, in the words of the screen - never field names or ids."""
    fallback = "It could not be completed and nothing was changed. Try again, or make the change on its own screen."
    if not detail or not detail.strip():
        return fallback
    text = _ID_WORDING.sub("", detail.strip())
    if _CODE_WORDING.search(text) or "Traceback" in text or "{" in text:
        return fallback
    return text[:300]


def cancel(db: Session, user: User, action_id: str) -> AssistantAction:
    action = _load_for_decision(db, user, action_id)
    if action.status == ActionStatus.PROPOSED.value:
        action.status = ActionStatus.CANCELLED.value
        action.decided_at = datetime.utcnow()
        db.commit()
    return action
