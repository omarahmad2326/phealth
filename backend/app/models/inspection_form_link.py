"""Which inspection forms a department — or a site's fleet — is inspected on.

Forms stay a shared library, built once in the form builder. This says where
each one is used and how often it is normally done there, which is what
prefills the frequency when an item is added to that department.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.db.base import Base


class InspectionFormLink(Base):
    __tablename__ = "inspection_form_links"
    __table_args__ = (
        UniqueConstraint("form_id", "department_id", name="uq_form_link_department"),
        UniqueConstraint("form_id", "facility_id", "scope", name="uq_form_link_fleet"),
    )

    id = Column(Integer, primary_key=True, index=True)
    form_id = Column(Integer, ForeignKey("inspection_forms.id", ondelete="CASCADE"), nullable=False, index=True)
    # "department" for a department's forms, "fleet" for a site's vehicles.
    scope = Column(String(16), nullable=False, default="department", server_default="department")
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="CASCADE"), nullable=True, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id", ondelete="CASCADE"), nullable=True, index=True)

    # How often this is normally done here. Prefills an item's own frequency;
    # the item's own value is what actually decides when it is due.
    default_frequency = Column(String(20), nullable=True)
    default_interval_days = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    form = relationship("InspectionForm")
