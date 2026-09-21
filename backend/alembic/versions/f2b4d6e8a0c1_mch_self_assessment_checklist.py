"""The MCH self-assessment checklist, as an inspection form

Revision ID: f2b4d6e8a0c1
Revises: e8a2b4c6d0f3
Create Date: 2026-09-21

The regulator's "Self-assessment Checklist for MCH Centers and Midwifery
Services", indicators 01 to 07, transcribed as a checklist form: each numbered
compliance requirement is answered Yes, No or N/A, and the inspection passes
only when every requirement is met. It is added once, by name, and left alone
if a form of that name already exists - so re-running, or a site that has
edited its copy, changes nothing.

The wording is the paper form's, including its own spelling. Pairs marked OR on
the paper (2.1/2.2 and 6.1/6.2) are either-or: meeting one of them meets both.
"""
import json
from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2b4d6e8a0c1"
down_revision: Union[str, Sequence[str], None] = "e8a2b4c6d0f3"
branch_labels = None
depends_on = None


NAME = "Self-assessment Checklist for MCH Centers and Midwifery Services"

SCHEMA = {
    "title": NAME,
    "version": 1,
    "source": "phealth_checklist",
    "checklist": {
        "sections": [
            {
                "code": "Ind 01",
                "title": "The HCE is identifiable with Name and PHC Registration/License Number on the signboard(s)",
                "requirements": [
                    {"code": "1.1", "text": "Signboard available and readable"},
                    {"code": "1.2", "text": "Name of HCE on signboard"},
                    {"code": "1.3", "text": "Name and qualification of the service provider and relevant Council's "
                                            "registration number on signboard"},
                    {"code": "1.4", "text": "PHC Registration/License Number on the signboard (as applicable)"},
                ],
            },
            {
                "code": "Ind 02",
                "title": "The HCE is easily accessible to the patients/clients",
                "requirements": [
                    {"code": "2.1", "text": "Easy access for clients' transport, as well as for ambulances/firefighting "
                                            "vehicles in case so needed",
                     "alternative": "ind02-access"},
                    {"code": "2.2", "text": "If the location of the Centre is not easily accessible due to "
                                            "blockade/encroachment outside the gate and there is evidence that "
                                            "management has taken steps for removal of the same, then score as "
                                            "partially met",
                     "alternative": "ind02-access"},
                    {"code": "2.3", "text": "HCE entrance is wide enough to allow wheel chair and/or stretcher"},
                    {"code": "2.4", "text": "Stairs/Ramp(s) are provided if the HCE is not at the ground level"},
                ],
            },
            {
                "code": "Ind 03",
                "title": "Door plate(s) clearly display name, qualification and designation of the healthcare staff "
                         "on duty/providing services in the HCE",
                "requirements": [
                    {"code": "3.1", "text": "Name(s) of service provider(s) on door plate(s)"},
                    {"code": "3.2", "text": "Registered qualification(s) on door plate(s)"},
                    {"code": "3.3", "text": "Designation(s) on door plate(s)"},
                ],
            },
            {
                "code": "Ind 04",
                "title": "The staff on duty uses the Identity Badges",
                "requirements": [
                    {"code": "4.1", "text": "Identity Badge bearing Name and designation"},
                    {"code": "4.2", "text": "Photograph of care provider on the Identity Badge (Optional for female "
                                            "staff)"},
                    {"code": "4.3", "text": "Signature of care provider"},
                    {"code": "4.4", "text": "Date of issuance and validity"},
                    {"code": "4.5", "text": "Signature and stamp of issuing authority"},
                ],
            },
            {
                "code": "Ind 05",
                "title": "The consultation hours are displayed 100%",
                "requirements": [
                    {"code": "5.1", "text": "Consultation timings of the HCSP(s) are displayed on signboard and at a "
                                            "prominent place inside the HCE"},
                    {"code": "5.2", "text": "Arrangements are in place to manage the booked case(s) even beyond the "
                                            "displayed timings (Written instructions/undertaking signed by the HCSP "
                                            "as acceptance to provide such services promptly or to attend and refer "
                                            "the case accordingly)"},
                    {"code": "5.3", "text": "Documented evidence that such cases are managed accordingly"},
                ],
            },
            {
                "code": "Ind 06",
                "title": "The HCSP displays the registration certificate issued by the respective council (PMDC, PNMC)",
                "requirements": [
                    {"code": "6.1", "text": "Copy of valid registration certificate(s) with the respective council(s), "
                                            "displayed at the HCE",
                     "alternative": "ind06-registration"},
                    {"code": "6.2", "text": "If registration is expired, an evidence of submission for renewal",
                     "alternative": "ind06-registration"},
                ],
            },
            {
                "code": "Ind 07",
                "title": "The premises of the HCE is as per minimum requirement for different areas with hard-board "
                         "partitions and proper lighting and ventilation",
                "requirements": [
                    {"code": "7.1", "text": "Space for waiting Area (minimum for 3 clients)"},
                    {"code": "7.2", "text": "Hard board partitioning and space for consultation and examination"},
                    {"code": "7.3", "text": "Allocated space for procedures/deliveries"},
                    {"code": "7.4", "text": "Post-delivery care"},
                    {"code": "7.5", "text": "Sterilization arrangements"},
                ],
            },
        ],
    },
}

DESCRIPTION = ("MCH Centers and Midwifery Services, indicators 01-07. Each requirement is answered Yes, No or "
               "N/A; the inspection passes only when every requirement is met.")


def upgrade() -> None:
    bind = op.get_bind()
    if "inspection_forms" not in sa.inspect(bind).get_table_names():
        return
    exists = bind.execute(sa.text("SELECT id FROM inspection_forms WHERE name = :name"), {"name": NAME}).first()
    if exists:
        return
    now = datetime.utcnow()
    forms = sa.table(
        "inspection_forms",
        sa.column("name", sa.String), sa.column("description", sa.Text), sa.column("schema", sa.JSON),
        sa.column("created_at", sa.DateTime), sa.column("updated_at", sa.DateTime),
    )
    op.bulk_insert(forms, [{"name": NAME, "description": DESCRIPTION, "schema": SCHEMA,
                            "created_at": now, "updated_at": now}])


def downgrade() -> None:
    # Only the untouched copy is removed; one that inspections point at stays,
    # because inspections keep a NOT NULL reference to their form.
    bind = op.get_bind()
    if "inspection_forms" not in sa.inspect(bind).get_table_names():
        return
    row = bind.execute(sa.text("SELECT id FROM inspection_forms WHERE name = :name"), {"name": NAME}).first()
    if row is None:
        return
    used = bind.execute(sa.text("SELECT 1 FROM inspections WHERE form_template_id = :id LIMIT 1"),
                        {"id": row[0]}).first()
    if not used:
        bind.execute(sa.text("DELETE FROM inspection_form_links WHERE form_id = :id"), {"id": row[0]})
        bind.execute(sa.text("DELETE FROM inspection_forms WHERE id = :id"), {"id": row[0]})


# Kept importable for tests, which build the database with create_all.
FORM = {"name": NAME, "description": DESCRIPTION, "schema": json.loads(json.dumps(SCHEMA))}
