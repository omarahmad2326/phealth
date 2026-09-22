"""Long-running cron worker for the recurring facilities jobs.

Three things need to happen on a timer, and none of them will happen reliably
if they depend on somebody pressing a button:

  * compliance tasks fall due and must be generated, then flipped to overdue
  * maintenance schedules fall due and must raise work orders
  * inspections fall due and the people who have to act are told, seven days
    before and on the day
  * approved permits whose window has passed must expire, or an approval given
    for last Tuesday keeps authorising work indefinitely

Every one of those operations is idempotent by construction — an open
compliance task suppresses a duplicate, a schedule with open work generates
nothing, and an already-expired permit is not re-expired. That is what makes a
polling worker safe here: a run that overlaps with somebody pressing the button
in the UI, or a container restart mid-cycle, cannot double anything.

Follows the same shape as `rental_billing_scheduler`: poll, log, back off on
failure, exit cleanly on SIGTERM.
"""
from __future__ import annotations

import logging
import signal
import time

from sqlalchemy import inspect

from app.core.config import settings
from app.db.base import SessionLocal, engine
from app.models.facility import Facility

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("facilities_scheduler")
_stopping = False

# Every table the run touches. Checked before the first cycle so a container
# started against a database that has not been migrated fails loudly rather
# than logging an exception every interval forever.
REQUIRED_TABLES = {
    "locations", "compliance_programs", "compliance_tasks",
    "maintenance_schedules", "work_permits", "vehicles", "inspection_form_links",
}

# The system user that owns generated work orders. Generated PM has to be
# requested by somebody, and attributing it to whichever human happened to be
# logged in would be a lie.
_SYSTEM_REQUESTER_FALLBACK = 1


def _request_stop(signum: int, _frame: object) -> None:
    global _stopping
    logger.info("Received signal %s; stopping after the current cycle", signum)
    _stopping = True


def _system_requester_id(db) -> int:
    """Prefer a real superadmin, so generated work has a valid requester FK."""
    from app.models.user import User, UserRole

    row = (
        db.query(User.id)
        .filter(User.role == UserRole.SUPERADMIN, User.is_active.is_(True))
        .order_by(User.id.asc())
        .first()
    )
    return row[0] if row else _SYSTEM_REQUESTER_FALLBACK


def run_once() -> dict[str, object]:
    """One full cycle. Commits once at the end, so a failure part-way leaves
    nothing half-applied."""
    from app.services import compliance as compliance_service
    from app.services import inspection_due
    from app.services import permit as permit_service
    from app.services import pm as pm_service

    missing = sorted(REQUIRED_TABLES - set(inspect(engine).get_table_names()))
    if missing:
        raise RuntimeError(
            "Database migrations are not current; facilities scheduling is paused. "
            f"Missing tables: {', '.join(missing)}"
        )

    db = SessionLocal()
    try:
        # A deleted site raises no tasks and sends no notices.
        facility_ids = [row.id for row in db.query(Facility.id).filter(Facility.live()).all()]
        if not facility_ids:
            return {"facilities": 0}

        compliance_result = compliance_service.generate_tasks(
            db,
            facility_ids=facility_ids,
            horizon_days=int(settings.FACILITIES_COMPLIANCE_HORIZON_DAYS),
        )
        overdue = compliance_service.mark_overdue(db, facility_ids=facility_ids)

        pm_result = pm_service.run(
            db, facility_ids=facility_ids, requester_id=_system_requester_id(db),
        )

        expired = permit_service.expire_stale(db, facility_ids=facility_ids)

        inspections = inspection_due.run(db, facility_ids=facility_ids)

        db.commit()

        result = {
            "facilities": len(facility_ids),
            "compliance_tasks_created": compliance_result["created"],
            "compliance_marked_overdue": overdue,
            "work_orders_generated": pm_result["generated"],
            "permits_expired": expired,
            "inspection_notices_sent": inspections["notified"],
        }
        # Only log when something actually happened. A quiet estate should not
        # produce an identical line every half hour, or nobody reads the log.
        if any(v for k, v in result.items() if k != "facilities"):
            logger.info("Facilities scheduling run: %s", result)
        return result
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    interval = max(300, int(settings.FACILITIES_SCHEDULER_INTERVAL_SECONDS))
    logger.info("Facilities cron worker started; interval=%ss", interval)

    while not _stopping:
        started = time.monotonic()
        failed = False
        try:
            run_once()
        except Exception:
            failed = True
            logger.exception("Facilities scheduling run failed; it will retry")
        # Back off hard after a failure rather than hammering a database that is
        # probably mid-migration.
        delay = 120 if failed else max(30, interval - int(time.monotonic() - started))
        deadline = time.monotonic() + delay
        while not _stopping and time.monotonic() < deadline:
            time.sleep(min(5, max(0, deadline - time.monotonic())))

    logger.info("Facilities cron worker stopped")


if __name__ == "__main__":
    main()
