"""Service and inspection jobs on a category's equipment.

Both are ordinary work orders — a service is typed preventive, an inspection is
typed inspection — so the work order queue, the assistant and reporting see
them without knowing this screen exists. What this adds is a form a person can
fill in: which equipment, what needs doing, when it is due, who does it, and
three statuses instead of nine.

Open, In progress and Done map onto the full status set so the older work
order screen still reads correctly, and a job may move freely between the
three: planned in-house work is not billed, so none of the quotation and
invoice rules that constrain those transitions apply to it.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session, joinedload

from app.models.asset_ledger import AssetLedgerEntry, LedgerEntryType
from app.models.equipment import Equipment
from app.models.service_request import (
    Priority, ServiceRequest, ServiceRequestStatus, WorkOrderType,
)
from app.models.user import User, UserRole
from app.models.user_facility import UserFacility
from app.services import site_categories
from app.services.pm import _next_request_number

KINDS: dict[str, str] = {
    "service": WorkOrderType.PREVENTIVE.value,
    "inspection": WorkOrderType.INSPECTION.value,
}
KIND_OF_TYPE = {value: kind for kind, value in KINDS.items()}

STATUS_LABELS = {"open": "Open", "in_progress": "In progress", "done": "Done", "cancelled": "Cancelled"}
RESULTS = {"pass": "Pass", "fail": "Fail"}

# Who a job can be given to. Site roles must belong to the site; the two
# unscoped roles work everywhere.
ASSIGNABLE_SITE_ROLES = (UserRole.TECHNICIAN, UserRole.FACILITY_MANAGER, UserRole.FACILITY_ADMIN)
ASSIGNABLE_ANYWHERE_ROLES = (UserRole.SUPERADMIN, UserRole.ADMIN)

# What a technician may change on a job assigned to them: the progress and what
# it cost, not the plan. Whether it was capital work is a finance decision.
TECHNICIAN_FIELDS = {"status", "notes", "inspection_result", "findings", "labour_cost", "parts_cost"}


def _job_total(labour: Decimal | None, parts: Decimal | None) -> Decimal | None:
    if labour is None and parts is None:
        return None
    return (labour or Decimal("0")) + (parts or Decimal("0"))


def sync_major_work(db: Session, user: User, job: ServiceRequest) -> None:
    """Keep the asset ledger in step with a job's major work. Flushes.

    A finished service marked major work, with a cost, adds that cost to the
    equipment's depreciable basis as an improvement dated the day it was done.
    Anything that changes that - unticked, reopened, a different cost - reverses
    the posted improvement and, where it still applies, posts the right one. The
    ledger is corrected by reversal, never edited, as everywhere else.
    """
    posted = (
        db.query(AssetLedgerEntry)
        .filter(AssetLedgerEntry.work_order_id == job.id,
                AssetLedgerEntry.entry_type == LedgerEntryType.IMPROVEMENT.value,
                AssetLedgerEntry.is_reversed.is_(False))
        .first()
    )
    total = _job_total(job.labour_cost, job.parts_cost)
    done_on = job.completed_at.date() if job.completed_at else None
    wanted = (
        job.is_major_work and job.work_order_type == WorkOrderType.PREVENTIVE.value
        and job.status == ServiceRequestStatus.COMPLETED and total is not None and total > 0
        and job.equipment_id is not None
    )
    if posted is not None and wanted and Decimal(str(posted.amount)) == total and posted.effective_date == done_on:
        return
    if posted is not None:
        posted.is_reversed = True
        db.add(AssetLedgerEntry(
            facility_id=posted.facility_id, equipment_id=posted.equipment_id,
            entry_type=LedgerEntryType.REVERSAL.value, effective_date=datetime.utcnow().date(),
            description="Reversal of {}".format(posted.description)[:255],
            amount=-posted.amount, reverses_entry_id=posted.id, work_order_id=job.id,
            notes="Changed on {}".format(job.request_number), created_by_id=user.id,
        ))
    if wanted:
        db.add(AssetLedgerEntry(
            facility_id=job.facility_id, equipment_id=job.equipment_id,
            entry_type=LedgerEntryType.IMPROVEMENT.value, effective_date=done_on,
            description="Major work: {}".format(job.problem_description)[:255],
            amount=total, reference=job.request_number, work_order_id=job.id, created_by_id=user.id,
        ))
    db.flush()


def kind_or_422(kind: str) -> str:
    if kind not in KINDS:
        raise HTTPException(status_code=422, detail="A job is either a service or an inspection")
    return KINDS[kind]


def simple_status(status: ServiceRequestStatus | str | None) -> str:
    value = getattr(status, "value", status)
    if value in (ServiceRequestStatus.NEW.value, ServiceRequestStatus.ASSIGNED.value, None):
        return "open"
    if value == ServiceRequestStatus.COMPLETED.value:
        return "done"
    if value == ServiceRequestStatus.CANCELLED.value:
        return "cancelled"
    return "in_progress"


def _full_status(simple: str, assigned: bool) -> ServiceRequestStatus:
    if simple == "done":
        return ServiceRequestStatus.COMPLETED
    if simple == "in_progress":
        return ServiceRequestStatus.IN_PROGRESS
    if simple == "open":
        return ServiceRequestStatus.ASSIGNED if assigned else ServiceRequestStatus.NEW
    raise HTTPException(status_code=422, detail="Status is Open, In progress or Done")


def assignable_users(db: Session, facility_id: int) -> list[User]:
    at_site = (
        db.query(UserFacility.user_id).filter(UserFacility.facility_id == facility_id)
    )
    return (
        db.query(User)
        .filter(
            User.is_active.is_(True),
            or_(
                User.role.in_(ASSIGNABLE_ANYWHERE_ROLES),
                (User.role.in_(ASSIGNABLE_SITE_ROLES)
                 & or_(User.facility_id == facility_id, User.id.in_(at_site))),
            ),
        )
        # Technicians first: they are who a job is usually for.
        .order_by(case((User.role == UserRole.TECHNICIAN, 0), else_=1), User.full_name)
        .all()
    )


def _assignee_or_422(db: Session, facility_id: int, user_id: int | None) -> User | None:
    if user_id is None:
        return None
    for user in assignable_users(db, facility_id):
        if user.id == user_id:
            return user
    raise HTTPException(status_code=422, detail="That person cannot be given jobs at this site")


def equipment_or_422(db: Session, facility_id: int, equipment_id: int) -> Equipment:
    asset = db.get(Equipment, equipment_id)
    if asset is None or asset.facility_id != facility_id or asset.name is None:
        raise HTTPException(status_code=422, detail="Choose equipment from one of this site's categories")
    return asset


def _history(action: str, user: User, changes: dict | None = None) -> dict:
    return {"action": action, "at": datetime.utcnow().isoformat() + "Z", "user_id": user.id,
            "user_name": user.full_name, "changes": changes or {}}


def _stamp_status(job: ServiceRequest, status: ServiceRequestStatus, now: datetime) -> None:
    job.status = status
    if status in (ServiceRequestStatus.ASSIGNED,) and job.assigned_at is None:
        job.assigned_at = now
    if status == ServiceRequestStatus.IN_PROGRESS and job.started_at is None:
        job.started_at = now
    if status == ServiceRequestStatus.COMPLETED:
        job.completed_at = job.completed_at or now
    else:
        job.completed_at = None


def create(db: Session, user: User, *, facility_id: int, kind: str, equipment_id: int, title: str,
           due_on: date | None, assigned_to_id: int | None, status: str, notes: str | None,
           inspection_result: str | None, findings: str | None,
           labour_cost: Decimal | None = None, parts_cost: Decimal | None = None,
           is_major_work: bool = False, inspection_id: int | None = None) -> ServiceRequest:
    """Raise a job. Flushes; the caller commits."""
    work_order_type = kind_or_422(kind)
    if is_major_work and (kind != "service" or user.role == UserRole.TECHNICIAN):
        raise HTTPException(status_code=422 if kind != "service" else 403,
                            detail="Only a service can be major work, and only a manager can mark it")
    asset = equipment_or_422(db, facility_id, equipment_id)
    assignee = _assignee_or_422(db, facility_id, assigned_to_id)
    title = site_categories.tidy(title)
    if not title:
        raise HTTPException(status_code=422, detail="Say what needs doing")
    if kind != "inspection":
        inspection_result, findings = None, None

    now = datetime.utcnow()
    job = ServiceRequest(
        request_number=_next_request_number(db),
        facility_id=facility_id,
        equipment_id=asset.id,
        location_id=asset.location_id,
        requester_id=user.id,
        assigned_technician_id=assignee.id if assignee else None,
        problem_description=title,
        service_required=title,
        priority=Priority.MEDIUM,
        work_order_type=work_order_type,
        discipline_id=asset.discipline_id,
        is_billable=False,
        due_on=due_on,
        notes=site_categories.tidy(notes),
        inspection_result=inspection_result,
        findings=site_categories.tidy(findings),
        labour_cost=labour_cost,
        parts_cost=parts_cost,
        total_cost=_job_total(labour_cost, parts_cost),
        is_major_work=is_major_work,
        # Set when an inspection found the fault, so the job says where it
        # came from and a re-recorded inspection cannot raise a second one.
        inspection_id=inspection_id,
        history=[_history("created", user, {"kind": kind, "equipment": asset.name})],
    )
    _stamp_status(job, _full_status(status, assignee is not None), now)
    db.add(job)
    db.flush()
    sync_major_work(db, user, job)
    return job


def update(db: Session, user: User, job: ServiceRequest, changes: dict) -> dict:
    """Apply a change to a job and return what changed. Flushes; the caller commits."""
    if job.work_order_type not in KIND_OF_TYPE:
        raise HTTPException(status_code=404, detail="Job not found")
    if user.role == UserRole.TECHNICIAN:
        if job.assigned_technician_id != user.id:
            raise HTTPException(status_code=403, detail="Only the person the job is assigned to can update it")
        blocked = set(changes) - TECHNICIAN_FIELDS
        if blocked:
            raise HTTPException(status_code=403, detail="You can update the status, notes and result of your jobs")

    now = datetime.utcnow()
    recorded: dict = {}

    def note(field: str, before, after) -> None:
        if before != after:
            recorded[field] = {"from": str(before) if before is not None else None,
                               "to": str(after) if after is not None else None}

    if "equipment_id" in changes:
        asset = equipment_or_422(db, job.facility_id, changes["equipment_id"])
        note("equipment", job.equipment_id, asset.id)
        job.equipment_id, job.discipline_id, job.location_id = asset.id, asset.discipline_id, asset.location_id
    if "title" in changes:
        title = site_categories.tidy(changes["title"])
        if not title:
            raise HTTPException(status_code=422, detail="Say what needs doing")
        note("title", job.problem_description, title)
        job.problem_description = job.service_required = title
    if "due_on" in changes:
        note("due_on", job.due_on, changes["due_on"])
        job.due_on = changes["due_on"]
    if "assigned_to_id" in changes:
        assignee = _assignee_or_422(db, job.facility_id, changes["assigned_to_id"])
        new_id = assignee.id if assignee else None
        note("assigned_to", job.assigned_technician_id, new_id)
        job.assigned_technician_id = new_id
    for field in ("notes", "findings"):
        if field in changes:
            value = site_categories.tidy(changes[field])
            note(field, getattr(job, field), value)
            setattr(job, field, value)
    if "inspection_result" in changes:
        note("inspection_result", job.inspection_result, changes["inspection_result"])
        job.inspection_result = changes["inspection_result"]
    for field in ("labour_cost", "parts_cost"):
        if field in changes:
            note(field, getattr(job, field), changes[field])
            setattr(job, field, changes[field])
    job.total_cost = _job_total(job.labour_cost, job.parts_cost)
    if changes.get("is_major_work") is not None:
        if changes["is_major_work"] and KIND_OF_TYPE[job.work_order_type] != "service":
            raise HTTPException(status_code=422, detail="Only a service can be major work")
        note("is_major_work", job.is_major_work, changes["is_major_work"])
        job.is_major_work = changes["is_major_work"]

    target = changes.get("status") or simple_status(job.status)
    before = job.status
    if "status" in changes or "assigned_to_id" in changes:
        _stamp_status(job, _full_status(target, job.assigned_technician_id is not None), now)
        note("status", simple_status(before), target)

    if KIND_OF_TYPE[job.work_order_type] != "inspection":
        job.inspection_result, job.findings = None, None

    if recorded:
        job.history = [*(job.history or []), _history("updated", user, recorded)]
    db.flush()
    sync_major_work(db, user, job)
    return recorded


def list_query(db: Session, facility_id: int, kind: str, *, status: str | None = None,
               category: str | None = None, search: str | None = None,
               equipment_id: int | None = None, today: date | None = None):
    today = today or datetime.utcnow().date()
    query = (
        db.query(ServiceRequest)
        .join(Equipment, Equipment.id == ServiceRequest.equipment_id)
        .filter(ServiceRequest.facility_id == facility_id,
                ServiceRequest.work_order_type == kind_or_422(kind),
                Equipment.name.isnot(None))
    )
    if category:
        ids = site_categories.ensure_disciplines(db)
        site_categories.category_or_404(category)
        query = query.filter(Equipment.discipline_id == ids[category])
    if equipment_id is not None:
        query = query.filter(ServiceRequest.equipment_id == equipment_id)
    if search and search.strip():
        like = f"%{search.strip()}%"
        query = query.filter(or_(
            ServiceRequest.problem_description.ilike(like), ServiceRequest.request_number.ilike(like),
            Equipment.name.ilike(like), Equipment.asset_tag.ilike(like), Equipment.building.ilike(like),
            Equipment.floor.ilike(like), Equipment.location.ilike(like),
        ))

    counts_query = query
    open_statuses = [ServiceRequestStatus.NEW, ServiceRequestStatus.ASSIGNED]
    done = ServiceRequestStatus.COMPLETED
    if status == "open":
        query = query.filter(ServiceRequest.status.in_(open_statuses))
    elif status == "in_progress":
        query = query.filter(ServiceRequest.status.in_(
            [s for s in site_categories.OPEN_STATUSES if s not in open_statuses]))
    elif status == "done":
        query = query.filter(ServiceRequest.status == done)
    elif status == "overdue":
        query = query.filter(ServiceRequest.status.in_(site_categories.OPEN_STATUSES),
                             ServiceRequest.due_on < today)
    elif status not in (None, "", "all"):
        raise HTTPException(status_code=422, detail="Filter by open, in progress, done or overdue")
    else:
        query = query.filter(ServiceRequest.status != ServiceRequestStatus.CANCELLED)

    row = counts_query.with_entities(
        func.sum(case((ServiceRequest.status.in_(open_statuses), 1), else_=0)),
        func.sum(case((ServiceRequest.status.in_(
            [s for s in site_categories.OPEN_STATUSES if s not in open_statuses]), 1), else_=0)),
        func.sum(case((ServiceRequest.status == done, 1), else_=0)),
        func.sum(case((ServiceRequest.status.in_(site_categories.OPEN_STATUSES)
                       & (ServiceRequest.due_on < today), 1), else_=0)),
    ).one()
    counts = {"open": int(row[0] or 0), "in_progress": int(row[1] or 0),
              "done": int(row[2] or 0), "overdue": int(row[3] or 0)}

    ordered = query.options(
        joinedload(ServiceRequest.equipment), joinedload(ServiceRequest.assigned_technician),
    ).order_by(
        case((ServiceRequest.status == done, 1), else_=0),
        case((ServiceRequest.due_on.is_(None), 1), else_=0),
        ServiceRequest.due_on.asc(),
        ServiceRequest.id.desc(),
    )
    return ordered, counts


def serialise(job: ServiceRequest, category_codes: dict[int, str], *, today: date | None = None) -> dict:
    today = today or datetime.utcnow().date()
    asset = job.equipment
    status = simple_status(job.status)
    code = category_codes.get(asset.discipline_id) if asset else None
    category = site_categories.BY_CODE.get(code) if code else None
    person = job.assigned_technician
    return {
        "id": job.id,
        "number": job.request_number,
        "kind": KIND_OF_TYPE.get(job.work_order_type),
        "title": job.problem_description,
        "status": status,
        "status_label": STATUS_LABELS[status],
        "due_on": job.due_on,
        "overdue": bool(job.due_on and job.due_on < today and status in ("open", "in_progress")),
        "assigned_to": {"id": person.id, "name": person.full_name} if person else None,
        "notes": job.notes,
        "inspection_result": job.inspection_result,
        "findings": job.findings,
        "labour_cost": job.labour_cost,
        "parts_cost": job.parts_cost,
        "total_cost": _job_total(job.labour_cost, job.parts_cost),
        "is_major_work": bool(job.is_major_work),
        # Where the job came from: an inspection that found a fault, or a
        # person reporting one.
        "from_inspection": ({"id": job.inspection.id, "number": job.inspection.inspection_number,
                             "visit_id": job.inspection.batch_id}
                            if job.inspection_id and job.inspection else None),
        "created_at": job.created_at,
        "completed_at": job.completed_at,
        "equipment": {
            "id": asset.id, "name": asset.name, "asset_tag": asset.asset_tag,
            "type": asset.equipment_type, "category": code,
            "category_name": category.name if category else None,
            "location_label": site_categories.location_label(asset),
        } if asset else None,
    }
