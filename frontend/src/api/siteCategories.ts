/**
 * A site's equipment under Electrical, Plumbing, Mechanical and HVAC, and the
 * service and inspection jobs done on it.
 */
import apiClient from './client'
import type { DueState, Frequency, Result as ProgrammeResult } from './inspectionProgramme'

export type CategoryCode = 'electrical' | 'plumbing' | 'mechanical' | 'hvac' | 'building' | 'landscaping' | 'parking'
export type Condition = 'working' | 'needs_attention' | 'out_of_service'
export type JobKind = 'service' | 'inspection'
export type JobStatus = 'open' | 'in_progress' | 'done'
export type JobStatusFilter = JobStatus | 'overdue' | ''
export type InspectionResult = 'pass' | 'fail'

export interface CategorySummary {
  code: CategoryCode
  name: string
  colour: string
  description: string
  types: string[]
  equipment: number
  needs_attention: number
  out_of_service: number
  open_jobs: number
  overdue_jobs: number
  /** Total book value of the equipment that has a cost and an in-service date. */
  book_value: string | number
  valued_equipment: number
}

/** Money arrives as a decimal string; null when there is nothing to show. */
export type Amount = string | number | null

export interface CategoryEquipment {
  id: number
  asset_tag: string
  category: CategoryCode
  category_name: string
  name: string
  type: string | null
  building: string | null
  floor: string | null
  spot: string | null
  location_label: string
  quantity: number
  condition: Condition
  condition_label: string
  make: string | null
  model: string | null
  notes: string | null
  open_jobs: number
  next_service_on: string | null
  unit_cost: Amount
  purchase_cost: Amount
  in_service_on: string | null
  useful_life_years: Amount
  book_value: Amount
  annual_depreciation: Amount
  improvements: Amount
  maintenance_spend: Amount
  cost_of_ownership: Amount
  spend_percent_of_cost: number | null
  consider_replacing: boolean
  value_message: string | null

  // How it is inspected. See api/inspections.ts for the programme itself.
  department_id: number | null
  department: string | null
  red_tagged: boolean
  due_state: DueState
  frequency: Frequency | null
  frequency_label: string
  interval_days: number | null
  next_due_on: string | null
  last_inspected_on: string | null
  last_result: ProgrammeResult | null
  last_result_label: string | null
  pm_task: string | null
  pm_assignee_id: number | null
}

export interface ValuePreview {
  total_cost: Amount
  book_value: Amount
  annual_depreciation: Amount
  message: string | null
}

export interface CategoryEquipmentInput {
  name: string
  type: string
  /** No longer asked for: equipment is placed by its department. Kept for what has it. */
  building?: string | null
  floor?: string | null
  spot?: string | null
  quantity: number
  condition: Condition
  make: string | null
  model: string | null
  notes: string | null
  unit_cost: number | null
  in_service_on: string | null
  useful_life_years: number | null
  department_id?: number | null
  frequency?: Frequency | null
  interval_days?: number | null
  first_due_on?: string | null
  pm_task?: string | null
  pm_assignee_id?: number | null
}

export interface PlaceSuggestions {
  buildings: string[]
  floors: string[]
  spots: string[]
}

export interface EquipmentJob {
  id: number
  number: string
  kind: JobKind
  title: string
  status: JobStatus | 'cancelled'
  status_label: string
  due_on: string | null
  overdue: boolean
  assigned_to: { id: number; name: string } | null
  notes: string | null
  inspection_result: InspectionResult | null
  findings: string | null
  labour_cost: Amount
  parts_cost: Amount
  total_cost: Amount
  is_major_work: boolean
  /** The inspection that found this fault, when one did. */
  from_inspection: { id: number; number: string; visit_id: number | null } | null
  created_at: string
  completed_at: string | null
  equipment: {
    id: number
    name: string
    asset_tag: string
    type: string | null
    category: CategoryCode | null
    category_name: string | null
    location_label: string
  } | null
}

export interface JobCounts {
  open: number
  in_progress: number
  done: number
  overdue: number
}

export interface JobInput {
  equipment_id: number
  title: string
  due_on: string | null
  assigned_to_id: number | null
  status: JobStatus
  notes: string | null
  inspection_result: InspectionResult | null
  findings: string | null
  labour_cost: number | null
  parts_cost: number | null
  is_major_work?: boolean
}

export interface Assignee {
  id: number
  name: string
  role: string
}

export interface MaintenanceSummary {
  service: { open: number; overdue: number; failed: number }
  inspection: { open: number; overdue: number; failed: number }
  /** Only for people who can open Maintenance Plans. */
  plans?: { active: number; overdue: number; due_in_30_days: number }
  /** Only for people who can open Permits to Work. */
  permits?: { active: number; awaiting_approval: number }
}

