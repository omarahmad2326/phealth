"""Agent microservice HTTP surface.

Never exposed publicly. The MedRad backend proxies browser requests here over
the private Docker network after authenticating the user and confirming the
Super Admin role.
"""
from __future__ import annotations

import json
import logging

from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.config import settings
from app.graph import run_agent
from app import providers


logging.basicConfig(level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO))
logger = logging.getLogger("agent.main")

app = FastAPI(
    title="phealth Assistant",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(max_length=4000)


class RunRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    user_token: str = Field(min_length=10)
    # Recent turns, oldest first. Without this every question is an isolated
    # run and the assistant re-introduces itself on each reply.
    history: list[Turn] = Field(default_factory=list, max_length=12)
    # Answer will be spoken, so it is composed for the ear rather than the page.
    voice: bool = False
    # The site the person is working in, so "how many open work orders" has a
    # hospital to be about. The backend resolves and authorises it; the agent
    # only repeats it to the model and the tools.
    facility_id: int | None = None
    facility_name: str = ""


@app.get("/health")
async def health() -> dict[str, object]:
    model = providers.describe()
    return {
        "status": "ok",
        "service": settings.SERVICE_NAME,
        "agent_name": settings.AGENT_NAME,
        "model_configured": model["configured"],
        "backend_configured": bool(settings.MEDRAD_INTERNAL_KEY.strip()),
        **model,
    }


def _require_internal(key: str | None) -> None:
    import secrets

    expected = settings.MEDRAD_INTERNAL_KEY.strip()
    if not expected or not key or not secrets.compare_digest(key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal credentials.",
        )


@app.post("/internal/v1/runs/stream")
async def stream_run(
    payload: RunRequest,
    x_internal_key: str | None = Header(None, alias="X-Internal-Key"),
) -> EventSourceResponse:
    """Run one question, streaming progress then the final answer over SSE."""
    _require_internal(x_internal_key)
    # Checked against the configured provider rather than one vendor key. This
    # read ANTHROPIC_API_KEY regardless of provider, so a deployment on Groq or
    # OpenRouter refused every question with "model is not configured".
    if not providers.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The assistant model is not configured.",
        )

    async def event_source():
        try:
            history = [{"role": t.role, "text": t.text} for t in payload.history]
            async for event in run_agent(
                payload.question,
                payload.user_token,
                history,
                payload.voice,
                facility_id=payload.facility_id,
                facility_name=payload.facility_name,
            ):
                yield {"event": event.get("event", "message"), "data": json.dumps(event)}
        except Exception:  # noqa: BLE001 - surface as a stream error, never a 500 mid-stream
            logger.exception("Agent run failed")
            yield {
                "event": "error",
                "data": json.dumps({"error": "Something went wrong answering that. Please try again in a moment."}),
            }

    return EventSourceResponse(event_source())
