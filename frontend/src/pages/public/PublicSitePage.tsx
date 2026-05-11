import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Search, ChevronLeft, ChevronRight, Building2, LogIn, LogOut,
  User, X, MapPin, BedDouble, DollarSign, Maximize2,
} from 'lucide-react'
import ChatWidget from '../../components/chat/ChatWidget'
import AuthModal from '../../components/auth/AuthModal'
import { useAuth } from '../../hooks/useAuth'
import API from '../../services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CardField { key: string; label: string; type: string }

interface SiteConfig {
  site_name: string; tagline: string | null; primary_color: string; secondary_color: string
  logo_text: string | null; show_hero: boolean; hero_title: string; hero_subtitle: string | null
  hero_cta_text: string; hero_bg_color: string; hero_record_ids: string[]
  featured_enabled: boolean; featured_title: string; featured_level: number
  featured_limit: number; featured_field_keys: string[]
  catalog_enabled: boolean; catalog_title: string; catalog_level: number
  catalog_columns: string; catalog_field_keys: string[]
  footer_text: string | null; footer_contact: string | null
  card_fields: CardField[]; chatbot_enabled: boolean; chatbot_button_label: string
}

interface PublicRecord { id: string; data: Record<string, unknown>; scraped_at?: string | null }

interface TextEntry { key: string; label: string; value: string; isArray: boolean; items?: string[] }

// ─── Image & field detection helpers ─────────────────────────────────────────

const MEDIA_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api').replace(/\/api\/?$/, '')
const IMG_EXT = /\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)(\?.*)?$/i
const IMG_KEY = /image|foto|photo|img|picture|thumbnail|portada|cover|banner|galeria|gallery|slider/i
const HTTP = /^https?:\/\//

function toFull(val: string) { return val.startsWith('/media/') ? `${MEDIA_BASE}${val}` : val }

function detectImages(data: Record<string, unknown>): string[] {
  const seen = new Set<string>(); const out: string[] = []
  function walk(val: unknown, key = '') {
    if (!val) return
    if (typeof val === 'string') {
      let url: string | null = null
      if (val.startsWith('/media/')) url = toFull(val)
      else if (HTTP.test(val) && (IMG_EXT.test(val) || IMG_KEY.test(key))) url = val
      if (url && !seen.has(url)) { seen.add(url); out.push(url) }
    } else if (Array.isArray(val)) { val.forEach(i => walk(i, key)) }
    else if (typeof val === 'object') { Object.entries(val as Record<string, unknown>).forEach(([k, v]) => walk(v, k)) }
  }
  Object.entries(data).forEach(([k, v]) => walk(v, k))
  return out
}

function detectTextEntries(data: Record<string, unknown>, images: string[], fieldKeys?: string[]): TextEntry[] {
  const imgSet = new Set(images)
  const isImg = (v: string) => v.startsWith('/media/') || imgSet.has(v) || imgSet.has(toFull(v)) || (HTTP.test(v) && IMG_EXT.test(v))
  const humanize = (k: string) => k.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')

  const entries: TextEntry[] = []
  const keys = fieldKeys && fieldKeys.length > 0 ? fieldKeys : Object.keys(data)

  for (const key of keys) {
    const val = data[key]
    if (val === null || val === undefined) continue
    const label = humanize(key)
    if (typeof val === 'string') {
      if (!val.trim() || isImg(val)) continue
      entries.push({ key, label, value: val.trim(), isArray: false })
    } else if (typeof val === 'number') {
      entries.push({ key, label, value: String(val), isArray: false })
    } else if (Array.isArray(val)) {
      const items = val.filter(i => typeof i === 'string' && i.trim() && !isImg(i)).map(String)
      if (items.length) entries.push({ key, label, value: items.join(', '), isArray: true, items })
    }
  }
  return entries
}

function findRole(entries: TextEntry[], pattern: RegExp) {
  return entries.find(e => pattern.test(e.key))
}

// ─── Grid layout helper ───────────────────────────────────────────────────────

