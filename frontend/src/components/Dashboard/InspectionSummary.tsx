/**
 * Inspections, across every site the person can see: the block at the top of
 * the dashboard.
 *
 * The numbers count items, not visits, because a red tag is against a piece of
 * equipment and that is what anybody asking "what is not up to standard here"
 * means. Choosing a site opens it; the rows are the same numbers per site.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Box, Chip, CircularProgress, MenuItem, Stack, TextField, Typography } from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import { fetchInspectionDashboard, type DashboardSite } from '@/api/inspectionProgramme'
import { useFacilityStore } from '@/hooks/useActiveFacility'
import { palette } from '@/theme/palette'
import { CountTile } from '@/pages/Inspections/programme/parts'

const SIZE_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large' }

export default function InspectionSummary() {
  const navigate = useNavigate()
  const setFacilityId = useFacilityStore((s) => s.setFacilityId)
  const [only, setOnly] = useState<number | ''>('')

  const board = useQuery({
    queryKey: ['inspection-dashboard'],
    queryFn: fetchInspectionDashboard,
    staleTime: 30_000,
  })

  if (board.isLoading) {
    return (
      <Box sx={{ p: 4, mb: 3, display: 'grid', placeItems: 'center', bgcolor: palette.white,
                 border: `1px solid ${palette.borderSoft}`, borderRadius: '18px' }}>
        <CircularProgress size={22} />
      </Box>
    )
  }
  if (!board.data || !board.data.sites.length) return null

  const sites = only === '' ? board.data.sites : board.data.sites.filter((row) => row.facility_id === only)
  const totals = only === ''
    ? board.data.totals
    : sites.reduce((sum, row) => ({
      ...sum,
      items: sum.items + row.items, passed: sum.passed + row.passed, failed: sum.failed + row.failed,
      red_tagged: sum.red_tagged + row.red_tagged, in_progress: sum.in_progress + row.in_progress,
      due: sum.due + row.due, overdue: sum.overdue + row.overdue,
      not_scheduled: sum.not_scheduled + row.not_scheduled,
    }), { items: 0, passed: 0, failed: 0, red_tagged: 0, in_progress: 0, due: 0, overdue: 0, not_scheduled: 0 })

  const open = (site: DashboardSite) => {
    setFacilityId(site.facility_id)
    navigate(`/sites/${site.facility_id}`)
  }

  return (
    <Box sx={{ mb: 3, border: `1px solid ${palette.borderSoft}`, borderRadius: '18px', bgcolor: palette.white,
               overflow: 'hidden' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2}
             sx={{ px: 2, py: 1.6, alignItems: { sm: 'center' } }}>
        <Stack direction="row" spacing={1.2} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: '13px', display: 'grid', placeItems: 'center',
                     color: palette.brand, bgcolor: palette.brandTint, '& svg': { fontSize: 22 } }}>
            <FactCheckOutlinedIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900, fontSize: 16, color: palette.ink }}>Inspections</Typography>
            <Typography sx={{ fontSize: 12.5, color: palette.textMuted, fontWeight: 700 }}>
              {totals.items} item{totals.items === 1 ? '' : 's'} across {board.data.sites.length} site
              {board.data.sites.length === 1 ? '' : 's'} · due means within {board.data.due_soon_days} days
            </Typography>
          </Box>
        </Stack>
        <TextField
          select size="small" value={only} label="Site" sx={{ minWidth: 200 }}
          onChange={(e) => setOnly(e.target.value === '' ? '' : Number(e.target.value))}
          InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}
        >
          <MenuItem value="">All sites</MenuItem>
          {board.data.sites.map((site) => (
            <MenuItem key={site.facility_id} value={site.facility_id}>{site.name}</MenuItem>
          ))}
        </TextField>
      </Stack>

      <Stack direction="row" spacing={1.2} sx={{ px: 2, pb: 1.8, flexWrap: 'wrap', gap: 1.2 }}>
        <CountTile label="Passed" value={totals.passed} tone={{ color: '#15803D', bg: '#F0FDF4' }} />
        <CountTile label="Failed" value={totals.failed} tone={{ color: '#B45309', bg: '#FEF3C7' }} />
        <CountTile label="Red tagged" value={totals.red_tagged} tone={{ color: '#B91C1C', bg: '#FEE2E2' }} />
        <CountTile label="In progress" value={totals.in_progress} tone={{ color: '#1D4ED8', bg: '#EFF6FF' }} />
        <CountTile label="Due" value={totals.due} tone={{ color: '#92400E', bg: '#FEF3C7' }} />
        <CountTile label="Overdue" value={totals.overdue} tone={{ color: '#B91C1C', bg: '#FEE2E2' }} />
      </Stack>

      <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 32px',
                 px: 2, py: 1, gap: 1.2, bgcolor: palette.surfaceMuted }}>
        {['Site', 'Passed', 'Failed', 'Red tag', 'Due', 'Overdue', ''].map((head) => (
          <Typography key={head} sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.4,
                                       textTransform: 'uppercase', color: palette.textSubtle }}>{head}</Typography>
        ))}
      </Box>

      {sites.map((site) => (
        <Box
          key={site.facility_id}
          onClick={() => open(site)}
          sx={{ display: 'grid', gap: 1.2, alignItems: 'center', cursor: 'pointer',
                gridTemplateColumns: { xs: '1fr auto', md: '2fr 1fr 1fr 1fr 1fr 1fr 32px' },
                px: 2, py: 1.4, borderTop: `1px solid ${palette.borderSoft}`,
                '&:hover': { bgcolor: palette.brandTint } }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 900, fontSize: 14, color: palette.ink }}>{site.name}</Typography>
            <Typography noWrap sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 700 }}>
              {[
                site.size_band ? SIZE_LABEL[site.size_band] : null,
                site.beds ? `${site.beds} beds` : null,
                `${site.departments} department${site.departments === 1 ? '' : 's'}`,
                site.vehicles ? `${site.vehicles} vehicle${site.vehicles === 1 ? '' : 's'}` : null,
              ].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5} sx={{ display: { xs: 'flex', md: 'none' }, flexWrap: 'wrap', gap: 0.5,
                                                     gridColumn: '1 / -1' }}>
            {site.red_tagged > 0 && <Chip size="small" label={`${site.red_tagged} red tag`}
                  sx={{ height: 21, fontSize: 10.5, fontWeight: 900, color: '#fff', bgcolor: palette.danger }} />}
            {site.overdue > 0 && <Chip size="small" label={`${site.overdue} overdue`}
                  sx={{ height: 21, fontSize: 10.5, fontWeight: 900, color: '#B91C1C', bgcolor: '#FEE2E2' }} />}
            {site.due > 0 && <Chip size="small" label={`${site.due} due`}
                  sx={{ height: 21, fontSize: 10.5, fontWeight: 900, color: '#92400E', bgcolor: '#FEF3C7' }} />}
            <Chip size="small" label={`${site.passed} passed`}
                  sx={{ height: 21, fontSize: 10.5, fontWeight: 900, color: '#15803D', bgcolor: '#F0FDF4' }} />
          </Stack>
          {([
            [site.passed, '#15803D'], [site.failed, '#B45309'], [site.red_tagged, '#B91C1C'],
            [site.due, '#92400E'], [site.overdue, '#B91C1C'],
          ] as Array<[number, string]>).map(([value, colour], index) => (
            <Typography key={index} sx={{ display: { xs: 'none', md: 'block' }, fontSize: 14, fontWeight: 900,
                                          color: value ? colour : palette.textFaint }}>
              {value}
            </Typography>
          ))}
          <ChevronRightRoundedIcon sx={{ color: palette.textFaint, justifySelf: 'end' }} />
        </Box>
      ))}
    </Box>
  )
}
