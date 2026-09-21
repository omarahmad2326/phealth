# Phia, the phealth assistant

A Super Admin assistant that answers questions from live data and from a
knowledge base, and prepares a small set of changes for the person to confirm.

## Architecture

```
Browser (Super Admin, inside a site)
  │  POST /api/v1/assistant/ask   { question, history, facility_id }   (SSE)
  ▼
phealth backend
  ├─ authenticates, confirms Super Admin, checks access to the site, rate limits, audits
  └─ relays to the agent over the private Docker network
        │
        ▼
   Agent service  (no database credentials, no published port)
   LangGraph:  classify ─┬─ database  ─┐
                         ├─ knowledge ─┼─ synthesize
                         ├─ hybrid ────┘
                         └─ chitchat / clarify / refuse
   Models per role (router · tools · synthesis), Groq primary, OpenRouter fallback
        │  X-Internal-Key + the user's own bearer token
        ▼
phealth backend  /internal/v1/tools/* · /internal/v1/actions/* · /internal/v1/knowledge/search
   └─ PostgreSQL     ← only the backend ever touches the database

Browser  POST /api/v1/assistant/actions/{id}/confirm | cancel   ← only a person runs a change
```

The agent has no identity of its own. It forwards the user's bearer token, so
every lookup and every proposal runs under that user through the backend's own
permission and site-scoping helpers.

## What it can do

**Look things up** (read-only tools): how inspections stand - what passed,
failed, is red-tagged, in progress, due or overdue, per site, department or the
fleet, and each site's status (Passed all, Passed, Failed, Not inspected yet),
from the same classification the cards use; inspection visits scheduled, open
and done; each site's equipment by category and department, with its value;
service jobs; sites, buildings, floors and rooms, their fixtures and assets;
work orders; compliance tasks due or overdue; plus the inherited commerce data
(sales, rentals, billing), users and attendance.

**Explain** from the knowledge base: how to use phealth (generated from the
code at every backend start) and the hospital's own documents - policies,
procedures, manuals - uploaded per site from *Assistant documents*. Answers
name the document and page.

**Prepare, for confirmation**: an inspection visit for a department, the whole
site or the fleet on a date, with an inspector; inspecting one item now; a red
tag cleared with what was done; how often something is inspected; equipment
added to a category in its department, or changed (department, status, name,
type, category, quantity, make, model, purchase cost, in-service date, useful
life, notes); a department; a vehicle for the fleet; a new site; a service job
raised on equipment at fault, or updated (status, due date, assignee, notes,
labour and parts cost); a work order for a fault on a fixture, an asset or a
room; a service booking; an update to any other work order. Departments,
people, equipment, vehicles and forms are named the way people say them and
found by the backend, so a conversation never needs the database's ids. An
inspection is never raised as a job.

Instructions are acted on, not explained: "add a chiller to HVAC" prepares the
change even when the router files it as a how-to question or a refusal. When a
required detail is missing the assistant asks for it, the tool step sees the
earlier turns so "Main block" or "yes, go ahead" completes the request, and
"yes" typed or spoken to a waiting card confirms it. Screens behind the panel
refresh once a change is made.

## Guarantees

- **Nothing changes without a person.** Preparing stores a proposal with the
  exact details, a SHA-256 fingerprint of them and a 10-minute expiry. Confirm
  runs it only for the person it was prepared for, only once, only before it
  expires, only if unchanged - through the same endpoint functions the screens
  use. The model is told a prepared action has not happened and may not say it
  has.
- **Out of reach entirely:** deleting records, ledger entries (including marking
  a job as major work, which posts one), users and
  permissions, uploading files, and compliance tasks.
- **Plain words only.** Every reply - streamed, spoken, a question back or an
  error - passes through `app/plain.py`, which removes internal ids, tool and
  field names, JSON, app addresses and error traces. The prompts ask the same;
  the filter makes sure. A change that fails says so plainly on its card.
- **No invented numbers.** Totals come from SQL `COUNT` and aggregates, never
  from the model counting rows.
- **Site isolation.** A question inside a site defaults to that site; a site's
  documents are never searched for another site.
- **Prompt-injection resistant.** Tool output and documents are wrapped as
  data. The worst injected text can do is produce a card a person declines.
