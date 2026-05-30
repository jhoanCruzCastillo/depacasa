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

function App() {
  return (
    <Routes>
      {/* Public portal — full page, no admin sidebar */}
      <Route path="/public" element={<PublicSitePage />} />
      <Route path="/asesores" element={<AdvisorPortalPage />} />

      {/* Admin panel */}
      <Route path="*" element={
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/developers" replace />} />
            <Route path="/developers" element={<DevelopersPage />} />
            <Route path="/developers/:id" element={<DeveloperDetailPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/templates/:developerId/editor" element={<TemplateEditorPage />} />
            {/* Chatbot */}
            <Route path="/chat" element={<Navigate to="/chat/users" replace />} />
            <Route path="/chat/users" element={<ChatUsersPage />} />
            <Route path="/chat/scoring" element={<LeadScoringPage />} />
            <Route path="/chat/advisors" element={<ChatAdvisorsPage />} />
            <Route path="/chat/config" element={<ChatConfigPage />} />
            {/* Site Builder */}
            <Route path="/site-builder" element={<SiteBuilderPage />} />
            <Route path="*" element={<Navigate to="/developers" replace />} />
          </Routes>
        </Layout>
      } />
    </Routes>
  )
}

export default App
