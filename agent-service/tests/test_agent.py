"""Prove the agent routes, uses tools for the right site, and survives a provider failure.

No network: models are scripted and the backend is a fake, so this runs anywhere
and exercises the real graph, the real provider layer and the real prompts.

    python tests/test_agent.py
"""
from __future__ import annotations

import asyncio
import os
import pathlib
import sys
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.setdefault("MEDRAD_INTERNAL_KEY", "k" * 40)

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel  # noqa: E402
from langchain_core.messages import AIMessage  # noqa: E402

from app import graph, providers  # noqa: E402
from app.config import Settings, settings  # noqa: E402


# ── configuration ────────────────────────────────────────────────────────────

def test_hosted_providers_need_a_key():
    bare = Settings(GROQ_API_KEY="", OPENROUTER_API_KEY="")
    assert not bare.provider_ready("groq"), "an address is not a configuration"
    assert not bare.fallback_configured()
    keyed = Settings(GROQ_API_KEY="gsk", OPENROUTER_API_KEY="sk-or")
    assert keyed.provider_ready("groq") and keyed.fallback_configured()
    local = Settings(AGENT_PROVIDER="openai", AGENT_BASE_URL="http://ollama:11434/v1")
    assert local.provider_ready("openai"), "a self-hosted endpoint needs no key"
    print("ok  hosted providers need a key; a self-hosted endpoint needs an address")


def test_each_role_has_its_own_model():
    s = Settings(GROQ_API_KEY="gsk", OPENROUTER_API_KEY="sk-or")
    assert s.model_for("router") == "llama-3.1-8b-instant"
    assert s.model_for("tools") == "llama-3.3-70b-versatile"
    assert s.model_for("tools", fallback=True).startswith("meta-llama/")
    one = Settings(AGENT_MODEL="qwen/qwen3-32b", AGENT_SYNTHESIS_MODEL="openai/gpt-oss-120b")
    assert one.model_for("router") == "qwen/qwen3-32b", "one model for every role"
    assert one.model_for("synthesis") == "openai/gpt-oss-120b", "unless a role says otherwise"
    print("ok  routing, tools and writing resolve to their own models")


# ── provider layer ───────────────────────────────────────────────────────────

def test_a_tool_conversation_survives_translation():
    messages = providers._to_messages("sys", [
        {"role": "user", "content": "how many?"},
        {"role": "assistant", "content": [
            {"type": "text", "text": "Checking."},
            {"type": "tool_use", "id": "c1", "name": "search_work_orders", "input": {"facility_id": 7}},
        ]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "c1", "content": "x" * 20000}]},
    ])
    kinds = [type(m).__name__ for m in messages]
    assert kinds == ["SystemMessage", "HumanMessage", "AIMessage", "ToolMessage"], kinds
    assert messages[2].tool_calls[0]["args"] == {"facility_id": 7}
    assert len(messages[3].content) == providers.MAX_TOOL_RESULT_CHARS, "results are capped"
    print("ok  tool calls and results translate to LangChain messages, capped")


class _Down(GenericFakeChatModel):
    """A primary provider that is rate limited."""

    def _generate(self, *args, **kwargs):  # noqa: D401
        raise RuntimeError("429 rate limited")

    async def _agenerate(self, *args, **kwargs):
        raise RuntimeError("429 rate limited")

    def _stream(self, *args, **kwargs):
        raise RuntimeError("429 rate limited")

    async def _astream(self, *args, **kwargs):
        raise RuntimeError("429 rate limited")
        yield  # pragma: no cover


def test_a_rate_limited_primary_falls_back():
    original = providers._build
    configured = (settings.GROQ_API_KEY, settings.OPENROUTER_API_KEY)
    settings.GROQ_API_KEY, settings.OPENROUTER_API_KEY = "gsk", "sk-or"
    providers._models.clear()

    def fake_build(provider, model, max_tokens, temperature):
        if provider == settings.AGENT_PROVIDER:
            return _Down(messages=iter([]))
        return GenericFakeChatModel(messages=iter([AIMessage(content="From the fallback.")]))

    providers._build = fake_build
    try:
        reply = asyncio.run(providers.complete(system="s", messages=[{"role": "user", "content": "hi"}],
                                               max_tokens=50, role="synthesis"))
        assert reply.text == "From the fallback.", reply
    finally:
        providers._build = original
        settings.GROQ_API_KEY, settings.OPENROUTER_API_KEY = configured
    print("ok  a rate-limited primary continues the turn on the fallback")


