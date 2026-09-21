"""Checklist forms: a table of requirements, each answered Yes, No or N/A.

Most inspection forms are drawn on a canvas and read as a list of questions.
A checklist is different: it is a regulator's table - indicators, each with its
numbered compliance requirements - and the inspection passes only when every
requirement is met. So a checklist is stored as data, not as a layout, and it
decides for itself whether the inspection can pass.

Shape, kept under its own key so the canvas builder never mistakes it for one
of its own layouts:

    {"title": ..., "version": 1, "source": "phealth_checklist",
     "checklist": {"sections": [
        {"code": "Ind 01", "title": "...", "requirements": [
            {"code": "1.1", "text": "..."},
            {"code": "2.1", "text": "...", "alternative": "access"},
            {"code": "2.2", "text": "...", "alternative": "access"}]}]}}

Requirements sharing an ``alternative`` are either-or ("2.1 ... OR 2.2 ..."):
the pair is met when any one of them is met, so answering No to the one that
does not apply cannot fail an inspection that is otherwise fine.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

SOURCE = "phealth_checklist"
ANSWERS = ("yes", "no", "na")


def is_checklist(schema: Any) -> bool:
    return isinstance(schema, dict) and schema.get("source") == SOURCE and isinstance(schema.get("checklist"), dict)


def requirements(schema: dict) -> list[dict]:
    rows = []
    for section in schema.get("checklist", {}).get("sections", []) or []:
        for requirement in section.get("requirements", []) or []:
            rows.append({**requirement, "section": section.get("code")})
    return rows


def evaluate(schema: dict, answers: Optional[dict]) -> dict[str, Any]:
    """Where a filled checklist stands, and whether it can pass.

    It passes when every requirement is answered and none is unmet. An
    either-or group counts once: met if any member is Yes, not applicable if
    every member is N/A, unmet otherwise.
    """
    answers = {str(key): str(value).lower() for key, value in (answers or {}).items()}
    rows = requirements(schema)
    unanswered = [row["code"] for row in rows if answers.get(row["code"]) not in ANSWERS]

    groups: dict[str, list[dict]] = {}
    singles: list[dict] = []
    for row in rows:
        (groups.setdefault(row["alternative"], []) if row.get("alternative") else singles).append(row)

    met, not_met, not_applicable = [], [], []
    for row in singles:
        value = answers.get(row["code"])
        if value == "yes":
            met.append(row["code"])
        elif value == "no":
            not_met.append(row["code"])
        elif value == "na":
            not_applicable.append(row["code"])
    for members in groups.values():
        values = [answers.get(row["code"]) for row in members]
        codes = [row["code"] for row in members]
        if "yes" in values:
            met.extend(codes)
        elif all(value == "na" for value in values):
            not_applicable.extend(codes)
        elif all(value in ANSWERS for value in values):
            not_met.append(" or ".join(codes))

    return {
        "total": len(rows),
        "answered": len(rows) - len(unanswered),
        "met": len(met),
        "not_met": not_met,
        "not_applicable": len(not_applicable),
        "unanswered": unanswered,
        "can_pass": not unanswered and not not_met,
    }


def summary_line(result: dict) -> str:
    if result["unanswered"]:
        return "{} of {} requirements still to answer".format(len(result["unanswered"]), result["total"])
    if result["not_met"]:
        return "{} requirement{} not met: {}".format(
            len(result["not_met"]), "" if len(result["not_met"]) == 1 else "s", ", ".join(result["not_met"]))
    return "All requirements met"


def check_answers(forms: Iterable[tuple[int, str, dict]], submitted: Optional[list]) -> list[dict]:
    """Evaluate every checklist among the item's forms against what was sent.

    ``forms`` is (form_id, name, schema); ``submitted`` is the list the screen
    sends, one entry per form with its answers.
    """
    by_form = {int(entry.get("form_id")): entry.get("answers") or {}
               for entry in (submitted or []) if isinstance(entry, dict) and entry.get("form_id") is not None}
    results = []
    for form_id, name, schema in forms:
        if not is_checklist(schema):
            continue
        result = evaluate(schema, by_form.get(form_id))
        results.append({"form_id": form_id, "name": name, **result})
    return results
