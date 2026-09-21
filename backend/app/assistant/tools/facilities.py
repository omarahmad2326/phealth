"""Read-only assistant tools for running a hospital's buildings.

Sites, spaces, the fixtures and assets in them, maintenance plans, compliance
tasks and book value. Each tool reuses the query the corresponding screen uses
where one exists, so the assistant and the screen cannot disagree, and each
returns ``total_count`` from SQL so the model reports totals it was given.

Every item carries a ``route`` into the product, which becomes a citation the
person can click to check the answer against the screen.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy import func, or_

from app.assistant.tools.base import ToolContext, ToolInputError, ToolResult, clamp_limit, money
from app.models.compliance import ComplianceProgram, ComplianceTask, ComplianceTaskStatus
from app.models.discipline import Discipline
from app.models.equipment import Equipment, EquipmentStatus
from app.models.facility import Facility
from app.models.fixture import Fixture
from app.models.location import Location
from app.models.maintenance_schedule import MaintenanceSchedule, ScheduleStatus
from app.models.service_request import ServiceRequest, ServiceRequestStatus
from app.services import asset_catalog, asset_register, fixture_catalog, location_tree
from app.services import asset_ledger
from app.services import site_overview as site_overview_service

# Work that is finished, as the enum the column stores. Compared as members,
# not strings, so it behaves the same on PostgreSQL as it does in tests.
CLOSED_WORK = (ServiceRequestStatus.COMPLETED, ServiceRequestStatus.CANCELLED)

OPEN_TASK_STATUSES = (
    ComplianceTaskStatus.SCHEDULED.value,
    ComplianceTaskStatus.IN_PROGRESS.value,
    ComplianceTaskStatus.OVERDUE.value,
)


# ── helpers ──────────────────────────────────────────────────────────────────

def _escape_like(value: str) -> str:
    return "%{}%".format(value.strip().replace("%", r"\%").replace("_", r"\_"))


def _trades(ctx: ToolContext) -> dict[int, tuple[str, str]]:
    return {pk: (code, name) for pk, code, name in ctx.db.query(Discipline.id, Discipline.code, Discipline.name)}


def _trade_id(ctx: ToolContext, code: Optional[str]) -> Optional[int]:
    if not code:
        return None
    for pk, (trade_code, _name) in _trades(ctx).items():
        if trade_code == code:
            return pk
    raise ToolInputError("Unknown trade '{}'. Valid values: {}".format(
        code, ", ".join(sorted(c for c, _n in _trades(ctx).values()))))


def _space_label(location: Optional[Location]) -> Optional[str]:
    if location is None:
        return None
    return "{} · {}".format(location.code, location.name) if location.name else location.code


def _space_or_error(ctx: ToolContext, location_id: int) -> Location:
    location = ctx.db.get(Location, location_id)
    if location is None:
        raise ToolInputError("No space with id {}.".format(location_id))
    allowed = ctx.facility_ids()
    if allowed is not None and location.facility_id not in allowed:
        raise ToolInputError("No space with id {}.".format(location_id))
    return location


def _facility_filter(ctx: ToolContext, query, column, facility_id: Optional[int]):
    query = ctx.scope_to_facilities(query, column)
    if facility_id is not None:
        query = query.filter(column == facility_id)
    return query


def _spaces_by_id(ctx: ToolContext, ids: set[Optional[int]]) -> dict[int, Location]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {loc.id: loc for loc in ctx.db.query(Location).filter(Location.id.in_(ids))}


# ── sites ────────────────────────────────────────────────────────────────────

def site_overview(ctx: ToolContext, facility_id: int) -> ToolResult:
    """One site at a glance: spaces, beds, availability, work and compliance."""
    ctx.require_module("facilities")
    allowed = ctx.facility_ids()
    if allowed is not None and facility_id not in allowed:
        raise ToolInputError("No site with id {}.".format(facility_id))
    facility = ctx.db.get(Facility, facility_id)
    if facility is None:
        raise ToolInputError("No site with id {}.".format(facility_id))
    ctx.apply_statement_timeout()
    overview = site_overview_service.build(ctx.db, facility_id)
    return ToolResult(
        tool="site_overview",
        total_count=1,
        items=[{"facility_id": facility.id, "name": facility.name, "overview": overview,
                "route": "/sites/{}".format(facility.id)}],
        applied_filters={"facility_id": facility_id},
    )


# ── spaces ───────────────────────────────────────────────────────────────────

def search_spaces(
    ctx: ToolContext,
    facility_id: Optional[int] = None,
    query: Optional[str] = None,
    location_type: Optional[str] = None,
    space_use: Optional[str] = None,
    criticality: Optional[str] = None,
    limit: int = 25,
) -> ToolResult:
    """Find buildings, floors, departments and rooms by code, name, use or criticality."""
    ctx.require_module("locations")
    ctx.apply_statement_timeout()
    rows = _facility_filter(ctx, ctx.db.query(Location), Location.facility_id, facility_id)
    rows = rows.filter(Location.is_active.is_(True))
    if query and query.strip():
        pattern = _escape_like(query)
        rows = rows.filter(or_(Location.code.ilike(pattern, escape="\\"),
                               Location.name.ilike(pattern, escape="\\")))
    if location_type:
        rows = rows.filter(Location.location_type == location_type)
    if space_use:
        rows = rows.filter(Location.space_use == space_use)
    if criticality:
        rows = rows.filter(Location.criticality == criticality)

    total = rows.count()
    found = rows.order_by(Location.path).limit(clamp_limit(limit)).all()
    parents = _spaces_by_id(ctx, {loc.parent_id for loc in found})
    items = [{
        "location_id": loc.id,
        "code": loc.code,
        "name": loc.name,
        "type": loc.location_type,
        "space_use": loc.space_use,
        "criticality": loc.criticality,
        "inside": _space_label(parents.get(loc.parent_id)),
        "facility_id": loc.facility_id,
        "route": "/locations?space={}".format(loc.id),
    } for loc in found]
    return ToolResult(
        tool="search_spaces", total_count=total, items=items,
        applied_filters={"facility_id": facility_id, "query": query, "location_type": location_type,
                         "space_use": space_use, "criticality": criticality},
    )


def space_contents(ctx: ToolContext, location_id: int) -> ToolResult:
    """What is in a space and everything beneath it: spaces, fixtures, assets, open work."""
    ctx.require_module("locations")
    ctx.apply_statement_timeout()
    space = _space_or_error(ctx, location_id)
    inside = ctx.db.query(Location.id).filter(location_tree.subtree_filter(space),
                                              Location.is_active.is_(True))
    ids = [space.id, *[row[0] for row in inside if row[0] != space.id]]

    child_types = Counter(t for (t,) in ctx.db.query(Location.location_type).filter(
        Location.parent_id == space.id, Location.is_active.is_(True)))

    fixtures = Counter()
    faulty = Counter()
    for fixture_type, status, count in (
        ctx.db.query(Fixture.fixture_type, Fixture.status, func.count(Fixture.id))
        .filter(Fixture.location_id.in_(ids), Fixture.is_active.is_(True))
        .group_by(Fixture.fixture_type, Fixture.status)
    ):
        label = fixture_catalog.BY_TYPE.get(fixture_type, {}).get("label") or fixture_type.replace("_", " ")
        fixtures[label] += count
        if status != "working":
            faulty["{} ({})".format(label, status)] += count

    assets = Counter()
    for asset_type, make, model, count in (
        ctx.db.query(Equipment.asset_type, Equipment.make, Equipment.model, func.count(Equipment.id))
        .filter(Equipment.location_id.in_(ids))
        .group_by(Equipment.asset_type, Equipment.make, Equipment.model)
    ):
        label = asset_catalog.label_for(asset_type) or " ".join(p for p in (make, model) if p) or "Unnamed asset"
        assets[label] += count

    open_work = (
        ctx.db.query(func.count(ServiceRequest.id))
        .filter(ServiceRequest.location_id.in_(ids),
                ServiceRequest.status.notin_(CLOSED_WORK))
        .scalar() or 0
    )
    return ToolResult(
        tool="space_contents",
        total_count=1,
        items=[{
            "location_id": space.id,
            "space": _space_label(space),
            "type": space.location_type,
            "criticality": space.criticality,
            "spaces_directly_inside": dict(child_types),
            "fixtures_by_type": dict(fixtures),
            "fixtures_not_working": dict(faulty),
            "assets_by_type": dict(assets),
            "open_work_orders": int(open_work),
            "route": "/locations?space={}".format(space.id),
        }],
        applied_filters={"location_id": location_id, "includes_everything_inside": True},
    )


# ── fixtures ─────────────────────────────────────────────────────────────────

def search_fixtures(
    ctx: ToolContext,
    facility_id: Optional[int] = None,
    location_id: Optional[int] = None,
    status: Optional[str] = None,
    fixture_type: Optional[str] = None,
    trade: Optional[str] = None,
    limit: int = 25,
) -> ToolResult:
    """Find fixtures - sockets, lights, gas outlets - by space, status, type or trade."""
    ctx.require_module("locations")
    ctx.apply_statement_timeout()
    rows = _facility_filter(ctx, ctx.db.query(Fixture), Fixture.facility_id, facility_id)
    rows = rows.filter(Fixture.is_active.is_(True))
    if location_id is not None:
        space = _space_or_error(ctx, location_id)
        inside = ctx.db.query(Location.id).filter(location_tree.subtree_filter(space))
        rows = rows.filter(or_(Fixture.location_id == space.id, Fixture.location_id.in_(inside)))
    if status:
        rows = rows.filter(Fixture.status == status)
    if fixture_type:
        rows = rows.filter(Fixture.fixture_type == fixture_type)
    trade_id = _trade_id(ctx, trade)
    if trade_id is not None:
        rows = rows.filter(Fixture.discipline_id == trade_id)

    total = rows.count()
    found = rows.order_by(Fixture.location_id, Fixture.code).limit(clamp_limit(limit)).all()
    spaces = _spaces_by_id(ctx, {f.location_id for f in found})
    trades = _trades(ctx)
    items = [{
        "fixture_id": f.id,
        "code": f.code,
        "type": fixture_catalog.BY_TYPE.get(f.fixture_type, {}).get("label") or f.fixture_type,
        "status": f.status,
        "space": _space_label(spaces.get(f.location_id)),
        "location_id": f.location_id,
        "trade": trades.get(f.discipline_id, (None, None))[1],
        "work_order_id": f.work_order_id,
        "route": "/locations?space={}".format(f.location_id),
    } for f in found]
    return ToolResult(
        tool="search_fixtures", total_count=total, items=items,
        applied_filters={"facility_id": facility_id, "location_id": location_id, "status": status,
                         "fixture_type": fixture_type, "trade": trade},
    )


# ── assets ───────────────────────────────────────────────────────────────────

def search_assets(
    ctx: ToolContext,
    facility_id: Optional[int] = None,
    query: Optional[str] = None,
    location_id: Optional[int] = None,
    kind: Optional[str] = None,
    asset_type: Optional[str] = None,
    trade: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 25,
) -> ToolResult:
    """Find assets - machinery, clinical equipment, room items - with the register's own filters."""
    ctx.require_module("facility-inventory")
    ctx.apply_statement_timeout()
    rows = asset_register.register_query(
        ctx.db, ctx.user, facility_id=facility_id, search=query, location_id=location_id,
        kind=kind, asset_type=asset_type, discipline_id=_trade_id(ctx, trade),
    )
    if status:
        try:
            rows = rows.filter(Equipment.status == EquipmentStatus(status.lower()))
        except ValueError:
            raise ToolInputError("Unknown asset status '{}'. Valid values: {}".format(
                status, ", ".join(s.value for s in EquipmentStatus)))
    total = rows.count()
    found = rows.order_by(Equipment.asset_tag).limit(clamp_limit(limit)).all()
    spaces = _spaces_by_id(ctx, {a.location_id for a in found})
    trades = _trades(ctx)
    items = [{
        "asset_id": a.id,
        "asset_tag": a.asset_tag,
        "what": a.type_label or " ".join(p for p in (a.make, a.model) if p) or None,
        "kind": "room item" if a.asset_type else ("clinical equipment" if a.modality_id else "machinery"),
        "status": getattr(a.status, "value", str(a.status)),
        "criticality": a.criticality,
        "space": _space_label(spaces.get(a.location_id)),
        "trade": trades.get(a.discipline_id, (None, None))[1],
        "cost": money(a.cost) if a.cost is not None else None,
        "route": "/assets?asset={}".format(a.id),
    } for a in found]
    return ToolResult(
        tool="search_assets", total_count=total, items=items,
        applied_filters={"facility_id": facility_id, "query": query, "location_id": location_id,
                         "kind": kind, "asset_type": asset_type, "trade": trade, "status": status},
    )