# ── the graph, end to end ────────────────────────────────────────────────────

class _Scripted:
    """A chat model that returns the next scripted reply and records what it saw."""

    def __init__(self, replies: list[AIMessage]):
        self.replies = list(replies)
        self.seen: list[list[Any]] = []
        self.tools: list[str] = []

    def bind_tools(self, tools, **kwargs):
        self.tools = [t["function"]["name"] for t in tools]
        return self

    async def ainvoke(self, messages):
        self.seen.append(messages)
        return self.replies.pop(0)

    async def astream(self, messages):
        self.seen.append(messages)
        reply = self.replies.pop(0)
        for word in reply.content.split(" "):
            yield AIMessage(content=word + " ")


class _Backend:
    """The phealth internal API, as far as the agent can tell."""

    calls: list[tuple[str, dict]] = []

    def __init__(self, token):
        self.token = token

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def list_tools(self):
        tool = {"name": "search_work_orders", "description": "Work orders.",
                "input_schema": {"type": "object", "properties": {"facility_id": {"type": "integer"}}}}
        return [tool], {"search_work_orders": "service-requests"}, []

    async def call_tool(self, name, arguments):
        _Backend.calls.append((name, arguments))
        return {"tool": name, "total_count": 3, "items": [], "applied_filters": arguments}

    async def search_knowledge(self, query, module=None, limit=6):
        return {"results": []}


def test_a_site_question_is_answered_for_that_site():
    router = _Scripted([AIMessage(content="", tool_calls=[{
        "name": "route_question", "args": {"intent": "database", "module": "service-requests"}, "id": "r1"}])])
    tools = _Scripted([
        AIMessage(content="", tool_calls=[{"name": "search_work_orders", "args": {"facility_id": 7}, "id": "t1"}]),
        AIMessage(content="Done."),
    ])
    writer = _Scripted([AIMessage(content="There are 3 open work orders at Lahore Office.")])
    by_role = {"router": router, "tools": tools, "synthesis": writer}

    original_role, original_client = providers._for_role, graph.MedRadClient
    providers._for_role = lambda role, max_tokens, temperature: by_role[role]
    graph.MedRadClient = _Backend
    _Backend.calls = []

    async def run():
        events = []
        async for event in graph.run_agent("how many open work orders?", "t" * 20,
                                           facility_id=7, facility_name="Lahore Office"):
            events.append(event)
        return events

    try:
        events = asyncio.run(run())
    finally:
        providers._for_role, graph.MedRadClient = original_role, original_client

    answer = events[-1]
    assert answer["event"] == "answer" and answer["intent"] == "database", answer
    assert answer["answer"] == "There are 3 open work orders at Lahore Office.", answer["answer"]
    assert _Backend.calls == [("search_work_orders", {"facility_id": 7})], _Backend.calls
    first_tool_prompt = tools.seen[0][-1].content
    assert "Lahore Office (facility_id=7)" in first_tool_prompt, first_tool_prompt
    assert any(e.get("event") == "token" for e in events), "the answer streams"
    print("ok  a question asked inside a site is routed, looked up and answered for that site")


def test_narrowing_keeps_a_whole_domain_together():
    """'Open work orders in OR-2' needs rooms and work orders; commerce tools are noise."""
    names = {
        "resolve_entity": "platform", "search_spaces": "locations", "search_service_requests": "service-requests",
        "search_assets": "facility-inventory", "maintenance_due": "maintenance",
        "search_invoices": "billing", "search_rentals": "rentals", "search_users": "users",
    }
    tools = [{"name": n, "description": "", "input_schema": {"type": "object", "properties": {}}}
             for n in names]
    # Pad past the narrowing threshold with commerce tools.
    for i in range(graph.NARROW_ABOVE_TOOL_COUNT):
        tools.append({"name": f"sales_tool_{i}", "description": "", "input_schema": {"type": "object"}})
        names[f"sales_tool_{i}"] = "sales"

    offered: list[str] = []

    class Backend(_Backend):
        async def list_tools(self):
            return tools, names, []

    tools_model = _Scripted([AIMessage(content="Nothing to do.")])

    original_role, original_client = providers._for_role, graph.MedRadClient
    providers._for_role = lambda role, max_tokens, temperature: tools_model
    graph.MedRadClient = Backend
    try:
        asyncio.run(graph.tools_node({"question": "open work orders in OR-2", "user_token": "t" * 20,
                                      "module": "operations"}))
    finally:
        providers._for_role, graph.MedRadClient = original_role, original_client
    offered = set(tools_model.tools)
    assert {"resolve_entity", "search_spaces", "search_service_requests",
            "search_assets", "maintenance_due"} <= offered, offered
    assert not offered & {"search_invoices", "search_rentals", "search_users", "sales_tool_0"}, offered
    print("ok  narrowing to a domain keeps rooms, assets and work orders together")


