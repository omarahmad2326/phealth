/**
 * The site's inspection visits: what is open and what has been done.
 *
 * A visit is a date, a scope and the items that were due by then. This screen
 * is the queue; the work happens inside one.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import { fetchVisits, shortDate } from '@/api/inspectionProgramme'
import { hasPermission } from '@/config/permissions'
import { useActiveFacility } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'
import { ResultChip } from '@/pages/Inspections/programme/parts'
import InspectNowDialog from '@/pages/Inspections/programme/InspectNowDialog'
import ScheduleVisitDialog from '@/pages/Inspections/programme/ScheduleVisitDialog'

const SCOPE_LABEL: Record<string, string> = {
  department: 'Department', facility: 'Whole site', fleet: 'Fleet',
}

export default function InspectionVisitsPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { facilityId, facility } = useActiveFacility()
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open')
  const [scheduling, setScheduling] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const canAdd = hasPermission(user, 'inspections', 'add')
  // The Inspection card on the site page lands here ready to start one.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (params.get('new') === '1' && canAdd) {
      setInspecting(true)
      params.delete('new')
      setParams(params, { replace: true })
    }
  }, [params, setParams, canAdd])

  const list = useQuery({
    queryKey: ['visits', facilityId, filter],
    queryFn: () => fetchVisits(facilityId as number, filter === 'all' ? {} : { status: filter }),
    enabled: !!facilityId,
    placeholderData: (previous) => previous,
  })
  const visits = list.data?.items ?? []

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }}
             sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5, mb: 2.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
                            color: palette.textSubtle }}>
            Inspections
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 900, color: palette.ink, lineHeight: 1.15 }}>Visits</Typography>
          <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>
            {facility?.name ?? 'This site'} · {list.isLoading ? '…' : visits.length} {filter === 'all' ? 'in all' : filter}
          </Typography>
        </Box>
        {canAdd && (
          <Stack direction="row" spacing={1}>
            {/* Two ways in, as with service: plan the round, or inspect one
                thing you are standing in front of. */}
            <Button variant="outlined" startIcon={<PlaylistAddCheckIcon />} onClick={() => setInspecting(true)}
                    sx={{ fontWeight: 900, borderRadius: '12px' }}>
              New inspection
            </Button>
            <Button variant="contained" startIcon={<EventAvailableOutlinedIcon />} onClick={() => setScheduling(true)}
                    sx={{ fontWeight: 900, borderRadius: '12px', px: 2.5, bgcolor: palette.brand,
                          '&:hover': { bgcolor: palette.brandDeep } }}>
              Schedule inspection
            </Button>
          </Stack>
        )}
      </Stack>

      <Stack direction="row" spacing={0.8} sx={{ mb: 2, flexWrap: 'wrap', gap: 0.8 }}>
        {(['open', 'done', 'all'] as const).map((value) => (
          <Chip
            key={value} label={value === 'open' ? 'Open' : value === 'done' ? 'Done' : 'All'}
            onClick={() => setFilter(value)}
            sx={{
              fontWeight: 900, fontSize: 12,
              bgcolor: filter === value ? palette.brand : palette.white,
              color: filter === value ? '#fff' : palette.textStrong,
              border: `1px solid ${filter === value ? palette.brand : palette.borderSoft}`,
            }}
          />
        ))}
      </Stack>

      <Box sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '18px', bgcolor: palette.white,
                 overflow: 'hidden' }}>
        {list.isLoading && <Box sx={{ p: 4, display: 'grid', placeItems: 'center' }}><CircularProgress size={22} /></Box>}
        {!list.isLoading && !visits.length && (
          <Typography sx={{ p: 4, textAlign: 'center', fontWeight: 700, color: palette.textMuted }}>
            No visits here. Schedule one and it will hold whatever is due by its date.
          </Typography>
        )}
        {visits.map((visit) => (
          <Box
            key={visit.id}
            onClick={() => navigate(`/inspection-visits/${visit.id}`)}
            sx={{ display: 'grid', gap: 1.2, alignItems: 'center',
                  gridTemplateColumns: { xs: '1fr auto', md: '1.6fr 1.4fr 1fr 1fr 1fr' },
                  px: 2, py: 1.4, borderTop: `1px solid ${palette.borderSoft}`, cursor: 'pointer',
                  '&:hover': { bgcolor: palette.brandTint } }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 900, fontSize: 14, color: palette.ink }}>
                {visit.department ?? SCOPE_LABEL[visit.scope] ?? visit.scope}
              </Typography>
              <Typography noWrap sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 700 }}>
                {visit.number} · {SCOPE_LABEL[visit.scope] ?? visit.scope}
              </Typography>
            </Box>
            <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: 13, fontWeight: 800,
                              color: palette.textStrong }}>
              {shortDate(visit.scheduled_on)}
            </Typography>
            <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: 13, fontWeight: 700,
                              color: palette.textStrong }}>
              {visit.inspector?.name ?? 'Nobody yet'}
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: palette.textStrong }}>
              {visit.done} of {visit.items}
            </Typography>
            <Stack direction="row" spacing={0.6} sx={{ justifySelf: { md: 'start' } }}>
              <ResultChip result={visit.result} />
            </Stack>
          </Box>
        ))}
      </Box>

      {scheduling && facilityId && (
        <ScheduleVisitDialog facilityId={facilityId} onClose={() => setScheduling(false)} />
      )}
      {inspecting && facilityId && (
        <InspectNowDialog facilityId={facilityId} onClose={() => setInspecting(false)} />
      )}
    </Box>
  )
}
