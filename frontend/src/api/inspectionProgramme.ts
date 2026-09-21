/**
 * The inspection programme: the dashboard, departments, due items, visits and red tags.
 *
 * One idea underneath all of it: every inspectable item carries one frequency
 * and the date it next falls due. A visit is the items due by a date.
 */
import apiClient from './client'

export type Frequency = 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'custom'
export type Scope = 'department' | 'facility' | 'fleet'
export type Result = 'pass' | 'fail' | 'red_tag'
export type DueState = 'not_scheduled' | 'overdue' | 'due' | 'scheduled'
export type ItemKind = 'equipment' | 'vehicle'

export interface Counts {
  items: number
  passed: number
  failed: number
  red_tagged: number
  in_progress: number
  due: number
  overdue: number
  not_scheduled: number
}

/** How a site stands, on its items' latest results. None: nothing inspected. */
export type SiteStatus = 'passed_all' | 'passed' | 'failed'

/** Passed out of total in one department - or items in none, or the fleet. */
export interface BreakdownRow {
  kind: 'department' | 'unassigned' | 'fleet'
  id: number | null
  name: string
  items: number
  passed: number
  /** Includes the red-tagged: a red tag is a failure. */
  failed: number
  red_tagged: number
}

export interface DashboardSite extends Counts {
  facility_id: number
  name: string
  city?: string | null
  beds?: number | null
  area_sqft?: number | null
  size_band?: 'small' | 'medium' | 'large' | null
  departments: number
  vehicles: number
  status: SiteStatus | null
  status_label: string | null
  breakdown: BreakdownRow[]
}

export interface InspectionDashboard {
  totals: Counts
  sites: DashboardSite[]
  /** Sites, not items, and overlapping: Failed and Overdue can both hold a site. */
  site_totals: { sites: number; passed: number; failed: number; overdue: number; passed_all: number }
  as_of: string
  frequencies: Array<{ value: Frequency; label: string }>
  due_soon_days: number
}

export interface DepartmentRow {
  id: number | null
  name: string
  description?: string | null
  forms: number
  items: number
  due: number
  overdue: number
  passed: number
  failed: number
  red_tagged: number
  unscheduled: number
  last_inspected_on?: string | null
}

export interface ProgrammeItem {
  id: number
  kind: ItemKind
  name: string
  asset_tag?: string | null
  registration?: string | null
  type?: string | null
  where?: string | null
  make_model?: string | null
  driver_name?: string | null
  odometer?: number | null
  department_id?: number | null
  department?: string | null
  condition?: string
  red_tagged: boolean
  due_state: DueState
  frequency?: Frequency | null
  frequency_label: string
  interval_days?: number | null
  next_due_on?: string | null
  last_inspected_on?: string | null
  last_result?: Result | null
  last_result_label?: string | null
  pm_task?: string | null
  pm_assignee_id?: number | null
}

export interface FormLink {
  link_id: number
  form_id: number
  name: string
  description?: string | null
  default_frequency?: Frequency | null
  default_interval_days?: number | null
  archived?: boolean
  /** The built layout, sent only where the form is filled in. */
  schema?: unknown
}

export interface VisitItem {
  id: number
  number: string
  kind: ItemKind
  item_id: number
  name: string
  reference?: string | null
  where?: string | null
  department_id?: number | null
  department?: string | null
  status: string
  result?: Result | null
  result_label?: string | null
  answers: Array<{ form_id: number; name?: string; answers: Record<string, unknown> }>
  note?: string | null
  completed_at?: string | null
  forms: FormLink[]
  /** The service job this finding raised, when the inspector asked for one. */
  service?: { id: number; number: string; status: string } | null
  /** Where each checklist stood when the item was recorded. */
  checklists?: Array<{
    form_id: number; name: string; total: number; met: number
    not_met: string[]; not_applicable: number; unanswered: string[]; can_pass: boolean
  }>
}

export interface Visit {
  id: number
  number: string
  facility_id: number
  scope: Scope
  department_id?: number | null
  department?: string | null
  scheduled_on: string
  status: string
  inspector?: { id: number; name: string } | null
  items: number
  done: number
  result?: Result | null
  result_label?: string | null
  started_at?: string | null
  completed_at?: string | null
  notes?: string | null
  item_list?: VisitItem[]
  forms?: FormLink[]
}

export interface RedTag {
  id: number
  facility_id: number
  kind: ItemKind
  item_id: number
  name: string
  reference?: string | null
  where?: string | null
  department_id?: number | null
  department?: string | null
  note: string
  raised_by?: string | null
  raised_at: string
  cleared_by?: string | null
  cleared_at?: string | null
  clear_note?: string | null
  inspection_id?: number | null
}

