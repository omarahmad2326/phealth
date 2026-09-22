import json
import os
import uuid
import io
import csv
import re
from datetime import datetime
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import case, func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app import crud, schemas
from app.core.deps import get_current_user, get_admin_user, get_facility_admin_user, get_superadmin_user
from app.utils.permission_deps import require_module_access
from app.db.base import get_db
from app.models.user import User
from app.models.user_facility import UserFacility
from app.models.facility import Facility
from app.models.facility_tier import FacilityTier
from app.models.tier import Tier
from app.models.facility_document import FacilityDocument
from app.models.equipment import Equipment
from app.models.audit_log import AuditLog
from app.utils.logging import log_activity
from app.utils.facility_access import (
    is_facility_scoped_user, require_facility_access, scope_query_to_user_facilities,
)
from app.utils.permissions import require_module_permission
from app.utils.list_search import contains_ci, normalize_list_search, predicates_for_field, value_contains_ci
from app.utils.upload_security import protected_upload_path
from app.utils.read_cache import cached_read

router = APIRouter(dependencies=[Depends(require_module_access("facilities"))])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "uploads", "facility_documents")

SCOPED_EXPORT_SCOPES = {
    "facility_info",
    "facility_inventory",
    "facility_with_inventory",
    "children",
    "children_with_inventory",
    "parent",
    "parent_with_inventory",
    "family",
    "family_with_inventory",
}

SCOPED_EXPORT_LABELS = {
    "facility_info": "Facility Information",
    "facility_inventory": "Facility Inventory",
    "facility_with_inventory": "Facility Information and Inventory",
    "children": "Child Facilities",
    "children_with_inventory": "Child Facilities and Inventory",
    "parent": "Parent Facility",
    "parent_with_inventory": "Parent Facility and Inventory",
    "family": "Parent / Child Facility Group",
    "family_with_inventory": "Parent / Child Facility Group and Inventory",
}


def _format_us_phone(value: Optional[str]) -> str:
    raw = (value or "").strip()
    if not raw:
        return "—"
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    if len(digits) == 7:
        return f"{digits[:3]}-{digits[3:]}"
    return raw


def _normalize_us_phone(value: Optional[str]) -> str:
    formatted = _format_us_phone(value)
    return "" if formatted == "—" else formatted


def _facility_timezone_label(value: Optional[str]) -> str:
    normalized = _normalize_facility_timezone(value)
    if normalized == "America/Los_Angeles":
        return "West Coast"
    if normalized == "America/New_York":
        return "East Coast"
    return "Central"


def _normalize_facility_timezone(value: Optional[str]) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"america/los_angeles", "america/denver", "west coast", "pacific", "pt", "pst", "pdt"}:
        return "America/Los_Angeles"
    if normalized in {"america/new_york", "east coast", "eastern", "et", "est", "edt"}:
        return "America/New_York"
    if normalized in {"america/chicago", "central", "ct", "cst", "cdt", "utc", ""}:
        return "America/Chicago"
    return "America/Chicago"


def _clean_facility_name(value: Optional[str]) -> str:
    cleaned = re.sub(r"\s+", " ", (value or "").strip())
    if not cleaned:
        raise HTTPException(status_code=422, detail="Facility name is required")
    return cleaned


def _facility_name_key(value: str) -> str:
    return _clean_facility_name(value).lower()


def _facility_name_expression():
    return func.lower(func.regexp_replace(func.btrim(Facility.name), r"\s+", " ", "g"))


def _lock_facility_name(db: Session, name_key: str) -> None:
    """Serialize equal-name writes across all PostgreSQL application workers."""
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
            {"lock_key": f"facility-name:{name_key}"},
        )


def _facility_name_exists(db: Session, name: str, exclude_id: Optional[int] = None) -> bool:
    query = db.query(Facility.id).filter(_facility_name_expression() == _facility_name_key(name))
    if exclude_id is not None:
        query = query.filter(Facility.id != exclude_id)
    return query.first() is not None


def _require_unique_facility_name(db: Session, name: str, exclude_id: Optional[int] = None) -> None:
    if _facility_name_exists(db, name, exclude_id=exclude_id):
        raise HTTPException(status_code=409, detail=f"A facility named '{name}' already exists")


def _next_facility_copy_name(db: Session, requested_name: str) -> str:
    cleaned = _clean_facility_name(requested_name)
    base_name = re.sub(r"\s+\(copy(?:\s+\d+)?\)$", "", cleaned, flags=re.IGNORECASE).strip() or cleaned
    _lock_facility_name(db, f"copy:{_facility_name_key(base_name)}")

    copy_number = 1
    while True:
        suffix = " (Copy)" if copy_number == 1 else f" (Copy {copy_number})"
        candidate = f"{base_name}{suffix}"
        if not _facility_name_exists(db, candidate):
            _lock_facility_name(db, _facility_name_key(candidate))
            if not _facility_name_exists(db, candidate):
                return candidate
        copy_number += 1


