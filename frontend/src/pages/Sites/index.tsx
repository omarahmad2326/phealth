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
 * Four cards on top count sites: Passed, Failed, Overdue and Passed all
 * inspections, each site judged on its items' latest results. A card filters
 * the rows below to its sites. Each site is one slim row with its status that
 * drops open into its departments - passed out of total in each - and every
 * department card opens that department. One row is open at a time and the
 * open one is kept in the address, so coming back to Sites finds it open.
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
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import SearchIcon from '@mui/icons-material/Search'
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded'
import { fetchFacilities, type Facility } from '@/api/facilities'
import {
  fetchInspectionDashboard, type BreakdownRow, type DashboardSite, type SiteStatus,
} from '@/api/inspectionProgramme'
import { hasPermission } from '@/config/permissions'
import { useFacilityStore } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'
import { CountTile } from '@/pages/Inspections/programme/parts'
import RegisterSiteDialog from './RegisterSiteDialog'

const SIZE_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large' }

type SiteFilter = 'passed' | 'failed' | 'overdue' | 'passed_all'

// The cards above the sites. They overlap on purpose: a site can be Failed
// and Overdue, and every site that Passed all has also Passed.
const SITE_CARDS: Array<[SiteFilter, string, { color: string; bg: string }]> = [
  ['passed', 'Passed', { color: '#15803D', bg: '#F0FDF4' }],
  ['failed', 'Failed', { color: '#B91C1C', bg: '#FEE2E2' }],
  ['overdue', 'Overdue', { color: '#B45309', bg: '#FEF3C7' }],
  ['passed_all', 'Passed all inspections', { color: '#065F46', bg: '#D1FAE5' }],
]

const FILTER_WORDS: Record<SiteFilter, string> = {
  passed: 'passed', failed: 'failed', overdue: 'overdue', passed_all: 'passed all inspections',
}

