import { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useFacilityStore } from './hooks/useActiveFacility'
import { useAuthStore } from './stores/authStore'
import Layout from './components/Layout'
import { canAccessModule, getVisibleModules, type Module } from './config/permissions'
import { lazyWithReload } from './utils/lazyWithReload'
import { palette } from '@/theme/palette'

const Landing = lazyWithReload(() => import('./pages/Landing'))
const Login = lazyWithReload(() => import('./pages/Auth/Login'))
const Dashboard = lazyWithReload(() => import('./pages/Dashboard'))
const Facilities = lazyWithReload(() => import('./pages/Facilities'))
const ServiceRequests = lazyWithReload(() => import('./pages/ServiceRequests'))
const Inspections = lazyWithReload(() => import('./pages/Inspections'))
const Sales = lazyWithReload(() => import('./pages/Sales'))
const Rentals = lazyWithReload(() => import('./pages/Rentals'))
const Inventory = lazyWithReload(() => import('./pages/Inventory'))
const InventoryCapture = lazyWithReload(() => import('./pages/InventoryCapture'))
const TestEquipment = lazyWithReload(() => import('./pages/TestEquipment'))
const HR = lazyWithReload(() => import('./pages/HR'))
const Reports = lazyWithReload(() => import('./pages/Reports'))
const Users = lazyWithReload(() => import('./pages/Users'))
const Chat = lazyWithReload(() => import('./pages/Chat'))
const Calendar = lazyWithReload(() => import('./pages/Calendar'))
const Profile = lazyWithReload(() => import('./pages/Profile'))
const Attendance = lazyWithReload(() => import('./pages/Attendance'))
const Billing = lazyWithReload(() => import('./pages/Sales/Billing'))
const MyTimesheets = lazyWithReload(() => import('./pages/MyTimesheets'))
const MyLeave = lazyWithReload(() => import('./pages/MyLeave'))
const ClientQuotation = lazyWithReload(() => import('./pages/Sales/ClientQuotation'))
const PublicSalesPayment = lazyWithReload(() => import('./pages/Sales/PublicSalesPayment'))
const ClientRental = lazyWithReload(() => import('./pages/Rentals/ClientRental'))
const Locations = lazyWithReload(() => import('./pages/Locations'))
const Spaces = lazyWithReload(() => import('./pages/Spaces'))
const Vendors = lazyWithReload(() => import('./pages/Vendors'))
const Permits = lazyWithReload(() => import('./pages/Permits'))
const Compliance = lazyWithReload(() => import('./pages/Compliance'))
const Maintenance = lazyWithReload(() => import('./pages/Maintenance'))
const Sites = lazyWithReload(() => import('./pages/Sites'))
const SiteDashboard = lazyWithReload(() => import('./pages/Sites/SiteDashboard'))
const Assets = lazyWithReload(() => import('./pages/Assets'))
const AssistantDocuments = lazyWithReload(() => import('./pages/AssistantDocuments'))
const AssetLedger = lazyWithReload(() => import('./pages/AssetLedger'))
const Categories = lazyWithReload(() => import('./pages/Categories'))
const Departments = lazyWithReload(() => import('./pages/Departments'))
const DepartmentDetail = lazyWithReload(() => import('./pages/Departments/DepartmentDetail'))
const InspectionVisits = lazyWithReload(() => import('./pages/InspectionVisits'))
const InspectionVisit = lazyWithReload(() => import('./pages/InspectionVisits/Visit'))
const Fleet = lazyWithReload(() => import('./pages/Fleet'))
const RedTags = lazyWithReload(() => import('./pages/RedTags'))
const InspectionStatus = lazyWithReload(() => import('./pages/InspectionStatus'))
const Service = lazyWithReload(() => import('./pages/Service'))

const RouteFallback = () => (
  <div
    role="status"
    aria-label="Loading page"
    style={{
      minHeight: 'calc(100vh - 96px)',
      display: 'grid',
      placeItems: 'center',
      background: palette.pageAlt,
    }}
  >
    <div
      style={{
        width: 38,
        height: 38,
        border: `4px solid ${palette.brandSoft}`,
        borderTopColor: palette.brand,
        borderRadius: '50%',
        animation: 'medrad-route-spin 0.8s linear infinite',
      }}
    />
    <style>{'@keyframes medrad-route-spin { to { transform: rotate(360deg); } }'}</style>
  </div>
)

