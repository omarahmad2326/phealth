"""Deleting a site: it leaves every list, and nothing made at it is lost.

Run with:
    DATABASE_URL=sqlite:// python backend/tests/test_delete_site.py
"""
from __future__ import annotations

import os
import re
import sys
from datetime import datetime

os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.models  # noqa: E402,F401
from app import schemas  # noqa: E402
from app.api.v1.endpoints import facilities as api  # noqa: E402
from app.api.v1.endpoints import inspection_programme as programme_api  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.models.department import Department  # noqa: E402
from app.models.equipment import Equipment  # noqa: E402
from app.models.facility import Facility  # noqa: E402
from app.models.user import User, UserRole, UserType  # noqa: E402
from app.models.user_facility import UserFacility  # noqa: E402
from app.utils.facility_access import get_user_facility_ids  # noqa: E402

engine = create_engine("sqlite://")
Session = sessionmaker(bind=engine)


# Site names are tidied with Postgres's regexp_replace and btrim; SQLite has
# neither, so the test database is given ones that behave the same.
@event.listens_for(engine, "connect")
def _postgres_functions(connection, _record):
    connection.create_function("regexp_replace", 4, lambda text, pattern, repl, flags: re.sub(
        pattern, repl, text or "", count=0 if "g" in (flags or "") else 1))
    connection.create_function("btrim", 1, lambda text: (text or "").strip())


TODAY = datetime.utcnow().strftime("%d %b %Y").lstrip("0")


def build():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = Session()

    def site(name, parent=None):
        f = Facility(name=name, phone="(214) 555-0100", email=f"{name[:3].lower()}@x.c", address="1",
                     city="Lahore", state="Punjab", zip_code="54000", country="Pakistan",
                     parent_facility_id=parent.id if parent else None)
        db.add(f)
        db.flush()
        return f

    services, mayo = site("Services Hospital"), site("Mayo Hospital")

    def person(username, role, facility=None):
        u = User(username=username, email=f"{username}@x.c", full_name=username.title(),
                 hashed_password="x", user_type=UserType.EMPLOYEE, role=role, is_active=True,
                 facility_id=facility.id if facility else None)
        db.add(u)
        db.flush()
        if facility:
            db.add(UserFacility(user_id=u.id, facility_id=facility.id))
        return u

    people = {
        "super": person("boss", UserRole.SUPERADMIN),
        "admin": person("ayesha", UserRole.ADMIN),
        "site_admin": person("bilal", UserRole.FACILITY_ADMIN, services),
        "tech": person("sam", UserRole.TECHNICIAN, services),
    }
    ward = Department(name="Emergency", facility_id=services.id)
    db.add(ward)
    db.flush()
    db.add(Equipment(asset_tag="SH-GEN-1", make="Cummins", model="C500", serial_number="C500-1",
                     name="Generator 1",
                     equipment_type="Generator", facility_id=services.id,
                     department_id=ward.id))
    db.commit()
    return db, services, mayo, people


def refused(call, status):
    try:
        call()
    except HTTPException as exc:
        assert exc.status_code == status, f"expected {status}, got {exc.status_code}: {exc.detail}"
        return exc.detail
    raise AssertionError(f"expected a {status} refusal")


# Endpoint functions called directly: every Query() parameter is passed.
def listed(db, user):
    page = api.read_facilities(db=db, skip=0, limit=100, search=None, search_field=None, status=None,
                               has_tier=None, country=None, current_user=user)
    return sorted(item["name"] if isinstance(item, dict) else item.name for item in page["items"])


def delete(db, user, site_id):
    return api.delete_facility(db=db, id=site_id, current_user=user)


def register(db, user, name):
    return api.create_facility(
        db=db, auto_unique_name=False, current_user=user,
        facility_in=schemas.FacilityCreate(name=name, phone="(214) 555-0100", email="new@x.c", address="1",
                                           city="Lahore", state="Punjab", zip_code="54000", country="Pakistan"))


