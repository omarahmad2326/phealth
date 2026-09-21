"""The inspection programme: the dashboard, departments, due items, visits and red tags.

See app/services/inspection_programme.py for the rules. These endpoints are
the screens: what is due, who is inspecting it, what it came to.
"""
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.base import get_db
from app.models.department import Department
from app.models.equipment import Equipment
from app.models.facility import Facility
from app.models.inspection import Inspection, InspectionBatch, InspectionStatus
from app.models.inspection_form import InspectionForm
from app.models.inspection_form_link import InspectionFormLink
from app.models.red_tag import RedTag
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.schemas.inspection_programme import (
    BulkAssignIn, ClearRedTagIn, FinishVisitIn, FormAttachIn, InspectNowIn, ItemScheduleIn, RecordItemIn,
    VisitIn,
)
from app.services import inspection_due, inspection_programme as programme
from app.utils.clock import utc_today
from app.utils.facility_access import (
    get_user_facility_ids, is_facility_scoped_user, require_facility_access,
)
from app.utils.permission_deps import require_module_access
from app.utils.permissions import require_module_permission

router = APIRouter(dependencies=[Depends(require_module_access("inspections"))])


def _site(db: Session, user: User, facility_id: int) -> Facility:
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Site not found")
    require_facility_access(db, user, facility_id)
    return facility


def _visible_sites(db: Session, user: User) -> list[Facility]:
    query = db.query(Facility).filter(Facility.status != "inactive")
    if is_facility_scoped_user(user):
        ids = get_user_facility_ids(db, user)
        if not ids:
            return []
        query = query.filter(Facility.id.in_(list(ids)))
    return query.order_by(func.lower(Facility.name)).all()


def _department(db: Session, user: User, department_id: int) -> Department:
    department = db.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found")
    require_facility_access(db, user, department.facility_id)
    return department


def _may_fill(db: Session, user: User, batch: InspectionBatch) -> None:
    """Filling in a visit is for the person it was given to, admins and Super Admins."""
    if user.role in (UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.FACILITY_ADMIN):
        return
    if batch.inspector_id == user.id:
        return
    raise HTTPException(status_code=403, detail="Only the assigned inspector, an admin or a Super Admin "
                                                "can fill in this visit")


# ── the dashboard ────────────────────────────────────────────────────────────

@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Every site the person can see, with its inspection numbers."""
    sites = _visible_sites(db, current_user)
    payload = programme.dashboard(db, sites)
    payload["frequencies"] = [{"value": key, "label": label} for key, label in programme.FREQUENCIES.items()]
    payload["due_soon_days"] = programme.DUE_SOON_DAYS
    return payload


@router.get("/status")
def inspection_status(
    state: str = Query(...),
    facility_id: Optional[int] = Query(None),
    department_id: Optional[int] = Query(None),
    kind: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """The items behind a count card: what passed, failed, is red-tagged, in
    progress, due or overdue. Exactly the number the card shows."""
    if facility_id is not None:
        sites = [_site(db, current_user, facility_id)]
    else:
        sites = _visible_sites(db, current_user)
    if department_id is not None:
        department = _department(db, current_user, department_id)
        sites = [site for site in sites if site.id == department.facility_id]
    if kind not in (None, "equipment", "vehicle"):
        raise HTTPException(status_code=422, detail="kind is equipment or vehicle")
    rows = programme.status_rows(db, sites, state, department_id=department_id, kind=kind)
    db.commit()
    return {"state": state, "label": programme.STATES.get(state, state), "total": len(rows), "items": rows,
            "states": [{"value": key, "label": label} for key, label in programme.STATES.items()]}


@router.get("/sites/{facility_id}/overview")
def site_overview(
    facility_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """One site: its numbers, its departments, its fleet and its red tags."""
    facility = _site(db, current_user, facility_id)
    counts = programme.site_counts(db, facility_id)
    departments = programme.department_rows(db, facility_id)
    db.commit()  # department_rows may create nothing, but forms_for can flush
    vehicles = programme.vehicle_query(db, facility_id).all()
    today = utc_today()
    fleet_due = sum(1 for v in vehicles if programme.due_state(v, today=today) in ("due", "overdue"))
    return {
        "site": {
            "id": facility.id, "name": facility.name, "city": facility.city,
            "beds": facility.beds, "area_sqft": facility.area_sqft, "size_band": facility.size_band,
        },
        "counts": counts,
        "departments": departments,
        "fleet": {"vehicles": len(vehicles), "due": fleet_due},
        "red_tags": db.query(func.count(RedTag.id)).filter(
            RedTag.facility_id == facility_id, RedTag.cleared_at.is_(None)).scalar() or 0,
        "open_visits": db.query(func.count(InspectionBatch.id)).filter(
            InspectionBatch.facility_id == facility_id,
            InspectionBatch.inspection_scope.in_(programme.SCOPES),
            InspectionBatch.status.in_([InspectionStatus.UPCOMING, InspectionStatus.IN_PROGRESS])).scalar() or 0,
    }


# ── departments ──────────────────────────────────────────────────────────────

@router.get("/departments")
def list_departments(
    facility_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """The site's departments, with how much each holds and where it stands."""
    _site(db, current_user, facility_id)
    rows = programme.department_rows(db, facility_id)
    db.commit()
    return {"items": rows, "total": len(rows)}


