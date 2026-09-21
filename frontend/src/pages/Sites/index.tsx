/**
 * The hospitals you run, and the way into one.
 *
 * This is the top of the system. You register Hospital A, click it, and land
 * on its dashboard with every other screen now scoped to it — which is the
 * order the work actually happens in, and was not expressed anywhere before.
 * "Facilities" was a management table of customer sites, inherited from a
 * contractor's product; picking a site was something you did again on every
 * screen rather than once at the start.
 *
 * With many sites a grid of cards grows past the screen, so each site is one
 * slim row that drops open into its inspection numbers. One is open at a time
 * and the open one is kept in the address, so coming back to Sites finds it
 * still open.
 */
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Box, Button, ButtonBase, Chip, CircularProgress, Collapse, InputAdornment, Stack, TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ApartmentIcon from '@mui/icons-material/Apartment'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import SearchIcon from '@mui/icons-material/Search'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import LockIcon from '@mui/icons-material/Lock'
import PendingActionsIcon from '@mui/icons-material/PendingActions'
import { fetchFacilities, type Facility } from '@/api/facilities'
import {
  fetchInspectionDashboard, statusPath, type DashboardSite, type InspectionState,
} from '@/api/inspectionProgramme'
import { hasPermission } from '@/config/permissions'
import { useFacilityStore } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'
import { CountTile } from '@/pages/Inspections/programme/parts'
import RegisterSiteDialog from './RegisterSiteDialog'

const SIZE_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large' }

// The six numbers a site drops open into, each opening its own list.
const TILES: Array<[InspectionState, string, { color: string; bg: string }]> = [
  ['passed', 'Passed', { color: '#15803D', bg: '#F0FDF4' }],
  ['failed', 'Failed', { color: '#B45309', bg: '#FEF3C7' }],
  ['red_tagged', 'Red tagged', { color: '#B91C1C', bg: '#FEE2E2' }],
  ['in_progress', 'In progress', { color: '#1D4ED8', bg: '#EFF6FF' }],
  ['due', 'Due', { color: '#92400E', bg: '#FEF3C7' }],
  ['overdue', 'Overdue', { color: '#B91C1C', bg: '#FEE2E2' }],
]

export default function SitesPage() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const setFacilityId = useFacilityStore((s) => s.setFacilityId)
  const canAdd = hasPermission(user, 'facilities', 'add')
  const canSeeInspections = hasPermission(user, 'inspections', 'index')
  const [search, setSearch] = useState('')
  const [params, setParams] = useSearchParams()
  const [registerOpen, setRegisterOpen] = useState(false)
  // These roles see only the hospitals they are assigned to, so an empty
  // list means something different for them than for an administrator.
  const scopedToOwnSites = ['facility_admin', 'facility_manager', 'technician', 'client']
    .includes(String(user?.role ?? ''))

  const { data, isLoading } = useQuery({
    queryKey: ['facilities', 'sites'],
    queryFn: () => fetchFacilities({ limit: 200 }),
  })
  // Every site's inspection numbers in one request, not one per row.
  const board = useQuery({
    queryKey: ['inspection-dashboard'],
    queryFn: fetchInspectionDashboard,
    staleTime: 30_000,
    enabled: canSeeInspections,
  })
  const numbers = useMemo(
    () => new Map((board.data?.sites ?? []).map((row) => [row.facility_id, row])),
    [board.data],
  )

  const sites = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const items = (data?.items ?? []) as Facility[]
    if (!needle) return items
    return items.filter((f) =>
      [f.name, f.city, f.state].some((v) => String(v ?? '').toLowerCase().includes(needle)))
  }, [data, search])

  /** Choosing a site is choosing the context every other screen works in. */
  const open = (id: number) => {
    setFacilityId(id)
    navigate(`/sites/${id}`)
  }
  const list = (id: number, state: InspectionState) => {
    setFacilityId(id)
    navigate(statusPath(state, { site: id }))
  }

  // A single site, or a search down to one, is simply open.
  const openParam = Number(params.get('open')) || null
  const expanded = sites.length === 1 ? sites[0].id : openParam
  const toggle = (id: number) => {
    const next = new URLSearchParams(params)
    if (expanded === id) next.delete('open')
    else next.set('open', String(id))
    setParams(next, { replace: true })
  }

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5, mb: 2.5 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" sx={{ fontWeight: 900, color: palette.ink }}>Sites</Typography>
          <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>
            The hospitals you run. Open one to work in it.
          </Typography>
        </Box>
        {canAdd && (
          <Button
            variant="contained" startIcon={<AddIcon />}
            onClick={() => setRegisterOpen(true)}
            sx={{ fontWeight: 900, borderRadius: '12px', px: 2.5,
                  bgcolor: palette.brand, '&:hover': { bgcolor: palette.brandDeep } }}
          >
            Register a site
          </Button>
        )}
      </Stack>

      <TextField
        size="small" placeholder="Find a site…" value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 2.5, maxWidth: 360, width: '100%' }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 18, color: palette.textFaint }} />
            </InputAdornment>
          ),
        }}
      />

      {isLoading && <Box sx={{ p: 6, textAlign: 'center' }}><CircularProgress size={26} /></Box>}

      {!isLoading && !sites.length && (
        <Box sx={{ p: 6, textAlign: 'center', borderRadius: '18px',
                   border: `1px solid ${palette.borderSoft}`, bgcolor: palette.white }}>
          <Typography sx={{ fontWeight: 800, color: palette.textMuted }}>
            {data?.items?.length
              ? 'Nothing matches'
              : scopedToOwnSites
                ? 'You have not been assigned to a site'
                : 'No sites registered yet'}
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: 13, color: palette.textFaint, maxWidth: 440, mx: 'auto' }}>
            {data?.items?.length
              ? 'Try a different search.'
              : scopedToOwnSites
                // Without this, an unassigned technician sees an empty list and
                // reads it as "this hospital has no data" rather than "nobody
                // has given me access yet" — and reports the wrong problem.
                ? 'Your account only sees hospitals it is assigned to, and it has none yet. Ask an administrator to add you to a site.'
                : 'Register your first hospital. Everything else — buildings, rooms, fixtures, assets and work orders — hangs off a site.'}
          </Typography>
        </Box>
      )}

      <Stack spacing={1.2}>
        {sites.map((site) => (
          <SiteRow
            key={site.id} site={site} numbers={numbers.get(site.id)} showNumbers={canSeeInspections}
            expanded={expanded === site.id} onToggle={() => toggle(site.id)}
            onOpen={() => open(site.id)} onList={(state) => list(site.id, state)}
          />
        ))}
      </Stack>

      {registerOpen && (
        <RegisterSiteDialog
          open={registerOpen}
          onClose={() => setRegisterOpen(false)}
          // Straight into the hospital just created: it is what you were
          // going to do next, and it is empty until you do.
          onCreated={(id) => { setRegisterOpen(false); open(id) }}
        />
      )}
    </Box>
  )
}

