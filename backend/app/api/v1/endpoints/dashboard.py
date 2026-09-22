from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, and_, case, cast, desc, func, or_
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.utils.permission_deps import require_module_access
from app.db.base import get_db
from app.models.equipment import Equipment, EquipmentStatus
from app.models.facility import Facility
from app.models.inspection import Inspection, InspectionStatus
from app.models.inventory import InventoryPart
from app.models.audit_log import AuditLog
from app.models.invoice import Invoice, InvoiceStatus, InvoiceTransaction, InvoiceType
from app.models.rental import Rental, RentalStatus
from app.models.service_request import Priority, ServiceRequest, ServiceRequestStatus
from app.models.user import User, UserRole
from app.models.user_facility import UserFacility
from app.utils.facility_access import get_user_facility_ids, is_facility_scoped_user
from app.utils.invoice_approval import scope_invoice_approval_visibility
from app.utils.permissions import has_module_permission
from app.utils.read_cache import cached_read

router = APIRouter(dependencies=[Depends(require_module_access("dashboard"))])


def _date_window(
    date_from: Optional[date],
    date_to: Optional[date],
    comparison: Literal["previous_period", "previous_year", "custom"],
    comparison_from: Optional[date] = None,
    comparison_to: Optional[date] = None,
) -> tuple[date, date, date, date]:
    current_to = date_to or date.today()
    current_from = date_from or (current_to - timedelta(days=29))
    if current_from > current_to:
        raise HTTPException(status_code=422, detail="From date cannot be after to date")
    if (current_to - current_from).days > 730:
        raise HTTPException(status_code=422, detail="Dashboard date range cannot exceed 731 days")

    if comparison == "custom":
        if not comparison_from or not comparison_to:
            raise HTTPException(status_code=422, detail="Custom comparison requires both comparison dates")
        if comparison_from > comparison_to:
            raise HTTPException(status_code=422, detail="Comparison From date cannot be after Comparison To date")
        if (comparison_to - comparison_from).days > 730:
            raise HTTPException(status_code=422, detail="Dashboard comparison range cannot exceed 731 days")
        previous_from, previous_to = comparison_from, comparison_to
    elif comparison == "previous_year":
        try:
            previous_from = current_from.replace(year=current_from.year - 1)
        except ValueError:
            previous_from = current_from.replace(year=current_from.year - 1, day=28)
        try:
            previous_to = current_to.replace(year=current_to.year - 1)
        except ValueError:
            previous_to = current_to.replace(year=current_to.year - 1, day=28)
    else:
        period_days = (current_to - current_from).days + 1
        previous_to = current_from - timedelta(days=1)
        previous_from = previous_to - timedelta(days=period_days - 1)
    return current_from, current_to, previous_from, previous_to


def _datetime_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    return datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min)


def _metric(current: int | float | Decimal, previous: int | float | Decimal) -> dict[str, Any]:
    current_value = float(current or 0)
    previous_value = float(previous or 0)
    delta = current_value - previous_value
    if previous_value:
        change_percent: Optional[float] = round((delta / abs(previous_value)) * 100, 1)
    elif current_value:
        change_percent = None
    else:
        change_percent = 0.0
    return {
        "current": round(current_value, 2),
        "previous": round(previous_value, 2),
        "delta": round(delta, 2),
        "change_percent": change_percent,
        "direction": "up" if delta > 0 else "down" if delta < 0 else "flat",
    }


def _trend_label(score: float) -> str:
    if score >= 0.15:
        return "upward"
    if score <= -0.15:
        return "downward"
    return "stable"


