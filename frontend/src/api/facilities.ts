import apiClient from './client'

export interface Facility {
  id: number
  name: string
  address: string
  city: string
  state: string
  zip_code: string
  country: string
  phone: string
  email: string
  timezone: string
  beds?: number | null
  area_sqft?: number | null
  size_band?: 'small' | 'medium' | 'large' | null
  operating_hours: string | null
  tier_id: number | null
  tier_ids?: number[]
  tiers?: {
    id: number
    tier_code: string
    name: string
    status: string
  }[]
  created_at: string
  updated_at: string

  // General Information
  contact_person: string | null
  suite: string | null
  website: string | null

  // Facility Details
  parent_facility_id: number | null
  status: string

  // Billing
  billing_name: string | null
  billing_email: string | null
  billing_street: string | null
  billing_suite: string | null
  billing_city: string | null
  billing_state: string | null
  billing_zip_code: string | null

  // Other Settings
  tax_exemption: boolean
  inheritance: string | null
  installment_type: string | null
  payment_method: string | null
  delivery_email: string | null

  assigned_users?: {
    id: number
    full_name: string
    username: string
    role: string
    avatar_url: string | null
  }[]
}

export interface FacilityBrief {
  id: number
  name: string
  city?: string
  state?: string
}

export interface FacilityCreate {
  name: string
  address: string
  city: string
  state: string
  zip_code: string
  country: string
  phone: string
  email: string
  timezone?: string
  operating_hours?: string
  tier_id?: number | null
  tier_ids?: number[]

  contact_person?: string
  suite?: string
  website?: string
  parent_facility_id?: number | null
  status?: string

  billing_name?: string
  billing_email?: string
  billing_street?: string
  billing_suite?: string
  billing_city?: string
  billing_state?: string
  billing_zip_code?: string

  tax_exemption?: boolean
  inheritance?: string
  installment_type?: string
  payment_method?: string
  delivery_email?: string
}

export interface FacilityUpdate extends Partial<FacilityCreate> {}

export interface FacilityListResponse {
  items: Facility[]
  total: number
  skip: number
  limit: number
}

export interface FacilityListParams {
  skip?: number
  limit?: number
  search?: string
  search_field?: string
  status?: string
  has_tier?: boolean
  country?: string
}

export interface FacilitySummary {
  total: number
  active: number
  tiered: number
  countries: Array<{ country: string; count: number }>
}

export interface FacilityDocument {
  id: number
  facility_id: number
  filename: string
  file_type: string | null
  file_size: number | null
  uploaded_at: string
}

export interface FacilityDocumentListResponse {
  items: FacilityDocument[]
  total: number
}

export type FacilityScopedExportScope =
  | 'facility_info'
  | 'facility_inventory'
  | 'facility_with_inventory'
  | 'children'
  | 'children_with_inventory'
  | 'parent'
  | 'parent_with_inventory'
  | 'family'
  | 'family_with_inventory'

export type FacilityScopedExportFormat = 'csv' | 'pdf'

// ─── Facilities CRUD ──────────────────────────────────────────

export const fetchFacilities = async (params: FacilityListParams = {}): Promise<FacilityListResponse> => {
  const res = await apiClient.get('/facilities/', { params })
  return res.data
}

export const fetchFacilitySummary = async (): Promise<FacilitySummary> => {
  const res = await apiClient.get('/facilities/summary')
  return res.data
}

export const fetchFacility = async (id: number): Promise<Facility> => {
  const res = await apiClient.get(`/facilities/${id}`)
  return res.data
}

export const createFacility = async (data: FacilityCreate, autoUniqueName = false): Promise<Facility> => {
  const res = await apiClient.post('/facilities/', data, {
    params: autoUniqueName ? { auto_unique_name: true } : undefined,
  })
  return res.data
}

export const updateFacility = async (id: number, data: FacilityUpdate): Promise<Facility> => {
  const res = await apiClient.put(`/facilities/${id}`, data)
  return res.data
}