def _live(db: Session, id: int) -> Optional[Facility]:
    """The site, unless there is no such site or it has been deleted."""
    return db.query(Facility).filter(Facility.id == id, Facility.live()).first()


def _deleted_name(db: Session, facility: Facility) -> str:
    """The name a deleted site keeps: its own, saying it was deleted and when.

    Names are unique, so keeping the old one would stop the same hospital
    being registered again. Any old record that shows the site now says
    plainly that it is gone.
    """
    day = datetime.utcnow().strftime("%d %b %Y").lstrip("0")
    number = 1
    while True:
        suffix = f" (deleted {day})" if number == 1 else f" (deleted {day}, {number})"
        candidate = f"{facility.name}{suffix}"
        if not _facility_name_exists(db, candidate, exclude_id=facility.id):
            return candidate
        number += 1


def _raise_facility_name_conflict(db: Session, error: IntegrityError) -> None:
    db.rollback()
    if "uq_facilities_name_canonical" in str(error.orig):
        raise HTTPException(status_code=409, detail="A facility with that name already exists") from error
    raise error


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip())
    return cleaned.strip("_") or "facility_export"


def _facility_tier_names(facility: Facility) -> str:
    tiers = [ft.tier.name for ft in facility.facility_tiers if ft.tier]
    if not tiers and facility.tier:
        tiers = [facility.tier.name]
    return ", ".join(tiers)


def _status_value(value: Any) -> str:
    return value.value if hasattr(value, "value") else str(value or "")


def _facility_csv_headers() -> list[str]:
    return [
        "id", "name", "status", "parent_facility_id", "address", "suite", "city", "state",
        "zip_code", "country", "phone", "email", "contact_person", "timezone", "operating_hours",
        "tiers", "billing_name", "billing_email", "created_at", "updated_at",
    ]


def _facility_csv_row(facility: Facility) -> list[Any]:
    return [
        facility.id,
        facility.name,
        facility.status,
        facility.parent_facility_id,
        facility.address,
        facility.suite,
        facility.city,
        facility.state,
        facility.zip_code,
        facility.country,
        _format_us_phone(facility.phone),
        facility.email,
        facility.contact_person,
        _facility_timezone_label(facility.timezone),
        facility.operating_hours,
        _facility_tier_names(facility),
        facility.billing_name,
        facility.billing_email,
        facility.created_at,
        facility.updated_at,
    ]


def _equipment_csv_headers() -> list[str]:
    return [
        "id", "asset_tag", "facility", "tier", "make", "model", "serial_number", "modality",
        "inspection_form", "status", "risk_priority", "risk_name", "location", "department",
        "pm_scheduling", "last_pm_date", "next_generated_pm_date", "created_at", "updated_at",
    ]


def _equipment_csv_row(item: Equipment) -> list[Any]:
    return [
        item.id,
        item.asset_tag,
        item.facility.name if item.facility else "",
        item.tier.name if item.tier else "",
        item.make,
        item.model,
        item.serial_number,
        item.modality.name if item.modality else "",
        item.inspection_form.name if item.inspection_form else "",
        _status_value(item.status),
        item.risk_priority,
        item.risk_name,
        item.location,
        item.department,
        item.pm_scheduling,
        item.last_pm_date,
        item.next_generated_pm_date,
        item.created_at,
        item.updated_at,
    ]


def _scoped_facilities(db: Session, facility: Facility, scope: str) -> list[Facility]:
    if scope.startswith("facility_"):
        return [facility]

    if scope.startswith("children"):
        return (
            db.query(Facility)
            .filter(Facility.parent_facility_id == facility.id, Facility.live())
            .order_by(Facility.name.asc(), Facility.id.asc())
            .all()
        )

    if scope.startswith("parent"):
        if not facility.parent_facility_id:
            return []
        parent = db.query(Facility).filter(Facility.id == facility.parent_facility_id).first()
        return [parent] if parent else []

    if scope.startswith("family"):
        root = facility
        if facility.parent_facility_id:
            root = db.query(Facility).filter(Facility.id == facility.parent_facility_id).first() or facility
        children = (
            db.query(Facility)
            .filter(Facility.parent_facility_id == root.id, Facility.live())
            .order_by(Facility.name.asc(), Facility.id.asc())
            .all()
        )
        return [root] + children

    return [facility]


def _scoped_equipment(db: Session, facility_ids: list[int]) -> list[Equipment]:
    if not facility_ids:
        return []
    return (
        db.query(Equipment)
        .options(
            joinedload(Equipment.facility),
            joinedload(Equipment.modality),
            joinedload(Equipment.tier),
            joinedload(Equipment.inspection_form),
        )
        .filter(Equipment.facility_id.in_(facility_ids))
        .order_by(Equipment.asset_tag.asc(), Equipment.id.asc())
        .all()
    )


def _scope_includes_facility_rows(scope: str) -> bool:
    return scope not in {"facility_inventory"}


def _scope_includes_inventory(scope: str) -> bool:
    return scope.endswith("_inventory") or scope.endswith("_with_inventory")


