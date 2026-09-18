/**
 * The departments of the site you are in, and where each one stands.
 *
 * This is the way into inspecting: a department holds items, the items carry
 * their own dates, and the counts here say what is due, what failed and what
 * is red-tagged. Items nobody has put in a department are shown too, with the
 * one button that fixes that for many at once.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DomainAddOutlinedIcon from '@mui/icons-material/DomainAddOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import {
  bulkAssignItems, errorMessage, fetchProgrammeDepartments, fetchProgrammeItems, shortDate,
  type DepartmentRow, type Frequency,
} from '@/api/inspectionProgramme'
import { createDepartment, deleteDepartment, updateDepartment } from '@/api/departments'
import { hasPermission } from '@/config/permissions'
import { useActiveFacility } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'
import { CountTile, FrequencyFields } from '@/pages/Inspections/programme/parts'

export default function DepartmentsPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const { facilityId, facility } = useActiveFacility()
  const canEdit = hasPermission(user, 'inspections', 'edit')
  const canAdd = hasPermission(user, 'inspections', 'add')

  const [editing, setEditing] = useState<DepartmentRow | 'new' | null>(null)
  const [assigning, setAssigning] = useState(false)

  const list = useQuery({
    queryKey: ['programme-departments', facilityId],
    queryFn: () => fetchProgrammeDepartments(facilityId as number),
    enabled: !!facilityId,
  })

  const rows = list.data?.items ?? []
  const real = rows.filter((row) => row.id !== null)
  const unassigned = rows.find((row) => row.id === null)
  const totals = useMemo(() => real.reduce((sum, row) => ({
    items: sum.items + row.items,
    due: sum.due + row.due,
    overdue: sum.overdue + row.overdue,
    red: sum.red + row.red_tagged,
  }), { items: 0, due: 0, overdue: 0, red: 0 }), [real])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['programme-departments'] })
    void queryClient.invalidateQueries({ queryKey: ['inspection-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['site-overview'] })
  }

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }}
             sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5, mb: 2.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
                            color: palette.textSubtle }}>
            Inspections
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 900, color: palette.ink, lineHeight: 1.15 }}>Departments</Typography>
          <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>
            {facility?.name ?? 'This site'} · {real.length} department{real.length === 1 ? '' : 's'} · {totals.items} item
            {totals.items === 1 ? '' : 's'}
          </Typography>
        </Box>
        {canAdd && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}
                  sx={{ fontWeight: 900, borderRadius: '12px', px: 2.5, bgcolor: palette.brand,
                        '&:hover': { bgcolor: palette.brandDeep } }}>
            Add department
          </Button>
        )}
      </Stack>

      <Stack direction="row" spacing={1.2} sx={{ mb: 2, flexWrap: 'wrap', gap: 1.2 }}>
        <CountTile label="Items" value={totals.items} />
        <CountTile label="Due" value={totals.due} tone={{ color: '#92400E', bg: '#FEF3C7' }} />
        <CountTile label="Overdue" value={totals.overdue} tone={{ color: '#B91C1C', bg: '#FEE2E2' }} />
        <CountTile label="Red tagged" value={totals.red} tone={{ color: '#B91C1C', bg: '#FEE2E2' }} />
      </Stack>

      <Box sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '18px', bgcolor: palette.white,
                 overflow: 'hidden' }}>
        <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '2fr 1fr 1fr 1.4fr 1fr 40px',
                   px: 2, py: 1.1, gap: 1.2, bgcolor: palette.surfaceMuted }}>
          {['Department', 'Items', 'Forms', 'Due', 'Last inspected', ''].map((head) => (
            <Typography key={head} sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.4,
                                         textTransform: 'uppercase', color: palette.textSubtle }}>
              {head}
            </Typography>
          ))}
        </Box>

        {list.isLoading && (
          <Box sx={{ p: 4, display: 'grid', placeItems: 'center' }}><CircularProgress size={22} /></Box>
        )}
        {!list.isLoading && !real.length && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <DomainAddOutlinedIcon sx={{ fontSize: 40, color: palette.textFaint }} />
            <Typography sx={{ mt: 1, fontWeight: 900, color: palette.ink }}>No departments yet</Typography>
            <Typography sx={{ fontSize: 13, color: palette.textMuted, fontWeight: 700 }}>
              Add Radiology, Theatre, Pharmacy — whatever this site is divided into — then put its equipment in them.
            </Typography>
          </Box>
        )}

        {real.map((row) => (
          <Box
            key={row.id}
            onClick={() => navigate(`/departments/${row.id}`)}
            sx={{
              display: 'grid', gap: 1.2, alignItems: 'center', cursor: 'pointer',
              gridTemplateColumns: { xs: '1fr auto', md: '2fr 1fr 1fr 1.4fr 1fr 40px' },
              px: 2, py: 1.4, borderTop: `1px solid ${palette.borderSoft}`,
              '&:hover': { bgcolor: palette.brandTint },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 900, color: palette.ink, fontSize: 14 }}>{row.name}</Typography>
              {row.description && (
                <Typography noWrap sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 600 }}>
                  {row.description}
                </Typography>
              )}
            </Box>
            <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: 13.5, fontWeight: 800,
                              color: palette.textStrong }}>
              {row.items}
            </Typography>
            <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: 13.5, fontWeight: 700,
                              color: row.forms ? palette.textStrong : palette.danger }}>
              {row.forms || 'None'}
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, gridColumn: { xs: '1 / -1', md: 'auto' } }}>
              {row.overdue > 0 && <Chip size="small" label={`${row.overdue} overdue`}
                    sx={{ height: 22, fontSize: 11, fontWeight: 900, color: '#B91C1C', bgcolor: '#FEE2E2' }} />}
              {row.due > 0 && <Chip size="small" label={`${row.due} due`}
                    sx={{ height: 22, fontSize: 11, fontWeight: 900, color: '#92400E', bgcolor: '#FEF3C7' }} />}
              {row.red_tagged > 0 && <Chip size="small" label={`${row.red_tagged} red tag`}
                    sx={{ height: 22, fontSize: 11, fontWeight: 900, color: '#fff', bgcolor: palette.danger }} />}
              {row.unscheduled > 0 && <Chip size="small" label={`${row.unscheduled} no schedule`}
                    sx={{ height: 22, fontSize: 11, fontWeight: 800, color: palette.textMuted,
                          bgcolor: palette.surfaceMuted }} />}
              {!row.overdue && !row.due && !row.red_tagged && !row.unscheduled && (
                <Chip size="small" label="Up to date"
                      sx={{ height: 22, fontSize: 11, fontWeight: 800, color: '#15803D', bgcolor: '#F0FDF4' }} />
              )}
            </Stack>
            <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: 13, fontWeight: 700,
                              color: palette.textStrong }}>
              {shortDate(row.last_inspected_on)}
            </Typography>
            <Stack direction="row" sx={{ justifySelf: 'end' }}>
              {canEdit && (
                <Tooltip title="Rename">
                  <IconButton size="small" aria-label={`Edit ${row.name}`}
                              onClick={(e) => { e.stopPropagation(); setEditing(row) }}>
                    <EditOutlinedIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              )}
              <ChevronRightRoundedIcon sx={{ color: palette.textFaint, display: { xs: 'none', md: 'block' } }} />
            </Stack>
          </Box>
        ))}

        {unassigned && (
          <Box sx={{ px: 2, py: 1.6, borderTop: `1px solid ${palette.borderSoft}`, bgcolor: '#FFFBEB',
                     display: 'flex', flexWrap: 'wrap', gap: 1.2, alignItems: 'center' }}>
            <Box sx={{ flex: 1, minWidth: 220 }}>
              <Typography sx={{ fontWeight: 900, color: '#92400E', fontSize: 14 }}>
                {unassigned.items} item{unassigned.items === 1 ? '' : 's'} not in a department
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: '#92400E', fontWeight: 700 }}>
                They cannot be inspected until they belong somewhere. Put them in one, with a frequency, in one go.
              </Typography>
            </Box>
            {canEdit && (
              <Button variant="contained" onClick={() => setAssigning(true)}
                      sx={{ fontWeight: 900, borderRadius: '11px', bgcolor: '#B45309',
                            '&:hover': { bgcolor: '#92400E' } }}>
                Assign items
              </Button>
            )}
          </Box>
        )}
      </Box>

      {editing && facilityId && (
        <DepartmentDialog
          facilityId={facilityId}
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
      {assigning && facilityId && (
        <AssignItemsDialog
          facilityId={facilityId}
          departments={real}
          onClose={() => setAssigning(false)}
          onSaved={() => { setAssigning(false); refresh() }}
        />
      )}
    </Box>
  )
}

function DepartmentDialog({ facilityId, row, onClose, onSaved }: {
  facilityId: number; row: DepartmentRow | null; onClose: () => void; onSaved: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const [name, setName] = useState(row?.name ?? '')
  const [description, setDescription] = useState(row?.description ?? '')
  const [problem, setProblem] = useState('')
  const canDelete = hasPermission(user, 'inspections', 'delete') && row && row.items === 0

  const save = useMutation({
    mutationFn: async () => {
      if (row?.id) return updateDepartment(row.id, { name: name.trim(), description: description.trim() })
      return createDepartment({ facility_id: facilityId, name: name.trim(), description: description.trim() })
    },
    onSuccess: onSaved,
    onError: (error) => setProblem(errorMessage(error, 'That did not save.')),
  })
  const remove = useMutation({
    mutationFn: async () => deleteDepartment(row!.id as number),
    onSuccess: onSaved,
    onError: (error) => setProblem(errorMessage(error, 'That could not be removed.')),
  })

  return (
    <Dialog open onClose={onClose} fullWidth PaperProps={{ sx: { borderRadius: '18px', maxWidth: 520 } }}>
      <DialogTitle sx={{ fontWeight: 900 }}>{row ? `Edit ${row.name}` : 'Add a department'}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.6} sx={{ mt: 0.5 }}>
          <TextField autoFocus label="Name" value={name} onChange={(e) => setName(e.target.value)}
                     size="small" fullWidth InputLabelProps={{ shrink: true }}
                     placeholder="Radiology" />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)}
                     size="small" fullWidth multiline minRows={2} InputLabelProps={{ shrink: true }} />
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
        <Button variant="contained" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}
                sx={{ fontWeight: 900, borderRadius: '11px', bgcolor: palette.brand,
                      '&:hover': { bgcolor: palette.brandDeep } }}>
          {row ? 'Save' : 'Add department'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function AssignItemsDialog({ facilityId, departments, onClose, onSaved }: {
  facilityId: number; departments: DepartmentRow[]; onClose: () => void; onSaved: () => void
}) {
  const [departmentId, setDepartmentId] = useState<number | ''>(departments[0]?.id ?? '')
  const [frequency, setFrequency] = useState<Frequency | ''>('semi_annual')
  const [intervalDays, setIntervalDays] = useState('')
  const [firstDue, setFirstDue] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [problem, setProblem] = useState('')

  const items = useQuery({
    queryKey: ['unassigned-items', facilityId],
    queryFn: () => fetchProgrammeItems(facilityId, { unassigned: true }),
  })
  const rows = items.data?.items ?? []
  const allPicked = rows.length > 0 && picked.length === rows.length

  const save = useMutation({
    mutationFn: async () => bulkAssignItems({
      equipment_ids: picked,
      department_id: departmentId === '' ? null : departmentId,
      frequency: frequency || null,
      interval_days: frequency === 'custom' && intervalDays ? Number(intervalDays) : null,
      first_due_on: firstDue || null,
    }),
    onSuccess: onSaved,
    onError: (error) => setProblem(errorMessage(error, 'Those items could not be assigned.')),
  })

  return (
    <Dialog open onClose={onClose} fullWidth PaperProps={{ sx: { borderRadius: '18px', maxWidth: 640 } }}>
      <DialogTitle sx={{ fontWeight: 900 }}>Put items in a department</DialogTitle>
      <DialogContent>
        <Stack spacing={1.6} sx={{ mt: 0.5 }}>
          <TextField select size="small" label="Department" value={departmentId}
                     onChange={(e) => setDepartmentId(e.target.value === '' ? '' : Number(e.target.value))}
                     InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}>
            {!departments.length && <MenuItem value="">Add a department first</MenuItem>}
            {departments.map((row) => <MenuItem key={row.id} value={row.id as number}>{row.name}</MenuItem>)}
          </TextField>
          <FrequencyFields frequency={frequency} intervalDays={intervalDays}
                           onChange={({ frequency: f, intervalDays: d }) => { setFrequency(f); setIntervalDays(d) }} />
          <TextField size="small" type="date" label="First due" value={firstDue}
                     onChange={(e) => setFirstDue(e.target.value)} InputLabelProps={{ shrink: true }}
                     helperText="Left empty, it is worked out from the frequency" />

          <Box sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '14px', maxHeight: 260,
                     overflowY: 'auto' }}>
            <Stack direction="row" alignItems="center" sx={{ px: 1.5, py: 1, bgcolor: palette.surfaceMuted }}>
              <Checkbox size="small" checked={allPicked}
                        indeterminate={picked.length > 0 && !allPicked}
                        onChange={() => setPicked(allPicked ? [] : rows.map((row) => row.id))} />
              <Typography sx={{ fontSize: 12.5, fontWeight: 900, color: palette.textStrong }}>
                {picked.length ? `${picked.length} selected` : 'Select items'}
              </Typography>
            </Stack>
            {items.isLoading && <Box sx={{ p: 3, display: 'grid', placeItems: 'center' }}><CircularProgress size={20} /></Box>}
            {rows.map((row) => (
              <Stack key={row.id} direction="row" alignItems="center" spacing={1}
                     sx={{ px: 1.5, py: 0.8, borderTop: `1px solid ${palette.borderSoft}` }}>
                <Checkbox size="small" checked={picked.includes(row.id)}
                          onChange={() => setPicked((prev) => prev.includes(row.id)
                            ? prev.filter((id) => id !== row.id) : [...prev, row.id])} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontSize: 13, fontWeight: 800, color: palette.ink }}>{row.name}</Typography>
                  <Typography noWrap sx={{ fontSize: 11.5, color: palette.textMuted, fontWeight: 600 }}>
                    {[row.type, row.asset_tag, row.where].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Box>
          {problem && <Typography sx={{ fontSize: 12.5, color: palette.danger, fontWeight: 700 }}>{problem}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 800, color: palette.textMuted }}>Cancel</Button>
        <Button variant="contained" disabled={!picked.length || departmentId === '' || save.isPending}
                onClick={() => save.mutate()}
                sx={{ fontWeight: 900, borderRadius: '11px', bgcolor: palette.brand,
                      '&:hover': { bgcolor: palette.brandDeep } }}>
          Assign {picked.length || ''}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
