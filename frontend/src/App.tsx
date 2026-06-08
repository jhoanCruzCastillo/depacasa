import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import DevelopersPage from './pages/DevelopersPage'
import DeveloperDetailPage from './pages/DeveloperDetailPage'
import TemplatesPage from './pages/TemplatesPage'
import TemplateEditorPage from './pages/TemplateEditorPage'
import ChatUsersPage from './pages/chat/ChatUsersPage'
import LeadScoringPage from './pages/chat/LeadScoringPage'
import ChatAdvisorsPage from './pages/chat/ChatAdvisorsPage'
import ChatConfigPage from './pages/chat/ChatConfigPage'
import SiteBuilderPage from './pages/site-builder/SiteBuilderPage'
import PublicSitePage from './pages/public/PublicSitePage'
import AdvisorPortalPage from './pages/public/AdvisorPortalPage'
import DronsPayPage from './pages/public/DronsPayPage'
import AdminAuthPage from './pages/auth/AdminAuthPage'
import UserAuthPage from './pages/auth/UserAuthPage'
import AdvisorAuthPage from './pages/auth/AdvisorAuthPage'
import { session } from './services/session'

function RequireAdminAuth({ children }: { children: React.ReactNode }) {
  if (session.getType() !== 'admin') {
    return <Navigate to="/admin/auth" replace />
  }
  return <>{children}</>
}

function App() {
  return (
    <Routes>
      {/* ── Auth pages (no sidebar) ── */}
      <Route path="/admin/auth" element={<AdminAuthPage />} />
      <Route path="/auth" element={<UserAuthPage />} />
      <Route path="/advisor/auth" element={<AdvisorAuthPage />} />

      {/* ── Public portal ── */}
      <Route path="/public" element={<PublicSitePage />} />
      <Route path="/asesores" element={<AdvisorPortalPage />} />
      <Route path="/drons-pay/:paymentId" element={<DronsPayPage />} />

      {/* ── Admin panel (protected) ── */}
      <Route path="*" element={
        <RequireAdminAuth>
          <Layout>
            <Routes>
              <Route path="/" element={<Navigate to="/developers" replace />} />
              <Route path="/developers" element={<DevelopersPage />} />
              <Route path="/developers/:id" element={<DeveloperDetailPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/templates/:developerId/editor" element={<TemplateEditorPage />} />
              {/* Gestión de Leads */}
              <Route path="/leads" element={<Navigate to="/leads/users" replace />} />
              <Route path="/leads/users" element={<ChatUsersPage />} />
              <Route path="/leads/scoring" element={<LeadScoringPage />} />
              <Route path="/leads/advisors" element={<ChatAdvisorsPage />} />
              <Route path="/leads/config" element={<ChatConfigPage />} />
              {/* Site Builder */}
              <Route path="/site-builder" element={<SiteBuilderPage />} />
              <Route path="*" element={<Navigate to="/developers" replace />} />
            </Routes>
          </Layout>
        </RequireAdminAuth>
      } />
    </Routes>
  )
}

export default App
