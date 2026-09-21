/**
 * Inspect one piece of equipment now, the way a service is raised on one.
 *
 * Scheduling a visit is the programme: a department, a date, whatever is due.
 * This is the other thing people do — they are standing in front of something
 * and want it inspected. So it asks for as little as it can: the item and the
 * form. It does not care whether the item is due, or whether it is in a
 * department yet.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import {
  errorMessage, fetchDepartmentDetail, fetchFormLibrary, fetchInspectors, inspectNow, type ItemKind,
} from '@/api/inspectionProgramme'
import { fetchCategoryEquipment, type CategoryCode } from '@/api/siteCategories'
import { CATEGORIES } from '@/config/siteCategories'
import { palette } from '@/theme/palette'

const today = () => new Date().toISOString().slice(0, 10)

export interface InspectTarget {
  kind: ItemKind
  id: number
  name: string
  /** Used to prefill the form from the department that answers for it. */
  departmentId?: number | null
  category?: CategoryCode | null
}

export default function InspectNowDialog({ facilityId, target, onClose }: {
  facilityId: number
  /** Given when opened from an item's own row; chosen here otherwise. */
  target?: InspectTarget | null
  onClose: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [category, setCategory] = useState<CategoryCode | ''>(target?.category ?? '')
  const [equipmentId, setEquipmentId] = useState<number | ''>(
    target && target.kind === 'equipment' ? target.id : '')
  const [departmentId, setDepartmentId] = useState<number | null>(target?.departmentId ?? null)
  const [formId, setFormId] = useState<number | ''>('')
  const [when, setWhen] = useState(today())
  const [inspector, setInspector] = useState<number | ''>('')
  const [problem, setProblem] = useState('')

  const fixed = Boolean(target)
  const library = useQuery({ queryKey: ['form-library'], queryFn: fetchFormLibrary })
  const people = useQuery({ queryKey: ['inspectors', facilityId], queryFn: () => fetchInspectors(facilityId) })
  const inCategory = useQuery({
    queryKey: ['category-equipment', facilityId, category, '', '', '', ''],
    queryFn: () => fetchCategoryEquipment(category as CategoryCode, facilityId),
    enabled: !fixed && category !== '',
  })
  // The department that answers for the item supplies the form, so the usual
  // case is one press: the right form is already chosen.
  const department = useQuery({
    queryKey: ['department-detail', departmentId],
    queryFn: () => fetchDepartmentDetail(departmentId as number),
    enabled: departmentId != null,
    staleTime: 60_000,
  })

  const options = inCategory.data?.items ?? []
  useEffect(() => {
    if (fixed || equipmentId === '') return
    const chosen = options.find((item) => item.id === equipmentId)
    setDepartmentId(chosen?.department_id ?? null)
  }, [equipmentId, options, fixed])

  const suggested = department.data?.forms?.[0]?.form_id
  useEffect(() => {
    if (suggested && formId === '') setFormId(suggested)
  }, [suggested, formId])

  const start = useMutation({
    mutationFn: async () => inspectNow({
      facility_id: facilityId,
      ...(target?.kind === 'vehicle' ? { vehicle_id: target.id } : { equipment_id: Number(equipmentId) }),
      form_id: formId === '' ? null : Number(formId),
      scheduled_on: when || null,
      inspector_id: inspector === '' ? null : Number(inspector),
    }),
    onSuccess: (visit) => {
      void queryClient.invalidateQueries({ queryKey: ['visits'] })
      void queryClient.invalidateQueries({ queryKey: ['department-detail'] })
      void queryClient.invalidateQueries({ queryKey: ['inspection-dashboard'] })
      onClose()
      navigate(`/inspection-visits/${visit.id}`)
    },
    onError: (error) => setProblem(errorMessage(error, 'That inspection could not be started.')),
  })

  const forms = library.data?.items ?? []
  const ready = (fixed || equipmentId !== '') && formId !== ''

  return (
    <Dialog open onClose={onClose} fullWidth PaperProps={{ sx: { borderRadius: '18px', maxWidth: 560 } }}>
      <DialogTitle sx={{ fontWeight: 900 }}>
        {target ? `Inspect ${target.name}` : 'New inspection'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.6} sx={{ mt: 0.5 }}>
          {!fixed && (
            <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <TextField
                select size="small" label="Category" required value={category}
                onChange={(e) => { setCategory(e.target.value as CategoryCode); setEquipmentId(''); setFormId('') }}
                InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}
              >
                <MenuItem value="">Choose a category</MenuItem>
                {CATEGORIES.map((c) => <MenuItem key={c.code} value={c.code}>{c.name}</MenuItem>)}
              </TextField>
              <TextField
                select size="small" label="Equipment" required value={equipmentId}
                onChange={(e) => setEquipmentId(e.target.value === '' ? '' : Number(e.target.value))}
                InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}
                disabled={category === ''}
              >
                <MenuItem value="">{category === '' ? 'Pick a category first' : 'Choose equipment'}</MenuItem>
                {options.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.name}{item.location_label ? ` · ${item.location_label}` : ''}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          )}

          <TextField
            select size="small" label="Inspect on" required value={formId}
            onChange={(e) => setFormId(e.target.value === '' ? '' : Number(e.target.value))}
            InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}
            helperText={department.data?.department
              ? `${department.data.department.name}'s form is chosen by default`
              : 'This item is not in a department, so choose the form to inspect it on'}
          >
            {library.isLoading && <MenuItem value="">Loading forms…</MenuItem>}
            {!library.isLoading && !forms.length && (
              <MenuItem value="">No forms have been built yet</MenuItem>
            )}
            {forms.map((form) => <MenuItem key={form.id} value={form.id}>{form.name}</MenuItem>)}
          </TextField>

          <Box sx={{ display: 'grid', gap: 1.4, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField
              size="small" type="date" label="Date" value={when}
              onChange={(e) => setWhen(e.target.value)} InputLabelProps={{ shrink: true }}
            />
            <TextField
              select size="small" label="Inspector" value={inspector}
              onChange={(e) => setInspector(e.target.value === '' ? '' : Number(e.target.value))}
              InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}
            >
              <MenuItem value="">Me</MenuItem>
              {(people.data ?? []).map((person) => (
                <MenuItem key={person.id} value={person.id}>{person.name}</MenuItem>
              ))}
            </TextField>
          </Box>

          <Typography sx={{ fontSize: 12, fontWeight: 700, color: palette.textMuted }}>
            It opens straight away for filling in, whether or not it was due. Passing it moves its next date on.
          </Typography>
          {problem && <Typography sx={{ fontSize: 12.5, color: palette.danger, fontWeight: 700 }}>{problem}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 800, color: palette.textMuted }}>Cancel</Button>
        <Button
          variant="contained" disabled={!ready || start.isPending} onClick={() => start.mutate()}
          sx={{ fontWeight: 900, borderRadius: '11px', bgcolor: palette.brand,
                '&:hover': { bgcolor: palette.brandDeep } }}
        >
          Start inspection
        </Button>
      </DialogActions>
    </Dialog>
  )
}
