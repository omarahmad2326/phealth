"""One clock and one kind of service: fold maintenance plans into the item, link service to its inspection

Revision ID: e8a2b4c6d0f3
Revises: d7f1a3b5c9e2
Create Date: 2026-09-19

Two things were the same idea in two places, which is what made the product
confusing:

* a maintenance plan and an item's inspection frequency both answered "when is
  this next due". Every active plan on category equipment is folded onto its
  item - interval to frequency, next date to next due, name to the maintenance
  note, technician to the assignee - and then retired. Plans on assets that
  are not in the inspection programme are left alone: for them the plan is
  still the only clock.
* service and inspection both recorded work on equipment. Service now means a
  fault or a malfunction, and `inspection_id` says when an inspection is what
  found it.

The fold is a data step, so the downgrade cannot undo it: it drops the column
and leaves the clocks where they are. Nothing is lost - a retired plan keeps
its row and its history.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e8a2b4c6d0f3"
down_revision: Union[str, Sequence[str], None] = "d7f1a3b5c9e2"
branch_labels = None
depends_on = None


# An interval in days as the frequency people choose on screen. A plan set to
# 90 days is quarterly; anything that is not one of the named periods keeps its
# own number of days.
NAMED = ((31, "monthly"), (92, "quarterly"), (183, "semi_annual"), (366, "annual"))


def _frequency(interval_days):
    if not interval_days:
        return None, None
    for limit, name in NAMED:
        if interval_days <= limit:
            return name, None
    return "custom", int(interval_days)


def _columns(table: str) -> set:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    # ── service says which inspection found the fault ───────────────────────
    if "service_requests" in tables and "inspection_id" not in _columns("service_requests"):
        op.add_column("service_requests", sa.Column("inspection_id", sa.Integer(), nullable=True))
        op.create_index("ix_service_requests_inspection_id", "service_requests", ["inspection_id"])
        if "inspections" in tables:
            op.create_foreign_key("fk_service_requests_inspection", "service_requests", "inspections",
                                  ["inspection_id"], ["id"], ondelete="SET NULL")

    # ── one clock: plans fold into their item ───────────────────────────────
    if not {"maintenance_schedules", "equipment"} <= tables:
        return
    if "pm_scheduling" not in _columns("equipment"):
        return  # the previous migration has not run; nothing to fold into

    plans = bind.execute(sa.text("""
        SELECT s.id, s.equipment_id, s.interval_days, s.next_due_date, s.name, s.assigned_technician_id
        FROM maintenance_schedules s
        JOIN equipment e ON e.id = s.equipment_id
        WHERE s.status = 'active' AND e.name IS NOT NULL
        ORDER BY s.id
    """)).fetchall()

    for plan_id, equipment_id, interval_days, next_due_date, name, technician_id in plans:
        frequency, custom_days = _frequency(interval_days)
        bind.execute(sa.text("""
            UPDATE equipment SET
                pm_scheduling = COALESCE(pm_scheduling, :frequency),
                inspection_interval_days = COALESCE(inspection_interval_days, :custom_days),
                next_generated_pm_date = COALESCE(next_generated_pm_date, :next_due),
                pm_task = COALESCE(pm_task, :task),
                pm_assignee_id = COALESCE(pm_assignee_id, :technician)
            WHERE id = :equipment_id
        """), {"frequency": frequency, "custom_days": custom_days, "next_due": next_due_date,
               "task": (name or None), "technician": technician_id, "equipment_id": equipment_id})
        # Retired rather than deleted: the plan and its generated work orders
        # are the history of what was maintained.
        bind.execute(sa.text("UPDATE maintenance_schedules SET status = 'retired' WHERE id = :id"),
                     {"id": plan_id})


def downgrade() -> None:
    columns = _columns("service_requests")
    if "inspection_id" in columns:
        try:
            op.drop_constraint("fk_service_requests_inspection", "service_requests", type_="foreignkey")
        except Exception:  # noqa: BLE001 - SQLite names constraints differently
            pass
        op.drop_index("ix_service_requests_inspection_id", table_name="service_requests")
        op.drop_column("service_requests", "inspection_id")
    # The folded clocks stay: the plans they came from are retired, not gone,
    # and putting the duplicate back would be the confusing half returning.
