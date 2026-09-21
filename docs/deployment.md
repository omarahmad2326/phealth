# Deploying phealth to a server

A clean install on a fresh Linux host, running the whole stack under Docker
Compose behind nginx. The database is created empty and built entirely by
Alembic, which is the path that produces a schema you can trust.

Everything below assumes a non-root user with `sudo` and membership of the
`docker` group.

---

## 1. Prerequisites

Docker Engine with the Compose plugin, and git:

```bash
sudo apt update
sudo apt install -y git ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker            # or log out and back in
docker compose version   # expect v2.x
```

Roughly 4 GB of RAM and 20 GB of disk is enough for the core services. The
`speech`, `voice` and `agent` containers add more; §6 covers leaving them out.

---

## 2. Create the folder and clone

```bash
sudo mkdir -p /opt/phealth
sudo chown "$USER:$USER" /opt/phealth
git clone https://github.com/omarahmad2326/phealth.git /opt/phealth
cd /opt/phealth
```

Anywhere writable works; `/opt/phealth` is used throughout.

---

## 3. Write the environment file

Compose refuses to start without `POSTGRES_PASSWORD` and `SECRET_KEY` — they
are declared `${VAR:?...}`, with no default, deliberately. Everything else has
a working default.

```bash
cp .env.example .env
```

Generate real secrets rather than inventing them:

```bash
python3 - <<'PY'
import secrets
print("POSTGRES_PASSWORD=" + secrets.token_urlsafe(32))
print("SECRET_KEY="       + secrets.token_urlsafe(48))
print("TURN_PASSWORD="    + secrets.token_urlsafe(24))
PY
```

Then edit `.env` and set at least these:

```ini
# ── Database ──────────────────────────────────────────────────────────────
POSTGRES_USER=phealth
POSTGRES_PASSWORD=<the generated value>
POSTGRES_DB=phealth_db

# Used only by commands you run outside Compose. Inside Compose the backend
# builds its own URL from the three values above and reaches the database at
# the hostname `postgres`, not localhost.
DATABASE_URL=postgresql://phealth:<the generated value>@localhost:5432/phealth_db

# ── Security ──────────────────────────────────────────────────────────────
APP_ENV=production
ENABLE_API_DOCS=false
SECRET_KEY=<the generated value>

# Leave this false. See §5 — it is the single most important line in the file.
RUN_STARTUP_MIGRATIONS=false

# ── Public addresses ──────────────────────────────────────────────────────
# VITE_API_URL is baked into the frontend bundle at *build* time, so it must be
# correct before you build, and changing it later means rebuilding.
VITE_API_URL=https://your-domain.example/api/v1
BACKEND_CORS_ORIGINS=["https://your-domain.example"]
TRUSTED_HOSTS=["your-domain.example","localhost","127.0.0.1"]

TURN_PASSWORD=<the generated value>
```

Lock it down — it holds the database password and the JWT signing key:

```bash
chmod 600 .env
```

`.env` is in `.gitignore` and must stay untracked.

### Namespace the Compose project

Optional, but it keeps volumes and networks from colliding with anything else
on the host:

```bash
echo "COMPOSE_PROJECT_NAME=phealth" >> .env
```

The `container_name:` values in `docker-compose.yml` are still `medrad_*`. They
are cosmetic. To rename them:

```bash
sed -i 's/container_name: medrad_/container_name: phealth_/' docker-compose.yml
```

---

## 4. Start the database and cache

Bring these up first and let them become healthy before anything tries to
connect:

```bash
docker compose up -d postgres redis
docker compose ps            # wait for both to read "healthy"
```

Postgres creates `phealth_db` on first start, owned by `phealth`, from the
values in `.env`. It only does this when the data volume is empty — if you
later change `POSTGRES_DB`, an existing volume will not be renamed.

---

## 5. Build the schema

**Nothing runs Alembic for you.** No container, no entrypoint. And on a fresh
database you should not run the migration chain at all.

### Why not `alembic upgrade head`