export interface SiteOverview {
  site: {
    id: number; name: string; city?: string | null
    beds?: number | null; area_sqft?: number | null; size_band?: string | null
  }
  counts: Counts
  departments: DepartmentRow[]
  fleet: { vehicles: number; due: number }
  red_tags: number
  open_visits: number
}

export interface ScheduleIn {
  frequency?: Frequency | null
  interval_days?: number | null
  first_due_on?: string | null
  pm_task?: string | null
  pm_assignee_id?: number | null
  department_id?: number | null
}

const base = '/inspection-programme'

/** What each count card counts. */
export type InspectionState =
  'passed' | 'failed' | 'red_tagged' | 'in_progress' | 'due' | 'overdue' | 'not_scheduled'

/** One item behind a count card. */
export interface StatusRow extends ProgrammeItem {
  site_id: number
  site: string
  open_visit: { id: number; number: string } | null
  red_tag: { id: number; note: string; raised_at: string } | null
}

/** The items behind a card - exactly the number the card shows. */
export const fetchInspectionStatus = async (options: {
  state: InspectionState; facilityId?: number | null; departmentId?: number | null
  kind?: 'equipment' | 'vehicle' | null
}): Promise<{ state: InspectionState; label: string; total: number; items: StatusRow[] }> =>
  (await apiClient.get(`${base}/status`, {
    params: {
      state: options.state,
      ...(options.facilityId ? { facility_id: options.facilityId } : {}),
      ...(options.departmentId ? { department_id: options.departmentId } : {}),
      ...(options.kind ? { kind: options.kind } : {}),
    },
  })).data

/** Where a count card goes. */
export const statusPath = (state: InspectionState, scope: {
  site?: number | 'all' | null; department?: number | null; kind?: 'vehicle' | null
} = {}): string => {
  const params = new URLSearchParams({ state })
  if (scope.site) params.set('site', String(scope.site))
  if (scope.department) params.set('department', String(scope.department))
  if (scope.kind) params.set('kind', scope.kind)
  return `/inspection-status?${params.toString()}`
}

export const fetchInspectionDashboard = async (): Promise<InspectionDashboard> =>
  (await apiClient.get(`${base}/dashboard`)).data

export const fetchSiteOverview = async (facilityId: number): Promise<SiteOverview> =>
  (await apiClient.get(`${base}/sites/${facilityId}/overview`)).data

export const fetchProgrammeDepartments = async (
  facilityId: number,
): Promise<{ items: DepartmentRow[]; total: number }> =>
  (await apiClient.get(`${base}/departments`, { params: { facility_id: facilityId } })).data

export interface DepartmentDetail {
  department: { id: number; name: string; description?: string | null; facility_id: number }
  forms: FormLink[]
  items: ProgrammeItem[]
  visits: Visit[]
  red_tags: RedTag[]
}

export const fetchDepartmentDetail = async (id: number): Promise<DepartmentDetail> =>
  (await apiClient.get(`${base}/departments/${id}`)).data

export const attachDepartmentForm = async (
  departmentId: number,
  body: { form_id: number; default_frequency?: Frequency | null; default_interval_days?: number | null },
): Promise<FormLink> => (await apiClient.post(`${base}/departments/${departmentId}/forms`, body)).data

export const detachDepartmentForm = async (departmentId: number, linkId: number): Promise<void> => {
  await apiClient.delete(`${base}/departments/${departmentId}/forms/${linkId}`)
}

export const fetchFormLibrary = async (): Promise<{ items: Array<{ id: number; name: string; description?: string | null }> }> =>
  (await apiClient.get(`${base}/forms`)).data

export const fetchProgrammeItems = async (
  facilityId: number,
  options: { departmentId?: number | null; unassigned?: boolean; dueOnly?: boolean } = {},
): Promise<{ items: ProgrammeItem[]; total: number }> =>
  (await apiClient.get(`${base}/items`, {
    params: {
      facility_id: facilityId,
      ...(options.departmentId ? { department_id: options.departmentId } : {}),
      ...(options.unassigned ? { unassigned: true } : {}),
      ...(options.dueOnly ? { due_only: true } : {}),
    },
  })).data

export const setItemSchedule = async (equipmentId: number, body: ScheduleIn): Promise<ProgrammeItem> =>
  (await apiClient.put(`${base}/items/${equipmentId}/schedule`, body)).data

