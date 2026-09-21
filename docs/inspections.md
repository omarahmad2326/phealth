# Inspections and Service

Two words, one meaning each:

* **Inspection** — the schedule that keeps equipment to standard. Recurring,
  has a form, produces a result and the evidence an authority reads.
* **Service** — the work raised because something is at fault or
  malfunctioning, either found by an inspection or reported by a person. It
  has an assignee, labour and parts, and it ends Done.

Everything below hangs off one idea: **every inspectable item carries one
frequency, and from it the date it next falls due.** There is no second
schedule anywhere in the product.

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
| **Inspect now** | A visit of one, on any item, due or not. The other way in, matching how a service is raised on one piece of equipment. |
| **Red tag** | A failure serious enough to say the standard is not met. It outlives the inspection. |
| **Service job** | Corrective work. Raised from a failed inspection when the inspector asks for it, or by hand for a reported fault. Carries the assignee and the cost. |

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
/api/v1/inspection-programme/run-due*), **notifies and creates nothing**:
inspectors, admins and Super Admins are told **7 days before** and **on the
day**. A due item shows as due on its department, on the dashboard and in the
next visit, and that is the whole record.

It is idempotent: each item remembers the due date it has already been
notified about, so a repeated run does not tell anybody twice.

## Service: the work an inspection asks for

Recording **Failed** or **Red tag** offers the inspector a tick — *Raise a
service job for this*. Ticked, it creates **one** job, titled from their note,
assigned to whoever the item is assigned to, and linked back to the inspection
(`service_requests.inspection_id`), so the Service list says *From inspection
INS-000008*. Left unticked — because they fixed it on the spot — the failure is
recorded and nothing is left open for somebody else to close. Recording the
same item again never raises a second job.

A fault nobody inspected is raised by hand on Service, as before.

A vehicle has no equipment record for a job to hang on, so fleet findings stay
on the inspection and on the red tag list. If the fleet needs its own work
queue, that is a small addition, not a redesign.

## Inspecting one item now

Scheduling covers the programme: a department, a date, whatever is due. The
other thing people do is stand in front of something and want it inspected, so
**Inspect it now** is on every equipment row in Facility, on every item in a
department, on every vehicle in the fleet, and as **New inspection** on the
Visits screen.

It asks for as little as it can — the item and a form — and it does not care
whether the item is due, or whether it is in a department yet:

* the form defaults to the item's department's first form, so the usual case is
  one press;
* an item in no department can still be inspected: choose any form from the
  library;
* it opens straight away as a visit of one, ready to fill in;
* recording it moves the item's clock exactly as a scheduled inspection does.

## Checklist forms

Some forms are a regulator's table rather than a drawn layout: indicators, each
with numbered compliance requirements. These are stored as data
(`app/services/checklist.py`, `"source": "phealth_checklist"`) and open during
an inspection as the table they are on paper — indicator, requirement, and
**Yes / No / N/A** for each.

* A checklist decides whether the inspection can pass: **every requirement
  answered, none unmet**. Passed stays locked on screen until then, and the
  server refuses a pass the checklist does not allow. Failed and Red tag can be
  recorded at any point — one unmet requirement is reason enough.
* Pairs printed with **OR** on the paper are either-or: meeting one meets both,
  so a No on the clause that does not apply cannot fail the inspection.
* **N/A** is for requirements that do not apply here — the ramp on a ground
  floor, the photograph that is optional for female staff.
* Where the checklist stood — met, not met, N/A, unanswered — is kept on the
  inspection.

