/**
 * Equipment Maintenance: the service and inspection jobs on this site's
 * category equipment.
 *
 * One list per kind, soonest due first, with status chips that double as
 * filters. Clicking a job opens it to update; New raises one. Both are work
 * orders underneath, so they also appear in the full work order queue.
 */
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Box, Button, Chip, CircularProgress, InputAdornment, MenuItem, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import {
  fetchEquipmentJobs, type EquipmentJob, type JobKind, type JobStatusFilter,
} from '@/api/siteCategories'
import { hasPermission } from '@/config/permissions'
import { CATEGORIES, CATEGORY_BY_CODE, JOB_KINDS } from '@/config/siteCategories'
import { useActiveFacility } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'
import JobDialog from './JobDialog'

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  open: { color: palette.info, bg: palette.infoTint },
  in_progress: { color: palette.warningDeep, bg: palette.warningTint },
  done: { color: palette.success, bg: palette.successTint },
  cancelled: { color: palette.textMuted, bg: palette.surfaceMuted },
}

const COLUMNS = 'minmax(0, 2fr) minmax(0, 2.2fr) 120px 140px 190px'

export default function EquipmentMaintenancePage() {
  const { kind } = useParams()
  const meta = JOB_KINDS.find((k) => k.kind === kind)
  if (!meta) return <Navigate to={JOB_KINDS[0].path} replace />
  return <JobList key={meta.kind} kind={meta.kind} />
}

function JobList({ kind }: { kind: JobKind }) {
  const navigate = useNavigate()
  const meta = JOB_KINDS.find((k) => k.kind === kind)!
  const user = useAuthStore((s) => s.user)
  const { facilityId, facility } = useActiveFacility()
  const canAdd = hasPermission(user, 'service-requests', 'add')
  const canDelete = hasPermission(user, 'service-requests', 'delete')

  const [status, setStatus] = useState<JobStatusFilter>('')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState<EquipmentJob | null>(null)
  const [raising, setRaising] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const list = useQuery({
    queryKey: ['equipment-jobs', facilityId, kind, status, category, debounced],
    queryFn: () => fetchEquipmentJobs(facilityId as number, kind, { status, category, search: debounced }),
    enabled: !!facilityId,
    placeholderData: (previous) => previous,
  })

  const items = list.data?.items ?? []
  const counts = list.data?.counts
  const chips: Array<{ value: JobStatusFilter; label: string; count?: number; danger?: boolean }> = [
    { value: '', label: 'All', count: counts ? counts.open + counts.in_progress + counts.done : undefined },
    { value: 'open', label: 'Open', count: counts?.open },
    { value: 'in_progress', label: 'In progress', count: counts?.in_progress },
    { value: 'done', label: 'Done', count: counts?.done },
    { value: 'overdue', label: 'Overdue', count: counts?.overdue, danger: true },
  ]
  const filtering = Boolean(status || category || debounced)

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5, mb: 2 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase', color: palette.textSubtle }}>
            Equipment Maintenance · {facility?.name ?? 'This site'}
          </Typography>
          {JOB_KINDS.length > 1 && (
          <ToggleButtonGroup
            exclusive size="small" value={kind} sx={{ mt: 0.75,
              '& .MuiToggleButton-root': { fontWeight: 900, textTransform: 'none', px: 2.25, fontSize: 15, gap: 0.75 },
              '& .Mui-selected': { bgcolor: `${palette.brandTint} !important`, color: `${palette.brandDeep} !important` } }}
            onChange={(_, value) => value && navigate(JOB_KINDS.find((k) => k.kind === value)!.path)}
          >
            {JOB_KINDS.map((k) => (
              <ToggleButton key={k.kind} value={k.kind}>
                <Box sx={{ display: 'grid', '& svg': { fontSize: 19 } }}>{k.icon}</Box>
                {k.name}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          )}
        </Box>
        {canAdd && (
          <Button
            variant="contained" startIcon={<AddIcon />} onClick={() => setRaising(true)}
            sx={{ fontWeight: 900, borderRadius: '12px', px: 2.5, bgcolor: palette.brand, '&:hover': { bgcolor: palette.brandDeep } }}
          >
            New {meta.singular}
          </Button>
        )}
      </Stack>

      <Stack direction="row" sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.75 }}>
        {chips.map((chip) => {
          const active = status === chip.value
          const alarming = chip.danger && (chip.count ?? 0) > 0
          return (
            <Chip
              key={chip.label} clickable onClick={() => setStatus(chip.value)}
              label={chip.count === undefined ? chip.label : `${chip.label} · ${chip.count}`}
              sx={{
                fontWeight: 800, fontSize: 12.5,
                bgcolor: active ? (alarming ? palette.danger : palette.brand) : (alarming ? palette.dangerWash : palette.white),
                color: active ? '#fff' : (alarming ? palette.danger : palette.textStrong),
                border: `1px solid ${active ? 'transparent' : (alarming ? palette.dangerTint : palette.borderSoft)}`,
                '&:hover': { bgcolor: active ? (alarming ? palette.danger : palette.brandDeep) : palette.brandTint },
              }}
            />
          )
        })}
      </Stack>

      <Box sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '18px', bgcolor: palette.white, overflow: 'hidden' }}>
        <Box sx={{ p: 1.5, display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
          <TextField
            size="small" placeholder="Search job, equipment, tag, place…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: (
              <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: palette.textFaint }} /></InputAdornment>
            ) }}
          />
          <TextField select size="small" label="Category" value={category} onChange={(e) => setCategory(e.target.value)}
                     SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
            <MenuItem value="">All categories</MenuItem>
            {CATEGORIES.map((c) => <MenuItem key={c.code} value={c.code}>{c.name}</MenuItem>)}
          </TextField>
        </Box>

        <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: COLUMNS, gap: 2, px: 2, py: 1,
                   borderTop: `1px solid ${palette.borderSoft}`, bgcolor: palette.surfaceFaint }}>
          {['What needs doing', 'Equipment', 'Due', 'Assigned to', 'Status'].map((h) => (
            <Typography key={h} sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.4, textTransform: 'uppercase', color: palette.textSubtle }}>
              {h}
            </Typography>
          ))}
        </Box>

        {list.isLoading && <Box sx={{ p: 5, textAlign: 'center' }}><CircularProgress size={24} /></Box>}
        {list.isError && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 800, color: palette.danger }}>Could not load the jobs</Typography>
          </Box>
        )}
        {!list.isLoading && !list.isError && items.length === 0 && (
          <Box sx={{ p: { xs: 4, sm: 6 }, textAlign: 'center', borderTop: `1px solid ${palette.borderSoft}` }}>
            <Typography sx={{ fontWeight: 900, color: palette.ink }}>
              {filtering ? 'Nothing matches' : `No ${meta.singular} jobs yet`}
            </Typography>
            {!filtering && (
              <Typography sx={{ mt: 0.5, fontSize: 13, color: palette.textFaint }}>
                {kind === 'service'
                  ? 'Raise a service on any equipment in Electrical, Plumbing, Mechanical or HVAC.'
                  : 'Raise an inspection on any equipment and record whether it passed.'}
              </Typography>
            )}
            {!filtering && canAdd && (
              <Button startIcon={<AddIcon />} onClick={() => setRaising(true)} sx={{ mt: 1.5, fontWeight: 900 }}>
                New {meta.singular}
              </Button>
            )}
          </Box>
        )}

        {items.map((job) => <JobRow key={job.id} job={job} onOpen={() => setOpen(job)} />)}
      </Box>

      {(raising || open) && facilityId && (
        <JobDialog
          facilityId={facilityId} kind={kind} job={open} canDelete={canDelete}
          onClose={() => { setRaising(false); setOpen(null) }}
        />
      )}
    </Box>
  )
}

