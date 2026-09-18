from app.models.user import User, UserType, UserRole
from app.models.facility import Facility
from app.models.equipment import Equipment, EquipmentStatus
from app.models.service_request import ServiceRequest, Priority, ServiceRequestStatus
from app.models.tier import Tier
from app.models.modality import Modality, ModalityCategory
from app.models.department import Department
from app.models.inspection import Inspection, InspectionBatch, InspectionStatus
from app.models.invoice import Invoice, InvoiceStatus, InvoiceTransaction, PaymentProof, PaymentReceiptDelivery
from app.models.payment_operation import PaymentOperation, PaymentWebhookEvent
from app.models.rental import (
    Rental,
    RentalStatus,
    RentalItem,
    RentalProductRate,
    BillingFrequency,
    RentalDiscountType,
    RentalDepositStatus,
    RentalItemStatus,
    RentalAgreementAcceptance,
    RentalPaymentAuthorization,
    RentalExtensionRequest,
    RentalExtensionStatus,
    RentalDiscountPackage,
)
from app.models.inspection_form import InspectionForm
from app.models.inspection_form_link import InspectionFormLink
from app.models.vehicle import Vehicle
from app.models.red_tag import RedTag
from app.models.audit_log import AuditLog
from app.models.notification import Notification
from app.models.facility_document import FacilityDocument
from app.models.user_facility import UserFacility
from app.models.equipment_facility import EquipmentFacility
from app.models.facility_tier import FacilityTier
from app.models.inventory import InventoryPart, InventoryTransaction
from app.models.inventory_capture import InventoryCapture
from app.models.part_definition import PartDefinition
from app.models.test_equipment import TestEquipment
from app.models.sales import (
    SalesInventoryReservation,
    SalesPaymentAuthorization,
    SalesQuotation,
    SalesQuotationAcceptance,
    SalesQuotationLineItem,
    SalesQuotationRecipient,
)
from app.models.attendance import (
    AttendanceProfile,
    AttendanceFaceSample,
    AttendanceEvent,
    AttendanceFaceStatus,
    AttendanceEventType,
    AttendanceSource,
    AttendanceVerificationStatus,
)
from app.models.chat import (
    FriendRequest, FriendRequestStatus,
    DirectMessage, MessageType,
    Workspace, WorkspaceMember, WorkspaceMemberRole,
    WorkspaceMessage,
)
from app.models.calendar import CalendarEvent
from app.models.hr import (
    LeaveType, LeavePolicy, LeaveRequest, LeaveRequestStatus,
    AttendancePolicy, EmployeePolicyAssignment,
    Holiday, HolidayType, Announcement, AnnouncementPriority,
    JobOpening, JobOpeningStatus, Candidate, CandidateStatus, JobOffer, OfferStatus,
    OnboardingChecklist, OnboardingChecklistItem,
    EmployeeAward, EmployeePromotion, EmployeeResignation, ResignationStatus,
    EmployeeTermination, TerminationType,
    TaxBracket, PayrollConfig, PayrollRun, PayrollRunStatus, Payslip, PayFrequency,
    Meeting, MeetingStatus, MeetingAttendee, MeetingMinutes, RSVPStatus,
    DocumentCategory, ContractType, DocumentTemplate, ContractTemplate,
    EmployeeDocument, EmployeeContract, ContractStatus, EmployeeAcknowledgment,
    Timesheet, TimesheetStatus, DayStatus,
)

# ── Facilities / MEP ─────────────────────────────────────────────────────────
from app.models.discipline import Discipline, UserDiscipline, SEED_DISCIPLINES
from app.models.location import (
    Location, FloorPlan, LocationType, SpaceUse, Criticality, ElectricalBranch,
    OccupancyStatus, LOCATION_TYPES, SPACE_USES,
)
from app.models.space_status import (
    SpaceStatus, SpaceStatusHistory, Availability, OutOfServiceReason, StatusSource,
)
from app.models.vendor import (
    Vendor, VendorContact, VendorCredential, VendorContract, VendorContractAsset,
    VendorType, VendorStatus, CredentialType, VendorContractType, VendorContractStatus,
)
from app.models.asset_link import AssetServesAsset, AssetServesLocation, ServiceType
from app.models.reading import ReadingPoint, Reading, UnitOfMeasure, ReadingPointKind
from app.models.permit import (
    WorkPermit, PermitApproval, PermitType, PermitStatus, ApprovalRole, ApprovalStatus,
    ConstructionActivityType, PatientRiskGroup, ICRAClass,
)
from app.models.compliance import (
    ComplianceProgram, ComplianceTask, ComplianceAuthority, ComplianceFrequency,
    ComplianceTaskStatus, ComplianceResult,
)
from app.models.maintenance_schedule import MaintenanceSchedule, ScheduleBasis, ScheduleStatus
from app.models.asset_ledger import (
    AssetLedgerEntry, LedgerEntryType, DepreciationMethod,
    LEDGER_ENTRY_TYPES, DEPRECIATION_METHODS,
)
from app.models.fixture import Fixture, FixtureStatus, FIXTURE_STATUSES

from app.models.assistant_action import AssistantAction, ActionStatus
