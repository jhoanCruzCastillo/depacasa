import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Building2, LayoutTemplate, Users,
  Settings, UserCheck, Globe, Sliders, Award, UserCircle,
} from 'lucide-react'
import API from '../services/api'

const baseApiUrl = API.defaults.baseURL || ''
const healthUrl = baseApiUrl.replace(/\/api\/?$/, '') + '/health'

const mainLinks = [
  { to: '/developers', label: 'Desarrolladoras', icon: Building2 },
  { to: '/templates', label: 'Plantillas de Extracción', icon: LayoutTemplate },
]

const siteLinks = [
  { to: '/site-builder', label: 'Constructor', icon: Sliders },
  { href: '/public', label: 'Ver sitio', icon: Globe },
]

const chatLinks = [
  { to: '/leads/users', label: 'Usuarios', icon: Users },
  { to: '/leads/scoring', label: 'Ajuste de precios', icon: Award },
  { to: '/leads/advisors', label: 'Asesores', icon: UserCheck },
  { to: '/leads/config', label: 'Configuración', icon: Settings },
]

type NavItem = { to?: string; href?: string; label: string; icon: React.ElementType }

function SectionLink({ item, activeColor }: { item: NavItem; activeColor: string }) {
  if (item.href) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-slate-400 hover:text-slate-100 hover:bg-slate-800"
      >
        <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
        {item.label}
      </a>
    )
  }
  return (
    <NavLink
      to={item.to!}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive ? `${activeColor}` : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
        }`
      }
    >
      <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
      {item.label}
    </NavLink>
  )
}

export default function Sidebar() {
  const [online, setOnline] = useState<boolean | null>(null)

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
      <nav className="flex-1 px-3 space-y-0.5 pb-4">
        {/* SCRAPING */}
        <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
          Scraping
        </p>
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

        {/* PORTAL PÚBLICO */}
        <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
          Portal Público
        </p>
        <div className="ml-1 space-y-0.5">
          {siteLinks.map(item => (
            <SectionLink key={item.to ?? item.href} item={item} activeColor="bg-purple-600/20 text-purple-400" />
          ))}
        </div>

        {/* GESTIÓN DE LEADS */}
        <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
          Gestión de Leads
        </p>
        <div className="ml-1 space-y-0.5">
          {chatLinks.map(item => (
            <SectionLink key={item.to} item={item} activeColor="bg-green-600/20 text-green-400" />
          ))}
        </div>

        {/* CUENTA */}
        <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
          Cuenta
        </p>
        <NavLink
          to="/admin/profile"
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive
                ? 'bg-blue-600/20 text-blue-400 ring-1 ring-blue-600/20'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
            }`
          }
        >
          <UserCircle className="w-4 h-4 flex-shrink-0" />
          Perfil y Seguridad
        </NavLink>
      </nav>

      {/* System status */}
      <div className="px-5 py-4 border-t border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              online === null
                ? 'bg-slate-500 animate-pulse'
                : online
                ? 'bg-green-400'
                : 'bg-red-400'
            }`}
          />
          <div>
            <p className="text-xs text-slate-400 font-medium">
              {online === null ? 'Verificando...' : online ? 'Sistema activo' : 'Sin conexión'}
            </p>
            {online && (
              <p className="text-[10px] text-slate-600 mt-0.5">Todos los servicios operativos</p>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