The first is the **Self-assessment Checklist for MCH Centers and Midwifery
Services** (indicators 01–07, 26 requirements), added by migration
`f2b4d6e8a0c1`. Attach it to a department like any other form, or choose it
with *Inspect it now*. It is not opened in the canvas builder, which would read
it as an empty layout and overwrite it on save.

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
| Inspection status: the items behind any count card | `/inspection-status?state=&site=&department=&kind=` |
| Service: faults and malfunctions, assigned and costed | `/service` |
| Site hub: the site's counts, then its departments, visits, fleet and red tags | `/sites/:id` |
| Departments, and items not in one | `/departments` |
| One department: forms, items, red tags, visits | `/departments/:id` |
| Visits | `/inspection-visits` |
| Filling in a visit (built for a phone) | `/inspection-visits/:id` |
| Fleet | `/fleet` |
| Red tags | `/red-tags` |
| Form builder (unchanged) | `/inspections` |

The site bar reads: **Site · Inspections ▾ · Service · Facility ▾ ·
Compliance ▾** (compliance and permits to work), which is what "they live under
the site" means. Two things that were the same idea in two places are gone:

* **Equipment Maintenance** as a wrapper, and its Inspection tab — inspecting
  happens in Inspections, and its Service list is now the Service tab.
* **Maintenance Plans** — every active plan on category equipment was folded
  onto its item's clock by migration `e8a2b4c6d0f3` and then retired. Plans on
  assets that are not in the inspection programme are left alone and still
  generate work, because for them the plan is the only clock they have.

### Count cards open their list

Every count card - Passed, Failed, Red tagged, In progress, Due, Overdue - on
the dashboard, a site's page, Departments, one department and the Fleet opens
**Inspection status** filtered to that card and that place. The number on the
card and the length of the list come from one function on the server
(`classify_items`), so they cannot disagree; a test compares them for every
state, per site, across sites, per department and for the fleet.

An item's last result counts once (red tag, then failed, then passed). Due,
overdue and in progress are separate questions, so one item can be Failed,
Overdue and In progress at the same time. A row opens where it is dealt with:
its open visit, its red tag, its department or the Fleet; **Inspect** starts an
inspection of it on the spot.

The site's page has an **Inspection** card beside **Service** in its Service
section: it shows how much is due or overdue and opens New inspection
straight away (`/inspection-visits?new=1`).

## API

All under `/api/v1`, gated by the `inspections` module:

```
GET  inspection-programme/dashboard                   every site's numbers
GET  inspection-programme/sites/{id}/overview         one site
GET  inspection-programme/status                      the items behind a card:
                                                      ?state= ?facility_id= ?department_id= ?kind=
GET  inspection-programme/departments                 with counts
GET  inspection-programme/departments/{id}            forms, items, visits, tags
POST inspection-programme/departments/{id}/forms      attach a form
GET  inspection-programme/items                       ?unassigned= ?due_only=
PUT  inspection-programme/items/{id}/schedule         one item's clock
POST inspection-programme/items/bulk-assign           many at once
GET  inspection-programme/due                         what a visit would hold
POST inspection-programme/visits                      schedule one
POST inspection-programme/inspections                 inspect one item now
POST inspection-programme/visits/{id}/items/{ins}     record one item
                                                      (raise_service: the tick)
POST inspection-programme/visits/{id}/finish
GET  inspection-programme/red-tags                    ?include_cleared=
POST inspection-programme/red-tags/{id}/clear         note required
POST inspection-programme/run-due                     the timer, by hand
GET  fleet/vehicles · POST · PUT · DELETE             the fleet
POST fleet/forms                                      attach a fleet form
```

## Deploying it

Two migrations. `d7f1a3b5c9e2` adds the department and the clock to
`equipment`, the size to `facilities`, the `vehicles`, `red_tags` and
`inspection_form_links` tables, and `RED_TAG` to the `inspectionresult` enum.
`e8a2b4c6d0f3` adds `service_requests.inspection_id` and folds the maintenance
plans into the item clocks. Every step checks first, so both are safe on a
database built by migration or by `create_all`; the fold is a data step, so
its downgrade leaves the clocks in place rather than putting the duplicate
back.

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
existing equipment in a department and on a frequency. Anything that had a
maintenance plan already arrives with its frequency and next date filled in.
