"""What happens on its own when an inspection falls due.

Two things, both meant for a timer and both safe to repeat:

* the maintenance is raised as a service job, one per item, so the work sits
  where all other work sits;
* the people who have to act are told - seven days before, and on the day.

Repeating is the whole design. Each item remembers which due date it has
already had a job raised for and been notified about, so a run that overlaps
with somebody pressing the button, or a container restart mid-cycle, cannot
raise the same job twice.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Iterable, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.equipment import Equipment
from app.models.user import User, UserRole
from app.models.user_facility import UserFacility
from app.models.vehicle import Vehicle
from app.services import inspection_programme as programme
from app.utils.clock import utc_today
from app.utils.notifications import create_notification

logger = logging.getLogger("medrad.inspection_due")

NOTIFY_AHEAD_DAYS = programme.NOTIFY_AHEAD_DAYS


def _actor(db: Session) -> Optional[User]:
    """Whoever owns automatically raised work: a real Super Admin, if there is one."""
    return (
        db.query(User).filter(User.role == UserRole.SUPERADMIN, User.is_active.is_(True))
        .order_by(User.id.asc()).first()
    )


def _watchers(db: Session, facility_id: int, item) -> list[int]:
    """Who hears that this item is due: whoever it is assigned to, and the site's admins."""
    people = {item.pm_assignee_id} if item.pm_assignee_id else set()
    admins = (
        db.query(User.id).outerjoin(UserFacility, UserFacility.user_id == User.id)
        .filter(User.is_active.is_(True),
                or_(User.role.in_((UserRole.SUPERADMIN, UserRole.ADMIN)),
                    (User.role.in_((UserRole.FACILITY_ADMIN, UserRole.FACILITY_MANAGER))
                     & or_(UserFacility.facility_id == facility_id, User.facility_id == facility_id))))
        .all()
    )
    people.update(row[0] for row in admins)
    return [person for person in people if person]


def _tell(db: Session, facility_id: int, item, *, kind: str, when: date, ahead: bool,
          actor_id: Optional[int]) -> int:
    name = item.name or "An item"
    where = "fleet" if kind == "vehicle" else "equipment"
    title = "Inspection due in {} days".format(NOTIFY_AHEAD_DAYS) if ahead else "Inspection due today"
    link = "/fleet" if kind == "vehicle" else "/departments"
    sent = 0
    for user_id in _watchers(db, facility_id, item):
        create_notification(
            db, user_id=user_id, title=title,
            message="{} ({}) is due for inspection on {}.".format(name, where, when.isoformat()),
            notification_type="inspection", link_url=link, actor_id=actor_id,
        )
        sent += 1
    return sent


def _raise_job(db: Session, actor: User, item: Equipment, *, due_on: date) -> bool:
    """The maintenance for one due item, through the same call the screen makes."""
    from app.services import equipment_jobs

    task = (item.pm_task or "").strip() or "Preventive maintenance and inspection"
    try:
        equipment_jobs.create(
            db, actor, facility_id=item.facility_id, kind="service", equipment_id=item.id,
            title=task, due_on=due_on, assigned_to_id=item.pm_assignee_id, status="open",
            notes="Raised automatically because this item fell due for inspection.",
            inspection_result=None, findings=None,
        )
    except Exception as exc:  # noqa: BLE001 - one bad item must not stop the sweep
        logger.warning("Could not raise PM for equipment %s: %s", item.id, exc)
        db.rollback()
        return False
    return True


def run(db: Session, *, facility_ids: Iterable[int], today: Optional[date] = None) -> dict[str, Any]:
    """Raise what is due and tell people what is coming. Does not commit."""
    today = today or utc_today()
    ahead = today + timedelta(days=NOTIFY_AHEAD_DAYS)
    actor = _actor(db)
    summary = {"considered": 0, "jobs_raised": 0, "notified": 0, "as_of": today.isoformat()}

    for facility_id in facility_ids:
        equipment = programme.equipment_query(db, facility_id).filter(
            Equipment.pm_scheduling.isnot(None), Equipment.next_generated_pm_date.isnot(None),
            Equipment.next_generated_pm_date <= ahead,
        ).all()
        vehicles = programme.vehicle_query(db, facility_id).filter(
            Vehicle.pm_scheduling.isnot(None), Vehicle.next_generated_pm_date.isnot(None),
            Vehicle.next_generated_pm_date <= ahead,
        ).all()

        for item in equipment:
            summary["considered"] += 1
            due = item.next_generated_pm_date
            # The job is raised once the date arrives, not while it is still coming.
            if due <= today and item.pm_raised_on != due and actor is not None:
                if _raise_job(db, actor, item, due_on=due):
                    item.pm_raised_on = due
                    summary["jobs_raised"] += 1
            if due <= today and item.notified_due_on != due:
                summary["notified"] += _tell(db, facility_id, item, kind="equipment", when=due,
                                             ahead=False, actor_id=actor.id if actor else None)
                item.notified_due_on = due
            elif due == ahead and item.notified_ahead_on != due:
                summary["notified"] += _tell(db, facility_id, item, kind="equipment", when=due,
                                             ahead=True, actor_id=actor.id if actor else None)
                item.notified_ahead_on = due

        for item in vehicles:
            # A vehicle has no equipment record, so there is no service job to
            # raise against it; its work is recorded on the inspection itself.
            summary["considered"] += 1
            due = item.next_generated_pm_date
            if due <= today and item.notified_due_on != due:
                summary["notified"] += _tell(db, facility_id, item, kind="vehicle", when=due,
                                             ahead=False, actor_id=actor.id if actor else None)
                item.notified_due_on = due
            elif due == ahead and item.notified_ahead_on != due:
                summary["notified"] += _tell(db, facility_id, item, kind="vehicle", when=due,
                                             ahead=True, actor_id=actor.id if actor else None)
                item.notified_ahead_on = due

    db.flush()
    return summary