@router.get("/summary")
@cached_read("dashboard", ttl_seconds=90)
def read_dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Live KPI summary for dashboard cards."""
    allowed_facility_ids = get_user_facility_ids(db, current_user) if is_facility_scoped_user(current_user) else None

    def facility_scope(query, model):
        if allowed_facility_ids is None:
            return query
        return query.filter(model.facility_id.in_(allowed_facility_ids))

    def service_scope(query):
        query = facility_scope(query, ServiceRequest)
        if current_user.role == UserRole.TECHNICIAN:
            return query.filter(ServiceRequest.assigned_technician_id == current_user.id)
        if current_user.role == UserRole.EMPLOYEE:
            return query.filter(ServiceRequest.requester_id == current_user.id)
        return query

    def inspection_scope(query):
        query = facility_scope(query, Inspection)
        if current_user.role == UserRole.TECHNICIAN:
            return query.filter(Inspection.inspector_id == current_user.id)
        if current_user.role == UserRole.EMPLOYEE:
            return query.filter(False)
        return query

    open_service_statuses = [
        ServiceRequestStatus.NEW,
        ServiceRequestStatus.ASSIGNED,
        ServiceRequestStatus.IN_PROGRESS,
        ServiceRequestStatus.WAITING_ON_PARTS,
        ServiceRequestStatus.WAITING_FOR_APPROVAL,
        ServiceRequestStatus.WAITING_FOR_DEPOT_REPAIR,
        ServiceRequestStatus.WAITING_FOR_VENDOR_REPAIR,
    ]
    # Each table's several counts are collapsed into ONE query using Postgres
    # aggregate FILTER (count(*) FILTER (WHERE ...)). This turns ~18 sequential
    # round-trips into ~9, which materially speeds up the dashboard landing page.
    facility_query = db.query(Facility).filter(Facility.live())
    if allowed_facility_ids is not None:
        facility_query = facility_query.filter(Facility.id.in_(allowed_facility_ids))
    facility_counts = facility_query.with_entities(
        func.count().label("total"),
        func.count().filter(Facility.status == "active").label("active"),
    ).one()
    total_facilities = facility_counts.total
    active_facilities = facility_counts.active

    service_counts = service_scope(db.query(ServiceRequest)).with_entities(
        func.count().label("total"),
        func.count().filter(ServiceRequest.status.in_(open_service_statuses)).label("open"),
        func.count().filter(
            and_(ServiceRequest.priority == Priority.CRITICAL, ServiceRequest.status.in_(open_service_statuses))
        ).label("critical"),
    ).one()
    total_service_requests = service_counts.total
    open_service_requests = service_counts.open
    critical_service_requests = service_counts.critical

    inspection_counts = inspection_scope(db.query(Inspection)).with_entities(
        func.count().label("total"),
        func.count().filter(Inspection.status == InspectionStatus.OVERDUE).label("overdue"),
        func.count().filter(Inspection.status == InspectionStatus.UPCOMING).label("upcoming"),
    ).one()
    total_inspections = inspection_counts.total
    overdue_inspections = inspection_counts.overdue
    upcoming_inspections = inspection_counts.upcoming

    rental_query = db.query(Rental)
    if allowed_facility_ids is not None:
        rental_query = rental_query.join(Equipment, Equipment.id == Rental.equipment_id).filter(
            Equipment.facility_id.in_(allowed_facility_ids)
        )
    active_rentals = rental_query.filter(Rental.status == RentalStatus.ACTIVE).count()

    equipment_counts = facility_scope(db.query(Equipment), Equipment).with_entities(
        func.count().label("total"),
        func.count().filter(Equipment.status == EquipmentStatus.ACTIVE).label("active"),
        func.count().filter(Equipment.status == EquipmentStatus.IN_MAINTENANCE).label("in_maintenance"),
    ).one()
    total_equipment = equipment_counts.total
    active_equipment = equipment_counts.active
    maintenance_equipment = equipment_counts.in_maintenance

    assigned_user_query = db.query(UserFacility)
    primary_user_query = db.query(User).filter(User.facility_id.isnot(None))
    if allowed_facility_ids is not None:
        assigned_user_query = assigned_user_query.filter(UserFacility.facility_id.in_(allowed_facility_ids))
        primary_user_query = primary_user_query.filter(User.facility_id.in_(allowed_facility_ids))
    assigned_users = assigned_user_query.count()
    users_with_primary_facility = primary_user_query.count()

    visible_invoices = scope_invoice_approval_visibility(
        facility_scope(db.query(Invoice), Invoice),
        current_user,
    )
    invoice_counts = visible_invoices.with_entities(
        func.count().filter(Invoice.status == InvoiceStatus.PENDING).label("pending"),
        func.count().filter(Invoice.status == InvoiceStatus.OVERDUE).label("overdue"),
    ).one()
    pending_invoices = invoice_counts.pending
    overdue_invoices = invoice_counts.overdue

    part_counts = facility_scope(db.query(InventoryPart), InventoryPart).with_entities(
        func.count().filter(InventoryPart.quantity_on_hand <= InventoryPart.reorder_level).label("low_stock"),
        func.count().filter(
            and_(InventoryPart.expiry_date.isnot(None), InventoryPart.expiry_date <= date.today() + timedelta(days=30))
        ).label("expiring"),
    ).one()
    low_stock_parts = part_counts.low_stock
    expiring_parts = part_counts.expiring

    return {
        "facilities": {
            "total": total_facilities,
            "active": active_facilities,
            "inactive": max(total_facilities - active_facilities, 0),
        },
        "service_requests": {
            "total": total_service_requests,
            "open": open_service_requests,
            "critical": critical_service_requests,
        },
        "inspections": {
            "total": total_inspections,
            "upcoming": upcoming_inspections,
            "overdue": overdue_inspections,
        },
        "rentals": {
            "active": active_rentals,
        },
        "equipment": {
            "total": total_equipment,
            "active": active_equipment,
            "in_maintenance": maintenance_equipment,
        },
        "user_assignments": {
            "total": assigned_users + users_with_primary_facility,
            "direct": users_with_primary_facility,
            "multi_facility": assigned_users,
        },
        "invoices": {
            "pending": pending_invoices,
            "overdue": overdue_invoices,
        },
        "inventory": {
            "low_stock_parts": low_stock_parts,
            "expiring_parts": expiring_parts,
        },
    }


def _build_dashboard_intelligence(
    db: Session,
    current_user: User,
    *,
    date_from: Optional[date],
    date_to: Optional[date],
    comparison: Literal["previous_period", "previous_year", "custom"],
    comparison_from: Optional[date] = None,
    comparison_to: Optional[date] = None,
) -> dict[str, Any]:
    current_from, current_to, previous_from, previous_to = _date_window(
        date_from,
        date_to,
        comparison,
        comparison_from,
        comparison_to,
    )
    current_start, current_end = _datetime_bounds(current_from, current_to)
    previous_start, previous_end = _datetime_bounds(previous_from, previous_to)
    allowed_facility_ids = get_user_facility_ids(db, current_user) if is_facility_scoped_user(current_user) else None

    def facility_scope(query, model):
        if allowed_facility_ids is None:
            return query
        return query.filter(model.facility_id.in_(allowed_facility_ids))

    def service_scope(query):
        query = facility_scope(query, ServiceRequest)
        if current_user.role == UserRole.TECHNICIAN:
            return query.filter(ServiceRequest.assigned_technician_id == current_user.id)
        if current_user.role == UserRole.EMPLOYEE:
            return query.filter(ServiceRequest.requester_id == current_user.id)
        return query

    def inspection_scope(query):
        query = facility_scope(query, Inspection)
        if current_user.role == UserRole.TECHNICIAN:
            return query.filter(Inspection.inspector_id == current_user.id)
        if current_user.role == UserRole.EMPLOYEE:
            return query.filter(False)
        return query

    metrics: dict[str, dict[str, Any]] = {}
    alert_counts: dict[str, int] = {}
    if has_module_permission(current_user, "service-requests", "index"):
        service_counts = service_scope(db.query(ServiceRequest)).with_entities(
            func.count().filter(
                ServiceRequest.status == ServiceRequestStatus.COMPLETED,
                ServiceRequest.completed_at >= current_start,
                ServiceRequest.completed_at < current_end,
            ).label("current_completed"),
            func.count().filter(
                ServiceRequest.status == ServiceRequestStatus.COMPLETED,
                ServiceRequest.completed_at >= previous_start,
                ServiceRequest.completed_at < previous_end,
            ).label("previous_completed"),
            func.count().filter(
                ServiceRequest.priority == Priority.CRITICAL,
                ServiceRequest.status.in_([
                    ServiceRequestStatus.NEW,
                    ServiceRequestStatus.ASSIGNED,
                    ServiceRequestStatus.IN_PROGRESS,
                    ServiceRequestStatus.WAITING_ON_PARTS,
                    ServiceRequestStatus.WAITING_FOR_APPROVAL,
                    ServiceRequestStatus.WAITING_FOR_DEPOT_REPAIR,
                    ServiceRequestStatus.WAITING_FOR_VENDOR_REPAIR,
                ]),
            ).label("critical_open"),
        ).one()
        metrics["completed_service_requests"] = _metric(
            service_counts.current_completed,
            service_counts.previous_completed,
        )
        alert_counts["critical-services"] = int(service_counts.critical_open or 0)

    if has_module_permission(current_user, "inspections", "index"):
        inspection_counts = inspection_scope(db.query(Inspection)).with_entities(
            func.count().filter(
                Inspection.status == InspectionStatus.COMPLETED,
                Inspection.completed_at >= current_start,
                Inspection.completed_at < current_end,
            ).label("current_completed"),
            func.count().filter(
                Inspection.status == InspectionStatus.COMPLETED,
                Inspection.completed_at >= previous_start,
                Inspection.completed_at < previous_end,
            ).label("previous_completed"),
            func.count().filter(
                Inspection.status.notin_([InspectionStatus.COMPLETED, InspectionStatus.CLOSED]),
                or_(Inspection.status == InspectionStatus.OVERDUE, Inspection.scheduled_date < datetime.utcnow()),
            ).label("overdue_open"),
        ).one()
        metrics["completed_inspections"] = _metric(
            inspection_counts.current_completed,
            inspection_counts.previous_completed,
        )
        alert_counts["overdue-inspections"] = int(inspection_counts.overdue_open or 0)

    if has_module_permission(current_user, "facilities", "index"):
        facilities = db.query(Facility).filter(Facility.live())
        if allowed_facility_ids is not None:
            facilities = facilities.filter(Facility.id.in_(allowed_facility_ids))
        facility_counts = facilities.with_entities(
            func.count().filter(
                Facility.created_at >= current_start,
                Facility.created_at < current_end,
            ).label("current_created"),
            func.count().filter(
                Facility.created_at >= previous_start,
                Facility.created_at < previous_end,
            ).label("previous_created"),
        ).one()
        metrics["new_facilities"] = _metric(
            facility_counts.current_created,
            facility_counts.previous_created,
        )

    revenue_breakdown: list[dict[str, Any]] = []
    if has_module_permission(current_user, "billing", "index"):
        transactions = db.query(InvoiceTransaction).join(Invoice, Invoice.id == InvoiceTransaction.invoice_id)
        transactions = facility_scope(transactions, Invoice)
        transactions = scope_invoice_approval_visibility(transactions, current_user)

        signed_amount = case(
            (InvoiceTransaction.transaction_type == "refund", -InvoiceTransaction.amount),
            else_=InvoiceTransaction.amount,
        )

        def _net_windows():
            """Fresh (current, previous) collected-cash aggregates each call so the
            same expression object is never shared across two queries."""
            return (
                func.coalesce(func.sum(signed_amount).filter(
                    InvoiceTransaction.created_at >= current_start,
                    InvoiceTransaction.created_at < current_end,
                    InvoiceTransaction.transaction_type.in_(["payment", "refund"]),
                ), 0),
                func.coalesce(func.sum(signed_amount).filter(
                    InvoiceTransaction.created_at >= previous_start,
                    InvoiceTransaction.created_at < previous_end,
                    InvoiceTransaction.transaction_type.in_(["payment", "refund"]),
                ), 0),
            )

        current_net_expr, previous_net_expr = _net_windows()
        transaction_counts = transactions.with_entities(
            current_net_expr.label("current_net"),
            previous_net_expr.label("previous_net"),
        ).one()

        metrics["net_revenue"] = _metric(
            Decimal(str(transaction_counts.current_net or 0)),
            Decimal(str(transaction_counts.previous_net or 0)),
        )

        # Collected cash split by invoice stream (sales / rental / service /
        # inspection) so the blended net-revenue figure is explainable. Uses the
        # indexed invoice_type column; refunds stay signed-negative.
        stream_current_expr, stream_previous_expr = _net_windows()
        stream_rows = transactions.with_entities(
            Invoice.invoice_type.label("stream"),
            stream_current_expr.label("current_net"),
            stream_previous_expr.label("previous_net"),
        ).group_by(Invoice.invoice_type).all()
        stream_map = {
            (row.stream.value if hasattr(row.stream, "value") else row.stream): row
            for row in stream_rows
        }
        for inv_type in (InvoiceType.SALES, InvoiceType.RENTAL, InvoiceType.SERVICE, InvoiceType.INSPECTION):
            row = stream_map.get(inv_type.value)
            stream_current = float(row.current_net) if row else 0.0
            stream_previous = float(row.previous_net) if row else 0.0
            revenue_breakdown.append({
                "stream": inv_type.value,
                "label": inv_type.value.title(),
                "current": round(stream_current, 2),
                "previous": round(stream_previous, 2),
                "delta": round(stream_current - stream_previous, 2),
            })

    weighted_score = 0.0
    total_weight = 0.0
    weights = {
        "net_revenue": 0.4,
        "completed_service_requests": 0.25,
        "completed_inspections": 0.2,
        "new_facilities": 0.15,
    }
    for key, metric_value in metrics.items():
        weight = weights.get(key, 0)
        if not weight:
            continue
        previous = float(metric_value["previous"] or 0)
        current = float(metric_value["current"] or 0)
        if previous:
            normalized = max(-1.0, min(1.0, (current - previous) / abs(previous)))
        elif current:
            normalized = 1.0
        else:
            normalized = 0.0
        weighted_score += normalized * weight
        total_weight += weight
    trajectory_score = round(weighted_score / total_weight, 3) if total_weight else 0.0

    alerts: list[dict[str, Any]] = []

    def add_alert(
        key: str,
        title: str,
        count: int,
        severity: str,
        detail: str,
        module: str,
        route: str,
    ) -> None:
        if count > 0 and has_module_permission(current_user, module, "index"):
            alerts.append({
                "key": key,
                "title": title,
                "count": int(count),
                "severity": severity,
                "detail": detail,
                "module": module,
                "route": route,
            })

    # Service and inspection alert counts are produced by the same aggregate
    # query as their comparison metrics, avoiding duplicate table scans.
    if has_module_permission(current_user, "service-requests", "index"):
        add_alert(
            "critical-services",
            "Critical service requests",
            alert_counts.get("critical-services", 0),
            "critical",
            "Open critical-priority work orders need attention.",
            "service-requests",
            "/service-requests",
        )

    if has_module_permission(current_user, "inspections", "index"):
        add_alert(
            "overdue-inspections",
            "Overdue inspections",
            alert_counts.get("overdue-inspections", 0),
            "warning",
            "Scheduled inspections are past due and still open.",
            "inspections",
            "/inspections",
        )

    if has_module_permission(current_user, "billing", "index"):
        visible_invoices = scope_invoice_approval_visibility(facility_scope(db.query(Invoice), Invoice), current_user)
        overdue_invoices = visible_invoices.filter(
            Invoice.status.in_([InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE]),
            Invoice.due_date < date.today(),
        ).count()
        add_alert(
            "overdue-invoices",
            "Overdue invoices",
            overdue_invoices,
            "critical",
            "Approved invoice balances are past their due date.",
            "billing",
            "/billing",
        )

    if has_module_permission(current_user, "inventory", "index"):
        low_stock_query = db.query(InventoryPart).filter(
            InventoryPart.quantity_on_hand <= InventoryPart.reorder_level
        )
        if allowed_facility_ids is not None:
            low_stock_query = low_stock_query.filter(
                or_(InventoryPart.facility_id.is_(None), InventoryPart.facility_id.in_(allowed_facility_ids))
            )
        add_alert(
            "low-stock-parts",
            "Low-stock parts",
            low_stock_query.count(),
            "warning",
            "Parts at or below their reorder level may affect upcoming work.",
            "inventory",
            "/inventory",
        )

    if has_module_permission(current_user, "rentals", "index"):
        rental_query = db.query(Rental).filter(
            Rental.status == RentalStatus.ACTIVE,
            Rental.failed_charge_count > 0,
        )
        if allowed_facility_ids is not None:
            rental_query = rental_query.filter(Rental.facility_id.in_(allowed_facility_ids))
        add_alert(
            "failed-rental-payments",
            "Rental payment retries",
            rental_query.count(),
            "critical",
            "Active rentals have failed recurring-payment attempts.",
            "rentals",
            "/rentals",
        )
    alerts.sort(key=lambda item: ({"critical": 0, "warning": 1, "info": 2}.get(item["severity"], 3), -item["count"]))

    return {
        "period": {"from": current_from, "to": current_to},
        "comparison": {
            "mode": comparison,
            "from": previous_from,
            "to": previous_to,
        },
        "metrics": metrics,
        "revenue_breakdown": revenue_breakdown,
        "trajectory": {
            "direction": _trend_label(trajectory_score),
            "score": trajectory_score,
            "basis": list(metrics.keys()),
        },
        "alerts": alerts,
        "generated_at": datetime.utcnow(),
    }


@router.get("/intelligence")
@cached_read("dashboard", ttl_seconds=90)
def read_dashboard_intelligence(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    comparison: Literal["previous_period", "previous_year", "custom"] = Query("previous_period"),
    comparison_from: Optional[date] = Query(None),
    comparison_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Permission-scoped period comparisons and actionable operational alerts."""
    return _build_dashboard_intelligence(
        db,
        current_user,
        date_from=date_from,
        date_to=date_to,
        comparison=comparison,
        comparison_from=comparison_from,
        comparison_to=comparison_to,
    )