const matches = (filter: SiteFilter, numbers?: DashboardSite) => {
  if (!numbers) return false
  if (filter === 'passed') return numbers.status === 'passed' || numbers.status === 'passed_all'
  if (filter === 'failed') return numbers.status === 'failed'
  if (filter === 'overdue') return numbers.overdue > 0
  return numbers.status === 'passed_all'
}

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
  // Every site's status and departments in one request, not one per row.
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

  const showParam = params.get('show') as SiteFilter | null
  const filter = showParam && showParam in FILTER_WORDS && board.data ? showParam : null

  const sites = useMemo(() => {
    const needle = search.trim().toLowerCase()
    let items = (data?.items ?? []) as Facility[]
    if (filter) items = items.filter((f) => matches(filter, numbers.get(f.id)))
    if (!needle) return items
    return items.filter((f) =>
      [f.name, f.city, f.state].some((v) => String(v ?? '').toLowerCase().includes(needle)))
  }, [data, search, filter, numbers])

  const change = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  /** Choosing a site is choosing the context every other screen works in. */
  const open = (id: number) => {
    setFacilityId(id)
    navigate(`/sites/${id}`)
  }
  const openPart = (id: number, part: BreakdownRow) => {
    setFacilityId(id)
    if (part.kind === 'fleet') navigate('/fleet')
    else if (part.kind === 'unassigned' || part.id == null) navigate('/departments')
    else navigate(`/departments/${part.id}`)
  }

  // A single site, or a search or filter down to one, is simply open.
  const openParam = Number(params.get('open')) || null
  const expanded = sites.length === 1 ? sites[0].id : openParam
  const toggle = (id: number) => change('open', expanded === id ? null : String(id))

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5, mb: 2.5 }}
      >
        <Stack direction="row" spacing={2} alignItems="center" sx={{ minWidth: 0 }}>
          <Box
            component="img" src="/punjab-logo.png" alt="Government of the Punjab"
            sx={{ width: { xs: 56, sm: 72 }, height: { xs: 56, sm: 72 }, flexShrink: 0, objectFit: 'contain' }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h4" sx={{ fontWeight: 900, color: palette.ink }}>Punjab Health - Sites</Typography>
            <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>
              The hospitals you run. Open one to work in it.
            </Typography>
          </Box>
        </Stack>
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

      {board.data && board.data.site_totals.sites > 0 && (
        <Box sx={{ display: 'grid', gap: 1.2, mb: 2.5,
                   gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' } }}>
          {SITE_CARDS.map(([key, label, tone]) => (
            <CountTile
              key={key} label={label} tone={tone} value={board.data.site_totals[key]}
              active={filter === key} action="Show these sites"
              onClick={() => change('show', filter === key ? null : key)}
            />
          ))}
        </Box>
      )}

      <Stack direction="row" sx={{ mb: 2.5, gap: 1.2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          size="small" placeholder="Find a site…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ maxWidth: 360, width: '100%' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: palette.textFaint }} />
              </InputAdornment>
            ),
          }}
        />
        {filter && (
          <Chip
            label={`Sites that ${filter === 'overdue' ? 'have something overdue' : FILTER_WORDS[filter]}`}
            onDelete={() => change('show', null)}
            sx={{ fontWeight: 800, bgcolor: palette.brandTint, color: palette.brandDeep }}
          />
        )}
      </Stack>

      {isLoading && <Box sx={{ p: 6, textAlign: 'center' }}><CircularProgress size={26} /></Box>}

      {!isLoading && !sites.length && (
        <Box sx={{ p: 6, textAlign: 'center', borderRadius: '18px',
                   border: `1px solid ${palette.borderSoft}`, bgcolor: palette.white }}>
          <Typography sx={{ fontWeight: 800, color: palette.textMuted }}>
            {filter
              ? `No site has ${filter === 'overdue' ? 'anything overdue' : FILTER_WORDS[filter]} right now`
              : data?.items?.length
                ? 'Nothing matches'
                : scopedToOwnSites
                  ? 'You have not been assigned to a site'
                  : 'No sites registered yet'}
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: 13, color: palette.textFaint, maxWidth: 440, mx: 'auto' }}>
            {filter
              ? 'Clear the filter to see every site.'
              : data?.items?.length
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
            onOpen={() => open(site.id)} onPart={(part) => openPart(site.id, part)}
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

const STATUS_STYLE: Record<SiteStatus | 'none', { label: string; color: string; bg: string; icon?: JSX.Element }> = {
  passed_all: { label: 'Passed all', color: '#fff', bg: '#047857',
                icon: <VerifiedRoundedIcon sx={{ fontSize: '14px !important', color: '#fff !important' }} /> },
  passed: { label: 'Passed', color: '#065F46', bg: '#ECFDF5',
            icon: <CheckCircleRoundedIcon sx={{ fontSize: '14px !important', color: '#047857 !important' }} /> },
  failed: { label: 'Failed', color: '#fff', bg: '#DC2626',
            icon: <CancelRoundedIcon sx={{ fontSize: '14px !important', color: '#fff !important' }} /> },
  none: { label: 'Not inspected yet', color: palette.textMuted, bg: palette.surfaceMuted },
}

function StatusBadge({ status }: { status: SiteStatus | null }) {
  const style = STATUS_STYLE[status ?? 'none']
  return (
    <Chip
      size="small" icon={style.icon} label={style.label}
      sx={{ height: 23, fontWeight: 900, fontSize: 11, letterSpacing: 0.2, color: style.color, bgcolor: style.bg,
            '& .MuiChip-icon': { ml: 0.7 } }}
    />
  )
}

function SiteRow({ site, numbers, showNumbers, expanded, onToggle, onOpen, onPart }: {
  site: Facility
  numbers?: DashboardSite
  showNumbers: boolean
  expanded: boolean
  onToggle: () => void
  onOpen: () => void
  onPart: (part: BreakdownRow) => void
}) {
  const panelId = `site-${site.id}-departments`
  const failed = numbers?.status === 'failed'

  // Beside the status: what is late, and what is coming.
  const chips = numbers ? ([
    [numbers.overdue, 'overdue', '#B91C1C', '#FEE2E2'],
    [numbers.due, 'due', '#92400E', '#FEF3C7'],
  ] as Array<[number, string, string, string]>).filter(([count]) => count > 0) : []

  const beds = numbers?.beds ?? site.beds
  const sizeBand = numbers?.size_band ?? site.size_band
  const facts = [
    sizeBand ? SIZE_LABEL[sizeBand] : null,
    beds ? `${beds} beds` : null,
    numbers ? `${numbers.departments} department${numbers.departments === 1 ? '' : 's'}` : null,
    numbers?.vehicles ? `${numbers.vehicles} vehicle${numbers.vehicles === 1 ? '' : 's'}` : null,
  ].filter(Boolean)

  return (
    <Box
      sx={{
        borderRadius: '18px', bgcolor: palette.white, overflow: 'hidden',
        border: failed ? '1.5px solid #FCA5A5' : `1px solid ${expanded ? palette.brandBorder : palette.borderSoft}`,
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
                   bgcolor: failed ? '#FEE2E2' : palette.brandTint, color: failed ? '#DC2626' : palette.brand,
                   '& svg': { fontSize: 21 } }}>
          <ApartmentIcon />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontWeight: 900, color: palette.ink, fontSize: 15.5 }}>{site.name}</Typography>
          <Typography noWrap sx={{ fontSize: 12.5, color: palette.textMuted, fontWeight: 600 }}>
            {[site.city, site.state].filter(Boolean).join(', ') || site.address}
          </Typography>
        </Box>
        {showNumbers && numbers && (
          <Stack direction="row" sx={{ gap: 0.6, flexWrap: 'wrap', justifyContent: 'flex-end',
                                       width: { xs: '100%', sm: 'auto' }, pl: { xs: 6.5, sm: 0 } }}>
            <StatusBadge status={numbers.status} />
            {chips.map(([count, word, color, bg]) => (
              <Chip key={word} size="small" label={`${count} ${word}`}
                    sx={{ height: 23, fontSize: 11, fontWeight: 900, color, bgcolor: bg }} />
            ))}
          </Stack>
        )}
      </ButtonBase>

      <Collapse in={expanded} unmountOnExit>
        <Box id={panelId} sx={{ px: 2, pb: 2, pt: 0.5 }}>
          {showNumbers && numbers && (numbers.breakdown.length ? (
            <Box sx={{ display: 'grid', gap: 1.2, mb: 1.5,
                       gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 140px), 1fr))' }}>
              {numbers.breakdown.map((part) => (
                <DepartmentCard key={`${part.kind}-${part.id ?? 'none'}`} part={part} onClick={() => onPart(part)} />
              ))}
            </Box>
          ) : (
            <Typography sx={{ mb: 1.5, fontSize: 13, fontWeight: 700, color: palette.textFaint }}>
              No departments or equipment yet.
            </Typography>
          ))}
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.2, alignItems: { sm: 'center' } }}>
            <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 700, color: palette.textMuted }}>
              {facts.join(' · ')}
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

