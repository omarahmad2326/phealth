import { useEffect, useMemo, useState } from 'react'
import { Box, InputBase, Tooltip, Typography } from '@mui/material'
import { useLocation, useNavigate } from 'react-router-dom'
import DashboardIcon from '@mui/icons-material/Dashboard'
import HandshakeIcon from '@mui/icons-material/Handshake'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import InventoryIcon from '@mui/icons-material/Inventory'
import ScienceIcon from '@mui/icons-material/Science'
import AssessmentIcon from '@mui/icons-material/Assessment'
import PeopleIcon from '@mui/icons-material/People'
import ChatBubbleIcon from '@mui/icons-material/ChatBubble'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import TimerIcon from '@mui/icons-material/Timer'
import BeachAccessIcon from '@mui/icons-material/BeachAccess'
import PaymentIcon from '@mui/icons-material/Payment'
import GroupsIcon from '@mui/icons-material/Groups'
import LogoutIcon from '@mui/icons-material/Logout'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import DomainOutlinedIcon from '@mui/icons-material/DomainOutlined'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import HomeRepairServiceIcon from '@mui/icons-material/HomeRepairService'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import LocalHospitalOutlinedIcon from '@mui/icons-material/LocalHospitalOutlined'
import ListAltIcon from '@mui/icons-material/ListAlt'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline'
import InsightsIcon from '@mui/icons-material/Insights'
import { useActiveFacility } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { getVisibleModules, hasPermission, type Module, type PermissionAction } from '@/config/permissions'
import { CATEGORIES } from '@/config/siteCategories'
import { palette } from '@/theme/palette'

// The side bar follows the dashboard flow. First what spans every site:
// Sites, the page you land on, and the lists behind its cards. Then the site
// you are in, laid out exactly as its own dashboard is - Dashboard, then
// Inspections, Facility, Service and Compliance, each starting with the tiles
// that dashboard shows, in its order, with the few screens it does not show
// at the end of the section they belong to. Then the organisation above the
// sites. "Dashboard" inside a site only ever means that site's dashboard.
type ModuleGroup =
  | 'All sites' | 'Site' | 'Inspections' | 'Facility' | 'Service' | 'Compliance'
  | 'Organisation' | 'People' | 'Commerce' | 'Workspace'

/**
 * Whether a module spans every site, belongs to the site you are in, or to
 * the organisation above them. Site screens only show once a site is open.
 */
type ModuleScope = 'all' | 'site' | 'org'

interface SidebarItem {
  text: string
  description: string
  icon: JSX.Element
  /** `:site` stands for the site you are in. */
  path: string
  module: Module
  group: ModuleGroup
  scope?: ModuleScope
  /** Beyond seeing the module, what the person must be allowed to do. */
  action?: PermissionAction
  /** Only this exact address counts as being here, not the pages under it. */
  exact?: boolean
  /** Does something rather than go somewhere, so it is never "where you are". */
  command?: boolean
  subItems?: { text: string; path: string }[]
}

const groupOrder: ModuleGroup[] = [
  'All sites', 'Site', 'Inspections', 'Facility', 'Service', 'Compliance',
  'Organisation', 'People', 'Commerce', 'Workspace',
]

/** Groups whose section heading already says what they are. */
const UNTITLED_GROUPS: ModuleGroup[] = ['All sites', 'Site', 'Organisation']

