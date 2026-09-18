/** A site's vehicles, inspected on the same clock as its equipment. */
import apiClient from './client'
import type { FormLink, Frequency, ProgrammeItem, RedTag, VisitItem } from './inspectionProgramme'

export interface FleetCounts {
  vehicles: number
  due: number
  overdue: number
  red_tagged: number
  passed: number
  failed: number
}

export interface VehicleIn {
  facility_id?: number
  name: string
  registration?: string | null
  vehicle_type?: string | null
  make?: string | null
  model?: string | null
  year?: number | null
  driver_name?: string | null
  odometer?: number | null
  condition?: 'working' | 'needs_attention' | 'out_of_service'
  notes?: string | null
  frequency?: Frequency | null
  interval_days?: number | null
  first_due_on?: string | null
  pm_task?: string | null
  pm_assignee_id?: number | null
}

export const fetchVehicles = async (
  facilityId: number,
  options: { search?: string; dueOnly?: boolean } = {},
): Promise<{ items: ProgrammeItem[]; total: number; forms: FormLink[]; counts: FleetCounts; as_of: string }> =>
  (await apiClient.get('/fleet/vehicles', {
    params: {
      facility_id: facilityId,
      ...(options.search ? { search: options.search } : {}),
      ...(options.dueOnly ? { due_only: true } : {}),
    },
  })).data

export const fetchVehicle = async (
  id: number,
): Promise<{ vehicle: ProgrammeItem; inspections: VisitItem[]; red_tags: RedTag[] }> =>
  (await apiClient.get(`/fleet/vehicles/${id}`)).data

export const addVehicle = async (body: VehicleIn & { facility_id: number }): Promise<ProgrammeItem> =>
  (await apiClient.post('/fleet/vehicles', body)).data

export const updateVehicle = async (id: number, body: VehicleIn): Promise<ProgrammeItem> =>
  (await apiClient.put(`/fleet/vehicles/${id}`, body)).data

export const deleteVehicle = async (id: number): Promise<void> => {
  await apiClient.delete(`/fleet/vehicles/${id}`)
}

export const attachFleetForm = async (
  facilityId: number,
  body: { form_id: number; default_frequency?: Frequency | null; default_interval_days?: number | null },
): Promise<FormLink> =>
  (await apiClient.post('/fleet/forms', body, { params: { facility_id: facilityId } })).data

export const detachFleetForm = async (linkId: number): Promise<void> => {
  await apiClient.delete(`/fleet/forms/${linkId}`)
}
