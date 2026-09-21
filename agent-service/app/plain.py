"""Answers in the words of the screens.

The person asking never needs the database's own numbers, the names of the
tools used to look things up, field names like facility_id, JSON, or an error
trace - and a model shown all of those as evidence will repeat some of them.
Instructions ask it not to; this makes sure, on every reply, including the
text streamed while it is still being written and read aloud.

What people do see on screen stays: asset tags (TPF-000005), work order and
visit numbers (SR-001709, INS-2026-0012), money, dates and counts.
"""
from __future__ import annotations

import re

# The read tools and actions, by the names the model knows them by.
_TOOL_NAMES = (
    "resolve_entity", "facility_detail", "facility_business_summary", "search_inspections",
    "service_request_detail", "search_service_requests", "search_invoices", "search_rentals",
    "search_sales_quotations", "search_service_quotations", "search_attendance", "search_users",
    "rank_technicians", "rank_facilities_by_revenue", "rank_products", "site_overview", "search_spaces",
    "space_contents", "search_fixtures", "search_assets", "category_equipment", "equipment_jobs",
    "asset_detail", "asset_value", "maintenance_due", "compliance_due", "inspection_status",
    "inspection_visits", "route_question", "search_knowledge",
)
_TOOL = r"(?:{}|(?:prepare|search|resolve|rank)_[a-z_]+)".format("|".join(_TOOL_NAMES))

_FENCED = re.compile(r"```.*?```", re.DOTALL)
_JSON_OBJECT = re.compile(r"\{[^{}]*\"[\w ]+\"\s*:[^{}]*\}")
# A sentence about the tools rather than the answer - "I used the
# category_equipment tool to look it up." Taking out only the name would
# leave a fragment, so the whole sentence goes.
_TOOL_SENTENCE = re.compile(
    r"[^.!?\n]*\b(?:I|we)\s+(?:used|called|ran|queried|checked)\b[^.!?\n]*?`?" + _TOOL + r"`?[^.!?\n]*[.!?]?",
    re.IGNORECASE)
# "(the category_equipment tool)", "using search_users", "via prepare_add_equipment"
_TOOL_PHRASE = re.compile(
    r"\s*\(?\s*(?:(?:I\s+)?(?:used|using|via|with|from|by calling|called|calling|through)\s+)?(?:the\s+)?`?"
    + _TOOL + r"`?(?:\s+(?:tool|action|function))?\s*\)?", re.IGNORECASE)
# "(ID: 12)", "(asset_id 44)", "[id=5]"
_ID_BRACKETED = re.compile(r"\s*[(\[]\s*[^()\[\]]*?\b(?:[a-z]+_)*ids?\b\s*[:=#]?\s*\d+[^()\[\]]*[)\]]", re.IGNORECASE)
# "asset_id 12", "facility_id=3", "ID #12", "id: 5", "with id 7"
_ID_INLINE = re.compile(r"\s*(?:\bwith\s+)?\b(?:[a-z]+_)*ids?\b\s*(?:[:=#]|is|of)?\s*#?\d+\b", re.IGNORECASE)
# "ZIP code (zip_code)": a bracket holding nothing but a field name repeats what was just said.
_FIELD_IN_BRACKETS = re.compile(r"\s*\(\s*`?[a-z][a-z0-9]*(?:_[a-z0-9]+)+`?\s*\)")
# snake_case left over - field names and codes - but never part of an email address.
_SNAKE = re.compile(r"`?(?<![@.\w])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![@\w])`?")
_BACKTICKED = re.compile(r"`([^`\n]+)`")
# Addresses inside the app or its API, which mean nothing read aloud or on a card.
_PATH = re.compile(r"(?:\s+(?:at|on|via|in|from|under))?\s*(?<![\w/])/(?:api/v\d+/)?[a-z][a-z-]*"
                   r"(?:/[\w-]+)*(?:\?[\w=&%.-]*)?(?=[\s.,;:)]|$)")
_TRACE_SENTENCE = re.compile(
    r"[^.!?\n]*(?:Traceback|\b[A-Z][A-Za-z]+(?:Error|Exception)\b|\bHTTP\s*\d{3}\b|\bstatus code\s*\d{3}\b)"
    r"[^.!?\n]*[.!?]?")


def _humanise(match: re.Match) -> str:
    word = match.group(1)
    if word.endswith("_id") or word.endswith("_ids"):
        return ""
    return word.replace("_", " ")


def plain_text(text: str, *, keep_edges: bool = False) -> str:
    """The same words with internal ids, tool and field names, JSON and traces taken out."""
    if not text:
        return text
    lead = re.match(r"\s*", text).group() if keep_edges else ""
    trail = re.search(r"\s*$", text).group() if keep_edges else ""
    out = _FENCED.sub("", text)
    out = _JSON_OBJECT.sub("", out)
    out = _TRACE_SENTENCE.sub("", out)
    out = _TOOL_SENTENCE.sub("", out)
    out = _TOOL_PHRASE.sub("", out)
    out = _ID_BRACKETED.sub("", out)
    out = _ID_INLINE.sub("", out)
    out = _PATH.sub("", out)
    out = _FIELD_IN_BRACKETS.sub("", out)
    out = _SNAKE.sub(_humanise, out)
    out = _BACKTICKED.sub(r"\1", out)
    # Tidy what the removals leave behind.
    out = re.sub(r"\(\s*[,;:]?\s*\)|\[\s*\]", "", out)
    out = re.sub(r"[ \t]+([,.;:!?])", r"\1", out)
    out = re.sub(r"([,;:])(?=[.!?])", "", out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    out = re.sub(r"(?m)^[ \t]+|[ \t]+$", "", out).strip()
    if not keep_edges:
        return out
    # A streamed piece keeps the space or line break that joins it to the next.
    return (lead + out + trail) if out else ""


class PlainStream:
    """plain_text for text that arrives a few characters at a time.

    Text is released a sentence or a line at a time, so a pattern split across
    two deltas ("asset_" then "id 12") is cleaned whole. A fenced block is held
    until it closes, because it is removed whole.
    """

    _BOUNDARY = re.compile(r"[.!?](?=\s)|\n")

    def __init__(self) -> None:
        self._pending = ""

    def push(self, delta: str) -> str:
        self._pending += delta
        if self._pending.count("```") % 2:
            return ""  # inside a fenced block
        cut = -1
        for match in self._BOUNDARY.finditer(self._pending):
            cut = match.end()
        if cut <= 0:
            return ""
        ready, self._pending = self._pending[:cut], self._pending[cut:]
        return plain_text(ready, keep_edges=True)

    def flush(self) -> str:
        ready, self._pending = self._pending, ""
        return plain_text(ready, keep_edges=True)
