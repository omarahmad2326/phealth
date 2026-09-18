/**
 * Schedule an inspection visit: a department, the whole site, or the fleet.
 *
 * The date decides the contents, so the count of what would be due is shown
 * before anything is created. Nobody should have to schedule a visit to find
 * out whether it would be empty.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import {
  createVisit, errorMessage, fetchDuePreview, fetchInspectors, fetchProgrammeDepartments,
  type Scope,
} from '@/api/inspectionProgramme'
import { palette } from '@/theme/palette'

const today = () => new Date().toISOString().slice(0, 10)

export default function ScheduleVisitDialog({ facilityId, scope: fixedScope, departmentId, onClose }: {
  facilityId: number
  /** Fixed when opened from a department or the fleet; chosen otherwise. */
  scope?: Scope
  departmentId?: number | null
  onClose: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<Scope>(fixedScope ?? 'department')
  const [department, setDepartment] = useState<number | ''>(departmentId ?? '')
  const [when, setWhen] = useState(today())
  const [inspector, setInspector] = useState<number | ''>('')
  const [problem, setProblem] = useState('')

  const departments = useQuery({
    queryKey: ['programme-departments', facilityId],
    queryFn: () => fetchProgrammeDepartments(facilityId),
    enabled: scope === 'department' && departmentId == null,
  })
  const people = useQuery({
    queryKey: ['inspectors', facilityId],
    queryFn: () => fetchInspectors(facilityId),
  })
  const preview = useQuery({
    queryKey: ['due-preview', facilityId, scope, department, when],
    queryFn: () => fetchDuePreview(facilityId, {
      scope, departmentId: scope === 'department' ? (department || null) : null, by: when,
    }),
    enabled: Boolean(when) && (scope !== 'department' || department !== ''),
  })

  const create = useMutation({
    mutationFn: async () => createVisit({
      facility_id: facilityId,
      scope,
      department_id: scope === 'department' ? Number(department) : null,
      scheduled_on: when,
      inspector_id: inspector === '' ? null : Number(inspector),
    }),
    onSuccess: (visit) => {
      void queryClient.invalidateQueries({ queryKey: ['visits'] })
      void queryClient.invalidateQueries({ queryKey: ['programme-departments'] })
      void queryClient.invalidateQueries({ queryKey: ['department-detail'] })
      onClose()
      navigate(`/inspection-visits/${visit.id}`)
    },
    onError: (error) => setProblem(errorMessage(error, 'That visit could not be scheduled.')),
  })

  const rows = (departments.data?.items ?? []).filter((row) => row.id !== null)
  const count = preview.data?.total ?? 0

  return (
    <Dialog open onClose={onClose} fullWidth PaperProps={{ sx: { borderRadius: '18px', maxWidth: 560 } }}>
      <DialogTitle sx={{ fontWeight: 900 }}>Schedule an inspection</DialogTitle>
      <DialogContent>
        <Stack spacing={1.6} sx={{ mt: 0.5 }}>
          {!fixedScope && (
            <TextField select size="small" label="What is being inspected" value={scope}
                       onChange={(e) => setScope(e.target.value as Scope)} InputLabelProps={{ shrink: true }}>
              <MenuItem value="department">One department</MenuItem>
              <MenuItem value="facility">The whole site</MenuItem>
              <MenuItem value="fleet">The fleet</MenuItem>
            </TextField>
          )}
          {scope === 'department' && departmentId == null && (
            <TextField select size="small" label="Department" value={department}
                       onChange={(e) => setDepartment(e.target.value === '' ? '' : Number(e.target.value))}
                       InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}>
              {!rows.length && <MenuItem value="">No departments yet</MenuItem>}
              {rows.map((row) => (
                <MenuItem key={row.id} value={row.id as number}>
                  {row.name}{row.forms ? '' : ' — no form attached'}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField size="small" type="date" label="Date" value={when}
                     onChange={(e) => setWhen(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField select size="small" label="Inspector" value={inspector}
                     onChange={(e) => setInspector(e.target.value === '' ? '' : Number(e.target.value))}
                     InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}>
            <MenuItem value="">Nobody yet</MenuItem>
            {(people.data ?? []).map((person) => (
              <MenuItem key={person.id} value={person.id}>{person.name}</MenuItem>
            ))}
          </TextField>

          <Box sx={{ p: 1.4, borderRadius: '14px', bgcolor: count ? palette.brandTint : palette.surfaceMuted }}>
            <Typography sx={{ fontSize: 13, fontWeight: 900, color: count ? palette.brandDeep : palette.textMuted }}>
              {preview.isFetching ? 'Working out what is due…'
                : count
                  ? `${count} item${count === 1 ? '' : 's'} due by that date will be in this visit`
                  : 'Nothing is due by that date'}
            </Typography>
            {count > 0 && (
              <Typography sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 700, mt: 0.3 }}>
                {(preview.data?.items ?? []).slice(0, 4).map((item) => item.name).join(', ')}
                {count > 4 ? ` and ${count - 4} more` : ''}
              </Typography>
            )}
          </Box>
          {problem && <Typography sx={{ fontSize: 12.5, color: palette.danger, fontWeight: 700 }}>{problem}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 800, color: palette.textMuted }}>Cancel</Button>
        <Button variant="contained" disabled={!count || create.isPending} onClick={() => create.mutate()}
                sx={{ fontWeight: 900, borderRadius: '11px', bgcolor: palette.brand,
                      '&:hover': { bgcolor: palette.brandDeep } }}>
          Schedule visit
        </Button>
      </DialogActions>
    </Dialog>
  )
}
