/**
 * Raise or update a service or inspection job.
 *
 * Category first, then the equipment in it, whose exact location shows so
 * nobody has to type it again. Then what needs doing, when, who, and where it
 * has got to. Inspections also record pass or fail and what was found.
 *
 * A technician updating their own job changes its progress, not its plan, so
 * those fields are shown but locked for them — the server enforces the same.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, InputAdornment,
  MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import { toast } from 'react-toastify'
import {
  createEquipmentJob, deleteEquipmentJob, errorMessage, fetchAssignees, fetchCategoryEquipment, formatMoney,
  updateEquipmentJob, type CategoryCode, type EquipmentJob, type InspectionResult, type JobKind, type JobStatus,
} from '@/api/siteCategories'
import { CATEGORIES } from '@/config/siteCategories'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'

const toggleSx = {
  '& .MuiToggleButton-root': { fontWeight: 800, textTransform: 'none', px: 2 },
  '& .Mui-selected': { bgcolor: `${palette.brandTint} !important`, color: `${palette.brandDeep} !important` },
}

export default function JobDialog({
  facilityId, kind, job, canDelete, onClose,
}: {
  facilityId: number
  kind: JobKind
  /** Updating when given, raising when not. */
  job?: EquipmentJob | null
  canDelete: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const editing = Boolean(job)
  const technician = user?.role === 'technician'
  const planLocked = editing && technician
  const readOnly = technician && editing && job?.assigned_to?.id !== user?.id

  const [category, setCategory] = useState<CategoryCode | ''>(job?.equipment?.category ?? '')
  const [equipmentId, setEquipmentId] = useState<number | ''>(job?.equipment?.id ?? '')
  const [title, setTitle] = useState(job?.title ?? '')
  const [dueOn, setDueOn] = useState(job?.due_on ?? '')
  const [assignee, setAssignee] = useState<number | ''>(job?.assigned_to?.id ?? '')
  const [status, setStatus] = useState<JobStatus>(job && job.status !== 'cancelled' ? job.status : 'open')
  const [notes, setNotes] = useState(job?.notes ?? '')
  const [result, setResult] = useState<InspectionResult | null>(job?.inspection_result ?? null)
  const [findings, setFindings] = useState(job?.findings ?? '')
  const [labour, setLabour] = useState(job?.labour_cost != null ? String(Number(job.labour_cost)) : '')
  const [parts, setParts] = useState(job?.parts_cost != null ? String(Number(job.parts_cost)) : '')
  const [majorWork, setMajorWork] = useState(Boolean(job?.is_major_work))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const amount = (value: string) => (value === '' ? null : Number(value))
  const costValid = [labour, parts].every((v) => v === '' || Number(v) >= 0)
  const jobTotal = labour === '' && parts === '' ? null : (Number(labour) || 0) + (Number(parts) || 0)

  const { data: equipment } = useQuery({
    queryKey: ['category-equipment', facilityId, category, 'picker'],
    queryFn: () => fetchCategoryEquipment(category as CategoryCode, facilityId),
    enabled: Boolean(category) && !planLocked,
  })
  const { data: people } = useQuery({
    queryKey: ['job-assignees', facilityId],
    queryFn: () => fetchAssignees(facilityId),
    enabled: !planLocked,
    staleTime: 5 * 60_000,
  })

  const options = equipment?.items ?? []
  const chosen = options.find((e) => e.id === equipmentId)
  const location = chosen?.location_label ?? (equipmentId === job?.equipment?.id ? job?.equipment?.location_label : '')
  const ready = Boolean(equipmentId && title.trim())
  const label = kind === 'service' ? 'service' : 'inspection'

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['equipment-jobs'] })
    queryClient.invalidateQueries({ queryKey: ['maintenance-summary'] })
    queryClient.invalidateQueries({ queryKey: ['category-equipment'] })
    queryClient.invalidateQueries({ queryKey: ['category-overview'] })
    // Job costs and major work change the equipment's value.
    queryClient.invalidateQueries({ queryKey: ['asset-ledger'] })
    queryClient.invalidateQueries({ queryKey: ['equipment'] })
  }

  const save = useMutation({
    mutationFn: () => {
      const progress = {
        status,
        notes: notes.trim() || null,
        inspection_result: kind === 'inspection' ? result : null,
        findings: kind === 'inspection' ? (findings.trim() || null) : null,
        labour_cost: amount(labour),
        parts_cost: amount(parts),
      }
      if (planLocked) return updateEquipmentJob(job!.id, progress)
      const payload = {
        ...progress,
        equipment_id: equipmentId as number,
        title: title.trim(),
        due_on: dueOn || null,
        assigned_to_id: assignee === '' ? null : assignee,
        is_major_work: kind === 'service' ? majorWork : false,
      }
      return job ? updateEquipmentJob(job.id, payload) : createEquipmentJob(facilityId, kind, payload)
    },
    onSuccess: (saved) => {
      toast.success(job ? `${saved.number} updated` : `${saved.number} raised`)
      refresh()
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e, `Could not save the ${label}`)),
  })

  const remove = useMutation({
    mutationFn: () => deleteEquipmentJob(job!.id),
    onSuccess: () => {
      toast.success(`${job!.number} removed`)
      refresh()
      onClose()
    },
    onError: (e) => {
      setConfirmDelete(false)
      toast.error(errorMessage(e, `Could not remove the ${label}`))
    },
  })

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '18px', maxWidth: 640 } }}>
      <DialogTitle sx={{ fontWeight: 900, color: palette.ink, pb: 1 }}>
        {editing ? `${kind === 'service' ? 'Service' : 'Inspection'} ${job!.number}` : `New ${label}`}
      </DialogTitle>
      <DialogContent dividers>
        {planLocked ? (
          <Box sx={{ p: 1.5, borderRadius: '12px', bgcolor: palette.surfaceFaint, border: `1px solid ${palette.borderSoft}` }}>
            <Typography sx={{ fontWeight: 900, color: palette.ink }}>{job!.title}</Typography>
            <Typography sx={{ mt: 0.25, fontSize: 13, color: palette.textStrong, fontWeight: 700 }}>
              {job!.equipment?.name} · {job!.equipment?.category_name}
            </Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.25 }}>
              <PlaceOutlinedIcon sx={{ fontSize: 15, color: palette.textFaint }} />
              <Typography sx={{ fontSize: 12.5, color: palette.textMuted }}>{job!.equipment?.location_label || '—'}</Typography>
            </Stack>
            {job!.due_on && (
              <Typography sx={{ mt: 0.5, fontSize: 12.5, color: job!.overdue ? palette.danger : palette.textMuted, fontWeight: 700 }}>
                Due {new Date(`${job!.due_on}T00:00:00`).toLocaleDateString()}{job!.overdue ? ' · overdue' : ''}
              </Typography>
            )}
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'grid', gap: 1.75, gridTemplateColumns: { xs: '1fr', sm: '1fr 1.4fr' } }}>
              <TextField
                select size="small" label="Category" required value={category}
                onChange={(e) => { setCategory(e.target.value as CategoryCode); setEquipmentId('') }}
              >
                {CATEGORIES.map((c) => <MenuItem key={c.code} value={c.code}>{c.name}</MenuItem>)}
              </TextField>
              <TextField
                select size="small" label="Equipment" required value={options.length || !equipmentId ? equipmentId : ''}
                onChange={(e) => setEquipmentId(Number(e.target.value))} disabled={!category}
                helperText={category && equipment && !options.length ? 'No equipment in this category yet' : undefined}
              >
                {options.map((e) => (
                  <MenuItem key={e.id} value={e.id}>
                    {e.name}
                    <Typography component="span" sx={{ ml: 1, fontSize: 12, color: palette.textFaint }}>{e.asset_tag}</Typography>
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            {location && (
              <Stack direction="row" spacing={0.5} alignItems="center"
                     sx={{ mt: 1, px: 1.25, py: 0.75, borderRadius: '10px', bgcolor: palette.surfaceFaint }}>
                <PlaceOutlinedIcon sx={{ fontSize: 16, color: palette.brand }} />
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: palette.textStrong }}>{location}</Typography>
              </Stack>
            )}

            <TextField
              sx={{ mt: 1.75 }} fullWidth size="small" multiline minRows={2} required
              label="What needs doing" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === 'service' ? 'Quarterly service and load test' : 'Annual safety inspection'}
            />
            <Box sx={{ mt: 1.75, display: 'grid', gap: 1.75, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
              <TextField
                size="small" type="date" label="Due date" InputLabelProps={{ shrink: true }}
                value={dueOn} onChange={(e) => setDueOn(e.target.value)}
              />
              <TextField
                select size="small" label="Assigned to" value={assignee}
                onChange={(e) => setAssignee(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <MenuItem value="">Nobody yet</MenuItem>
                {(people ?? []).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
              </TextField>
            </Box>
          </>
        )}

        <Typography sx={{ mt: 2.25, mb: 1, fontSize: 11, fontWeight: 900, letterSpacing: 0.5,
                          textTransform: 'uppercase', color: palette.textSubtle }}>
          Status
        </Typography>
        <ToggleButtonGroup
          exclusive size="small" value={status} disabled={readOnly}
          onChange={(_, value) => value && setStatus(value)} sx={toggleSx}
        >
          <ToggleButton value="open">Open</ToggleButton>
          <ToggleButton value="in_progress">In progress</ToggleButton>
          <ToggleButton value="done">Done</ToggleButton>
        </ToggleButtonGroup>

        {kind === 'inspection' && (
          <>
            <Typography sx={{ mt: 2.25, mb: 1, fontSize: 11, fontWeight: 900, letterSpacing: 0.5,
                              textTransform: 'uppercase', color: palette.textSubtle }}>
              Result
            </Typography>
            <ToggleButtonGroup
              exclusive size="small" value={result} disabled={readOnly}
              onChange={(_, value) => setResult(value)}
              sx={{
                '& .MuiToggleButton-root': { fontWeight: 800, textTransform: 'none', px: 2.5 },
                '& .Mui-selected[value="pass"]': { bgcolor: `${palette.successTint} !important`, color: `${palette.success} !important` },
                '& .Mui-selected[value="fail"]': { bgcolor: `${palette.dangerWash} !important`, color: `${palette.danger} !important` },
              }}
            >
              <ToggleButton value="pass">Pass</ToggleButton>
              <ToggleButton value="fail">Fail</ToggleButton>
            </ToggleButtonGroup>
            <TextField
              sx={{ mt: 1.75 }} fullWidth size="small" multiline minRows={2} disabled={readOnly}
              label="Findings" value={findings} onChange={(e) => setFindings(e.target.value)}
              placeholder="What was checked and what was found"
            />
          </>
        )}

        <Typography sx={{ mt: 2.25, mb: 1, fontSize: 11, fontWeight: 900, letterSpacing: 0.5,
                          textTransform: 'uppercase', color: palette.textSubtle }}>
          Cost
        </Typography>
        <Box sx={{ display: 'grid', gap: 1.75, gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' }, alignItems: 'center' }}>
          <TextField
            size="small" type="number" label="Labour" value={labour} disabled={readOnly}
            onChange={(e) => setLabour(e.target.value)} inputProps={{ min: 0, step: '0.01' }}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <TextField
            size="small" type="number" label="Parts" value={parts} disabled={readOnly}
            onChange={(e) => setParts(e.target.value)} inputProps={{ min: 0, step: '0.01' }}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <Typography sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, fontSize: 13, fontWeight: 700, color: palette.textMuted }}>
            Total{' '}
            <Box component="span" sx={{ fontWeight: 900, color: palette.ink }}>{formatMoney(jobTotal)}</Box>
          </Typography>
        </Box>
        {kind === 'service' && (
          <FormControlLabel
            sx={{ mt: 1, alignItems: 'flex-start', mr: 0 }}
            disabled={readOnly || technician}
            control={<Checkbox size="small" checked={majorWork} onChange={(e) => setMajorWork(e.target.checked)} sx={{ mt: -0.5 }} />}
            label={
              <Box>
                <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: palette.ink }}>
                  Major work that extends its life
                </Typography>
                <Typography sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 600 }}>
                  {majorWork
                    ? `When done, adds ${formatMoney(jobTotal)} to the equipment's value, depreciated over its remaining life.`
                    : 'Leave unticked for routine work: its cost counts as maintenance spend and does not change the value.'}
                </Typography>
              </Box>
            }
          />
        )}
        {kind === 'inspection' && (
          <Typography sx={{ mt: 0.75, fontSize: 12, color: palette.textMuted, fontWeight: 600 }}>
            Counted as maintenance spend when the inspection is done.
          </Typography>
        )}

        <TextField
          sx={{ mt: 1.75 }} fullWidth size="small" multiline minRows={2} disabled={readOnly}
          label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)}
        />
        {readOnly && (
          <Typography sx={{ mt: 1.25, fontSize: 12.5, color: palette.textMuted, fontWeight: 600 }}>
            Only the person this job is assigned to can update it.
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        {editing && canDelete && job!.status !== 'done' && (
          confirmDelete ? (
            <Button color="error" disabled={remove.isPending} onClick={() => remove.mutate()} sx={{ fontWeight: 900, mr: 'auto' }}>
              {remove.isPending ? 'Removing…' : 'Yes, remove it'}
            </Button>
          ) : (
            <Button color="error" onClick={() => setConfirmDelete(true)} sx={{ fontWeight: 800, mr: 'auto' }}>
              Remove
            </Button>
          )
        )}
        <Button onClick={onClose} sx={{ fontWeight: 800, color: palette.textMuted }}>
          {readOnly ? 'Close' : 'Cancel'}
        </Button>
        {!readOnly && (
          <Button
            variant="contained" disabled={(!planLocked && !ready) || !costValid || save.isPending} onClick={() => save.mutate()}
            sx={{ fontWeight: 900, borderRadius: '10px', bgcolor: palette.brand, '&:hover': { bgcolor: palette.brandDeep },
                  '&.Mui-disabled': { bgcolor: palette.surfaceMuted, color: palette.textFaint } }}
          >
            {save.isPending ? 'Saving…' : editing ? 'Save' : `Raise ${label}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