@router.get("/activity")
@cached_read("dashboard", ttl_seconds=60)
def read_dashboard_activity(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=50),
    search: Optional[str] = Query(None, max_length=120),
    action: Optional[str] = Query(None, max_length=40),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
) -> Any:
    """Own activity for every user; global activity only for Super Admin."""
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=422, detail="From date cannot be after to date")
    query = db.query(AuditLog)
    if current_user.role != UserRole.SUPERADMIN:
        query = query.filter(AuditLog.changed_by_id == current_user.id)

    normalized_search = (search or "").strip()
    if normalized_search:
        escaped = normalized_search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.filter(or_(
            AuditLog.changed_by_username.ilike(pattern, escape="\\"),
            AuditLog.table_name.ilike(pattern, escape="\\"),
            AuditLog.action.ilike(pattern, escape="\\"),
            AuditLog.changes_json.ilike(pattern, escape="\\"),
            cast(AuditLog.record_id, String).ilike(pattern, escape="\\"),
        ))
    normalized_action = (action or "").strip().replace("%", "").replace("_", "")
    if normalized_action:
        query = query.filter(AuditLog.action.ilike(f"%{normalized_action}%"))
    if from_date:
        query = query.filter(AuditLog.timestamp >= datetime.combine(from_date, time.min))
    if to_date:
        query = query.filter(AuditLog.timestamp < datetime.combine(to_date + timedelta(days=1), time.min))

    total = query.count()
    return {
        "items": query.order_by(desc(AuditLog.timestamp)).offset(skip).limit(limit).all(),
        "total": total,
        "scope": "global" if current_user.role == UserRole.SUPERADMIN else "own",
    }


