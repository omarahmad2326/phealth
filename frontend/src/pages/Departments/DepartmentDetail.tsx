/**
 * One department: the forms it is inspected on, the items in it and when each
 * falls due, the red tags standing against it, and its visits.
 *
 * The forms come first because nothing can be inspected without one, and an
 * empty forms list is the most common reason a visit cannot be scheduled.
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import {
  attachDepartmentForm, clearRedTag, detachDepartmentForm, errorMessage, fetchDepartmentDetail,
  fetchFormLibrary, fetchInspectors, setItemSchedule, shortDate,
  type Frequency, type ProgrammeItem,
} from '@/api/inspectionProgramme'
import { hasPermission } from '@/config/permissions'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'
import { CountTile, DueChip, FrequencyFields, ResultChip } from '@/pages/Inspections/programme/parts'
import InspectNowDialog, { type InspectTarget } from '@/pages/Inspections/programme/InspectNowDialog'
import ScheduleVisitDialog from '@/pages/Inspections/programme/ScheduleVisitDialog'

export default function DepartmentDetail() {
  const { id } = useParams()
  const departmentId = Number(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const canEdit = hasPermission(user, 'inspections', 'edit')
  const canAdd = hasPermission(user, 'inspections', 'add')

  const [attaching, setAttaching] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [editingItem, setEditingItem] = useState<ProgrammeItem | null>(null)
  const [inspecting, setInspecting] = useState<InspectTarget | null>(null)
  const [clearing, setClearing] = useState<number | null>(null)

  const detail = useQuery({
    queryKey: ['department-detail', departmentId],
    queryFn: () => fetchDepartmentDetail(departmentId),
    enabled: Number.isFinite(departmentId),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['department-detail', departmentId] })
    void queryClient.invalidateQueries({ queryKey: ['programme-departments'] })
    void queryClient.invalidateQueries({ queryKey: ['inspection-dashboard'] })
  }

  const detach = useMutation({
    mutationFn: async (linkId: number) => detachDepartmentForm(departmentId, linkId),
    onSuccess: refresh,
  })

  if (detail.isLoading) {
    return <Box sx={{ p: 6, display: 'grid', placeItems: 'center' }}><CircularProgress size={26} /></Box>
  }
  if (!detail.data) {
    return <Typography sx={{ p: 4, fontWeight: 800, color: palette.textMuted }}>That department is not here.</Typography>
  }

  const { department, forms, items, visits, red_tags: redTags } = detail.data
  const due = items.filter((item) => item.due_state === 'due').length
  const overdue = items.filter((item) => item.due_state === 'overdue').length
  const unscheduled = items.filter((item) => item.due_state === 'not_scheduled').length

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }}
             sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5, mb: 2.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
                            color: palette.textSubtle }}>
            Department
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 900, color: palette.ink, lineHeight: 1.15 }}>
            {department.name}
          </Typography>
          <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>
            {items.length} item{items.length === 1 ? '' : 's'} · {forms.length} form{forms.length === 1 ? '' : 's'}
            {department.description ? ` · ${department.description}` : ''}
          </Typography>
        </Box>
        {canAdd && (
          <Button variant="contained" startIcon={<EventAvailableOutlinedIcon />} onClick={() => setScheduling(true)}
                  disabled={!forms.length}
                  sx={{ fontWeight: 900, borderRadius: '12px', px: 2.5, bgcolor: palette.brand,
                        '&:hover': { bgcolor: palette.brandDeep } }}>
            Schedule inspection
          </Button>
        )}
      </Stack>

      <Stack direction="row" spacing={1.2} sx={{ mb: 2, flexWrap: 'wrap', gap: 1.2 }}>
        <CountTile label="Items" value={items.length} />
        <CountTile label="Due" value={due} tone={{ color: '#92400E', bg: '#FEF3C7' }} />
        <CountTile label="Overdue" value={overdue} tone={{ color: '#B91C1C', bg: '#FEE2E2' }} />
        <CountTile label="Red tags" value={redTags.length} tone={{ color: '#B91C1C', bg: '#FEE2E2' }} />
        <CountTile label="No schedule" value={unscheduled} />
      </Stack>

      {/* ── forms ─────────────────────────────────────────────────────────── */}
      <Section
        title="Inspected on"
        action={canAdd ? <Button size="small" startIcon={<AddIcon />} onClick={() => setAttaching(true)}
                                 sx={{ fontWeight: 900 }}>Attach a form</Button> : null}
      >
        {!forms.length && (
          <Typography sx={{ p: 2, fontSize: 13, fontWeight: 700, color: palette.danger }}>
            No form is attached, so nothing here can be inspected yet. Attach one to get started.
          </Typography>
        )}
        {forms.map((form) => (
          <Stack key={form.link_id} direction="row" alignItems="center" spacing={1}
                 sx={{ px: 2, py: 1.2, borderTop: `1px solid ${palette.borderSoft}` }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 900, fontSize: 13.5, color: palette.ink }}>{form.name}</Typography>
              {form.description && (
                <Typography noWrap sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 600 }}>
                  {form.description}
                </Typography>
              )}
            </Box>
            {form.default_frequency && (
              <Chip size="small" label={`Normally ${form.default_frequency.replace('_', ' ')}`}
                    sx={{ height: 22, fontSize: 11, fontWeight: 800, bgcolor: palette.surfaceMuted,
                          color: palette.textMuted }} />
            )}
            {hasPermission(user, 'inspections', 'delete') && (
              <Tooltip title="Stop using this form here">
                <IconButton size="small" aria-label={`Remove ${form.name}`}
                            onClick={() => detach.mutate(form.link_id)}>
                  <DeleteOutlineIcon sx={{ fontSize: 17, color: palette.textFaint }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        ))}
      </Section>

      {/* ── red tags ──────────────────────────────────────────────────────── */}
      {redTags.length > 0 && (
        <Section title="Red tags">
          {redTags.map((tag) => (
            <Stack key={tag.id} direction={{ xs: 'column', sm: 'row' }} spacing={1}
                   sx={{ px: 2, py: 1.3, borderTop: `1px solid ${palette.borderSoft}`, bgcolor: '#FEF2F2',
                         alignItems: { sm: 'center' } }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 900, fontSize: 13.5, color: '#B91C1C' }}>
                  {tag.name} · {tag.note}
                </Typography>
                <Typography sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 700 }}>
                  Raised by {tag.raised_by ?? 'somebody'} on {new Date(tag.raised_at).toLocaleDateString()}
                </Typography>
              </Box>
              <Button size="small" variant="outlined" onClick={() => setClearing(tag.id)}
                      sx={{ fontWeight: 900, borderRadius: '10px', color: '#B91C1C', borderColor: '#FCA5A5' }}>
                Clear
              </Button>
            </Stack>
          ))}
        </Section>
      )}

      {/* ── items ─────────────────────────────────────────────────────────── */}
      <Section title="Items">
        <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '2fr 1.4fr 1fr 1.3fr 1fr 76px',
                   px: 2, py: 1, gap: 1.2, bgcolor: palette.surfaceMuted }}>
          {['Item', 'Where', 'Every', 'Next due', 'Last result', ''].map((head) => (
            <Typography key={head} sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.4,
                                         textTransform: 'uppercase', color: palette.textSubtle }}>{head}</Typography>
          ))}
        </Box>
        {!items.length && (
          <Typography sx={{ p: 2, fontSize: 13, fontWeight: 700, color: palette.textMuted }}>
            Nothing is in this department yet. Add equipment under Facility and choose this department, or use
            Assign items on the Departments screen.
          </Typography>
        )}
        {items.map((item) => (
          <Box key={item.id}
               sx={{ display: 'grid', gap: 1.2, alignItems: 'center',
                     gridTemplateColumns: { xs: '1fr auto', md: '2fr 1.4fr 1fr 1.3fr 1fr 76px' },
                     px: 2, py: 1.3, borderTop: `1px solid ${palette.borderSoft}` }}>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 900, fontSize: 13.5, color: palette.ink }}>{item.name}</Typography>
                {item.red_tagged && <Chip size="small" label="RED TAG"
                      sx={{ height: 19, fontSize: 10, fontWeight: 900, color: '#fff', bgcolor: palette.danger }} />}
              </Stack>
              <Typography noWrap sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 600 }}>
                {[item.type, item.asset_tag].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
            <Typography noWrap sx={{ display: { xs: 'none', md: 'block' }, fontSize: 13, fontWeight: 700,
                                     color: palette.textStrong }}>
              {item.where ?? '—'}
            </Typography>
            <Typography noWrap sx={{ display: { xs: 'none', md: 'block' }, fontSize: 12.5, fontWeight: 800,
                                     color: palette.textStrong }}>
              {item.frequency_label}
            </Typography>
            <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}>
              <DueChip state={item.due_state} on={item.next_due_on} />
            </Box>
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
              <ResultChip result={item.last_result} />
            </Box>
            <Stack direction="row" sx={{ justifySelf: 'end' }}>
              {canAdd && (
                <Tooltip title="Inspect it now">
                  <IconButton size="small" aria-label={`Inspect ${item.name} now`}
                              onClick={() => setInspecting({
                                kind: 'equipment', id: item.id, name: item.name,
                                departmentId: departmentId,
                              })}>
                    <PlaylistAddCheckIcon sx={{ fontSize: 19, color: palette.brand }} />
                  </IconButton>
                </Tooltip>
              )}
              {canEdit && (
                <Tooltip title="Set how often it is inspected">
                  <IconButton size="small" aria-label={`Schedule for ${item.name}`}
                              onClick={() => setEditingItem(item)}>
                    <ScheduleOutlinedIcon sx={{ fontSize: 18, color: palette.brand }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Box>
        ))}
      </Section>

      {/* ── visits ────────────────────────────────────────────────────────── */}
      <Section title="Visits">
        {!visits.length && (
          <Typography sx={{ p: 2, fontSize: 13, fontWeight: 700, color: palette.textMuted }}>
            No visits yet.
          </Typography>
        )}
        {visits.map((visit) => (
          <Stack key={visit.id} direction="row" spacing={1} alignItems="center"
                 onClick={() => navigate(`/inspection-visits/${visit.id}`)}
                 sx={{ px: 2, py: 1.3, borderTop: `1px solid ${palette.borderSoft}`, cursor: 'pointer',
                       '&:hover': { bgcolor: palette.brandTint } }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 900, fontSize: 13.5, color: palette.ink }}>
                {shortDate(visit.scheduled_on)} · {visit.number}
              </Typography>
              <Typography noWrap sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 700 }}>
                {visit.done} of {visit.items} done{visit.inspector ? ` · ${visit.inspector.name}` : ''}
              </Typography>
            </Box>
            <ResultChip result={visit.result} />
            <Chip size="small" label={visit.status.replace('_', ' ')}
                  sx={{ height: 22, fontSize: 11, fontWeight: 800, bgcolor: palette.surfaceMuted,
                        color: palette.textMuted }} />
          </Stack>
        ))}
      </Section>

      {attaching && (
        <AttachFormDialog departmentId={departmentId} onClose={() => setAttaching(false)}
                          onSaved={() => { setAttaching(false); refresh() }} />
      )}
      {scheduling && (
        <ScheduleVisitDialog facilityId={department.facility_id} scope="department" departmentId={departmentId}
                             onClose={() => setScheduling(false)} />
      )}
      {editingItem && (
        <ItemScheduleDialog item={editingItem} facilityId={department.facility_id}
                            onClose={() => setEditingItem(null)}
                            onSaved={() => { setEditingItem(null); refresh() }} />
      )}
      {clearing !== null && (
        <ClearRedTagDialog tagId={clearing} onClose={() => setClearing(null)}
                           onSaved={() => { setClearing(null); refresh() }} />
      )}
      {inspecting && (
        <InspectNowDialog facilityId={department.facility_id} target={inspecting}
                          onClose={() => setInspecting(null)} />
      )}
    </Box>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '18px', bgcolor: palette.white,
               overflow: 'hidden', mb: 2 }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.2 }}>
        <Typography sx={{ flex: 1, fontSize: 12, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
                          color: palette.textSubtle }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  )
}

