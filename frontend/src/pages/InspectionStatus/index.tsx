/**
 * The items behind a count card: what passed, failed, is red-tagged, in
 * progress, due or overdue.
 *
 * Every card on the dashboard, the site page, a department and the fleet opens
 * this screen already filtered, and the list is always exactly the number on
 * the card - both come from the same classification on the server. From a row
 * you go to where the item is dealt with: its open visit, its red tag, its
 * department, or straight into an inspection.
 */
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Box, Button, Chip, CircularProgress, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import {
  fetchInspectionDashboard, fetchInspectionStatus, shortDate, type InspectionState, type StatusRow,
} from '@/api/inspectionProgramme'
import { hasPermission } from '@/config/permissions'
import { useFacilityStore } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'
import { DueChip, ResultChip } from '@/pages/Inspections/programme/parts'
import InspectNowDialog, { type InspectTarget } from '@/pages/Inspections/programme/InspectNowDialog'

export const STATE_TONE: Record<InspectionState, { label: string; color: string; bg: string }> = {
  passed: { label: 'Passed', color: '#15803D', bg: '#F0FDF4' },
  failed: { label: 'Failed', color: '#B45309', bg: '#FEF3C7' },
  red_tagged: { label: 'Red tagged', color: '#B91C1C', bg: '#FEE2E2' },
  in_progress: { label: 'In progress', color: '#1D4ED8', bg: '#EFF6FF' },
  due: { label: 'Due', color: '#92400E', bg: '#FEF3C7' },
  overdue: { label: 'Overdue', color: '#B91C1C', bg: '#FEE2E2' },
  not_scheduled: { label: 'No schedule', color: '#475569', bg: '#F1F5F9' },
}

const SHOWN: InspectionState[] = ['passed', 'failed', 'red_tagged', 'in_progress', 'due', 'overdue']

