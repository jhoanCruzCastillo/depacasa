import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Developer, ScrapeJob } from '../types'

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

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'hace un momento'
  if (m < 60) return `hace ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h}h`
  const d = Math.floor(h / 24)
  return `hace ${d}d`
}

interface DeveloperCardProps {
  dev: Developer
  href: string
  lastJob?: ScrapeJob | null
  hasTemplate?: boolean
}

export default function DeveloperCard({ dev, href, lastJob, hasTemplate }: DeveloperCardProps) {
  const color = AVATAR_COLORS[nameHash(dev.name) % AVATAR_COLORS.length]
  const init = initials(dev.name)
  const domain = hostname(dev.base_url)
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 hover:shadow-md hover:scale-[1.01] transition-all duration-150 flex flex-col">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="relative flex-shrink-0">
          <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center text-white font-bold text-sm select-none`}>
            {init}
          </div>
          <img
            src={faviconUrl}
            alt=""
            aria-hidden="true"
            className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white border-2 border-white shadow-sm object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm leading-snug truncate" title={dev.name}>
            {dev.name}
          </h3>
          <a
            href={dev.base_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline mt-0.5"
          >
            <span className="truncate max-w-[140px]">{domain}</span>
            <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
          </a>
        </div>
      </div>

      {/* Description */}
      {dev.description && (
        <p
          className="text-xs text-gray-500 line-clamp-2 mb-3 leading-relaxed flex-1"
          title={dev.description}
        >
          {dev.description}
        </p>
      )}
      {!dev.description && <div className="flex-1" />}

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5 mb-4 mt-auto">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            dev.source === 'tavily'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {dev.source === 'tavily' ? 'Tavily' : 'Manual'}
        </span>

        {hasTemplate !== undefined && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              hasTemplate ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
            }`}
          >
            {hasTemplate ? 'Plantilla ✓' : 'Sin plantilla'}
          </span>
        )}

        {lastJob ? (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              lastJob.status === 'completed'
                ? 'bg-green-100 text-green-700'
                : lastJob.status === 'failed'
                ? 'bg-red-100 text-red-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {lastJob.status === 'completed'
              ? `${lastJob.total_records} registros · ${timeAgo(lastJob.finished_at ?? lastJob.created_at)}`
              : lastJob.status === 'failed'
              ? 'Error en scraping'
              : 'Ejecutando...'}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
            Sin datos
          </span>
        )}
      </div>

      {/* Action */}
      <Link
        to={href}
        className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors"
      >
        Gestionar →
      </Link>
    </div>
  )
}