def test_an_action_is_prepared_as_a_card_and_never_called_done():
    card = {"action_id": "a-1", "title": "Raise a work order", "status": "proposed",
            "lines": [{"label": "What", "value": "SKT-01 · Duplex receptacle"}], "warnings": []}
    prepared_calls: list = []
    looked_up: list = []

    class Backend(_Backend):
        async def list_tools(self):
            lookup = {"name": "search_fixtures", "description": "", "input_schema": {"type": "object", "properties": {}}}
            action = {"name": "prepare_fault_report", "description": "",
                      "input_schema": {"type": "object", "properties": {"fixture_id": {"type": "integer"}}}}
            return [lookup], {"search_fixtures": "locations"}, [action]

        async def call_tool(self, name, arguments):
            looked_up.append(name)
            return {"tool": name, "total_count": 0, "items": []}

        async def prepare_action(self, name, arguments):
            prepared_calls.append((name, arguments))
            return card

    router = _Scripted([AIMessage(content="", tool_calls=[{
        "name": "route_question", "args": {"intent": "database", "module": "operations"}, "id": "r1"}])])
    tools = _Scripted([
        AIMessage(content="", tool_calls=[{"name": "prepare_fault_report",
                                           "args": {"fixture_id": 11, "description": "Dead"}, "id": "t1"}]),
        AIMessage(content="Prepared."),
    ])
    writer = _Scripted([AIMessage(content="A work order for SKT-01 is ready: press Confirm below to raise it.")])
    by_role = {"router": router, "tools": tools, "synthesis": writer}

    original_role, original_client = providers._for_role, graph.MedRadClient
    providers._for_role = lambda role, max_tokens, temperature: by_role[role]
    graph.MedRadClient = Backend

    async def run():
        return [e async for e in graph.run_agent("report the dead socket SKT-01 in OR-2", "t" * 20)]

    try:
        events = asyncio.run(run())
    finally:
        providers._for_role, graph.MedRadClient = original_role, original_client

    assert prepared_calls == [("prepare_fault_report", {"fixture_id": 11, "description": "Dead"})]
    assert looked_up == [], "an action must never go through the lookup path"
    assert "prepare_fault_report" in tools.tools, "actions are offered alongside lookups"
    kinds = [e["event"] for e in events]
    assert "action" in kinds and kinds.index("action") < kinds.index("answer"), kinds
    told = tools.seen[1][-1].content
    assert "PREPARED, NOT DONE" in told, told
    answer = events[-1]
    assert answer["actions"] == [card], answer["actions"]
    print("ok  an action becomes a card before the answer, and the model is told it is not done")


def test_knowledge_search_is_standalone_site_aware_and_unfiltered_by_domain():
    searched: list = []

    class Backend(_Backend):
        async def search_knowledge(self, query, module=None, limit=6, facility_id=None):
            searched.append((query, module, facility_id))
            return {"results": [{"citation": "Fire Evacuation Plan - Page 3", "kind": "hospital_document",
                                 "module": "documents", "text": "Close fire doors."}]}

    router = _Scripted([AIMessage(content="fire door procedure during evacuation")])
    original_role, original_client = providers._for_role, graph.MedRadClient
    providers._for_role = lambda role, max_tokens, temperature: router
    graph.MedRadClient = Backend
    try:
        result = asyncio.run(graph.retrieve_node({
            "question": "and for the fire doors?", "user_token": "t" * 20, "module": "operations",
            "facility_id": 7, "history": [{"role": "user", "text": "what is our evacuation procedure?"},
                                          {"role": "assistant", "text": "Staff move patients horizontally first."}],
        }))
    finally:
        providers._for_role, graph.MedRadClient = original_role, original_client
    assert searched == [("fire door procedure during evacuation", None, 7)], searched
    assert result["citations"][0]["type"] == "document"
    print("ok  knowledge search rewrites follow-ups, stays in the site, and ignores the routed domain")


