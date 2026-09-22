"""Inspections as the product runs them: every item on its own clock.

Each piece of equipment in a department, and each vehicle in the fleet,
carries one frequency and the date it next falls due. Its latest result is
what counts: passed, failed, or red-tagged (a failure that takes it out of
service until someone clears the tag). A visit inspects the items due by its
date, for a department, a whole site or the fleet.

These tools answer from the same classification the screens use, so a number
the assistant gives is the number on the card the person is looking at.
Names, not internal ids, are what they return for people to read.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from app.assistant.tools.base import ToolContext, ToolInputError, ToolResult, clamp_limit, validate_date_range
from app.models.department import Department
from app.models.facility import Facility

KINDS = ("equipment", "vehicle")
DUE_LABELS = {"due": "Due within 30 days", "overdue": "Overdue", "scheduled": "Scheduled",
              "not_scheduled": "No schedule"}
RESULT_LABELS = {"pass": "Passed", "fail": "Failed", "red_tag": "Red tagged"}


def _sites(ctx: ToolContext, facility_id: Optional[int]) -> list[Facility]:
    query = ctx.scope_to_facilities(ctx.db.query(Facility).filter(Facility.status != "inactive"), Facility.id)
    if facility_id is not None:
        site = query.filter(Facility.id == facility_id).first()
        if site is None:
            raise ToolInputError("That site is not one of the person's sites.")
        return [site]
    return query.order_by(Facility.name).all()


def department_named(ctx: ToolContext, sites: list[Facility], name: Optional[str]) -> Optional[Department]:
    """A department by the name the person used: exact, or the only one containing it."""
    if not name or not str(name).strip():
        return None
    wanted = str(name).strip().lower()
    rows = ctx.db.query(Department).filter(Department.facility_id.in_([s.id for s in sites])).all()
    exact = [row for row in rows if row.name.strip().lower() == wanted]
    if len(exact) == 1:
        return exact[0]
    partial = exact or [row for row in rows if wanted in row.name.lower()]
    if len(partial) == 1:
        return partial[0]
    names = ", ".join(sorted({row.name for row in rows})) or "none yet"
    if len(partial) > 1:
        raise ToolInputError("More than one department matches '{}': {}. Ask which.".format(
            name, ", ".join(sorted(row.name for row in partial))))
    raise ToolInputError("No department called '{}'. The departments are: {}.".format(name, names))


def _kind(kind: Optional[str]) -> Optional[str]:
    if kind in (None, ""):
        return None
    if kind not in KINDS:
        raise ToolInputError("kind is equipment or vehicle.")
    return kind


def inspection_status(
    ctx: ToolContext,
    facility_id: Optional[int] = None,
    state: Optional[str] = None,
    department: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 25,
) -> ToolResult:
    """How inspections stand: per site and department, or the items in one state."""
    from app.services import inspection_programme as programme

    ctx.require_module("inspections")
    ctx.apply_statement_timeout()
    sites = _sites(ctx, facility_id)
    chosen = department_named(ctx, sites, department)
    if chosen is not None:
        sites = [site for site in sites if site.id == chosen.facility_id]
    kind = _kind(kind)
    filters = {"site": sites[0].name if facility_id is not None and sites else "every site",
               "department": chosen.name if chosen else None, "kind": kind, "state": state,
               "due_means": "falls due within {} days".format(programme.DUE_SOON_DAYS)}

    if state:
        if state not in programme.STATES:
            raise ToolInputError("state is one of: {}.".format(", ".join(programme.STATES)))
        rows = programme.status_rows(ctx.db, sites, state, department_id=chosen.id if chosen else None, kind=kind)
        items = [{
            "name": row["name"],
            "tag": row.get("asset_tag") or row.get("registration"),
            "kind": row["kind"],
            "site": row["site"],
            "department": row.get("department") or ("Fleet" if row["kind"] == "vehicle" else "Not in a department"),
            "last_inspected_on": row.get("last_inspected_on"),
            "last_result": RESULT_LABELS.get(row.get("last_result") or "", None),
            "next_due_on": row.get("next_due_on"),
            "due": DUE_LABELS.get(row.get("due_state") or "", row.get("due_state")),
            "frequency": row.get("frequency_label"),
            "open_visit": (row.get("open_visit") or {}).get("number"),
            "red_tag_reason": (row.get("red_tag") or {}).get("note"),
            "route": "/inspection-status?state={}&site={}".format(state, row["site_id"]),
        } for row in rows[:clamp_limit(limit)]]
        return ToolResult(tool="inspection_status", total_count=len(rows), items=items,
                          aggregates={"state": programme.STATES[state]}, applied_filters=filters)

    # No state: how each site stands, with its departments.
    items: list[dict[str, Any]] = []
    if chosen is not None:
        classified = programme.classify_items(ctx.db, chosen.facility_id, department_id=chosen.id, kind=kind)
        counts = programme._count(classified)
        items.append({
            "department": chosen.name, "site": sites[0].name if sites else None,
            "items": counts["items"],
            **{name: counts[name] for name in programme.STATES},
            "route": "/departments/{}".format(chosen.id),
        })
        return ToolResult(tool="inspection_status", total_count=len(items), items=items,
                          aggregates={"counts": counts}, applied_filters=filters)

    board = programme.dashboard(ctx.db, sites)
    for row in board["sites"][:clamp_limit(limit)]:
        items.append({
            "site": row["name"],
            "status": row["status_label"] or "Not inspected yet",
            "items": row["items"],
            **{name: row[name] for name in programme.STATES},
            "departments": [{
                "name": part["name"], "passed": part["passed"], "total": part["items"],
                "failed_including_red_tags": part["failed"], "red_tagged": part["red_tagged"],
            } for part in row["breakdown"]],
            "route": "/sites/{}".format(row["facility_id"]),
        })
    return ToolResult(
        tool="inspection_status", total_count=len(board["sites"]), items=items,
        aggregates={
            "sites_by_status": {
                "passed": board["site_totals"]["passed"],
                "failed": board["site_totals"]["failed"],
                "with_an_inspection_coming_up": board["site_totals"]["upcoming"],
                "with_an_inspection_in_progress": board["site_totals"]["in_progress"],
                "overdue": board["site_totals"]["overdue"],
                "passed_all_inspections": board["site_totals"]["passed_all"],
                "sites": board["site_totals"]["sites"],
            },
            "item_counts": board["totals"],
        },
        notes=["A site is Failed if anything is failed or red-tagged; Passed all when every item has "
               "passed and nothing is overdue; Passed when something passed and nothing is failing."],
        applied_filters=filters,
    )


def inspection_visits(
    ctx: ToolContext,
    facility_id: Optional[int] = None,
    status: Optional[str] = None,
    department: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = 25,
) -> ToolResult:
    """Inspection visits: what is scheduled or open, and what was done."""
    from app.services import inspection_programme as programme

    ctx.require_module("inspections")
    ctx.apply_statement_timeout()
    validate_date_range(date_from, date_to)
    if status not in (None, "", "open", "done"):
        raise ToolInputError("status is open or done.")
    sites = _sites(ctx, facility_id)
    chosen = department_named(ctx, sites, department)
    if chosen is not None:
        sites = [site for site in sites if site.id == chosen.facility_id]

    visits = []
    for site in sites:
        for batch in programme.visit_rows(ctx.db, site.id, status=status or None,
                                          department_id=chosen.id if chosen else None):
            on = batch.scheduled_date.date() if batch.scheduled_date else None
            if date_from and (on is None or on < date_from):
                continue
            if date_to and (on is None or on > date_to):
                continue
            visits.append((site, batch))
    items = []
    for site, batch in visits[:clamp_limit(limit)]:
        visit = programme.visit_payload(ctx.db, batch)
        covers = visit["department"] or {"fleet": "Fleet", "facility": "Whole site"}.get(visit["scope"], visit["scope"])
        items.append({
            "number": visit["number"], "site": site.name, "covers": covers,
            "scheduled_on": visit["scheduled_on"], "status": str(visit["status"]).replace("_", " "),
            "inspector": (visit["inspector"] or {}).get("name"),
            "items": visit["items"], "done": visit["done"], "result": visit["result_label"],
            "route": "/inspection-visits/{}".format(visit["id"]),
        })
    ctx.db.commit()  # visit_payload may flush nothing, but keeps the session clean
    return ToolResult(
        tool="inspection_visits", total_count=len(visits), items=items,
        applied_filters={"site": sites[0].name if facility_id is not None and sites else "every site",
                         "department": chosen.name if chosen else None, "status": status,
                         "date_from": date_from.isoformat() if date_from else None,
                         "date_to": date_to.isoformat() if date_to else None},
    )