def asset_detail(ctx: ToolContext, asset_id: Optional[int] = None, asset_tag: Optional[str] = None) -> ToolResult:
    """One asset: where it is, what it serves, its open work, next maintenance and book value."""
    ctx.require_module("facility-inventory")
    ctx.apply_statement_timeout()
    rows = ctx.scope_to_facilities(ctx.db.query(Equipment), Equipment.facility_id)
    if asset_id is not None:
        asset = rows.filter(Equipment.id == asset_id).first()
    elif asset_tag:
        asset = rows.filter(func.lower(Equipment.asset_tag) == asset_tag.strip().lower()).first()
    else:
        raise ToolInputError("Give asset_id or asset_tag.")
    if asset is None:
        return ToolResult(tool="asset_detail", total_count=0,
                          notes=["No asset matches; try search_assets."],
                          applied_filters={"asset_id": asset_id, "asset_tag": asset_tag})

    from app.models.asset_link import AssetServesLocation
    served = (
        ctx.db.query(Location, AssetServesLocation.service_type)
        .join(AssetServesLocation, AssetServesLocation.location_id == Location.id)
        .filter(AssetServesLocation.equipment_id == asset.id).all()
    )
    open_work = (
        ctx.db.query(ServiceRequest)
        .filter(ServiceRequest.equipment_id == asset.id,
                ServiceRequest.status.notin_(CLOSED_WORK))
        .order_by(ServiceRequest.created_at.desc()).limit(10).all()
    )
    plans = (
        ctx.db.query(MaintenanceSchedule)
        .filter(MaintenanceSchedule.equipment_id == asset.id,
                MaintenanceSchedule.status == ScheduleStatus.ACTIVE.value)
        .order_by(MaintenanceSchedule.next_due_date).all()
    )
    book = asset_ledger.summary(ctx.db, asset)["depreciation"]
    trades = _trades(ctx)
    item = {
        "asset_id": asset.id,
        "asset_tag": asset.asset_tag,
        "what": asset.type_label or " ".join(p for p in (asset.make, asset.model) if p) or None,
        "serial_number": asset.serial_number or None,
        "status": getattr(asset.status, "value", str(asset.status)),
        "criticality": asset.criticality,
        "trade": trades.get(asset.discipline_id, (None, None))[1],
        "space": _space_label(ctx.db.get(Location, asset.location_id) if asset.location_id else None),
        "serves": [{"space": _space_label(loc), "supplies": service} for loc, service in served],
        "open_work_orders": [{"request_number": w.request_number,
                              "status": getattr(w.status, "value", str(w.status)),
                              "priority": getattr(w.priority, "value", str(w.priority))} for w in open_work],
        "maintenance_plans": [{"name": p.name, "next_due_date": p.next_due_date.isoformat() if p.next_due_date else None}
                              for p in plans],
        "cost": money(asset.cost) if asset.cost is not None else None,
        # Only meaningful with a cost and an in-service date; otherwise say why.
        "net_book_value": money(book.net_book_value) if book.in_service_date and asset.cost else None,
        "book_value_note": book.message,
        "route": "/assets?asset={}".format(asset.id),
    }
    return ToolResult(tool="asset_detail", total_count=1, items=[item],
                      applied_filters={"asset_id": asset_id, "asset_tag": asset_tag})