The chain is 56 migrations accumulated by a predecessor system, and it does not
survive a clean run. `c1d2e3f4a5b6` calls `sa.inspect(bind).get_columns(
"quotation_payments")` on a table that **no migration ever creates** — it only
ever existed because `create_all()` made it on machines where that had run. The
chain has been relied on to top up databases that `create_all` had already
built, so gaps like this were never exposed. A genuinely empty database finds
them immediately:

```
sqlalchemy.exc.NoSuchTableError: quotation_payments
```

That history also describes a different product. For a new deployment it is
archaeology, not an asset.

### Build from the models instead

```bash
docker compose run --rm backend python -c "
import app.models
import app.assistant.kb.store  # the assistant's knowledge base tables live outside app.models
from app.db.base import Base, engine
Base.metadata.create_all(bind=engine)
print('tables created:', len(Base.metadata.tables))
"
```

Importing `app.models` matters: it is the package `__init__` that registers all
106 tables. Do **not** use `RUN_STARTUP_MIGRATIONS` to do this — `auto_migrate.
py` imports only a subset of models and would silently skip all 21 facilities
tables.

Then set the Alembic baseline:

```bash
docker compose run --rm backend alembic stamp head
```

Not to pretend the migrations ran, but so migrations you write *from here on*
have a starting point. Without it, the next `upgrade` tries all 56 from scratch.

### Seed the demonstration data

`create_all` gives you tables, not rows — including the ten disciplines that
the migrations would have inserted. The seed script puts those back
along with a worked hospital:

```bash
docker compose run --rm backend python scripts/seed_demo.py
```

It is idempotent, keyed on the facility name, so running it twice is safe.

### Keep `RUN_STARTUP_MIGRATIONS` false

`app/auto_migrate.py` is a `create_all()` followed by best-effort `ALTER TABLE
ADD COLUMN` statements wrapped in `try/except: pass`, and it runs at startup
when that flag is true. Letting it run turns schema management into a race
between two mechanisms. Build the schema deliberately, once, with the command
above.

## 6. Build and start the application

```bash
docker compose build
docker compose up -d
```

That starts: `postgres`, `redis`, `coturn`, `backend`, `frontend`,
`rental_scheduler`, `facilities_scheduler`, `payment_proof_ocr_worker`,
`agent`, `speech`, `voice`. (`ollama` sits behind the `local-llm` profile and
stays down unless you ask for it.)

To leave out the heavier optional services:

```bash
docker compose up -d postgres redis backend frontend \
                     rental_scheduler facilities_scheduler
```

`facilities_scheduler` is what generates compliance tasks, raises preventive
maintenance work orders and expires stale permits, every 30 minutes. Without
it every page and endpoint still works, but nothing falls due on its own.

It checks that its tables exist before the first cycle and exits loudly if they
do not, so a clean start is itself confirmation that §5 succeeded.

---

## 7. Create the first administrator

```bash
docker compose exec backend python create_admin.py
```

This creates `admin` / `password`. **Change it at first login.** The script is a
bootstrap, not a provisioning tool — the credentials are hardcoded and the
account is a superadmin.

---

## 8. Put nginx in front

Every published port binds to `127.0.0.1` only — the backend on 8000, the
frontend on 3000 — so nothing is reachable from outside until you terminate TLS
in front of it. `deploy/nginx/medrad-load-balanced.conf.example` is a worked
starting point.

```bash
sudo apt install -y nginx
sudo cp deploy/nginx/medrad-load-balanced.conf.example \
        /etc/nginx/sites-available/phealth
sudo ln -s /etc/nginx/sites-available/phealth /etc/nginx/sites-enabled/
sudo nano /etc/nginx/sites-available/phealth   # set your domain and upstreams
sudo nginx -t && sudo systemctl reload nginx
```

Then TLS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example
```

Open only what you need:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw allow 3478          # TURN, only if you use voice or video calling
sudo ufw enable
```

---

## 9. Verify

