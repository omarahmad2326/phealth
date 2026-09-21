"""The inspection programme: what is due, who inspects it, and what it leaves behind.

A site has departments. Every inspectable item - a piece of equipment in a
department, or a vehicle in the site's fleet - carries one frequency, and from
it the date it next falls due. A visit is scheduled for a department, a whole
site or the fleet on a date, and it contains the items due by then. The
inspector fills the department's forms once per item and each item ends
Passed, Failed or Red tag.

Two rules run underneath:

* A red tag outlives its inspection. The item and its department stay red
  until somebody clears it and says what was done.
* Falling due creates nothing. An inspection that finds something raises
  service work only when the inspector asks for it, and that job is linked
  back to the inspection that found the fault. Service is for faults and
  malfunctions; inspections are the schedule that keeps things to standard.

Equipment and vehicles are deliberately given the same column names for the
clock, so everything here works on either without asking which it has.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.department import Department
from app.models.equipment import Equipment
from app.models.inspection import Inspection, InspectionBatch, InspectionResult, InspectionStatus
from app.models.inspection_form import InspectionForm
from app.models.inspection_form_link import InspectionFormLink
from app.models.red_tag import RedTag
from app.models.service_request import ServiceRequest
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.utils.clock import utc_today

# How often an item is inspected. Custom carries its own number of days.
FREQUENCIES: dict[str, str] = {
    "monthly": "Monthly",
    "quarterly": "Quarterly",
    "semi_annual": "Every 6 months",
    "annual": "Annually",
    "custom": "Custom",
}
_FREQUENCY_MONTHS = {"monthly": 1, "quarterly": 3, "semi_annual": 6, "annual": 12}

RESULTS = {"pass": "Passed", "fail": "Failed", "red_tag": "Red tag"}

# An item is "due" on the dashboard when its date is within this window, and
# "overdue" once the date has gone by. Two words people already use.
DUE_SOON_DAYS = 30
NOTIFY_AHEAD_DAYS = 7

SCOPES = ("department", "facility", "fleet")


class ProgrammeError(HTTPException):
    def __init__(self, message: str, status_code: int = 422) -> None:
        super().__init__(status_code=status_code, detail=message)


# ── the clock ────────────────────────────────────────────────────────────────

def frequency_or_422(frequency: Optional[str], interval_days: Optional[int]) -> tuple[Optional[str], Optional[int]]:
    """A frequency as stored: the name, plus the days when it is custom."""
    if frequency in (None, ""):
        return None, None
    if frequency not in FREQUENCIES:
        raise ProgrammeError("Frequency is one of: {}.".format(", ".join(FREQUENCIES)))
    if frequency == "custom":
        if not interval_days or not 1 <= int(interval_days) <= 3650:
            raise ProgrammeError("A custom frequency needs a number of days between 1 and 3650.")
        return frequency, int(interval_days)
    return frequency, None


def next_due(from_date: date, frequency: Optional[str], interval_days: Optional[int] = None) -> Optional[date]:
    """The date an item falls due again, counted from when it was last done."""
    if not frequency:
        return None
    if frequency == "custom":
        return from_date + timedelta(days=int(interval_days or 0)) if interval_days else None
    months = _FREQUENCY_MONTHS.get(frequency)
    if not months:
        return None
    index = from_date.month - 1 + months
    year, month = from_date.year + index // 12, index % 12 + 1
    return date(year, month, min(from_date.day, monthrange(year, month)[1]))


def apply_schedule(item, *, frequency: Optional[str], interval_days: Optional[int] = None,
                   first_due: Optional[date] = None, today: Optional[date] = None) -> None:
    """Put an item on the clock. Its first date is given, or worked out from today."""
    today = today or utc_today()
    frequency, interval_days = frequency_or_422(frequency, interval_days)
    item.pm_scheduling = frequency
    item.inspection_interval_days = interval_days
    if frequency is None:
        item.next_generated_pm_date = None
        return
    if first_due is not None:
        item.next_generated_pm_date = first_due
    elif item.next_generated_pm_date is None:
        item.next_generated_pm_date = next_due(item.last_pm_date or today, frequency, interval_days)


def schedule_of(item) -> dict[str, Any]:
    """How an item is inspected, as the screens show it."""
    frequency = item.pm_scheduling
    return {
        "frequency": frequency,
        "frequency_label": FREQUENCIES.get(frequency or "", "Not scheduled"),
        "interval_days": item.inspection_interval_days,
        "next_due_on": item.next_generated_pm_date,
        "last_inspected_on": item.last_pm_date,
        "last_result": item.last_inspection_result,
        "last_result_label": RESULTS.get(item.last_inspection_result or "", None),
        "pm_task": item.pm_task,
        "pm_assignee_id": item.pm_assignee_id,
    }


def due_state(item, *, today: Optional[date] = None) -> str:
    """not_scheduled | overdue | due | scheduled."""
    today = today or utc_today()
    when = item.next_generated_pm_date
    if not item.pm_scheduling or when is None:
        return "not_scheduled"
    if when < today:
        return "overdue"
    if when <= today + timedelta(days=DUE_SOON_DAYS):
        return "due"
    return "scheduled"


# ── items ────────────────────────────────────────────────────────────────────

def equipment_query(db: Session, facility_id: int, *, department_id: Optional[int] = None):
    """The site's category equipment: the items an inspection programme covers."""
    query = db.query(Equipment).filter(Equipment.facility_id == facility_id, Equipment.name.isnot(None))
    if department_id is not None:
        query = query.filter(Equipment.department_id == department_id)
    return query


