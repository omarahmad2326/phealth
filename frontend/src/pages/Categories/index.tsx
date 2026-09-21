/**
 * One category's equipment at the site you are in: Electrical, Plumbing,
 * Mechanical or HVAC.
 *
 * A list, a search, three filters and an Add button. Clicking a row opens the
 * same form to edit it. Service and inspection jobs on this equipment live in
 * Equipment Maintenance; the list only shows what is open and when the next
 * service is due, so a glance says what needs doing.
 */
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Box, Button, Chip, CircularProgress, IconButton, InputAdornment, MenuItem, Stack, TextField, Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import DomainOutlinedIcon from '@mui/icons-material/DomainOutlined'
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import {
  fetchCategoryEquipment, formatMoney, type CategoryCode, type CategoryEquipment,
  type Condition,
} from '@/api/siteCategories'
import { hasPermission } from '@/config/permissions'
import { CATEGORY_BY_CODE, CATEGORIES, CATEGORIES_LABEL, CONDITION_STYLE } from '@/config/siteCategories'
import { useActiveFacility } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'
import EquipmentDialog from './EquipmentDialog'
import InspectNowDialog, { type InspectTarget } from '@/pages/Inspections/programme/InspectNowDialog'

const shortDate = (value: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const isPast = (value: string | null) => Boolean(value && new Date(`${value}T23:59:59`) < new Date())

export default function CategoryPage() {
  const { code } = useParams()
  const meta = CATEGORY_BY_CODE[code as CategoryCode]
  if (!meta) return <Navigate to={CATEGORIES[0].path} replace />
  return <CategoryEquipmentList key={meta.code} code={meta.code} />
}

function CategoryEquipmentList({ code }: { code: CategoryCode }) {
  const navigate = useNavigate()
  const meta = CATEGORY_BY_CODE[code]
  const user = useAuthStore((s) => s.user)
  const { facilityId, facility } = useActiveFacility()
  const canAdd = hasPermission(user, 'facility-inventory', 'add')
  const canEdit = hasPermission(user, 'facility-inventory', 'edit')
  const canDelete = hasPermission(user, 'facility-inventory', 'delete')

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  // A department's id, 'none' for items in no department, or '' for all.
  const [department, setDepartment] = useState('')
  const [condition, setCondition] = useState('')
  const [editing, setEditing] = useState<CategoryEquipment | null>(null)
  const [adding, setAdding] = useState(false)
  // Inspecting is not only something that falls due: any item can be
  // inspected from where it lives, the way a service is raised on it.
  const [inspecting, setInspecting] = useState<InspectTarget | null>(null)
  const canInspect = hasPermission(user, 'inspections', 'add')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const list = useQuery({
    queryKey: ['category-equipment', facilityId, code, debounced, department, condition],
    queryFn: () => fetchCategoryEquipment(code, facilityId as number, { search: debounced, department, condition }),
    enabled: !!facilityId,
    placeholderData: (previous) => previous,
  })
  const items = list.data?.items ?? []
  const types = list.data?.category.types ?? []
  const filtering = Boolean(debounced || department || condition)
  const departments = list.data?.departments ?? []
  const needsCare = useMemo(() => items.filter((i) => i.condition !== 'working').length, [items])

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5, mb: 2.5 }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
          <Box sx={{ width: 48, height: 48, borderRadius: '15px', display: 'grid', placeItems: 'center', flexShrink: 0,
                     color: meta.colour, bgcolor: `${meta.colour}14`, '& svg': { fontSize: 26 } }}>
            {meta.icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase', color: palette.textSubtle }}>
              {CATEGORIES_LABEL}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, color: palette.ink, lineHeight: 1.15 }}>{meta.name}</Typography>
            <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>
              {facility?.name ?? 'This site'} · {list.data ? `${list.data.total} item${list.data.total === 1 ? '' : 's'}` : '…'}
              {needsCare > 0 && !filtering ? ` · ${needsCare} need${needsCare === 1 ? 's' : ''} care` : ''}
            </Typography>
          </Box>
        </Stack>
        {canAdd && (
          <Button
            variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}
            sx={{ fontWeight: 900, borderRadius: '12px', px: 2.5, bgcolor: palette.brand,
                  '&:hover': { bgcolor: palette.brandDeep } }}
          >
            Add equipment
          </Button>
        )}
      </Stack>

      <Box sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '18px', bgcolor: palette.white, overflow: 'hidden' }}>
        <Box sx={{ p: 1.5, display: 'grid', gap: 1.25,
                   gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '2fr 1fr 1fr' } }}>
          <TextField
            size="small" placeholder="Search name, type or tag…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: (
              <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: palette.textFaint }} /></InputAdornment>
            ) }}
          />
          <TextField select size="small" label="Department" value={department}
                     onChange={(e) => setDepartment(e.target.value)} {...SHOW_EMPTY}>
            <MenuItem value="">All departments</MenuItem>
            <MenuItem value="none">Not in a department</MenuItem>
            {departments.map((d) => <MenuItem key={d.id} value={String(d.id)}>{d.name}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Status" value={condition} onChange={(e) => setCondition(e.target.value)}
                     {...SHOW_EMPTY}>
            <MenuItem value="">Any status</MenuItem>
            {(Object.keys(CONDITION_STYLE) as Condition[]).map((key) => (
              <MenuItem key={key} value={key}>{CONDITION_STYLE[key].label}</MenuItem>
            ))}
          </TextField>
        </Box>

        {/* Column headings, on screens wide enough for columns. */}
        <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: COLUMNS, gap: 2, px: 2, py: 1,
                   borderTop: `1px solid ${palette.borderSoft}`, bgcolor: palette.surfaceFaint }}>
          {['Equipment', 'Department', 'Qty', 'Status', 'Book value', 'Next service', ''].map((h) => (
            <Typography key={h} sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.4, textTransform: 'uppercase',
                                      color: palette.textSubtle }}>
              {h}
            </Typography>
          ))}
        </Box>

        {list.isLoading && <Box sx={{ p: 5, textAlign: 'center' }}><CircularProgress size={24} /></Box>}
        {list.isError && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 800, color: palette.danger }}>Could not load the equipment</Typography>
          </Box>
        )}
        {!list.isLoading && !list.isError && items.length === 0 && (
          <Box sx={{ p: { xs: 4, sm: 6 }, textAlign: 'center', borderTop: `1px solid ${palette.borderSoft}` }}>
            <Typography sx={{ fontWeight: 900, color: palette.ink }}>
              {filtering ? 'Nothing matches' : `No ${meta.name.toLowerCase() === 'hvac' ? 'HVAC' : meta.name.toLowerCase()} equipment yet`}
            </Typography>
            {!filtering && (
              <>
                <Typography sx={{ mt: 0.5, fontSize: 13, color: palette.textFaint }}>
                  Add each {types.slice(0, 3).join(', ').toLowerCase() || 'item'} and the department it belongs to.
                </Typography>
                {canAdd && (
                  <Button startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={{ mt: 1.5, fontWeight: 900 }}>
                    Add the first one
                  </Button>
                )}
              </>
            )}
          </Box>
        )}

        {items.map((item) => (
          <EquipmentRow
            key={item.id} item={item} onOpen={canEdit ? () => setEditing(item) : undefined}
            onValue={() => navigate(`/assets?asset=${item.id}`)}
            onInspect={canInspect ? () => setInspecting({
              kind: 'equipment', id: item.id, name: item.name,
              departmentId: item.department_id, category: code,
            }) : undefined}
          />
        ))}
      </Box>

      <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button size="small" variant="outlined" onClick={() => navigate('/equipment-maintenance/service')}
                sx={{ fontWeight: 800, borderRadius: '10px', color: palette.brand, borderColor: palette.brandBorder }}>
          Services
        </Button>
        <Button size="small" variant="outlined" onClick={() => navigate('/equipment-maintenance/inspection')}
                sx={{ fontWeight: 800, borderRadius: '10px', color: palette.brand, borderColor: palette.brandBorder }}>
          Inspections
        </Button>
      </Stack>

      {inspecting && facilityId && (
        <InspectNowDialog facilityId={facilityId} target={inspecting} onClose={() => setInspecting(null)} />
      )}
      {(adding || editing) && facilityId && (
        <EquipmentDialog
          facilityId={facilityId} category={code} types={types} item={editing}
          defaultLife={list.data?.category.default_useful_life_years ?? 20}
          canDelete={canDelete}
          onClose={() => { setAdding(false); setEditing(null) }}
        />
      )}
    </Box>
  )
}