def asset_value(ctx: ToolContext, facility_id: int) -> ToolResult:
    """Cost, accumulated depreciation and book value for a site's assets, by trade."""
    ctx.require_module("facility-inventory")
    allowed = ctx.facility_ids()
    if allowed is not None and facility_id not in allowed:
        raise ToolInputError("No site with id {}.".format(facility_id))
    ctx.apply_statement_timeout()
    valuation = asset_ledger.fleet_valuation(ctx.db, facility_ids=[facility_id])
    aggregates = {
        "asset_count": valuation["asset_count"],
        "total_cost": money(valuation["total_cost"]),
        "accumulated_depreciation": money(valuation["accumulated_depreciation"]),
        "net_book_value": money(valuation["net_book_value"]),
        "fully_depreciated_count": valuation["fully_depreciated_count"],
        "by_trade": {
            trade: {key: (money(v) if not isinstance(v, int) else v) for key, v in bucket.items()}
            for trade, bucket in (valuation.get("by_discipline") or {}).items()
        },
    }
    return ToolResult(tool="asset_value", total_count=valuation["asset_count"], aggregates=aggregates,
                      items=[{"route": "/asset-ledger"}],
                      applied_filters={"facility_id": facility_id},
                      notes=["Only assets with a cost and an in-service date carry a book value."])