function colsClass(cols: string) {
  if (cols === '2') return 'grid-cols-1 sm:grid-cols-2'
  if (cols === '4') return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
}

// ─── MiniCarousel (inside card) ───────────────────────────────────────────────

function MiniCarousel({ images, primaryColor }: { images: string[]; primaryColor: string }) {
  const [cur, setCur] = useState(0)
  if (images.length === 0) return (
    <div className="h-44 flex items-center justify-center" style={{ backgroundColor: primaryColor + '12' }}>
      <Building2 className="w-10 h-10" style={{ color: primaryColor + '60' }} />
    </div>
  )
  return (
    <div className="relative h-44 overflow-hidden bg-slate-100 group">
      <img src={images[cur]} alt="" className="w-full h-full object-cover" />
      {images.length > 1 && (
        <>
          <div className="absolute top-2 right-2 bg-black/50 text-white text-[11px] px-1.5 py-0.5 rounded-full">
            {cur + 1}/{images.length}
          </div>
          <button onClick={e => { e.stopPropagation(); setCur(c => Math.max(0, c - 1)) }} disabled={cur === 0}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-0 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={e => { e.stopPropagation(); setCur(c => Math.min(images.length - 1, c + 1)) }} disabled={cur === images.length - 1}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-0 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
            {images.map((_, i) => <button key={i} onClick={e => { e.stopPropagation(); setCur(i) }} className={`w-1.5 h-1.5 rounded-full transition-all ${i === cur ? 'bg-white scale-125' : 'bg-white/50'}`} />)}
          </div>
        </>
      )}
    </div>
  )
}

// ─── PropertyModal ────────────────────────────────────────────────────────────