const modulePath: Record<Module, string> = {
  dashboard: '/dashboard',
  facilities: '/sites',
  users: '/users',
  'service-requests': '/service-requests',
  inspections: '/inspections',
  sales: '/sales',
  rentals: '/rentals',
  'facility-inventory': '/assets',
  inventory: '/inventory',
  'test-equipment': '/test-equipment',
  reports: '/reports',
  attendance: '/attendance',
  billing: '/billing',
  hr: '/hr',
  'my-timesheets': '/my-timesheets',
  'my-leave': '/my-leave',
  chat: '/chat',
  calendar: '/calendar',
  locations: '/locations',
  spaces: '/spaces',
  vendors: '/vendors',
  permits: '/permits',
  compliance: '/compliance',
  maintenance: '/maintenance',
}

const fallbackPathFor = (user: ReturnType<typeof useAuthStore.getState>['user'], currentModule: Module) => {
  const nextModule = getVisibleModules(user).find((module) => module !== currentModule)
  return nextModule ? modulePath[nextModule] : '/profile'
}

/**
 * A screen that only means anything inside one hospital.
 *
 * Buildings & Rooms with no site chosen is not an empty list, it is an
 * unanswerable question — so it sends you to pick one rather than rendering
 * nothing and looking broken.
 */
const RequireSite = ({ children }: { children: JSX.Element }) => {
  const facilityId = useFacilityStore((state) => state.facilityId)
  if (facilityId == null) return <Navigate to="/sites" replace />
  return children
}

const ProtectedPage = ({ module, children }: { module: Module; children: JSX.Element }) => {
  const user = useAuthStore((state) => state.user)
  if (!canAccessModule(user, module)) {
    return <Navigate to={fallbackPathFor(user, module)} replace />
  }
  return children
}

