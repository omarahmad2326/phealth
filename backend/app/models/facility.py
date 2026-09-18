from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base

class Facility(Base):
    __tablename__ = "facilities"
    __table_args__ = (
        Index("ix_facilities_status_created", "status", "created_at"),
        Index("ix_facilities_parent_created", "parent_facility_id", "created_at"),
    )
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)

    # General Information
    contact_person = Column(String, nullable=True)
    phone = Column(String, nullable=False)
    email = Column(String, nullable=False)
    address = Column(String, nullable=False)
    suite = Column(String, nullable=True)
    city = Column(String, nullable=False)
    state = Column(String, nullable=False)
    zip_code = Column(String, nullable=False)
    country = Column(String, nullable=False)
    website = Column(String, nullable=True)
    timezone = Column(String, default="America/Chicago")
    operating_hours = Column(String, nullable=True)

    # Facility Details
    parent_facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=True)
    status = Column(String, nullable=False, default="active")  # active / inactive

    # Billing
    billing_name = Column(String, nullable=True)
    billing_email = Column(String, nullable=True)
    billing_street = Column(String, nullable=True)
    billing_suite = Column(String, nullable=True)
    billing_city = Column(String, nullable=True)
    billing_state = Column(String, nullable=True)
    billing_zip_code = Column(String, nullable=True)

    # Other Settings
    tax_exemption = Column(Boolean, default=False)
    inheritance = Column(String, nullable=True)        # Full / Partial / None
    installment_type = Column(String, nullable=True)   # Monthly / Quarterly / Annual / One-time
    payment_method = Column(String, nullable=True)      # Credit Card / Wire Transfer / Check
    delivery_email = Column(String, nullable=True)

    tier_id = Column(Integer, ForeignKey("tiers.id"), nullable=True)

    # ── Size ────────────────────────────────────────────────────────────────
    # How big the site is, for the inspection dashboard. The band is prefilled
    # from the bed count and then left alone: a hospital knows whether it is
    # small or large better than a threshold does.
    beds = Column(Integer, nullable=True)
    area_sqft = Column(Integer, nullable=True)
    size_band = Column(String, nullable=True)  # small / medium / large
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    tier = relationship("Tier", back_populates="facilities")
    equipment = relationship("Equipment", back_populates="facility")
    service_requests = relationship("ServiceRequest", back_populates="facility")
    users = relationship("User", back_populates="facility")
    departments = relationship("Department", back_populates="facility", cascade="all, delete-orphan")
    documents = relationship("FacilityDocument", back_populates="facility", cascade="all, delete-orphan")
    facility_users = relationship("UserFacility", back_populates="facility", cascade="all, delete-orphan")
    facility_equipment = relationship("EquipmentFacility", back_populates="facility", cascade="all, delete-orphan")
    facility_tiers = relationship("FacilityTier", back_populates="facility", cascade="all, delete-orphan")
    tiers = relationship("Tier", secondary="facility_tiers", viewonly=True)
    inventory_parts = relationship("InventoryPart", back_populates="facility", cascade="all, delete-orphan")

    # Self-referential parent/child
    parent = relationship("Facility", remote_side=[id], backref="children", foreign_keys=[parent_facility_id])
