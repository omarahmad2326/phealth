/**
 * One hospital's page: its Facility categories and what their equipment is
 * worth, Equipment Maintenance (service, inspection, plans, permits), and
 * compliance.
 *
 * Opening a site sets it as the working context, so every other screen is
 * already scoped by the time you leave this page. Each tile says how much is
 * there and how much is wrong, and opens the list behind it. Everything else
 * the product does is still in the module launcher.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import DomainOutlinedIcon from '@mui/icons-material/DomainOutlined'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import { fetchSiteOverview as fetchInspectionOverview } from '@/api/inspectionProgramme'
import { CountTile } from '@/pages/Inspections/programme/parts'
import {
  Box, Breadcrumbs, Button, Link, Skeleton, Stack, Typography,
} from '@mui/material'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import { fetchFacility, fetchSiteOverview } from '@/api/facilities'
import {
  fetchCategoryOverview, fetchMaintenanceSummary, formatMoney, type CategorySummary, type MaintenanceSummary,
} from '@/api/siteCategories'
import { hasPermission } from '@/config/permissions'
import { CATEGORIES, CATEGORIES_LABEL, EQUIPMENT_MAINTENANCE } from '@/config/siteCategories'
import { useFacilityStore } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'
// The per-site administration that used to live in the facilities module.
// Same forms, reached from the hospital they belong to instead of from a
// list of every hospital.
import FacilityFormModal from '@/pages/Facilities/FacilityFormModal'
import FacilityUsersModal from '@/pages/Facilities/FacilityUsersModal'
import DepartmentsModal from '@/pages/Facilities/DepartmentsModal'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export default function SiteDashboard() {
  const { id } = useParams()
  const siteId = Number(id)
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const setFacilityId = useFacilityStore((s) => s.setFacilityId)
  const [panel, setPanel] = useState<'details' | 'people' | 'departments' | null>(null)

  const showCategories = hasPermission(user, 'facility-inventory', 'index')
  const maintenanceLinks = EQUIPMENT_MAINTENANCE.filter((link) => hasPermission(user, link.module, 'index'))
  const showMaintenance = maintenanceLinks.length > 0
  const showCompliance = hasPermission(user, 'compliance', 'index')

  // Arriving here by link or refresh has to set the context too, not only
  // arriving by clicking a card.
  useEffect(() => {
    if (siteId) setFacilityId(siteId)
  }, [siteId, setFacilityId])

  const { data: site } = useQuery({
    queryKey: ['facility', siteId],
    queryFn: () => fetchFacility(siteId),
    enabled: !!siteId,
  })
  const categories = useQuery({
    queryKey: ['category-overview', siteId],
    queryFn: () => fetchCategoryOverview(siteId),
    enabled: !!siteId && showCategories,
  })
  const maintenance = useQuery({
    queryKey: ['maintenance-summary', siteId],
    queryFn: () => fetchMaintenanceSummary(siteId),
    enabled: !!siteId && hasPermission(user, 'service-requests', 'index'),
  })
  const inspections = useQuery({
    queryKey: ['inspection-overview', siteId],
    queryFn: () => fetchInspectionOverview(siteId),
    enabled: !!siteId && hasPermission(user, 'inspections', 'index'),
  })
  const overview = useQuery({
    queryKey: ['site-overview', siteId],
    queryFn: () => fetchSiteOverview(siteId),
    enabled: !!siteId && showCompliance,
  })

  const summaries = Object.fromEntries((categories.data?.categories ?? []).map((c) => [c.code, c]))

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link
          component="button" onClick={() => navigate('/sites')}
          sx={{ fontWeight: 800, fontSize: 13, color: palette.textMuted, textDecoration: 'none' }}
        >
          Sites
        </Link>
        <Typography sx={{ fontWeight: 800, fontSize: 13, color: palette.ink }}>
          {site?.name ?? '…'}
        </Typography>
      </Breadcrumbs>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' }, gap: 1.5, mb: 3 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" sx={{ fontWeight: 900, color: palette.ink }}>
            {site?.name ?? 'Site'}
          </Typography>
          <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>
            {[site?.address, site?.city, site?.state].filter(Boolean).join(', ')}
          </Typography>
          <Typography sx={{ color: palette.textSubtle, fontWeight: 700, fontSize: 13 }}>
            {[
              site?.size_band ? `${site.size_band[0].toUpperCase()}${site.size_band.slice(1)}` : null,
              site?.beds ? `${site.beds} beds` : null,
              site?.area_sqft ? `${site.area_sqft.toLocaleString()} sq ft` : null,
            ].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          {([
            ['details', 'Site details'],
            ['people', 'People here'],
          ] as const).map(([key, label]) => (
            <Button
              key={key} size="small" variant="outlined"
              onClick={() => setPanel(key)}
              sx={{ fontWeight: 800, borderRadius: '10px', color: palette.brand,
                    borderColor: palette.brandBorder }}
            >
              {label}
            </Button>
          ))}
        </Stack>
      </Stack>

      {hasPermission(user, 'inspections', 'index') && (
        <Section title="Inspections">
          <Box sx={{ display: 'flex', gap: 1.2, flexWrap: 'wrap', mb: 1.5 }}>
            <CountTile label="Passed" value={inspections.data?.counts.passed ?? 0}
                       tone={{ color: '#15803D', bg: '#F0FDF4' }} />
            <CountTile label="Failed" value={inspections.data?.counts.failed ?? 0}
                       tone={{ color: '#B45309', bg: '#FEF3C7' }} />
            <CountTile label="Red tagged" value={inspections.data?.counts.red_tagged ?? 0}
                       tone={{ color: '#B91C1C', bg: '#FEE2E2' }} />
            <CountTile label="In progress" value={inspections.data?.counts.in_progress ?? 0}
                       tone={{ color: '#1D4ED8', bg: '#EFF6FF' }} />
            <CountTile label="Due" value={inspections.data?.counts.due ?? 0}
                       tone={{ color: '#92400E', bg: '#FEF3C7' }} />
            <CountTile label="Overdue" value={inspections.data?.counts.overdue ?? 0}
                       tone={{ color: '#B91C1C', bg: '#FEE2E2' }} />
          </Box>
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' } }}>
            <Tile
              onClick={() => navigate('/departments')} loading={inspections.isLoading}
              icon={<DomainOutlinedIcon />} colour={palette.brand} title="Departments"
              figure={inspections.data ? String(inspections.data.departments.filter((d) => d.id !== null).length) : undefined}
              facts={inspections.data ? [
                { text: `${inspections.data.counts.items} item${inspections.data.counts.items === 1 ? '' : 's'}`,
                  tone: 'plain' as const },
                ...(inspections.data.counts.not_scheduled
                  ? [{ text: `${inspections.data.counts.not_scheduled} with no schedule`, tone: 'warning' as const }]
                  : []),
              ] : []}
            />
            <Tile
              onClick={() => navigate('/inspection-visits')} loading={inspections.isLoading}
              icon={<EventAvailableOutlinedIcon />} colour={palette.brand} title="Visits"
              figure={inspections.data ? String(inspections.data.open_visits) : undefined}
              facts={inspections.data ? [
                { text: inspections.data.open_visits ? 'open now' : 'Nothing open', tone: 'plain' as const },
              ] : []}
            />
            <Tile
              onClick={() => navigate('/fleet')} loading={inspections.isLoading}
              icon={<LocalShippingOutlinedIcon />} colour={palette.brand} title="Fleet"
              figure={inspections.data ? String(inspections.data.fleet.vehicles) : undefined}
              facts={inspections.data ? [
                { text: `${inspections.data.fleet.vehicles} vehicle${inspections.data.fleet.vehicles === 1 ? '' : 's'}`,
                  tone: 'plain' as const },
                ...(inspections.data.fleet.due
                  ? [{ text: `${inspections.data.fleet.due} due`, tone: 'warning' as const }] : []),
              ] : []}
            />
            <Tile
              onClick={() => navigate('/red-tags')} loading={inspections.isLoading}
              icon={<ReportProblemOutlinedIcon />} colour={inspections.data?.red_tags ? palette.danger : palette.brand}
              title="Red tags"
              figure={inspections.data ? String(inspections.data.red_tags) : undefined}
              facts={inspections.data ? [
                inspections.data.red_tags
                  ? { text: 'not up to standard', tone: 'danger' as const }
                  : { text: 'All clear', tone: 'good' as const },
              ] : []}
            />
          </Box>
        </Section>
      )}

      {showCategories && (
        <Section title={CATEGORIES_LABEL}>
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' } }}>
            {CATEGORIES.map((meta) => (
              <CategoryTile
                key={meta.code} name={meta.name} icon={meta.icon} colour={meta.colour}
                summary={summaries[meta.code]} loading={categories.isLoading}
                onClick={() => navigate(meta.path)}
              />
            ))}
          </Box>
        </Section>
      )}

      {showMaintenance && (
        <Section title="Equipment Maintenance">
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' } }}>
            {maintenanceLinks.map((link) => (
              <Tile key={link.path} onClick={() => navigate(link.path)} loading={maintenance.isLoading}
                    icon={link.icon} colour={palette.brand} title={link.name}
                    facts={maintenanceFacts(link.path, maintenance.data)} />
            ))}
          </Box>
        </Section>
      )}

      {showCompliance && (
        <Section title="Compliance">
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <Tile
              onClick={() => navigate('/compliance')} loading={overview.isLoading}
              icon={<FactCheckOutlinedIcon />} colour={palette.accentDark} title="Compliance"
              facts={overview.data ? [
                overview.data.compliance.overdue
                  ? { text: `${overview.data.compliance.overdue} overdue`, tone: 'danger' as const }
                  : { text: 'Nothing overdue', tone: 'good' as const },
                { text: `${overview.data.compliance.due_within_30_days} due in 30 days`, tone: 'plain' as const },
              ] : []}
            />
          </Box>
        </Section>
      )}

      {panel === 'details' && site && (
        <FacilityFormModal open onClose={() => setPanel(null)} facility={site} locateOnSave={false} />
      )}
      {panel === 'people' && site && (
        <FacilityUsersModal open onClose={() => setPanel(null)} facility={site} />
      )}
      {panel === 'departments' && (
        <DepartmentsModal open onClose={() => setPanel(null)} />
      )}
    </Box>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ mb: 1.25, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
                        textTransform: 'uppercase', color: palette.textSubtle }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

type Fact = { text: string; tone: 'plain' | 'good' | 'warning' | 'danger' }

/** The lines on each Equipment Maintenance tile. */
function maintenanceFacts(path: string, summary?: MaintenanceSummary): Fact[] {
  if (!summary) return []
  const jobs = path.endsWith('/service') ? summary.service : path.endsWith('/inspection') ? summary.inspection : null
  if (jobs) {
    return [
      { text: jobs.open ? plural(jobs.open, 'open job') : 'Nothing open', tone: 'plain' },
      ...(jobs.overdue ? [{ text: `${jobs.overdue} overdue`, tone: 'danger' as const }] : []),
      ...(jobs.failed ? [{ text: `${jobs.failed} failed`, tone: 'danger' as const }] : []),
    ]
  }
  if (path === '/maintenance' && summary.plans) {
    const { active, overdue, due_in_30_days: soon } = summary.plans
    return [
      { text: active ? plural(active, 'active plan') : 'No plans yet', tone: 'plain' },
      ...(overdue ? [{ text: `${overdue} overdue`, tone: 'danger' as const }] : []),
      ...(soon ? [{ text: `${soon} due in 30 days`, tone: 'plain' as const }] : []),
    ]
  }
  if (path === '/permits' && summary.permits) {
    const { active, awaiting_approval: waiting } = summary.permits
    return [
      { text: active ? `${active} in force` : 'None in force', tone: 'plain' },
      ...(waiting ? [{ text: `${waiting} awaiting approval`, tone: 'warning' as const }] : []),
    ]
  }
  return []
}