# ── changing things ──────────────────────────────────────────────────────────

def _run_with(by_role, backend, question, **kwargs):
    original_role, original_client = providers._for_role, graph.MedRadClient
    providers._for_role = lambda role, max_tokens, temperature: by_role[role]
    graph.MedRadClient = backend

    async def run():
        return [e async for e in graph.run_agent(question, "t" * 20, **kwargs)]

    try:
        return asyncio.run(run())
    finally:
        providers._for_role, graph.MedRadClient = original_role, original_client


def _route(intent, reason=None):
    return _Scripted([AIMessage(content="", tool_calls=[{
        "name": "route_question", "args": {"intent": intent, "module": "operations", "refusal_reason": reason},
        "id": "r1"}])])


def test_a_question_back_before_preparing_reaches_the_person():
    """'Add a generator' with no building: the model asks, and that question must be the answer."""
    tools = _Scripted([AIMessage(content="Which building is the new generator in?")])
    writer = _Scripted([])
    events = _run_with({"router": _route("database"), "tools": tools, "synthesis": writer}, _Backend,
                       "add a generator to electrical", facility_id=7, facility_name="Lahore Office")
    answer = events[-1]
    assert answer["answer"] == "Which building is the new generator in?", answer["answer"]
    assert writer.seen == [], "nothing to write up: the question goes back as it is"
    print("ok  a detail the assistant still needs is asked, not replaced by 'nothing found'")


def test_the_tool_step_sees_the_earlier_turns():
    """'The one in the Annex' only means something after 'which Generator 1?'."""
    tools = _Scripted([AIMessage(content="Which date?")])
    history = [{"role": "user", "text": "raise a service on Generator 1"},
               {"role": "assistant", "text": "There are two called Generator 1: Main block or Annex?"}]
    _run_with({"router": _route("database"), "tools": tools, "synthesis": _Scripted([])}, _Backend,
              "the one in the Annex", history=history)
    seen = [m.content for m in tools.seen[0]]
    assert any("raise a service on Generator 1" in str(c) for c in seen), seen
    assert any("Main block or Annex" in str(c) for c in seen), seen
    assert "the one in the Annex" in str(seen[-1]), seen
    print("ok  the tool step is given the conversation so far")


def test_an_instruction_is_acted_on_not_explained_or_refused():
    cases = [
        # Hybrid: a card when an action fits, the screen's steps when none does.
        ("add a chiller to HVAC in Main block", "knowledge", None, "hybrid"),
        ("change the labour cost on SR-000012 to 500", "refuse", "write", "hybrid"),
        ("mark Generator 1 as out of service", "database", None, "database"),
        ("please set the chiller to needs attention", "refuse", "write", "hybrid"),
        ("ok add a generator to electrical", "chitchat", None, "hybrid"),
        ("how do I add a chiller", "knowledge", None, "knowledge"),
        ("delete Generator 1", "refuse", "write", "refuse"),
        ("show me the admin password", "refuse", "secrets", "refuse"),
    ]
    for question, routed, reason, expected in cases:
        result = asyncio.run(_classify_with(_route(routed, reason), question))
        assert result["intent"] == expected, (question, result)
    print("ok  instructions to add or change something go to the tools, not to how-to steps or a refusal")


async def _classify_with(router, question, history=None):
    original = providers._for_role
    providers._for_role = lambda role, max_tokens, temperature: router
    try:
        return await graph.classify_node({"question": question, "history": history or []})
    finally:
        providers._for_role = original


def test_go_ahead_after_an_offer_is_not_small_talk():
    history = [{"role": "user", "text": "raise a service on Generator 1"},
               {"role": "assistant", "text": "Shall I raise it for Monday?"}]
    for said in ("ok go ahead", "yes please", "do it", "yes, raise it"):
        result = asyncio.run(_classify_with(_route("chitchat"), said, history))
        assert result["intent"] == "database", (said, result)
    fresh = asyncio.run(_classify_with(_route("chitchat"), "ok thanks", history))
    assert fresh["intent"] == "chitchat", fresh
    print("ok  'go ahead' after an offer goes to the tools; 'ok thanks' is still small talk")