def vehicle_query(db: Session, facility_id: int):
    return db.query(Vehicle).filter(Vehicle.facility_id == facility_id)


def due_items(db: Session, facility_id: int, *, scope: str = "facility", department_id: Optional[int] = None,
              by: Optional[date] = None) -> list:
    """Everything due on or before a date, in the order it fell due."""
    by = by or utc_today()
    if scope == "fleet":
        rows = vehicle_query(db, facility_id).filter(
            Vehicle.pm_scheduling.isnot(None), Vehicle.next_generated_pm_date <= by,
        ).order_by(Vehicle.next_generated_pm_date.asc(), Vehicle.id.asc()).all()
        return rows
    query = equipment_query(db, facility_id, department_id=department_id if scope == "department" else None)
    if scope == "facility":
        # A whole-site visit still only covers equipment that belongs to a
        # department: an unassigned item has nobody to answer for it.
        query = query.filter(Equipment.department_id.isnot(None))
    return query.filter(
        Equipment.pm_scheduling.isnot(None), Equipment.next_generated_pm_date <= by,
    ).order_by(Equipment.next_generated_pm_date.asc(), Equipment.id.asc()).all()


def open_tag_ids(db: Session, facility_id: int) -> tuple[set[int], set[int]]:
    """Equipment ids and vehicle ids carrying a red tag nobody has cleared."""
    rows = db.query(RedTag.equipment_id, RedTag.vehicle_id).filter(
        RedTag.facility_id == facility_id, RedTag.cleared_at.is_(None),
    ).all()
    return {r[0] for r in rows if r[0]}, {r[1] for r in rows if r[1]}


def item_payload(item, *, kind: str, red_tagged: bool = False, department_name: Optional[str] = None,
                 today: Optional[date] = None) -> dict[str, Any]:
    payload = {
        "id": item.id,
        "kind": kind,
        "name": item.name,
        "where": None,
        "red_tagged": red_tagged,
        "due_state": due_state(item, today=today),
        **schedule_of(item),
    }
    if kind == "equipment":
        from app.services import site_categories

        payload.update({
            "asset_tag": item.asset_tag,
            "type": item.equipment_type,
            "department_id": item.department_id,
            "department": department_name,
            "condition": item.condition or "working",
            "where": site_categories.location_label(item) or None,
        })
    else:
        payload.update({
            "registration": item.registration,
            "type": item.vehicle_type,
            "make_model": " ".join(p for p in (item.make, item.model) if p) or None,
            "driver_name": item.driver_name,
            "odometer": item.odometer,
            "condition": item.condition or "working",
        })
    return payload


# ── forms ────────────────────────────────────────────────────────────────────

def forms_for(db: Session, *, department_id: Optional[int] = None, facility_id: Optional[int] = None) -> list:
    """The forms a department, or a site's fleet, is inspected on."""
    query = db.query(InspectionFormLink, InspectionForm).join(
        InspectionForm, InspectionForm.id == InspectionFormLink.form_id)
    if department_id is not None:
        query = query.filter(InspectionFormLink.department_id == department_id,
                             InspectionFormLink.scope == "department")
    else:
        query = query.filter(InspectionFormLink.facility_id == facility_id,
                             InspectionFormLink.scope == "fleet")
    return query.order_by(InspectionFormLink.id.asc()).all()


def form_payload(link: Optional[InspectionFormLink], form: InspectionForm, *,
                 with_schema: bool = False) -> dict[str, Any]:
    """One form. The built questions travel only where they are filled in: a
    list of departments does not need every form's layout. A form chosen by
    hand for one inspection has no link."""
    payload = {
        "link_id": link.id if link else None,
        "form_id": form.id,
        "name": form.name,
        "description": form.description,
        "default_frequency": link.default_frequency if link else None,
        "default_interval_days": link.default_interval_days if link else None,
        "archived": form.archived_at is not None,
    }
    if with_schema:
        payload["schema"] = form.schema
    return payload


def attach_form(db: Session, *, form_id: int, department_id: Optional[int] = None,
                facility_id: Optional[int] = None, default_frequency: Optional[str] = None,
                default_interval_days: Optional[int] = None) -> InspectionFormLink:
    form = db.get(InspectionForm, form_id)
    if form is None:
        raise ProgrammeError("No form with that id.", 404)
    frequency, interval = frequency_or_422(default_frequency, default_interval_days)
    scope = "department" if department_id is not None else "fleet"
    existing = db.query(InspectionFormLink).filter(
        InspectionFormLink.form_id == form_id, InspectionFormLink.scope == scope,
        InspectionFormLink.department_id == department_id, InspectionFormLink.facility_id == facility_id,
    ).first()
    link = existing or InspectionFormLink(form_id=form_id, scope=scope, department_id=department_id,
                                          facility_id=facility_id, created_at=datetime.utcnow())
    link.default_frequency, link.default_interval_days = frequency, interval
    if existing is None:
        db.add(link)
    db.flush()
    return link


# ── departments ──────────────────────────────────────────────────────────────