const COLUMNS = 'minmax(0, 2.1fr) minmax(0, 2fr) 44px 138px 108px 124px 72px'

/** A filter whose empty choice ("All buildings") shows, rather than a bare label. */
const SHOW_EMPTY ={ SelectProps: { displayEmpty: true }, InputLabelProps: { shrink: true } }

function EquipmentRow({ item, onOpen, onValue, onInspect }: {
  item: CategoryEquipment
  onOpen?: () => void
  /** Open the same record in the Asset Register, where its value history lives. */
  onValue: () => void
  /** Inspect it now, without waiting for it to fall due. */
  onInspect?: () => void
}) {
  const status = CONDITION_STYLE[item.condition]
  const overdue = isPast(item.next_service_on)
  return (
    <Box
      onClick={onOpen}
      role={onOpen ? 'button' : undefined}
      sx={{
        display: 'grid', gap: { xs: 0.5, md: 2 }, alignItems: 'center',
        gridTemplateColumns: { xs: '1fr auto', md: COLUMNS },
        px: 2, py: 1.4, borderTop: `1px solid ${palette.borderSoft}`,
        cursor: onOpen ? 'pointer' : 'default',
        '&:hover': onOpen ? { bgcolor: palette.brandTint } : undefined,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 900, color: palette.ink, fontSize: 14 }}>{item.name}</Typography>
          {item.consider_replacing && (
            <Tooltip title={`Maintenance spend is ${item.spend_percent_of_cost}% of the purchase cost. Consider replacing.`}>
              <WarningAmberRoundedIcon sx={{ fontSize: 17, color: palette.warningStrong, flexShrink: 0 }} />
            </Tooltip>
          )}
        </Stack>
        <Typography noWrap sx={{ fontSize: 12, color: palette.textMuted, fontWeight: 600 }}>
          {[item.type, item.asset_tag, [item.make, item.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
        </Typography>
      </Box>

      {/* On a phone the status sits beside the name and the rest wraps below. */}
      <Chip size="small" label={status.label}
            sx={{ display: { xs: 'inline-flex', md: 'none' }, justifySelf: 'end', height: 22, fontSize: 11, fontWeight: 800,
                  bgcolor: status.bg, color: status.color }} />

      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, gridColumn: { xs: '1 / -1', md: 'auto' } }}>
        <DomainOutlinedIcon sx={{ fontSize: 15, color: palette.textFaint, flexShrink: 0 }} />
        <Typography noWrap sx={{ fontSize: 13, fontWeight: 600,
                                 color: item.department ? palette.textStrong : palette.textFaint }}>
          {item.department ?? 'Not in a department'}
        </Typography>
      </Stack>
      <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: 13, fontWeight: 800, color: palette.textStrong }}>
        {item.quantity}
      </Typography>
      <Box sx={{ display: { xs: 'none', md: 'block' } }}>
        <Chip size="small" label={status.label}
              sx={{ height: 22, fontSize: 11, fontWeight: 800, bgcolor: status.bg, color: status.color }} />
      </Box>
      <Box sx={{ minWidth: 0, gridColumn: { xs: '1 / -1', md: 'auto' } }}>
        <Typography noWrap sx={{ fontSize: 13, fontWeight: 800, color: item.book_value != null ? palette.textStrong : palette.textFaint }}>
          <Box component="span" sx={{ display: { md: 'none' }, color: palette.textFaint, fontWeight: 600 }}>Book value </Box>
          {formatMoney(item.book_value)}
        </Typography>
        {item.book_value == null && item.purchase_cost != null && (
          <Typography noWrap sx={{ fontSize: 11, color: palette.textFaint, fontWeight: 700 }}>
            Cost {formatMoney(item.purchase_cost)}
          </Typography>
        )}
      </Box>
      <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: overdue ? palette.danger : palette.textStrong }}>
          <Box component="span" sx={{ display: { md: 'none' }, color: palette.textFaint, fontWeight: 600 }}>Next service </Box>
          {shortDate(item.next_service_on)}
        </Typography>
        {(overdue || item.open_jobs > 0) && (
          <Typography noWrap sx={{ fontSize: 11, color: overdue ? palette.danger : palette.textFaint, fontWeight: 800 }}>
            {[overdue && 'Overdue', item.open_jobs > 0 && `${item.open_jobs} open job${item.open_jobs === 1 ? '' : 's'}`]
              .filter(Boolean).join(' · ')}
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={0.25} sx={{ justifySelf: 'end' }}>
        {onInspect && (
          <Tooltip title="Inspect it now">
            <IconButton
              size="small" aria-label={`Inspect ${item.name} now`}
              onClick={(e) => { e.stopPropagation(); onInspect() }}
              sx={{ color: palette.brand }}
            >
              <PlaylistAddCheckIcon sx={{ fontSize: 19 }} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Asset & value history">
          <IconButton
            size="small" aria-label={`Asset and value history for ${item.name}`}
            onClick={(e) => { e.stopPropagation(); onValue() }}
            sx={{ display: { xs: 'none', md: 'inline-flex' }, color: palette.brand }}
          >
            <AccountBalanceOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  )
}
