"""A site's fleet: its vehicles, and the forms they are inspected on.

A vehicle carries the same inspection clock as equipment, so the due list, the
visits and the dashboard count it without a second set of rules. What it does
not carry is a book value: a fleet is run, not depreciated here.
"""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.base import get_db
from app.models.facility import Facility
from app.models.inspection import Inspection
from app.models.inspection_form import InspectionForm
from app.models.inspection_form_link import InspectionFormLink
from app.models.red_tag import RedTag
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.inspection_programme import FormAttachIn, VehicleIn, VehicleUpdate
from app.services import inspection_programme as programme
from app.utils.clock import utc_today
from app.utils.facility_access import require_facility_access
from app.utils.permission_deps import require_module_access
from app.utils.permissions import require_module_permission

router = APIRouter(dependencies=[Depends(require_module_access("inspections"))])


def _site(db: Session, user: User, facility_id: int) -> Facility:
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Site not found")
    require_facility_access(db, user, facility_id)
    return facility


def _vehicle(db: Session, user: User, vehicle_id: int) -> Vehicle:
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    require_facility_access(db, user, vehicle.facility_id)
    return vehicle


def _payload(db: Session, vehicle: Vehicle, *, tagged: Optional[set] = None) -> dict:
    if tagged is None:
        _, tagged = programme.open_tag_ids(db, vehicle.facility_id)
    return programme.item_payload(vehicle, kind="vehicle", red_tagged=vehicle.id in tagged)