export const bulkAssignItems = async (
  body: ScheduleIn & { equipment_ids: number[] },
): Promise<{ updated: number }> => (await apiClient.post(`${base}/items/bulk-assign`, body)).data

export const fetchDuePreview = async (
  facilityId: number,
  options: { scope: Scope; departmentId?: number | null; by?: string },
): Promise<{ by: string; total: number; items: ProgrammeItem[] }> =>
  (await apiClient.get(`${base}/due`, {
    params: {
      facility_id: facilityId, scope: options.scope,
      ...(options.departmentId ? { department_id: options.departmentId } : {}),
      ...(options.by ? { by: options.by } : {}),
    },
  })).data

export const fetchInspectors = async (
  facilityId: number,
): Promise<Array<{ id: number; name: string; role: string }>> =>
  (await apiClient.get(`${base}/inspectors`, { params: { facility_id: facilityId } })).data

export const fetchVisits = async (
  facilityId: number,
  options: { status?: 'open' | 'done'; departmentId?: number | null } = {},
): Promise<{ items: Visit[]; total: number }> =>
  (await apiClient.get(`${base}/visits`, {
    params: {
      facility_id: facilityId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.departmentId ? { department_id: options.departmentId } : {}),
    },
  })).data

export const createVisit = async (body: {
  facility_id: number; scope: Scope; department_id?: number | null
  scheduled_on: string; inspector_id?: number | null
}): Promise<Visit> => (await apiClient.post(`${base}/visits`, body)).data

/** Inspect one item now, due or not: comes back as a visit of one. */
export const inspectNow = async (body: {
  facility_id: number; equipment_id?: number | null; vehicle_id?: number | null
  form_id?: number | null; scheduled_on?: string | null; inspector_id?: number | null
}): Promise<Visit> => (await apiClient.post(`${base}/inspections`, body)).data

export const fetchVisit = async (id: number): Promise<Visit> =>
  (await apiClient.get(`${base}/visits/${id}`)).data

export const recordVisitItem = async (
  visitId: number,
  inspectionId: number,
  body: {
    result: Result; answers?: Array<Record<string, unknown>>; note?: string | null
    /** Ask for the work: raises one service job, titled from the note. */
    raise_service?: boolean
  },
): Promise<{ item: VisitItem; visit: Visit; service?: { id: number; number: string } | null }> =>
  (await apiClient.post(`${base}/visits/${visitId}/items/${inspectionId}`, body)).data

export const finishVisit = async (id: number, notes?: string | null): Promise<Visit> =>
  (await apiClient.post(`${base}/visits/${id}/finish`, { notes: notes || null })).data

export const deleteVisit = async (id: number): Promise<void> => {
  await apiClient.delete(`${base}/visits/${id}`)
}

export const fetchRedTags = async (
  facilityId: number,
  includeCleared = false,
): Promise<{ items: RedTag[]; total: number }> =>
  (await apiClient.get(`${base}/red-tags`, {
    params: { facility_id: facilityId, include_cleared: includeCleared },
  })).data

export const clearRedTag = async (id: number, note: string): Promise<RedTag> =>
  (await apiClient.post(`${base}/red-tags/${id}/clear`, { note })).data

export const runDueNow = async (facilityId?: number): Promise<{ jobs_raised: number; notified: number }> =>
  (await apiClient.post(`${base}/run-due`, null, {
    params: facilityId ? { facility_id: facilityId } : {},
  })).data

/** How a due date reads on screen. */
export const DUE_STYLE: Record<DueState, { label: string; color: string; bg: string }> = {
  overdue: { label: 'Overdue', color: '#B91C1C', bg: '#FEE2E2' },
  due: { label: 'Due', color: '#92400E', bg: '#FEF3C7' },
  scheduled: { label: 'Scheduled', color: '#15803D', bg: '#F0FDF4' },
  not_scheduled: { label: 'No schedule', color: '#475569', bg: '#F1F5F9' },
}

export const RESULT_STYLE: Record<Result, { label: string; color: string; bg: string }> = {
  pass: { label: 'Passed', color: '#15803D', bg: '#F0FDF4' },
  fail: { label: 'Failed', color: '#B45309', bg: '#FEF3C7' },
  red_tag: { label: 'Red tag', color: '#B91C1C', bg: '#FEE2E2' },
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Every 6 months',
  annual: 'Annually',
  custom: 'Custom',
}

export const shortDate = (value?: string | null): string =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

/** A readable message from a failed request. */
export const errorMessage = (error: unknown, fallback: string): string => {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}
