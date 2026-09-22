"""Read-only business tools for the Super Admin assistant.

These are the only way the assistant reaches operational data. Each one owns its
joins, so the model never resolves a foreign key or invents a filter value.
Every query is SELECT-only; nothing here writes.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional
from urllib.parse import urlencode

from sqlalchemy import func, or_

from app.assistant.tools.base import (
    ToolContext,
    ToolInputError,
    ToolResult,
    clamp_limit,
    datetime_bounds,
    money,
    validate_date_range,
)
from app.models.discipline import Discipline
from app.models.equipment import Equipment
from app.models.location import Location
from app.models.facility import Facility
from app.models.inspection import Inspection, InspectionBatch, InspectionStatus
from app.models.invoice import Invoice, InvoiceStatus, InvoiceType
from app.models.service_request import ServiceRequest, ServiceRequestStatus
from app.models.user import User, UserRole
from app.utils.invoice_approval import scope_invoice_approval_visibility


RESOLVABLE_KINDS = ("facility", "user", "service_request", "inspection", "invoice", "space", "asset")

# Service-request status groups, mirroring the Service Requests module exactly
# (see the status_group filter on the list endpoint). These matter because
# "open" is not one thing in this product: the module's Open tab means NEW and
# ASSIGNED only, while the dashboard's "Open Requests" tile also counts the five
# waiting states. A tool that silently picked either would contradict one screen
# or the other, so the group is named in the result and both totals are given.
SERVICE_STATUS_GROUPS: dict[str, tuple[ServiceRequestStatus, ...]] = {
    "new_open": (
        ServiceRequestStatus.NEW,
        ServiceRequestStatus.ASSIGNED,
    ),
    "active": (
        ServiceRequestStatus.IN_PROGRESS,
        ServiceRequestStatus.WAITING_ON_PARTS,
        ServiceRequestStatus.WAITING_FOR_APPROVAL,
        ServiceRequestStatus.WAITING_FOR_DEPOT_REPAIR,
        ServiceRequestStatus.WAITING_FOR_VENDOR_REPAIR,
    ),
    "completed": (ServiceRequestStatus.COMPLETED,),
}
# Everything not yet completed: the dashboard's broader sense of "open".
SERVICE_STATUS_GROUPS["open_all"] = (
    SERVICE_STATUS_GROUPS["new_open"] + SERVICE_STATUS_GROUPS["active"]
)

_GROUP_DESCRIPTION = {
    "new_open": "new and assigned requests (the module's Open tab)",
    "active": "requests in progress or waiting (the module's Active tab)",
    "completed": "completed requests",
    "open_all": "everything not yet completed (the dashboard's Open Requests)",
}


def _deep_link(path: str, **params: Any) -> str:
    """Build a link the frontend can actually open.

    The app has no per-record routes: every module is a wildcard route rendering
    a list page, so "/facilities/477" resolves to no child route and renders a
    blank screen. Each list page does read query parameters, so a citation links
    to the module pre-filtered to the record instead.
    """
    query = {key: str(value) for key, value in params.items() if value not in (None, "")}
    if not query:
        return path
    return "{}?{}".format(path, urlencode(query))


def resolve_entity(
    ctx: ToolContext,
    kind: str,
    query: str,
    limit: int = 5,
) -> ToolResult:
    """Turn a human-typed name or number into candidate records.

    Almost every question names an entity in words ("xyz facility", "the Miller
    service request"), so this is the first hop for most queries. Ambiguity is
    returned as multiple candidates rather than silently resolved -- the caller
    must ask which one was meant.
    """
    kind = (kind or "").strip().lower()
    if kind not in RESOLVABLE_KINDS:
        raise ToolInputError(
            "kind must be one of: {}".format(", ".join(RESOLVABLE_KINDS))
        )
    needle = (query or "").strip()
    if len(needle) < 2:
        raise ToolInputError("query must be at least 2 characters.")
    pattern = "%{}%".format(needle.replace("%", r"\%").replace("_", r"\_"))
    take = clamp_limit(limit)
    items: list[dict[str, Any]] = []

    if kind == "facility":
        ctx.require_module("facilities")
        base = ctx.scope_to_facilities(ctx.db.query(Facility).filter(Facility.live()), Facility.id)
        base = base.filter(Facility.name.ilike(pattern, escape="\\"))
        total = base.count()
        for facility in base.order_by(Facility.name).limit(take).all():
            items.append({
                "facility_id": facility.id,
                "name": facility.name,
                "city": facility.city,
                "state": facility.state,
                "status": facility.status,
                "route": _deep_link("/facilities", search=facility.name),
            })

    elif kind == "user":
        ctx.require_module("users")
        base = ctx.db.query(User).filter(or_(
            User.full_name.ilike(pattern, escape="\\"),
            User.username.ilike(pattern, escape="\\"),
        ))
        total = base.count()
        for user in base.order_by(User.full_name).limit(take).all():
            items.append({
                "user_id": user.id,
                "full_name": user.full_name,
                "username": user.username,
                "role": getattr(user.role, "value", str(user.role)),
                "is_active": bool(getattr(user, "is_active", True)),
                "route": _deep_link("/users", search=user.full_name),
            })

    elif kind == "service_request":
        ctx.require_module("service-requests")
        base = ctx.scope_to_facilities(
            ctx.db.query(ServiceRequest), ServiceRequest.facility_id
        ).filter(or_(
            ServiceRequest.request_number.ilike(pattern, escape="\\"),
            ServiceRequest.problem_description.ilike(pattern, escape="\\"),
        ))
        total = base.count()
        for request in base.order_by(ServiceRequest.created_at.desc()).limit(take).all():
            items.append({
                "service_request_id": request.id,
                "request_number": request.request_number,
                "status": getattr(request.status, "value", str(request.status)),
                "priority": getattr(request.priority, "value", str(request.priority)),
                "route": _deep_link("/service-requests", search=request.request_number),
            })

    elif kind == "inspection":
        ctx.require_module("inspections")
        base = ctx.scope_to_facilities(
            ctx.db.query(Inspection), Inspection.facility_id
        ).filter(Inspection.inspection_number.ilike(pattern, escape="\\"))
        total = base.count()
        for inspection in base.order_by(Inspection.scheduled_date.desc()).limit(take).all():
            items.append({
                "inspection_id": inspection.id,
                "inspection_number": inspection.inspection_number,
                "status": getattr(inspection.status, "value", str(inspection.status)),
                "route": _deep_link("/inspections", context_search=inspection.inspection_number),
            })

    elif kind == "space":
        # Rooms are named by people in two ways - the code on the door and the
        # name on the plan - so both are searched.
        ctx.require_module("locations")
        base = ctx.scope_to_facilities(ctx.db.query(Location), Location.facility_id).filter(
            Location.is_active.is_(True),
            or_(Location.code.ilike(pattern, escape="\\"), Location.name.ilike(pattern, escape="\\")),
        )
        total = base.count()
        for loc in base.order_by(func.length(Location.code), Location.code).limit(take).all():
            items.append({
                "location_id": loc.id,
                "code": loc.code,
                "name": loc.name,
                "type": loc.location_type,
                "facility_id": loc.facility_id,
                "route": "/locations?space={}".format(loc.id),
            })

    elif kind == "asset":
        ctx.require_module("facility-inventory")
        base = ctx.scope_to_facilities(ctx.db.query(Equipment), Equipment.facility_id).filter(or_(
            Equipment.asset_tag.ilike(pattern, escape="\\"),
            Equipment.serial_number.ilike(pattern, escape="\\"),
            (Equipment.make + " " + Equipment.model).ilike(pattern, escape="\\"),
            Equipment.asset_type.ilike(pattern.replace(" ", "_"), escape="\\"),
            # Equipment in the site categories is known by its name ("Generator 1").
            Equipment.name.ilike(pattern, escape="\\"),
            Equipment.equipment_type.ilike(pattern, escape="\\"),
        ))
        total = base.count()
        for asset in base.order_by(Equipment.asset_tag).limit(take).all():
            items.append({
                "asset_id": asset.id,
                "asset_tag": asset.asset_tag,
                "name": asset.name,
                "what": asset.equipment_type or asset.type_label
                or " ".join(p for p in (asset.make, asset.model) if p) or None,
                "where": " · ".join(p for p in (asset.building, asset.floor, asset.location) if p) or None,
                "location_id": asset.location_id,
                "facility_id": asset.facility_id,
                "route": "/assets?asset={}".format(asset.id),
            })

    else:  # invoice
        ctx.require_module("billing")
        base = scope_invoice_approval_visibility(
            ctx.scope_to_facilities(ctx.db.query(Invoice), Invoice.facility_id), ctx.user
        ).filter(Invoice.invoice_number.ilike(pattern, escape="\\"))
        total = base.count()
        for invoice in base.order_by(Invoice.issue_date.desc()).limit(take).all():
            items.append({
                "invoice_id": invoice.id,
                "invoice_number": invoice.invoice_number,
                "status": getattr(invoice.status, "value", str(invoice.status)),
                "balance_due": money(invoice.balance_due),
                "route": _deep_link("/billing", search=invoice.invoice_number),
            })

    notes: list[str] = []
    if total == 0:
        notes.append("No {} matched '{}'.".format(kind.replace("_", " "), needle))
    elif total > 1:
        notes.append(
            "{} candidates matched; confirm which one is meant before answering.".format(total)
        )
    return ToolResult(
        tool="resolve_entity",
        total_count=total,
        items=items,
        applied_filters={"kind": kind, "query": needle},
        notes=notes,
    )


def facility_detail(ctx: ToolContext, facility_id: int) -> ToolResult:
    """Full profile for one facility, including contact and address."""
    ctx.require_module("facilities", "view")
    facility = ctx.scope_to_facilities(
        ctx.db.query(Facility).filter(Facility.live()), Facility.id
    ).filter(Facility.id == facility_id).first()
    if facility is None:
        return ToolResult(
            tool="facility_detail",
            total_count=0,
            applied_filters={"facility_id": facility_id},
            notes=["No facility with id {} is visible to this account.".format(facility_id)],
        )

    physical = ", ".join(part for part in [
        facility.address, facility.suite, facility.city,
        facility.state, facility.zip_code, facility.country,
    ] if part)
    billing = ", ".join(part for part in [
        facility.billing_street, facility.billing_suite, facility.billing_city,
        facility.billing_state, facility.billing_zip_code,
    ] if part)

    notes: list[str] = []
    if billing and billing != physical:
        notes.append("Billing address differs from the physical address.")

    return ToolResult(
        tool="facility_detail",
        total_count=1,
        items=[{
            "facility_id": facility.id,
            "name": facility.name,
            "address": physical,
            "billing_address": billing or None,
            "phone": facility.phone,
            "email": facility.email,
            "contact_person": facility.contact_person,
            "website": facility.website,
            "status": facility.status,
            "timezone": facility.timezone,
            "operating_hours": facility.operating_hours,
            "route": _deep_link("/facilities", search=facility.name),
        }],
        applied_filters={"facility_id": facility_id},
        notes=notes,
    )


def facility_business_summary(
    ctx: ToolContext,
    facility_id: int,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> ToolResult:
    """Total business done with one facility, split by invoice stream.

    "Total business" is reported three ways -- invoiced, collected and
    outstanding -- because the phrase is ambiguous and a single number would
    silently pick one meaning. Cancelled invoices are excluded from totals and
    reported separately.
    """
    ctx.require_module("billing")
    validate_date_range(date_from, date_to)
    ctx.apply_statement_timeout()

    facility = ctx.scope_to_facilities(
        ctx.db.query(Facility), Facility.id
    ).filter(Facility.id == facility_id).first()
    if facility is None:
        return ToolResult(
            tool="facility_business_summary",
            total_count=0,
            applied_filters={"facility_id": facility_id},
            notes=["No facility with id {} is visible to this account.".format(facility_id)],
        )

    base = scope_invoice_approval_visibility(
        ctx.db.query(Invoice).filter(Invoice.facility_id == facility_id), ctx.user
    )
    if date_from:
        base = base.filter(Invoice.issue_date >= date_from)
    if date_to:
        base = base.filter(Invoice.issue_date <= date_to)

    active = base.filter(Invoice.status != InvoiceStatus.CANCELLED)

    # One grouped aggregate rather than four round-trips.
    rows = active.with_entities(
        Invoice.invoice_type.label("stream"),
        func.count().label("count"),
        func.coalesce(func.sum(Invoice.total_amount), 0).label("invoiced"),
        func.coalesce(func.sum(Invoice.amount_paid), 0).label("collected"),
        func.coalesce(func.sum(Invoice.balance_due), 0).label("outstanding"),
    ).group_by(Invoice.invoice_type).all()

    by_stream: list[dict[str, Any]] = []
    totals = {"invoiced": 0.0, "collected": 0.0, "outstanding": 0.0, "count": 0}
    row_map = {getattr(r.stream, "value", r.stream): r for r in rows}
    for stream in (InvoiceType.SALES, InvoiceType.RENTAL, InvoiceType.SERVICE, InvoiceType.INSPECTION):
        row = row_map.get(stream.value)
        entry = {
            "stream": stream.value,
            "invoice_count": int(row.count) if row else 0,
            "invoiced": money(row.invoiced) if row else 0.0,
            "collected": money(row.collected) if row else 0.0,
            "outstanding": money(row.outstanding) if row else 0.0,
        }
        by_stream.append(entry)
        totals["invoiced"] += entry["invoiced"]
        totals["collected"] += entry["collected"]
        totals["outstanding"] += entry["outstanding"]
        totals["count"] += entry["invoice_count"]

    overdue_count = active.filter(
        Invoice.status.in_([
            InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE
        ]),
        Invoice.due_date < date.today(),
    ).count()
    cancelled_count = base.filter(Invoice.status == InvoiceStatus.CANCELLED).count()

    notes = ["Totals exclude cancelled invoices."]
    if cancelled_count:
        notes.append("{} cancelled invoice(s) were excluded.".format(cancelled_count))
    if not date_from and not date_to:
        notes.append("Covers all time; no date range was applied.")

    return ToolResult(
        tool="facility_business_summary",
        # Items are the four revenue streams and are always returned in full, so
        # total_count describes the rows returned, not the invoices behind them.
        # The underlying invoice count is reported in aggregates.
        total_count=len(by_stream),
        items=by_stream,
        aggregates={
            "facility_id": facility.id,
            "facility_name": facility.name,
            "total_invoiced": round(totals["invoiced"], 2),
            "total_collected": round(totals["collected"], 2),
            "total_outstanding": round(totals["outstanding"], 2),
            "invoice_count": totals["count"],
            "overdue_invoice_count": overdue_count,
            "cancelled_invoice_count": cancelled_count,
        },
        applied_filters={
            "facility_id": facility_id,
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        },
        notes=notes,
    )


def search_inspections(
    ctx: ToolContext,
    inspector_id: Optional[int] = None,
    facility_id: Optional[int] = None,
    status: Optional[list[str]] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    count_assets: bool = False,
    limit: int = 25,
) -> ToolResult:
    """Find inspections, counted the way the Inspections module counts them.

    An "inspection" in this business is a scheduled visit to a facility -- an
    inspection batch -- which covers many assets. The ``inspections`` table holds
    one row per asset inspected inside a batch, so counting it returns a number
    an order of magnitude larger than anything shown in the UI.

    This tool therefore counts batches by default, matching the module, and
    always reports the per-asset total alongside it so the two numbers are
    reconciled rather than contradictory. Set ``count_assets`` only when the
    question is explicitly about individual assets or devices.

    Completed work is dated on ``completed_at``; anything else on
    ``scheduled_date``. Dating completed work by its scheduled date is a silent
    source of wrong counts.
    """
    ctx.require_module("inspections")
    validate_date_range(date_from, date_to)
    ctx.apply_statement_timeout()
    take = clamp_limit(limit)

    model = Inspection if count_assets else InspectionBatch
    unit = "asset inspections" if count_assets else "inspection visits (batches)"

    normalized_status: list[InspectionStatus] = []
    for value in status or []:
        try:
            normalized_status.append(InspectionStatus(value))
        except ValueError:
            raise ToolInputError(
                "'{}' is not a valid inspection status. Valid values: {}".format(
                    value, ", ".join(s.value for s in InspectionStatus)
                )
            )

    completed_only = normalized_status == [InspectionStatus.COMPLETED]
    start, end = datetime_bounds(date_from, date_to)

    def build(target):
        query = ctx.scope_to_facilities(ctx.db.query(target), target.facility_id)
        if inspector_id is not None:
            query = query.filter(target.inspector_id == inspector_id)
        if facility_id is not None:
            query = query.filter(target.facility_id == facility_id)
        if normalized_status:
            query = query.filter(target.status.in_(normalized_status))
        date_column = target.completed_at if completed_only else target.scheduled_date
        if start is not None:
            query = query.filter(date_column >= start)
        if end is not None:
            query = query.filter(date_column < end)
        return query

    query = build(model)
    total = query.count()
    # The counterpart total, so an answer can never imply the other number is
    # wrong when a user compares it against the module.
    other_total = build(Inspection if not count_assets else InspectionBatch).count()

    rows = query.order_by(model.scheduled_date.desc()).limit(take).all()
    facility_names = _facility_names(ctx, {r.facility_id for r in rows})
    inspector_names = _user_names(ctx, {r.inspector_id for r in rows if r.inspector_id})

    items = [{
        ("inspection_id" if count_assets else "batch_id"): row.id,
        ("inspection_number" if count_assets else "batch_number"): (
            row.inspection_number if count_assets else row.batch_number
        ),
        "status": getattr(row.status, "value", str(row.status)),
        "facility_id": row.facility_id,
        "facility_name": facility_names.get(row.facility_id),
        "inspector_id": row.inspector_id,
        "inspector_name": inspector_names.get(row.inspector_id),
        "scheduled_date": row.scheduled_date.isoformat() if row.scheduled_date else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        "route": _deep_link(
            "/inspections",
            context_search=(row.inspection_number if count_assets else row.batch_number),
        ),
    } for row in rows]

    notes = [
        "Counted {} — the same unit the Inspections module displays.".format(unit)
        if not count_assets
        else "Counted individual asset inspections, not the visits shown in the module.",
        "For the same filters: {} inspection visits (batches) and {} asset "
        "inspections.".format(
            total if not count_assets else other_total,
            other_total if not count_assets else total,
        ),
    ]

    return ToolResult(
        tool="search_inspections",
        total_count=total,
        items=items,
        aggregates={
            "unit": unit,
            "batch_count": total if not count_assets else other_total,
            "asset_inspection_count": other_total if not count_assets else total,
        },
        applied_filters={
            "counted": "batches" if not count_assets else "asset_inspections",
            "inspector_id": inspector_id,
            "facility_id": facility_id,
            "status": [s.value for s in normalized_status] or None,
            "date_field": "completed_at" if completed_only else "scheduled_date",
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        },
        notes=notes,
    )


def service_request_detail(
    ctx: ToolContext,
    service_request_id: Optional[int] = None,
    request_number: Optional[str] = None,
) -> ToolResult:
    """One service request, including who it is assigned to."""
    ctx.require_module("service-requests", "view")
    if service_request_id is None and not request_number:
        raise ToolInputError("Provide either service_request_id or request_number.")

    query = ctx.scope_to_facilities(ctx.db.query(ServiceRequest), ServiceRequest.facility_id)
    if service_request_id is not None:
        query = query.filter(ServiceRequest.id == service_request_id)
    else:
        query = query.filter(ServiceRequest.request_number == request_number)
    request = query.first()

    if request is None:
        return ToolResult(
            tool="service_request_detail",
            total_count=0,
            applied_filters={
                "service_request_id": service_request_id,
                "request_number": request_number,
            },
            notes=["No matching service request is visible to this account."],
        )

    names = _user_names(ctx, {request.assigned_technician_id, request.requester_id})
    facility_names = _facility_names(ctx, {request.facility_id})
    equipment = (
        ctx.db.query(Equipment).filter(Equipment.id == request.equipment_id).first()
        if request.equipment_id else None
    )

    assigned_name = names.get(request.assigned_technician_id)
    notes = [] if assigned_name else ["This request has no assigned technician."]

    return ToolResult(
        tool="service_request_detail",
        total_count=1,
        items=[{
            "service_request_id": request.id,
            "request_number": request.request_number,
            "status": getattr(request.status, "value", str(request.status)),
            "priority": getattr(request.priority, "value", str(request.priority)),
            "assigned_technician_id": request.assigned_technician_id,
            "assigned_technician_name": assigned_name,
            "requester_name": names.get(request.requester_id),
            "facility_id": request.facility_id,
            "facility_name": facility_names.get(request.facility_id),
            "equipment": getattr(equipment, "asset_tag", None),
            "problem_description": (request.problem_description or "")[:600],
            "created_at": request.created_at.isoformat() if request.created_at else None,
            "completed_at": request.completed_at.isoformat() if request.completed_at else None,
            "route": _deep_link("/service-requests", search=request.request_number),
        }],
        applied_filters={
            "service_request_id": service_request_id,
            "request_number": request_number,
        },
        notes=notes,
    )


def search_service_requests(
    ctx: ToolContext,
    facility_id: Optional[int] = None,
    assigned_technician_id: Optional[int] = None,
    status: Optional[list[str]] = None,
    status_group: Optional[str] = None,
    priority: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    trade: Optional[str] = None,
    location_id: Optional[int] = None,
    asset_id: Optional[int] = None,
    work_order_type: Optional[str] = None,
    sla_breached: Optional[bool] = None,
    limit: int = 25,
) -> ToolResult:
    """Find service requests by facility, technician, status or priority.

    Prefer ``status_group`` over listing statuses by hand: "open" is ambiguous
    in this product, and the group names map to exactly what each screen shows.
    """
    ctx.require_module("service-requests")
    validate_date_range(date_from, date_to)
    ctx.apply_statement_timeout()
    take = clamp_limit(limit)

    query = ctx.scope_to_facilities(ctx.db.query(ServiceRequest), ServiceRequest.facility_id)
    if facility_id is not None:
        query = query.filter(ServiceRequest.facility_id == facility_id)
    if assigned_technician_id is not None:
        query = query.filter(ServiceRequest.assigned_technician_id == assigned_technician_id)

    normalized: list[ServiceRequestStatus] = []
    for value in status or []:
        try:
            normalized.append(ServiceRequestStatus(value))
        except ValueError:
            raise ToolInputError(
                "'{}' is not a valid service request status. Valid values: {}".format(
                    value, ", ".join(s.value for s in ServiceRequestStatus)
                )
            )

    group_note: Optional[str] = None
    if status_group:
        group = status_group.strip().lower()
        if group not in SERVICE_STATUS_GROUPS:
            raise ToolInputError(
                "'{}' is not a valid status group. Valid values: {}".format(
                    status_group, ", ".join(sorted(SERVICE_STATUS_GROUPS))
                )
            )
        normalized = list(SERVICE_STATUS_GROUPS[group])
        group_note = "Counted {}.".format(_GROUP_DESCRIPTION[group])

    if normalized:
        query = query.filter(ServiceRequest.status.in_(normalized))
    if priority:
        query = query.filter(ServiceRequest.priority == priority)
    if trade:
        trade_row = ctx.db.query(Discipline.id).filter(Discipline.code == trade).first()
        if trade_row is None:
            raise ToolInputError("Unknown trade '{}'. Valid values: {}".format(
                trade, ", ".join(sorted(c for (c,) in ctx.db.query(Discipline.code)))))
        query = query.filter(ServiceRequest.discipline_id == trade_row[0])
    if location_id is not None:
        from app.services import location_tree
        anchor = ctx.db.get(Location, location_id)
        if anchor is None:
            raise ToolInputError("No space with id {}.".format(location_id))
        inside = ctx.db.query(Location.id).filter(location_tree.subtree_filter(anchor))
        query = query.filter(or_(ServiceRequest.location_id == anchor.id,
                                 ServiceRequest.location_id.in_(inside)))
    if asset_id is not None:
        query = query.filter(ServiceRequest.equipment_id == asset_id)
    if work_order_type:
        query = query.filter(ServiceRequest.work_order_type == work_order_type)
    if sla_breached is not None:
        query = query.filter(ServiceRequest.sla_breached.is_(bool(sla_breached)))

    start, end = datetime_bounds(date_from, date_to)
    if start is not None:
        query = query.filter(ServiceRequest.created_at >= start)
    if end is not None:
        query = query.filter(ServiceRequest.created_at < end)

    total = query.count()
    rows = query.order_by(ServiceRequest.created_at.desc()).limit(take).all()
    facility_names = _facility_names(ctx, {r.facility_id for r in rows})
    tech_names = _user_names(ctx, {r.assigned_technician_id for r in rows if r.assigned_technician_id})
    trade_names = {pk: name for pk, name in ctx.db.query(Discipline.id, Discipline.name)}
    space_ids = {r.location_id for r in rows if r.location_id}
    spaces = ({loc.id: loc for loc in ctx.db.query(Location).filter(Location.id.in_(space_ids))}
              if space_ids else {})

    items = [{
        "service_request_id": row.id,
        "request_number": row.request_number,
        "status": getattr(row.status, "value", str(row.status)),
        "priority": getattr(row.priority, "value", str(row.priority)),
        "facility_name": facility_names.get(row.facility_id),
        "assigned_technician_name": tech_names.get(row.assigned_technician_id),
        "trade": trade_names.get(row.discipline_id),
        "space": (lambda loc: "{} · {}".format(loc.code, loc.name) if loc and loc.name
                  else (loc.code if loc else None))(spaces.get(row.location_id)),
        "summary": (row.problem_description or "")[:160],
        "sla_due_at": row.sla_due_at.isoformat() if row.sla_due_at else None,
        "sla_breached": bool(row.sla_breached),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "route": _deep_link("/service-requests", search=row.request_number),
    } for row in rows]

    notes: list[str] = []
    if group_note:
        notes.append(group_note)
        # "Open" differs between the module and the dashboard, so when either
        # open-ish group is asked for, give both totals rather than letting the
        # answer contradict whichever screen the reader checks.
        if status_group in {"new_open", "open_all"}:
            counterpart = "open_all" if status_group == "new_open" else "new_open"
            other = query.session.query(ServiceRequest)
            other = ctx.scope_to_facilities(other, ServiceRequest.facility_id).filter(
                ServiceRequest.status.in_(SERVICE_STATUS_GROUPS[counterpart])
            )
            if facility_id is not None:
                other = other.filter(ServiceRequest.facility_id == facility_id)
            if assigned_technician_id is not None:
                other = other.filter(
                    ServiceRequest.assigned_technician_id == assigned_technician_id
                )
            notes.append(
                "For comparison, {} gives {}.".format(
                    _GROUP_DESCRIPTION[counterpart], other.count()
                )
            )

    return ToolResult(
        tool="search_service_requests",
        total_count=total,
        items=items,
        applied_filters={
            "facility_id": facility_id,
            "assigned_technician_id": assigned_technician_id,
            "status_group": status_group,
            "status": [s.value for s in normalized] or None,
            "priority": priority,
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
            "trade": trade,
            "location_id": location_id,
            "asset_id": asset_id,
            "work_order_type": work_order_type,
            "sla_breached": sla_breached,
        },
        notes=notes,
    )


def search_invoices(
    ctx: ToolContext,
    facility_id: Optional[int] = None,
    status: Optional[list[str]] = None,
    invoice_type: Optional[list[str]] = None,
    overdue_only: bool = False,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = 25,
) -> ToolResult:
    """Find invoices with balances and aging, plus SQL-computed totals."""
    ctx.require_module("billing")
    validate_date_range(date_from, date_to)
    ctx.apply_statement_timeout()
    take = clamp_limit(limit)

    query = scope_invoice_approval_visibility(
        ctx.scope_to_facilities(ctx.db.query(Invoice), Invoice.facility_id), ctx.user
    )
    if facility_id is not None:
        query = query.filter(Invoice.facility_id == facility_id)

    normalized_status: list[InvoiceStatus] = []
    for value in status or []:
        try:
            normalized_status.append(InvoiceStatus(value))
        except ValueError:
            raise ToolInputError(
                "'{}' is not a valid invoice status. Valid values: {}".format(
                    value, ", ".join(s.value for s in InvoiceStatus)
                )
            )
    if normalized_status:
        query = query.filter(Invoice.status.in_(normalized_status))

    normalized_type: list[InvoiceType] = []
    for value in invoice_type or []:
        try:
            normalized_type.append(InvoiceType(value))
        except ValueError:
            raise ToolInputError(
                "'{}' is not a valid invoice type. Valid values: {}".format(
                    value, ", ".join(t.value for t in InvoiceType)
                )
            )
    if normalized_type:
        query = query.filter(Invoice.invoice_type.in_(normalized_type))

    if overdue_only:
        query = query.filter(
            Invoice.status.in_([
                InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE
            ]),
            Invoice.due_date < date.today(),
        )
    if date_from:
        query = query.filter(Invoice.issue_date >= date_from)
    if date_to:
        query = query.filter(Invoice.issue_date <= date_to)

    totals = query.with_entities(
        func.count().label("count"),
        func.coalesce(func.sum(Invoice.total_amount), 0).label("invoiced"),
        func.coalesce(func.sum(Invoice.balance_due), 0).label("outstanding"),
    ).one()

    rows = query.order_by(Invoice.due_date.asc()).limit(take).all()
    facility_names = _facility_names(ctx, {r.facility_id for r in rows if r.facility_id})
    today = date.today()

    items = [{
        "invoice_id": row.id,
        "invoice_number": row.invoice_number,
        "invoice_type": getattr(row.invoice_type, "value", str(row.invoice_type)),
        "status": getattr(row.status, "value", str(row.status)),
        "facility_name": facility_names.get(row.facility_id),
        "total_amount": money(row.total_amount),
        "balance_due": money(row.balance_due),
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "days_overdue": (today - row.due_date).days if row.due_date and row.due_date < today else 0,
        "route": _deep_link("/billing", search=row.invoice_number),
    } for row in rows]

    return ToolResult(
        tool="search_invoices",
        total_count=int(totals.count or 0),
        items=items,
        aggregates={
            "total_invoiced": money(totals.invoiced),
            "total_outstanding": money(totals.outstanding),
        },
        applied_filters={
            "facility_id": facility_id,
            "status": [s.value for s in normalized_status] or None,
            "invoice_type": [t.value for t in normalized_type] or None,
            "overdue_only": overdue_only,
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        },
    )


def _facility_names(ctx: ToolContext, ids: set[Optional[int]]) -> dict[int, str]:
    clean = {i for i in ids if i}
    if not clean:
        return {}
    rows = ctx.db.query(Facility.id, Facility.name).filter(Facility.id.in_(clean)).all()
    return {row.id: row.name for row in rows}


def _user_names(ctx: ToolContext, ids: set[Optional[int]]) -> dict[int, str]:
    clean = {i for i in ids if i}
    if not clean:
        return {}
    rows = ctx.db.query(User.id, User.full_name).filter(User.id.in_(clean)).all()
    return {row.id: row.full_name for row in rows}


def search_users(
    ctx: ToolContext,
    role: Optional[list[str]] = None,
    is_active: Optional[bool] = None,
    facility_id: Optional[int] = None,
    name: Optional[str] = None,
    limit: int = 25,
) -> ToolResult:
    """Find or count people by role, activity or facility.

    Answers "how many technicians are there". resolve_entity finds a named
    person; this counts a population, which resolve_entity cannot do because it
    requires a search term.

    Active and total are always reported separately: an inactive account still
    exists but is not someone who can be assigned work, so a single number would
    mean different things to different readers.
    """
    ctx.require_module("users")
    ctx.apply_statement_timeout()
    take = clamp_limit(limit)

    query = ctx.db.query(User)

    normalized: list[UserRole] = []
    for value in role or []:
        try:
            normalized.append(UserRole(value))
        except ValueError:
            raise ToolInputError(
                "'{}' is not a valid role. Valid values: {}".format(
                    value, ", ".join(r.value for r in UserRole)
                )
            )
    if normalized:
        query = query.filter(User.role.in_(normalized))
    if is_active is not None:
        query = query.filter(User.is_active.is_(bool(is_active)))
    if facility_id is not None:
        query = query.filter(User.facility_id == facility_id)
    if name:
        pattern = "%{}%".format(name.replace("%", r"\%").replace("_", r"\_"))
        query = query.filter(or_(
            User.full_name.ilike(pattern, escape="\\"),
            User.username.ilike(pattern, escape="\\"),
        ))

    totals = query.with_entities(
        func.count().label("total"),
        func.count().filter(User.is_active.is_(True)).label("active"),
    ).one()

    by_role = {
        (getattr(row.role, "value", row.role)): int(row.count)
        for row in query.with_entities(
            User.role.label("role"), func.count().label("count")
        ).group_by(User.role).all()
    }

    rows = query.order_by(User.full_name).limit(take).all()
    facility_names = _facility_names(ctx, {r.facility_id for r in rows if r.facility_id})

    items = [{
        "user_id": row.id,
        "full_name": row.full_name,
        "username": row.username,
        "role": getattr(row.role, "value", str(row.role)),
        "is_active": bool(row.is_active),
        "facility_name": facility_names.get(row.facility_id),
        "route": _deep_link("/users", search=row.full_name),
    } for row in rows]

    notes = [
        "Counts people, not their assignments. Use search_service_requests "
        "with assigned_technician_id for a person's workload.",
    ]

    # A named person filtered out by role reads as "no such person", which is a
    # different claim from the true one. The recorded role is authoritative --
    # an admin with service requests assigned is an admin, not a mislabelled
    # technician -- so name the person and state the role they actually hold.
    if name and normalized and int(totals.total or 0) == 0:
        fallback = ctx.db.query(User).filter(or_(
            User.full_name.ilike(pattern, escape="\\"),
            User.username.ilike(pattern, escape="\\"),
        ))
        matches = fallback.order_by(User.full_name).limit(5).all()
        if matches:
            described = ", ".join(
                "{} ({})".format(row.full_name, getattr(row.role, "value", row.role))
                for row in matches
            )
            notes.append(
                "No user named '{}' holds the requested role. These users "
                "match the name and hold these roles: {}. Say that the person "
                "exists and give their actual role -- do not report them as "
                "missing, and do not treat them as holding the asked-for role."
                .format(name, described)
            )

    return ToolResult(
        tool="search_users",
        total_count=int(totals.total or 0),
        items=items,
        aggregates={
            "total": int(totals.total or 0),
            "active": int(totals.active or 0),
            "inactive": int((totals.total or 0) - (totals.active or 0)),
            "by_role": by_role,
        },
        applied_filters={
            "role": [r.value for r in normalized] or None,
            "is_active": is_active,
            "facility_id": facility_id,
            "name": name,
        },
        notes=notes,
    )