const TONE: Record<Fact['tone'], string> = {
  plain: palette.textMuted,
  good: palette.success,
  warning: palette.warningDeep,
  danger: palette.danger,
}

function CategoryTile({ name, icon, colour, summary, loading, onClick }: {
  name: string
  icon: JSX.Element
  colour: string
  summary?: CategorySummary
  loading: boolean
  onClick: () => void
}) {
  const facts: Fact[] = []
  if (summary) {
    if (!summary.equipment) {
      facts.push({ text: 'Nothing added yet', tone: 'plain' })
    } else {
      const wrong = summary.needs_attention + summary.out_of_service
      facts.push(wrong
        ? { text: [summary.needs_attention && `${summary.needs_attention} need attention`,
                   summary.out_of_service && `${summary.out_of_service} out of service`].filter(Boolean).join(' · '),
            tone: summary.out_of_service ? 'danger' : 'warning' }
        : { text: 'All working', tone: 'good' })
      if (summary.open_jobs) {
        facts.push({ text: `${plural(summary.open_jobs, 'open job')}${summary.overdue_jobs ? ` · ${summary.overdue_jobs} overdue` : ''}`,
                     tone: summary.overdue_jobs ? 'danger' : 'plain' })
      }
    }
  }
  return (
    <Tile
      onClick={onClick} loading={loading} icon={icon} colour={colour} title={name}
      figure={summary
        ? `${plural(summary.equipment, 'item')}${summary.valued_equipment ? ` · ${formatMoney(summary.book_value)} value` : ''}`
        : undefined}
      facts={facts}
    />
  )
}

