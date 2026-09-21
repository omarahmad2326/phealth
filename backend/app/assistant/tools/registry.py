"""Tool registry: one definition drives dispatch, validation and model schemas.

The JSON Schema emitted here is handed to Claude verbatim as its tool
definitions, and the same entry is used to dispatch the call. Keeping both from
a single source means the model can never be offered a tool the backend cannot
execute, or a parameter the backend would reject.

Enum values are inlined into the schema so an invalid status is refused during
schema validation, before any query runs.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from app.assistant.tools import analytics, attendance, commerce, entities, facilities, inspections
from app.assistant.tools.base import ToolContext, ToolResult
from app.models.inspection import InspectionStatus
from app.models.invoice import InvoiceStatus, InvoiceType
from app.models.rental import RentalStatus
from app.models.service_request import QuotationStatus, Priority, ServiceRequestStatus, WorkOrderType
from app.models.user import UserRole


def _values(enum_class: Any) -> list[str]:
    return [member.value for member in enum_class]


_DATE = {"type": "string", "format": "date", "description": "ISO date, YYYY-MM-DD"}

# The trade that maintains something, which is also who a fault is routed to.
_TRADE = {
    "type": "string",
    "enum": ["mechanical", "hvac", "electrical", "plumbing", "vertical_transport", "fire_life_safety",
             "medical_gas", "building_envelope", "it_low_voltage", "biomedical"],
    "description": "Trade code.",
}
# The categories a site's equipment is filed under, under Facility.
_CATEGORY = {
    "type": "string",
    "enum": ["electrical", "plumbing", "mechanical", "hvac", "building", "landscaping", "parking"],
    "description": "Equipment category.",
}
_LIMIT = {"type": "integer", "minimum": 1, "maximum": 100, "default": 25}


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., ToolResult]
    module: str

    def anthropic_schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.parameters,
        }


TOOL_DEFINITIONS: tuple[ToolDefinition, ...] = (
    ToolDefinition(
        name="resolve_entity",
        module="platform",
        description=(
            "Resolve a name, number or phrase typed by a person into concrete "
            "records. Use this FIRST whenever the question names a site, a room "
            "or other space (by door code like OR-2 or by name), an asset (by tag "
            "like LO-000014, serial, make or type), a person, a work order, an "
            "inspection or an invoice in words rather than by id. If more than one "
            "candidate is returned, ask which was meant instead of guessing."
        ),
        parameters={
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": list(entities.RESOLVABLE_KINDS),
                    "description": "Type of record to look for.",
                },
                "query": {
                    "type": "string",
                    "description": "The name, number or phrase to match.",
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
            },
            "required": ["kind", "query"],
        },
        handler=entities.resolve_entity,
    ),
    ToolDefinition(
        name="facility_detail",
        module="facilities",
        description=(
            "Full profile for one facility: physical address, billing address, "
            "phone, email, contact person, status and operating hours."
        ),
        parameters={
            "type": "object",
            "properties": {"facility_id": {"type": "integer"}},
            "required": ["facility_id"],
        },
        handler=entities.facility_detail,
    ),
    ToolDefinition(
        name="facility_business_summary",
        module="billing",
        description=(
            "Total business done with one facility, split into sales, rental, "
            "service and inspection streams. Reports invoiced, collected and "
            "outstanding separately. Use for questions like 'how much business "
            "have we done with X'. Cancelled invoices are excluded."
        ),
        parameters={
            "type": "object",
            "properties": {
                "facility_id": {"type": "integer"},
                "date_from": _DATE,
                "date_to": _DATE,
            },
            "required": ["facility_id"],
        },
        handler=entities.facility_business_summary,
    ),
    ToolDefinition(
        name="search_inspections",
        module="inspections",
        description=(
            "Count inspection visits by inspector, site, status and date - for 'how many "
            "inspections did Ali do in May'. For what passed, failed, is red-tagged, due or "
            "overdue use inspection_status; to list scheduled or finished visits use "
            "inspection_visits. Counts inspection VISITS (batches) by default, which is "
            "what the Inspections module displays and what people mean by 'how "
            "many inspections'. Each visit covers many assets, so the per-asset "
            "figure is much larger and is always returned alongside in "
            "aggregates. Only set count_assets when the question is explicitly "
            "about individual assets or devices. Read total_count for 'how many' "
            "questions."
        ),
        parameters={
            "type": "object",
            "properties": {
                "inspector_id": {"type": "integer"},
                "facility_id": {"type": "integer"},
                "status": {
                    "type": "array",
                    "items": {"type": "string", "enum": _values(InspectionStatus)},
                },
                "date_from": _DATE,
                "date_to": _DATE,
                "count_assets": {
                    "type": "boolean",
                    "default": False,
                    "description": (
                        "Count individual asset inspections instead of visits. "
                        "Leave false unless the question names assets or devices."
                    ),
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
        },
        handler=entities.search_inspections,
    ),
    ToolDefinition(
        name="service_request_detail",
        module="service-requests",
        description=(
            "One service request in full, including who it is assigned to, who "
            "raised it, the facility and the equipment. Accepts either the "
            "numeric id or the request number."
        ),
        parameters={
            "type": "object",
            "properties": {
                "service_request_id": {"type": "integer"},
                "request_number": {"type": "string"},
            },
        },
        handler=entities.service_request_detail,
    ),
    ToolDefinition(
        name="search_service_requests",
        module="service-requests",
        description=(
            "Find or count service requests by facility, assigned technician, "
            "status or priority. For anything described as open, active or "
            "completed, use status_group rather than listing statuses by hand: "
            "'open' means different things on different screens and the groups "
            "match them exactly. Read total_count for 'how many' questions."
        ),
        parameters={
            "type": "object",
            "properties": {
                "facility_id": {"type": "integer"},
                "assigned_technician_id": {"type": "integer"},
                "status_group": {
                    "type": "string",
                    "enum": ["new_open", "active", "completed", "open_all"],
                    "description": (
                        "new_open = new and assigned (the module's Open tab); "
                        "active = in progress or waiting; completed = completed; "
                        "open_all = everything not yet completed (the dashboard's "
                        "Open Requests). Prefer this over status."
                    ),
                },
                "status": {
                    "type": "array",
                    "items": {"type": "string", "enum": _values(ServiceRequestStatus)},
                },
                "priority": {"type": "string", "enum": _values(Priority)},
                "date_from": _DATE,
                "date_to": _DATE,
                "trade": _TRADE,
                "location_id": {"type": "integer", "description": "A space; includes everything inside it."},
                "asset_id": {"type": "integer"},
                "work_order_type": {"type": "string", "enum": _values(WorkOrderType)},
                "sla_breached": {"type": "boolean", "description": "True for work past its response deadline."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
        },
        handler=entities.search_service_requests,
    ),
    ToolDefinition(
        name="search_invoices",
        module="billing",
        description=(
            "Find invoices with balances and ageing. Returns SQL-computed totals "
            "for the whole match set in aggregates, independent of the rows "
            "returned. Use overdue_only for questions about late payment."
        ),
        parameters={
            "type": "object",
            "properties": {
                "facility_id": {"type": "integer"},
                "status": {
                    "type": "array",
                    "items": {"type": "string", "enum": _values(InvoiceStatus)},
                },
                "invoice_type": {
                    "type": "array",
                    "items": {"type": "string", "enum": _values(InvoiceType)},
                },
                "overdue_only": {"type": "boolean", "default": False},
                "date_from": _DATE,
                "date_to": _DATE,
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
        },
        handler=entities.search_invoices,
    ),
    ToolDefinition(
        name="search_rentals",
        module="rentals",
        description=(
            "Find or count rental agreements, the unit the Rentals module "
            "lists. Use failed_payments_only for questions about failed or "
            "retrying rental payments. Read total_count for 'how many'."
        ),
        parameters={
            "type": "object",
            "properties": {
                "status": {
                    "type": "array",
                    "items": {"type": "string", "enum": _values(RentalStatus)},
                },
                "facility_id": {"type": "integer"},
                "customer": {"type": "string", "description": "Customer name, partial match."},
                "failed_payments_only": {"type": "boolean", "default": False},
                "date_from": _DATE,
                "date_to": _DATE,
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
        },
        handler=commerce.search_rentals,
    ),
    ToolDefinition(
        name="search_sales_quotations",
        module="sales",
        description=(
            "Find or count sales quotations, the unit the Sales module lists. "
            "A quotation is NOT an invoice: total_quoted_value is pipeline "
            "value, not billed or collected revenue, and must never be "
            "reported as revenue. For revenue use search_invoices or "
            "facility_business_summary."
        ),
        parameters={
            "type": "object",
            "properties": {
                "status": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": list(commerce.SALES_QUOTATION_STATUSES),
                    },
                },
                "paid_status": {
                    "type": "string",
                    "enum": list(commerce.SALES_PAID_STATUSES),
                },
                "facility_id": {"type": "integer"},
                "customer": {"type": "string", "description": "Customer name, partial match."},
                "date_from": _DATE,
                "date_to": _DATE,
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
        },
        handler=commerce.search_sales_quotations,
    ),
    ToolDefinition(
        name="search_service_quotations",
        module="service-requests",
        description=(
            "Find or count SERVICE quotes: priced work raised against a "
            "service request, numbered after it as in SR-001709-Q01. These "
            "are NOT sales quotations -- the two share a word and nothing "
            "else, and live in different tables. Use this whenever someone "
            "says service quote, quote on a service request, or gives a "
            "quote number that starts with a request number. Searching "
            "sales quotations will never find one of these, and finding "
            "nothing there does not mean none exists."
        ),
        parameters={
            "type": "object",
            "properties": {
                "quotation_number": {
                    "type": "string",
                    "description": "Quote number, partial match, e.g. SR-001709-Q01.",
                },
                "status": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": [m.value for m in QuotationStatus],
                    },
                },
                "facility_id": {"type": "integer"},
                "service_request_number": {
                    "type": "string",
                    "description": "Parent request number, partial match.",
                },
                "date_from": _DATE,
                "date_to": _DATE,
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
        },
        handler=commerce.search_service_quotations,
    ),
    ToolDefinition(
        name="search_attendance",
        module="attendance",
        description=(
            "Who checked in, checked out, or took a break, and when. This "
            "is the only record of attendance: it is not derivable from "
            "service requests, inspections or any other module, so if the "
            "question is who was at work, who is in today, when someone "
            "arrived or left, or anything about check-ins, use this. "
            "Defaults to today when no dates are given. Reports how a "
            "check-in was recorded (manual, face, admin) but never the "
            "stored images or face data."
        ),
        parameters={
            "type": "object",
            "properties": {
                "event_type": {
                    "type": "string",
                    "enum": list(attendance.EVENT_TYPES),
                    "description": "Defaults to all events; use check_in for arrivals.",
                },
                "person": {"type": "string", "description": "Name, partial match."},
                "facility_id": {"type": "integer"},
                "source": {"type": "string", "enum": list(attendance.SOURCES)},
                "verification_status": {
                    "type": "string",
                    "enum": list(attendance.VERIFICATION_STATUSES),
                },
                "date_from": _DATE,
                "date_to": _DATE,
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
        },
        handler=attendance.search_attendance,
    ),
    ToolDefinition(
        name="search_users",
        module="users",
        description=(
            "Count or list people by role, activity or facility. Use for "
            "'how many technicians are there', 'who are the admins', 'list "
            "active staff at facility X'. Returns total and active separately, "
            "plus a per-role breakdown. This counts PEOPLE, not their work: for "
            "someone's assigned workload use search_service_requests with "
            "assigned_technician_id."
        ),
        parameters={
            "type": "object",
            "properties": {
                "role": {
                    "type": "array",
                    "items": {"type": "string", "enum": _values(UserRole)},
                },
                "is_active": {"type": "boolean"},
                "facility_id": {"type": "integer"},
                "name": {"type": "string", "description": "Name or username, partial match."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
        },
        handler=entities.search_users,
    ),
    ToolDefinition(
        name="rank_technicians",
        module="service-requests",
        description=(
            "Rank technicians by workload to answer 'who is the busiest "
            "technician'. Combines service requests and inspection visits. "
            "measure=completed ranks finished work (the default); "
            "measure=assigned ranks everything on their plate. Report the "
            "measure you used, since 'busiest' depends on it."
        ),
        parameters={
            "type": "object",
            "properties": {
                "measure": {
                    "type": "string",
                    "enum": list(analytics.TECHNICIAN_MEASURES),
                    "default": "completed",
                },
                "date_from": _DATE,
                "date_to": _DATE,
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
            },
        },
        handler=analytics.rank_technicians,
    ),
    ToolDefinition(
        name="rank_facilities_by_revenue",
        module="billing",
        description=(
            "Rank facilities by revenue to answer 'which facility do we earn "
            "the most from'. measure=collected is cash received (the default "
            "and usually what is meant); invoiced is billed value; outstanding "
            "is unpaid balance. Cancelled invoices are excluded."
        ),
        parameters={
            "type": "object",
            "properties": {
                "measure": {
                    "type": "string",
                    "enum": list(analytics.REVENUE_MEASURES),
                    "default": "collected",
                },
                "date_from": _DATE,
                "date_to": _DATE,
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
            },
        },
        handler=analytics.rank_facilities_by_revenue,
    ),
    ToolDefinition(
        name="rank_products",
        module="sales",
        description=(
            "Rank inventory parts by demand. basis=sales answers 'which "
            "product sells most'; basis=rental answers 'which product is most "
            "in demand for rental'. Returns quantity and value, which can rank "
            "differently. If it returns nothing, say the underlying items are "
            "not recorded rather than reporting zero demand."
        ),
        parameters={
            "type": "object",
            "properties": {
                "basis": {
                    "type": "string",
                    "enum": list(analytics.PRODUCT_BASES),
                    "default": "sales",
                },
                "date_from": _DATE,
                "date_to": _DATE,
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
            },
        },
        handler=analytics.rank_products,
    ),
    ToolDefinition(
        name="site_overview",
        module="facilities",
        description=(
            "One site at a glance: buildings, floors and rooms, beds, spaces out of "
            "service, open and overdue work orders, and compliance status. Use for "
            "'how is Lahore Office doing' or 'give me a summary of this site'."
        ),
        parameters={"type": "object", "properties": {"facility_id": {"type": "integer"}},
                    "required": ["facility_id"]},
        handler=facilities.site_overview,
    ),
    ToolDefinition(
        name="search_spaces",
        module="locations",
        description=(
            "Find buildings, floors, departments (wings) and rooms by code or name, "
            "clinical use or criticality. Read total_count for 'how many' questions."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer"},
            "query": {"type": "string", "description": "Part of a code or name."},
            "location_type": {"type": "string", "enum": ["building", "floor", "wing", "room", "bed",
                                                         "mech_room", "plenum", "riser", "exterior"]},
            "space_use": {"type": "string", "description": "e.g. operating_room, icu, office, conference_room"},
            "criticality": {"type": "string", "enum": ["critical", "high", "standard", "low"]},
            "limit": _LIMIT,
        }},
        handler=facilities.search_spaces,
    ),
    ToolDefinition(
        name="space_contents",
        module="locations",
        description=(
            "Everything in a space and beneath it: the spaces directly inside, "
            "fixtures by type and which are not working, assets by type, and open "
            "work orders. Resolve the space with resolve_entity(kind=space) first."
        ),
        parameters={"type": "object", "properties": {"location_id": {"type": "integer"}},
                    "required": ["location_id"]},
        handler=facilities.space_contents,
    ),
    ToolDefinition(
        name="search_fixtures",
        module="locations",
        description=(
            "Find fixtures - the sockets, lights, gas outlets, diffusers and sinks "
            "that are part of a room - by space, status, type or trade. Use "
            "status=faulty for what is broken right now."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer"},
            "location_id": {"type": "integer", "description": "A space; includes everything inside it."},
            "status": {"type": "string", "enum": ["working", "faulty", "isolated", "removed"]},
            "fixture_type": {"type": "string", "description": "Catalogue key, e.g. receptacle, light_fixture, med_gas_outlet."},
            "trade": _TRADE,
            "limit": _LIMIT,
        }},
        handler=facilities.search_fixtures,
    ),
    ToolDefinition(
        name="search_assets",
        module="facility-inventory",
        description=(
            "Find assets: machinery (chillers, lifts, generators), clinical equipment, "
            "and room items (chairs, tables, screens). Same filters as the Assets "
            "page. kind=room_items for furniture and screens, kind=equipment for "
            "machinery and clinical equipment. Read total_count for 'how many'."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer"},
            "query": {"type": "string", "description": "Tag, make, model, serial or type."},
            "location_id": {"type": "integer", "description": "A space; includes everything inside it."},
            "kind": {"type": "string", "enum": ["room_items", "equipment"]},
            "asset_type": {"type": "string", "description": "Room item key, e.g. chair, table, display_screen."},
            "trade": _TRADE,
            "status": {"type": "string", "enum": ["active", "inactive", "rented", "in_maintenance", "retired"]},
            "limit": _LIMIT,
        }},
        handler=facilities.search_assets,
    ),
    ToolDefinition(
        name="category_equipment",
        module="facility-inventory",
        description=(
            "A site's equipment under Facility, by category - Electrical, Plumbing, "
            "Mechanical, HVAC, Building, Landscaping, Parking - with the department each "
            "belongs to, quantity, condition (Working, Needs attention, Out of service), "
            "open service jobs, book value and cost of ownership. aggregates.by_category "
            "counts every category. Use this for 'what HVAC equipment do we have', 'what is "
            "in Radiology', 'what needs attention', 'what is the generator worth'."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer"},
            "category": _CATEGORY,
            "condition": {"type": "string", "enum": ["working", "needs_attention", "out_of_service"]},
            "department": {"type": "string", "description": "A department's name, or 'none' for "
                                                             "equipment in no department."},
            "building": {"type": "string"},
            "query": {"type": "string", "description": "Name, type, tag, floor or spot."},
            "limit": _LIMIT,
        }, "required": ["facility_id"]},
        handler=facilities.category_equipment,
    ),
    ToolDefinition(
        name="equipment_jobs",
        module="service-requests",
        description=(
            "Service jobs on a site's equipment - work raised because something is at "
            "fault (the Service screen). Use kind=service. kind=inspection only finds "
            "old-style inspection jobs from before inspections moved to each item's own "
            "schedule; for inspections use inspection_status or inspection_visits. status: "
            "open, in_progress, done or overdue. aggregates.by_status counts them."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer"},
            "kind": {"type": "string", "enum": ["service", "inspection"]},
            "status": {"type": "string", "enum": ["open", "in_progress", "done", "overdue"]},
            "category": _CATEGORY,
            "query": {"type": "string", "description": "Job, equipment name, tag or place."},
            "limit": _LIMIT,
        }, "required": ["facility_id", "kind"]},
        handler=facilities.equipment_jobs,
    ),
    ToolDefinition(
        name="asset_detail",
        module="facility-inventory",
        description=(
            "One asset in full: where it is, what it serves, its open work orders, "
            "its maintenance plans and next due date, its cost and book value."
        ),
        parameters={"type": "object", "properties": {
            "asset_id": {"type": "integer"},
            "asset_tag": {"type": "string"},
        }},
        handler=facilities.asset_detail,
    ),
    ToolDefinition(
        name="asset_value",
        module="facility-inventory",
        description=(
            "Total cost, accumulated depreciation and net book value of a site's "
            "assets, with the same split by trade. Only assets with a cost and an "
            "in-service date carry a book value."
        ),
        parameters={"type": "object", "properties": {"facility_id": {"type": "integer"}},
                    "required": ["facility_id"]},
        handler=facilities.asset_value,
    ),
    ToolDefinition(
        name="maintenance_due",
        module="maintenance",
        description=(
            "Older maintenance plans on register assets that are not in the inspection "
            "programme. It does NOT cover equipment in departments or vehicles: what is "
            "due or overdue for inspection or maintenance there is inspection_status with "
            "state=due or state=overdue. Plans falling due in the next N days, or overdue "
            "with overdue_only=true."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer"},
            "within_days": {"type": "integer", "minimum": 0, "maximum": 366, "default": 30},
            "overdue_only": {"type": "boolean", "default": False},
            "trade": _TRADE,
            "limit": _LIMIT,
        }},
        handler=facilities.maintenance_due,
    ),
    ToolDefinition(
        name="compliance_due",
        module="compliance",
        description=(
            "Regulatory compliance tasks (Joint Commission, NFPA, CMS and similar) "
            "due in the next N days, or overdue and missed with overdue_only=true."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer"},
            "within_days": {"type": "integer", "minimum": 0, "maximum": 366, "default": 30},
            "overdue_only": {"type": "boolean", "default": False},
            "limit": _LIMIT,
        }},
        handler=facilities.compliance_due,
    ),
    ToolDefinition(
        name="inspection_status",
        module="inspections",
        description=(
            "How inspections stand - the numbers on the Sites page and a site's dashboard. "
            "Every piece of equipment in a department, and every vehicle, is inspected on "
            "its own schedule; its latest result counts. Without state: each site's status "
            "(Passed all, Passed, Failed, Not inspected yet), its counts (passed, failed, "
            "red_tagged, in_progress, due, overdue, not_scheduled) and each department's "
            "passed out of total; aggregates.sites_by_status counts sites. With state: the "
            "items in that state, each with its department, last result, next due date and, "
            "for red tags, the reason. Due means within 30 days. Use this for 'what failed', "
            "'what is overdue', 'what is red-tagged', 'how is Radiology doing', 'which sites "
            "passed', 'what is due for inspection or maintenance'."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer", "description": "One site; leave out for every site."},
            "state": {"type": "string", "enum": ["passed", "failed", "red_tagged", "in_progress", "due",
                                                  "overdue", "not_scheduled"]},
            "department": {"type": "string", "description": "A department's name."},
            "kind": {"type": "string", "enum": ["equipment", "vehicle"],
                     "description": "vehicle for the fleet only."},
            "limit": _LIMIT,
        }},
        handler=inspections.inspection_status,
    ),
    ToolDefinition(
        name="inspection_visits",
        module="inspections",
        description=(
            "Inspection visits: status=open for scheduled or in progress, status=done for "
            "finished ones, optionally for one department and a date range. Each visit has "
            "its number, what it covers (a department, the whole site or the fleet), its "
            "date, inspector, how many items it holds and has done, and its result."
        ),
        parameters={"type": "object", "properties": {
            "facility_id": {"type": "integer"},
            "status": {"type": "string", "enum": ["open", "done"]},
            "department": {"type": "string", "description": "A department's name."},
            "date_from": _DATE,
            "date_to": _DATE,
            "limit": _LIMIT,
        }},
        handler=inspections.inspection_visits,
    ),
)

TOOLS_BY_NAME: dict[str, ToolDefinition] = {tool.name: tool for tool in TOOL_DEFINITIONS}


def anthropic_tool_schemas(modules: tuple[str, ...] | None = None) -> list[dict[str, Any]]:
    """Tool schemas for the model, optionally narrowed to one module's tools.

    Narrowing matters: binding every tool at once measurably degrades selection
    accuracy, so the graph exposes only the tools relevant to the classified
    intent.
    """
    tools = TOOL_DEFINITIONS
    if modules:
        allowed = set(modules) | {"platform"}
        tools = tuple(t for t in tools if t.module in allowed)
    return [tool.anthropic_schema() for tool in tools]


def dispatch(name: str, ctx: ToolContext, arguments: dict[str, Any]) -> ToolResult:
    """Execute a registered tool. Unknown names and stray arguments are refused."""
    definition = TOOLS_BY_NAME.get(name)
    if definition is None:
        raise KeyError("Unknown tool: {}".format(name))

    allowed = set(definition.parameters.get("properties", {}).keys())
    unexpected = set(arguments or {}) - allowed
    if unexpected:
        raise ValueError(
            "Unexpected argument(s) for {}: {}".format(name, ", ".join(sorted(unexpected)))
        )
    return definition.handler(ctx, **(arguments or {}))
