/**
 * The site you are in and everything that belongs to it: Inspections
 * (departments, visits, fleet, red tags), Service, Facility and Compliance
 * (compliance and permits to work).
 *
 * Two words, one meaning each: an inspection is the schedule that keeps
 * equipment to standard, and service is the work raised when something is at
 * fault. Nothing here is a second way to do either.
 *
 * Always under the header once a site is open, so getting from a generator to
 * its service jobs is one click from anywhere rather than a trip through the
 * module launcher. Everything else in the product is still in the launcher.
 */
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Box, Button, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import LocalHospitalOutlinedIcon from '@mui/icons-material/LocalHospitalOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import DomainOutlinedIcon from '@mui/icons-material/DomainOutlined'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import HomeRepairServiceOutlinedIcon from '@mui/icons-material/HomeRepairServiceOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import PrecisionManufacturingOutlinedIcon from '@mui/icons-material/PrecisionManufacturingOutlined'
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined'
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined'
import { fetchCategoryOverview } from '@/api/siteCategories'
import { hasPermission } from '@/config/permissions'
import { CATEGORIES, CATEGORIES_LABEL, COMPLIANCE_LINKS, SERVICE_LINK } from '@/config/siteCategories'
import { useActiveFacility, useFacilityStore } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'

type MenuName = 'inspections' | 'categories' | 'compliance'

// The inspection screens, in the order somebody works through them.
const INSPECTION_LINKS = [
  { name: 'Departments', description: 'Items, forms and what is due', path: '/departments',
    icon: <DomainOutlinedIcon /> },
  { name: 'Visits', description: 'Scheduled inspections and results', path: '/inspection-visits',
    icon: <EventAvailableOutlinedIcon /> },
  { name: 'Fleet', description: "This site's vehicles", path: '/fleet',
    icon: <LocalShippingOutlinedIcon /> },
  { name: 'Red tags', description: 'Not up to standard', path: '/red-tags',
    icon: <ReportProblemOutlinedIcon /> },
]

// Screens that belong to the site but are not tiles on its dashboard. Each
// sits at the end of the menu it belongs to, below a line.
const MORE_LINKS: Record<MenuName, Array<{ name: string; description: string; path: string; icon: JSX.Element; module: string }>> = {
  inspections: [
    { name: 'Inspection forms', description: 'Build the checklists departments use', path: '/inspections',
      icon: <DescriptionOutlinedIcon />, module: 'inspections' },
  ],
  categories: [
    { name: 'Asset Register', description: 'Every machine, its history and value', path: '/assets',
      icon: <PrecisionManufacturingOutlinedIcon />, module: 'facility-inventory' },
    { name: 'Assets & Value', description: 'Cost, book value, full history', path: '/asset-ledger',
      icon: <AccountBalanceOutlinedIcon />, module: 'facility-inventory' },
    { name: 'Parts & Spares', description: 'Sales and rental parts', path: '/inventory',
      icon: <Inventory2OutlinedIcon />, module: 'inventory' },
    { name: 'Test Equipment', description: 'Test equipment library', path: '/test-equipment',
      icon: <ScienceOutlinedIcon />, module: 'test-equipment' },
  ],
  compliance: [
    { name: 'Contractors', description: 'Contractors, contracts, credentials', path: '/vendors',
      icon: <HandshakeOutlinedIcon />, module: 'vendors' },
  ],
}