function App() {
  const { isAuthenticated } = useAuthStore()

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/landing" element={<Landing />} />
        <Route path="/quotation/:token" element={<ClientQuotation />} />
        <Route path="/quotation/account/:quotationId" element={isAuthenticated ? <ClientQuotation /> : <Navigate to="/login" replace />} />
        <Route path="/payment/sales/:token" element={<PublicSalesPayment />} />
        <Route path="/rental/:token" element={<ClientRental />} />
        <Route path="/rental-extension/:extensionToken" element={<ClientRental />} />
        <Route path="/" element={isAuthenticated ? <Navigate to="/sites" replace /> : <Landing />} />

        <Route
          path="/"
          element={
            isAuthenticated ? <Layout key={useAuthStore.getState().user?.id} /> : <Navigate to="/login" replace />
          }
        >
          <Route path="dashboard" element={<ProtectedPage module="dashboard"><Dashboard /></ProtectedPage>} />
          <Route path="facilities/*" element={<ProtectedPage module="facilities"><Facilities /></ProtectedPage>} />
          <Route path="users/*" element={<ProtectedPage module="users"><Users /></ProtectedPage>} />
          <Route path="chat/*" element={<ProtectedPage module="chat"><Chat /></ProtectedPage>} />
          <Route path="calendar" element={<ProtectedPage module="calendar"><Calendar /></ProtectedPage>} />
          <Route path="profile" element={<Profile />} />
          <Route path="service-requests/*" element={<RequireSite><ProtectedPage module="service-requests"><ServiceRequests /></ProtectedPage></RequireSite>} />
          <Route path="inspections/*" element={<RequireSite><ProtectedPage module="inspections"><Inspections /></ProtectedPage></RequireSite>} />
          <Route path="sales/*" element={<ProtectedPage module="sales"><Sales /></ProtectedPage>} />
          <Route path="rentals/account/:rentalId" element={<ProtectedPage module="rentals"><ClientRental /></ProtectedPage>} />
          <Route path="rentals/*" element={<ProtectedPage module="rentals"><Rentals /></ProtectedPage>} />
          {/* Its own route: the inventory page is untouched by this. */}
          <Route path="inventory-capture" element={<RequireSite><ProtectedPage module="inventory"><InventoryCapture /></ProtectedPage></RequireSite>} />
          <Route path="inventory/*" element={<RequireSite><ProtectedPage module="inventory"><Inventory /></ProtectedPage></RequireSite>} />
          <Route path="test-equipment/*" element={<RequireSite><ProtectedPage module="test-equipment"><TestEquipment /></ProtectedPage></RequireSite>} />
          <Route path="hr/*" element={<ProtectedPage module="hr"><HR /></ProtectedPage>} />
          <Route path="reports/*" element={<ProtectedPage module="reports"><Reports /></ProtectedPage>} />
          <Route path="attendance/*" element={<ProtectedPage module="attendance"><Attendance /></ProtectedPage>} />
          <Route path="my-timesheets" element={<ProtectedPage module="my-timesheets"><MyTimesheets /></ProtectedPage>} />
          <Route path="my-leave" element={<ProtectedPage module="my-leave"><MyLeave /></ProtectedPage>} />
          <Route path="billing/*" element={<ProtectedPage module="billing"><Billing /></ProtectedPage>} />
          {/* Facilities / MEP */}
          <Route path="locations/*" element={<RequireSite><ProtectedPage module="locations"><Locations /></ProtectedPage></RequireSite>} />
          <Route path="spaces/*" element={<RequireSite><ProtectedPage module="spaces"><Spaces /></ProtectedPage></RequireSite>} />
          <Route path="vendors/*" element={<RequireSite><ProtectedPage module="vendors"><Vendors /></ProtectedPage></RequireSite>} />
          <Route path="permits/*" element={<RequireSite><ProtectedPage module="permits"><Permits /></ProtectedPage></RequireSite>} />
          <Route path="compliance/*" element={<RequireSite><ProtectedPage module="compliance"><Compliance /></ProtectedPage></RequireSite>} />
          <Route path="maintenance/*" element={<RequireSite><ProtectedPage module="maintenance"><Maintenance /></ProtectedPage></RequireSite>} />
          <Route path="sites" element={<ProtectedPage module="facilities"><Sites /></ProtectedPage>} />
          <Route path="sites/:id" element={<ProtectedPage module="facilities"><SiteDashboard /></ProtectedPage>} />
          <Route path="assets/*" element={<RequireSite><ProtectedPage module="facility-inventory"><Assets /></ProtectedPage></RequireSite>} />
          {/* Site categories: Electrical, Plumbing, Mechanical and HVAC equipment,
              and the service and inspection jobs done on it. */}
          <Route path="categories" element={<Navigate to="/categories/electrical" replace />} />
          <Route path="categories/:code" element={<RequireSite><ProtectedPage module="facility-inventory"><Categories /></ProtectedPage></RequireSite>} />
          <Route path="equipment-maintenance" element={<Navigate to="/service" replace />} />
          <Route path="departments" element={<RequireSite><ProtectedPage module="inspections"><Departments /></ProtectedPage></RequireSite>} />
          <Route path="departments/:id" element={<RequireSite><ProtectedPage module="inspections"><DepartmentDetail /></ProtectedPage></RequireSite>} />
          <Route path="inspection-visits" element={<RequireSite><ProtectedPage module="inspections"><InspectionVisits /></ProtectedPage></RequireSite>} />
          <Route path="inspection-visits/:id" element={<RequireSite><ProtectedPage module="inspections"><InspectionVisit /></ProtectedPage></RequireSite>} />
          <Route path="fleet" element={<RequireSite><ProtectedPage module="inspections"><Fleet /></ProtectedPage></RequireSite>} />
          <Route path="red-tags" element={<RequireSite><ProtectedPage module="inspections"><RedTags /></ProtectedPage></RequireSite>} />
          <Route path="inspection-status" element={<ProtectedPage module="inspections"><InspectionStatus /></ProtectedPage>} />
          <Route path="service" element={<RequireSite><ProtectedPage module="service-requests"><Service /></ProtectedPage></RequireSite>} />
          {/* Where Equipment Maintenance used to be. */}
          <Route path="equipment-maintenance/:kind" element={<Navigate to="/service" replace />} />
          {/* Super Admin only; the page itself refuses anyone else. */}
          <Route path="assistant/documents" element={<AssistantDocuments />} />
          <Route path="asset-ledger/*" element={<RequireSite><ProtectedPage module="facility-inventory"><AssetLedger /></ProtectedPage></RequireSite>} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default App