# ── planned work and compliance ──────────────────────────────────────────────

def maintenance_due(
    ctx: ToolContext,
    facility_id: Optional[int] = None,
    within_days: int = 30,
    overdue_only: bool = False,
    trade: Optional[str] = None,
    limit: int = 25,
) -> ToolResult:
    """Maintenance plans falling due within a window, or already overdue."""
    ctx.require_module("maintenance")
    ctx.apply_statement_timeout()
    today = date.today()
    within_days = max(0, min(int(within_days or 0), 366))
    rows = _facility_filter(ctx, ctx.db.query(MaintenanceSchedule), MaintenanceSchedule.facility_id, facility_id)
    rows = rows.filter(MaintenanceSchedule.status == ScheduleStatus.ACTIVE.value,
                       MaintenanceSchedule.next_due_date.isnot(None))
    if overdue_only:
        rows = rows.filter(MaintenanceSchedule.next_due_date < today)
    else:
        rows = rows.filter(MaintenanceSchedule.next_due_date <= today + timedelta(days=within_days))
    trade_id = _trade_id(ctx, trade)
    if trade_id is not None:
        rows = rows.filter(MaintenanceSchedule.discipline_id == trade_id)

    total = rows.count()
    overdue = rows.filter(MaintenanceSchedule.next_due_date < today).count()
    found = rows.order_by(MaintenanceSchedule.next_due_date).limit(clamp_limit(limit)).all()
    assets = {a.id: a for a in ctx.db.query(Equipment).filter(
        Equipment.id.in_({p.equipment_id for p in found if p.equipment_id}))} if found else {}
    spaces = _spaces_by_id(ctx, {p.location_id for p in found})
    items = [{
        "plan": p.name,
        "next_due_date": p.next_due_date.isoformat(),
        "overdue": p.next_due_date < today,
        "asset_tag": assets[p.equipment_id].asset_tag if p.equipment_id in assets else None,
        "space": _space_label(spaces.get(p.location_id)),
        "has_open_work_order": bool(p.open_work_order_id),
        "route": "/assets?asset={}".format(p.equipment_id) if p.equipment_id else "/maintenance",
    } for p in found]
    return ToolResult(
        tool="maintenance_due", total_count=total, items=items, aggregates={"overdue": overdue},
        applied_filters={"facility_id": facility_id, "within_days": None if overdue_only else within_days,
                         "overdue_only": overdue_only, "trade": trade, "as_of": today.isoformat()},
    )


