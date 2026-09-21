"""A site's equipment under Electrical, Plumbing, Mechanical and HVAC.

See app/services/site_categories.py for why these are equipment rows and what
marks one as entered here.
"""
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.base import get_db
from app.models.equipment import Equipment
from app.models.facility import Facility
from app.models.inspection import Inspection
from app.models.service_request import ServiceRequest
from app.models.user import User
from app.schemas.site_categories import CategoryAdopt, CategoryEquipmentCreate, CategoryEquipmentUpdate
from app.services import asset_tags, site_categories
from app.utils.facility_access import require_facility_access
from app.utils.permission_deps import require_module_access
from app.utils.permissions import require_module_permission

router = APIRouter(dependencies=[Depends(require_module_access("facility-inventory"))])


def _site_or_404(db: Session, user: User, facility_id: int) -> Facility:
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Site not found")
    require_facility_access(db, user, facility_id)
    return facility


def _item_or_404(db: Session, user: User, equipment_id: int) -> Equipment:
    asset = db.get(Equipment, equipment_id)
    if asset is None or asset.name is None:
        raise HTTPException(status_code=404, detail="Equipment not found")
    require_facility_access(db, user, asset.facility_id)
    return asset


def _category_of(db: Session, asset: Equipment) -> site_categories.Category:
    ids = site_categories.ensure_disciplines(db)
    code = next((code for code, pk in ids.items() if pk == asset.discipline_id), None)
    if code is None:
        raise HTTPException(status_code=404, detail="Equipment not found")
    return site_categories.BY_CODE[code]


def _department_or_422(db: Session, user: User, facility_id: int, department_id: Optional[int]):
    """The department that answers for an item, checked against its own site."""
    from app.models.department import Department

    if department_id is None:
        return None
    department = db.get(Department, department_id)
    if department is None or department.facility_id != facility_id:
        raise HTTPException(status_code=422, detail="That department belongs to another site")
    return department


def _apply_programme(db: Session, user: User, asset: Equipment, changes: dict) -> None:
    """Put the item in its department and on its inspection clock."""
    from app.services import inspection_programme as programme

    if "department_id" in changes:
        department = _department_or_422(db, user, asset.facility_id, changes["department_id"])
        asset.department_id = department.id if department else None
    if "pm_task" in changes:
        asset.pm_task = (changes["pm_task"] or "").strip()[:500] or None
    if "pm_assignee_id" in changes:
        person = db.get(User, changes["pm_assignee_id"]) if changes["pm_assignee_id"] else None
        if changes["pm_assignee_id"] and (person is None or not person.is_active):
            raise HTTPException(status_code=422, detail="No active person with that id")
        asset.pm_assignee_id = person.id if person else None
    if {"frequency", "interval_days", "first_due_on"} & set(changes):
        programme.apply_schedule(
            asset,
            frequency=changes.get("frequency", asset.pm_scheduling),
            interval_days=changes.get("interval_days", asset.inspection_interval_days),
            first_due=changes.get("first_due_on"),
        )


def _response(db: Session, asset: Equipment, category: site_categories.Category) -> dict:
    from app.models.department import Department

    department = db.get(Department, asset.department_id) if asset.department_id else None
    return site_categories.serialise(asset, category, site_categories.job_facts(db, [asset.id]).get(asset.id),
                                     site_categories.value_facts(db, [asset]).get(asset.id),
                                     department_name=department.name if department else None)


# The asset table's cost column is Numeric(10, 2).
MAX_TOTAL_COST = Decimal("99999999.99")


def _set_cost(asset: Equipment, unit: Optional[Decimal], quantity: int) -> None:
    total = site_categories.total_cost(unit, quantity)
    if total is not None and total > MAX_TOTAL_COST:
        raise HTTPException(status_code=422, detail="The total cost is too large to record")
    asset.cost = total