function InspectionBadge({ status }: { status: 'pass' | 'sealed' | 'under_review' }) {
  if (status === 'sealed') {
    return (
      <Chip
        size="small"
        icon={<LockIcon sx={{ fontSize: '13px !important', color: '#B91C1C !important' }} />}
        label="Sealed"
        sx={{
          height: 23,
          fontWeight: 900,
          fontSize: 11,
          letterSpacing: 0.3,
          bgcolor: '#FEE2E2',
          color: '#991B1B',
          border: '1px solid #FCA5A5',
          boxShadow: '0 2px 5px rgba(185,28,28,0.12)',
          '& .MuiChip-icon': { ml: 0.8 },
        }}
      />
    )
  }

  if (status === 'under_review') {
    return (
      <Chip
        size="small"
        icon={<PendingActionsIcon sx={{ fontSize: '13px !important', color: '#B45309 !important' }} />}
        label="Under Review"
        sx={{
          height: 23,
          fontWeight: 900,
          fontSize: 11,
          letterSpacing: 0.3,
          bgcolor: '#FEF3C7',
          color: '#92400E',
          border: '1px solid #FCD34D',
          boxShadow: '0 2px 5px rgba(180,83,9,0.12)',
          '& .MuiChip-icon': { ml: 0.8 },
        }}
      />
    )
  }

  return (
    <Chip
      size="small"
      icon={<CheckCircleIcon sx={{ fontSize: '13px !important', color: '#047857 !important' }} />}
      label="Pass"
      sx={{
        height: 23,
        fontWeight: 900,
        fontSize: 11,
        letterSpacing: 0.3,
        bgcolor: '#ECFDF5',
        color: '#065F46',
        border: '1px solid #6EE7B7',
        boxShadow: '0 2px 5px rgba(4,120,87,0.12)',
        '& .MuiChip-icon': { ml: 0.8 },
      }}
    />
  )
}