def compliance_due(
    ctx: ToolContext,
    facility_id: Optional[int] = None,
    within_days: int = 30,
    overdue_only: bool = False,
    limit: int = 25,
) -> ToolResult:
    """Regulatory compliance tasks due within a window, overdue or missed."""
    ctx.require_module("compliance")
    ctx.apply_statement_timeout()
    today = date.today()
    within_days = max(0, min(int(within_days or 0), 366))
    rows = _facility_filter(ctx, ctx.db.query(ComplianceTask, ComplianceProgram)
                            .join(ComplianceProgram, ComplianceProgram.id == ComplianceTask.program_id),
                            ComplianceTask.facility_id, facility_id)
    if overdue_only:
        rows = rows.filter(or_(ComplianceTask.status.in_((ComplianceTaskStatus.OVERDUE.value,
                                                          ComplianceTaskStatus.MISSED.value)),
                               (ComplianceTask.status.in_(OPEN_TASK_STATUSES)) & (ComplianceTask.due_date < today)))
    else:
        rows = rows.filter(ComplianceTask.status.in_(OPEN_TASK_STATUSES),
                           ComplianceTask.due_date <= today + timedelta(days=within_days))
    total = rows.count()
    found = rows.order_by(ComplianceTask.due_date).limit(clamp_limit(limit)).all()
    items = [{
        "program": program.name,
        "authority": program.authority,
        "citation": program.citation,
        "due_date": task.due_date.isoformat(),
        "status": task.status,
        "overdue": task.due_date < today,
        "route": "/compliance",
    } for task, program in found]
    return ToolResult(
        tool="compliance_due", total_count=total, items=items,
        applied_filters={"facility_id": facility_id, "within_days": None if overdue_only else within_days,
                         "overdue_only": overdue_only, "as_of": today.isoformat()},
    )