def field(row, key):
    return row[key] if isinstance(row, dict) else getattr(row, key)


def test_only_super_admins_and_admins_can_delete_a_site():
    db, services, _, people = build()
    refused(lambda: delete(db, people["site_admin"], services.id), 403)
    refused(lambda: delete(db, people["tech"], services.id), 403)
    assert db.get(Facility, services.id).status == "active"
    deleted = delete(db, people["admin"], services.id)
    assert field(deleted, "status") == Facility.DELETED
    print("ok  only a Super Admin or an Admin can delete a site")


def test_a_deleted_site_leaves_every_list_but_keeps_its_records():
    db, services, mayo, people = build()
    boss = people["super"]
    assert listed(db, boss) == ["Mayo Hospital", "Services Hospital"]
    delete(db, boss, services.id)

    assert listed(db, boss) == ["Mayo Hospital"]
    assert api.read_facility_summary(db=db, current_user=boss)["total"] == 1
    assert [f.name for f in programme_api._visible_sites(db, boss)] == ["Mayo Hospital"]
    refused(lambda: api.read_facility(db=db, id=services.id, current_user=boss), 404)
    refused(lambda: delete(db, boss, services.id), 404)
    refused(lambda: api.update_facility(db=db, id=services.id, current_user=boss,
                                        facility_in=schemas.FacilityUpdate(city="Multan")), 404)

    # Nothing made at it is removed.
    assert db.query(Equipment).filter(Equipment.facility_id == services.id).count() == 1
    assert db.query(Department).filter(Department.facility_id == services.id).count() == 1
    kept = db.get(Facility, services.id)
    assert kept.name == f"Services Hospital (deleted {TODAY})", kept.name
    print("ok  a deleted site leaves the lists, and its equipment and departments are kept")


def test_people_assigned_only_to_it_lose_access():
    db, services, _, people = build()
    assert get_user_facility_ids(db, people["tech"]) == {services.id}
    delete(db, people["super"], services.id)
    assert get_user_facility_ids(db, people["tech"]) == set()
    assert listed(db, people["tech"]) == []
    print("ok  someone assigned only to a deleted site sees no site")


def test_the_same_hospital_can_be_registered_again():
    db, services, _, people = build()
    boss = people["super"]
    delete(db, boss, services.id)
    again = register(db, boss, "Services Hospital")
    assert field(again, "name") == "Services Hospital"
    delete(db, boss, field(again, "id"))
    assert db.get(Facility, field(again, "id")).name == f"Services Hospital (deleted {TODAY}, 2)"
    assert listed(db, boss) == ["Mayo Hospital"]
    print("ok  deleting frees the name, even twice in a day")


def test_a_site_with_sites_under_it_is_not_deleted():
    db, services, mayo, people = build()
    boss = people["super"]
    wing = Facility(name="Mayo Children's Wing", phone="1", email="w@x.c", address="1", city="Lahore",
                    state="Punjab", zip_code="54000", country="Pakistan", parent_facility_id=mayo.id)
    db.add(wing)
    db.commit()
    detail = refused(lambda: delete(db, boss, mayo.id), 400)
    assert "Mayo Children's Wing" in detail, detail
    delete(db, boss, wing.id)
    delete(db, boss, mayo.id)
    assert listed(db, boss) == ["Services Hospital"]
    print("ok  a site with sites under it waits until they are gone")


def test_a_site_is_not_deleted_by_editing_its_status():
    db, services, _, people = build()
    boss = people["super"]
    refused(lambda: api.update_facility(db=db, id=services.id, current_user=boss,
                                        facility_in=schemas.FacilityUpdate(status="deleted")), 400)
    assert db.get(Facility, services.id).status == "active"
    print("ok  only Delete site deletes a site")


if __name__ == "__main__":
    tests = [v for k, v in globals().items() if k.startswith("test_")]
    for t in tests:
        t()
    print(f"\n{len(tests)} checks passed")
