"""Actions the assistant can prepare for a person to confirm.

The changes a person makes on the everyday screens: add equipment to a
category or change its details (including what one item cost), raise a service
or inspection job or update one (status, result, labour and parts cost), report
a fault, book an asset for service, set how often something is inspected, and
update a work order. Each touches one record, which the product can change back.
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
    kind = args.get("kind")
    if kind not in equipment_jobs.KINDS:
        raise ToolInputError("kind is service or inspection.")
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
            "record": job["number"], "route": "/equipment-maintenance/{}".format(payload["kind"]),
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


def _prepare_add_equipment(ctx: ToolContext, args: dict[str, Any]) -> Prepared:
    from app.api.v1.endpoints.site_categories import MAX_TOTAL_COST
    from app.schemas.site_categories import CategoryEquipmentCreate
    from app.services import site_categories

    site = _site(ctx, args.get("facility_id"))
    fields = _equipment_fields(ctx, args, site.id)
    missing = [label for key, label in (("category", "category"), ("name", "name"), ("type", "type"),
                                        ("building", "building")) if not fields.get(key)]
    if missing:
        raise ToolInputError("New equipment needs its {}. Ask the person for it.".format(", ".join(missing)))
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
        ("Where", _place(fields.get("building"), fields.get("floor"), fields.get("spot"))),
        ("Quantity", str(quantity)), ("Status", site_categories.CONDITIONS[fields["condition"]]),
    ]
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
    wanted = _equipment_fields(ctx, {k: v for k, v in args.items() if k != "asset_id"}, asset.facility_id)
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

    lines = [("Equipment", "{} · {}".format(asset.name, asset.asset_tag)),
             ("Where", site_categories.location_label(asset) or "Not recorded")]
    lines += [(labels[k], "{} → {}".format(shown(k, current.get(k)), shown(k, v))) for k, v in changes.items()]
    warnings: list[str] = []
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
            "route": "/equipment-maintenance/{}".format(job["kind"]), "work_order_id": job["id"],
            "facility_id": db.get(ServiceRequest, payload["job_id"]).facility_id}


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
            "Prepare a service or inspection job on a piece of category equipment "
            "(Electrical, Plumbing, Mechanical, HVAC), for Equipment Maintenance. Find the "
            "equipment with category_equipment or resolve_entity kind=asset. Optionally a due "
            "date and a person to assign (search_users). Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "asset_id": {"type": "integer"},
            "kind": {"type": "string", "enum": ["service", "inspection"]},
            "what_needs_doing": {"type": "string"},
            "due_on": {"type": "string", "format": "date"},
            "assigned_to_id": {"type": "integer"},
        }, "required": ["asset_id", "kind", "what_needs_doing"]},
        prepare=_prepare_equipment_job, execute=_execute_equipment_job,
    ),
    ActionDefinition(
        name="prepare_equipment_job_update",
        module="service-requests", permission="edit",
        description=(
            "Prepare a change to a service or inspection job under Equipment Maintenance: its status "
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
            "Prepare adding equipment to a site's Electrical, Plumbing, Mechanical or HVAC category. Needs the "
            "category, a name (e.g. 'Generator 2'), its type (e.g. Generator, Chiller) and the building it is in; "
            "ask for any of these that the person did not give. Floor, room or exact spot, quantity, status, make, "
            "model, the purchase cost of one item, the in-service date, useful life and notes are optional. "
            "Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer", "description": "The site. Defaults to the one the person is in."},
            "category": {"type": "string", "enum": ["electrical", "plumbing", "mechanical", "hvac"]},
            "name": {"type": "string"},
            "type": {"type": "string"},
            "building": {"type": "string"},
            "floor": {"type": "string"},
            "spot": {"type": "string", "description": "Room or exact spot."},
            "quantity": {"type": "integer", "minimum": 1},
            "status": {"type": "string", "enum": ["working", "needs_attention", "out_of_service"]},
            "make": {"type": "string"},
            "model": {"type": "string"},
            "unit_cost": {"type": "number", "minimum": 0, "description": "Purchase cost of one item."},
            "in_service_on": {"type": "string", "format": "date"},
            "useful_life_years": {"type": "number", "exclusiveMinimum": 0, "maximum": 100},
            "notes": {"type": "string"},
        }, "required": ["category", "name", "type", "building"]},
        prepare=_prepare_add_equipment, execute=_execute_add_equipment,
    ),
    ActionDefinition(
        name="prepare_equipment_update",
        module="facility-inventory", permission="edit",
        description=(
            "Prepare a change to equipment under Facility: its status (working, needs_attention, "
            "out_of_service), name, type, category, building, floor, room or exact spot, quantity, make, model, "
            "purchase cost of one item, in-service date, useful life or notes. Find it with category_equipment "
            "or resolve_entity kind=asset. Pass only what changes. Nothing happens until confirmed."
        ),
        parameters={"type": "object", "properties": {
            "asset_id": {"type": "integer"},
            "status": {"type": "string", "enum": ["working", "needs_attention", "out_of_service"]},
            "name": {"type": "string"},
            "type": {"type": "string"},
            "category": {"type": "string", "enum": ["electrical", "plumbing", "mechanical", "hvac"]},
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
        action.error = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    except Exception as exc:  # noqa: BLE001 - reported on the card, never swallowed silently
        db.rollback()
        action = db.get(AssistantAction, action_id)
        action.status = ActionStatus.FAILED.value
        action.error = "It could not be completed: {}".format(exc)
    db.commit()
    return action


def cancel(db: Session, user: User, action_id: str) -> AssistantAction:
    action = _load_for_decision(db, user, action_id)
    if action.status == ActionStatus.PROPOSED.value:
        action.status = ActionStatus.CANCELLED.value
        action.decided_at = datetime.utcnow()
        db.commit()
    return action
