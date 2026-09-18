from fastapi import APIRouter
from app.api.v1.endpoints import (
    assistant,
    auth,
    users,
    facilities,
    tiers,
    facility_users,
    modalities,
    departments,
    equipment,
    chat,
    websocket,
    calendar,
    audit,
    service_requests,
    inventory,
    inventory_capture,
    dashboard,
    notifications,
    inspections,
    test_equipment,
    sales,
    sales_portal,
    rentals,
    rental_portal,
    attendance,
    hr,
    reports,
    billing,
    square_webhooks,
    locations,
    fixtures,
    vendors,
    spaces,
    disciplines,
    readings,
    permits,
    compliance,
    maintenance,
    asset_ledger,
    site_categories,
    equipment_maintenance,
    inspection_programme,
    fleet,
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(facilities.router, prefix="/facilities", tags=["facilities"])
api_router.include_router(tiers.router, prefix="/tiers", tags=["tiers"])
api_router.include_router(facility_users.router, prefix="/facility-users", tags=["facility-users"])
api_router.include_router(modalities.router, prefix="/modalities", tags=["modalities"])
api_router.include_router(departments.router, prefix="/departments", tags=["departments"])
api_router.include_router(equipment.router, prefix="/equipment", tags=["equipment"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(websocket.router, tags=["websocket"])
api_router.include_router(calendar.router, prefix="/calendar", tags=["calendar"])
api_router.include_router(audit.router, prefix="/audit-logs", tags=["audit-logs"])
api_router.include_router(service_requests.router, prefix="/service-requests", tags=["service-requests"])
api_router.include_router(inventory.router, prefix="/inventory", tags=["inventory"])
# Its own prefix, so nothing that already answers under /inventory changes.
api_router.include_router(
    inventory_capture.router, prefix="/inventory-captures", tags=["inventory"],
)
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(inspections.router, prefix="/inspections", tags=["inspections"])
api_router.include_router(test_equipment.router, prefix="/test-equipment", tags=["test-equipment"])
api_router.include_router(sales.router, prefix="/sales", tags=["sales"])
api_router.include_router(sales_portal.router, tags=["sales-portal"])
api_router.include_router(rentals.router, prefix="/rentals", tags=["rentals"])
api_router.include_router(rental_portal.router, tags=["rental-portal"])
api_router.include_router(attendance.router, prefix="/attendance", tags=["attendance"])
api_router.include_router(hr.router, prefix="/hr", tags=["hr"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
api_router.include_router(square_webhooks.router, prefix="/webhooks", tags=["webhooks"])
api_router.include_router(assistant.router, prefix="/assistant", tags=["assistant"])
# No prefix: the path must stay under /api/v1/ws/ for the proxy to upgrade it.
api_router.include_router(assistant.voice_router, tags=["assistant"])

# ── Facilities / MEP ─────────────────────────────────────────────────────────
# Their own prefixes, so nothing that already answers under /equipment,
# /facilities or /service-requests changes shape.
api_router.include_router(locations.router, prefix="/locations", tags=["locations"])
api_router.include_router(fixtures.router, prefix="/fixtures", tags=["fixtures"])
api_router.include_router(spaces.router, prefix="/spaces", tags=["spaces"])
api_router.include_router(vendors.router, prefix="/vendors", tags=["vendors"])
api_router.include_router(disciplines.router, prefix="/disciplines", tags=["disciplines"])
api_router.include_router(readings.router, prefix="/readings", tags=["readings"])
api_router.include_router(permits.router, prefix="/permits", tags=["permits"])
api_router.include_router(compliance.router, prefix="/compliance", tags=["compliance"])
api_router.include_router(maintenance.router, prefix="/maintenance", tags=["maintenance"])
api_router.include_router(asset_ledger.router, prefix="/asset-ledger", tags=["asset-ledger"])

# ── Site categories ──────────────────────────────────────────────────────────
# Electrical, Plumbing, Mechanical and HVAC equipment, and the service and
# inspection jobs done on it.
api_router.include_router(site_categories.router, prefix="/site-categories", tags=["site-categories"])
api_router.include_router(
    inspection_programme.router, prefix="/inspection-programme", tags=["inspection-programme"],
)
api_router.include_router(fleet.router, prefix="/fleet", tags=["fleet"])
api_router.include_router(
    equipment_maintenance.router, prefix="/equipment-maintenance", tags=["equipment-maintenance"],
)
