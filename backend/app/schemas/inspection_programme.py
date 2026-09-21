"""Payloads for the inspection programme: departments, schedules, visits, red tags, fleet.

Small on purpose: every field here is one somebody fills in on a screen.
Written for Pydantic 2.5, which the server pins.
"""
from datetime import date
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field

Frequency = Literal["monthly", "quarterly", "semi_annual", "annual", "custom"]
Scope = Literal["department", "facility", "fleet"]
Result = Literal["pass", "fail", "red_tag"]
Condition = Literal["working", "needs_attention", "out_of_service"]
IntervalDays = Annotated[int, Field(ge=1, le=3650)]


class ScheduleIn(BaseModel):
    """How often an item is inspected, and what maintenance rides along."""
    frequency: Optional[Frequency] = None
    interval_days: Optional[IntervalDays] = None
    first_due_on: Optional[date] = None
    pm_task: Optional[str] = Field(None, max_length=500)
    pm_assignee_id: Optional[int] = None


class ItemScheduleIn(ScheduleIn):
    department_id: Optional[int] = None


class BulkAssignIn(ScheduleIn):
    """Put many items into a department and on the clock in one go."""
    equipment_ids: list[int] = Field(..., min_length=1, max_length=500)
    department_id: Optional[int] = None


class FormAttachIn(BaseModel):
    form_id: int
    default_frequency: Optional[Frequency] = None
    default_interval_days: Optional[IntervalDays] = None


class VisitIn(BaseModel):
    facility_id: int
    scope: Scope = "department"
    department_id: Optional[int] = None
    scheduled_on: date
    inspector_id: Optional[int] = None


class RecordItemIn(BaseModel):
    result: Result
    # One entry per form filled on this item: {"form_id": 3, "name": "...",
    # "answers": {...}}. Stored as given; the form builder owns the shape.
    answers: Optional[list[dict]] = None
    note: Optional[str] = Field(None, max_length=2000)
    # The inspector asking for the work: raises one service job for this item,
    # titled from the note and linked back to this inspection.
    raise_service: bool = False


class FinishVisitIn(BaseModel):
    notes: Optional[str] = Field(None, max_length=2000)


class ClearRedTagIn(BaseModel):
    note: str = Field(..., min_length=3, max_length=2000)


class VehicleIn(BaseModel):
    facility_id: int
    name: str = Field(..., min_length=1, max_length=160)
    registration: Optional[str] = Field(None, max_length=40)
    vehicle_type: Optional[str] = Field(None, max_length=60)
    make: Optional[str] = Field(None, max_length=120)
    model: Optional[str] = Field(None, max_length=120)
    year: Optional[int] = Field(None, ge=1900, le=2100)
    driver_name: Optional[str] = Field(None, max_length=160)
    odometer: Optional[int] = Field(None, ge=0, le=10000000)
    condition: Condition = "working"
    notes: Optional[str] = Field(None, max_length=4000)
    frequency: Optional[Frequency] = None
    interval_days: Optional[IntervalDays] = None
    first_due_on: Optional[date] = None
    pm_task: Optional[str] = Field(None, max_length=500)
    pm_assignee_id: Optional[int] = None


class VehicleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=160)
    registration: Optional[str] = Field(None, max_length=40)
    vehicle_type: Optional[str] = Field(None, max_length=60)
    make: Optional[str] = Field(None, max_length=120)
    model: Optional[str] = Field(None, max_length=120)
    year: Optional[int] = Field(None, ge=1900, le=2100)
    driver_name: Optional[str] = Field(None, max_length=160)
    odometer: Optional[int] = Field(None, ge=0, le=10000000)
    condition: Optional[Condition] = None
    notes: Optional[str] = Field(None, max_length=4000)
    frequency: Optional[Frequency] = None
    interval_days: Optional[IntervalDays] = None
    first_due_on: Optional[date] = None
    pm_task: Optional[str] = Field(None, max_length=500)
    pm_assignee_id: Optional[int] = None
