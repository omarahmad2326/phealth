from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum as SQLEnum, Boolean, Index, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.db.base import Base

class InspectionStatus(str, enum.Enum):
    UPCOMING = "upcoming"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    OVERDUE = "overdue"
    CLOSED = "closed"

class InspectionResult(str, enum.Enum):
    PASS = "pass"
    FAIL = "fail"
    PENDING = "pending"
    # Failed badly enough to say the site is not up to standard. It outlives
    # the inspection: see app/models/red_tag.py.
    RED_TAG = "red_tag"


class InspectionBatch(Base):
    __tablename__ = "inspection_batches"
    __table_args__ = (
        Index("ix_inspection_batches_facility_status_created", "facility_id", "status", "created_at"),
        Index("ix_inspection_batches_status_scheduled_created", "status", "scheduled_date", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    batch_number = Column(String, unique=True, nullable=False, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=False, index=True)
    inspector_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    form_template_id = Column(Integer, ForeignKey("inspection_forms.id"), nullable=True)
    # The department being visited. Empty means the whole site, or its fleet.
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True)
    status = Column(SQLEnum(InspectionStatus), default=InspectionStatus.UPCOMING, index=True)
    scheduled_date = Column(DateTime, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    inspection_frequency = Column(String, nullable=True, default="instant")
    inspection_scope = Column(String, nullable=True, default="facility_assets")
    notes = Column(Text, nullable=True)
    is_instant = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    facility = relationship("Facility")
    inspector = relationship("User")
    form_template = relationship("InspectionForm")
    inspections = relationship("Inspection", back_populates="batch", cascade="all, delete-orphan")


class Inspection(Base):
    __tablename__ = "inspections"
    __table_args__ = (
        Index("ix_inspections_facility_status_created", "facility_id", "status", "created_at"),
        Index("ix_inspections_status_scheduled_created", "status", "scheduled_date", "created_at"),
        Index("ix_inspections_inspector_status_created", "inspector_id", "status", "created_at"),
    )
    
    id = Column(Integer, primary_key=True, index=True)
    inspection_number = Column(String, unique=True, nullable=False, index=True)
    batch_id = Column(Integer, ForeignKey("inspection_batches.id"), nullable=True, index=True)
    equipment_id = Column(Integer, ForeignKey("equipment.id"), nullable=True)
    # A fleet visit inspects vehicles; a department visit inspects equipment.
    vehicle_id = Column(Integer, ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True)
    inventory_part_id = Column(Integer, ForeignKey("inventory_parts.id"), nullable=True, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=False)
    inspector_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    form_template_id = Column(Integer, ForeignKey("inspection_forms.id"), nullable=False)
    status = Column(SQLEnum(InspectionStatus), default=InspectionStatus.UPCOMING)
    result = Column(SQLEnum(InspectionResult), default=InspectionResult.PENDING)
    scheduled_date = Column(DateTime, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    form_data = Column(JSON, nullable=True)  # Inspection form responses
    corrective_actions = Column(Text, nullable=True)
    inspection_scope = Column(String, nullable=True, default="facility_inventory")
    inspection_frequency = Column(String, nullable=True, default="instant")
    compliance_requirement = Column(String, nullable=True)
    criticality = Column(String, nullable=True)
    quotation_notes = Column(Text, nullable=True)
    is_instant = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    batch = relationship("InspectionBatch", back_populates="inspections")
    facility = relationship("Facility")
    vehicle = relationship("Vehicle")
    equipment = relationship("Equipment", back_populates="inspections")
    inventory_part = relationship("InventoryPart")
    inspector = relationship("User")
    form_template = relationship("InspectionForm")
