import { NavLink } from 'react-router-dom'
import { Building2, LayoutTemplate, Activity } from 'lucide-react'

const links = [
  { to: '/developers', label: 'Desarrolladoras', icon: Building2 },
  { to: '/templates', label: 'Plantillas', icon: LayoutTemplate },
  { to: '/jobs', label: 'Trabajos', icon: Activity },
]

export default function Navbar() {
  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-screen-xl mx-auto px-6 flex items-center h-14 gap-8">
        <NavLink to="/" className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-gray-900 text-base tracking-tight">PropScraper</span>
        </NavLink>

        <div className="flex items-center gap-1 flex-1">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
