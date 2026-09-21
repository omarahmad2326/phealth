/**
 * The seven categories and two kinds of maintenance job, as navigation knows
 * them. Names and counts come from the server; this is only what a menu needs
 * before any data has loaded.
 */
import ElectricBoltIcon from '@mui/icons-material/ElectricBolt'
import PlumbingIcon from '@mui/icons-material/Plumbing'
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing'
import AcUnitIcon from '@mui/icons-material/AcUnit'
import ApartmentIcon from '@mui/icons-material/Apartment'
import YardIcon from '@mui/icons-material/Yard'
import LocalParkingIcon from '@mui/icons-material/LocalParking'
import HomeRepairServiceIcon from '@mui/icons-material/HomeRepairService'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import EventRepeatIcon from '@mui/icons-material/EventRepeat'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import type { CategoryCode, Condition, JobKind } from '@/api/siteCategories'
import type { Module } from '@/config/permissions'

/** What the categories are called wherever they appear together. */
export const CATEGORIES_LABEL = 'Facility'

export interface CategoryMeta {
  code: CategoryCode
  name: string
  colour: string
  icon: JSX.Element
  path: string
}

export const CATEGORIES: CategoryMeta[] = [
  { code: 'electrical', name: 'Electrical', colour: '#D97706', icon: <ElectricBoltIcon />, path: '/categories/electrical' },
  { code: 'plumbing', name: 'Plumbing', colour: '#2563EB', icon: <PlumbingIcon />, path: '/categories/plumbing' },
  { code: 'mechanical', name: 'Mechanical', colour: '#0369A1', icon: <PrecisionManufacturingIcon />, path: '/categories/mechanical' },
  { code: 'hvac', name: 'HVAC', colour: '#0F766E', icon: <AcUnitIcon />, path: '/categories/hvac' },
  { code: 'building', name: 'Building', colour: '#7C3AED', icon: <ApartmentIcon />, path: '/categories/building' },
  { code: 'landscaping', name: 'Landscaping', colour: '#16A34A', icon: <YardIcon />, path: '/categories/landscaping' },
  { code: 'parking', name: 'Parking', colour: '#6366F1', icon: <LocalParkingIcon />, path: '/categories/parking' },
]

export const CATEGORY_BY_CODE = Object.fromEntries(CATEGORIES.map((c) => [c.code, c])) as Record<CategoryCode, CategoryMeta>

export interface JobKindMeta {
  kind: JobKind
  name: string
  singular: string
  icon: JSX.Element
  path: string
}

// Inspecting moved to the inspection programme - departments, forms, visits
// and red tags - so Equipment Maintenance keeps only the work it raises.
export const JOB_KINDS: JobKindMeta[] = [
  { kind: 'service', name: 'Service', singular: 'service', icon: <HomeRepairServiceIcon />, path: '/service' },
]

export interface MaintenanceLink {
  name: string
  description: string
  icon: JSX.Element
  path: string
  /** Who can open it. */
  module: Module
}

/**
 * Service: the work raised when something is at fault or malfunctioning,
 * either by an inspection that found it or by somebody reporting it. What is
 * scheduled lives in Inspections, and each item carries its own frequency, so
 * there is no second recurring list here.
 */
export const SERVICE_LINK: MaintenanceLink = {
  name: 'Service', description: 'Faults and malfunctions, assigned and costed',
  icon: <HomeRepairServiceIcon />, path: '/service', module: 'service-requests',
}

/** Regulatory work, which answers to somebody outside the hospital. */
export const COMPLIANCE_LINKS: MaintenanceLink[] = [
  { name: 'Compliance', description: 'Regulatory schedules and certificates', icon: <FactCheckIcon />,
    path: '/compliance', module: 'compliance' },
  { name: 'Permits to Work', description: 'ICRA, ILSM, hot work, and shutdowns', icon: <VerifiedUserIcon />,
    path: '/permits', module: 'permits' },
]

export const CONDITION_STYLE: Record<Condition, { label: string; color: string; bg: string }> = {
  working: { label: 'Working', color: '#15803D', bg: '#F0FDF4' },
  needs_attention: { label: 'Needs attention', color: '#92400E', bg: '#FEF3C7' },
  out_of_service: { label: 'Out of service', color: '#B91C1C', bg: '#FEE2E2' },
}