@router.get("/vehicles")
def list_vehicles(
    facility_id: int = Query(...),
    search: Optional[str] = Query(None),
    due_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """The site's vehicles, with where each one stands."""
    _site(db, current_user, facility_id)
    query = programme.vehicle_query(db, facility_id)
    if search and search.strip():
        like = f"%{search.strip()}%"
        query = query.filter(or_(Vehicle.name.ilike(like), Vehicle.registration.ilike(like),
                                 Vehicle.vehicle_type.ilike(like), Vehicle.driver_name.ilike(like),
                                 Vehicle.make.ilike(like), Vehicle.model.ilike(like)))
    _, tagged = programme.open_tag_ids(db, facility_id)
    today = utc_today()
    rows = [_payload(db, vehicle, tagged=tagged)
            for vehicle in query.order_by(func.lower(Vehicle.name)).all()]
    if due_only:
        rows = [row for row in rows if row["due_state"] in ("due", "overdue")]
    forms = [programme.form_payload(link, form) for link, form in programme.forms_for(db, facility_id=facility_id)]
    db.commit()
    return {
        "items": rows,
        "total": len(rows),
        "forms": forms,
        "counts": {
            "vehicles": len(rows),
            "due": sum(1 for row in rows if row["due_state"] == "due"),
            "overdue": sum(1 for row in rows if row["due_state"] == "overdue"),
            "red_tagged": sum(1 for row in rows if row["red_tagged"]),
            "passed": sum(1 for row in rows if row["last_result"] == "pass" and not row["red_tagged"]),
            "failed": sum(1 for row in rows if row["last_result"] == "fail" and not row["red_tagged"]),
        },
        "as_of": today,
    }


@router.get("/vehicles/{vehicle_id}")
def get_vehicle(
    vehicle_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """One vehicle, with what its inspections have found."""
    vehicle = _vehicle(db, current_user, vehicle_id)
    history = (
        db.query(Inspection).filter(Inspection.vehicle_id == vehicle.id)
        .order_by(Inspection.completed_at.desc().nullslast(), Inspection.id.desc()).limit(25).all()
    )
    payload = _payload(db, vehicle)
    tags = [programme.red_tag_payload(db, tag) for tag in db.query(RedTag).filter(
        RedTag.vehicle_id == vehicle.id).order_by(RedTag.raised_at.desc()).limit(25).all()]
    inspections = [programme.inspection_payload(db, row) for row in history]
    db.commit()
    return {"vehicle": payload, "inspections": inspections, "red_tags": tags}


@router.post("/vehicles", status_code=201)
def add_vehicle(
    payload: VehicleIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    require_module_permission(current_user, "inspections", "add")
    facility = _site(db, current_user, payload.facility_id)
    vehicle = Vehicle(
        facility_id=facility.id,
        name=payload.name.strip(),
        registration=(payload.registration or "").strip() or None,
        vehicle_type=(payload.vehicle_type or "").strip() or None,
        make=(payload.make or "").strip() or None,
        model=(payload.model or "").strip() or None,
        year=payload.year,
        driver_name=(payload.driver_name or "").strip() or None,
        odometer=payload.odometer,
        condition=payload.condition,
        notes=(payload.notes or "").strip() or None,
        pm_task=(payload.pm_task or "").strip() or None,
        pm_assignee_id=payload.pm_assignee_id,
    )
    programme.apply_schedule(vehicle, frequency=payload.frequency, interval_days=payload.interval_days,
                             first_due=payload.first_due_on)
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return _payload(db, vehicle)


@router.put("/vehicles/{vehicle_id}")
def update_vehicle(
    vehicle_id: int,
    payload: VehicleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    require_module_permission(current_user, "inspections", "edit")
    vehicle = _vehicle(db, current_user, vehicle_id)
    changes = payload.model_dump(exclude_unset=True)
    for field in ("name", "registration", "vehicle_type", "make", "model", "driver_name", "notes", "pm_task"):
        if field in changes:
            value = (changes[field] or "").strip() or None
            if field == "name" and not value:
                raise HTTPException(status_code=422, detail="A vehicle needs a name")
            setattr(vehicle, field, value)
    for field in ("year", "odometer", "condition", "pm_assignee_id"):
        if field in changes and changes[field] is not None:
            setattr(vehicle, field, changes[field])
    if {"frequency", "interval_days", "first_due_on"} & set(changes):
        programme.apply_schedule(
            vehicle,
            frequency=changes.get("frequency", vehicle.pm_scheduling),
            interval_days=changes.get("interval_days", vehicle.inspection_interval_days),
            first_due=changes.get("first_due_on"),
        )
    db.commit()
    db.refresh(vehicle)
    return _payload(db, vehicle)


@router.delete("/vehicles/{vehicle_id}")
def remove_vehicle(
    vehicle_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Remove a vehicle entered by mistake. One with inspections keeps its history."""
    require_module_permission(current_user, "inspections", "delete")
    vehicle = _vehicle(db, current_user, vehicle_id)
    inspected = db.query(func.count(Inspection.id)).filter(Inspection.vehicle_id == vehicle.id).scalar() or 0
    if inspected:
        raise HTTPException(
            status_code=409,
            detail=f"{vehicle.name} has {inspected} inspection{'s' if inspected != 1 else ''} on record. "
                   "Set it Out of service instead, so that history stays.",
        )
    db.delete(vehicle)
    db.commit()
    return {"detail": "Vehicle removed"}


@router.post("/forms", status_code=201)
def attach_fleet_form(
    payload: FormAttachIn,
    facility_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Say that this site's vehicles are inspected on this form."""
    require_module_permission(current_user, "inspections", "add")
    _site(db, current_user, facility_id)
    link = programme.attach_form(db, form_id=payload.form_id, facility_id=facility_id,
                                 default_frequency=payload.default_frequency,
                                 default_interval_days=payload.default_interval_days)
    db.commit()
    return programme.form_payload(link, db.get(InspectionForm, link.form_id))


@router.delete("/forms/{link_id}")
def detach_fleet_form(
    link_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    require_module_permission(current_user, "inspections", "delete")
    link = db.get(InspectionFormLink, link_id)
    if link is None or link.scope != "fleet":
        raise HTTPException(status_code=404, detail="That form is not attached to a fleet")
    require_facility_access(db, current_user, link.facility_id)
    db.delete(link)
    db.commit()
    return {"detail": "Form removed from the fleet"}
