"""Departments, per-item inspection clocks, red tags and fleet

Revision ID: d7f1a3b5c9e2
Revises: x9c0d1e2f3a4
Create Date: 2026-09-18

The inspection programme. An item belongs to a department as well as to its
trade; it carries one frequency, from which its next due date is worked out;
a visit covers a department, a whole site or its fleet; a failure bad enough
to say the standard is not met becomes a red tag that outlives the inspection.

The clock reuses the columns equipment already had - pm_scheduling,
last_pm_date, next_generated_pm_date - so there is one answer to "when is
this due" rather than two that drift apart.

Checks before each step, like the migrations before it: these databases are
built both by migration and by create_all, and this has to be safe on either.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d7f1a3b5c9e2"
down_revision: Union[str, Sequence[str], None] = "x9c0d1e2f3a4"
branch_labels = None
depends_on = None


EQUIPMENT_COLUMNS = (
    ("department_id", lambda: sa.Column("department_id", sa.Integer(), nullable=True)),
    ("inspection_interval_days", lambda: sa.Column("inspection_interval_days", sa.Integer(), nullable=True)),
    ("last_inspection_result", lambda: sa.Column("last_inspection_result", sa.String(16), nullable=True)),
    ("pm_task", lambda: sa.Column("pm_task", sa.String(500), nullable=True)),
    ("pm_assignee_id", lambda: sa.Column("pm_assignee_id", sa.Integer(), nullable=True)),
    ("pm_raised_on", lambda: sa.Column("pm_raised_on", sa.Date(), nullable=True)),
    ("notified_ahead_on", lambda: sa.Column("notified_ahead_on", sa.Date(), nullable=True)),
    ("notified_due_on", lambda: sa.Column("notified_due_on", sa.Date(), nullable=True)),
)

FACILITY_COLUMNS = (
    ("beds", lambda: sa.Column("beds", sa.Integer(), nullable=True)),
    ("area_sqft", lambda: sa.Column("area_sqft", sa.Integer(), nullable=True)),
    ("size_band", lambda: sa.Column("size_band", sa.String(), nullable=True)),
)


def _columns(table: str) -> set:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # ── the inspection clock and the department, on equipment ───────────────
    equipment = _columns("equipment")
    for name, column in EQUIPMENT_COLUMNS:
        if name not in equipment:
            op.add_column("equipment", column())
    if "department_id" not in equipment:
        op.create_index("ix_equipment_department_id", "equipment", ["department_id"])
        op.create_foreign_key("fk_equipment_department", "equipment", "departments",
                              ["department_id"], ["id"], ondelete="SET NULL")
    if "pm_assignee_id" not in equipment:
        op.create_foreign_key("fk_equipment_pm_assignee", "equipment", "users",
                              ["pm_assignee_id"], ["id"], ondelete="SET NULL")

    # ── how big the site is ─────────────────────────────────────────────────
    facilities = _columns("facilities")
    for name, column in FACILITY_COLUMNS:
        if name not in facilities:
            op.add_column("facilities", column())

    # ── the fleet ───────────────────────────────────────────────────────────
    if "vehicles" not in tables:
        op.create_table(
            "vehicles",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("facility_id", sa.Integer(), sa.ForeignKey("facilities.id", ondelete="CASCADE"),
                      nullable=False, index=True),
            sa.Column("name", sa.String(160), nullable=False),
            sa.Column("registration", sa.String(40), nullable=True, index=True),
            sa.Column("vehicle_type", sa.String(60), nullable=True),
            sa.Column("make", sa.String(120), nullable=True),
            sa.Column("model", sa.String(120), nullable=True),
            sa.Column("year", sa.Integer(), nullable=True),
            sa.Column("driver_name", sa.String(160), nullable=True),
            sa.Column("odometer", sa.Integer(), nullable=True),
            sa.Column("condition", sa.String(24), nullable=False, server_default="working"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("pm_scheduling", sa.String(20), nullable=True),
            sa.Column("inspection_interval_days", sa.Integer(), nullable=True),
            sa.Column("last_pm_date", sa.Date(), nullable=True),
            sa.Column("next_generated_pm_date", sa.Date(), nullable=True, index=True),
            sa.Column("last_inspection_result", sa.String(16), nullable=True),
            sa.Column("pm_task", sa.String(500), nullable=True),
            sa.Column("pm_assignee_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("pm_raised_on", sa.Date(), nullable=True),
            sa.Column("notified_ahead_on", sa.Date(), nullable=True),
            sa.Column("notified_due_on", sa.Date(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )

    # ── which forms a department, or a fleet, is inspected on ───────────────
    if "inspection_form_links" not in tables:
        op.create_table(
            "inspection_form_links",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("form_id", sa.Integer(), sa.ForeignKey("inspection_forms.id", ondelete="CASCADE"),
                      nullable=False, index=True),
            sa.Column("scope", sa.String(16), nullable=False, server_default="department"),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id", ondelete="CASCADE"),
                      nullable=True, index=True),
            sa.Column("facility_id", sa.Integer(), sa.ForeignKey("facilities.id", ondelete="CASCADE"),
                      nullable=True, index=True),
            sa.Column("default_frequency", sa.String(20), nullable=True),
            sa.Column("default_interval_days", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("form_id", "department_id", name="uq_form_link_department"),
            sa.UniqueConstraint("form_id", "facility_id", "scope", name="uq_form_link_fleet"),
        )

    # ── red tags ────────────────────────────────────────────────────────────
    if "red_tags" not in tables:
        op.create_table(
            "red_tags",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("facility_id", sa.Integer(), sa.ForeignKey("facilities.id", ondelete="CASCADE"),
                      nullable=False, index=True),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id", ondelete="SET NULL"),
                      nullable=True, index=True),
            sa.Column("equipment_id", sa.Integer(), sa.ForeignKey("equipment.id", ondelete="CASCADE"),
                      nullable=True, index=True),
            sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
                      nullable=True, index=True),
            sa.Column("inspection_id", sa.Integer(), sa.ForeignKey("inspections.id", ondelete="SET NULL"),
                      nullable=True),
            sa.Column("note", sa.Text(), nullable=False),
            sa.Column("raised_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("raised_at", sa.DateTime(), nullable=False, index=True),
            sa.Column("cleared_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("cleared_at", sa.DateTime(), nullable=True, index=True),
            sa.Column("clear_note", sa.Text(), nullable=True),
        )

    # ── visits cover a department; items can be vehicles ────────────────────
    batches = _columns("inspection_batches")
    if batches and "department_id" not in batches:
        op.add_column("inspection_batches", sa.Column("department_id", sa.Integer(), nullable=True))
        op.create_index("ix_inspection_batches_department_id", "inspection_batches", ["department_id"])
        op.create_foreign_key("fk_inspection_batches_department", "inspection_batches", "departments",
                              ["department_id"], ["id"], ondelete="SET NULL")
    # A visit's items may use different forms, so the visit no longer names one.
    if batches:
        form_column = next((c for c in sa.inspect(bind).get_columns("inspection_batches")
                            if c["name"] == "form_template_id"), None)
        if form_column is not None and not form_column["nullable"]:
            op.alter_column("inspection_batches", "form_template_id", existing_type=sa.Integer(), nullable=True)

    inspections = _columns("inspections")
    if inspections and "vehicle_id" not in inspections:
        op.add_column("inspections", sa.Column("vehicle_id", sa.Integer(), nullable=True))
        op.create_index("ix_inspections_vehicle_id", "inspections", ["vehicle_id"])
        op.create_foreign_key("fk_inspections_vehicle", "inspections", "vehicles",
                              ["vehicle_id"], ["id"], ondelete="CASCADE")
    if inspections and "department_id" not in inspections:
        op.add_column("inspections", sa.Column("department_id", sa.Integer(), nullable=True))
        op.create_index("ix_inspections_department_id", "inspections", ["department_id"])
        op.create_foreign_key("fk_inspections_department", "inspections", "departments",
                              ["department_id"], ["id"], ondelete="SET NULL")

    # ── red_tag as an inspection result ─────────────────────────────────────
    # Postgres keeps this enum as a type of its own; SQLite stores the string.
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE inspectionresult ADD VALUE IF NOT EXISTS 'RED_TAG'")


def downgrade() -> None:
    inspections = _columns("inspections")
    if "department_id" in inspections:
        op.drop_constraint("fk_inspections_department", "inspections", type_="foreignkey")
        op.drop_index("ix_inspections_department_id", table_name="inspections")
        op.drop_column("inspections", "department_id")
    if "vehicle_id" in inspections:
        op.drop_constraint("fk_inspections_vehicle", "inspections", type_="foreignkey")
        op.drop_index("ix_inspections_vehicle_id", table_name="inspections")
        op.drop_column("inspections", "vehicle_id")
    if "department_id" in _columns("inspection_batches"):
        op.drop_constraint("fk_inspection_batches_department", "inspection_batches", type_="foreignkey")
        op.drop_index("ix_inspection_batches_department_id", table_name="inspection_batches")
        op.drop_column("inspection_batches", "department_id")

    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for table in ("red_tags", "inspection_form_links", "vehicles"):
        if table in tables:
            op.drop_table(table)

    facilities = _columns("facilities")
    for name, _ in FACILITY_COLUMNS:
        if name in facilities:
            op.drop_column("facilities", name)

    equipment = _columns("equipment")
    if "pm_assignee_id" in equipment:
        op.drop_constraint("fk_equipment_pm_assignee", "equipment", type_="foreignkey")
    if "department_id" in equipment:
        op.drop_constraint("fk_equipment_department", "equipment", type_="foreignkey")
        op.drop_index("ix_equipment_department_id", table_name="equipment")
    for name, _ in EQUIPMENT_COLUMNS:
        if name in equipment:
            op.drop_column("equipment", name)
    # The enum keeps its extra value: removing one in Postgres means rewriting
    # the type, and a value nothing points at costs nothing.