@router.get("/departments/{department_id}")
def department_detail(
    department_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """One department: the forms it uses, the items in it, its visits and red tags."""
    department = _department(db, current_user, department_id)
    today = utc_today()
    tagged, _ = programme.open_tag_ids(db, department.facility_id)
    items = programme.equipment_query(db, department.facility_id, department_id=department_id).order_by(
        func.lower(Equipment.name)).all()
    forms = [programme.form_payload(link, form) for link, form in
             programme.forms_for(db, department_id=department_id)]
    db.commit()
    return {
        "department": {"id": department.id, "name": department.name, "description": department.description,
                       "facility_id": department.facility_id},
        "forms": forms,
        "items": [programme.item_payload(item, kind="equipment", red_tagged=item.id in tagged,
                                         department_name=department.name, today=today) for item in items],
        "visits": [programme.visit_payload(db, batch) for batch in
                   programme.visit_rows(db, department.facility_id, department_id=department_id, limit=25)],
        "red_tags": [programme.red_tag_payload(db, tag) for tag in db.query(RedTag).filter(
            RedTag.department_id == department_id, RedTag.cleared_at.is_(None)).all()],
    }


@router.post("/departments/{department_id}/forms", status_code=201)
def attach_form(
    department_id: int,
    payload: FormAttachIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Say that a department is inspected on this form, and how often normally."""
    require_module_permission(current_user, "inspections", "add")
    department = _department(db, current_user, department_id)
    link = programme.attach_form(db, form_id=payload.form_id, department_id=department.id,
                                 default_frequency=payload.default_frequency,
                                 default_interval_days=payload.default_interval_days)
    db.commit()
    form = db.get(InspectionForm, link.form_id)
    return programme.form_payload(link, form)


@router.delete("/departments/{department_id}/forms/{link_id}")
def detach_form(
    department_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Stop using a form here. Inspections already done keep pointing at it."""
    require_module_permission(current_user, "inspections", "delete")
    _department(db, current_user, department_id)
    link = db.get(InspectionFormLink, link_id)
    if link is None or link.department_id != department_id:
        raise HTTPException(status_code=404, detail="That form is not attached to this department")
    db.delete(link)
    db.commit()
    return {"detail": "Form removed from the department"}


@router.get("/forms")
def list_forms(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """The form library, for attaching to a department or a fleet."""
    rows = db.query(InspectionForm).filter(InspectionForm.archived_at.is_(None)).order_by(
        func.lower(InspectionForm.name)).all()
    return {"items": [{"id": form.id, "name": form.name, "description": form.description} for form in rows]}


# ── items and their clocks ───────────────────────────────────────────────────

@router.get("/items")
def list_items(
    facility_id: int = Query(...),
    department_id: Optional[int] = Query(None),
    unassigned: bool = Query(False),
    due_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """The site's items: everything inspectable, with its department and its clock."""
    _site(db, current_user, facility_id)
    today = utc_today()
    tagged, _ = programme.open_tag_ids(db, facility_id)
    query = programme.equipment_query(db, facility_id, department_id=department_id)
    if unassigned:
        query = query.filter(Equipment.department_id.is_(None))
    names = dict(db.query(Department.id, Department.name).filter(Department.facility_id == facility_id).all())
    db.commit()
    rows = [programme.item_payload(item, kind="equipment", red_tagged=item.id in tagged,
                                   department_name=names.get(item.department_id), today=today)
            for item in query.order_by(func.lower(Equipment.name)).all()]
    if due_only:
        rows = [row for row in rows if row["due_state"] in ("due", "overdue")]
    return {"items": rows, "total": len(rows)}


@router.put("/items/{equipment_id}/schedule")
def set_item_schedule(
    equipment_id: int,
    payload: ItemScheduleIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Put one item in a department and on the clock."""
    require_module_permission(current_user, "facility-inventory", "edit")
    item = db.get(Equipment, equipment_id)
    if item is None or item.name is None:
        raise HTTPException(status_code=404, detail="Equipment not found")
    require_facility_access(db, current_user, item.facility_id)
    _apply_schedule(db, current_user, item, payload)
    db.commit()
    db.refresh(item)
    names = dict(db.query(Department.id, Department.name).filter(
        Department.facility_id == item.facility_id).all())
    return programme.item_payload(item, kind="equipment", department_name=names.get(item.department_id))


@router.post("/items/bulk-assign")
def bulk_assign(
    payload: BulkAssignIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Put many items into a department and on the same clock at once.

    Typing a frequency on every item of an existing site is how a good idea
    becomes an afternoon nobody has.
    """
    require_module_permission(current_user, "facility-inventory", "edit")
    items = db.query(Equipment).filter(Equipment.id.in_(payload.equipment_ids),
                                       Equipment.name.isnot(None)).all()
    if not items:
        raise HTTPException(status_code=404, detail="None of those items exist")
    for item in items:
        require_facility_access(db, current_user, item.facility_id)
        _apply_schedule(db, current_user, item, payload)
    db.commit()
    return {"updated": len(items)}


def _apply_schedule(db: Session, user: User, item, payload) -> None:
    """The shared half of putting an item on the clock."""
    if payload.department_id is not None:
        department = _department(db, user, payload.department_id)
        if department.facility_id != item.facility_id:
            raise HTTPException(status_code=422, detail="That department belongs to another site")
        item.department_id = department.id
    if payload.pm_task is not None:
        item.pm_task = payload.pm_task.strip()[:500] or None
    if payload.pm_assignee_id is not None:
        person = db.get(User, payload.pm_assignee_id)
        if person is None or not person.is_active:
            raise HTTPException(status_code=422, detail="No active person with that id")
        item.pm_assignee_id = person.id
    if payload.frequency is not None or payload.first_due_on is not None:
        programme.apply_schedule(item, frequency=payload.frequency or item.pm_scheduling,
                                 interval_days=payload.interval_days or item.inspection_interval_days,
                                 first_due=payload.first_due_on)


@router.get("/due")
def due_preview(
    facility_id: int = Query(...),
    scope: str = Query("department"),
    department_id: Optional[int] = Query(None),
    by: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """What a visit on this date would contain. Shown before anything is scheduled."""
    _site(db, current_user, facility_id)
    if scope not in programme.SCOPES:
        raise HTTPException(status_code=422, detail="Scope is one of: {}".format(", ".join(programme.SCOPES)))
    items = programme.due_items(db, facility_id, scope=scope, department_id=department_id, by=by or utc_today())
    db.commit()
    kind = "vehicle" if scope == "fleet" else "equipment"
    names = dict(db.query(Department.id, Department.name).filter(Department.facility_id == facility_id).all())
    return {
        "by": by or utc_today(),
        "total": len(items),
        "items": [programme.item_payload(item, kind=kind,
                                         department_name=names.get(getattr(item, "department_id", None)))
                  for item in items[:200]],
    }


@router.get("/inspectors")
def inspectors(
    facility_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    _site(db, current_user, facility_id)
    return [{"id": person.id, "name": person.full_name,
             "role": getattr(person.role, "value", str(person.role))}
            for person in programme.assignable_inspectors(db, facility_id)]


# ── visits ───────────────────────────────────────────────────────────────────

@router.get("/visits")
def list_visits(
    facility_id: int = Query(...),
    status: Optional[str] = Query(None),
    department_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    _site(db, current_user, facility_id)
    rows = programme.visit_rows(db, facility_id, status=status, department_id=department_id)
    payload = [programme.visit_payload(db, batch) for batch in rows]
    db.commit()
    return {"items": payload, "total": len(payload)}


@router.post("/visits", status_code=201)
def create_visit(
    payload: VisitIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Schedule a visit. It contains the items due by its date."""
    require_module_permission(current_user, "inspections", "add")
    _site(db, current_user, payload.facility_id)
    batch = programme.create_visit(
        db, current_user, facility_id=payload.facility_id, scope=payload.scope,
        department_id=payload.department_id, scheduled_on=payload.scheduled_on,
        inspector_id=payload.inspector_id,
    )
    db.commit()
    db.refresh(batch)
    return programme.visit_payload(db, batch, with_items=True)


@router.post("/inspections", status_code=201)
def inspect_now(
    payload: InspectNowIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Inspect one item now, whether or not it is due.

    The same shape as raising a service on one piece of equipment: pick the
    item, pick the form, go. It comes back as a visit of one, ready to fill in.
    """
    require_module_permission(current_user, "inspections", "add")
    _site(db, current_user, payload.facility_id)
    batch = programme.inspect_now(
        db, current_user, facility_id=payload.facility_id, equipment_id=payload.equipment_id,
        vehicle_id=payload.vehicle_id, form_id=payload.form_id, scheduled_on=payload.scheduled_on,
        inspector_id=payload.inspector_id,
    )
    db.commit()
    db.refresh(batch)
    return programme.visit_payload(db, batch, with_items=True)


@router.get("/visits/{visit_id}")
def visit_detail(
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    batch = db.get(InspectionBatch, visit_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Visit not found")
    require_facility_access(db, current_user, batch.facility_id)
    payload = programme.visit_payload(db, batch, with_items=True)
    db.commit()
    return payload


@router.post("/visits/{visit_id}/items/{inspection_id}")
def record_item(
    visit_id: int,
    inspection_id: int,
    payload: RecordItemIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Record one item: the answers, the result, and what the result sets off."""
    batch = db.get(InspectionBatch, visit_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Visit not found")
    require_facility_access(db, current_user, batch.facility_id)
    _may_fill(db, current_user, batch)
    inspection = db.get(Inspection, inspection_id)
    if inspection is None or inspection.batch_id != batch.id:
        raise HTTPException(status_code=404, detail="That item is not in this visit")
    _, job = programme.record_item(db, current_user, inspection, result=payload.result,
                                   answers=payload.answers, note=payload.note,
                                   raise_service_job=payload.raise_service)
    db.commit()
    db.refresh(inspection)
    return {"item": programme.inspection_payload(db, inspection),
            "visit": programme.visit_payload(db, batch),
            "service": ({"id": job.id, "number": job.request_number} if job else None)}


@router.post("/visits/{visit_id}/finish")
def finish_visit(
    visit_id: int,
    payload: FinishVisitIn = Body(default_factory=FinishVisitIn),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    batch = db.get(InspectionBatch, visit_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Visit not found")
    require_facility_access(db, current_user, batch.facility_id)
    _may_fill(db, current_user, batch)
    programme.finish_visit(db, current_user, batch, notes=payload.notes)
    db.commit()
    db.refresh(batch)
    return programme.visit_payload(db, batch, with_items=True)


@router.delete("/visits/{visit_id}")
def delete_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Remove a visit scheduled by mistake. A visit with work recorded is kept."""
    require_module_permission(current_user, "inspections", "delete")
    batch = db.get(InspectionBatch, visit_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Visit not found")
    require_facility_access(db, current_user, batch.facility_id)
    recorded = db.query(func.count(Inspection.id)).filter(
        Inspection.batch_id == batch.id, Inspection.status == InspectionStatus.COMPLETED).scalar() or 0
    if recorded:
        raise HTTPException(status_code=409, detail="This visit has inspections recorded on it")
    db.query(Inspection).filter(Inspection.batch_id == batch.id).delete()
    db.delete(batch)
    db.commit()
    return {"detail": "Visit removed"}


# ── red tags ─────────────────────────────────────────────────────────────────

@router.get("/red-tags")
def list_red_tags(
    facility_id: int = Query(...),
    include_cleared: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    _site(db, current_user, facility_id)
    rows = programme.red_tag_rows(db, facility_id, include_cleared=include_cleared)
    db.commit()
    return {"items": rows, "total": len(rows)}


@router.post("/red-tags/{tag_id}/clear")
def clear_red_tag(
    tag_id: int,
    payload: ClearRedTagIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Lift a red tag, saying what was done. Inspectors, admins and Super Admins."""
    tag = db.get(RedTag, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="Red tag not found")
    require_facility_access(db, current_user, tag.facility_id)
    if current_user.role not in (UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.FACILITY_ADMIN,
                                 UserRole.FACILITY_MANAGER, UserRole.TECHNICIAN):
        raise HTTPException(status_code=403, detail="Only an inspector, an admin or a Super Admin can clear a red tag")
    programme.clear_red_tag(db, current_user, tag, note=payload.note)
    db.commit()
    db.refresh(tag)
    return programme.red_tag_payload(db, tag)


# ── the timer, by hand ───────────────────────────────────────────────────────

@router.post("/run-due")
def run_due(
    facility_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Raise the maintenance due now and send the notices. Safe to repeat.

    The nightly worker does this; this is the same call, for when somebody
    wants it to have happened already.
    """
    require_module_permission(current_user, "inspections", "edit")
    if facility_id is not None:
        _site(db, current_user, facility_id)
        ids = [facility_id]
    else:
        ids = [site.id for site in _visible_sites(db, current_user)]
    summary = inspection_due.run(db, facility_ids=ids)
    db.commit()
    return summary