function JobRow({ job, onOpen }: { job: EquipmentJob; onOpen: () => void }) {
  const style = STATUS_STYLE[job.status] ?? STATUS_STYLE.open
  const category = job.equipment?.category ? CATEGORY_BY_CODE[job.equipment.category] : null
  return (
    <Box
      onClick={onOpen} role="button"
      sx={{
        display: 'grid', gap: { xs: 0.5, md: 2 }, alignItems: 'center',
        gridTemplateColumns: { xs: '1fr auto', md: COLUMNS },
        px: 2, py: 1.4, borderTop: `1px solid ${palette.borderSoft}`, cursor: 'pointer',
        '&:hover': { bgcolor: palette.brandTint },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography noWrap sx={{ fontWeight: 900, color: palette.ink, fontSize: 14 }}>{job.title}</Typography>
        <Typography noWrap sx={{ fontSize: 12, color: palette.textFaint, fontWeight: 700 }}>{job.number}</Typography>
      </Box>
      <StatusChips job={job} style={style} sx={{ display: { xs: 'flex', md: 'none' }, justifySelf: 'end' }} />

      <Box sx={{ minWidth: 0, gridColumn: { xs: '1 / -1', md: 'auto' } }}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          {category && (
            <Box sx={{ display: 'grid', color: category.colour, '& svg': { fontSize: 16 } }}>{category.icon}</Box>
          )}
          <Typography noWrap sx={{ fontSize: 13, fontWeight: 800, color: palette.textStrong }}>
            {job.equipment?.name ?? '—'}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
          <PlaceOutlinedIcon sx={{ fontSize: 14, color: palette.textFaint, flexShrink: 0 }} />
          <Typography noWrap sx={{ fontSize: 12, color: palette.textMuted }}>
            {job.equipment?.location_label || '—'}
          </Typography>
        </Stack>
      </Box>

      <Typography noWrap sx={{ fontSize: 13, fontWeight: 800, color: job.overdue ? palette.danger : palette.textStrong }}>
        <Box component="span" sx={{ display: { md: 'none' }, color: palette.textFaint, fontWeight: 600 }}>Due </Box>
        {job.due_on ? new Date(`${job.due_on}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'}
        {job.overdue ? ' · overdue' : ''}
      </Typography>
      <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: job.assigned_to ? palette.textStrong : palette.textFaint }}>
        <Box component="span" sx={{ display: { md: 'none' }, color: palette.textFaint, fontWeight: 600 }}>Assigned to </Box>
        {job.assigned_to?.name ?? 'Nobody yet'}
      </Typography>
      <StatusChips job={job} style={style} sx={{ display: { xs: 'none', md: 'flex' } }} />
    </Box>
  )
}

function StatusChips({ job, style, sx }: { job: EquipmentJob; style: { color: string; bg: string }; sx: object }) {
  return (
    <Stack direction="row" spacing={0.5} sx={sx}>
      <Chip size="small" label={job.status_label}
            sx={{ height: 22, fontSize: 11, fontWeight: 800, bgcolor: style.bg, color: style.color }} />
      {job.is_major_work && (
        <Chip size="small" label="Major work"
              sx={{ height: 22, fontSize: 11, fontWeight: 800, bgcolor: palette.violetTint, color: palette.violet }} />
      )}
      {job.inspection_result && (
        <Chip size="small" label={job.inspection_result === 'pass' ? 'Pass' : 'Fail'}
              sx={{ height: 22, fontSize: 11, fontWeight: 800,
                    bgcolor: job.inspection_result === 'pass' ? palette.successTint : palette.dangerWash,
                    color: job.inspection_result === 'pass' ? palette.success : palette.danger }} />
      )}
    </Stack>
  )
}