/** One department: how much of its equipment passed its latest inspection. */
function DepartmentCard({ part, onClick }: { part: BreakdownRow; onClick: () => void }) {
  const all = part.items > 0 && part.passed === part.items
  const share = (count: number) => (part.items ? `${(count / part.items) * 100}%` : '0%')
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={`${part.name}: ${part.passed} of ${part.items} passed`
        + `${part.failed ? `, ${part.failed} failed` : ''}. Open it`}
      sx={{
        display: 'block', textAlign: 'left', p: 1.5, borderRadius: '14px', minWidth: 0,
        border: `1px solid ${part.failed ? '#FCA5A5' : palette.borderSoft}`,
        bgcolor: part.failed ? '#FFF7F7' : palette.white,
        transition: 'transform .12s ease, box-shadow .12s ease',
        '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 4px 14px rgba(15,23,42,0.08)' },
        '&:focus-visible': { outline: `2px solid ${palette.brand}`, outlineOffset: 2 },
      }}
    >
      <Typography noWrap sx={{ fontSize: 13, fontWeight: 900, color: palette.ink }}>{part.name}</Typography>
      {part.items ? (
        <>
          <Typography sx={{ mt: 0.4, fontSize: 20, fontWeight: 900, lineHeight: 1.15,
                            color: all ? '#047857' : palette.ink }}>
            {part.passed} / {part.items}
            <Box component="span" sx={{ ml: 0.6, fontSize: 12, fontWeight: 800, color: palette.textMuted }}>
              passed
            </Box>
          </Typography>
          {/* Passed, then failed, then what has not been inspected yet. */}
          <Box sx={{ mt: 0.8, height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex',
                     bgcolor: palette.surfaceMuted }}>
            <Box sx={{ width: share(part.passed), bgcolor: '#10B981' }} />
            <Box sx={{ width: share(part.failed), bgcolor: '#EF4444' }} />
          </Box>
          <Typography sx={{ mt: 0.6, fontSize: 12, fontWeight: 800,
                            color: part.failed ? '#B91C1C' : palette.textFaint }}>
            {part.failed
              ? `${part.failed} failed${part.red_tagged ? ` (${part.red_tagged} red tag)` : ''}`
              : all ? 'All passed' : `${part.items - part.passed} not inspected yet`}
          </Typography>
        </>
      ) : (
        <Typography sx={{ mt: 0.6, fontSize: 12.5, fontWeight: 700, color: palette.textFaint }}>
          No equipment yet
        </Typography>
      )}
    </ButtonBase>
  )
}
