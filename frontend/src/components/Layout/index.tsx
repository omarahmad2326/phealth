import { useEffect } from 'react'
import { Box } from '@mui/material'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import SiteNav from './SiteNav'
import WorkingContextBar from '../WorkingContextBar'
import ModuleBackground from '../ModuleBackground'
import { PageTransition } from '../motion'
import { ListContextProvider } from '@/contexts/ListContext'
import { useIdleLogout } from '@/hooks/useIdleLogout'
import { useContentReveal } from '@/hooks/useContentReveal'
import AssistantWidget from '@/components/Assistant'
import { palette } from '@/theme/palette'

// Sign the user out after this much inactivity.
const SESSION_IDLE_TIMEOUT_MS = 180_000 // 180 seconds

// Safety net for a known class of MUI bug: a Menu/Select/Popover whose anchor or
// parent re-renders while it is open can be left "orphaned" — its component still
// thinks it is open, so an invisible full-screen MuiModal-backdrop stays in the
// DOM and silently swallows every click/scroll, freezing the whole page. This
// clears any such lingering overlay on first paint and on every route change.
function useDismissOrphanedOverlays(pathname: string) {
  useEffect(() => {
    // On navigation, close any still-live menu/popover the clean way (Escape +
    // clicking its backdrop fires MUI's own onClose). We never remove DOM nodes
    // directly — that can crash React's reconciler and blank the page. Any node
    // that is genuinely orphaned (no live handlers) is neutralised purely via CSS
    // (see .MuiPopover-root[aria-hidden="true"] in global.css), so it can't show
    // a floating box or block clicks.
    const closeCleanly = () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      document.querySelectorAll<HTMLElement>('.MuiModal-root').forEach(modal => {
        if (modal.querySelector('.MuiPopover-paper, .MuiMenu-paper') && !modal.querySelector('.MuiDialog-paper')) {
          modal.querySelector<HTMLElement>('.MuiBackdrop-root')?.click()
        }
      })
    }
    const raf = window.requestAnimationFrame(closeCleanly)
    const timer = window.setTimeout(closeCleanly, 80)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [pathname])
}

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/sites': 'Sites',
  '/assets': 'Asset Register',
  '/categories': 'Facility',
  '/service': 'Service',
  '/equipment-maintenance': 'Service',
  '/maintenance': 'Maintenance Plans',
  '/permits': 'Permits to Work',
  '/compliance': 'Compliance',
  '/asset-ledger': 'Assets & Value',
  '/locations': 'Buildings & Rooms',
  '/spaces': 'Beds & Theatres',
  '/vendors': 'Contractors',
  '/facilities': 'Site administration',
  '/users': 'User Management',
  '/chat': 'Chat',
  '/service-requests': 'Service Requests',
  '/inspections': 'Inspection forms',
  '/departments': 'Departments',
  '/inspection-visits': 'Inspection visits',
  '/fleet': 'Fleet',
  '/red-tags': 'Red tags',
  '/sales/quotations': 'Sales Quotations',
  '/sales/invoices': 'Sales Invoices',
  '/sales/in-progress': 'Sales In Progress',
  '/sales/completed': 'Completed Sales',
  '/sales/history': 'Sales History',
  '/sales': 'Sales',
  '/rentals': 'Rentals',
  '/inventory': 'Parts Inventory',
  '/reports': 'Reports',
  '/billing': 'Billing & Payments',
  '/attendance': 'Smart Attendance',
  '/profile': 'Profile Settings',
}

const Layout = () => {
  const location = useLocation()
  useDismissOrphanedOverlays(location.pathname)
  useIdleLogout(SESSION_IDLE_TIMEOUT_MS)
  useContentReveal(location.pathname)
  const title = Object.entries(pageTitles).find(([path]) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
  )?.[1] ?? 'Medrad'

  return (
    <ListContextProvider>
      <Box sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        height: '100dvh',
        minHeight: '100dvh',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #E8F5F0 0%, #F4F7FC 52%, #E8EEFA 100%)',
        p: { xs: 0, md: 1.5 },
        gap: { xs: 0, md: 1.5 },
      }}>
        <Sidebar />
        <Box
          sx={{
            position: 'relative',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
            bgcolor: palette.surface,
            borderRadius: { xs: 0, md: '30px' },
            border: { xs: 0, md: '1px solid rgba(255,255,255,0.72)' },
            boxShadow: { xs: 'none', md: '0 24px 70px rgba(71,85,105,0.16)' },
            isolation: 'isolate',
          }}
        >
          {/* Module-relevant background watermark, behind all content */}
          <ModuleBackground pathname={location.pathname} />

          <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <Header title={title} />
            <SiteNav />
            <WorkingContextBar />
            <Box
              component="main"
              sx={{
                flex: 1,
                p: { xs: 1.25, sm: 2, md: 3 },
                pb: { xs: 'calc(76px + env(safe-area-inset-bottom))', sm: 2, md: 3 },
                overflowY: 'auto',
                overflowX: 'hidden',
                minWidth: 0,
              }}
              className="app-main-scroll"
            >
              <PageTransition routeKey={location.pathname}>
                <Outlet />
              </PageTransition>
            </Box>
          </Box>
        </Box>
        {/* Renders only for Super Admins, and only when the backend reports
            the assistant is configured. */}
        <AssistantWidget />
      </Box>
    </ListContextProvider>
  )
}

export default Layout