def department_rows(db: Session, facility_id: int, *, today: Optional[date] = None) -> list[dict[str, Any]]:
    """Every department with what it holds and where its inspections stand."""
    today = today or utc_today()
    departments = db.query(Department).filter(Department.facility_id == facility_id).order_by(
        func.lower(Department.name)).all()
    tagged_equipment, _ = open_tag_ids(db, facility_id)

    counts: dict[Optional[int], dict[str, Any]] = {}
    for item in equipment_query(db, facility_id).all():
        row = counts.setdefault(item.department_id, {
            "items": 0, "due": 0, "overdue": 0, "passed": 0, "failed": 0, "red_tagged": 0,
            "last_inspected_on": None, "unscheduled": 0,
        })
        row["items"] += 1
        state = due_state(item, today=today)
        if state == "due":
            row["due"] += 1
        elif state == "overdue":
            row["overdue"] += 1
        elif state == "not_scheduled":
            row["unscheduled"] += 1
        if item.id in tagged_equipment:
            row["red_tagged"] += 1
        elif item.last_inspection_result == "pass":
            row["passed"] += 1
        elif item.last_inspection_result == "fail":
            row["failed"] += 1
        if item.last_pm_date and (row["last_inspected_on"] is None or item.last_pm_date > row["last_inspected_on"]):
            row["last_inspected_on"] = item.last_pm_date

    form_counts = dict(
        db.query(InspectionFormLink.department_id, func.count(InspectionFormLink.id))
        .filter(InspectionFormLink.scope == "department")
        .group_by(InspectionFormLink.department_id).all()
    )
    empty = {"items": 0, "due": 0, "overdue": 0, "passed": 0, "failed": 0, "red_tagged": 0,
             "last_inspected_on": None, "unscheduled": 0}
    rows = [{
        "id": department.id, "name": department.name, "description": department.description,
        "forms": int(form_counts.get(department.id, 0)),
        **{**empty, **counts.get(department.id, {})},
    } for department in departments]
    unassigned = counts.get(None)
    if unassigned:
        rows.append({"id": None, "name": "Not in a department", "description": None, "forms": 0, **unassigned})
    return rows


# ── analytics ────────────────────────────────────────────────────────────────

def _blank_counts() -> dict[str, int]:
    return {"items": 0, "passed": 0, "failed": 0, "red_tagged": 0, "in_progress": 0,
            "due": 0, "overdue": 0, "not_scheduled": 0}


# What each count card means, in the order they are shown. A card and the
# list it opens come from the same classification, so the list is always
# exactly the number on the card.
STATES: dict[str, str] = {
    "passed": "Passed",
    "failed": "Failed",
    "red_tagged": "Red tagged",
    "in_progress": "In progress",
    "due": "Due",
    "overdue": "Overdue",
    "not_scheduled": "No schedule",
}


def classify_items(db: Session, facility_id: int, *, today: Optional[date] = None,
                   department_id: Optional[int] = None, kind: Optional[str] = None) -> list[dict[str, Any]]:
    """Every item at a site with the states it counts towards.

    An item's last result counts once: a red tag outranks a failure, which
    outranks a pass. Whether it is due and whether a visit is open for it are
    separate questions, so one item can be Failed, Overdue and In progress at
    the same time - which is the truth about it.
    """
    today = today or utc_today()
    open_statuses = [InspectionStatus.UPCOMING, InspectionStatus.IN_PROGRESS]
    open_rows = db.query(Inspection.equipment_id, Inspection.vehicle_id, InspectionBatch.id,
                         InspectionBatch.batch_number).join(
        InspectionBatch, InspectionBatch.id == Inspection.batch_id).filter(
        Inspection.facility_id == facility_id, Inspection.status.in_(open_statuses)).all()
    open_equipment = {row[0]: (row[2], row[3]) for row in open_rows if row[0]}
    open_vehicles = {row[1]: (row[2], row[3]) for row in open_rows if row[1]}
    tags = db.query(RedTag).filter(RedTag.facility_id == facility_id, RedTag.cleared_at.is_(None)).all()
    tagged_equipment = {tag.equipment_id: tag for tag in tags if tag.equipment_id}
    tagged_vehicles = {tag.vehicle_id: tag for tag in tags if tag.vehicle_id}

    sources = []
    if kind in (None, "equipment"):
        sources.append(("equipment", equipment_query(db, facility_id, department_id=department_id).all(),
                        tagged_equipment, open_equipment))
    if kind in (None, "vehicle") and department_id is None:
        sources.append(("vehicle", vehicle_query(db, facility_id).all(), tagged_vehicles, open_vehicles))

    rows = []
    for item_kind, items, tagged, open_visits in sources:
        for item in items:
            states = set()
            state = due_state(item, today=today)
            if state in ("due", "overdue", "not_scheduled"):
                states.add(state)
            if item.id in tagged:
                states.add("red_tagged")
            elif item.last_inspection_result == "pass":
                states.add("passed")
            elif item.last_inspection_result == "fail":
                states.add("failed")
            if item.id in open_visits:
                states.add("in_progress")
            rows.append({"item": item, "kind": item_kind, "states": states,
                         "visit": open_visits.get(item.id), "tag": tagged.get(item.id)})
    return rows


