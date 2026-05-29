import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, FileText, Users, Clock, Trash2, Pencil, MoreVertical } from 'lucide-react'
import { Developer } from '../types'

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500',
  'bg-pink-500', 'bg-cyan-500', 'bg-amber-600', 'bg-indigo-500',
]

function nameHash(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return h
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function hostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function formatSync(at: string | null | undefined): string {
  if (!at) return ''
  const d = new Date(at)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const time = d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (isToday) return `Hoy, ${time}`
  if (d.toDateString() === yesterday.toDateString()) return `Ayer, ${time}`
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) + `, ${time}`
}

function dotColor(status: string | null | undefined): string {
  if (status === 'completed') return 'bg-green-400'
  if (status === 'failed') return 'bg-orange-400'
  if (status === 'running' || status === 'pending') return 'bg-yellow-400 animate-pulse'
  return 'bg-gray-300'
}

interface Props {
  dev: Developer
  href: string
  onDelete?: () => void
  onEdit?: () => void
}

export default function DeveloperCard({ dev, href, onDelete, onEdit }: Props) {
  const color = AVATAR_COLORS[nameHash(dev.name) % AVATAR_COLORS.length]
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const status = dev.last_sync_status ?? null

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 hover:shadow-md transition-shadow flex flex-col gap-0">
      {/* Header row */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center text-white font-bold text-sm select-none flex-shrink-0`}>
          {initials(dev.name)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm leading-snug truncate">{dev.name}</h3>
          <a
            href={dev.base_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline mt-0.5"
          >
            <span className="truncate max-w-[140px]">{hostname(dev.base_url)}</span>
            <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
          </a>
        </div>
        {/* Status dot + menu */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`w-2.5 h-2.5 rounded-full ${dotColor(status)}`} />
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl shadow-xl border border-gray-100 z-20 overflow-hidden">
                {onDelete && (
                  <button
                    onClick={() => { setMenuOpen(false); onDelete() }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Eliminar
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          {dev.source === 'tavily' ? 'Tavily' : 'Manual'}
        </span>
        {status === 'completed' && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
            Activa
          </span>
        )}
        {status === 'failed' && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
            Con errores
          </span>
        )}
        {status === null && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
            Sin datos
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed flex-1 mb-3 min-h-[2.5rem]">
        {dev.description || <span className="text-gray-300 italic">Sin descripción</span>}
      </p>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-1 py-3 border-t border-gray-100">
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-800 leading-tight">
              {(dev.proyectos_count ?? 0).toLocaleString('es-PE')}
            </p>
            <p className="text-[10px] text-gray-400 leading-tight">Proyectos</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-800 leading-tight">
              {(dev.propiedades_count ?? 0).toLocaleString('es-PE')}
            </p>
            <p className="text-[10px] text-gray-400 leading-tight">Propiedades</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
          <div>
            {dev.last_sync_at ? (
              <>
                <p className="text-[10px] font-medium text-gray-700 leading-tight">
                  {formatSync(dev.last_sync_at)}
                </p>
                <p className="text-[10px] text-gray-400 leading-tight">Última sync.</p>
              </>
            ) : (
              <p className="text-[10px] text-gray-400 leading-tight">Sin sincronizar</p>
            )}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="flex gap-2 mt-3">
        <Link
          to={href}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          Gestionar →
        </Link>
        {onEdit && (
          <button
            onClick={onEdit}
            className="px-3 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
            title="Editar desarrolladora"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