export default function SiteNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const user = useAuthStore((s) => s.user)
  const storedSite = useFacilityStore((s) => s.facilityId)
  const { facility } = useActiveFacility()
  const [anchor, setAnchor] = useState<{ name: MenuName; el: HTMLElement } | null>(null)

  const showCategories = hasPermission(user, 'facility-inventory', 'index')
  const showService = hasPermission(user, SERVICE_LINK.module, 'index')
  const complianceLinks = COMPLIANCE_LINKS.filter((link) => hasPermission(user, link.module, 'index'))
  const more = (menu: MenuName) => MORE_LINKS[menu].filter((link) => hasPermission(user, link.module, 'index'))
  const showCompliance = complianceLinks.length + more('compliance').length > 0
  const showInspections = hasPermission(user, 'inspections', 'index')
  const inInspections = ['/departments', '/inspection-visits', '/fleet', '/red-tags', '/inspections']
    .some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  const inCompliance = ['/compliance', '/permits', '/vendors']
    .some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

  const { data: overview } = useQuery({
    queryKey: ['category-overview', storedSite],
    queryFn: () => fetchCategoryOverview(storedSite as number),
    enabled: storedSite != null && showCategories,
    staleTime: 60_000,
  })

  // Choosing a site is the Sites page's job; there is no site to navigate yet.
  if (storedSite == null || pathname === '/sites' || !facility) return null
  if (!showCategories && !showService && !showCompliance && !showInspections) return null

  const counts = Object.fromEntries((overview?.categories ?? []).map((c) => [c.code, c]))
  const go = (path: string) => { setAnchor(null); navigate(path) }
  // MUI menus take an array of children, not fragments, for keyboard focus.
  const moreRows = (menu: MenuName) => {
    const links = more(menu)
    if (!links.length) return []
    return [
      <Divider key="more-divider" sx={{ my: 0.5 }} />,
      ...links.map((link) => (
        <MenuItem key={link.path} selected={pathname === link.path || pathname.startsWith(`${link.path}/`)}
                  onClick={() => go(link.path)} sx={{ py: 1 }}>
          <ListItemIcon sx={{ color: palette.textMuted }}>{link.icon}</ListItemIcon>
          <ListItemText primary={link.name} secondary={link.description}
                        primaryTypographyProps={{ fontWeight: 800, fontSize: 14 }}
                        secondaryTypographyProps={{ fontSize: 12 }} />
        </MenuItem>
      )),
    ]
  }

  const tabSx = (active: boolean) => ({
    flexShrink: 0, textTransform: 'none', fontWeight: 900, fontSize: 13.5, borderRadius: '11px',
    px: 1.5, py: 0.6, color: active ? palette.brandDeep : palette.textStrong,
    bgcolor: active ? palette.brandTint : 'transparent',
    border: `1px solid ${active ? palette.brandBorder : 'transparent'}`,
    '&:hover': { bgcolor: active ? palette.brandTint : palette.surfaceMuted },
  })

  return (
    <Box
      component="nav" aria-label="Site navigation"
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0,
        px: { xs: 1.25, sm: 2, md: 3 }, py: 0.9, overflowX: 'auto',
        borderBottom: `1px solid ${palette.borderSlate}`, bgcolor: 'rgba(255,255,255,0.7)',
        scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      <Button
        onClick={() => go(`/sites/${facility.id}`)}
        aria-label={facility.name}
        sx={{ ...tabSx(pathname === `/sites/${facility.id}`), maxWidth: { xs: 44, sm: 300 }, minWidth: 0,
              color: palette.brand, gap: 0.75 }}
      >
        <LocalHospitalOutlinedIcon sx={{ fontSize: 20 }} />
        {/* On a phone the icon alone: the name would push the menus off screen. */}
        <Typography noWrap sx={{ display: { xs: 'none', sm: 'block' }, fontWeight: 900, fontSize: 13.5 }}>
          {facility.name}
        </Typography>
      </Button>
      <Box sx={{ width: '1px', height: 22, bgcolor: palette.borderSlate, flexShrink: 0, mx: 0.25 }} />

      {showInspections && (
        <Button
          endIcon={<KeyboardArrowDownRoundedIcon />}
          aria-haspopup="menu" aria-expanded={anchor?.name === 'inspections'}
          onClick={(e) => setAnchor({ name: 'inspections', el: e.currentTarget })}
          sx={tabSx(inInspections)}
        >
          Inspections
        </Button>
      )}
      {showCategories && (
        <Button
          endIcon={<KeyboardArrowDownRoundedIcon />}
          aria-haspopup="menu" aria-expanded={anchor?.name === 'categories'}
          onClick={(e) => setAnchor({ name: 'categories', el: e.currentTarget })}
          sx={tabSx(['/categories', '/assets', '/asset-ledger', '/inventory', '/test-equipment']
            .some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))}
        >
          {CATEGORIES_LABEL}
        </Button>
      )}
      {showService && (
        <Button
          startIcon={<HomeRepairServiceOutlinedIcon />} onClick={() => go(SERVICE_LINK.path)}
          sx={tabSx(pathname.startsWith('/service') || pathname.startsWith('/equipment-maintenance'))}
        >
          Service
        </Button>
      )}
      {showCompliance && (
        <Button
          endIcon={<KeyboardArrowDownRoundedIcon />}
          aria-haspopup="menu" aria-expanded={anchor?.name === 'compliance'}
          onClick={(e) => setAnchor({ name: 'compliance', el: e.currentTarget })}
          sx={tabSx(inCompliance)}
        >
          Compliance
        </Button>
      )}

      <Menu
        anchorEl={anchor?.el} open={anchor?.name === 'inspections'} onClose={() => setAnchor(null)}
        PaperProps={{ sx: { borderRadius: '14px', minWidth: 240, mt: 0.5 } }}
      >
        {INSPECTION_LINKS.map((link) => (
          <MenuItem key={link.path} selected={pathname.startsWith(link.path)} onClick={() => go(link.path)}
                    sx={{ py: 1 }}>
            <ListItemIcon sx={{ color: palette.brand }}>{link.icon}</ListItemIcon>
            <ListItemText primary={link.name} secondary={link.description}
                          primaryTypographyProps={{ fontWeight: 800, fontSize: 14 }}
                          secondaryTypographyProps={{ fontSize: 12 }} />
          </MenuItem>
        ))}
        {moreRows('inspections')}
      </Menu>
      <Menu
        anchorEl={anchor?.el} open={anchor?.name === 'categories'} onClose={() => setAnchor(null)}
        PaperProps={{ sx: { borderRadius: '14px', minWidth: 240, mt: 0.5 } }}
      >
        {CATEGORIES.map((c) => {
          const summary = counts[c.code]
          return (
            <MenuItem key={c.code} selected={pathname === c.path} onClick={() => go(c.path)} sx={{ py: 1 }}>
              <ListItemIcon sx={{ color: c.colour }}>{c.icon}</ListItemIcon>
              <ListItemText
                primary={c.name}
                secondary={summary ? `${summary.equipment} item${summary.equipment === 1 ? '' : 's'}` : undefined}
                primaryTypographyProps={{ fontWeight: 800, fontSize: 14 }}
                secondaryTypographyProps={{ fontSize: 12 }}
              />
              {summary && summary.needs_attention + summary.out_of_service > 0 && (
                <Box sx={{ ml: 2, px: 0.75, borderRadius: '8px', fontSize: 11.5, fontWeight: 900,
                           bgcolor: palette.warningTint, color: palette.warningDeep }}>
                  {summary.needs_attention + summary.out_of_service}
                </Box>
              )}
            </MenuItem>
          )
        })}
        {moreRows('categories')}
      </Menu>
      <Menu
        anchorEl={anchor?.el} open={anchor?.name === 'compliance'} onClose={() => setAnchor(null)}
        PaperProps={{ sx: { borderRadius: '14px', minWidth: 220, mt: 0.5 } }}
      >
        {complianceLinks.map((link) => (
          <MenuItem key={link.path} selected={pathname.startsWith(link.path)} onClick={() => go(link.path)} sx={{ py: 1 }}>
            <ListItemIcon sx={{ color: palette.brand }}>{link.icon}</ListItemIcon>
            <ListItemText primary={link.name} secondary={link.description}
                          primaryTypographyProps={{ fontWeight: 800, fontSize: 14 }}
                          secondaryTypographyProps={{ fontSize: 12 }} />
          </MenuItem>
        ))}
        {moreRows('compliance')}
      </Menu>
    </Box>
  )
}
