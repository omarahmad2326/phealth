"""Prove equipment cost, value and job costs behave as agreed.

Cost is entered for one item and the total follows the quantity. Book value is
the Assets & Value engine's, straight line from the in-service date over a life
seeded from the category. Service and inspection costs are maintenance spend
and leave book value alone; a service marked major work is an improvement in
the asset ledger, corrected by reversal. Spend at half the purchase cost says
consider replacing. Older assets join a category without retyping.

    DATABASE_URL=sqlite:// python backend/tests/test_equipment_value.py
"""
from __future__ import annotations

import ast
import os
import pathlib
import sys
from datetime import date, datetime
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.models  # noqa: E402,F401
from app.api.v1.endpoints import equipment_maintenance as jobs_api  # noqa: E402
from app.api.v1.endpoints import site_categories as api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.models.asset_ledger import AssetLedgerEntry  # noqa: E402
from app.models.equipment import Equipment  # noqa: E402
from app.models.facility import Facility  # noqa: E402
from app.models.maintenance_schedule import MaintenanceSchedule  # noqa: E402
from app.models.permit import WorkPermit  # noqa: E402
from app.models.user import User, UserRole, UserType  # noqa: E402
from app.models.user_facility import UserFacility  # noqa: E402
from app.schemas.equipment import Equipment as EquipmentSchema  # noqa: E402
from app.schemas.site_categories import (  # noqa: E402
    CategoryAdopt, CategoryEquipmentCreate, CategoryEquipmentUpdate, EquipmentJobCreate, EquipmentJobUpdate,
)
from app.services import asset_ledger, asset_register  # noqa: E402

engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
Session = sessionmaker(bind=engine)
TODAY = datetime.utcnow().date()  # the server's day: every "today" in the app is UTC
THREE_YEARS_AGO = date(TODAY.year - 3, TODAY.month, 1)


def build():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = Session()
    site = Facility(name="Medpro Regional", phone="1", email="m@x.c", address="1",
                    city="X", state="GA", zip_code="1", country="USA")
    db.add(site)
    db.flush()

    def person(username, role):
        u = User(username=username, email=f"{username}@x.c", full_name=username.title(), hashed_password="x",
                 user_type=UserType.EMPLOYEE, role=role, is_active=True,
                 facility_id=None if role == UserRole.SUPERADMIN else site.id)
        db.add(u)
        db.flush()
        if role != UserRole.SUPERADMIN:
            db.add(UserFacility(user_id=u.id, facility_id=site.id))
        return u

    people = {"boss": person("boss", UserRole.SUPERADMIN), "sam": person("sam", UserRole.TECHNICIAN),
              "manager": person("fm", UserRole.FACILITY_MANAGER)}
    db.commit()
    return db, site, people


def refused(call, status):
    try:
        call()
    except HTTPException as exc:
        assert exc.status_code == status, f"expected {status}, got {exc.status_code}: {exc.detail}"
        return exc.detail
    raise AssertionError(f"expected a {status} refusal")


def add(db, site, user, code="electrical", **fields):
    fields.setdefault("name", "Generator 1")
    fields.setdefault("type", "Generator")
    fields.setdefault("building", "Main block")
    return api.add_category_equipment(code, CategoryEquipmentCreate(facility_id=site.id, **fields),
                                      db=db, current_user=user)


def listed(db, site, user, code="electrical"):
    return {i["id"]: i for i in api.list_category_equipment(
        code, facility_id=site.id, search=None, building=None, floor=None, department=None, condition=None,
        db=db, current_user=user)["items"]}


def edit(db, user, item_id, **fields):
    return api.update_category_equipment(item_id, CategoryEquipmentUpdate(**fields), db=db, current_user=user)


def raise_job(db, site, user, equipment_id, kind="service", **fields):
    fields.setdefault("title", "Quarterly service")
    return jobs_api.create_job(EquipmentJobCreate(facility_id=site.id, kind=kind, equipment_id=equipment_id,
                                                  **fields), db=db, current_user=user)


def change_job(db, user, job_id, **fields):
    return jobs_api.update_job(job_id, EquipmentJobUpdate(**fields), db=db, current_user=user)