def describe_valid(values: Any) -> str:
    return ", ".join(sorted(values))


# ── site categories ──────────────────────────────────────────────────────────
# Electrical, Plumbing, Mechanical and HVAC equipment, and the service and
# inspection jobs on it: the same queries the Categories and Equipment
# Maintenance screens use.

def _site_or_error(ctx: ToolContext, facility_id: Optional[int]) -> int:
    if facility_id is None:
        raise ToolInputError("Say which site: pass facility_id.")
    allowed = ctx.facility_ids()
    if ctx.db.get(Facility, facility_id) is None or (allowed is not None and facility_id not in allowed):
        raise ToolInputError("No site with id {}.".format(facility_id))
    return facility_id


def _category_or_error(category: Optional[str]):
    from app.services import site_categories

    if not category:
        return None
    found = site_categories.BY_CODE.get(category)
    if found is None:
        raise ToolInputError("Unknown category '{}'. Valid values: {}".format(
            category, ", ".join(site_categories.BY_CODE)))
    return found


def category_equipment(
    ctx: ToolContext,
    facility_id: Optional[int] = None,
    category: Optional[str] = None,
    condition: Optional[str] = None,
    department: Optional[str] = None,
    building: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 25,
) -> ToolResult:
    """A site's equipment under its categories, with counts per category."""
    from app.services import site_categories

    ctx.require_module("facility-inventory")
    ctx.apply_statement_timeout()
    site = _site_or_error(ctx, facility_id)
    chosen = _category_or_error(category)
    if condition and condition not in site_categories.CONDITIONS:
        raise ToolInputError("Unknown condition '{}'. Valid values: {}".format(
            condition, ", ".join(site_categories.CONDITIONS)))

    summary = site_categories.overview(ctx.db, site)
    ids = site_categories.ensure_disciplines(ctx.db)
    code_of = {pk: code for code, pk in ids.items()}
    rows = site_categories.items_query(ctx.db, site).filter(Equipment.discipline_id.in_(list(code_of)))
    if chosen is not None:
        rows = rows.filter(Equipment.discipline_id == ids[chosen.code])
    if condition:
        rows = rows.filter(Equipment.condition == condition)
    from app.assistant.tools.inspections import department_named
    from app.models.department import Department

    chosen_department = None
    if department and department.strip().lower() in ("none", "no department", "not in a department"):
        rows = rows.filter(Equipment.department_id.is_(None))
    elif department:
        chosen_department = department_named(ctx, [ctx.db.get(Facility, site)], department)
        rows = rows.filter(Equipment.department_id == chosen_department.id)
    if building:
        rows = rows.filter(func.lower(Equipment.building) == building.strip().lower())
    if query and query.strip():
        like = _escape_like(query)
        rows = rows.filter(or_(Equipment.name.ilike(like), Equipment.equipment_type.ilike(like),
                               Equipment.asset_tag.ilike(like), Equipment.location.ilike(like),
                               Equipment.floor.ilike(like), Equipment.building.ilike(like)))
    total = rows.count()
    found = rows.order_by(Equipment.name).limit(clamp_limit(limit)).all()
    facts = site_categories.job_facts(ctx.db, [a.id for a in found])
    values = site_categories.value_facts(ctx.db, found)
    department_names = dict(ctx.db.query(Department.id, Department.name).filter(
        Department.facility_id == site).all())
    items = []
    for asset in found:
        code = code_of[asset.discipline_id]
        item = site_categories.serialise(asset, site_categories.BY_CODE[code], facts.get(asset.id),
                                         values.get(asset.id))
        items.append({
            "asset_id": item["id"], "asset_tag": item["asset_tag"], "name": item["name"],
            "category": item["category_name"], "type": item["type"],
            "department": department_names.get(asset.department_id) or "Not in a department",
            "where": item["location_label"] or None,
            "quantity": item["quantity"], "condition": item["condition_label"],
            "open_jobs": item["open_jobs"],
            "next_service_on": item["next_service_on"].isoformat() if item["next_service_on"] else None,
            "purchase_cost": money(item["purchase_cost"]) if item["purchase_cost"] is not None else None,
            "book_value": money(item["book_value"]) if item["book_value"] is not None else None,
            "maintenance_spend": money(item["maintenance_spend"]),
            "cost_of_ownership": money(item["cost_of_ownership"]),
            "consider_replacing": item["consider_replacing"],
            "route": "/categories/{}".format(code),
        })
    return ToolResult(
        tool="category_equipment", total_count=total, items=items,
        aggregates={"by_category": [{
            "category": c["name"], "equipment": c["equipment"], "needs_attention": c["needs_attention"],
            "out_of_service": c["out_of_service"], "open_jobs": c["open_jobs"], "overdue_jobs": c["overdue_jobs"],
            "book_value": money(c["book_value"]), "equipment_with_book_value": c["valued_equipment"],
        } for c in summary]},
        applied_filters={"facility_id": site, "category": category, "condition": condition,
                         "department": chosen_department.name if chosen_department else department,
                         "building": building, "query": query},
    )


