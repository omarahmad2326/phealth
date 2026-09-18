"""A red tag: an inspection failure serious enough to say the standard is not met.

It outlives the inspection that raised it. The item and its department stay
red until somebody clears it and says what was done, and both halves — who
raised it and who cleared it — are kept, because the point of a red tag is
that an authority can read the history.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import relationship

from app.db.base import Base


class RedTag(Base):
    __tablename__ = "red_tags"

    id = Column(Integer, primary_key=True, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True)
    equipment_id = Column(Integer, ForeignKey("equipment.id", ondelete="CASCADE"), nullable=True, index=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=True, index=True)
    inspection_id = Column(Integer, ForeignKey("inspections.id", ondelete="SET NULL"), nullable=True)

    # What was wrong, in the inspector's words.
    note = Column(Text, nullable=False)
    raised_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    raised_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    # Empty while the tag stands. A cleared tag keeps its row.
    cleared_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    cleared_at = Column(DateTime, nullable=True, index=True)
    clear_note = Column(Text, nullable=True)

    facility = relationship("Facility")
    equipment = relationship("Equipment")
    vehicle = relationship("Vehicle")
    raised_by = relationship("User", foreign_keys=[raised_by_id])
    cleared_by = relationship("User", foreign_keys=[cleared_by_id])