def test_cost_is_per_item_and_the_total_follows_the_quantity():
    db, site, people = build()
    lights = add(db, site, people["boss"], name="Ward A lights", type="Lighting", quantity=40,
                 unit_cost=Decimal("120"))
    assert (lights["unit_cost"], lights["purchase_cost"]) == (Decimal("120.00"), Decimal("4800.00"))
    assert db.get(Equipment, lights["id"]).cost == Decimal("4800.00"), "the total is what depreciates"

    more = edit(db, people["boss"], lights["id"], quantity=50)
    assert (more["unit_cost"], more["purchase_cost"]) == (Decimal("120.00"), Decimal("6000.00"))
    cheaper = edit(db, people["boss"], lights["id"], unit_cost=Decimal("99.50"))
    assert cheaper["purchase_cost"] == Decimal("4975.00")
    cleared = edit(db, people["boss"], lights["id"], unit_cost=None)
    assert cleared["purchase_cost"] is None and cleared["book_value"] is None
    refused(lambda: add(db, site, people["boss"], quantity=100000, unit_cost=Decimal("99999999")), 422)
    db.close()
    print("ok  cost is entered for one item; the total follows the quantity and is what depreciates")


def test_book_value_is_straight_line_over_a_life_seeded_from_the_category():
    db, site, people = build()
    generator = add(db, site, people["boss"], unit_cost=Decimal("45000"), in_service_on=THREE_YEARS_AGO)
    assert generator["useful_life_years"] == Decimal("20.00")
    assert (generator["book_value"], generator["annual_depreciation"]) == (Decimal("38250.00"), Decimal("2250.00"))
    assert generator["cost_of_ownership"] == Decimal("45000.00") and generator["value_message"] is None

    chiller = add(db, site, people["boss"], code="hvac", name="Chiller 1", type="Chiller")
    assert chiller["useful_life_years"] == Decimal("15.00") and chiller["book_value"] is None
    assert "cost" in chiller["value_message"]
    own_life = add(db, site, people["boss"], name="UPS", type="UPS", useful_life_years=Decimal("8"))
    assert own_life["useful_life_years"] == Decimal("8.00")

    # The value on the form before saving, and the category totals on the site page.
    preview = api.value_preview(unit_cost=Decimal("45000"), quantity=1, in_service_on=THREE_YEARS_AGO,
                                useful_life_years=Decimal("20"), equipment_id=None, db=db,
                                current_user=people["boss"])
    assert (preview["total_cost"], preview["book_value"], preview["annual_depreciation"]) == \
        (Decimal("45000.00"), Decimal("38250.00"), Decimal("2250.00"))
    undated = api.value_preview(unit_cost=Decimal("100"), quantity=2, in_service_on=None,
                                useful_life_years=Decimal("20"), equipment_id=None, db=db,
                                current_user=people["boss"])
    assert undated["book_value"] is None and "in-service" in undated["message"]
    tiles = {c["code"]: c for c in api.overview(facility_id=site.id, db=db, current_user=people["boss"])["categories"]}
    assert (tiles["electrical"]["book_value"], tiles["electrical"]["valued_equipment"]) == (Decimal("38250.00"), 1)
    assert tiles["hvac"]["book_value"] == Decimal("0")
    db.close()
    print("ok  $45,000 over 20 years is worth $38,250 after three; HVAC defaults to 15 years")


def test_job_costs_are_maintenance_spend_and_leave_book_value_alone():
    db, site, people = build()
    generator = add(db, site, people["boss"], unit_cost=Decimal("45000"), in_service_on=THREE_YEARS_AGO)
    job = raise_job(db, site, people["boss"], generator["id"], status="done",
                    labour_cost=Decimal("500"), parts_cost=Decimal("300"))
    assert (job["labour_cost"], job["parts_cost"], job["total_cost"]) == (Decimal("500"), Decimal("300"), Decimal("800"))
    # An open job's cost is not spend yet.
    raise_job(db, site, people["boss"], generator["id"], labour_cost=Decimal("999"))

    item = listed(db, site, people["boss"])[generator["id"]]
    assert item["book_value"] == Decimal("38250.00"), "a service does not change book value"
    assert (item["maintenance_spend"], item["cost_of_ownership"]) == (Decimal("800.00"), Decimal("45800.00"))
    assert item["spend_percent_of_cost"] == 1.8 and item["consider_replacing"] is False
    assert db.query(AssetLedgerEntry).count() == 0
    db.close()
    print("ok  labour and parts add up to maintenance spend; book value is unchanged")


