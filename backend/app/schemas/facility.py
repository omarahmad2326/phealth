from typing import Literal, Optional, List
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


class FacilityBase(BaseModel):
    name: str
    address: str
    city: str
    state: str
    zip_code: str
    country: str
    phone: str
    email: str
    timezone: Optional[str] = "America/Chicago"
    operating_hours: Optional[str] = None
    tier_id: Optional[int] = None
    tier_ids: Optional[List[int]] = None

    # How big the site is, for the inspection dashboard.
    beds: Optional[int] = Field(None, ge=0, le=100000)
    area_sqft: Optional[int] = Field(None, ge=0, le=100000000)
    size_band: Optional[Literal["small", "medium", "large"]] = None

    # General Information
    contact_person: Optional[str] = None
    suite: Optional[str] = None
    website: Optional[str] = None

    # Facility Details
    parent_facility_id: Optional[int] = None
    status: Optional[str] = "active"

    # Billing
    billing_name: Optional[str] = None
    billing_email: Optional[str] = None
    billing_street: Optional[str] = None
    billing_suite: Optional[str] = None
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_zip_code: Optional[str] = None

    # Other Settings
    tax_exemption: Optional[bool] = False
    inheritance: Optional[str] = None
    installment_type: Optional[str] = None
    payment_method: Optional[str] = None
    delivery_email: Optional[str] = None


class FacilityCreate(FacilityBase):
    pass


class FacilityUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    country: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    timezone: Optional[str] = None
    operating_hours: Optional[str] = None
    tier_id: Optional[int] = None
    tier_ids: Optional[List[int]] = None
    beds: Optional[int] = Field(None, ge=0, le=100000)
    area_sqft: Optional[int] = Field(None, ge=0, le=100000000)
    size_band: Optional[Literal["small", "medium", "large"]] = None

    contact_person: Optional[str] = None
    suite: Optional[str] = None
    website: Optional[str] = None
    parent_facility_id: Optional[int] = None
    status: Optional[str] = None

    billing_name: Optional[str] = None
    billing_email: Optional[str] = None
    billing_street: Optional[str] = None
    billing_suite: Optional[str] = None
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_zip_code: Optional[str] = None

    tax_exemption: Optional[bool] = None
    inheritance: Optional[str] = None
    installment_type: Optional[str] = None
    payment_method: Optional[str] = None
    delivery_email: Optional[str] = None


class FacilityBrief(BaseModel):
    """Lightweight response for search/autocomplete."""
    id: int
    name: str
    city: Optional[str] = None
    state: Optional[str] = None

    class Config:
        from_attributes = True


class FacilityUserBrief(BaseModel):
    id: int
    full_name: str
    username: str
    role: str
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class FacilityTierBrief(BaseModel):
    id: int
    tier_code: str
    name: str
    status: str

    class Config:
        from_attributes = True


class FacilityInDBBase(FacilityBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class Facility(FacilityInDBBase):
    assigned_users: Optional[List[FacilityUserBrief]] = None
    tiers: Optional[List[FacilityTierBrief]] = None


class FacilityListResponse(BaseModel):
    items: List[Facility]
    total: int
    skip: int
    limit: int


class FacilityCountrySummary(BaseModel):
    country: str
    count: int


class FacilitySummaryResponse(BaseModel):
    total: int
    active: int
    tiered: int
    countries: List[FacilityCountrySummary]