function PropertyModal({ images, entries, primaryColor, secondaryColor, onClose }: {
  images: string[]; entries: TextEntry[]; primaryColor: string; secondaryColor: string; onClose: () => void
}) {
  const [cur, setCur] = useState(0)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const titleEntry = findRole(entries, /nombre|name|proyecto|titulo|title/i)
  const priceEntry = findRole(entries, /precio|price|costo|valor|monto/i)
  const others = entries.filter(e => e !== titleEntry && e !== priceEntry)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 flex-shrink-0">
          <h3 className="font-bold text-slate-800 truncate">{titleEntry?.value || 'Detalles'}</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0 ml-3">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {images.length > 0 && (
            <div className="relative h-64 bg-slate-100 flex-shrink-0">
              <img src={images[cur]} alt="" className="w-full h-full object-cover" />
              {images.length > 1 && (
                <>
                  <div className="absolute top-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full">{cur + 1}/{images.length}</div>
                  <button onClick={() => setCur(c => Math.max(0, c - 1))} disabled={cur === 0}
                    className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-20 text-white rounded-full p-2">
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button onClick={() => setCur(c => Math.min(images.length - 1, c + 1))} disabled={cur === images.length - 1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-20 text-white rounded-full p-2">
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
                    {images.map((_, i) => <button key={i} onClick={() => setCur(i)} className={`w-2 h-2 rounded-full transition-all ${i === cur ? 'bg-white scale-125' : 'bg-white/50'}`} />)}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="p-5 space-y-1">
            {priceEntry && <p className="font-bold text-2xl mb-3" style={{ color: secondaryColor }}>{priceEntry.value}</p>}
            {others.map(e => (
              <div key={e.key} className="flex gap-3 items-start py-2 border-b border-slate-50 last:border-0">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-32 flex-shrink-0 pt-0.5">{e.label}</span>
                <span className="text-sm text-slate-700 flex-1 leading-relaxed break-words">{e.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── PropertyCard ─────────────────────────────────────────────────────────────

function PropertyCard({ record, fieldKeys, primaryColor, secondaryColor }: {
  record: PublicRecord; fieldKeys?: string[]; primaryColor: string; secondaryColor: string
}) {
  const [showModal, setShowModal] = useState(false)
  const images = detectImages(record.data)
  const allEntries = detectTextEntries(record.data, images, fieldKeys)

  const titleEntry = findRole(allEntries, /nombre|name|proyecto|titulo|title/i)
  const priceEntry = findRole(allEntries, /precio|price|costo|valor|monto/i)
  const locEntry = findRole(allEntries, /ubicacion|location|district|zona|ciudad/i)
  const specialKeys = new Set([titleEntry?.key, priceEntry?.key].filter(Boolean) as string[])
  const otherEntries = allEntries.filter(e => !specialKeys.has(e.key)).slice(0, 4)

  return (
    <>
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 hover:shadow-md transition-shadow flex flex-col">
        <MiniCarousel images={images} primaryColor={primaryColor} />
        <div className="p-4 flex flex-col flex-1 gap-1.5">
          {titleEntry && <h3 className="font-bold text-slate-800 text-sm leading-tight line-clamp-2">{titleEntry.value}</h3>}
          {priceEntry && <p className="font-bold text-lg leading-none" style={{ color: secondaryColor }}>{priceEntry.value}</p>}
          {locEntry && (
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <MapPin className="w-3 h-3 flex-shrink-0" />{locEntry.value}
            </p>
          )}
          {otherEntries.filter(e => e.key !== locEntry?.key).slice(0, 3).map(e => (
            <div key={e.key} className="flex gap-2 text-xs">
              <span className="text-slate-400 uppercase tracking-wide w-20 flex-shrink-0 truncate font-medium">{e.label}</span>
              <span className="text-slate-600 flex-1 truncate">{e.value}</span>
            </div>
          ))}
          <button onClick={() => setShowModal(true)}
            className="mt-auto pt-2 w-full text-center text-xs font-semibold py-2 rounded-xl border transition-colors"
            style={{ borderColor: primaryColor + '50', color: primaryColor }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = primaryColor + '08')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}>
            Ver detalles →
          </button>
        </div>
      </div>
      {showModal && (
        <PropertyModal images={images} entries={allEntries} primaryColor={primaryColor}
          secondaryColor={secondaryColor} onClose={() => setShowModal(false)} />
      )}
    </>
  )
}

// ─── Hero Carousel ────────────────────────────────────────────────────────────

function HeroCarousel({ records, config, onScrollDown }: {
  records: PublicRecord[]; config: SiteConfig; onScrollDown: () => void
}) {
  const [cur, setCur] = useState(0)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    if (records.length <= 1) return
    const t = setInterval(() => setCur(c => (c + 1) % records.length), 7000)
    return () => clearInterval(t)
  }, [records.length])

  if (records.length === 0) {
    return (
      <section className="relative flex flex-col items-center justify-center text-center px-4 py-28 sm:py-36"
        style={{ backgroundColor: config.hero_bg_color }}>
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative z-10 max-w-2xl mx-auto space-y-5">
          <h1 className="text-3xl sm:text-5xl font-extrabold text-white leading-tight">{config.hero_title}</h1>
          {config.hero_subtitle && <p className="text-lg text-white/80">{config.hero_subtitle}</p>}
          <button onClick={onScrollDown}
            className="inline-flex px-8 py-3 rounded-full text-white font-semibold shadow-lg hover:opacity-90 transition-opacity"
            style={{ backgroundColor: config.secondary_color }}>
            {config.hero_cta_text}
          </button>
        </div>
      </section>
    )
  }

  const rec = records[cur]
  const images = detectImages(rec.data)
  const entries = detectTextEntries(rec.data, images)
  const titleEntry = findRole(entries, /nombre|name|proyecto|titulo|title/i)
  const priceEntry = findRole(entries, /precio|price|costo|valor|monto/i)
  const locEntry = findRole(entries, /ubicacion|location|district|zona|ciudad/i)
  const bedsEntry = findRole(entries, /dormitorio|bedroom|habitacion|dorm/i)
  const areaEntry = findRole(entries, /area|m2|metros|metraje|superficie/i)
  const heroImg = images[0] || null

  return (
    <section className="relative h-[88vh] min-h-[520px] overflow-hidden bg-slate-900">
      {/* Background image */}
      <div className="absolute inset-0 transition-opacity duration-700 bg-white">
        {heroImg
          ? <img src={heroImg} alt="" className="w-full h-full object-contain" />
          : <div className="w-full h-full" style={{ backgroundColor: config.hero_bg_color }} />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/20" />
      </div>

      {/* Navigation arrows */}
      {records.length > 1 && (
        <>
          <button onClick={() => setCur(c => (c - 1 + records.length) % records.length)}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-white/15 hover:bg-white/30 backdrop-blur text-white rounded-full p-3 transition-all">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button onClick={() => setCur(c => (c + 1) % records.length)}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-white/15 hover:bg-white/30 backdrop-blur text-white rounded-full p-3 transition-all">
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Property info */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-6 sm:px-12 pb-12">
        <div className="max-w-3xl">
          {/* Pill */}
          <span className="inline-block text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-3"
            style={{ backgroundColor: config.primary_color, color: 'white' }}>
            {cur + 1} / {records.length}
          </span>

          {titleEntry && (
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white mb-2 leading-tight drop-shadow-lg">
              {titleEntry.value}
            </h2>
          )}

          {priceEntry && (
            <p className="text-2xl font-bold mb-4" style={{ color: config.secondary_color }}>
              {priceEntry.value}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4 mb-6 text-white/80 text-sm">
            {locEntry && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" />{locEntry.value}</span>}
            {bedsEntry && <span className="flex items-center gap-1.5"><BedDouble className="w-4 h-4" />{bedsEntry.value} dorms.</span>}
            {areaEntry && <span className="flex items-center gap-1.5"><Maximize2 className="w-4 h-4" />{areaEntry.value}</span>}
          </div>

          <div className="flex gap-3 flex-wrap">
            <button onClick={() => setShowModal(true)}
              className="px-6 py-3 rounded-full text-white font-semibold shadow-lg hover:opacity-90 transition-all"
              style={{ backgroundColor: config.secondary_color }}>
              Ver propiedad
            </button>
            <button onClick={onScrollDown}
              className="px-6 py-3 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur text-white font-semibold transition-all border border-white/20">
              {config.hero_cta_text}
            </button>
          </div>
        </div>
      </div>

      {/* Dots */}
      {records.length > 1 && (
        <div className="absolute bottom-5 right-8 z-10 flex gap-2">
          {records.map((_, i) => (
            <button key={i} onClick={() => setCur(i)}
              className={`rounded-full transition-all ${i === cur ? 'w-6 h-2 bg-white' : 'w-2 h-2 bg-white/40 hover:bg-white/70'}`} />
          ))}
        </div>
      )}

      {showModal && (
        <PropertyModal images={images} entries={entries} primaryColor={config.primary_color}
          secondaryColor={config.secondary_color} onClose={() => setShowModal(false)} />
      )}
    </section>
  )
}

function FeaturedSection({ records, config }: { records: PublicRecord[]; config: SiteConfig }) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = (dir: 'l' | 'r') => ref.current?.scrollBy({ left: dir === 'l' ? -320 : 320, behavior: 'smooth' })

  if (records.length === 0) return null

  return (
    <section className="py-10 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <h2 className="text-xl font-bold text-slate-800 mb-6">{config.featured_title}</h2>
        <div className="relative">
          <button onClick={() => scroll('l')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white shadow-md rounded-full p-2.5 hover:bg-slate-50 transition-colors -ml-4 hidden sm:flex">
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div ref={ref} className="flex gap-4 overflow-x-auto pb-2"
            style={{ scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}>
            {records.map(r => (
              <div key={r.id} className="flex-shrink-0 w-72" style={{ scrollSnapAlign: 'start' }}>
                <PropertyCard record={r} fieldKeys={config.featured_field_keys}
                  primaryColor={config.primary_color} secondaryColor={config.secondary_color} />
              </div>
            ))}
          </div>
          <button onClick={() => scroll('r')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white shadow-md rounded-full p-2.5 hover:bg-slate-50 transition-colors -mr-4 hidden sm:flex">
            <ChevronRight className="w-5 h-5 text-slate-600" />
          </button>
        </div>
      </div>
    </section>
  )
}

// ─── Developer catalog section ────────────────────────────────────────────────

function DeveloperCatalogSection({
  developers, primaryColor, secondaryColor, fieldKeys
}: {
  developers: any[]
  primaryColor: string
  secondaryColor: string
  fieldKeys?: string[]
}) {
  const [expandedDev, setExpandedDev] = useState<string | null>(null)
  
  if (!developers || developers.length === 0) {
    return (
      <div className="text-center py-20 text-slate-400">
        <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No se encontraron propiedades</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {developers.map(dev => (
        <div key={dev.id} className="space-y-4">
          {/* Developer header */}
          <button
            onClick={() => setExpandedDev(expandedDev === dev.id ? null : dev.id)}
            className="w-full flex items-center justify-between px-6 py-4 rounded-xl border border-slate-200 bg-white hover:shadow-md transition-shadow group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: primaryColor }}>
                {dev.name.charAt(0).toUpperCase()}
              </div>
              <div className="text-left">
                <h3 className="font-bold text-slate-800">{dev.name}</h3>
                <p className="text-xs text-slate-400">
                  {dev.projects.length} proyecto{dev.projects.length !== 1 ? 's' : ''} • {dev.loose_properties.length} propiedade{dev.loose_properties.length !== 1 ? 's' : ''} suelta{dev.loose_properties.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <ChevronRight className={`w-5 h-5 text-slate-400 transition-transform ${expandedDev === dev.id ? 'rotate-90' : ''}`} />
          </button>

          {/* Developer projects and properties */}
          {expandedDev === dev.id && (
            <div className="space-y-4 pl-4 border-l-2 border-slate-200">
              {/* Projects */}
              {dev.projects.map((project: any) => (
                <div key={project.id} className="space-y-3">
                  <h4 className="font-semibold text-slate-700 text-sm">{project.name}</h4>
                  <div className={`grid gap-4 ${colsClass('3')}`}>
                    {project.records.map((rec: any) => (
                      <PropertyCard
                        key={rec.id}
                        record={{ id: rec.id, data: rec.data, scraped_at: rec.scraped_at }}
                        fieldKeys={fieldKeys}
                        primaryColor={primaryColor}
                        secondaryColor={secondaryColor}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Loose properties */}
              {dev.loose_properties.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-slate-700 text-sm">Propiedades sueltas</h4>
                  <div className={`grid gap-4 ${colsClass('3')}`}>
                    {dev.loose_properties.map((rec: any) => (
                      <PropertyCard
                        key={rec.id}
                        record={{ id: rec.id, data: rec.data, scraped_at: rec.scraped_at }}
                        fieldKeys={fieldKeys}
                        primaryColor={primaryColor}
                        secondaryColor={secondaryColor}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PublicSitePage() {
  const { user, token, logout, refresh } = useAuth()
  const [showAuth, setShowAuth] = useState(false)
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login')
  const [config, setConfig] = useState<SiteConfig | null>(null)
  const [heroRecords, setHeroRecords] = useState<PublicRecord[]>([])
  const [featuredRecords, setFeaturedRecords] = useState<PublicRecord[]>([])
  const [groupedData, setGroupedData] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [loadingCfg, setLoadingCfg] = useState(true)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const catalogRef = useRef<HTMLElement>(null)
  const LIMIT = 12

  // Load config + hero + featured on mount
  useEffect(() => {
    API.get('/public/config')
      .then(r => {
        setConfig(r.data)
        return r.data as SiteConfig
      })
      .then(cfg => {
        if (cfg.show_hero !== false) {
          API.get('/public/hero').then(r => setHeroRecords(r.data)).catch(() => {})
        }
        if (cfg.featured_enabled !== false) {
          API.get('/public/featured').then(r => setFeaturedRecords(r.data)).catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => setLoadingCfg(false))
  }, [])

  // Load grouped records when query changes
  useEffect(() => {
    if (!config) return
    setLoadingCatalog(true)
    API.get('/public/records/grouped', {
      params: query ? { search: query } : {}
    })
      .then(r => setGroupedData(r.data))
      .catch(() => setGroupedData(null))
      .finally(() => setLoadingCatalog(false))
  }, [config, query])

  const doSearch = () => { setQuery(search) }

  const scrollToCatalog = () => catalogRef.current?.scrollIntoView({ behavior: 'smooth' })

  if (loadingCfg || !config) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const fieldKeys = config.catalog_field_keys?.length ? config.catalog_field_keys : undefined

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* ── Navbar ────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: config.primary_color }}>
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-800 text-base">{config.logo_text || config.site_name}</span>
          </div>

          {/* Center search */}
          <div className="flex-1 max-w-md mx-auto hidden sm:flex">
            <div className="flex w-full rounded-xl border border-slate-200 overflow-hidden focus-within:ring-2 bg-white"
              style={{ '--tw-ring-color': config.primary_color } as React.CSSProperties}>
              <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()}
                placeholder="Buscar propiedades…"
                className="flex-1 px-4 py-2 text-sm focus:outline-none" />
              <button onClick={doSearch} className="px-3 text-slate-400 hover:text-slate-600 transition-colors">
                <Search className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {config.catalog_enabled && (
              <button onClick={scrollToCatalog}
                className="text-sm font-medium px-4 py-1.5 rounded-lg text-white transition-opacity hover:opacity-85 hidden sm:block"
                style={{ backgroundColor: config.primary_color }}>
                {config.catalog_title}
              </button>
            )}
            {user ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-sm text-slate-600">
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="hidden sm:block max-w-[100px] truncate">{user.name || user.email}</span>
                </div>
                <button onClick={logout}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button onClick={() => setShowAuth(true)}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                <LogIn className="w-4 h-4" />
                Ingresar
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      {config.show_hero !== false && (
        <HeroCarousel records={heroRecords} config={config} onScrollDown={scrollToCatalog} />
      )}

      {/* ── Featured ──────────────────────────────────────────────────────── */}
      {config.featured_enabled !== false && featuredRecords.length > 0 && (
        <FeaturedSection records={featuredRecords} config={config} />
      )}

      {/* ── Catalog ───────────────────────────────────────────────────────── */}
      {config.catalog_enabled !== false && (
        <section ref={catalogRef} className="py-12 max-w-7xl mx-auto px-4 sm:px-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-800">{config.catalog_title}</h2>
              <p className="text-sm text-slate-400 mt-0.5">Propiedades agrupadas por desarrolladora y proyecto</p>
            </div>
            {/* Mobile search */}
            <div className="flex gap-2 sm:hidden">
              <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()}
                placeholder="Buscar…" className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={doSearch} className="p-2 rounded-lg text-white" style={{ backgroundColor: config.primary_color }}>
                <Search className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Records */}
          {loadingCatalog ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <DeveloperCatalogSection
              developers={groupedData?.developers || []}
              primaryColor={config.primary_color}
              secondaryColor={config.secondary_color}
              fieldKeys={fieldKeys}
            />
          )}
        </section>
      )}

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      {(config.footer_text || config.footer_contact) && (
        <footer className="bg-slate-800 text-slate-400 text-sm py-8 px-4">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>{config.footer_text}</span>
            {config.footer_contact && <span>{config.footer_contact}</span>}
          </div>
        </footer>
      )}

      {/* ── Chatbot ───────────────────────────────────────────────────────── */}
      {config.chatbot_enabled && (
        <ChatWidget
          buttonLabel={config.chatbot_button_label} primaryColor={config.primary_color}
          secondaryColor={config.secondary_color} cardFields={config.card_fields}
          user={user} token={token}
          onRequestAuth={(tab) => { setAuthTab(tab); setShowAuth(true) }}
        />
      )}

      {/* ── Auth modal ────────────────────────────────────────────────────── */}
      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={() => { setShowAuth(false); refresh() }}
          primaryColor={config.primary_color}
          initialTab={authTab}
        />
      )}
    </div>
  )
}