const allMenuItems: SidebarItem[] = [
  // ── every site ──
  { text: 'Sites', description: 'Every site: passed, failed, overdue', icon: <HomeRoundedIcon />, path: '/sites', module: 'facilities', group: 'All sites', scope: 'all', exact: true },
  { text: 'Inspection status', description: 'What passed, failed, is due or overdue', icon: <ListAltIcon />, path: '/inspection-status', module: 'inspections', group: 'All sites', scope: 'all' },
  // ── this site, as its dashboard lays it out ──
  { text: 'Dashboard', description: "This site's own dashboard", icon: <DashboardIcon />, path: '/sites/:site', module: 'facilities', group: 'Site', exact: true },
  { text: 'People here', description: 'Everyone assigned to this site', icon: <PeopleOutlineIcon />, path: '/sites/:site?panel=people', module: 'facilities', group: 'Site', command: true },
  { text: 'Departments', description: 'Each department, its items and what is due', icon: <DomainOutlinedIcon />, path: '/departments', module: 'inspections', group: 'Inspections' },
  { text: 'Visits', description: 'Scheduled inspections and their results', icon: <EventAvailableIcon />, path: '/inspection-visits', module: 'inspections', group: 'Inspections' },
  { text: 'Fleet', description: "This site's vehicles and their inspections", icon: <LocalShippingIcon />, path: '/fleet', module: 'inspections', group: 'Inspections' },
  { text: 'Red tags', description: 'What is not up to standard, and what was done', icon: <ReportProblemOutlinedIcon />, path: '/red-tags', module: 'inspections', group: 'Inspections' },
  { text: 'Inspection forms', description: 'Build the checklists departments are inspected on', icon: <DescriptionOutlinedIcon />, path: '/inspections', module: 'inspections', group: 'Inspections' },
  ...CATEGORIES.map((category): SidebarItem => ({
    text: category.name, description: `${category.name} equipment at this site`, icon: category.icon,
    path: category.path, module: 'facility-inventory', group: 'Facility',
  })),
  { text: 'Asset Register', description: 'Every machine, its plan, history and value', icon: <PrecisionManufacturingIcon />, path: '/assets', module: 'facility-inventory', group: 'Facility' },
  { text: 'Assets & Value', description: 'Cost, book value, and full history', icon: <AccountBalanceIcon />, path: '/asset-ledger', module: 'facility-inventory', group: 'Facility' },
  { text: 'Parts & Spares', description: 'Sales and rental parts', icon: <InventoryIcon />, path: '/inventory', module: 'inventory', group: 'Facility' },
  { text: 'Test Equipment', description: 'Global test equipment library', icon: <ScienceIcon />, path: '/test-equipment', module: 'test-equipment', group: 'Facility' },
  // Inspect to keep things to standard, service when something is at fault:
  // side by side, as on the site's dashboard.
  { text: 'Inspection', description: 'Start an inspection now', icon: <PlaylistAddCheckIcon />, path: '/inspection-visits?new=1', module: 'inspections', group: 'Service', action: 'add', command: true },
  { text: 'Service', description: 'Faults and malfunctions, assigned and costed', icon: <HomeRepairServiceIcon />, path: '/service', module: 'service-requests', group: 'Service' },
  { text: 'Compliance', description: 'Regulatory schedules and certificates', icon: <FactCheckIcon />, path: '/compliance', module: 'compliance', group: 'Compliance' },
  { text: 'Permits to Work', description: 'ICRA, ILSM, hot work, and shutdowns', icon: <VerifiedUserIcon />, path: '/permits', module: 'permits', group: 'Compliance' },
  { text: 'Contractors', description: 'Contractors, contracts, and credentials', icon: <HandshakeIcon />, path: '/vendors', module: 'vendors', group: 'Compliance' },
  // ── the organisation ──
  { text: 'Business dashboard', description: 'Revenue, collections and alerts', icon: <InsightsIcon />, path: '/dashboard', module: 'dashboard', group: 'Organisation', scope: 'org' },
  {
    text: 'Sales', description: 'Quotations, invoices, and sales', icon: <ShoppingCartIcon />, path: '/sales/quotations', module: 'sales', group: 'Commerce', scope: 'org',
    subItems: [
      { text: 'Quotations', path: '/sales/quotations' },
      { text: 'Invoice', path: '/sales/invoices' },
      { text: 'In Progress', path: '/sales/in-progress' },
      { text: 'Completed', path: '/sales/completed' },
    ],
  },
  {
    text: 'Rentals', description: 'Agreements and recurring billing', icon: <LocalShippingIcon />, path: '/rentals/agreements', module: 'rentals', group: 'Commerce', scope: 'org',
    subItems: [
      { text: 'Agreements', path: '/rentals/agreements' },
      { text: 'Invoice', path: '/rentals/invoices' },
      { text: 'Products', path: '/rentals/products' },
      { text: 'History', path: '/rentals/history' },
    ],
  },
  { text: 'Billing', description: 'Invoices, payments, and ledgers', icon: <PaymentIcon />, path: '/billing', module: 'billing', group: 'Commerce', scope: 'org' },
  { text: 'Users', description: 'Users, roles, and permissions', icon: <PeopleIcon />, path: '/users', module: 'users', group: 'People', scope: 'org' },
  { text: 'HR', description: 'Human resources management', icon: <GroupsIcon />, path: '/hr', module: 'hr', group: 'People', scope: 'org' },
  { text: 'Attendance', description: 'Attendance and working hours', icon: <AccessTimeIcon />, path: '/attendance', module: 'attendance', group: 'People', scope: 'org' },
  { text: 'My Timesheets', description: 'Personal time records', icon: <TimerIcon />, path: '/my-timesheets', module: 'my-timesheets', group: 'People', scope: 'org' },
  { text: 'My Leave', description: 'Personal leave requests', icon: <BeachAccessIcon />, path: '/my-leave', module: 'my-leave', group: 'People', scope: 'org' },
  { text: 'Reports', description: 'Service and inspection reporting', icon: <AssessmentIcon />, path: '/reports', module: 'reports', group: 'Workspace', scope: 'org' },
  { text: 'Chat', description: 'Team and facility conversations', icon: <ChatBubbleIcon />, path: '/chat', module: 'chat', group: 'Workspace', scope: 'org' },
  { text: 'Calendar', description: 'Schedules and shared events', icon: <CalendarMonthIcon />, path: '/calendar', module: 'calendar', group: 'Workspace', scope: 'org' },
]

