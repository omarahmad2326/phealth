"""Payloads for the categories register and its service and inspection jobs.

Kept deliberately small: every field here is one a person sees on the form.
Written for Pydantic 2.5, which the server pins.
"""
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.money import Money

# How often this item is inspected. See app/services/inspection_programme.py.
Frequency = Literal["monthly", "quarterly", "semi_annual", "annual", "custom"]

# Years, as the asset table stores a useful life: Numeric(5, 2).
UsefulLife = Annotated[Decimal, Field(gt=0, le=Decimal("100"), decimal_places=2)]

Condition = Literal["working", "needs_attention", "out_of_service"]
CategoryCode = Literal["electrical", "plumbing", "mechanical", "hvac", "building", "landscaping", "parking"]
JobKind = Literal["service", "inspection"]
JobStatus = Literal["open", "in_progress", "done"]
InspectionResult = Literal["pass", "fail"]


class CategoryEquipmentCreate(BaseModel):
    facility_id: int
    name: str = Field(..., min_length=1, max_length=160)
    type: str = Field(..., min_length=1, max_length=80)
    # Equipment is placed by its department now. Building, floor and room are
    # no longer asked for on screen; they are kept for what already has them.
    building: Optional[str] = Field(None, max_length=120)
    floor: Optional[str] = Field(None, max_length=80)
    spot: Optional[str] = Field(None, max_length=255)
    quantity: int = Field(1, ge=1, le=100000)
    condition: Condition = "working"
    make: Optional[str] = Field(None, max_length=120)
    model: Optional[str] = Field(None, max_length=120)
    notes: Optional[str] = Field(None, max_length=4000)
    # The price of one item; the total is this times the quantity.
    unit_cost: Optional[Money] = None
    in_service_on: Optional[date] = None
    # Left out, it defaults from the category.
    useful_life_years: Optional[UsefulLife] = None

    # ── Inspections and PM ──────────────────────────────────────────────────
    # The department that answers for it, how often it is inspected, and the
    # maintenance raised when it falls due. The frequency and the first date
    # are prefilled from the department on screen.
    department_id: Optional[int] = None
    frequency: Optional[Frequency] = None
    interval_days: Optional[int] = Field(None, ge=1, le=3650)
    first_due_on: Optional[date] = None
    pm_task: Optional[str] = Field(None, max_length=500)
    pm_assignee_id: Optional[int] = None


class CategoryEquipmentUpdate(BaseModel):
    category: Optional[CategoryCode] = None
    name: Optional[str] = Field(None, min_length=1, max_length=160)
    type: Optional[str] = Field(None, min_length=1, max_length=80)
    building: Optional[str] = Field(None, max_length=120)
    floor: Optional[str] = Field(None, max_length=80)
    spot: Optional[str] = Field(None, max_length=255)
    quantity: Optional[int] = Field(None, ge=1, le=100000)
    condition: Optional[Condition] = None
    make: Optional[str] = Field(None, max_length=120)
    model: Optional[str] = Field(None, max_length=120)
    notes: Optional[str] = Field(None, max_length=4000)
    unit_cost: Optional[Money] = None
    in_service_on: Optional[date] = None
    useful_life_years: Optional[UsefulLife] = None

    department_id: Optional[int] = None
    frequency: Optional[Frequency] = None
    interval_days: Optional[int] = Field(None, ge=1, le=3650)
    first_due_on: Optional[date] = None
    pm_task: Optional[str] = Field(None, max_length=500)
    pm_assignee_id: Optional[int] = None


class CategoryAdopt(BaseModel):
    """An older asset joining a category: what it is called and its department.
    Its tag, cost and history stay as they are."""
    name: str = Field(..., min_length=1, max_length=160)
    type: str = Field(..., min_length=1, max_length=80)
    department_id: Optional[int] = None
    building: Optional[str] = Field(None, max_length=120)
    floor: Optional[str] = Field(None, max_length=80)
    spot: Optional[str] = Field(None, max_length=255)


class EquipmentJobCreate(BaseModel):
    facility_id: int
    kind: JobKind
    equipment_id: int
    title: str = Field(..., min_length=1, max_length=500)
    due_on: Optional[date] = None
    assigned_to_id: Optional[int] = None
    status: JobStatus = "open"
    notes: Optional[str] = Field(None, max_length=4000)
    inspection_result: Optional[InspectionResult] = None
    findings: Optional[str] = Field(None, max_length=4000)
    labour_cost: Optional[Money] = None
    parts_cost: Optional[Money] = None
    is_major_work: bool = False


class EquipmentJobUpdate(BaseModel):
    equipment_id: Optional[int] = None
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    due_on: Optional[date] = None
    assigned_to_id: Optional[int] = None
    status: Optional[JobStatus] = None
    notes: Optional[str] = Field(None, max_length=4000)
    inspection_result: Optional[InspectionResult] = None
    findings: Optional[str] = Field(None, max_length=4000)
    labour_cost: Optional[Money] = None
    parts_cost: Optional[Money] = None
    is_major_work: Optional[bool] = None