export const deleteFacility = async (id: number): Promise<Facility> => {
  const res = await apiClient.delete(`/facilities/${id}`)
  return res.data
}

// ─── Search (for parent/child autocomplete) ───────────────────

export const searchFacilities = async (q: string, excludeId?: number): Promise<FacilityBrief[]> => {
  const params: Record<string, any> = { q }
  if (excludeId) params.exclude_id = excludeId
  const res = await apiClient.get('/facilities/search', { params })
  return res.data
}

// ─── Documents ────────────────────────────────────────────────

export const fetchFacilityDocuments = async (facilityId: number): Promise<FacilityDocumentListResponse> => {
  const res = await apiClient.get(`/facilities/${facilityId}/documents`)
  return res.data
}

export const uploadFacilityDocument = async (facilityId: number, file: File): Promise<FacilityDocument> => {
  const formData = new FormData()
  formData.append('file', file)
  const res = await apiClient.post(`/facilities/${facilityId}/documents`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export const downloadFacilityDocument = async (
  facilityId: number,
  document: FacilityDocument,
): Promise<void> => {
  const res = await apiClient.get(
    `/facilities/${facilityId}/documents/${document.id}/download`,
    { responseType: 'blob' },
  )
  const objectUrl = URL.createObjectURL(res.data)
  const anchor = window.document.createElement('a')
  anchor.href = objectUrl
  anchor.download = document.filename
  window.document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
}

export const deleteFacilityDocument = async (facilityId: number, docId: number): Promise<void> => {
  await apiClient.delete(`/facilities/${facilityId}/documents/${docId}`)
}

// ─── PDF Export ───────────────────────────────────────────────

export const exportFacilityPdf = async (facilityId: number): Promise<void> => {
  const res = await apiClient.get(`/facilities/${facilityId}/export-pdf`, {
    responseType: 'blob',
  })
  const blob = new Blob([res.data], { type: 'application/pdf' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `facility_${facilityId}.pdf`
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  a.remove()
}

export const exportFacilitiesCsv = async (): Promise<void> => {
  const res = await apiClient.get('/facilities/export-csv', { responseType: 'blob' })
  const blob = new Blob([res.data], { type: 'text/csv' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'facilities.csv'
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  a.remove()
}

export const exportScopedFacility = async (
  facilityId: number,
  scope: FacilityScopedExportScope,
  format: FacilityScopedExportFormat,
  fallbackName = 'facility_export',
): Promise<void> => {
  const res = await apiClient.get(`/facilities/${facilityId}/export-scoped`, {
    params: { scope, format },
    responseType: 'blob',
  })
  const contentType = format === 'pdf' ? 'application/pdf' : 'text/csv'
  const blob = new Blob([res.data], { type: res.headers?.['content-type'] || contentType })
  const disposition = res.headers?.['content-disposition'] || ''
  const match = disposition.match(/filename="?([^"]+)"?/)
  const filename = match?.[1] || `${fallbackName}.${format}`
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  a.remove()
}

export interface SiteOverview {
  facility_id: number
  estate: {
    buildings: number; floors: number; rooms: number
    beds: number; spaces_total: number
  }
  spaces: { unavailable: number; by_state: Record<string, number> }
  work: { open: number; by_priority: Record<string, number>; critical: number; high: number }
  compliance: { overdue: number; due_within_30_days: number }
  permits: { active: number }
  assets: { total: number }
  fixtures: { total: number; faulty: number }
  inspections?: {
    failed: number
    open: number
    passed: number
    status: 'pass' | 'sealed' | 'under_review'
  }
}

/** Everything one site's dashboard opens on, in a single request. */
export const fetchSiteOverview = async (id: number): Promise<SiteOverview> => {
  const res = await apiClient.get(`/facilities/${id}/overview`)
  return res.data
}
