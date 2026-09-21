"""What happens on its own when an inspection falls due: people are told.

Nothing is created. An item that falls due shows as due on its department, on
the dashboard and in the next visit, and that is the whole record - a job
raised alongside it said the same thing twice, which is what made the product
confusing. Work is raised when an inspection finds something, or when somebody
reports a fault.

The notices are meant for a timer and safe to repeat: each item remembers the
due date it has already been notified about, so a run that overlaps with
somebody pressing the button, or a container restart mid-cycle, cannot send the
same notice twice.
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


def run(db: Session, *, facility_ids: Iterable[int], today: Optional[date] = None) -> dict[str, Any]:
    """Tell people what is due and what is coming. Creates nothing. Does not commit."""
    today = today or utc_today()
    ahead = today + timedelta(days=NOTIFY_AHEAD_DAYS)
    actor = _actor(db)
    summary = {"considered": 0, "notified": 0, "as_of": today.isoformat()}

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
            if due <= today and item.notified_due_on != due:
                summary["notified"] += _tell(db, facility_id, item, kind="equipment", when=due,
                                             ahead=False, actor_id=actor.id if actor else None)
                item.notified_due_on = due
            elif due == ahead and item.notified_ahead_on != due:
                summary["notified"] += _tell(db, facility_id, item, kind="equipment", when=due,
                                             ahead=True, actor_id=actor.id if actor else None)
                item.notified_ahead_on = due

        for item in vehicles:
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