function Tile({ icon, colour, title, figure, facts, loading, onClick }: {
  icon: JSX.Element
  colour: string
  title: string
  figure?: string
  facts: Fact[]
  loading: boolean
  onClick: () => void
}) {
  return (
    <Box
      component="button" type="button" onClick={onClick}
      sx={{
        textAlign: 'left', p: 2, borderRadius: '18px', cursor: 'pointer', font: 'inherit',
        bgcolor: palette.white, border: `1px solid ${palette.borderSoft}`, minWidth: 0,
        display: 'flex', flexDirection: 'column', gap: 1.25,
        transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
        '&:hover': { borderColor: palette.brandBorder, boxShadow: '0 12px 28px rgba(4,120,87,0.08)', transform: 'translateY(-1px)' },
        '&:focus-visible': { outline: `3px solid ${palette.focusRing}`, outlineOffset: 2 },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ width: '100%' }}>
        <Box sx={{ width: 42, height: 42, borderRadius: '13px', display: 'grid', placeItems: 'center', flexShrink: 0,
                   color: colour, bgcolor: `${colour}14`, '& svg': { fontSize: 23 } }}>
          {icon}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontWeight: 900, fontSize: 16, color: palette.ink }}>{title}</Typography>
          {figure && <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: palette.textMuted }}>{figure}</Typography>}
        </Box>
        <ArrowForwardRoundedIcon sx={{ fontSize: 18, color: palette.textFaint }} />
      </Stack>
      <Box sx={{ minHeight: 40 }}>
        {loading ? (
          <>
            <Skeleton width="70%" height={18} />
            <Skeleton width="45%" height={18} />
          </>
        ) : facts.map((fact) => (
          <Typography key={fact.text} sx={{ fontSize: 13, fontWeight: 800, color: TONE[fact.tone], lineHeight: 1.55 }}>
            {fact.text}
          </Typography>
        ))}
      </Box>
    </Box>
  )
}
