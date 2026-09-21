/**
 * Bring an asset from the register into a Facility Category.
 *
 * It keeps its tag, cost, dates and history; it gains a name, a category and
 * its department, so it shows in Electrical, Plumbing, Mechanical or HVAC
 * alongside everything entered there, without typing it in again.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography,
} from '@mui/material'
import { toast } from 'react-toastify'
import {
  adoptIntoCategory, errorMessage, fetchCategoryOverview, type CategoryCode,
} from '@/api/siteCategories'
import { fetchProgrammeDepartments } from '@/api/inspectionProgramme'
import { CATEGORIES, CATEGORIES_LABEL } from '@/config/siteCategories'
import { palette } from '@/theme/palette'
import { assetTitle } from '../Assets/assetTitle'
import { DepartmentField, Section, Suggesting } from './EquipmentDialog'

const TRADE_TO_CATEGORY: Record<string, CategoryCode> = {
  electrical: 'electrical', plumbing: 'plumbing', mechanical: 'mechanical', hvac: 'hvac',
  building: 'building', building_envelope: 'building', landscaping: 'landscaping', parking: 'parking',
  vertical_transport: 'mechanical', medical_gas: 'mechanical', fire_life_safety: 'mechanical',
}

export default function AdoptDialog({ asset, tradeCode, onClose }: {
  asset: any
  /** The asset's current trade, used to suggest a category. */
  tradeCode?: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const facilityId: number = asset.facility_id
  const [category, setCategory] = useState<CategoryCode>(TRADE_TO_CATEGORY[tradeCode ?? ''] ?? 'electrical')
  const suggestedName = assetTitle(asset) === '—' ? asset.asset_tag : assetTitle(asset)
  const [name, setName] = useState(suggestedName)
  const [type, setType] = useState(asset.type_label ?? '')
  const [departmentId, setDepartmentId] = useState<number | ''>(asset.department_id ?? '')

  const { data: overview } = useQuery({
    queryKey: ['category-overview', facilityId],
    queryFn: () => fetchCategoryOverview(facilityId),
    staleTime: 60_000,
  })
  const departments = useQuery({
    queryKey: ['programme-departments', facilityId],
    queryFn: () => fetchProgrammeDepartments(facilityId),
    staleTime: 60_000,
  })
  const types = overview?.categories.find((c) => c.code === category)?.types ?? []
  const ready = name.trim() && type.trim()

  const adopt = useMutation({
    mutationFn: () => adoptIntoCategory(category, asset.id, {
      name: name.trim(), type: type.trim(), department_id: departmentId === '' ? null : Number(departmentId),
    }),
    onSuccess: (saved) => {
      toast.success(`${saved.asset_tag} is now ${saved.name} in ${saved.category_name}`)
      ;['equipment', 'category-equipment', 'category-overview', 'programme-departments', 'inspection-dashboard']
        .forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }))
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not add it to the category')),
  })

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '18px', maxWidth: 600 } }}>
      <DialogTitle sx={{ fontWeight: 900, color: palette.ink, pb: 1 }}>
        Add to a category
        <Typography component="span" sx={{ ml: 1, fontSize: 13, fontWeight: 800, color: palette.textFaint }}>
          {asset.asset_tag}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ fontSize: 13, color: palette.textMuted, fontWeight: 600 }}>
          It keeps its tag, cost and history, and appears in {CATEGORIES_LABEL} with everything else there.
        </Typography>
        <Box sx={{ mt: 2, display: 'grid', gap: 1.75, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' } }}>
          <TextField select size="small" label="Category" value={category}
                     onChange={(e) => setCategory(e.target.value as CategoryCode)}>
            {CATEGORIES.map((c) => <MenuItem key={c.code} value={c.code}>{c.name}</MenuItem>)}
          </TextField>
          <Box />
          <TextField size="small" label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Suggesting label="Type" required value={type} onChange={setType} options={types}
                      placeholder="Pick or type your own" />
        </Box>
        <Section title="Department">
          <DepartmentField value={departmentId} onChange={setDepartmentId}
                           departments={departments.data?.items ?? []} loading={departments.isLoading} />
        </Section>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 800, color: palette.textMuted }}>Cancel</Button>
        <Button
          variant="contained" disabled={!ready || adopt.isPending}
          onClick={() => adopt.mutate(undefined, { onSuccess: () => navigate(`/categories/${category}`) })}
          sx={{ fontWeight: 900, borderRadius: '10px', bgcolor: palette.brand, '&:hover': { bgcolor: palette.brandDeep },
                '&.Mui-disabled': { bgcolor: palette.surfaceMuted, color: palette.textFaint } }}
        >
          {adopt.isPending ? 'Adding…' : 'Add to category'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