const Sidebar = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuthStore((state) => state.logout)
  const user = useAuthStore((state) => state.user)
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<ModuleGroup>>(new Set())

  const { facility } = useActiveFacility()
  const visibleModules = getVisibleModules(user)
  const menuItems = useMemo(
    () => allMenuItems.filter((item) => visibleModules.includes(item.module)
      && (!item.action || hasPermission(user, item.module, item.action))),
    [visibleModules, user],
  )

  /** Where an item goes, with `:site` read as the site you are in. */
  const pathFor = (item: SidebarItem) =>
    facility ? item.path.replace(':site', String(facility.id)) : item.path

  const isActive = (item: SidebarItem) => {
    if (item.command) return false
    const path = pathFor(item).split('?')[0]
    if (item.exact) return location.pathname === path
    if (item.subItems) {
      return item.subItems.some((subItem) => (
        location.pathname === subItem.path || location.pathname.startsWith(`${subItem.path}/`)
      ))
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }

  const currentItem = menuItems.find(isActive)
  const normalizedSearch = search.trim().toLowerCase()
  const filteredItems = menuItems.filter((item) => (
    !normalizedSearch
    || item.text.toLowerCase().includes(normalizedSearch)
    || item.description.toLowerCase().includes(normalizedSearch)
    || item.group.toLowerCase().includes(normalizedSearch)
  ))
  const groupsOf = (scope: ModuleScope) => groupOrder
    .map((group) => ({
      group,
      items: filteredItems.filter(
        (item) => item.group === group && (item.scope ?? 'site') === scope,
      ),
    }))
    .filter(({ items }) => items.length > 0)

  const allSiteGroups = groupsOf('all')
  const siteGroups = facility ? groupsOf('site') : []
  const orgGroups = groupsOf('org')
  // Used only for the empty-search message, so it still reflects everything.
  const groupedItems = [...allSiteGroups, ...siteGroups, ...orgGroups]

  const closeLauncher = () => {
    setLauncherOpen(false)
    setSearch('')
    setExpandedGroups(new Set())
  }

  const toggleGroup = (group: ModuleGroup) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const openModule = (path: string) => {
    closeLauncher()
    navigate(path)
  }

  useEffect(() => {
    setLauncherOpen(false)
    setSearch('')
  }, [location.pathname])

  useEffect(() => {
    if (!launcherOpen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLauncher()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [launcherOpen])

  /** Groups whose items should collapse under a dropdown toggle. */
  const COLLAPSIBLE_GROUPS: ModuleGroup[] = [
    'Inspections', 'Facility', 'Compliance', 'People', 'Commerce', 'Workspace',
  ]

  useEffect(() => {
    if (launcherOpen && currentItem && COLLAPSIBLE_GROUPS.includes(currentItem.group)) {
      setExpandedGroups((prev) => new Set([...prev, currentItem.group]))
    }
  }, [launcherOpen, currentItem])

  /** One section of the launcher. Shared so the two cannot drift apart. */
  const renderGroups = (groups: Array<{ group: ModuleGroup; items: SidebarItem[] }>) =>
    groups.map(({ group, items }) => {
      const collapsible = COLLAPSIBLE_GROUPS.includes(group)
      const expanded = expandedGroups.has(group) || Boolean(normalizedSearch)
      const anyActive = items.some(isActive)

      return (
                <Box key={group} sx={{ mb: 1.75 }}>
                  {collapsible ? (
                    /* ── Collapsible group header ─────────────────────── */
                    <Box
                      component="button" type="button"
                      onClick={() => toggleGroup(group)}
                      aria-expanded={expanded}
                      sx={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 0.5,
                        px: 0.75, py: 0.5, mb: 0.5, border: 0, borderRadius: '10px',
                        cursor: 'pointer', bgcolor: 'transparent',
                        transition: 'background-color 140ms ease',
                        '&:hover': { bgcolor: '#f1faf6' },
                        '&:focus-visible': { outline: '3px solid rgba(4,120,87,0.2)', outlineOffset: 1 },
                      }}
                    >
                      <KeyboardArrowDownRoundedIcon
                        sx={{
                          fontSize: 18, color: anyActive ? palette.brand : '#8992A4',
                          transition: 'transform 200ms ease',
                          transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                        }}
                      />
                      <Typography
                        sx={{
                          color: anyActive ? palette.brand : '#8992A4',
                          fontSize: '0.67rem', fontWeight: 900,
                          letterSpacing: '0.11em', textTransform: 'uppercase',
                        }}
                      >
                        {group}
                      </Typography>
                      {!expanded && anyActive && (
                        <Box sx={{ ml: 'auto', width: 7, height: 7, borderRadius: '50%', bgcolor: palette.brand }} />
                      )}
                    </Box>
                  ) : UNTITLED_GROUPS.includes(group) ? null : (
                    /* ── Normal static group header ───────────────────── */
                    <Typography sx={{ px: 0.75, mb: 0.7, color: '#8992A4', fontSize: '0.67rem', fontWeight: 900, letterSpacing: '0.11em', textTransform: 'uppercase' }}>
                      {group}
                    </Typography>
                  )}

                  {/* ── Items: grid for normal groups, vertical list for collapsible ── */}
                  <Box
                    sx={collapsible ? {
                      display: 'flex', flexDirection: 'column', gap: 0.25,
                      maxHeight: expanded ? `${items.length * 64}px` : '0px',
                      overflow: 'hidden',
                      transition: 'max-height 260ms cubic-bezier(0.4, 0, 0.2, 1)',
                    } : {
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                      gap: 0.75,
                    }}
                  >
                    {items.map((item) => {
                      const active = isActive(item)

                      if (collapsible) {
                        /* ── Compact dropdown row for collapsible groups ── */
                        return (
                          <Box
                            key={item.path} component="button" type="button" onClick={() => openModule(pathFor(item))}
                            aria-current={active ? 'page' : undefined}
                            sx={{
                              minWidth: 0, display: 'flex', alignItems: 'center', gap: 1,
                              px: 1.25, py: 0.85, textAlign: 'left', borderRadius: '12px',
                              border: active ? '1px solid rgba(4,120,87,0.28)' : '1px solid transparent',
                              background: active ? 'linear-gradient(135deg, #effffb 0%, #f6fff9 100%)' : 'transparent',
                              cursor: 'pointer', color: palette.ink,
                              transition: 'transform 140ms ease, background-color 140ms ease, border-color 140ms ease',
                              '&:hover': {
                                bgcolor: active ? undefined : '#f7fcfb',
                                borderColor: active ? undefined : palette.brandBorder,
                              },
                              '&:focus-visible': { outline: '3px solid rgba(4,120,87,0.2)', outlineOffset: 1 },
                            }}
                          >
                            <Box
                              sx={{
                                width: 32, height: 32, borderRadius: '10px', flexShrink: 0,
                                display: 'grid', placeItems: 'center',
                                color: active ? '#fff' : palette.brandLight,
                                background: active
                                  ? `linear-gradient(135deg, ${palette.brand}, ${palette.accent})`
                                  : palette.brandTint,
                                boxShadow: active ? '0 6px 14px rgba(4,120,87,0.18)' : 'none',
                                '& svg': { fontSize: 17 },
                              }}
                            >
                              {item.icon}
                            </Box>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 850, color: palette.brandDeep, lineHeight: 1.25 }}>
                                {item.text}
                              </Typography>
                            </Box>
                            <ArrowForwardRoundedIcon sx={{ fontSize: 15, color: active ? palette.brandPale : '#C0C5D0', flexShrink: 0 }} />
                          </Box>
                        )
                      }

                      /* ── Standard tile for normal groups ── */
                      return (
                        <Box
                          key={item.path} component="button" type="button" onClick={() => openModule(pathFor(item))}
                          aria-current={active ? 'page' : undefined}
                          sx={{
                            minWidth: 0, minHeight: 72, display: 'flex', alignItems: 'center', gap: 1.25,
                            p: 1.15, textAlign: 'left', borderRadius: '16px',
                            border: active ? '1px solid rgba(4,120,87,0.34)' : '1px solid transparent',
                            background: active ? 'linear-gradient(135deg, #effffb 0%, #FFF3F8 100%)' : 'transparent',
                            cursor: 'pointer', color: palette.ink,
                            transition: 'transform 160ms ease, background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
                            '&:hover': {
                              transform: 'translateY(-1px)', bgcolor: active ? undefined : '#f7fcfb',
                              borderColor: active ? undefined : palette.brandBorder, boxShadow: '0 10px 24px rgba(4,120,87,0.08)',
                            },
                            '&:focus-visible': { outline: '3px solid rgba(4,120,87,0.2)', outlineOffset: 1 },
                          }}
                        >
                          <Box
                            sx={{
                              width: 42, height: 42, borderRadius: '14px', flexShrink: 0, display: 'grid', placeItems: 'center',
                              color: active ? '#fff' : palette.brandLight,
                              background: active ? `linear-gradient(135deg, ${palette.brand}, ${palette.accent})` : palette.brandTint,
                              boxShadow: active ? '0 10px 22px rgba(4,120,87,0.24)' : 'none', '& svg': { fontSize: 21 },
                            }}
                          >
                            {item.icon}
                          </Box>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography sx={{ fontSize: '0.84rem', fontWeight: 850, color: palette.brandDeep, lineHeight: 1.25 }} noWrap>
                              {item.text}
                            </Typography>
                            <Typography sx={{ mt: 0.25, fontSize: '0.67rem', fontWeight: 600, color: '#8992A4', lineHeight: 1.35 }} noWrap>
                              {item.description}
                            </Typography>
                          </Box>
                          <ArrowForwardRoundedIcon sx={{ fontSize: 17, color: active ? palette.brandPale : '#C0C5D0', flexShrink: 0 }} />
                        </Box>
                      )
                    })}
                  </Box>
                </Box>
      )
    })

  return (
    <Box
      component="aside"
      sx={{
        width: { xs: '100%', sm: 72 },
        height: { xs: 'calc(64px + env(safe-area-inset-bottom))', sm: '100dvh', md: 'calc(100dvh - 24px)' },
        // The landing page brand, --lp-brand, flat rather than the old
        // gradient so the rail is the one colour the public pages use.
        // Not brandLight: the rail carries white icons, and white on
        // brandLight is 1.92:1.
        background: palette.brand,
        display: 'flex', flexDirection: { xs: 'row', sm: 'column' }, alignItems: 'center',
        py: { xs: 1, sm: 3 }, px: { xs: 1.25, sm: 0 }, gap: 1, flexShrink: 0, overflow: 'visible',
        boxShadow: '0 24px 60px rgba(4,120,87,0.22)',
        position: { xs: 'fixed', sm: 'relative' },
        left: 0, right: 0, bottom: 0,
        zIndex: 1300,
        borderRadius: { xs: '18px 18px 0 0', sm: 0, md: '28px' },
      }}
    >
      <Box
        aria-label="MedRad"
        sx={{
          width: { xs: 42, sm: 48 }, height: { xs: 42, sm: 48 }, borderRadius: { xs: '14px', sm: '18px' },
          background: 'rgba(255,255,255,0.15)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', mb: { xs: 0, sm: 3 },
          border: '1px solid rgba(255,255,255,0.25)', backdropFilter: 'blur(10px)',
          fontWeight: 900, fontSize: '1.2rem', color: '#fff',
          boxShadow: '0 12px 28px rgba(6,78,59,0.18)',
        }}
      >
        M
      </Box>

      {visibleModules.includes('facilities') && (
        <RailButton
          label="Sites" icon={<HomeRoundedIcon />} active={location.pathname === '/sites'}
          onClick={() => openModule('/sites')}
        />
      )}
      {facility && visibleModules.includes('facilities') && (
        <RailButton
          label={facility.name} icon={<LocalHospitalOutlinedIcon />}
          active={location.pathname === `/sites/${facility.id}`}
          onClick={() => openModule(`/sites/${facility.id}`)}
        />
      )}

      <Tooltip title={launcherOpen ? 'Close modules' : `Open modules${currentItem ? ` · ${currentItem.text}` : ''}`} placement="right" arrow>
        <Box
          component="button" type="button" aria-label="Open module navigation"
          aria-expanded={launcherOpen} aria-controls={launcherOpen ? 'module-launcher' : undefined}
          onClick={() => setLauncherOpen((open) => !open)}
          sx={{
            width: { xs: 42, sm: 48 }, height: { xs: 42, sm: 48 }, p: 0, borderRadius: { xs: '14px', sm: '16px' },
            border: '1px solid rgba(255,255,255,0.26)',
            background: launcherOpen ? '#fff' : 'rgba(255,255,255,0.17)',
            color: launcherOpen ? palette.brand : '#fff', display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative',
            boxShadow: launcherOpen ? '0 16px 34px rgba(6,78,59,0.28)' : '0 10px 24px rgba(6,78,59,0.14)',
            transition: 'transform 180ms ease, background-color 180ms ease, box-shadow 180ms ease',
            '&:hover': { transform: 'translateY(-2px)', background: launcherOpen ? '#fff' : 'rgba(255,255,255,0.24)' },
            '&:focus-visible': { outline: '3px solid rgba(255,255,255,0.42)', outlineOffset: 3 },
            '&::after': currentItem ? {
              content: '""', position: 'absolute', right: -3, top: -3,
              width: 10, height: 10, borderRadius: '50%', bgcolor: '#FF7AAE',
              border: `2px solid ${palette.brandLight}`, boxShadow: '0 0 0 3px rgba(255,122,174,0.18)',
            } : undefined,
          }}
        >
          {launcherOpen ? <CloseRoundedIcon /> : <AppsRoundedIcon />}
        </Box>
      </Tooltip>


      <Box sx={{ flex: 1 }} />

      <Tooltip title="Logout" placement="right" arrow>
        <Box
          component="button" type="button" aria-label="Logout"
          onClick={() => { closeLauncher(); logout(); navigate('/login') }}
          sx={{
            width: { xs: 42, sm: 48 }, height: { xs: 42, sm: 48 }, p: 0, border: 0, borderRadius: '14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            color: 'rgba(255,255,255,0.65)', background: 'transparent',
            transition: 'all 180ms ease', mb: { xs: 0, sm: 1 },
            '&:hover': { backgroundColor: 'rgba(239,68,68,0.16)', color: '#FFD5D5' },
            '&:focus-visible': { outline: '3px solid rgba(255,255,255,0.35)', outlineOffset: 2 },
            '& svg': { fontSize: '1.4rem' },
          }}
        >
          <LogoutIcon />
        </Box>
      </Tooltip>

      {launcherOpen && (
        <>
          <Box
            aria-hidden="true" onClick={closeLauncher}
            sx={{
              position: 'fixed', inset: 0, zIndex: 1290,
              background: 'rgba(6,78,59,0.14)', backdropFilter: 'blur(2px)',
              animation: 'moduleLauncherFade 160ms ease-out',
              '@keyframes moduleLauncherFade': { from: { opacity: 0 }, to: { opacity: 1 } },
            }}
          />
          <Box
            id="module-launcher" role="dialog" aria-label="Module navigation"
            sx={{
              position: 'fixed',
              top: { xs: 8, sm: 12, md: 24 },
              bottom: { xs: 'calc(72px + env(safe-area-inset-bottom))', sm: 'auto' },
              left: { xs: 8, sm: 82, md: 96 }, zIndex: 1301,
              width: { xs: 'calc(100vw - 16px)', sm: 480 },
              maxHeight: { xs: 'calc(100dvh - 88px - env(safe-area-inset-bottom))', sm: 'calc(100dvh - 24px)', md: 'calc(100dvh - 48px)' },
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              borderRadius: { xs: '22px', md: '28px' }, background: 'rgba(255,255,255,0.97)',
              border: '1px solid rgba(255,255,255,0.86)',
              boxShadow: '0 30px 90px rgba(6,78,59,0.28), 0 4px 18px rgba(4,120,87,0.12)',
              backdropFilter: 'blur(24px)', transformOrigin: 'left top',
              animation: 'moduleLauncherIn 210ms cubic-bezier(0.16, 1, 0.3, 1)',
              '@keyframes moduleLauncherIn': {
                from: { opacity: 0, transform: 'translateX(-10px) scale(0.97)' },
                to: { opacity: 1, transform: 'translateX(0) scale(1)' },
              },
            }}
          >
            <Box sx={{ px: { xs: 2, sm: 2.5 }, pt: 2.5, pb: 2, borderBottom: `1px solid ${palette.borderSoft}` }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 2 }}>
                <Box sx={{ minWidth: 0 }}>
                  {/* The hospital you are in, not the word "Modules". Everything
                      in the first section below is scoped to it. */}
                  <Typography noWrap sx={{ fontSize: '1.15rem', fontWeight: 900, color: palette.ink, letterSpacing: '-0.02em' }}>
                    {facility?.name ?? 'Choose a site'}
                  </Typography>
                  <Box sx={{ mt: 0.25, display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: '0.78rem', color: '#7B8497', fontWeight: 600 }}>
                      {facility
                        ? (currentItem ? `Currently in ${currentItem.text}` : 'Choose your workspace')
                        : 'Open a hospital to work in it'}
                    </Typography>
                    {facility && (
                      <Box
                        component="button" type="button"
                        onClick={() => openModule('/sites')}
                        sx={{
                          border: 0, p: 0, bgcolor: 'transparent', cursor: 'pointer',
                          fontSize: '0.78rem', fontWeight: 800, color: palette.brand,
                          '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        Switch site
                      </Box>
                    )}
                  </Box>
                </Box>
                <Box
                  component="button" type="button" aria-label="Close module navigation" onClick={closeLauncher}
                  sx={{
                    width: 34, height: 34, p: 0, border: 0, borderRadius: '11px', bgcolor: '#f1fffa',
                    color: palette.brandLight, display: 'grid', placeItems: 'center', cursor: 'pointer',
                    '&:hover': { bgcolor: palette.brandTint },
                  }}
                >
                  <CloseRoundedIcon sx={{ fontSize: 20 }} />
                </Box>
              </Box>
              <Box
                sx={{
                  height: 48, display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5,
                  borderRadius: '15px', bgcolor: '#f6fcfa', border: '1px solid #e6f7f2',
                  transition: 'border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease',
                  '&:focus-within': { bgcolor: '#fff', borderColor: palette.brandPale, boxShadow: '0 0 0 4px rgba(4,120,87,0.11)' },
                }}
              >
                <SearchRoundedIcon sx={{ color: '#8A94A6', fontSize: 21 }} />
                <InputBase
                  autoFocus fullWidth value={search} onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search modules" inputProps={{ 'aria-label': 'Search modules' }}
                  sx={{ color: palette.ink, fontSize: '0.9rem', fontWeight: 600, '& input::placeholder': { color: '#98A1B2', opacity: 1 } }}
                />
                {search && (
                  <Box
                    component="button" type="button" aria-label="Clear module search" onClick={() => setSearch('')}
                    sx={{ p: 0, border: 0, bgcolor: 'transparent', color: '#8A94A6', cursor: 'pointer', display: 'grid' }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 18 }} />
                  </Box>
                )}
              </Box>
            </Box>

            <Box
              sx={{
                flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 1.5, sm: 2 }, py: 1.5,
                scrollbarWidth: 'thin', scrollbarColor: 'rgba(4,120,87,0.25) transparent',
              }}
            >
              {([
                ['All sites', allSiteGroups],
                ['This site', siteGroups],
                ['Organisation', orgGroups],
              ] as const).filter(([, groups]) => groups.length > 0).map(([title, groups], index) => (
                <Box key={title} sx={index ? { mt: 0.5, pt: 1.75, borderTop: `1px solid ${palette.borderSoft}` } : {}}>
                  <Typography sx={{ px: 0.75, mb: 1.25, color: palette.textFaint, fontSize: '0.67rem', fontWeight: 900, letterSpacing: '0.11em', textTransform: 'uppercase' }}>
                    {title}
                  </Typography>
                  {renderGroups(groups)}
                </Box>
              ))}


              {groupedItems.length === 0 && (
                <Box sx={{ py: 6, px: 2, textAlign: 'center' }}>
                  <Box sx={{ width: 50, height: 50, borderRadius: '17px', bgcolor: '#eefffa', color: palette.brand, display: 'grid', placeItems: 'center', mx: 'auto', mb: 1.5 }}>
                    <SearchRoundedIcon />
                  </Box>
                  <Typography sx={{ fontWeight: 900, color: palette.brandDeep }}>No modules found</Typography>
                  <Typography sx={{ mt: 0.4, fontSize: '0.78rem', color: '#8992A4' }}>Try a different module name.</Typography>
                </Box>
              )}
            </Box>

            <Box sx={{ px: 2.5, py: 1.25, borderTop: `1px solid ${palette.borderSoft}`, bgcolor: '#FBFBFE', display: { xs: 'none', sm: 'flex' }, justifyContent: 'space-between' }}>
              <Typography sx={{ color: '#9AA2B2', fontSize: '0.68rem', fontWeight: 650 }}>Showing permitted modules only</Typography>
              <Typography sx={{ color: '#9AA2B2', fontSize: '0.68rem', fontWeight: 650 }}>Esc to close</Typography>
            </Box>
          </Box>
        </>
      )}
    </Box>
  )
}

/** A destination on the rail: Sites, or the site you are in. */
function RailButton({ label, icon, active, onClick }: {
  label: string; icon: JSX.Element; active: boolean; onClick: () => void
}) {
  return (
    <Tooltip title={label} placement="right" arrow>
      <Box
        component="button" type="button" aria-label={label} aria-current={active ? 'page' : undefined}
        onClick={onClick}
        sx={{
          width: { xs: 42, sm: 48 }, height: { xs: 42, sm: 48 }, p: 0, borderRadius: { xs: '14px', sm: '16px' },
          border: `1px solid ${active ? '#fff' : 'rgba(255,255,255,0.18)'}`,
          background: active ? '#fff' : 'transparent',
          color: active ? palette.brand : 'rgba(255,255,255,0.86)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          transition: 'transform 180ms ease, background-color 180ms ease',
          '&:hover': { transform: 'translateY(-2px)', background: active ? '#fff' : 'rgba(255,255,255,0.16)' },
          '&:focus-visible': { outline: '3px solid rgba(255,255,255,0.42)', outlineOffset: 3 },
          '& svg': { fontSize: '1.35rem' },
        }}
      >
        {icon}
      </Box>
    </Tooltip>
  )
}

export default Sidebar