def test_major_work_is_an_improvement_corrected_by_reversal():
    db, site, people = build()
    generator = add(db, site, people["boss"], unit_cost=Decimal("45000"), in_service_on=THREE_YEARS_AGO)
    raise_job(db, site, people["boss"], generator["id"], status="done", labour_cost=Decimal("800"))
    overhaul = raise_job(db, site, people["boss"], generator["id"], title="Engine overhaul", status="done",
                         labour_cost=Decimal("8000"), parts_cost=Decimal("4000"), is_major_work=True)

    [entry] = db.query(AssetLedgerEntry).all()
    assert (entry.entry_type, entry.amount, entry.work_order_id, entry.effective_date) == \
        ("improvement", Decimal("12000.00"), overhaul["id"], TODAY)
    item = listed(db, site, people["boss"])[generator["id"]]
    assert item["book_value"] == Decimal("50250.00"), item["book_value"]
    assert (item["improvements"], item["maintenance_spend"], item["cost_of_ownership"]) == \
        (Decimal("12000.00"), Decimal("800.00"), Decimal("57800.00"))
    ledger = asset_ledger.summary(db, db.get(Equipment, generator["id"]))
    assert ledger["service"]["total_service_cost"] == Decimal("800"), "the ledger does not count it twice"

    change_job(db, people["boss"], overhaul["id"], parts_cost=Decimal("5000"))
    entries = db.query(AssetLedgerEntry).order_by(AssetLedgerEntry.id).all()
    assert [(e.entry_type, e.amount, e.is_reversed) for e in entries] == [
        ("improvement", Decimal("12000.00"), True), ("reversal", Decimal("-12000.00"), False),
        ("improvement", Decimal("13000.00"), False)]

    change_job(db, people["boss"], overhaul["id"], is_major_work=False)
    item = listed(db, site, people["boss"])[generator["id"]]
    assert item["book_value"] == Decimal("38250.00") and item["improvements"] == Decimal("0.00")
    assert item["maintenance_spend"] == Decimal("13800.00"), "unticked, it is running cost again"

    change_job(db, people["boss"], overhaul["id"], is_major_work=True)
    change_job(db, people["boss"], overhaul["id"], status="in_progress")
    assert not db.query(AssetLedgerEntry).filter_by(entry_type="improvement", is_reversed=False).count(), \
        "reopened, it is not done, so not capitalised"

    refused(lambda: raise_job(db, site, people["boss"], generator["id"], kind="inspection",
                              is_major_work=True), 422)
    db.close()
    print("ok  major work adds to value, and a change or untick reverses it rather than editing it")


def test_technicians_record_job_costs_but_not_major_work():
    db, site, people = build()
    generator = add(db, site, people["boss"], unit_cost=Decimal("45000"), in_service_on=THREE_YEARS_AGO)
    mine = raise_job(db, site, people["boss"], generator["id"], assigned_to_id=people["sam"].id)
    costed = change_job(db, people["sam"], mine["id"], status="done", labour_cost=Decimal("250"),
                        parts_cost=Decimal("75"))
    assert costed["total_cost"] == Decimal("325")
    refused(lambda: change_job(db, people["sam"], mine["id"], is_major_work=True), 403)
    refused(lambda: raise_job(db, site, people["sam"], generator["id"], is_major_work=True), 403)
    db.close()
    print("ok  a technician enters labour and parts on their job; marking capital work is a manager's call")


def test_spend_at_half_the_purchase_cost_says_consider_replacing():
    db, site, people = build()
    pump = add(db, site, people["boss"], code="plumbing", name="Pump A", type="Water pump",
               unit_cost=Decimal("10000"), in_service_on=THREE_YEARS_AGO)
    raise_job(db, site, people["boss"], pump["id"], status="done", parts_cost=Decimal("4999"))
    assert listed(db, site, people["boss"], "plumbing")[pump["id"]]["consider_replacing"] is False
    raise_job(db, site, people["boss"], pump["id"], status="done", labour_cost=Decimal("1"))
    item = listed(db, site, people["boss"], "plumbing")[pump["id"]]
    assert (item["spend_percent_of_cost"], item["consider_replacing"]) == (50.0, True)
    db.close()
    print("ok  maintenance spend reaching 50% of the purchase cost raises consider replacing")