export default function InspectionStatusPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const storedSite = useFacilityStore((s) => s.facilityId)
  const setFacilityId = useFacilityStore((s) => s.setFacilityId)
  const [params, setParams] = useSearchParams()
  const [inspecting, setInspecting] = useState<{ siteId: number; target: InspectTarget } | null>(null)
  const canInspect = hasPermission(user, 'inspections', 'add')

  const state = (SHOWN.includes(params.get('state') as InspectionState) ? params.get('state') : 'overdue') as InspectionState
  // "all" is every site the person can see; a number is one site. Arriving
  // with neither, the site you are in is the natural answer.
  const siteParam = params.get('site')
  const siteId = siteParam === 'all' ? null : siteParam ? Number(siteParam) : storedSite
  const departmentId = params.get('department') ? Number(params.get('department')) : null
  const kind = (params.get('kind') as 'equipment' | 'vehicle' | null) || null

  const list = useQuery({
    queryKey: ['inspection-status', state, siteId, departmentId, kind],
    queryFn: () => fetchInspectionStatus({ state, facilityId: siteId, departmentId, kind }),
    placeholderData: (previous) => previous,
  })
  const sites = useQuery({ queryKey: ['inspection-dashboard'], queryFn: fetchInspectionDashboard, staleTime: 30_000 })

  const change = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) {
      if (value === null) merged.delete(key)
      else merged.set(key, value)
    }
    setParams(merged, { replace: true })
  }

  // Site screens show one site: open the row in its own.
  const go = (row: StatusRow, path: string) => {
    setFacilityId(row.site_id)
    navigate(path)
  }
  const open = (row: StatusRow) => {
    if (row.open_visit) return go(row, `/inspection-visits/${row.open_visit.id}`)
    if (row.red_tag) return go(row, '/red-tags')
    if (row.kind === 'vehicle') return go(row, '/fleet')
    if (row.department_id) return go(row, `/departments/${row.department_id}`)
    return go(row, '/departments')
  }

  const rows = list.data?.items ?? []
  const tone = STATE_TONE[state]
  const scope = departmentId && rows[0]?.department ? rows[0].department
    : kind === 'vehicle' ? 'Fleet'
      : siteId ? (sites.data?.sites.find((s) => s.facility_id === siteId)?.name ?? 'This site') : 'All sites'
  const multiSite = !siteId

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }}
             sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' }, gap: 1.5, mb: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
                            color: palette.textSubtle }}>
            Inspections · {scope}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 900, color: tone.color, lineHeight: 1.15 }}>{tone.label}</Typography>
          <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>
            {list.data ? `${list.data.total} item${list.data.total === 1 ? '' : 's'}` : '…'}
            {state === 'due' ? ' due in the next 30 days' : ''}
          </Typography>
        </Box>
        {!departmentId && (
          <TextField
            select size="small" label="Site" value={siteId ?? 'all'} sx={{ minWidth: 220 }}
            onChange={(e) => change({ site: e.target.value === 'all' ? 'all' : String(e.target.value) })}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="all">All sites</MenuItem>
            {(sites.data?.sites ?? []).map((site) => (
              <MenuItem key={site.facility_id} value={site.facility_id}>{site.name}</MenuItem>
            ))}
          </TextField>
        )}
      </Stack>

      <Stack direction="row" sx={{ mb: 2, flexWrap: 'wrap', gap: 0.8 }}>
        {SHOWN.map((value) => {
          const style = STATE_TONE[value]
          const active = value === state
          return (
            <Chip
              key={value} label={style.label} onClick={() => change({ state: value })}
              sx={{ fontWeight: 900, fontSize: 12, color: active ? '#fff' : style.color,
                    bgcolor: active ? style.color : style.bg, '&:hover': { bgcolor: active ? style.color : style.bg } }}
            />
          )
        })}
        {(departmentId || kind) && (
          <Chip label="Clear filter" variant="outlined" onClick={() => change({ department: null, kind: null })}
                sx={{ fontWeight: 800, fontSize: 12 }} />
        )}
      </Stack>

      <Box sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '18px', bgcolor: palette.white,
                 overflow: 'hidden' }}>
        <Box sx={{ display: { xs: 'none', md: 'grid' },
                   gridTemplateColumns: multiSite ? '2fr 1.2fr 1.2fr 1.3fr 1.3fr 104px' : '2fr 1.3fr 1.3fr 1.3fr 104px',
                   px: 2, py: 1, gap: 1.2, bgcolor: palette.surfaceMuted }}>
          {[ 'Item', ...(multiSite ? ['Site'] : []), 'Department', 'Last inspected', 'Next due', ''].map((head) => (
            <Typography key={head || 'actions'} sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.4,
                                                      textTransform: 'uppercase', color: palette.textSubtle }}>
              {head}
            </Typography>
          ))}
        </Box>

        {list.isLoading && <Box sx={{ p: 4, display: 'grid', placeItems: 'center' }}><CircularProgress size={22} /></Box>}
        {!list.isLoading && !rows.length && (
          <Typography sx={{ p: 4, textAlign: 'center', fontWeight: 700, color: palette.textMuted }}>
            Nothing is {tone.label.toLowerCase()} {scope === 'All sites' ? 'at any site' : `in ${scope}`}.
          </Typography>
        )}
        {rows.map((row) => (
          <Box
            key={`${row.kind}-${row.id}`}
            onClick={() => open(row)}
            sx={{ display: 'grid', gap: 1.2, alignItems: 'center', cursor: 'pointer',
                  gridTemplateColumns: { xs: '1fr auto',
                                         md: multiSite ? '2fr 1.2fr 1.2fr 1.3fr 1.3fr 104px' : '2fr 1.3fr 1.3fr 1.3fr 104px' },
                  px: 2, py: 1.4, borderTop: `1px solid ${palette.borderSoft}`,
                  '&:hover': { bgcolor: palette.brandTint } }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 900, fontSize: 14, color: palette.ink }}>{row.name}</Typography>
                {row.kind === 'vehicle' && <Chip size="small" label="Fleet"
                      sx={{ height: 19, fontSize: 10, fontWeight: 800, bgcolor: palette.surfaceMuted,
                            color: palette.textMuted }} />}
              </Stack>
              <Typography noWrap sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 600 }}>
                {[row.type, row.asset_tag ?? row.registration, row.where].filter(Boolean).join(' · ') || '—'}
              </Typography>
              {row.red_tag && (
                <Typography noWrap sx={{ fontSize: 12, color: '#B91C1C', fontWeight: 800 }}>{row.red_tag.note}</Typography>
              )}
              {row.open_visit && (
                <Typography noWrap sx={{ fontSize: 12, color: '#1D4ED8', fontWeight: 800 }}>
                  Open in visit {row.open_visit.number}
                </Typography>
              )}
            </Box>
            {multiSite && (
              <Typography noWrap sx={{ display: { xs: 'none', md: 'block' }, fontSize: 13, fontWeight: 700,
                                       color: palette.textStrong }}>
                {row.site}
              </Typography>
            )}
            <Typography noWrap sx={{ display: { xs: 'none', md: 'block' }, fontSize: 13, fontWeight: 700,
                                     color: row.department ? palette.textStrong : palette.textFaint }}>
              {row.department ?? (row.kind === 'vehicle' ? 'Fleet' : 'No department')}
            </Typography>
            <Stack direction="row" spacing={0.8} alignItems="center" sx={{ display: { xs: 'none', md: 'flex' } }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: palette.textStrong }}>
                {shortDate(row.last_inspected_on)}
              </Typography>
              {row.last_result && <ResultChip result={row.last_result} />}
            </Stack>
            <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}>
              <DueChip state={row.due_state} on={row.next_due_on} />
            </Box>
            <Stack direction="row" spacing={0.5} sx={{ justifySelf: 'end' }}>
              {canInspect && !row.open_visit && (
                <Tooltip title="Inspect it now">
                  <Button
                    size="small" startIcon={<PlaylistAddCheckIcon />}
                    onClick={(e) => {
                      e.stopPropagation()
                      setFacilityId(row.site_id)
                      setInspecting({ siteId: row.site_id, target: {
                        kind: row.kind, id: row.id, name: row.name, departmentId: row.department_id ?? null,
                      } })
                    }}
                    sx={{ fontWeight: 900, borderRadius: '10px', minWidth: 0 }}
                  >
                    Inspect
                  </Button>
                </Tooltip>
              )}
            </Stack>
          </Box>
        ))}
      </Box>

      {inspecting && (
        <InspectNowDialog facilityId={inspecting.siteId} target={inspecting.target}
                          onClose={() => setInspecting(null)} />
      )}
    </Box>
  )
}