def _count(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = _blank_counts()
    for row in rows:
        counts["items"] += 1
        for state in row["states"]:
            counts[state] += 1
    return counts


def site_counts(db: Session, facility_id: int, *, today: Optional[date] = None) -> dict[str, int]:
    """The site's item counts: the numbers on the dashboard and the site page."""
    return _count(classify_items(db, facility_id, today=today))


# How a site stands, judged on each item's latest result.
SITE_STATUSES: dict[str, str] = {"passed_all": "Passed all", "passed": "Passed", "failed": "Failed"}


def site_status(counts: dict[str, int]) -> Optional[str]:
    """Failed when anything is failed or red-tagged. Passed all when every
    item has been inspected and passed and nothing is overdue. Passed when
    something has passed and nothing is failing, though some items may be
    overdue or not inspected yet. A site with nothing inspected is none."""
    if counts["failed"] or counts["red_tagged"]:
        return "failed"
    if counts["items"] and counts["passed"] == counts["items"] and not counts["overdue"]:
        return "passed_all"
    if counts["passed"]:
        return "passed"
    return None


def site_breakdown(db: Session, facility_id: int, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Passed out of total for each department, then items in no department
    and the fleet when there are any. Built from the same classified rows as
    the site's numbers, so the parts always add up to the whole."""
    groups: dict[tuple, dict[str, int]] = {}
    for row in rows:
        key = ("fleet", None) if row["kind"] == "vehicle" else ("department", row["item"].department_id)
        group = groups.setdefault(key, {"items": 0, "passed": 0, "failed": 0, "red_tagged": 0})
        group["items"] += 1
        states = row["states"]
        if "passed" in states:
            group["passed"] += 1
        if "failed" in states or "red_tagged" in states:
            group["failed"] += 1  # a red tag is a failure, and says so
        if "red_tagged" in states:
            group["red_tagged"] += 1

    empty = {"items": 0, "passed": 0, "failed": 0, "red_tagged": 0}
    departments = db.query(Department.id, Department.name).filter(
        Department.facility_id == facility_id).order_by(func.lower(Department.name)).all()
    parts = [{"kind": "department", "id": department_id, "name": name,
              **groups.get(("department", department_id), empty)} for department_id, name in departments]
    if ("department", None) in groups:
        parts.append({"kind": "unassigned", "id": None, "name": "Not in a department",
                      **groups[("department", None)]})
    if ("fleet", None) in groups:
        parts.append({"kind": "fleet", "id": None, "name": "Fleet", **groups[("fleet", None)]})
    return parts


def status_rows(db: Session, facilities: Iterable, state: str, *, today: Optional[date] = None,
                department_id: Optional[int] = None, kind: Optional[str] = None) -> list[dict[str, Any]]:
    """The items behind one count card, across the sites given."""
    if state not in STATES:
        raise ProgrammeError("State is one of: {}.".format(", ".join(STATES)))
    today = today or utc_today()
    rows = []
    for facility in facilities:
        names = dict(db.query(Department.id, Department.name).filter(Department.facility_id == facility.id).all())
        for row in classify_items(db, facility.id, today=today, department_id=department_id, kind=kind):
            if state not in row["states"]:
                continue
            item, tag, visit = row["item"], row["tag"], row["visit"]
            rows.append({
                **item_payload(item, kind=row["kind"], red_tagged=tag is not None,
                               department_name=names.get(getattr(item, "department_id", None)), today=today),
                "site_id": facility.id,
                "site": facility.name,
                "open_visit": {"id": visit[0], "number": visit[1]} if visit else None,
                "red_tag": ({"id": tag.id, "note": tag.note, "raised_at": tag.raised_at} if tag else None),
            })
    # The ones needing attention first: the longest overdue, then by name.
    rows.sort(key=lambda r: (r["next_due_on"] or date.max, (r["name"] or "").lower()))
    return rows


def dashboard(db: Session, facilities: Iterable, *, today: Optional[date] = None) -> dict[str, Any]:
    """Every site the person can see, with its inspection numbers."""
    today = today or utc_today()
    sites, totals = [], _blank_counts()
    for facility in facilities:
        rows = classify_items(db, facility.id, today=today)
        counts = _count(rows)
        for key, value in counts.items():
            totals[key] += value
        status = site_status(counts)
        sites.append({
            "facility_id": facility.id,
            "name": facility.name,
            "city": facility.city,
            "beds": facility.beds,
            "area_sqft": facility.area_sqft,
            "size_band": facility.size_band,
            "departments": db.query(func.count(Department.id)).filter(
                Department.facility_id == facility.id).scalar() or 0,
            "vehicles": db.query(func.count(Vehicle.id)).filter(
                Vehicle.facility_id == facility.id).scalar() or 0,
            **counts,
            "status": status,
            "status_label": SITE_STATUSES.get(status) if status else None,
            "breakdown": site_breakdown(db, facility.id, rows),
        })
    sites.sort(key=lambda row: (-row["red_tagged"], -row["overdue"], row["name"].lower()))
    # The cards above the sites: sites, not items. They overlap on purpose -
    # a site can be Failed and Overdue, and every Passed all site has Passed.
    site_totals = {
        "sites": len(sites),
        "passed": sum(1 for row in sites if row["status"] in ("passed", "passed_all")),
        "failed": sum(1 for row in sites if row["status"] == "failed"),
        "overdue": sum(1 for row in sites if row["overdue"]),
        "passed_all": sum(1 for row in sites if row["status"] == "passed_all"),
    }
    return {"totals": totals, "sites": sites, "site_totals": site_totals, "as_of": today}


# ── visits ───────────────────────────────────────────────────────────────────

def _visit_number(db: Session) -> str:
    """VIS-000123, counted like every other numbered record here."""
    last = db.query(func.count(InspectionBatch.id)).scalar() or 0
    for attempt in range(1, 50):
        number = "VIS-{:06d}".format(last + attempt)
        if not db.query(InspectionBatch.id).filter(InspectionBatch.batch_number == number).first():
            return number
    raise ProgrammeError("Could not number this visit.", 500)


def _inspection_number(db: Session, index: int) -> str:
    last = db.query(func.count(Inspection.id)).scalar() or 0
    base = last + index
    for attempt in range(0, 50):
        number = "INS-{:06d}".format(base + attempt)
        if not db.query(Inspection.id).filter(Inspection.inspection_number == number).first():
            return number
    raise ProgrammeError("Could not number this inspection.", 500)


def assignable_inspectors(db: Session, facility_id: int) -> list[User]:
    """Who a visit can be given to: the site's people, plus admins everywhere."""
    from app.models.user_facility import UserFacility

    site_roles = (UserRole.TECHNICIAN, UserRole.FACILITY_MANAGER, UserRole.FACILITY_ADMIN)
    site_people = (
        db.query(User).outerjoin(UserFacility, UserFacility.user_id == User.id)
        .filter(User.is_active.is_(True), User.role.in_(site_roles),
                or_(UserFacility.facility_id == facility_id, User.facility_id == facility_id))
        .all()
    )
    everywhere = db.query(User).filter(
        User.is_active.is_(True), User.role.in_((UserRole.SUPERADMIN, UserRole.ADMIN))).all()
    seen, people = set(), []
    for person in [*site_people, *everywhere]:
        if person.id not in seen:
            seen.add(person.id)
            people.append(person)
    return sorted(people, key=lambda person: (person.full_name or "").lower())


def create_visit(db: Session, user: User, *, facility_id: int, scope: str, department_id: Optional[int],
                 scheduled_on: date, inspector_id: Optional[int], today: Optional[date] = None) -> InspectionBatch:
    """Schedule a visit and fill it with the items due by that date."""
    today = today or utc_today()
    if scope not in SCOPES:
        raise ProgrammeError("Scope is one of: {}.".format(", ".join(SCOPES)))
    department = None
    if scope == "department":
        department = db.get(Department, department_id) if department_id else None
        if department is None or department.facility_id != facility_id:
            raise ProgrammeError("No department with that id at this site.", 404)

    if scope == "fleet":
        links = forms_for(db, facility_id=facility_id)
    elif scope == "department":
        links = forms_for(db, department_id=department_id)
    else:
        links = None  # a whole-site visit uses each department's own forms

    if scope in ("fleet", "department") and not links:
        where = "the fleet" if scope == "fleet" else department.name
        raise ProgrammeError("Attach an inspection form to {} before scheduling a visit.".format(where))

    items = due_items(db, facility_id, scope=scope, department_id=department_id, by=scheduled_on)
    if not items:
        raise ProgrammeError("Nothing is due by {}.".format(scheduled_on.isoformat()))

    inspector = db.get(User, inspector_id) if inspector_id else None
    if inspector_id and (inspector is None or not inspector.is_active):
        raise ProgrammeError("No active person with that id.")

    batch = InspectionBatch(
        batch_number=_visit_number(db),
        facility_id=facility_id,
        department_id=department_id if scope == "department" else None,
        inspector_id=inspector.id if inspector else None,
        form_template_id=links[0][1].id if links else None,
        status=InspectionStatus.UPCOMING,
        scheduled_date=datetime.combine(scheduled_on, datetime.min.time()),
        inspection_scope=scope,
        is_instant=scheduled_on <= today,
        created_at=datetime.utcnow(),
    )
    db.add(batch)
    db.flush()

    for index, item in enumerate(items, start=1):
        is_vehicle = isinstance(item, Vehicle)
        item_links = links
        if scope == "facility":
            item_links = forms_for(db, department_id=item.department_id)
            if not item_links:
                continue
        db.add(Inspection(
            inspection_number=_inspection_number(db, index),
            batch_id=batch.id,
            facility_id=facility_id,
            equipment_id=None if is_vehicle else item.id,
            vehicle_id=item.id if is_vehicle else None,
            department_id=None if is_vehicle else item.department_id,
            inspector_id=batch.inspector_id,
            form_template_id=item_links[0][1].id,
            status=InspectionStatus.UPCOMING,
            result=InspectionResult.PENDING,
            scheduled_date=batch.scheduled_date,
            inspection_scope=scope,
            created_at=datetime.utcnow(),
        ))
    db.flush()
    if not db.query(Inspection.id).filter(Inspection.batch_id == batch.id).first():
        raise ProgrammeError("Nothing could be inspected: the departments involved have no forms attached.")
    return batch


def inspect_now(db: Session, user: User, *, facility_id: int, equipment_id: Optional[int] = None,
                vehicle_id: Optional[int] = None, form_id: Optional[int] = None,
                scheduled_on: Optional[date] = None, inspector_id: Optional[int] = None,
                today: Optional[date] = None) -> InspectionBatch:
    """Inspect one item now: a visit of one, whether or not it was due.

    Scheduling covers the programme - what falls due, in departments, in
    batches. This covers the other thing people do: they are standing in front
    of something and want it inspected. It therefore asks for as little as it
    can - the item and a form - and does not care whether the item is due, or
    even whether it is in a department yet.
    """
    today = today or utc_today()
    if bool(equipment_id) == bool(vehicle_id):
        raise ProgrammeError("Name either equipment_id or vehicle_id.")

    if equipment_id:
        item = db.get(Equipment, equipment_id)
        if item is None or item.name is None or item.facility_id != facility_id:
            raise ProgrammeError("No equipment with that id at this site.", 404)
        links = forms_for(db, department_id=item.department_id) if item.department_id else []
        scope = "department" if item.department_id else "facility"
        department_id = item.department_id
    else:
        item = db.get(Vehicle, vehicle_id)
        if item is None or item.facility_id != facility_id:
            raise ProgrammeError("No vehicle with that id at this site.", 404)
        links = forms_for(db, facility_id=facility_id)
        scope, department_id = "fleet", None

    # The form is the one thing an inspection cannot do without. The item's
    # department usually supplies it; anything in the library can be chosen
    # instead, which is what makes an item with no department inspectable.
    form = db.get(InspectionForm, form_id) if form_id else None
    if form_id and form is None:
        raise ProgrammeError("No inspection form with that id.", 404)
    if form is None:
        form = links[0][1] if links else None
    if form is None:
        raise ProgrammeError("Choose an inspection form: this item's department has none attached.")

    inspector = db.get(User, inspector_id) if inspector_id else None
    if inspector_id and (inspector is None or not inspector.is_active):
        raise ProgrammeError("No active person with that id.")

    when = datetime.combine(scheduled_on or today, datetime.min.time())
    batch = InspectionBatch(
        batch_number=_visit_number(db),
        facility_id=facility_id,
        department_id=department_id,
        inspector_id=inspector.id if inspector else user.id,
        form_template_id=form.id,
        status=InspectionStatus.UPCOMING,
        scheduled_date=when,
        inspection_scope=scope,
        inspection_frequency=INSPECT_NOW,
        is_instant=True,
        created_at=datetime.utcnow(),
    )
    db.add(batch)
    db.flush()
    db.add(Inspection(
        inspection_number=_inspection_number(db, 1),
        batch_id=batch.id,
        facility_id=facility_id,
        equipment_id=equipment_id,
        vehicle_id=vehicle_id,
        department_id=department_id,
        inspector_id=batch.inspector_id,
        form_template_id=form.id,
        status=InspectionStatus.UPCOMING,
        result=InspectionResult.PENDING,
        scheduled_date=when,
        inspection_scope=scope,
        inspection_frequency=INSPECT_NOW,
        is_instant=True,
        created_at=datetime.utcnow(),
    ))
    db.flush()
    return batch


def visit_rows(db: Session, facility_id: int, *, status: Optional[str] = None,
               department_id: Optional[int] = None, limit: int = 200) -> list[InspectionBatch]:
    query = db.query(InspectionBatch).filter(InspectionBatch.facility_id == facility_id,
                                             InspectionBatch.inspection_scope.in_(SCOPES))
    if department_id is not None:
        query = query.filter(InspectionBatch.department_id == department_id)
    if status == "open":
        query = query.filter(InspectionBatch.status.in_([InspectionStatus.UPCOMING, InspectionStatus.IN_PROGRESS]))
    elif status == "done":
        query = query.filter(InspectionBatch.status.in_([InspectionStatus.COMPLETED, InspectionStatus.CLOSED]))
    return query.order_by(InspectionBatch.scheduled_date.desc(), InspectionBatch.id.desc()).limit(limit).all()


def visit_result(db: Session, batch: InspectionBatch) -> Optional[str]:
    """A visit reads as its worst item: red tag, then failed, then passed."""
    results = [row[0] for row in db.query(Inspection.result).filter(Inspection.batch_id == batch.id).all()]
    values = {getattr(r, "value", r) for r in results}
    if "red_tag" in values:
        return "red_tag"
    if "fail" in values:
        return "fail"
    if values and values <= {"pass"}:
        return "pass"
    return None


def visit_payload(db: Session, batch: InspectionBatch, *, with_items: bool = False) -> dict[str, Any]:
    rows = db.query(Inspection).filter(Inspection.batch_id == batch.id).all()
    done = [row for row in rows if row.status in (InspectionStatus.COMPLETED, InspectionStatus.CLOSED)]
    department = db.get(Department, batch.department_id) if batch.department_id else None
    inspector = db.get(User, batch.inspector_id) if batch.inspector_id else None
    result = visit_result(db, batch)
    payload = {
        "id": batch.id,
        "number": batch.batch_number,
        "facility_id": batch.facility_id,
        "scope": batch.inspection_scope,
        "department_id": batch.department_id,
        "department": department.name if department else None,
        "scheduled_on": batch.scheduled_date.date() if batch.scheduled_date else None,
        "status": getattr(batch.status, "value", batch.status),
        "inspector": {"id": inspector.id, "name": inspector.full_name} if inspector else None,
        "items": len(rows),
        "done": len(done),
        "result": result,
        "result_label": RESULTS.get(result or "", None),
        "started_at": batch.started_at,
        "completed_at": batch.completed_at,
        "notes": batch.notes,
    }
    if with_items:
        payload["item_list"] = [inspection_payload(db, row) for row in rows]
        payload["forms"] = [form_payload(link, form, with_schema=True) for link, form in (
            forms_for(db, department_id=batch.department_id) if batch.department_id
            else forms_for(db, facility_id=batch.facility_id) if batch.inspection_scope == "fleet" else []
        )]
    return payload


# Marks an inspection started with Inspect it now, which is filled on exactly
# the form chosen for it rather than on everything its department uses.
INSPECT_NOW = "now"


def forms_for_inspection(db: Session, inspection: Inspection) -> list:
    """The forms this inspection is filled on, as (link or None, form) pairs.

    A scheduled visit fills the department's forms (or the fleet's). Inspect it
    now fills the one form that was chosen, as does an item in no department,
    whose only form is the one picked for it.
    """
    own = db.get(InspectionForm, inspection.form_template_id) if inspection.form_template_id else None
    chosen_by_hand = (inspection.inspection_frequency == INSPECT_NOW
                      or (inspection.equipment_id and not inspection.department_id))
    if chosen_by_hand:
        return [(None, own)] if own else []
    if inspection.department_id:
        links = forms_for(db, department_id=inspection.department_id)
    elif inspection.vehicle_id:
        links = forms_for(db, facility_id=inspection.facility_id)
    else:
        links = []
    return links or ([(None, own)] if own else [])


def inspection_payload(db: Session, inspection: Inspection) -> dict[str, Any]:
    item = inspection.equipment if inspection.equipment_id else db.get(Vehicle, inspection.vehicle_id)
    department = db.get(Department, inspection.department_id) if inspection.department_id else None
    result = getattr(inspection.result, "value", inspection.result)
    forms = forms_for_inspection(db, inspection)
    return {
        "id": inspection.id,
        "number": inspection.inspection_number,
        "kind": "vehicle" if inspection.vehicle_id else "equipment",
        "item_id": inspection.vehicle_id or inspection.equipment_id,
        "name": getattr(item, "name", None),
        "reference": getattr(item, "registration", None) or getattr(item, "asset_tag", None),
        "where": None if inspection.vehicle_id else _where(item),
        "department_id": inspection.department_id,
        "department": department.name if department else None,
        "status": getattr(inspection.status, "value", inspection.status),
        "result": None if result == "pending" else result,
        "result_label": RESULTS.get(result or "", None),
        "answers": (inspection.form_data or {}).get("forms") or [],
        "note": (inspection.form_data or {}).get("note"),
        # Where each checklist stood when the item was recorded.
        "checklists": (inspection.form_data or {}).get("checklists") or [],
        "corrective_actions": inspection.corrective_actions,
        "completed_at": inspection.completed_at,
        "service": ({"id": job.id, "number": job.request_number,
                     "status": equipment_jobs_status(job)} if (job := service_for(db, inspection)) else None),
        "forms": [form_payload(link, form, with_schema=True) for link, form in forms],
    }


def equipment_jobs_status(job: ServiceRequest) -> str:
    from app.services import equipment_jobs

    return equipment_jobs.simple_status(job.status)


def _where(item) -> Optional[str]:
    from app.services import site_categories

    return site_categories.location_label(item) or None if item is not None else None


def service_for(db: Session, inspection: Inspection) -> Optional[ServiceRequest]:
    """The service job this inspection already raised, if it raised one."""
    return (
        db.query(ServiceRequest).filter(ServiceRequest.inspection_id == inspection.id)
        .order_by(ServiceRequest.id.desc()).first()
    )


def raise_service(db: Session, user: User, inspection: Inspection, *,
                  note: Optional[str] = None) -> Optional[ServiceRequest]:
    """Raise the work an inspection found, once, through the screen's own call.

    A vehicle has no equipment record for a job to hang on, so fleet findings
    stay on the inspection and on the red tag list.
    """
    from app.services import equipment_jobs

    if inspection.equipment_id is None:
        return None
    existing = service_for(db, inspection)
    if existing is not None:
        return existing
    item = inspection.equipment
    title = (note or "").strip() or "Fault found on inspection"
    job = equipment_jobs.create(
        db, user, facility_id=inspection.facility_id, kind="service",
        equipment_id=inspection.equipment_id, title=title[:500], due_on=None,
        assigned_to_id=item.pm_assignee_id if item is not None else None, status="open",
        notes="Raised from inspection {}.".format(inspection.inspection_number),
        inspection_result=None, findings=None, inspection_id=inspection.id,
    )
    return job


def record_item(db: Session, user: User, inspection: Inspection, *, result: str,
                answers: Optional[list] = None, note: Optional[str] = None,
                raise_service_job: bool = False,
                today: Optional[date] = None) -> tuple[Inspection, Optional[ServiceRequest]]:
    """Record one item: its answers, its result, and the work it asks for."""
    today = today or utc_today()
    if result not in RESULTS:
        raise ProgrammeError("Result is one of: {}.".format(", ".join(RESULTS)))
    if result == "red_tag" and not (note or "").strip():
        raise ProgrammeError("A red tag needs a note saying what is wrong.")

    item = inspection.equipment if inspection.equipment_id else db.get(Vehicle, inspection.vehicle_id)
    if item is None:
        raise ProgrammeError("The item this inspection was for no longer exists.", 404)

    # A checklist is the regulator's table: it passes only when every
    # requirement is answered and met. Failing or red-tagging needs no such
    # completeness - one unmet requirement is reason enough.
    from app.services import checklist

    checklists = checklist.check_answers(
        [(form.id, form.name, form.schema) for _, form in forms_for_inspection(db, inspection)], answers)
    if result == "pass":
        blocking = [entry for entry in checklists if not entry["can_pass"]]
        if blocking:
            raise ProgrammeError("This cannot pass yet - {}: {}.".format(
                blocking[0]["name"], checklist.summary_line(blocking[0])))

    inspection.form_data = {"forms": answers or [], "note": (note or "").strip() or None,
                            "checklists": checklists}
    inspection.result = InspectionResult(result)
    inspection.status = InspectionStatus.COMPLETED
    inspection.completed_at = datetime.utcnow()
    inspection.inspector_id = inspection.inspector_id or user.id
    if note:
        inspection.corrective_actions = note.strip()[:2000]

    # The clock moves on. A failure or a red tag is due again at once: the
    # point of both is that somebody comes back.
    item.last_pm_date = today
    item.last_inspection_result = result
    item.next_generated_pm_date = (
        next_due(today, item.pm_scheduling, item.inspection_interval_days) if result == "pass" else today
    )
    if result == "fail" and item.condition == "working":
        item.condition = "needs_attention"
    if result == "red_tag":
        item.condition = "out_of_service"
        _raise_red_tag(db, user, inspection, item, note or "")

    batch = db.get(InspectionBatch, inspection.batch_id) if inspection.batch_id else None
    if batch is not None and batch.status == InspectionStatus.UPCOMING:
        batch.status = InspectionStatus.IN_PROGRESS
        batch.started_at = batch.started_at or datetime.utcnow()
    db.flush()

    # Only when the inspector asks for it: a failure they fixed on the spot
    # should not leave a job behind for somebody to close.
    job = raise_service(db, user, inspection, note=note) if raise_service_job else None
    db.flush()
    return inspection, job


def finish_visit(db: Session, user: User, batch: InspectionBatch, *, notes: Optional[str] = None) -> InspectionBatch:
    """Close a visit. Items nobody reached stay due and show on the next one."""
    unfinished = db.query(func.count(Inspection.id)).filter(
        Inspection.batch_id == batch.id,
        Inspection.status.notin_([InspectionStatus.COMPLETED, InspectionStatus.CLOSED]),
    ).scalar() or 0
    if unfinished and not db.query(Inspection.id).filter(
            Inspection.batch_id == batch.id, Inspection.status == InspectionStatus.COMPLETED).first():
        raise ProgrammeError("Record at least one item before finishing the visit.")
    for row in db.query(Inspection).filter(
            Inspection.batch_id == batch.id,
            Inspection.status.notin_([InspectionStatus.COMPLETED, InspectionStatus.CLOSED])).all():
        row.status = InspectionStatus.CLOSED
    batch.status = InspectionStatus.COMPLETED
    batch.completed_at = datetime.utcnow()
    if notes:
        batch.notes = notes.strip()[:2000]
    db.flush()
    return batch


# ── red tags ─────────────────────────────────────────────────────────────────

def _raise_red_tag(db: Session, user: User, inspection: Inspection, item, note: str) -> RedTag:
    standing = db.query(RedTag).filter(
        RedTag.cleared_at.is_(None),
        RedTag.equipment_id == (None if inspection.vehicle_id else item.id),
        RedTag.vehicle_id == (item.id if inspection.vehicle_id else None),
    ).first()
    if standing is not None:
        standing.note = note.strip()[:2000] or standing.note
        return standing
    tag = RedTag(
        facility_id=inspection.facility_id,
        department_id=inspection.department_id,
        equipment_id=None if inspection.vehicle_id else item.id,
        vehicle_id=item.id if inspection.vehicle_id else None,
        inspection_id=inspection.id,
        note=note.strip()[:2000],
        raised_by_id=user.id,
        raised_at=datetime.utcnow(),
    )
    db.add(tag)
    db.flush()
    return tag


def red_tag_rows(db: Session, facility_id: int, *, include_cleared: bool = False) -> list[dict[str, Any]]:
    query = db.query(RedTag).filter(RedTag.facility_id == facility_id)
    if not include_cleared:
        query = query.filter(RedTag.cleared_at.is_(None))
    rows = query.order_by(RedTag.cleared_at.isnot(None), RedTag.raised_at.desc()).limit(300).all()
    return [red_tag_payload(db, tag) for tag in rows]


def red_tag_payload(db: Session, tag: RedTag) -> dict[str, Any]:
    item = tag.equipment or (db.get(Vehicle, tag.vehicle_id) if tag.vehicle_id else None)
    department = db.get(Department, tag.department_id) if tag.department_id else None
    raised_by = db.get(User, tag.raised_by_id) if tag.raised_by_id else None
    cleared_by = db.get(User, tag.cleared_by_id) if tag.cleared_by_id else None
    return {
        "id": tag.id,
        "facility_id": tag.facility_id,
        "kind": "vehicle" if tag.vehicle_id else "equipment",
        "item_id": tag.vehicle_id or tag.equipment_id,
        "name": getattr(item, "name", None),
        "reference": getattr(item, "registration", None) or getattr(item, "asset_tag", None),
        "where": None if tag.vehicle_id else _where(item),
        "department_id": tag.department_id,
        "department": department.name if department else None,
        "note": tag.note,
        "raised_by": raised_by.full_name if raised_by else None,
        "raised_at": tag.raised_at,
        "cleared_by": cleared_by.full_name if cleared_by else None,
        "cleared_at": tag.cleared_at,
        "clear_note": tag.clear_note,
        "inspection_id": tag.inspection_id,
    }


def clear_red_tag(db: Session, user: User, tag: RedTag, *, note: str) -> RedTag:
    """Lift a red tag, saying what was done. Inspectors, admins and Super Admins."""
    if tag.cleared_at is not None:
        raise ProgrammeError("That red tag was already cleared.", 409)
    if not (note or "").strip():
        raise ProgrammeError("Say what was done before clearing a red tag.")
    tag.cleared_by_id = user.id
    tag.cleared_at = datetime.utcnow()
    tag.clear_note = note.strip()[:2000]
    item = tag.equipment or (db.get(Vehicle, tag.vehicle_id) if tag.vehicle_id else None)
    if item is not None and item.condition == "out_of_service":
        # It is usable again, but it still has a failure against it until it
        # passes an inspection.
        item.condition = "needs_attention"
    db.flush()
    return tag
