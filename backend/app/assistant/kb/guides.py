"""Written guides for screens the generated how-to documents cannot describe well.

The how-to extractor reads navigation and button labels out of the frontend
source. Facility, Inspections and Service are reached from a site bar and built
from lists, so the extractor sees little of them; these guides say, in the
words on the screen, how they are used.

Two words matter here and they are not interchangeable: an **inspection** is
the schedule that keeps equipment to standard, and **service** is the work
raised when something is at fault. Keep these guides in step with
pages/Categories, pages/Departments, pages/InspectionVisits, pages/Fleet,
pages/RedTags, pages/InspectionStatus, pages/Sites and pages/Service.
"""
from __future__ import annotations

from app.assistant.kb.documents import KBDocument

_SOURCE = "written guide: facility equipment, inspections and service"

_GUIDES: tuple[tuple[str, str, str, str], ...] = (
    (
        "guide.site_categories",
        "facility-inventory",
        "How to add equipment under Facility, with where it is, what it cost, and how often it is inspected",
        """Under Facility, every site files its equipment in categories: Electrical, Plumbing, Mechanical, HVAC, Building, Landscaping and Parking.

## Where to find it
Open the site from Sites. Four cards at the top count sites: Passed (something has passed and nothing is failing), Failed (any equipment failed or red-tagged), Overdue (anything past its date) and Passed all inspections (every item inspected and passed, nothing overdue). Clicking a card shows only those sites; clicking it again shows them all. Each site is one row with its status - Passed all, Passed, Failed or Not inspected yet - and its overdue and due counts. Click the row and it drops open into a card per department showing how many of its equipment passed out of the total, and how many failed, plus Not in a department and Fleet when they hold anything. Clicking a department card opens that department; Open site goes into the site. One row is open at a time, and searching down to a single site opens it. The bar under the page title shows the site's name, Inspections, Service, Facility and Compliance. Open Facility and choose a category. The site's own page also shows a tile for each category with how many items it has, their total book value and how many need attention. The Back arrow left of the page title returns to the previous screen.

## Add equipment
1. Open the category, for example Facility > Electrical.
2. Press Add equipment.
3. Fill in Name (for example Generator 1) and Type. Type offers a list for the category - Generator, Transformer, Main switchboard, Distribution board, UPS, Transfer switch, Lighting, Earthing for Electrical - and you can type your own.
4. Under Where is it?, fill in Building (required), Floor and Room / exact spot, for example Main block, Basement, Plant room 2 north wall. Places already used at the site are suggested as you type.
5. Set Quantity and Status: Working, Needs attention or Out of service. Make and Model are optional.
6. Under Cost & value, enter the Purchase cost (the Cost of one item when the quantity is more than one - the total is worked out), In service since, and Useful life. Useful life is filled in from the category.
7. The form shows the Book value today and how much it Depreciates a year as you type.
8. Under Inspections and PM, choose the Department that answers for it - Radiology, Theatre, Pharmacy - and how often it is inspected: Monthly, Quarterly, Every 6 months, Annually, or Custom with its own number of days. The frequency is filled in from the department, and First due is worked out from the frequency unless you give a date. Maintenance raised when it falls due and Assigned to are optional.
9. Press Add equipment. It is given the site's next asset tag automatically.

An item keeps its category and its department at the same time: a chiller is HVAC work and Radiology's problem. It shows in the category list, in its department, and in the Asset Register.

## How value and depreciation work
Book value is straight-line depreciation from the in-service date over the useful life, the same calculation as Assets & Value. With a cost of $45,000 and a 20-year life it depreciates $2,250 a year and is worth $38,250 after three years. Equipment without a cost or an in-service date shows no book value.
Routine service costs are maintenance spend: they do not change the book value. A service marked Major work that extends its life adds its cost to the value, which then depreciates over the remaining life. Cost of ownership is the purchase cost plus major work plus maintenance spend. When maintenance spend reaches 50% of the purchase cost, the equipment shows a warning to consider replacing it.

## Change or remove equipment
Click the row to open it, change anything and press Save. When editing, the form also shows Maintenance spend and Cost of ownership, and View asset & value history opens the same record in the Asset Register. Category can be changed to move equipment put in the wrong category. Remove deletes equipment entered by mistake; equipment that already has jobs cannot be removed - set its Status to Out of service instead.

## Find equipment
Each category list can be searched by name, type, tag or place, and filtered by Building, Floor and Status. The list shows where each item is, how many there are, its status, its Book value, when its next service is due and how many jobs are open on it.

## Assets already in the Asset Register
Equipment under Facility is the same record as in the Asset Register, which shows it by name, category and place. An older asset that is not in a category has an Add to a category button in the Asset Register: choose the category, give it a name and type, and say where it is. It keeps its tag, cost and history.""",
    ),
    (
        "guide.inspections",
        "inspections",
        "How inspections work: departments, forms, what is due, visits, red tags and the fleet",
        """An inspection is the schedule that keeps equipment up to standard. Every inspectable item - a piece of equipment in a department, or a vehicle in the fleet - carries one frequency, and from that comes the date it next falls due. There are no separate maintenance plans: the item is the schedule.

## Where to find it
Open the site, then Inspections in the bar under the page title, and choose Departments, Visits, Fleet or Red tags. Inspection forms are built under Inspections > Inspection forms. The dashboard shows, for every site, how many items have Passed, Failed, been Red tagged, are In progress, Due or Overdue; choosing a site opens it. Every one of those count cards can be clicked: it opens Inspection status, the list of exactly the items the card counts, with the site, department, last result and next due date of each. The chips at the top switch between Passed, Failed, Red tagged, In progress, Due and Overdue, and Site switches between one site and All sites. Clicking a row opens where it is dealt with - its open visit, its red tag, its department or the Fleet - and Inspect starts an inspection of it there and then. The same cards on a site's page, on Departments, on one department and on the Fleet open the same list narrowed to that place.

## Departments
Departments are the parts of a site: Radiology, Theatre, Pharmacy. Open Inspections > Departments to see each one with how many items it holds, how many are due or overdue, and how many are red-tagged. Press Add department to add one.
Items that nobody has put in a department are shown at the bottom with an Assign items button: tick many at once, choose the department, choose how often they are inspected and press Assign. This is how an existing site is set up without typing a frequency on every item.

## The forms a department is inspected on
Open a department and press Attach a form under Inspected on. Choose a form from the library and say how often it is normally done there - that is what prefills the frequency when equipment is added to the department. Nothing in a department can be inspected until at least one form is attached.

## What "due" means
- Passed moves the next date on by the item's frequency.
- Failed or Red tag makes it due again at once: the point of both is that somebody comes back.
- Due means within 30 days; Overdue means the date has gone by.
Nothing is created when an item falls due. The people who have to act - the person it is assigned to, admins and Super Admins - are notified seven days before and on the day, and the item turns up in the next visit.

## Schedule a visit
1. Open Inspections > Visits and press Schedule inspection, or press Schedule inspection on a department or on the Fleet.
2. Choose what is being inspected: One department, The whole site, or The fleet.
3. Choose the Date and the Inspector. Before anything is created the dialog says how many items would be due by that date, and names a few.
4. Press Schedule visit. The visit holds the items due by then; anything overdue stays in until it is done.

## Inspect one item now
Scheduling is for what falls due. To inspect one thing there and then, press Inspect it now - the tick-list icon on any equipment row under Facility, on any item in a department, or on any vehicle in the Fleet - or press New inspection on Inspections > Visits and choose the Category and the Equipment. The site's page has an Inspection card beside the Service card that does the same in one click.
It asks only for Inspect on (the form) and, if you want, a Date and an Inspector. The form is already chosen when the item is in a department that has one; an item that is in no department can still be inspected by choosing any form from the library. Press Start inspection and it opens straight away for filling in, whether or not it was due. Recording it moves the item's next date on exactly as a scheduled inspection does.

## Checklist forms
Some forms are a regulator's checklist, such as the Self-assessment Checklist for MCH Centers and Midwifery Services. During an inspection they open as the table on the paper: Indicator No. & Details, Compliance Requirements, and Yes, No or N/A for each requirement. The bar at the top counts what is met, not met and N/A.
Passed stays locked until every requirement is answered and none is unmet; Failed or Red tag can be recorded at any time. Requirements printed with OR on the paper, such as 2.1 and 2.2, are either-or: meeting one is enough. Use N/A for a requirement that does not apply, such as a ramp at a ground-floor centre.
Attach the checklist to a department under Inspected on, or choose it in Inspect on when you Inspect it now.

## Fill in a visit
The visit lists its items. Open one, answer the department's forms - each question is Pass, Fail or N/A, or a value to type - add Notes, then press Passed, Failed or Red tag. It is built for a phone.
A red tag needs a note saying what is wrong. Ticking Raise a service job for this creates one service job for the item, titled from your note and linked back to the inspection; leave it unticked if you have already fixed it. Press Finish visit when you are done - items nobody reached stay due and appear on the next visit.
Filling in a visit is for the inspector it was assigned to, admins and Super Admins.

## Red tags
A red tag means the standard is not met. The item goes Out of service and it and its department show red on every screen until somebody clears it. Open Inspections > Red tags, press Clear and say what was done: an inspector, an admin or a Super Admin can clear it, the note is required, and the record keeps who raised it and who cleared it. Cleared tags stay on the list under Including cleared, which is what an authority is shown.

## The fleet
Inspections > Fleet holds the site's vehicles: Name, Registration, Type, Make, Model, Driver, Odometer and Status. Attach a form to the fleet the same way as to a department, give each vehicle a frequency, and inspect them exactly like equipment. A vehicle has no service jobs of its own: what an inspection finds stays on the inspection and on the red tag list.""",
    ),
    (
        "guide.service",
        "service-requests",
        "How to raise and update service: the work done when something is at fault",
        """Service is the work raised because something is at fault or malfunctioning. It is not a schedule: what is scheduled lives in Inspections, and each item carries its own frequency.

## Where to find it
Open the site, then Service in the bar under the page title. The site's page shows how many service jobs are open and how many are overdue.

## Where a service job comes from
- **An inspection found it.** Recording Failed or Red tag on an item offers the inspector a tick, Raise a service job for this. Ticked, it creates one job titled from their note, and the job says From inspection with the inspection's number.
- **Somebody reported it.** Press New service and raise one by hand.

## Raise one by hand
1. Open Service and press New service.
2. Choose the Category, then the Equipment in it. Where the equipment is shows underneath.
3. Fill in What needs doing, the Due date and who it is Assigned to. The person assigned is notified.
4. Leave Status as Open, or set In progress or Done.
5. Press Raise service.

## Record what it cost
Under Cost, enter Labour and Parts; the Total is shown. The cost counts as maintenance spend once the job is Done and does not change the equipment's book value.
For a service that is a major overhaul or upgrade, tick Major work that extends its life. When the job is Done its cost is added to the equipment's value in the asset ledger and depreciated over the remaining life. Unticking it, reopening the job or changing the cost corrects the ledger by reversing the earlier entry. Only managers and admins can mark major work.

## Update a job
Click the job in the list. Change the Status between Open, In progress and Done, record Labour and Parts, add Notes, and press Save.
A technician can update the status, costs and notes of jobs assigned to them; changing what needs doing, the equipment, the due date, who it is assigned to or whether it is major work is for managers and admins.

## Find jobs
The chips at the top filter the list: All, Open, In progress, Done and Overdue, each with its count. A job is overdue when its due date has passed and it is not done. The list can also be searched and filtered by Category, and jobs marked Major work say so.

## Remove a job
A job raised by mistake can be removed from the job itself by an admin. A job that is Done cannot be removed: it is part of the equipment's record.""",
    ),
)


def guide_documents() -> list[KBDocument]:
    return [
        KBDocument(doc_id=doc_id, kind="howto", module=module, title=title, body=body.strip(), source=_SOURCE,
                   metadata={"module": module, "written": True})
        for doc_id, module, title, body in _GUIDES
    ]
