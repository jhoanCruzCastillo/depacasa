import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Building2, LayoutTemplate, MessageSquare, Users, FileText, Settings, Smartphone, ChevronDown, ChevronRight, UserCheck, Globe, Sliders } from 'lucide-react'
import API from '../services/api'

const baseApiUrl = API.defaults.baseURL || ''
const healthUrl = baseApiUrl.replace(/\/api\/?$/, '') + '/health'

const mainLinks = [
  { to: '/developers', label: 'Desarrolladoras', icon: Building2 },
  { to: '/templates', label: 'Plantillas de Extracción', icon: LayoutTemplate },
]

const chatLinks = [
  { to: '/chat/users', label: 'Usuarios', icon: Users },
  { to: '/chat/templates', label: 'Plantillas', icon: FileText },
  { to: '/chat/advisors', label: 'Asesores', icon: UserCheck },
  { to: '/chat/config', label: 'Configuración', icon: Settings },
  { to: '/chat/preview', label: 'Vista Previa', icon: Smartphone },
]

const siteLinks = [
  { to: '/site-builder', label: 'Constructor', icon: Sliders },
  { href: '/public', label: 'Ver sitio', icon: Globe },
]

export default function Sidebar() {
  const [online, setOnline] = useState<boolean | null>(null)
  const location = useLocation()
  const chatActive = location.pathname.startsWith('/chat')
  const siteActive = location.pathname.startsWith('/site-builder')
  const [chatOpen, setChatOpen] = useState(chatActive)
  const [siteOpen, setSiteOpen] = useState(siteActive)

  useEffect(() => {
    if (chatActive) setChatOpen(true)
  }, [chatActive])

  useEffect(() => {
    if (siteActive) setSiteOpen(true)
  }, [siteActive])

  useEffect(() => {
    const check = async () => {
      try { await API.get(healthUrl); setOnline(true) }
      catch { setOnline(false) }
    }
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <aside className="w-60 flex-shrink-0 h-screen bg-slate-900 flex flex-col sticky top-0 z-30 overflow-y-auto">
      {/* Logo */}
      <div className="px-5 pt-6 pb-5 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-bold text-base tracking-tight">PropScraper</span>
        </div>
        <p className="text-slate-500 text-xs mt-1 ml-[2.625rem]">Panel de Administración</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-0.5">
        {/* Scraping section */}
        <p className="px-3 pt-1 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Scraping</p>
        {mainLinks.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400 ring-1 ring-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
              }`
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}

        {/* Site Builder section */}
        <div className="pt-3">
          <button
            onClick={() => setSiteOpen(o => !o)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              siteActive
                ? 'bg-purple-600/20 text-purple-400 ring-1 ring-purple-600/20'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
            }`}
          >
            <Globe className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 text-left">Portal Público</span>
            {siteOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {siteOpen && (
            <div className="ml-4 mt-0.5 border-l border-slate-700 pl-3 space-y-0.5">
              {siteLinks.map(({ to, href, label, icon: Icon }) =>
                href ? (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    {label}
                  </a>
                ) : (
                  <NavLink
                    key={to}
                    to={to!}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-purple-600/20 text-purple-400'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                      }`
                    }
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    {label}
                  </NavLink>
                )
              )}
            </div>
          )}
        </div>

        {/* Chatbot section */}
        <div className="pt-3">
          <button
            onClick={() => setChatOpen(o => !o)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              chatActive
                ? 'bg-green-600/20 text-green-400 ring-1 ring-green-600/20'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
            }`}
          >
            <MessageSquare className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 text-left">Chatbot</span>
            {chatOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {chatOpen && (
            <div className="ml-4 mt-0.5 border-l border-slate-700 pl-3 space-y-0.5">
              {chatLinks.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-green-600/20 text-green-400'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                    }`
                  }
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  {label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* System status */}
      <div className="px-5 py-4 border-t border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              online === null ? 'bg-slate-500 animate-pulse' : online ? 'bg-green-400' : 'bg-red-400'
            }`}
          />
          <span className="text-xs text-slate-500">
            {online === null ? 'Verificando...' : online ? 'Sistema activo' : 'Sin conexión'}
          </span>
        </div>
      </div>
    </aside>
  )
}