# Metric keys that belong to each selectable dashboard module. Alerts and the
# revenue breakdown carry their own module/stream, so they are filtered directly.
_MODULE_METRIC_KEYS: dict[str, set[str]] = {
    "service-requests": {"completed_service_requests"},
    "inspections": {"completed_inspections"},
    "facilities": {"new_facilities"},
    "billing": {"net_revenue"},
    # Sales and rentals have no blended comparison metric of their own; their
    # revenue is expressed through the per-stream breakdown below.
    "sales": set(),
    "rentals": set(),
    "inventory": set(),
}

# Revenue streams surfaced when a revenue-bearing module is in focus. ``None``
# means all streams; a missing module means no revenue breakdown in focus.
_MODULE_REVENUE_STREAMS: dict[str, Optional[set[str]]] = {
    "billing": None,
    "sales": {"sales"},
    "rentals": {"rental"},
}


def _scope_intelligence_to_module(intelligence: dict[str, Any], module: str) -> dict[str, Any]:
    """Shallow copy of the intelligence payload narrowed to one module, so the AI
    narrative can focus on a single area of the business."""
    metric_keys = _MODULE_METRIC_KEYS.get(module, set())
    scoped = dict(intelligence)
    scoped["metrics"] = {
        key: value for key, value in (intelligence.get("metrics") or {}).items()
        if key in metric_keys
    }
    scoped["alerts"] = [
        alert for alert in (intelligence.get("alerts") or [])
        if alert.get("module") == module
    ]
    streams = _MODULE_REVENUE_STREAMS.get(module, set())
    breakdown = intelligence.get("revenue_breakdown") or []
    if streams is None:
        scoped["revenue_breakdown"] = breakdown
    elif streams:
        scoped["revenue_breakdown"] = [b for b in breakdown if b.get("stream") in streams]
    else:
        scoped["revenue_breakdown"] = []
    scoped["focus_module"] = module
    return scoped


@router.get("/analysis")
@cached_read("dashboard-ai", ttl_seconds=900)
def read_dashboard_ai_analysis(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    comparison: Literal["previous_period", "previous_year", "custom"] = Query("previous_period"),
    comparison_from: Optional[date] = Query(None),
    comparison_to: Optional[date] = Query(None),
    module: Optional[str] = Query(None, max_length=40),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Explain aggregated, permission-scoped metrics using the configured AI model.

    An optional ``module`` narrows the narrative to a single business area
    (e.g. ``rentals``); omitted, the analysis covers the whole period.
    """
    intelligence = _build_dashboard_intelligence(
        db,
        current_user,
        date_from=date_from,
        date_to=date_to,
        comparison=comparison,
        comparison_from=comparison_from,
        comparison_to=comparison_to,
    )
    focus_module = (module or "").strip().lower() or None
    if focus_module:
        intelligence = _scope_intelligence_to_module(intelligence, focus_module)
    from app.utils.dashboard_ai import generate_dashboard_analysis

    return generate_dashboard_analysis(intelligence, focus_module=focus_module)
