# Inspections

The product is inspection-led. Everything below hangs off one idea: **every
inspectable item carries one frequency, and from it the date it next falls
due.**

```
Site  ──>  Department  ──>  items (equipment)      ──┐
      └─>  Fleet       ──>  items (vehicles)       ──┤
                                                     ├─> due by a date
                              one frequency each  ───┘        │
                                                              ▼
                                        Visit (department / whole site / fleet)
                                                              │
                                     one form-fill per item ──┴─> Passed
                                                                  Failed
                                                                  Red tag ──> stands
                                                                              until cleared
```

## What each piece is

| Thing | What it means |
|---|---|
| **Department** | A part of a site — Radiology, Theatre, Pharmacy. Holds items and the forms they are inspected on. |
| **Item** | A piece of equipment in a department, or a vehicle in the fleet. Carries its frequency, its next date, its last result. |
| **Form** | A checklist built in the form builder, attached to a department (or to the fleet) with the frequency normally used there. |
| **Visit** | A date, a scope and the items due by then. Filled in one item at a time. |
| **Red tag** | A failure serious enough to say the standard is not met. It outlives the inspection. |

## The clock

An item's frequency is Monthly, Quarterly, Every 6 months, Annually, or a
custom number of days. It is set when the item is added — prefilled from its
department — and can be changed per item or for a whole department at once
(*Departments → Assign items*).

* **Passed** moves the next date on by the frequency.
* **Failed** and **Red tag** make it due again at once: the point of both is
  that somebody comes back.
* **Due** on the dashboard means within 30 days; **overdue** means the date has
  gone by.

The clock reuses the columns `equipment` already had — `pm_scheduling`,
`last_pm_date`, `next_generated_pm_date` — so there is one answer to "when is
this due" rather than two that drift apart. Vehicles carry the same column
names, which is why one service drives both.

## What happens on its own

`app/services/inspection_due.py`, run every half hour by the
`facilities_scheduler` worker (and by hand from *POST
/api/v1/inspection-programme/run-due*):

* when an item falls due, its maintenance is raised as a **service job, one per
  item**, carrying its PM task and assignee, in Equipment Maintenance;
* inspectors, admins and Super Admins are notified **7 days before** and **on
  the day**.

Both halves are idempotent: each item remembers the due date it has already had
a job raised for and been notified about, so a repeated run raises nothing
twice. A vehicle has no equipment record, so no service job is raised against
it; its work is recorded on the inspection.

## Red tags

Raised by choosing *Red tag* on an item, which requires a note. The item goes
Out of service, and it and its department show red on every screen until an
inspector, admin or Super Admin **clears it with a note saying what was done**.
Cleared tags keep their row, with who cleared them and when — the Red tags
screen is what an authority would be shown.

## Screens

| Screen | Path |
|---|---|
| Dashboard block: item counts per site, with a site picker | `/dashboard` |
| Site hub: the site's counts, then its departments, visits, fleet and red tags | `/sites/:id` |
| Departments, and items not in one | `/departments` |
| One department: forms, items, red tags, visits | `/departments/:id` |
| Visits | `/inspection-visits` |
| Filling in a visit (built for a phone) | `/inspection-visits/:id` |
| Fleet | `/fleet` |
| Red tags | `/red-tags` |
| Form builder (unchanged) | `/inspections` |

Facility, Equipment Maintenance and Compliance are reached from the site bar,
which is what "they live under the site" means. Equipment Maintenance keeps
Service, Maintenance Plans and Permits to Work; its old Inspection tab is gone,
because inspecting happens here.

## API

All under `/api/v1`, gated by the `inspections` module:

```
GET  inspection-programme/dashboard                   every site's numbers
GET  inspection-programme/sites/{id}/overview         one site
GET  inspection-programme/departments                 with counts
GET  inspection-programme/departments/{id}            forms, items, visits, tags
POST inspection-programme/departments/{id}/forms      attach a form
GET  inspection-programme/items                       ?unassigned= ?due_only=
PUT  inspection-programme/items/{id}/schedule         one item's clock
POST inspection-programme/items/bulk-assign           many at once
GET  inspection-programme/due                         what a visit would hold
POST inspection-programme/visits                      schedule one
POST inspection-programme/visits/{id}/items/{ins}     record one item
POST inspection-programme/visits/{id}/finish
GET  inspection-programme/red-tags                    ?include_cleared=
POST inspection-programme/red-tags/{id}/clear         note required
POST inspection-programme/run-due                     the timer, by hand
GET  fleet/vehicles · POST · PUT · DELETE             the fleet
POST fleet/forms                                      attach a fleet form
```

## Deploying it

Migration `d7f1a3b5c9e2` adds the department and the clock to `equipment`, the
size to `facilities`, the `vehicles`, `red_tags` and `inspection_form_links`
tables, and `RED_TAG` to the `inspectionresult` enum. Every step checks first,
so it is safe on a database built by migration or by `create_all`.

```bash
cd /opt/phealth
git pull
docker compose build backend frontend facilities_scheduler
docker compose run --rm backend python -c "import app.main; print('backend imports')"
docker compose run --rm backend alembic upgrade head
docker compose up -d backend frontend facilities_scheduler
```

Nothing is due until somebody sets it up, so after deploying: add the
departments, attach a form to each, then *Departments → Assign items* to put
existing equipment in a department and on a frequency.