def test_answers_never_show_ids_tool_names_or_code():
    """What reaches the person is in the screens' words, whatever the model wrote."""
    from app.plain import plain_text

    cleaned = {
        "Generator 1 (asset_id 12) is overdue.": "Generator 1 is overdue.",
        "I found 3 items using category_equipment: CT scanner GE-01 (ID: 44).": "I found 3 items: CT scanner GE-01.",
        "I used the prepare_inspection_visit tool to prepare it. Press Confirm.": "Press Confirm.",
        "The `total_count` is 5 and 2 are `needs_attention`.": "The total count is 5 and 2 are needs attention.",
        "Open it at /inspection-visits/12 to fill it in.": "Open it to fill it in.",
        "I need its ZIP code (zip_code) and email.": "I need its ZIP code and email.",
        "The lookup failed with HTTP 422 Unprocessable Entity. Try naming the site.": "Try naming the site.",
        "Result: {\"total_count\": 5} so five.": "Result: so five.",
        "```json\n{\"a\": 1}\n```\nDone.": "Done.",
    }
    for raw, expected in cleaned.items():
        assert plain_text(raw) == expected, (raw, plain_text(raw))
    kept = ("Visit INS-2026-0012 on 2026-09-28 covers TPF-000005, costing $45,000.",
            "Email ali_raza@example.com about SR-001709-Q01.",
            "ID card readers work 24/7 and the idea is valid.")
    for text in kept:
        assert plain_text(text) == text, (text, plain_text(text))
    print("ok  answers never show ids, tool or field names, addresses, JSON or error codes")


def test_a_leaky_answer_is_cleaned_while_it_streams():
    """The streamed words are also read aloud, so they are cleaned before they are sent."""
    tools = _Scripted([
        AIMessage(content="", tool_calls=[{"name": "category_equipment", "args": {"facility_id": 7}, "id": "t1"}]),
        AIMessage(content="Done."),
    ])
    writer = _Scripted([AIMessage(content=(
        "Generator 1 (asset_id 12) is overdue. I used the category_equipment tool to check. "
        "Its next date was 2026-09-01."))])
    events = _run_with({"router": _route("database"), "tools": tools, "synthesis": writer}, _Backend,
                       "is the generator overdue?", facility_id=7, facility_name="Lahore Office")
    streamed = "".join(e["text"] for e in events if e.get("event") == "token")
    answer = events[-1]["answer"]
    for text in (streamed, answer):
        assert "asset_id" not in text and "category_equipment" not in text and " 12" not in text, text
    assert answer == "Generator 1 is overdue. Its next date was 2026-09-01.", answer
    assert streamed.strip() == answer, (streamed, answer)
    print("ok  a leaky answer is cleaned sentence by sentence as it streams, and whole at the end")


def test_a_question_back_names_things_not_ids():
    tools = _Scripted([AIMessage(content=(
        "Which one - asset_id 12 (Generator 1, TPF-000004) or asset_id 15 (Generator 2, TPF-000009)?"))])
    events = _run_with({"router": _route("database"), "tools": tools, "synthesis": _Scripted([])}, _Backend,
                       "inspect the generator now", facility_id=7, facility_name="Lahore Office")
    answer = events[-1]["answer"]
    assert "asset_id" not in answer and "Generator 1, TPF-000004" in answer, answer
    print("ok  a question back names the choices, not their ids")


def test_a_failure_is_told_plainly():
    class _Down:
        def bind_tools(self, tools, **kwargs):
            return self

        async def ainvoke(self, messages):
            raise RuntimeError("upstream 503: connection reset by peer at 10.0.0.4:8000")

    events = _run_with({"router": _route("database"), "tools": _Down(), "synthesis": _Scripted([])}, _Backend,
                       "what failed today?", facility_id=7, facility_name="Lahore Office")
    answer = events[-1]["answer"]
    assert answer == "I could not look that up just now. Please try again in a moment.", answer
    assert all("503" not in error and "10.0.0.4" not in error for error in events[-1]["errors"])
    print("ok  when the model or a lookup fails, the person is told plainly and never shown the error")


def test_inspecting_and_clearing_are_instructions():
    for said in ("inspect generator 1 now", "please clear the red tag on the x-ray", "register a site called Mark-3"):
        assert graph.instruction_verb(said) is not None, said
    print("ok  'inspect', 'clear' and 'register' are instructions to prepare, not questions")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"\n{len(tests)} checks passed")
