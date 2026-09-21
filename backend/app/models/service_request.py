from sqlalchemy import Column, Integer, String, Text, Date, DateTime, ForeignKey, Enum as SQLEnum, Numeric, Boolean, JSON, Index
from sqlalchemy import false as sa_false

from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.db.base import Base

# ── Quotation models ─────────────────────────────────────────────────────────

class QuotationStatus(str, enum.Enum):
    DRAFT = "draft"
    SENT = "sent"
    AUTHORIZATION_REQUESTED = "authorization_requested"
    AUTHORIZED = "authorized"
    APPROVED = "approved"
    REJECTED = "rejected"
    PARTIALLY_PAID = "partially_paid"
    PAID = "paid"

class PaymentMethod(str, enum.Enum):
    CREDIT_CARD = "credit_card"
    ACH = "ach"
    MBMTS_ACH = "mbmts_ach"

class LineItemType(str, enum.Enum):
    PART = "part"
    LABOR = "labor"
    OTHER = "other"


class QuotationLineItem(Base):
    __tablename__ = "quotation_line_items"

    id = Column(Integer, primary_key=True, index=True)
    quotation_id = Column(Integer, ForeignKey("service_request_quotations.id", ondelete="CASCADE"), nullable=False)
    item_type = Column(String, default=LineItemType.PART.value)  # part / labor / other
    description = Column(String, nullable=False)
    quantity = Column(Numeric(10, 2), default=1)
    unit_price = Column(Numeric(10, 2), nullable=False)
    total = Column(Numeric(10, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    quotation = relationship("ServiceRequestQuotation", back_populates="line_items")


class QuotationPayment(Base):
    __tablename__ = "quotation_payments"

    id = Column(Integer, primary_key=True, index=True)
    quotation_id = Column(Integer, ForeignKey("service_request_quotations.id", ondelete="CASCADE"), nullable=False)
    payment_method = Column(String, nullable=False)  # credit_card / ach / mbmts_ach
    amount = Column(Numeric(10, 2), nullable=False)
    reference_number = Column(String, nullable=True)
    status = Column(String, default="pending")  # pending / completed / failed
    notes = Column(Text, nullable=True)
    # ACH specific fields
    bank_name = Column(String, nullable=True)
    account_last_four = Column(String(4), nullable=True)
    routing_number_last_four = Column(String(4), nullable=True)
    # MBMTS ACH specific fields
    mbmts_account_name = Column(String, nullable=True)
    mbmts_routing_number = Column(String, nullable=True)
    mbmts_account_number = Column(String, nullable=True)
    mbmts_bank_name = Column(String, nullable=True)
    mbmts_bank_address = Column(Text, nullable=True)

    paid_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    authorization_id = Column(Integer, ForeignKey("quotation_authorizations.id", ondelete="SET NULL"), nullable=True)
    payment_channel = Column(String, nullable=True)  # admin_assisted / facility_self_service
    payer_role = Column(String, nullable=True)

    # Relationships
    quotation = relationship("ServiceRequestQuotation", back_populates="payments")
    created_by = relationship("User", foreign_keys=[created_by_id])
    authorization = relationship("QuotationAuthorization", back_populates="payments")
    payment_proofs = relationship(
        "PaymentProof",
        foreign_keys="PaymentProof.quotation_payment_id",
        back_populates="quotation_payment",
    )

    @property
    def paid_by_name(self):
        return self.created_by.full_name if self.created_by else None


class QuotationAuthorization(Base):
    __tablename__ = "quotation_authorizations"

    id = Column(Integer, primary_key=True, index=True)
    quotation_id = Column(Integer, ForeignKey("service_request_quotations.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String, nullable=False, default="requested")
    authorized_amount = Column(Numeric(10, 2), nullable=False)
    channel = Column(String, nullable=True)  # phone / self_service
    requested_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    authorized_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    recorded_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    authorized_by_name = Column(String, nullable=True)
    authorized_by_role = Column(String, nullable=True)
    confirmation_reference = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    requested_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    decided_at = Column(DateTime, nullable=True)
    invalidated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    quotation = relationship("ServiceRequestQuotation", back_populates="authorizations")
    requested_by = relationship("User", foreign_keys=[requested_by_id])
    authorized_by = relationship("User", foreign_keys=[authorized_by_id])
    recorded_by = relationship("User", foreign_keys=[recorded_by_id])
    payments = relationship("QuotationPayment", back_populates="authorization")

    @property
    def requested_by_name(self):
        return self.requested_by.full_name if self.requested_by else None

    @property
    def recorded_by_name(self):
        return self.recorded_by.full_name if self.recorded_by else None


class QuotationLedgerEntry(Base):
    __tablename__ = "quotation_ledger_entries"

    id = Column(Integer, primary_key=True, index=True)
    quotation_id = Column(Integer, ForeignKey("service_request_quotations.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String, nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_name = Column(String, nullable=False)
    actor_role = Column(String, nullable=False)
    channel = Column(String, nullable=True)
    amount = Column(Numeric(10, 2), nullable=True)
    reference_number = Column(String, nullable=True)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    quotation = relationship("ServiceRequestQuotation", back_populates="ledger_entries")
    actor = relationship("User", foreign_keys=[actor_id])


class ServiceRequestQuotation(Base):
    __tablename__ = "service_request_quotations"

    id = Column(Integer, primary_key=True, index=True)
    service_request_id = Column(Integer, ForeignKey("service_requests.id"), nullable=False)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    quotation_number = Column(String, nullable=False, index=True)
    amount = Column(Numeric(10, 2), nullable=False, default=0)
    description = Column(Text, nullable=False)
    status = Column(String, default=QuotationStatus.DRAFT.value)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    revision_history = Column(JSON, default=list)

    # Relationships
    service_request = relationship("ServiceRequest", back_populates="quotations")
    created_by = relationship("User", foreign_keys=[created_by_id])
    line_items = relationship("QuotationLineItem", back_populates="quotation", cascade="all, delete-orphan", lazy="joined")
    payments = relationship("QuotationPayment", back_populates="quotation", cascade="all, delete-orphan", lazy="joined")
    payment_proofs = relationship(
        "PaymentProof",
        back_populates="service_quotation",
        cascade="all, delete-orphan",
        order_by="PaymentProof.created_at.desc()",
    )
    authorizations = relationship(
        "QuotationAuthorization",
        back_populates="quotation",
        cascade="all, delete-orphan",
        order_by="QuotationAuthorization.created_at.desc()",
    )
    ledger_entries = relationship(
        "QuotationLedgerEntry",
        back_populates="quotation",
        cascade="all, delete-orphan",
        order_by="QuotationLedgerEntry.created_at.desc()",
    )


# ── Service Request models ───────────────────────────────────────────────────

class Priority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class WorkOrderType(str, enum.Enum):
    """What kind of work this is.

    One table for medical equipment and plant work rather than two, because a
    hospital runs one work-control desk. Two tables would mean two number
    series, two queues, two mobile views for the same technician, and a second
    copy of the quotation, authorisation, payment and ledger machinery that
    already lives in this file.

    The type is what makes that safe: it is the switch that decides whether the
    billing path applies, whether an asset is required, and which SLA applies.
    """

    CORRECTIVE = "corrective"        # something broke — the default, and today's only behaviour
    PREVENTIVE = "preventive"        # scheduled PM, generated from a schedule
    ROUNDS = "rounds"                # a tour capturing readings, not a repair
    PROJECT = "project"              # capital or improvement work
    SAFETY = "safety"                # hazard or life-safety deficiency
    UTILITY_SHUTDOWN = "utility_shutdown"   # planned outage with an impact list
    INSPECTION = "inspection"        # checking equipment, recorded as pass or fail


# Work order types that are internal plant work and are not billed through the
# quotation/authorisation/payment path. Medical equipment service is billed to
# the facility; a house electrician replacing a receptacle is not, and forcing
# in-house work through a quotation flow is how a CMMS stops being used.
NON_BILLABLE_TYPES: frozenset[str] = frozenset({
    WorkOrderType.PREVENTIVE.value,
    WorkOrderType.ROUNDS.value,
    WorkOrderType.SAFETY.value,
    WorkOrderType.UTILITY_SHUTDOWN.value,
    WorkOrderType.INSPECTION.value,
})

class ServiceRequestStatus(str, enum.Enum):
    NEW = "new"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    WAITING_ON_PARTS = "waiting_on_parts"
    WAITING_FOR_APPROVAL = "waiting_for_approval"
    WAITING_FOR_DEPOT_REPAIR = "waiting_for_depot_repair"
    WAITING_FOR_VENDOR_REPAIR = "waiting_for_vendor_repair"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class BillingStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    NOT_APPROVED = "not_approved"

class ServiceRequest(Base):
    __tablename__ = "service_requests"
    __table_args__ = (
        Index("ix_service_requests_facility_status_created", "facility_id", "status", "created_at"),
        Index("ix_service_requests_technician_status_created", "assigned_technician_id", "status", "created_at"),
        Index("ix_service_requests_requester_created", "requester_id", "created_at"),
        Index("ix_service_requests_status_created", "status", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    request_number = Column(String, unique=True, nullable=False, index=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=False, index=True)

    # Was NOT NULL. Relaxed because the reporting case that matters most for
    # facilities has no asset: "the socket in OR-3 is dead" is reported by a
    # nurse who knows the room and does not know — and must not be made to
    # hunt for — the receptacle's tag or which panel feeds it. The asset gets
    # attached later by the technician, and it is routinely a different asset
    # than anyone guessed at intake.
    #
    # Enforced instead in `app.services.work_order`: a work order must carry an
    # equipment_id or a location_id, and never neither.
    equipment_id = Column(Integer, ForeignKey("equipment.id"), nullable=True)
    # The inspection that found this fault, when one did. Service is raised by
    # a problem - a failed inspection, or somebody reporting a fault - so this
    # is how a job says which it was.
    inspection_id = Column(Integer, ForeignKey("inspections.id", ondelete="SET NULL"),
                           nullable=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True, index=True)

    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_technician_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    problem_description = Column(Text, nullable=False)
    service_required = Column(Text, nullable=True)
    preferred_datetime = Column(DateTime, nullable=True)
    requested_by_name = Column(String, nullable=True)
    reference_number = Column(String, nullable=True)
    request_image_url = Column(Text, nullable=True)
    priority = Column(SQLEnum(Priority), nullable=False)
    status = Column(SQLEnum(ServiceRequestStatus), default=ServiceRequestStatus.NEW)
    resolution_description = Column(Text, nullable=True)
    time_spent_hours = Column(Numeric(5, 2), nullable=True)
    total_cost = Column(Numeric(10, 2), nullable=True)
    assigned_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # New flags
    billing_status = Column(String, default=BillingStatus.PENDING.value)
    cc_auth_requested = Column(Boolean, default=False)
    invoice_deleted = Column(Boolean, default=False)
    history = Column(JSON, default=list)

    # ── Facilities / MEP ────────────────────────────────────────────────────
    work_order_type = Column(String, nullable=False, default=WorkOrderType.CORRECTIVE.value, index=True)
    discipline_id = Column(Integer, ForeignKey("disciplines.id", ondelete="SET NULL"), nullable=True, index=True)

    # Dispatched outside. `WAITING_FOR_VENDOR_REPAIR` already existed in the
    # status enum with nowhere to record who the vendor actually was.
    assigned_vendor_id = Column(Integer, ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True)
    vendor_contract_id = Column(Integer, ForeignKey("vendor_contracts.id", ondelete="SET NULL"), nullable=True)

    # Whether the quotation -> authorisation -> payment path applies at all.
    # In-house plant work is internal labour, optionally charged to a department
    # cost centre, and must not be dragged through a billing flow built for
    # billing a customer for medical equipment service.
    is_billable = Column(Boolean, nullable=False, default=True, index=True)
    cost_center = Column(String, nullable=True)

    # ── SLA ─────────────────────────────────────────────────────────────────
    # `Tier.response_time_hours` has been stored and displayed since the tier
    # feature shipped, and nothing has ever computed against it: there was no
    # due date and no breach. For facilities work that will not do, because the
    # clock is the whole product — and because the interesting input is not the
    # facility's tier but the criticality of the space. The same dead
    # receptacle is a Tuesday ticket in a store room and a cancelled case in an
    # operating room.
    #
    # Computed at creation by `app.services.sla`, and recomputed if priority or
    # location changes. `responded_at` is first technician contact, which is
    # what a response SLA actually measures — not completion.
    sla_response_hours = Column(Integer, nullable=True)
    sla_due_at = Column(DateTime, nullable=True, index=True)
    responded_at = Column(DateTime, nullable=True)
    sla_breached = Column(Boolean, nullable=False, default=False, index=True)

    # Set when this work order is why a space is out of service. The other half
    # of the link lives on SpaceStatus.work_order_id; this side is what lets a
    # technician closing a job be asked whether the space comes back with it.
    takes_space_out_of_service = Column(Boolean, nullable=False, default=False)

    # ── Equipment maintenance ───────────────────────────────────────────────
    # Service and inspection jobs raised on a category's equipment. They are
    # planned, so they carry a due date rather than a response clock. Result
    # and findings are recorded on inspections only. See
    # app/services/equipment_jobs.py.
    due_on = Column(Date, nullable=True, index=True)
    notes = Column(Text, nullable=True)
    inspection_result = Column(String(8), nullable=True)
    findings = Column(Text, nullable=True)
    # What the job cost, split so labour and parts can be compared later.
    # `total_cost` above holds their sum, which is what spend reporting reads.
    # Major work is capital: its cost is posted to the asset ledger as an
    # improvement and depreciated, and is not counted as maintenance spend.
    labour_cost = Column(Numeric(12, 2), nullable=True)
    parts_cost = Column(Numeric(12, 2), nullable=True)
    is_major_work = Column(Boolean, nullable=False, default=False, server_default=sa_false())

    # Relationships
    facility = relationship("Facility", back_populates="service_requests")
    equipment = relationship("Equipment", back_populates="service_requests")
    inspection = relationship("Inspection", foreign_keys=[inspection_id])
    requester = relationship("User", foreign_keys=[requester_id], back_populates="service_requests")
    assigned_technician = relationship("User", foreign_keys=[assigned_technician_id])
    location = relationship("Location", foreign_keys=[location_id])
    discipline = relationship("Discipline")
    assigned_vendor = relationship("Vendor", foreign_keys=[assigned_vendor_id])
    vendor_contract = relationship("VendorContract", foreign_keys=[vendor_contract_id])
    quotations = relationship("ServiceRequestQuotation", back_populates="service_request", cascade="all, delete-orphan", order_by="ServiceRequestQuotation.created_at.desc()")
