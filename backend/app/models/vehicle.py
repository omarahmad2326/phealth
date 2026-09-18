"""A site's fleet: the vehicles it runs, inspected like any other item.

A vehicle is not equipment. It has a registration, a driver and an odometer,
it belongs to the site rather than to a department, and nobody asks what its
book value is. It carries the same inspection clock as equipment so the due
list, the visits and the dashboard count both without a second set of rules.
"""
from datetime import datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.db.base import Base


class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(Integer, primary_key=True, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(160), nullable=False)
    registration = Column(String(40), nullable=True, index=True)
    vehicle_type = Column(String(60), nullable=True)
    make = Column(String(120), nullable=True)
    model = Column(String(120), nullable=True)
    year = Column(Integer, nullable=True)
    driver_name = Column(String(160), nullable=True)
    odometer = Column(Integer, nullable=True)
    # working / needs_attention / out_of_service, as equipment's condition.
    condition = Column(String(24), nullable=False, default="working", server_default="working")
    notes = Column(Text, nullable=True)

    # ── Inspection programme ────────────────────────────────────────────────
    # Named as on equipment so one service can drive both.
    pm_scheduling = Column(String(20), nullable=True)
    inspection_interval_days = Column(Integer, nullable=True)
    last_pm_date = Column(Date, nullable=True)
    next_generated_pm_date = Column(Date, nullable=True, index=True)
    last_inspection_result = Column(String(16), nullable=True)
    pm_task = Column(String(500), nullable=True)
    pm_assignee_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    pm_raised_on = Column(Date, nullable=True)
    notified_ahead_on = Column(Date, nullable=True)
    notified_due_on = Column(Date, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    facility = relationship("Facility")
    pm_assignee = relationship("User", foreign_keys=[pm_assignee_id])
