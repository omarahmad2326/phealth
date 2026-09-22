from collections.abc import Iterable

from fastapi import HTTPException, status
from sqlalchemy.orm import Query, Session

from app.models.user import User, UserRole
from app.models.user_facility import UserFacility
from app.models.facility import Facility


# Roles that see only the hospitals they are assigned to.
#
# Technicians were left out originally, back when the product served one
# company maintaining client sites and the engineers covered all of them. In a
# hospital group a technician belongs to a hospital, and one at Hospital A has
# no business reading Hospital B's work orders.
#
# The consequence is worth stating plainly: a technician with no row in
# user_facilities and no users.facility_id now sees nothing at all, including
# an empty site list. Existing accounts must be assigned before this takes
# effect for them.
FACILITY_SCOPED_ROLES = {
    UserRole.FACILITY_ADMIN,
    UserRole.FACILITY_MANAGER,
    UserRole.TECHNICIAN,
    UserRole.CLIENT,
}


def is_facility_scoped_user(user: User) -> bool:
    return user.role in FACILITY_SCOPED_ROLES


def get_user_facility_ids(db: Session, user: User) -> set[int]:
    """Return facility ids a scoped user can access.

    Facility admins/managers assigned to a parent facility inherit access to
    its direct child facilities. Users assigned to a child facility do not
    inherit access upward to the parent or sideways to sibling facilities.
    """
    facility_ids = {
        facility_id
        for (facility_id,) in db.query(UserFacility.facility_id)
        .filter(UserFacility.user_id == user.id)
        .all()
        if facility_id is not None
    }
    if user.facility_id is not None:
        facility_ids.add(user.facility_id)

    if user.role in {UserRole.FACILITY_ADMIN, UserRole.FACILITY_MANAGER} and facility_ids:
        child_ids = {
            child_id
            for (child_id,) in db.query(Facility.id)
            .filter(Facility.parent_facility_id.in_(facility_ids))
            .all()
            if child_id is not None
        }
        facility_ids.update(child_ids)

    if facility_ids:
        # A deleted site gives nobody access, whoever was assigned to it.
        facility_ids = {
            facility_id
            for (facility_id,) in db.query(Facility.id)
            .filter(Facility.id.in_(facility_ids), Facility.live())
            .all()
        }

    return facility_ids


def require_facility_access(db: Session, user: User, facility_id: int | None) -> None:
    if not is_facility_scoped_user(user):
        return
    if facility_id is None or facility_id not in get_user_facility_ids(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this facility",
        )


def scope_query_to_user_facilities(
    query: Query,
    facility_column,
    db: Session,
    user: User,
) -> Query:
    if not is_facility_scoped_user(user):
        return query
    return query.filter(facility_column.in_(get_user_facility_ids(db, user)))


def restrict_facility_ids(db: Session, user: User, facility_ids: Iterable[int]) -> set[int]:
    requested = set(facility_ids)
    if not is_facility_scoped_user(user):
        return requested
    return requested & get_user_facility_ids(db, user)