def equipment_jobs(
    ctx: ToolContext,
    facility_id: Optional[int] = None,
    kind: str = "service",
    status: Optional[str] = None,
    category: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 25,
) -> ToolResult:
    """Service or inspection jobs on a site's category equipment."""
    from app.services import equipment_jobs as jobs_service
    from app.services import site_categories

    ctx.require_module("service-requests")
    ctx.apply_statement_timeout()
    site = _site_or_error(ctx, facility_id)
    _category_or_error(category)
    if kind not in jobs_service.KINDS:
        raise ToolInputError("kind is service or inspection.")
    rows, counts = jobs_service.list_query(ctx.db, site, kind, status=status, category=category, search=query)
    total = rows.order_by(None).count()
    codes = {pk: code for code, pk in site_categories.ensure_disciplines(ctx.db).items()}
    items = []
    for job in rows.limit(clamp_limit(limit)).all():
        shown = jobs_service.serialise(job, codes)
        equipment = shown["equipment"] or {}
        items.append({
            "job_id": shown["id"], "number": shown["number"], "what_needs_doing": shown["title"],
            "equipment": equipment.get("name"), "asset_tag": equipment.get("asset_tag"),
            "category": equipment.get("category_name"), "where": equipment.get("location_label") or None,
            "due_on": shown["due_on"].isoformat() if shown["due_on"] else None, "overdue": shown["overdue"],
            "assigned_to": (shown["assigned_to"] or {}).get("name"), "status": shown["status_label"],
            "result": shown["inspection_result"], "findings": shown["findings"],
            "labour_cost": money(shown["labour_cost"]) if shown["labour_cost"] is not None else None,
            "parts_cost": money(shown["parts_cost"]) if shown["parts_cost"] is not None else None,
            "total_cost": money(shown["total_cost"]) if shown["total_cost"] is not None else None,
            "major_work": shown["is_major_work"],
            "route": "/equipment-maintenance/{}".format(kind),
        })
    return ToolResult(
        tool="equipment_jobs", total_count=total, items=items, aggregates={"by_status": counts},
        applied_filters={"facility_id": site, "kind": kind, "status": status, "category": category, "query": query},
    )