export const fetchCategoryOverview = async (facilityId: number): Promise<{ categories: CategorySummary[] }> => {
  const res = await apiClient.get('/site-categories/overview', { params: { facility_id: facilityId } })
  return res.data
}

export const fetchCategoryEquipment = async (
  code: CategoryCode,
  facilityId: number,
  /** department: a department's id, or 'none' for items in no department. */
  filters: { search?: string; building?: string; floor?: string; department?: string; condition?: string } = {},
): Promise<{
  category: { code: CategoryCode; name: string; types: string[]; default_useful_life_years: number }
  items: CategoryEquipment[]
  total: number
  /** The site's departments, for the Department picker on the form. */
  departments: Array<{ id: number; name: string }>
}> => {
  const params: Record<string, string | number> = { facility_id: facilityId }
  Object.entries(filters).forEach(([key, value]) => { if (value) params[key] = value })
  const res = await apiClient.get(`/site-categories/${code}/equipment`, { params })
  return res.data
}

export const fetchPlaceSuggestions = async (facilityId: number): Promise<PlaceSuggestions> => {
  const res = await apiClient.get('/site-categories/suggestions', { params: { facility_id: facilityId } })
  return res.data
}

export const addCategoryEquipment = async (
  code: CategoryCode, facilityId: number, payload: CategoryEquipmentInput,
): Promise<CategoryEquipment> => {
  const res = await apiClient.post(`/site-categories/${code}/equipment`, { facility_id: facilityId, ...payload })
  return res.data
}

export const updateCategoryEquipment = async (
  id: number, payload: Partial<CategoryEquipmentInput> & { category?: CategoryCode },
): Promise<CategoryEquipment> => {
  const res = await apiClient.put(`/site-categories/equipment/${id}`, payload)
  return res.data
}

export const deleteCategoryEquipment = async (id: number): Promise<void> => {
  await apiClient.delete(`/site-categories/equipment/${id}`)
}

/** Total cost, book value today and yearly depreciation for figures not yet saved. */
export const fetchValuePreview = async (params: {
  unit_cost: number | null
  quantity: number
  in_service_on: string | null
  useful_life_years: number | null
  equipment_id?: number | null
}): Promise<ValuePreview> => {
  const query: Record<string, string | number> = { quantity: params.quantity }
  if (params.unit_cost != null) query.unit_cost = params.unit_cost
  if (params.in_service_on) query.in_service_on = params.in_service_on
  if (params.useful_life_years != null) query.useful_life_years = params.useful_life_years
  if (params.equipment_id) query.equipment_id = params.equipment_id
  const res = await apiClient.get('/site-categories/value-preview', { params: query })
  return res.data
}

/** Bring an asset from the register into a category, keeping its tag, cost and history. */
export const adoptIntoCategory = async (
  code: CategoryCode, equipmentId: number,
  payload: { name: string; type: string; department_id: number | null },
): Promise<CategoryEquipment> => {
  const res = await apiClient.post(`/site-categories/${code}/adopt/${equipmentId}`, payload)
  return res.data
}

/** $45,000 — whole dollars, the way the rest of the asset screens show money. */
export function formatMoney(value: Amount | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export const fetchEquipmentJobs = async (
  facilityId: number,
  kind: JobKind,
  filters: { status?: JobStatusFilter; category?: string; search?: string } = {},
): Promise<{ items: EquipmentJob[]; total: number; counts: JobCounts }> => {
  const params: Record<string, string | number> = { facility_id: facilityId, kind }
  Object.entries(filters).forEach(([key, value]) => { if (value) params[key] = value })
  const res = await apiClient.get('/equipment-maintenance/jobs', { params })
  return res.data
}

export const fetchMaintenanceSummary = async (facilityId: number): Promise<MaintenanceSummary> => {
  const res = await apiClient.get('/equipment-maintenance/summary', { params: { facility_id: facilityId } })
  return res.data
}

export const fetchAssignees = async (facilityId: number): Promise<Assignee[]> => {
  const res = await apiClient.get('/equipment-maintenance/assignees', { params: { facility_id: facilityId } })
  return res.data
}

export const createEquipmentJob = async (
  facilityId: number, kind: JobKind, payload: JobInput,
): Promise<EquipmentJob> => {
  const res = await apiClient.post('/equipment-maintenance/jobs', { facility_id: facilityId, kind, ...payload })
  return res.data
}

export const updateEquipmentJob = async (id: number, payload: Partial<JobInput>): Promise<EquipmentJob> => {
  const res = await apiClient.patch(`/equipment-maintenance/jobs/${id}`, payload)
  return res.data
}

export const deleteEquipmentJob = async (id: number): Promise<void> => {
  await apiClient.delete(`/equipment-maintenance/jobs/${id}`)
}

/** The server's message when it has one, otherwise the fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  const detail = (error as any)?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '')
  return fallback
}