function SiteRow({ site, numbers, showNumbers, expanded, onToggle, onOpen, onList }: {
  site: Facility
  numbers?: DashboardSite
  showNumbers: boolean
  expanded: boolean
  onToggle: () => void
  onOpen: () => void
  onList: (state: InspectionState) => void
}) {
  // Each row asks for its own estate numbers, as the cards did; the
  // inspection numbers come from the one dashboard request above.
  const { data: overview } = useQuery({
    queryKey: ['site-overview', site.id],
    queryFn: async () => {
      const { fetchSiteOverview } = await import('@/api/facilities')
      return fetchSiteOverview(site.id)
    },
    staleTime: 60_000,
  })

  const inspectionStatus = overview?.inspections?.status ?? 'pass'
  const isSealed = inspectionStatus === 'sealed'
  const panelId = `site-${site.id}-numbers`

  // What the closed row says: what needs someone, or that nothing does.
  const attention = numbers ? ([
    [numbers.red_tagged, 'red tag', '#fff', palette.danger],
    [numbers.overdue, 'overdue', '#B91C1C', '#FEE2E2'],
    [numbers.due, 'due', '#92400E', '#FEF3C7'],
  ] as Array<[number, string, string, string]>).filter(([count]) => count > 0) : []

  const facts = [
    numbers?.size_band ? SIZE_LABEL[numbers.size_band] : null,
    overview?.estate.beds ? `${overview.estate.beds} beds` : numbers?.beds ? `${numbers.beds} beds` : null,
    numbers ? `${numbers.departments} department${numbers.departments === 1 ? '' : 's'}` : null,
    numbers?.vehicles ? `${numbers.vehicles} vehicle${numbers.vehicles === 1 ? '' : 's'}` : null,
    overview?.estate.rooms ? `${overview.estate.rooms} room${overview.estate.rooms === 1 ? '' : 's'}` : null,
    overview ? `${overview.assets.total} assets` : null,
    overview ? `${overview.work.open} open job${overview.work.open === 1 ? '' : 's'}` : null,
  ].filter(Boolean)

  return (
    <Box
      sx={{
        borderRadius: '18px', bgcolor: palette.white, overflow: 'hidden',
        border: isSealed ? '1.5px solid #FCA5A5' : `1px solid ${expanded ? palette.brandBorder : palette.borderSoft}`,
        boxShadow: expanded ? palette.shadowCard : 'none',
        transition: 'border-color .16s ease, box-shadow .16s ease',
      }}
    >
      <ButtonBase
        onClick={onToggle} aria-expanded={expanded} aria-controls={panelId}
        sx={{ width: '100%', textAlign: 'left', px: 2, py: 1.5, display: 'flex', gap: 1.25,
              alignItems: 'center', flexWrap: { xs: 'wrap', sm: 'nowrap' },
              '&:hover': { bgcolor: expanded ? 'transparent' : palette.brandTint } }}
      >
        <ExpandMoreRoundedIcon sx={{ color: palette.textFaint, flexShrink: 0, transition: 'transform .16s ease',
                                     transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
        <Box sx={{ width: 38, height: 38, borderRadius: '12px', flexShrink: 0, display: 'grid', placeItems: 'center',
                   bgcolor: isSealed ? '#FEE2E2' : palette.brandTint, color: isSealed ? '#DC2626' : palette.brand,
                   '& svg': { fontSize: 21 } }}>
          <ApartmentIcon />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontWeight: 900, color: palette.ink, fontSize: 15.5 }}>{site.name}</Typography>
          <Typography noWrap sx={{ fontSize: 12.5, color: palette.textMuted, fontWeight: 600 }}>
            {[site.city, site.state].filter(Boolean).join(', ') || site.address}
          </Typography>
        </Box>
        <Stack direction="row" sx={{ gap: 0.6, flexWrap: 'wrap', justifyContent: 'flex-end',
                                     width: { xs: '100%', sm: 'auto' }, pl: { xs: 6.5, sm: 0 } }}>
          {inspectionStatus !== 'pass' && <InspectionBadge status={inspectionStatus} />}
          {attention.map(([count, word, color, bg]) => (
            <Chip key={word} size="small" label={`${count} ${word}`}
                  sx={{ height: 23, fontSize: 11, fontWeight: 900, color, bgcolor: bg }} />
          ))}
          {inspectionStatus === 'pass' && !attention.length && <InspectionBadge status="pass" />}
        </Stack>
      </ButtonBase>

      <Collapse in={expanded} unmountOnExit>
        <Box id={panelId} sx={{ px: 2, pb: 2, pt: 0.5 }}>
          {showNumbers && (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.2, mb: 1.5 }}>
              {TILES.map(([state, label, tone]) => (
                <CountTile key={state} label={label} tone={tone} value={numbers?.[state] ?? 0}
                           onClick={() => onList(state)} />
              ))}
            </Stack>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.2, alignItems: { sm: 'center' } }}>
            <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 700, color: palette.textMuted }}>
              {facts.join(' · ') || '…'}
            </Typography>
            <Button
              variant="contained" endIcon={<ArrowForwardRoundedIcon />} onClick={onOpen}
              sx={{ fontWeight: 900, borderRadius: '12px', px: 2.5, alignSelf: { xs: 'stretch', sm: 'auto' },
                    bgcolor: palette.brand, '&:hover': { bgcolor: palette.brandDeep } }}
            >
              Open site
            </Button>
          </Stack>
        </Box>
      </Collapse>
    </Box>
  )
}