def _sync_facility_tiers(db: Session, facility: Facility, tier_ids: Optional[List[int]]) -> None:
    if tier_ids is None:
        return
    unique_ids = []
    for tier_id in tier_ids:
        if tier_id and tier_id not in unique_ids:
            unique_ids.append(tier_id)

    if unique_ids:
        existing_count = db.query(crud.tier.model).filter(crud.tier.model.id.in_(unique_ids)).count()
        if existing_count != len(unique_ids):
            raise HTTPException(status_code=400, detail="One or more selected tiers do not exist")

    db.query(FacilityTier).filter(FacilityTier.facility_id == facility.id).delete()
    for tier_id in unique_ids:
        db.add(FacilityTier(facility_id=facility.id, tier_id=tier_id))
    facility.tier_id = unique_ids[0] if unique_ids else None


def _validate_parent_facility(
    db: Session,
    *,
    facility_id: Optional[int] = None,
    parent_facility_id: Optional[int],
) -> None:
    """Enforce a single-level parent/child facility hierarchy."""
    if parent_facility_id is None:
        return

    if facility_id is not None and parent_facility_id == facility_id:
        raise HTTPException(status_code=400, detail="A facility cannot be its own parent")

    parent = db.query(Facility).filter(Facility.id == parent_facility_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent facility not found")

    if parent.parent_facility_id is not None:
        raise HTTPException(status_code=400, detail="A child facility cannot be used as a parent facility")


def _ensure_parent_can_become_child(db: Session, facility: Facility, parent_facility_id: Optional[int]) -> None:
    if parent_facility_id is None:
        return
    child_count = db.query(Facility.id).filter(Facility.parent_facility_id == facility.id).count()
    if child_count:
        raise HTTPException(
            status_code=400,
            detail="A parent facility with child facilities cannot be assigned under another parent",
        )


def _facility_response(
    db: Session,
    facility: Facility,
    assigned_users: Optional[list[User]] = None,
) -> dict:
    if assigned_users is None:
        primary_users = db.query(User).filter(User.facility_id == facility.id).all()
        secondary_users = (
            db.query(User)
            .join(UserFacility, UserFacility.user_id == User.id)
            .filter(UserFacility.facility_id == facility.id)
            .all()
        )
        assigned_users = list({u.id: u for u in primary_users + secondary_users}.values())

    facility_dict = {c.name: getattr(facility, c.name) for c in facility.__table__.columns}
    tiers = [ft.tier for ft in facility.facility_tiers if ft.tier]
    if not tiers and facility.tier:
        tiers = [facility.tier]
    facility_dict["tier_ids"] = [t.id for t in tiers]
    facility_dict["tiers"] = tiers
    facility_dict["assigned_users"] = [
        {
            "id": u.id,
            "full_name": u.full_name,
            "username": u.username,
            "role": u.role.value if hasattr(u.role, "value") else str(u.role),
            "avatar_url": u.avatar_url
        }
        for u in assigned_users
    ]
    return facility_dict




@router.get("/", response_model=schemas.FacilityListResponse)
@cached_read("facilities", ttl_seconds=20)
def read_facilities(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    search: Optional[str] = Query(None),
    search_field: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    has_tier: Optional[bool] = Query(None),
    country: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Retrieve facilities (all authenticated users). Deleted sites are never listed."""
    query = scope_query_to_user_facilities(db.query(Facility).filter(Facility.live()), Facility.id, db, current_user)
    if status and status.strip():
        query = query.filter(func.lower(Facility.status) == status.strip().lower())
    if country and country.strip():
        query = query.filter(func.lower(Facility.country) == country.strip().lower())
    if has_tier is not None:
        tier_assignment_exists = (
            db.query(FacilityTier.id)
            .filter(FacilityTier.facility_id == Facility.id)
            .exists()
        )
        tier_assignment = or_(Facility.tier_id.isnot(None), tier_assignment_exists)
        query = query.filter(tier_assignment if has_tier else ~tier_assignment)
    search_term = normalize_list_search(search)
    if search_term:
        identifier_term = search_term.lstrip("#")
        tier_match = (
            db.query(FacilityTier.id)
            .join(Tier, Tier.id == FacilityTier.tier_id)
            .filter(
                FacilityTier.facility_id == Facility.id,
                contains_ci(Tier.name, search_term),
            )
            .exists()
        )
        primary_user_match = (
            db.query(User.id)
            .filter(
                User.facility_id == Facility.id,
                or_(
                    contains_ci(User.full_name, search_term),
                    contains_ci(User.username, search_term),
                    contains_ci(User.email, search_term),
                ),
            )
            .exists()
        )
        secondary_user_match = (
            db.query(UserFacility.id)
            .join(User, User.id == UserFacility.user_id)
            .filter(
                UserFacility.facility_id == Facility.id,
                or_(
                    contains_ci(User.full_name, search_term),
                    contains_ci(User.username, search_term),
                    contains_ci(User.email, search_term),
                ),
            )
            .exists()
        )
        timezone_predicates = []
        normalized_timezone = search_term.lower()
        if "west coast".startswith(normalized_timezone) or normalized_timezone in {"pacific", "pst", "pdt"}:
            timezone_predicates.append(Facility.timezone == "America/Los_Angeles")
        if "east coast".startswith(normalized_timezone) or normalized_timezone in {"eastern", "est", "edt"}:
            timezone_predicates.append(Facility.timezone == "America/New_York")
        if "central".startswith(normalized_timezone) or normalized_timezone in {"cst", "cdt"}:
            timezone_predicates.append(Facility.timezone == "America/Chicago")
        search_by_field = {
            "id": [value_contains_ci(Facility.id, identifier_term)],
            "facility": [contains_ci(Facility.name, search_term)],
            "location": [
                contains_ci(Facility.address, search_term),
                contains_ci(Facility.suite, search_term),
                contains_ci(Facility.city, search_term),
                contains_ci(Facility.state, search_term),
                contains_ci(Facility.zip_code, search_term),
                contains_ci(Facility.country, search_term),
            ],
            "contact": [
                contains_ci(Facility.email, search_term),
                contains_ci(Facility.phone, search_term),
                contains_ci(Facility.contact_person, search_term),
            ],
            "timezone": [
                contains_ci(Facility.timezone, search_term),
                contains_ci(Facility.operating_hours, search_term),
                *timezone_predicates,
            ],
            "manager": [primary_user_match, secondary_user_match],
            "tier": [tier_match],
            "status": [contains_ci(Facility.status, search_term)],
        }
        query = query.filter(
            or_(
                *predicates_for_field(search_field, search_by_field),
            )
        )
    total = query.count()
    items = (
        query.options(
            joinedload(Facility.tier),
            selectinload(Facility.facility_tiers).joinedload(FacilityTier.tier),
        )
        .order_by(Facility.created_at.desc(), Facility.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    facility_ids = [item.id for item in items]
    users_by_facility: dict[int, dict[int, User]] = {facility_id: {} for facility_id in facility_ids}
    if facility_ids:
        for assigned_user in db.query(User).filter(User.facility_id.in_(facility_ids)).all():
            if assigned_user.facility_id:
                users_by_facility[assigned_user.facility_id][assigned_user.id] = assigned_user
        for facility_id, assigned_user in (
            db.query(UserFacility.facility_id, User)
            .join(User, User.id == UserFacility.user_id)
            .filter(UserFacility.facility_id.in_(facility_ids))
            .all()
        ):
            users_by_facility[facility_id][assigned_user.id] = assigned_user

    results = [
        _facility_response(db, item, list(users_by_facility.get(item.id, {}).values()))
        for item in items
    ]

    return {"items": results, "total": total, "skip": skip, "limit": limit}


@router.get("/summary", response_model=schemas.FacilitySummaryResponse)
@cached_read("facilities", ttl_seconds=30)
def read_facility_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Return access-scoped facility KPIs and country choices in one aggregate query."""
    tier_assignment_exists = (
        db.query(FacilityTier.id)
        .filter(FacilityTier.facility_id == Facility.id)
        .exists()
    )
    scoped_query = scope_query_to_user_facilities(db.query(Facility).filter(Facility.live()), Facility.id, db, current_user)
    rows = (
        scoped_query.with_entities(
            Facility.country,
            func.count(Facility.id).label("facility_count"),
            func.sum(case((func.lower(Facility.status) == "active", 1), else_=0)).label("active_count"),
            func.sum(
                case(
                    (or_(Facility.tier_id.isnot(None), tier_assignment_exists), 1),
                    else_=0,
                )
            ).label("tiered_count"),
        )
        .group_by(Facility.country)
        .order_by(Facility.country.asc())
        .all()
    )
    countries = [
        {"country": row.country, "count": int(row.facility_count or 0)}
        for row in rows
        if row.country and row.country.strip()
    ]
    return {
        "total": sum(int(row.facility_count or 0) for row in rows),
        "active": sum(int(row.active_count or 0) for row in rows),
        "tiered": sum(int(row.tiered_count or 0) for row in rows),
        "countries": countries,
    }



@router.get("/search", response_model=List[schemas.FacilityBrief])
@cached_read("facilities", ttl_seconds=30)
def search_facilities(
    db: Session = Depends(get_db),
    q: str = Query("", min_length=0),
    exclude_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Lightweight facility search for parent/child dropdowns."""
    query = scope_query_to_user_facilities(db.query(Facility).filter(Facility.live()), Facility.id, db, current_user)
    query = query.filter(Facility.parent_facility_id.is_(None))
    if q:
        query = query.filter(Facility.name.ilike(f"%{q}%"))
    if exclude_id:
        query = query.filter(Facility.id != exclude_id)
    return query.limit(50).all()


@router.get("/export-csv")
def export_facilities_csv(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_superadmin_user),
) -> Any:
    """Export all facilities for super admin review."""
    facilities = db.query(Facility).filter(Facility.live()).order_by(Facility.name.asc()).all()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "id", "name", "status", "address", "suite", "city", "state", "zip_code", "country",
        "phone", "email", "contact_person", "timezone", "operating_hours", "tiers",
        "billing_name", "billing_email", "created_at", "updated_at",
    ])
    for facility in facilities:
        tiers = [ft.tier.name for ft in facility.facility_tiers if ft.tier]
        if not tiers and facility.tier:
            tiers = [facility.tier.name]
        writer.writerow([
            facility.id,
            facility.name,
            facility.status,
            facility.address,
            facility.suite,
            facility.city,
            facility.state,
            facility.zip_code,
            facility.country,
            _format_us_phone(facility.phone),
            facility.email,
            facility.contact_person,
            _facility_timezone_label(facility.timezone),
            facility.operating_hours,
            ", ".join(tiers),
            facility.billing_name,
            facility.billing_email,
            facility.created_at,
            facility.updated_at,
        ])

    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="facilities.csv"'},
    )


@router.get("/{id}/export-scoped")
def export_scoped_facility_data(
    id: int,
    scope: str = Query("facility_info"),
    format: str = Query("csv", pattern="^(csv|pdf)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Export scoped facility information and/or facility inventory.

    Every facility included in the export is checked with the normal facility
    access rules, so parent/child exports cannot leak data outside the user's
    allowed facility scope.
    """
    if scope not in SCOPED_EXPORT_SCOPES:
        raise HTTPException(status_code=400, detail="Unsupported export scope")

    facility = _live(db, id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    require_facility_access(db, current_user, facility.id)

    facilities = _scoped_facilities(db, facility, scope)
    for scoped_facility in facilities:
        require_facility_access(db, current_user, scoped_facility.id)

    facility_ids = [item.id for item in facilities]
    include_facilities = _scope_includes_facility_rows(scope)
    include_inventory = _scope_includes_inventory(scope)
    equipment_items = _scoped_equipment(db, facility_ids) if include_inventory else []
    label = SCOPED_EXPORT_LABELS.get(scope, "Facility Export")
    filename_base = _safe_filename(f"{facility.name}_{scope}")

    if format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["Export", label])
        writer.writerow(["Base Facility", facility.name])
        writer.writerow(["Generated For", current_user.username])
        writer.writerow([])

        if include_facilities:
            writer.writerow(["Facilities"])
            writer.writerow(_facility_csv_headers())
            for scoped_facility in facilities:
                writer.writerow(_facility_csv_row(scoped_facility))
            if not facilities:
                writer.writerow(["No facilities found for selected scope"])
            writer.writerow([])

        if include_inventory:
            writer.writerow(["Facility Inventory"])
            writer.writerow(_equipment_csv_headers())
            for item in equipment_items:
                writer.writerow(_equipment_csv_row(item))
            if not equipment_items:
                writer.writerow(["No inventory found for selected scope"])

        return StreamingResponse(
            iter([buffer.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.csv"'},
        )

    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas as pdf_canvas

        buffer = io.BytesIO()
        c = pdf_canvas.Canvas(buffer, pagesize=letter)
        width, height = letter
        y = height - 56

        def write_line(text: str, font_size=10, bold=False):
            nonlocal y
            if y < 56:
                c.showPage()
                y = height - 56
            c.setFont("Helvetica-Bold" if bold else "Helvetica", font_size)
            c.drawString(44, y, str(text))
            y -= font_size + 5

        def write_section(title: str):
            nonlocal y
            y -= 8
            write_line(title, 13, bold=True)
            y -= 3

        c.setFont("Helvetica-Bold", 18)
        c.drawString(44, y, label)
        y -= 26
        c.setStrokeColorRGB(0.486, 0.227, 0.929)
        c.setLineWidth(2)
        c.line(44, y, width - 44, y)
        y -= 18
        write_line(f"Base Facility: {facility.name}", 10, bold=True)
        write_line(f"Generated For: {current_user.username}", 9)

        if include_facilities:
            write_section("Facilities")
            if facilities:
                for scoped_facility in facilities:
                    write_line(scoped_facility.name, 11, bold=True)
                    write_line(f"ID: {scoped_facility.id} | Status: {scoped_facility.status or '—'}")
                    write_line(f"Address: {scoped_facility.address}, {scoped_facility.city}, {scoped_facility.state} {scoped_facility.zip_code}")
                    write_line(f"Phone: {_format_us_phone(scoped_facility.phone)} | Email: {scoped_facility.email or '—'}")
                    write_line(f"Timezone: {_facility_timezone_label(scoped_facility.timezone)} | Hours: {scoped_facility.operating_hours or '—'}")
                    write_line(f"Tiers: {_facility_tier_names(scoped_facility) or '—'}")
                    parent_name = "—"
                    if scoped_facility.parent_facility_id:
                        parent = db.query(Facility).filter(Facility.id == scoped_facility.parent_facility_id).first()
                        parent_name = parent.name if parent else f"ID #{scoped_facility.parent_facility_id}"
                    write_line(f"Parent Facility: {parent_name}")
                    y -= 4
            else:
                write_line("No facilities found for selected scope.")

        if include_inventory:
            write_section("Facility Inventory")
            if equipment_items:
                for item in equipment_items:
                    facility_name = item.facility.name if item.facility else "—"
                    write_line(f"{item.asset_tag or '—'} | {item.make or ''} {item.model or ''}", 10, bold=True)
                    write_line(f"Facility: {facility_name} | Serial: {item.serial_number or '—'} | Status: {_status_value(item.status) or '—'}")
                    write_line(f"Modality: {item.modality.name if item.modality else '—'} | Tier: {item.tier.name if item.tier else '—'}")
                    write_line(f"Location: {item.location or '—'} | PM: {item.pm_scheduling or '—'} | Next PM: {item.next_generated_pm_date or '—'}")
                    y -= 3
            else:
                write_line("No inventory found for selected scope.")

        c.setFont("Helvetica-Oblique", 8)
        c.drawString(44, 28, "Generated by Medrad Admin Panel")
        c.save()
        buffer.seek(0)
        return StreamingResponse(
            buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.pdf"'},
        )
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="PDF generation requires the 'reportlab' package. Install it with: pip install reportlab",
        )


@router.post("/", response_model=schemas.Facility, status_code=201)
def create_facility(
    *,
    db: Session = Depends(get_db),
    facility_in: schemas.FacilityCreate,
    auto_unique_name: bool = Query(False),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Create a new facility — admin/superadmin only."""
    tier_ids = facility_in.tier_ids
    data = facility_in.model_dump(exclude={"tier_ids"})
    requested_name = _clean_facility_name(data.get("name"))
    if str(data.get("status") or "").strip().lower() == Facility.DELETED:
        raise HTTPException(status_code=400, detail="A new site cannot start out deleted")
    if auto_unique_name:
        data["name"] = _next_facility_copy_name(db, requested_name)
    else:
        _lock_facility_name(db, _facility_name_key(requested_name))
        _require_unique_facility_name(db, requested_name)
        data["name"] = requested_name
    data["phone"] = _normalize_us_phone(data.get("phone"))
    data["timezone"] = _normalize_facility_timezone(data.get("timezone"))
    if tier_ids is None and data.get("tier_id"):
        tier_ids = [data["tier_id"]]
    _validate_parent_facility(db, parent_facility_id=data.get("parent_facility_id"))
    facility = Facility(**data)
    db.add(facility)
    try:
        db.flush()
    except IntegrityError as error:
        _raise_facility_name_conflict(db, error)
    _sync_facility_tiers(db, facility, tier_ids)
    # Assign the creator to the site they just made. Without this a facility
    # admin registers a hospital and then cannot open it — the scoping added
    # for technicians and facility roles filters it straight back out, and the
    # symptom is a site that exists but is invisible to the person who made it.
    if is_facility_scoped_user(current_user):
        already = db.query(UserFacility).filter(
            UserFacility.user_id == current_user.id,
            UserFacility.facility_id == facility.id,
        ).first()
        if not already:
            db.add(UserFacility(user_id=current_user.id, facility_id=facility.id))

    db.commit()
    db.refresh(facility)
    audit_data = facility_in.model_dump()
    audit_data["name"] = facility.name
    log_activity(db, "facilities", facility.id, "CREATE", current_user, audit_data)
    return _facility_response(db, facility)


@router.get("/{id}/overview")
def facility_overview(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """The numbers this site's dashboard opens on.

    One request rather than the browser firing eight list calls and counting
    rows, which is slower and also wrong: a list capped at 200 reports 200 beds
    however many there really are.
    """
    facility = _live(db, id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    require_facility_access(db, current_user, id)
    from app.services import site_overview
    return site_overview.build(db, id)


@router.get("/{id}", response_model=schemas.Facility)
def read_facility(
    *,
    db: Session = Depends(get_db),
    id: int,
    current_user: User = Depends(get_current_user),
) -> Any:
    """Get a single facility by ID."""
    facility = _live(db, id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    require_facility_access(db, current_user, facility.id)
    
    return _facility_response(db, facility)



@router.put("/{id}", response_model=schemas.Facility)
def update_facility(
    *,
    db: Session = Depends(get_db),
    id: int,
    facility_in: schemas.FacilityUpdate,
    current_user: User = Depends(get_current_user),
) -> Any:
    """Update a facility."""
    facility = _live(db, id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    require_facility_access(db, current_user, facility.id)
    old_data = {c.name: getattr(facility, c.name) for c in facility.__table__.columns}
    tier_ids = facility_in.tier_ids
    if tier_ids is None and facility_in.tier_id is not None:
        tier_ids = [facility_in.tier_id] if facility_in.tier_id else []
    update_data = facility_in.model_dump(exclude_unset=True)
    if str(update_data.get("status") or "").strip().lower() == Facility.DELETED:
        raise HTTPException(status_code=400, detail="To delete a site, use Delete site on the Sites page")
    if "name" in update_data:
        cleaned_name = _clean_facility_name(update_data.get("name"))
        _lock_facility_name(db, _facility_name_key(cleaned_name))
        _require_unique_facility_name(db, cleaned_name, exclude_id=facility.id)
        update_data["name"] = cleaned_name
    if "phone" in update_data:
        update_data["phone"] = _normalize_us_phone(update_data.get("phone"))
    if "timezone" in update_data:
        update_data["timezone"] = _normalize_facility_timezone(update_data.get("timezone"))
    if "parent_facility_id" in update_data:
        _validate_parent_facility(db, facility_id=facility.id, parent_facility_id=update_data.get("parent_facility_id"))
        _ensure_parent_can_become_child(db, facility, update_data.get("parent_facility_id"))
    try:
        updated = crud.facility.update(db=db, db_obj=facility, obj_in=update_data)
    except IntegrityError as error:
        _raise_facility_name_conflict(db, error)
    _sync_facility_tiers(db, updated, tier_ids)
    if tier_ids is not None:
        db.commit()
        db.refresh(updated)
    new_data = update_data
    log_activity(db, "facilities", id, "UPDATE", current_user, {"before": old_data, "after": new_data})
    return _facility_response(db, updated)


@router.delete("/{id}", response_model=schemas.Facility)
def delete_facility(
    *,
    db: Session = Depends(get_db),
    id: int,
    current_user: User = Depends(get_current_user),
) -> Any:
    """Delete a site - Super Admin and Admin only.

    The site leaves every list of sites, and people assigned only to it lose
    access, but nothing made at it is removed: its inspections, service jobs,
    invoices and attendance stay as history. Removing the row instead would
    be refused by the tables that point at a site, or would take permits,
    readings and compliance records with it.
    """
    require_module_permission(current_user, "facilities", "delete")
    facility = _live(db, id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    require_facility_access(db, current_user, facility.id)

    children = [name for (name,) in db.query(Facility.name).filter(
        Facility.parent_facility_id == id, Facility.live()).order_by(Facility.name).all()]
    if children:
        raise HTTPException(
            status_code=400,
            detail="Delete or move the sites under it first: {}.".format(", ".join(children)),
        )

    before = {c.name: str(getattr(facility, c.name)) for c in facility.__table__.columns}
    _lock_facility_name(db, f"deleted:{_facility_name_key(facility.name)}")
    facility.name = _deleted_name(db, facility)
    facility.status = Facility.DELETED
    try:
        db.commit()
    except IntegrityError as error:
        _raise_facility_name_conflict(db, error)
    db.refresh(facility)
    log_activity(db, "facilities", id, "DELETE", current_user, before)
    return _facility_response(db, facility)


# ─── Document endpoints ────────────────────────────────────────────

@router.get("/{id}/documents", response_model=schemas.FacilityDocumentListResponse)
def list_facility_documents(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """List all documents for a facility."""
    facility = _live(db, id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    require_facility_access(db, current_user, facility.id)
    docs = (
        db.query(FacilityDocument)
        .filter(FacilityDocument.facility_id == id)
        .order_by(FacilityDocument.uploaded_at.desc(), FacilityDocument.id.desc())
        .all()
    )
    return {"items": docs, "total": len(docs)}


@router.post("/{id}/documents", response_model=schemas.FacilityDocumentResponse, status_code=201)
async def upload_facility_document(
    id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Upload a document to a facility."""
    facility = _live(db, id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    require_facility_access(db, current_user, facility.id)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    file_ext = os.path.splitext(file.filename or "file")[1]
    stored_name = f"{uuid.uuid4().hex}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, stored_name)

    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    doc = FacilityDocument(
        facility_id=id,
        filename=file.filename or "untitled",
        file_path=file_path,
        file_type=file.content_type,
        file_size=len(content),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/{facility_id}/documents/{doc_id}/download")
def download_facility_document(
    facility_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Download a facility document after validating facility access."""
    doc = db.query(FacilityDocument).filter(
        FacilityDocument.id == doc_id,
        FacilityDocument.facility_id == facility_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    require_facility_access(db, current_user, doc.facility_id)

    try:
        file_path = protected_upload_path(
            UPLOAD_DIR,
            os.path.basename(doc.file_path or ""),
            "facility_documents",
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Document file not found")
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Document file not found")

    return FileResponse(
        file_path,
        filename=doc.filename or os.path.basename(file_path),
        media_type=doc.file_type or "application/octet-stream",
        headers={"Cache-Control": "private, no-store"},
    )


@router.delete("/{facility_id}/documents/{doc_id}")
def delete_facility_document(
    facility_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Delete a specific document from a facility."""
    doc = db.query(FacilityDocument).filter(
        FacilityDocument.id == doc_id,
        FacilityDocument.facility_id == facility_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    require_facility_access(db, current_user, doc.facility_id)

    # Never trust an absolute database path as a deletion target.
    try:
        file_path = protected_upload_path(
            UPLOAD_DIR,
            os.path.basename(doc.file_path or ""),
            "facility_documents",
        )
    except ValueError:
        file_path = None
    if file_path and os.path.isfile(file_path):
        os.remove(file_path)

    db.delete(doc)
    db.commit()
    return {"detail": "Document deleted"}


@router.get("/{id}/export-pdf")
def export_facility_pdf(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Export full facility data as a PDF."""
    facility = _live(db, id)
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")
    require_facility_access(db, current_user, facility.id)

    # Build PDF using basic reportlab-like approach with simple text
    # We'll generate a lightweight HTML-to-text PDF using minimal approach
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.pdfgen import canvas as pdf_canvas

        buffer = io.BytesIO()
        c = pdf_canvas.Canvas(buffer, pagesize=letter)
        width, height = letter
        y = height - 60

        def write_line(text: str, font_size=11, bold=False):
            nonlocal y
            if y < 60:
                c.showPage()
                y = height - 60
            c.setFont("Helvetica-Bold" if bold else "Helvetica", font_size)
            c.drawString(50, y, text)
            y -= font_size + 6

        def write_section(title: str):
            nonlocal y
            y -= 10
            write_line(title, 14, bold=True)
            y -= 4

        # Title
        c.setFont("Helvetica-Bold", 20)
        c.drawString(50, y, f"Facility Report: {facility.name}")
        y -= 30
        c.setStrokeColorRGB(0.486, 0.227, 0.929)
        c.setLineWidth(2)
        c.line(50, y, width - 50, y)
        y -= 20

        # General Information
        write_section("General Information")
        write_line(f"Name: {facility.name}")
        write_line(f"Contact Person: {facility.contact_person or '—'}")
        write_line(f"Phone: {_format_us_phone(facility.phone)}")
        write_line(f"Email: {facility.email}")
        write_line(f"Address: {facility.address}")
        write_line(f"Suite: {facility.suite or '—'}")
        write_line(f"City: {facility.city}")
        write_line(f"State/Province: {facility.state}")
        write_line(f"Zip Code: {facility.zip_code}")
        write_line(f"Country: {facility.country}")
        write_line(f"Website: {facility.website or '—'}")
        write_line(f"Timezone: {_facility_timezone_label(facility.timezone)}")
        write_line(f"Operating Hours: {facility.operating_hours or '—'}")

        # Facility Details
        write_section("Facility Details")
        parent_name = "—"
        if facility.parent_facility_id:
            parent = crud.facility.get(db=db, id=facility.parent_facility_id)
            parent_name = parent.name if parent else f"ID #{facility.parent_facility_id}"
        write_line(f"Parent Facility: {parent_name}")
        write_line(f"Status: {facility.status or '—'}")
        write_line(f"Tier: {facility.tier.name if facility.tier else '—'}")

        # Children
        children = db.query(Facility).filter(Facility.parent_facility_id == facility.id).all()
        if children:
            write_line(f"Child Facilities: {', '.join([ch.name for ch in children])}")
        else:
            write_line("Child Facilities: —")

        # Billing
        write_section("Billing Information")
        write_line(f"Name: {facility.billing_name or '—'}")
        write_line(f"Email: {facility.billing_email or '—'}")
        write_line(f"Street: {facility.billing_street or '—'}")
        write_line(f"Suite: {facility.billing_suite or '—'}")
        write_line(f"City: {facility.billing_city or '—'}")
        write_line(f"State: {facility.billing_state or '—'}")
        write_line(f"Zip Code: {facility.billing_zip_code or '—'}")

        # Other Settings
        write_section("Other Settings")
        write_line(f"Tax Exemption: {'Yes' if facility.tax_exemption else 'No'}")
        write_line(f"Inheritance: {facility.inheritance or '—'}")
        write_line(f"Installment Type: {facility.installment_type or '—'}")
        write_line(f"Payment Method: {facility.payment_method or '—'}")
        write_line(f"Delivery Email: {facility.delivery_email or '—'}")

        # Documents list
        docs = db.query(FacilityDocument).filter(FacilityDocument.facility_id == id).all()
        if docs:
            write_section("Attached Documents")
            for doc in docs:
                write_line(f"• {doc.filename} ({doc.file_type or 'unknown'}, {doc.file_size or 0} bytes)")

        # Footer
        y -= 20
        c.setFont("Helvetica-Oblique", 8)
        c.drawString(50, 30, f"Generated on {facility.updated_at.strftime('%Y-%m-%d %H:%M') if facility.updated_at else '—'} | Medrad Admin Panel")

        c.save()
        buffer.seek(0)

        return StreamingResponse(
            buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="facility_{facility.id}_{facility.name}.pdf"'},
        )

    except ImportError:
        # Fallback: return JSON if reportlab not installed
        raise HTTPException(
            status_code=501,
            detail="PDF generation requires the 'reportlab' package. Install it with: pip install reportlab"
        )
