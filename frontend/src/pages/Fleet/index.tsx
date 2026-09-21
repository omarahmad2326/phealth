/**
 * The site's fleet: its vehicles, when each is next due, and the forms they
 * are inspected on.
 *
 * A vehicle carries the same clock as equipment, so this screen reads like a
 * department's items — registration and driver in place of a building and a
 * floor.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  InputAdornment, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import {
  addVehicle, attachFleetForm, deleteVehicle, detachFleetForm, fetchVehicles, updateVehicle,
} from '@/api/fleet'
import {
  errorMessage, fetchFormLibrary, fetchInspectors, shortDate,
  type Frequency, type ProgrammeItem,
} from '@/api/inspectionProgramme'
import { hasPermission } from '@/config/permissions'
import { useActiveFacility } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'
import { CountTile, DueChip, FrequencyFields, ResultChip } from '@/pages/Inspections/programme/parts'
import InspectNowDialog, { type InspectTarget } from '@/pages/Inspections/programme/InspectNowDialog'
import ScheduleVisitDialog from '@/pages/Inspections/programme/ScheduleVisitDialog'

const CONDITIONS = [
  { value: 'working', label: 'Working' },
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'out_of_service', label: 'Out of service' },
] as const

export default function FleetPage() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const { facilityId, facility } = useActiveFacility()
  const canAdd = hasPermission(user, 'inspections', 'add')
  const canEdit = hasPermission(user, 'inspections', 'edit')

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [editing, setEditing] = useState<ProgrammeItem | 'new' | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [inspecting, setInspecting] = useState<InspectTarget | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const list = useQuery({
    queryKey: ['fleet-vehicles', facilityId, debounced],
    queryFn: () => fetchVehicles(facilityId as number, { search: debounced }),
    enabled: !!facilityId,
    placeholderData: (previous) => previous,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['fleet-vehicles'] })
    void queryClient.invalidateQueries({ queryKey: ['inspection-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['site-overview'] })
  }

  const detach = useMutation({ mutationFn: detachFleetForm, onSuccess: refresh })
  const vehicles = list.data?.items ?? []
  const counts = list.data?.counts
  const forms = list.data?.forms ?? []

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }}
             sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5, mb: 2.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
          <Box sx={{ width: 48, height: 48, borderRadius: '15px', display: 'grid', placeItems: 'center',
                     color: '#0369A1', bgcolor: '#0369A114', '& svg': { fontSize: 26 } }}>
            <LocalShippingOutlinedIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
                              color: palette.textSubtle }}>
              Inspections
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, color: palette.ink, lineHeight: 1.15 }}>Fleet</Typography>
            <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>
              {facility?.name ?? 'This site'} · {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1}>
          {canAdd && forms.length > 0 && (
            <Button variant="outlined" startIcon={<EventAvailableOutlinedIcon />} onClick={() => setScheduling(true)}
                    sx={{ fontWeight: 900, borderRadius: '12px' }}>
              Schedule inspection
            </Button>
          )}
          {canAdd && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}
                    sx={{ fontWeight: 900, borderRadius: '12px', px: 2.5, bgcolor: palette.brand,
                          '&:hover': { bgcolor: palette.brandDeep } }}>
              Add vehicle
            </Button>
          )}
        </Stack>
      </Stack>

      {counts && (
        <Stack direction="row" spacing={1.2} sx={{ mb: 2, flexWrap: 'wrap', gap: 1.2 }}>
          <CountTile label="Vehicles" value={counts.vehicles} />
          <CountTile label="Due" value={counts.due} tone={{ color: '#92400E', bg: '#FEF3C7' }} />
          <CountTile label="Overdue" value={counts.overdue} tone={{ color: '#B91C1C', bg: '#FEE2E2' }} />
          <CountTile label="Passed" value={counts.passed} tone={{ color: '#15803D', bg: '#F0FDF4' }} />
          <CountTile label="Red tagged" value={counts.red_tagged} tone={{ color: '#B91C1C', bg: '#FEE2E2' }} />
        </Stack>
      )}

      <Box sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '18px', bgcolor: palette.white,
                 overflow: 'hidden', mb: 2 }}>
        <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.2, gap: 1 }}>
          <Typography sx={{ flex: 1, fontSize: 12, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
                            color: palette.textSubtle }}>
            Inspected on
          </Typography>
          {canAdd && (
            <Button size="small" startIcon={<AddIcon />} onClick={() => setAttaching(true)} sx={{ fontWeight: 900 }}>
              Attach a form
            </Button>
          )}
        </Stack>
        {!forms.length && (
          <Typography sx={{ px: 2, pb: 1.6, fontSize: 13, fontWeight: 700, color: palette.danger }}>
            No form is attached to the fleet, so its vehicles cannot be inspected yet.
          </Typography>
        )}
        {forms.map((form) => (
          <Stack key={form.link_id} direction="row" alignItems="center" spacing={1}
                 sx={{ px: 2, py: 1.1, borderTop: `1px solid ${palette.borderSoft}` }}>
            <Typography sx={{ flex: 1, fontWeight: 900, fontSize: 13.5, color: palette.ink }}>{form.name}</Typography>
            {form.default_frequency && (
              <Chip size="small" label={`Normally ${form.default_frequency.replace('_', ' ')}`}
                    sx={{ height: 22, fontSize: 11, fontWeight: 800, bgcolor: palette.surfaceMuted,
                          color: palette.textMuted }} />
            )}
            {hasPermission(user, 'inspections', 'delete') && (
              <Tooltip title="Stop using this form here">
                <IconButton size="small" aria-label={`Remove ${form.name}`} onClick={() => detach.mutate(form.link_id)}>
                  <DeleteOutlineIcon sx={{ fontSize: 17, color: palette.textFaint }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        ))}
      </Box>

      <Box sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '18px', bgcolor: palette.white,
                 overflow: 'hidden' }}>
        <Box sx={{ p: 1.5 }}>
          <TextField
            size="small" fullWidth placeholder="Search name, registration, type or driver…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: (
              <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: palette.textFaint }} /></InputAdornment>
            ) }}
          />
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '1.8fr 1.2fr 1fr 1.3fr 1fr 84px',
                   px: 2, py: 1, gap: 1.2, bgcolor: palette.surfaceMuted }}>
          {['Vehicle', 'Registration', 'Every', 'Next due', 'Last result', ''].map((head) => (
            <Typography key={head} sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.4,
                                         textTransform: 'uppercase', color: palette.textSubtle }}>{head}</Typography>
          ))}
        </Box>
        {list.isLoading && <Box sx={{ p: 4, display: 'grid', placeItems: 'center' }}><CircularProgress size={22} /></Box>}
        {!list.isLoading && !vehicles.length && (
          <Typography sx={{ p: 4, textAlign: 'center', fontWeight: 700, color: palette.textMuted }}>
            No vehicles yet. Add the ambulances, vans and trucks this site runs.
          </Typography>
        )}
        {vehicles.map((vehicle) => (
          <Box key={vehicle.id}
               onClick={() => canEdit && setEditing(vehicle)}
               sx={{ display: 'grid', gap: 1.2, alignItems: 'center', cursor: canEdit ? 'pointer' : 'default',
                     gridTemplateColumns: { xs: '1fr auto', md: '1.8fr 1.2fr 1fr 1.3fr 1fr 84px' },
                     px: 2, py: 1.4, borderTop: `1px solid ${palette.borderSoft}`,
                     '&:hover': canEdit ? { bgcolor: palette.brandTint } : undefined }}>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 900, fontSize: 14, color: palette.ink }}>{vehicle.name}</Typography>
                {vehicle.red_tagged && <Chip size="small" label="RED TAG"
                      sx={{ height: 19, fontSize: 10, fontWeight: 900, color: '#fff', bgcolor: palette.danger }} />}
              </Stack>
              <Typography noWrap sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 600 }}>
                {[vehicle.type, vehicle.make_model, vehicle.driver_name].filter(Boolean).join(' · ') || '—'}
              </Typography>
            </Box>
            <Typography noWrap sx={{ display: { xs: 'none', md: 'block' }, fontSize: 13, fontWeight: 800,
                                     color: palette.textStrong }}>
              {vehicle.registration ?? '—'}
            </Typography>
            <Typography noWrap sx={{ display: { xs: 'none', md: 'block' }, fontSize: 12.5, fontWeight: 800,
                                     color: palette.textStrong }}>
              {vehicle.frequency_label}
            </Typography>
            <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}>
              <DueChip state={vehicle.due_state} on={vehicle.next_due_on} />
            </Box>
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
              <ResultChip result={vehicle.last_result} />
            </Box>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ justifySelf: 'end' }}>
              <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: 12, color: palette.textFaint,
                                fontWeight: 700 }}>
                {vehicle.odometer ? `${vehicle.odometer.toLocaleString()} km` : ''}
              </Typography>
              {canAdd && (
                <Tooltip title="Inspect it now">
                  <IconButton size="small" aria-label={`Inspect ${vehicle.name} now`}
                              onClick={(e) => { e.stopPropagation(); setInspecting({
                                kind: 'vehicle', id: vehicle.id, name: vehicle.name }) }}>
                    <PlaylistAddCheckIcon sx={{ fontSize: 19, color: palette.brand }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Box>
        ))}
      </Box>

      {editing && facilityId && (
        <VehicleDialog
          facilityId={facilityId}
          vehicle={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
      {attaching && facilityId && (
        <AttachFleetFormDialog facilityId={facilityId} onClose={() => setAttaching(false)}
                               onSaved={() => { setAttaching(false); refresh() }} />
      )}
      {scheduling && facilityId && (
        <ScheduleVisitDialog facilityId={facilityId} scope="fleet" onClose={() => setScheduling(false)} />
      )}
      {inspecting && facilityId && (
        <InspectNowDialog facilityId={facilityId} target={inspecting} onClose={() => setInspecting(null)} />
      )}
    </Box>
  )
}

function VehicleDialog({ facilityId, vehicle, onClose, onSaved }: {
  facilityId: number; vehicle: ProgrammeItem | null; onClose: () => void; onSaved: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const [form, setForm] = useState({
    name: vehicle?.name ?? '',
    registration: vehicle?.registration ?? '',
    vehicle_type: vehicle?.type ?? '',
    make: '',
    model: '',
    driver_name: vehicle?.driver_name ?? '',
    odometer: vehicle?.odometer ? String(vehicle.odometer) : '',
    condition: (vehicle?.condition ?? 'working') as 'working' | 'needs_attention' | 'out_of_service',
    pm_task: vehicle?.pm_task ?? '',
  })
  const [frequency, setFrequency] = useState<Frequency | ''>(vehicle?.frequency ?? '')
  const [intervalDays, setIntervalDays] = useState(vehicle?.interval_days ? String(vehicle.interval_days) : '')
  const [firstDue, setFirstDue] = useState(vehicle?.next_due_on ?? '')
  const [assignee, setAssignee] = useState<number | ''>(vehicle?.pm_assignee_id ?? '')
  const [problem, setProblem] = useState('')
  const people = useQuery({ queryKey: ['inspectors', facilityId], queryFn: () => fetchInspectors(facilityId) })
  const canDelete = hasPermission(user, 'inspections', 'delete') && vehicle

  const body = () => ({
    name: form.name.trim(),
    registration: form.registration.trim() || null,
    vehicle_type: form.vehicle_type.trim() || null,
    make: form.make.trim() || null,
    model: form.model.trim() || null,
    driver_name: form.driver_name.trim() || null,
    odometer: form.odometer ? Number(form.odometer) : null,
    condition: form.condition,
    pm_task: form.pm_task.trim() || null,
    pm_assignee_id: assignee === '' ? null : Number(assignee),
    frequency: frequency || null,
    interval_days: frequency === 'custom' && intervalDays ? Number(intervalDays) : null,
    first_due_on: firstDue || null,
  })

  const save = useMutation({
    mutationFn: async () => vehicle
      ? updateVehicle(vehicle.id, body())
      : addVehicle({ facility_id: facilityId, ...body() }),
    onSuccess: onSaved,
    onError: (error) => setProblem(errorMessage(error, 'That vehicle could not be saved.')),
  })
  const remove = useMutation({
    mutationFn: async () => deleteVehicle(vehicle!.id),
    onSuccess: onSaved,
    onError: (error) => setProblem(errorMessage(error, 'That vehicle could not be removed.')),
  })

  const field = (key: keyof typeof form, label: string, extra: object = {}) => (
    <TextField size="small" label={label} value={form[key]} InputLabelProps={{ shrink: true }}
               onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))} {...extra} />
  )

  return (
    <Dialog open onClose={onClose} fullWidth PaperProps={{ sx: { borderRadius: '18px', maxWidth: 640 } }}>
      <DialogTitle sx={{ fontWeight: 900 }}>{vehicle ? vehicle.name : 'Add a vehicle'}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.6} sx={{ mt: 0.5 }}>
          <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            {field('name', 'Name')}
            {field('registration', 'Registration')}
            {field('vehicle_type', 'Type', { placeholder: 'Ambulance' })}
            {field('driver_name', 'Driver')}
            {field('make', 'Make')}
            {field('model', 'Model')}
            {field('odometer', 'Odometer', { type: 'number' })}
            <TextField select size="small" label="Status" value={form.condition}
                       onChange={(e) => setForm((prev) => ({ ...prev, condition: e.target.value as typeof prev.condition }))}
                       InputLabelProps={{ shrink: true }}>
              {CONDITIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </TextField>
          </Box>

          <Typography sx={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.4, textTransform: 'uppercase',
                            color: palette.textSubtle, pt: 0.5 }}>
            Inspections and PM
          </Typography>
          <FrequencyFields frequency={frequency} intervalDays={intervalDays}
                           onChange={({ frequency: f, intervalDays: d }) => { setFrequency(f); setIntervalDays(d) }} />
          <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField size="small" type="date" label={vehicle ? 'Next due' : 'First due'} value={firstDue}
                       onChange={(e) => setFirstDue(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField select size="small" label="Assigned to" value={assignee}
                       onChange={(e) => setAssignee(e.target.value === '' ? '' : Number(e.target.value))}
                       InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}>
              <MenuItem value="">Nobody</MenuItem>
              {(people.data ?? []).map((person) => (
                <MenuItem key={person.id} value={person.id}>{person.name}</MenuItem>
              ))}
            </TextField>
          </Box>
          {field('pm_task', 'Maintenance when it falls due', { placeholder: 'Service and brake check' })}
          {vehicle?.last_inspected_on && (
            <Typography sx={{ fontSize: 12.5, color: palette.textMuted, fontWeight: 700 }}>
              Last inspected {shortDate(vehicle.last_inspected_on)}
              {vehicle.last_result_label ? ` · ${vehicle.last_result_label}` : ''}
            </Typography>
          )}
          {problem && <Typography sx={{ fontSize: 12.5, color: palette.danger, fontWeight: 700 }}>{problem}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {canDelete && (
          <Button onClick={() => remove.mutate()} disabled={remove.isPending}
                  sx={{ fontWeight: 800, color: palette.danger, mr: 'auto' }}>
            Remove
          </Button>
        )}
        <Button onClick={onClose} sx={{ fontWeight: 800, color: palette.textMuted }}>Cancel</Button>
        <Button variant="contained" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}
                sx={{ fontWeight: 900, borderRadius: '11px', bgcolor: palette.brand,
                      '&:hover': { bgcolor: palette.brandDeep } }}>
          {vehicle ? 'Save' : 'Add vehicle'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function AttachFleetFormDialog({ facilityId, onClose, onSaved }: {
  facilityId: number; onClose: () => void; onSaved: () => void
}) {
  const [formId, setFormId] = useState<number | ''>('')
  const [frequency, setFrequency] = useState<Frequency | ''>('monthly')
  const [intervalDays, setIntervalDays] = useState('')
  const [problem, setProblem] = useState('')
  const library = useQuery({ queryKey: ['form-library'], queryFn: fetchFormLibrary })

  const save = useMutation({
    mutationFn: async () => attachFleetForm(facilityId, {
      form_id: Number(formId),
      default_frequency: frequency || null,
      default_interval_days: frequency === 'custom' && intervalDays ? Number(intervalDays) : null,
    }),
    onSuccess: onSaved,
    onError: (error) => setProblem(errorMessage(error, 'That form could not be attached.')),
  })
  const forms = library.data?.items ?? []

  return (
    <Dialog open onClose={onClose} fullWidth PaperProps={{ sx: { borderRadius: '18px', maxWidth: 520 } }}>
      <DialogTitle sx={{ fontWeight: 900 }}>Attach a form to the fleet</DialogTitle>
      <DialogContent>
        <Stack spacing={1.6} sx={{ mt: 0.5 }}>
          <TextField select size="small" label="Form" value={formId}
                     onChange={(e) => setFormId(e.target.value === '' ? '' : Number(e.target.value))}
                     InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}>
            {library.isLoading && <MenuItem value="">Loading forms…</MenuItem>}
            {!library.isLoading && !forms.length && (
              <MenuItem value="">No forms have been built yet</MenuItem>
            )}
            {forms.map((form) => <MenuItem key={form.id} value={form.id}>{form.name}</MenuItem>)}
          </TextField>
          <FrequencyFields label="Normally inspected" frequency={frequency} intervalDays={intervalDays}
                           onChange={({ frequency: f, intervalDays: d }) => { setFrequency(f); setIntervalDays(d) }} />
          {problem && <Typography sx={{ fontSize: 12.5, color: palette.danger, fontWeight: 700 }}>{problem}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 800, color: palette.textMuted }}>Cancel</Button>
        <Button variant="contained" disabled={formId === '' || save.isPending} onClick={() => save.mutate()}
                sx={{ fontWeight: 900, borderRadius: '11px', bgcolor: palette.brand,
                      '&:hover': { bgcolor: palette.brandDeep } }}>
          Attach
        </Button>
      </DialogActions>
    </Dialog>
  )
}