def test_an_older_asset_joins_a_category_keeping_its_tag_cost_and_history():
    db, site, people = build()
    old = Equipment(facility_id=site.id, asset_tag="AHU-2", make="Trane", model="M", serial_number="T1",
                    cost=Decimal("30000"), installation_date=THREE_YEARS_AGO)
    db.add(old)
    db.commit()
    assert listed(db, site, people["boss"], "hvac") == {}

    joined = api.adopt_into_category("hvac", old.id, CategoryAdopt(
        name="AHU-2 Theatres", type="Air handling unit", building="main block", floor="Roof",
        spot="Plant deck"), db=db, current_user=people["manager"])
    assert (joined["asset_tag"], joined["name"], joined["category"]) == ("AHU-2", "AHU-2 Theatres", "hvac")
    assert (joined["purchase_cost"], joined["useful_life_years"], joined["location_label"]) == \
        (Decimal("30000.00"), Decimal("15.00"), "main block · Roof · Plant deck")
    assert joined["book_value"] == Decimal("24000.00"), "30,000 over 15 years, three years in"
    assert list(listed(db, site, people["boss"], "hvac")) == [old.id]

    refused(lambda: api.adopt_into_category("hvac", old.id, CategoryAdopt(
        name="Again", type="AHU", building="X"), db=db, current_user=people["boss"]), 409)
    refused(lambda: api.adopt_into_category("hvac", old.id, CategoryAdopt(
        name="Again", type="AHU", building="X"), db=db, current_user=people["sam"]), 403)

    # And the register shows and finds it by its new name.
    shown = EquipmentSchema.model_validate(db.get(Equipment, old.id))
    assert (shown.name, shown.building, shown.equipment_type) == ("AHU-2 Theatres", "main block", "Air handling unit")
    found = asset_register.register_query(db, people["boss"], facility_id=site.id, search="theatres",
                                          location_id=None, kind=None, asset_type=None, discipline_id=None).all()
    assert [a.id for a in found] == [old.id]
    db.close()
    print("ok  an older asset joins a category with its tag and cost, and the register finds it by name")


def test_the_site_page_counts_plans_and_permits_in_equipment_maintenance():
    db, site, people = build()
    past, soon, later = date(TODAY.year - 1, 1, 1), TODAY, date(TODAY.year + 1, 1, 1)
    for name, due, status in (("Late", past, "active"), ("Soon", soon, "active"),
                              ("Later", later, "active"), ("Paused", past, "paused")):
        db.add(MaintenanceSchedule(facility_id=site.id, name=name, next_due_date=due, status=status))
    for number, status in (("P-1", "active"), ("P-2", "approved"), ("P-3", "pending_approval"), ("P-4", "closed")):
        db.add(WorkPermit(permit_number=number, facility_id=site.id, permit_type="hot_work", status=status,
                          title=number))
    db.commit()
    summary = jobs_api.summary(facility_id=site.id, db=db, current_user=people["boss"])
    assert summary["plans"] == {"active": 3, "overdue": 1, "due_in_30_days": 1}
    assert summary["permits"] == {"active": 2, "awaiting_approval": 1}
    db.close()
    print("ok  Equipment Maintenance counts overdue and upcoming plans and permits in force")


def test_the_asset_ledger_screen_opens_for_costed_equipment():
    from app.api.v1.endpoints import asset_ledger as ledger_api

    db, site, people = build()
    generator = add(db, site, people["boss"], unit_cost=Decimal("45000"), in_service_on=THREE_YEARS_AGO)
    overhaul = raise_job(db, site, people["boss"], generator["id"], title="Engine overhaul", status="done",
                         labour_cost=Decimal("8000"), parts_cost=Decimal("4000"), is_major_work=True)
    # Its depreciation schedule has rows; the response model must accept them on Pydantic 2.5.
    ledger = ledger_api.asset_ledger(generator["id"], db=db, as_of=None, limit=300, current_user=people["boss"])
    assert ledger.summary.depreciation.net_book_value == Decimal("50250.00")
    assert len(ledger.summary.depreciation.schedule) >= 20 and len(ledger.entries) == 1
    what_if = ledger_api.asset_depreciation(generator["id"], db=db, as_of=None, method=None,
                                            useful_life_years=None, current_user=people["boss"])
    assert what_if.schedule[0].year == THREE_YEARS_AGO.year

    change_job(db, people["boss"], overhaul["id"], is_major_work=False)
    ledger = ledger_api.asset_ledger(generator["id"], db=db, as_of=None, limit=300, current_user=people["boss"])
    assert ledger.summary.depreciation.net_book_value == Decimal("38250.00") and len(ledger.entries) == 2
    db.close()
    print("ok  the asset's value history opens, with major work and its reversal in the ledger")


def test_the_migration_adds_exactly_the_job_cost_columns():
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "x9c0d1e2f3a4_equipment_job_costs.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    upgrade = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade")
    added = {ast.literal_eval(node.args[1].args[0]) for node in ast.walk(upgrade)
             if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "add_column"}
    assert added == {"labour_cost", "parts_cost", "is_major_work"}, added
    assert added <= {c.name for c in Base.metadata.tables["service_requests"].columns}
    print("ok  the migration and the model agree on the job cost columns")


if __name__ == "__main__":
    tests = [v for k, v in globals().items() if k.startswith("test_")]
    for t in tests:
        t()
    print(f"\n{len(tests)} checks passed")