- **Auditable.** Questions, tool calls, proposals, confirmations and document
  uploads are written to `audit_logs`.

## Deploying

1. **Keys in the project `.env`:**

   ```ini
   ASSISTANT_ENABLED=true
   # 32+ characters: openssl rand -hex 32
   ASSISTANT_INTERNAL_KEY=<generated>

   AGENT_PROVIDER=groq
   GROQ_API_KEY=<from console.groq.com>
   AGENT_FALLBACK_PROVIDER=openrouter
   OPENROUTER_API_KEY=<from openrouter.ai>
   ```

   Models default per role (see *Configuration*). Override any of them without
   a code change.

2. **Migrate** (adds `assistant_actions`, and the site on knowledge documents):

   ```bash
   docker compose run --rm backend python -c "import app.main; print('backend imports')"
   docker compose run --rm backend alembic upgrade head
   ```

3. **Build and start:**

   ```bash
   docker compose build backend agent frontend
   docker compose up -d
   docker compose exec agent python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8100/health').read().decode())"
   ```

   `configured` must be `true`, with the provider and models you expect.

4. **Keep `/internal` off the internet** at the edge proxy:

   ```nginx
   location /internal/ { deny all; }
   ```

## Checking it after a change

The evaluation set is twenty real questions with what a correct turn looks
like: routing, tools used, the action prepared, and phrases an answer must not
contain ("has been raised"). Run it against the deployment after changing a
model or a prompt:

```bash
docker compose exec agent python scripts/run_evals.py --token <super admin access token> --site <facility id>
```

It prints one line per case and exits non-zero on any failure. Unit tests run
without network or keys:

```bash
docker compose exec agent python tests/test_agent.py
```

## Choosing models

Three roles, because they are different jobs:

| Role | Job | Default on Groq | Default on OpenRouter |
|---|---|---|---|
| router | one structured word per question | `llama-3.1-8b-instant` | `meta-llama/llama-3.3-70b-instruct` |
| tools | pick tools and arguments | `llama-3.3-70b-versatile` | `meta-llama/llama-3.3-70b-instruct` |
| synthesis | write the answer from evidence | `llama-3.3-70b-versatile` | `meta-llama/llama-3.3-70b-instruct` |

Tool selection is the demanding role; if evaluations show wrong tools or
malformed arguments, give `AGENT_TOOLS_MODEL` a stronger model first. Provider
model catalogues change - check the current IDs on Groq and OpenRouter before
overriding.

Every hosted option sends questions and tool results to that provider. A local
OpenAI-compatible endpoint (`AGENT_PROVIDER=openai`, `AGENT_BASE_URL=...`) keeps
data on the server; see `scripts/benchmark_local_llm.sh` before relying on CPU
inference.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_PROVIDER` | `groq` | `groq`, `openrouter`, `anthropic`, or `openai` (any compatible endpoint) |
| `AGENT_FALLBACK_PROVIDER` | `openrouter` | Used when the primary fails; empty disables |
| `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` | - | Keys; a hosted provider without its key counts as unconfigured |
| `AGENT_BASE_URL` / `AGENT_API_KEY` | - | For `openai` |
| `AGENT_ROUTER_MODEL` / `AGENT_TOOLS_MODEL` / `AGENT_SYNTHESIS_MODEL` | provider default | Model per role |
| `AGENT_FALLBACK_*_MODEL` | provider default | Model per role on the fallback |
| `AGENT_MODEL` | - | One model for every primary role, unless a role is set |
| `AGENT_NAME` | `Phia` | Change the widget header alongside |
| `MEDRAD_INTERNAL_URL` / `MEDRAD_INTERNAL_KEY` | - | Backend tool API and its shared key |
| `MAX_TOOL_ITERATIONS` / `MAX_TOOL_CALLS` | `6` / `10` | Per-question limits (a change needs room to find the record, find a person and prepare) |

## Retrieval

Two legs fused with Reciprocal Rank Fusion: PostgreSQL full-text search over a
weighted tsvector (exact identifiers, ~8 ms), and optional pgvector similarity,
skipped when the extension is absent and never used for a site-scoped question
(it has no site filter). Follow-up questions are rewritten into standalone
queries before searching, and questions about "our policy" or "the plan" prefer
the hospital's documents.