```bash
docker compose ps                               # every service healthy
curl -fsS http://127.0.0.1:8000/health          # backend
curl -fsSI http://127.0.0.1:3000/ | head -1     # frontend
curl -fsSI https://your-domain.example/ | head -1

docker compose logs --tail=40 facilities_scheduler
```

The scheduler logs a line on start and then stays quiet unless a run actually
did something — a silent log means a healthy estate with nothing due, not a
stalled worker.

A quick look at the schema:

```bash
docker compose exec postgres psql -U phealth -d phealth_db -c \
  "select count(*) from information_schema.tables where table_schema='public';"
docker compose exec postgres psql -U phealth -d phealth_db -c \
  "select code, name from disciplines order by sort_order;"
```

Ten disciplines are seeded by the migrations: the facilities migration's nine,
with "Mechanical / HVAC" renamed to "Mechanical", plus HVAC from the site
categories migration. Their presence confirms the migration chain reached the
end. The Categories screens also create the four category disciplines on first
use if a database has none.

The inspection programme's own tables arrive with migration `d7f1a3b5c9e2`,
and `e8a2b4c6d0f3` then folds the maintenance plans into the item clocks and
links service to the inspection that found the fault:

```bash
docker compose exec postgres psql -U phealth -d phealth_db -c   "select table_name from information_schema.tables
    where table_name in ('vehicles','red_tags','inspection_form_links') order by 1;"
```

Three rows means the inspection migration ran. It also adds the department and
the inspection clock to `equipment`, size to `facilities`, and `RED_TAG` to the
`inspectionresult` enum.

```bash
docker compose exec postgres psql -U phealth -d phealth_db -c \
  "select status, count(*) from maintenance_schedules group by status;"
```

After `e8a2b4c6d0f3`, plans on equipment that is in the inspection programme
are `retired` and their interval now lives on the item. Plans on other assets
stay `active` and keep generating work orders. See
[inspections.md](inspections.md) for how the programme works and what to set up
after deploying.

---

## 10. Running it day to day

**Deploying a change:**

```bash
cd /opt/phealth
git pull
docker compose build
docker compose run --rm backend python -c "import app.main; print('backend imports')"
docker compose run --rm backend alembic upgrade head
docker compose up -d
```

The import check runs the new code on the server's own Python and libraries
before anything is restarted. If it fails, the running containers are still on
the old code and nothing is down; send the error rather than running `up -d`.
It exists because a release once passed every test on a newer Pydantic and
then refused to start on the pinned one.

Run the migration before `up -d`, not after, so the new code never starts
against an old schema. If a release changes `VITE_API_URL`, the frontend must
be rebuilt — it is compiled in, not read at runtime.

**Backups.** Take one before every deploy that carries a migration:

```bash
docker compose exec -T postgres pg_dump -U phealth -Fc phealth_db \
  > "backup-$(date +%F-%H%M).dump"
```

Restoring:

```bash
docker compose exec -T postgres pg_restore -U phealth -d phealth_db --clean \
  < backup-2026-09-11-1430.dump
```

**Logs:**

```bash
docker compose logs -f backend
docker compose logs -f facilities_scheduler
```

**Uploads** live in the `uploads/` bind mount, outside the database. Back them
up alongside it.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `POSTGRES_PASSWORD must be configured` | `.env` missing or not in the directory you ran `docker compose` from. |
| `relation "..." already exists` during migration | `create_all` has run against this database. See §5. Do not stamp past it on a server without first establishing what the schema actually contains. |
| Frontend loads, every API call fails | `VITE_API_URL` was wrong at build time. Fix `.env`, then `docker compose build frontend && docker compose up -d frontend`. |
| Login works, later requests 401 | `SECRET_KEY` changed. Every issued token is invalidated by that; users need to log in again. |
| CORS errors in the browser console | The origin is not in `BACKEND_CORS_ORIGINS`. It must match scheme and host exactly. |
| `facilities_scheduler` exits immediately | Its startup check found missing tables. Migrations have not been run. |
| Compliance tasks never appear | `facilities_scheduler` is not running, or the estate genuinely has nothing due. |