function AttachFormDialog({ departmentId, onClose, onSaved }: {
  departmentId: number; onClose: () => void; onSaved: () => void
}) {
  const [formId, setFormId] = useState<number | ''>('')
  const [frequency, setFrequency] = useState<Frequency | ''>('semi_annual')
  const [intervalDays, setIntervalDays] = useState('')
  const [problem, setProblem] = useState('')
  const library = useQuery({ queryKey: ['form-library'], queryFn: fetchFormLibrary })

  const save = useMutation({
    mutationFn: async () => attachDepartmentForm(departmentId, {
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
      <DialogTitle sx={{ fontWeight: 900 }}>Attach a form</DialogTitle>
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
          <Typography sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 700 }}>
            This is what an item's frequency starts as when it is added to this department. Each item can then be
            changed on its own.
          </Typography>
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

function ItemScheduleDialog({ item, facilityId, onClose, onSaved }: {
  item: ProgrammeItem; facilityId: number; onClose: () => void; onSaved: () => void
}) {
  const [frequency, setFrequency] = useState<Frequency | ''>(item.frequency ?? '')
  const [intervalDays, setIntervalDays] = useState(item.interval_days ? String(item.interval_days) : '')
  const [firstDue, setFirstDue] = useState(item.next_due_on ?? '')
  const [task, setTask] = useState(item.pm_task ?? '')
  const [assignee, setAssignee] = useState<number | ''>(item.pm_assignee_id ?? '')
  const [problem, setProblem] = useState('')
  const people = useQuery({ queryKey: ['inspectors', facilityId], queryFn: () => fetchInspectors(facilityId) })

  const save = useMutation({
    mutationFn: async () => setItemSchedule(item.id, {
      frequency: frequency || null,
      interval_days: frequency === 'custom' && intervalDays ? Number(intervalDays) : null,
      first_due_on: firstDue || null,
      pm_task: task.trim() || null,
      pm_assignee_id: assignee === '' ? null : Number(assignee),
    }),
    onSuccess: onSaved,
    onError: (error) => setProblem(errorMessage(error, 'That schedule could not be saved.')),
  })

  return (
    <Dialog open onClose={onClose} fullWidth PaperProps={{ sx: { borderRadius: '18px', maxWidth: 520 } }}>
      <DialogTitle sx={{ fontWeight: 900 }}>{item.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.6} sx={{ mt: 0.5 }}>
          <FrequencyFields frequency={frequency} intervalDays={intervalDays}
                           onChange={({ frequency: f, intervalDays: d }) => { setFrequency(f); setIntervalDays(d) }} />
          <TextField size="small" type="date" label="Next due" value={firstDue}
                     onChange={(e) => setFirstDue(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" label="Maintenance raised when it falls due" value={task}
                     onChange={(e) => setTask(e.target.value)} InputLabelProps={{ shrink: true }}
                     placeholder="Filter change and calibration" />
          <TextField select size="small" label="Assigned to" value={assignee}
                     onChange={(e) => setAssignee(e.target.value === '' ? '' : Number(e.target.value))}
                     InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}>
            <MenuItem value="">Nobody</MenuItem>
            {(people.data ?? []).map((person) => (
              <MenuItem key={person.id} value={person.id}>{person.name}</MenuItem>
            ))}
          </TextField>
          {problem && <Typography sx={{ fontSize: 12.5, color: palette.danger, fontWeight: 700 }}>{problem}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 800, color: palette.textMuted }}>Cancel</Button>
        <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate()}
                sx={{ fontWeight: 900, borderRadius: '11px', bgcolor: palette.brand,
                      '&:hover': { bgcolor: palette.brandDeep } }}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function ClearRedTagDialog({ tagId, onClose, onSaved }: {
  tagId: number; onClose: () => void; onSaved: () => void
}) {
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState('')
  const save = useMutation({
    mutationFn: async () => clearRedTag(tagId, note.trim()),
    onSuccess: onSaved,
    onError: (error) => setProblem(errorMessage(error, 'That red tag could not be cleared.')),
  })
  return (
    <Dialog open onClose={onClose} fullWidth PaperProps={{ sx: { borderRadius: '18px', maxWidth: 520 } }}>
      <DialogTitle sx={{ fontWeight: 900 }}>Clear this red tag</DialogTitle>
      <DialogContent>
        <Stack spacing={1.4} sx={{ mt: 0.5 }}>
          <Typography sx={{ fontSize: 13, color: palette.textMuted, fontWeight: 700 }}>
            Say what was done. It is kept against the record with your name, so an inspector or an authority can
            read what happened.
          </Typography>
          <TextField autoFocus size="small" label="What was done" value={note} multiline minRows={3}
                     onChange={(e) => setNote(e.target.value)} InputLabelProps={{ shrink: true }} />
          {problem && <Typography sx={{ fontSize: 12.5, color: palette.danger, fontWeight: 700 }}>{problem}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 800, color: palette.textMuted }}>Cancel</Button>
        <Button variant="contained" disabled={note.trim().length < 3 || save.isPending} onClick={() => save.mutate()}
                sx={{ fontWeight: 900, borderRadius: '11px', bgcolor: palette.brand,
                      '&:hover': { bgcolor: palette.brandDeep } }}>
          Clear red tag
        </Button>
      </DialogActions>
    </Dialog>
  )
}