@router.get("/value-preview")
def value_preview(
    unit_cost: Optional[Decimal] = Query(None, ge=0),
    quantity: int = Query(1, ge=1),
    in_service_on: Optional[date] = Query(None),
    useful_life_years: Optional[Decimal] = Query(None, gt=0, le=100),
    equipment_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """What the form's figures come to, before saving: total cost, book value today
    and yearly depreciation, including major work already posted when editing."""
    from app.models.asset_ledger import AssetLedgerEntry
    from app.services import asset_ledger, depreciation

    entries = []
    if equipment_id is not None:
        asset = _item_or_404(db, current_user, equipment_id)
        entries = (db.query(AssetLedgerEntry).filter(AssetLedgerEntry.equipment_id == asset.id)
                   .order_by(AssetLedgerEntry.effective_date.asc()).all())
    total = site_categories.total_cost(unit_cost, quantity)
    result = depreciation.compute(
        cost=total, useful_life_years=useful_life_years, in_service_date=in_service_on,
        basis_changes=asset_ledger.basis_changes(entries), disposed_on=asset_ledger.disposal_date(entries),
    )
    valued = result.message is None
    return {
        "total_cost": total,
        "book_value": result.net_book_value if valued else None,
        "annual_depreciation": result.annual_depreciation.quantize(Decimal("0.01")) if valued else None,
        "message": result.message,
    }


@router.get("/overview")
def overview(
    facility_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """The four categories with how much equipment each has, and how much is wrong."""
    _site_or_404(db, current_user, facility_id)
    categories = site_categories.overview(db, facility_id)
    db.commit()  # ensure_disciplines may have written the category rows
    return {
        "categories": categories,
        "conditions": [{"value": key, "label": label} for key, label in site_categories.CONDITIONS.items()],
    }


@router.get("/suggestions")
def suggestions(
    facility_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Buildings, floors and spots already used at this site, to suggest while typing."""
    _site_or_404(db, current_user, facility_id)
    return site_categories.suggestions(db, facility_id)


@router.get("/{code}/equipment")
def list_category_equipment(
    code: str,
    facility_id: int = Query(...),
    search: Optional[str] = Query(None),
    building: Optional[str] = Query(None),
    floor: Optional[str] = Query(None),
    department: Optional[str] = Query(None, description="A department's id, or 'none' for items in none"),
    condition: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    category = site_categories.category_or_404(code)
    _site_or_404(db, current_user, facility_id)
    ids = site_categories.ensure_disciplines(db)
    db.commit()

    query = site_categories.items_query(db, facility_id, ids[category.code])
    if building:
        query = query.filter(func.lower(Equipment.building) == building.strip().lower())
    if floor:
        query = query.filter(func.lower(Equipment.floor) == floor.strip().lower())
    if department:
        if department == "none":
            query = query.filter(Equipment.department_id.is_(None))
        elif department.isdigit():
            query = query.filter(Equipment.department_id == int(department))
        else:
            raise HTTPException(status_code=422, detail="department is a department's id, or 'none'")
    if condition:
        if condition not in site_categories.CONDITIONS:
            raise HTTPException(status_code=422, detail="Unknown condition")
        query = query.filter(Equipment.condition == condition)
    if search and search.strip():
        like = f"%{search.strip()}%"
        query = query.filter(or_(
            Equipment.name.ilike(like), Equipment.equipment_type.ilike(like), Equipment.asset_tag.ilike(like),
            Equipment.building.ilike(like), Equipment.floor.ilike(like), Equipment.location.ilike(like),
            Equipment.make.ilike(like), Equipment.model.ilike(like),
        ))

    rows = query.order_by(func.lower(Equipment.name), Equipment.id).all()
    facts = site_categories.job_facts(db, [row.id for row in rows])
    values = site_categories.value_facts(db, rows)
    from app.models.department import Department
    from app.services import inspection_programme as programme

    names = dict(db.query(Department.id, Department.name).filter(Department.facility_id == facility_id).all())
    tagged, _ = programme.open_tag_ids(db, facility_id)
    return {
        "category": {"code": category.code, "name": category.name, "colour": category.colour,
                     "types": list(category.types),
                     "default_useful_life_years": site_categories.default_useful_life(category.code)},
        "items": [site_categories.serialise(row, category, facts.get(row.id), values.get(row.id),
                                            department_name=names.get(row.department_id),
                                            red_tagged=row.id in tagged) for row in rows],
        "departments": [{"id": pk, "name": name} for pk, name in sorted(names.items(), key=lambda r: r[1].lower())],
        "total": len(rows),
    }


@router.post("/{code}/equipment", status_code=201)
def add_category_equipment(
    code: str,
    payload: CategoryEquipmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Add equipment to a category. It is given the site's next asset tag."""
    require_module_permission(current_user, "facility-inventory", "add")
    category = site_categories.category_or_404(code)
    facility = _site_or_404(db, current_user, payload.facility_id)
    ids = site_categories.ensure_disciplines(db)

    name, kind = site_categories.tidy(payload.name), site_categories.tidy(payload.type)
    building = site_categories.match_existing_spelling(db, facility.id, "building", payload.building)
    if not (name and kind):
        raise HTTPException(status_code=422, detail="Name and type are required")

    asset = Equipment(
        facility_id=facility.id,
        discipline_id=ids[category.code],
        asset_tag=asset_tags.next_tags(db, facility, 1)[0],
        name=name,
        equipment_type=kind,
        quantity=payload.quantity,
        building=building,
        floor=site_categories.match_existing_spelling(db, facility.id, "floor", payload.floor),
        location=site_categories.tidy(payload.spot),
        condition=payload.condition,
        make=site_categories.tidy(payload.make) or "",
        model=site_categories.tidy(payload.model) or "",
        serial_number="",
        description=site_categories.tidy(payload.notes),
        installation_date=payload.in_service_on,
        # A life is seeded from the category, as the asset register does, so a
        # cost and a date are all that is needed for a book value.
        useful_life_years=payload.useful_life_years or site_categories.default_useful_life(category.code),
    )
    _set_cost(asset, payload.unit_cost, payload.quantity)
    _apply_programme(db, current_user, asset, payload.model_dump(
        include={"department_id", "frequency", "interval_days", "first_due_on", "pm_task", "pm_assignee_id"},
        exclude_unset=True))
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return _response(db, asset, category)


@router.put("/equipment/{equipment_id}")
def update_category_equipment(
    equipment_id: int,
    payload: CategoryEquipmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    require_module_permission(current_user, "facility-inventory", "edit")
    asset = _item_or_404(db, current_user, equipment_id)
    category = _category_of(db, asset)
    changes = payload.model_dump(exclude_unset=True)

    if changes.get("category"):
        category = site_categories.category_or_404(changes["category"])
        asset.discipline_id = site_categories.ensure_disciplines(db)[category.code]
    for field, column in (("name", "name"), ("type", "equipment_type")):
        if field in changes:
            value = site_categories.tidy(changes[field])
            if not value:
                raise HTTPException(status_code=422, detail=f"{field.capitalize()} cannot be blank")
            setattr(asset, column, value)
    if "building" in changes:
        asset.building = site_categories.match_existing_spelling(
            db, asset.facility_id, "building", changes["building"])
    if "floor" in changes:
        asset.floor = site_categories.match_existing_spelling(db, asset.facility_id, "floor", changes["floor"])
    if "spot" in changes:
        asset.location = site_categories.tidy(changes["spot"])
    # The total follows the quantity: one item's price is kept unless a new one
    # is given, and the stored total is recomputed from it.
    if "unit_cost" in changes or changes.get("quantity") is not None:
        unit = changes["unit_cost"] if "unit_cost" in changes else site_categories.unit_cost(asset)
        quantity = changes.get("quantity") or asset.quantity or 1
        asset.quantity = quantity
        _set_cost(asset, unit, quantity)
    if "in_service_on" in changes:
        asset.installation_date = changes["in_service_on"]
    if "useful_life_years" in changes:
        asset.useful_life_years = changes["useful_life_years"] or site_categories.default_useful_life(category.code)
    if changes.get("condition") is not None:
        asset.condition = changes["condition"]
    for field in ("make", "model"):
        if field in changes:
            setattr(asset, field, site_categories.tidy(changes[field]) or "")
    if "notes" in changes:
        asset.description = site_categories.tidy(changes["notes"])
    _apply_programme(db, current_user, asset, changes)

    db.commit()
    db.refresh(asset)
    return _response(db, asset, category)


@router.post("/{code}/adopt/{equipment_id}")
def adopt_into_category(
    code: str,
    equipment_id: int,
    payload: CategoryAdopt,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Bring an asset from the register into a category without retyping it.

    It keeps its tag, cost, dates and history; it gains a name, a category and
    where exactly it is. Useful life is seeded from the category if it has none.
    """
    require_module_permission(current_user, "facility-inventory", "edit")
    category = site_categories.category_or_404(code)
    asset = db.get(Equipment, equipment_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    require_facility_access(db, current_user, asset.facility_id)
    if asset.name is not None:
        raise HTTPException(status_code=409, detail=f"{asset.asset_tag} is already in a category as {asset.name}")

    name, kind = site_categories.tidy(payload.name), site_categories.tidy(payload.type)
    if not (name and kind):
        raise HTTPException(status_code=422, detail="Name and type are required")
    department = _department_or_422(db, current_user, asset.facility_id, payload.department_id)
    asset.discipline_id = site_categories.ensure_disciplines(db)[category.code]
    asset.name, asset.equipment_type = name, kind
    if department is not None:
        asset.department_id = department.id
    # Where it is, only if given: what the register already knew stays.
    if payload.building:
        asset.building = site_categories.match_existing_spelling(db, asset.facility_id, "building", payload.building)
    if payload.floor:
        asset.floor = site_categories.match_existing_spelling(db, asset.facility_id, "floor", payload.floor)
    if payload.spot is not None:
        asset.location = site_categories.tidy(payload.spot)
    asset.quantity = asset.quantity or 1
    asset.condition = asset.condition or "working"
    if not asset.useful_life_years:
        asset.useful_life_years = site_categories.default_useful_life(category.code)
    db.commit()
    db.refresh(asset)
    return _response(db, asset, category)


@router.delete("/equipment/{equipment_id}")
def delete_category_equipment(
    equipment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Remove equipment entered by mistake. Equipment with jobs keeps its history."""
    require_module_permission(current_user, "facility-inventory", "delete")
    asset = _item_or_404(db, current_user, equipment_id)
    jobs = db.query(func.count(ServiceRequest.id)).filter(ServiceRequest.equipment_id == asset.id).scalar()
    inspections = db.query(func.count(Inspection.id)).filter(Inspection.equipment_id == asset.id).scalar()
    if jobs or inspections:
        count = (jobs or 0) + (inspections or 0)
        raise HTTPException(
            status_code=409,
            detail=f"{asset.name} has {count} job{'s' if count != 1 else ''} on record. "
                   "Mark it Out of service instead, so that history stays.",
        )
    db.delete(asset)
    db.commit()
    return {"detail": "Equipment removed"}
