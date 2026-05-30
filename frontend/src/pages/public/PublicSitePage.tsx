import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, Building2, LogIn,
  MapPin, BedDouble, Maximize2, SlidersHorizontal, Star,
  LayoutList, Map,
} from 'lucide-react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faMagnifyingGlass, faXmark, faChevronDown, faLocationDot,
  faBuilding, faHome, faSlidersH, faHeart, faRightFromBracket,
  faCircleDot, faUser,
} from '@fortawesome/free-solid-svg-icons'
import ChatWidget from '../../components/chat/ChatWidget'
import AuthModal from '../../components/auth/AuthModal'
import UserProfileModal from '../../components/UserProfileModal'
import { useAuth } from '../../hooks/useAuth'
import API from '../../services/api'
import MapView from './MapView'
import type { CatalogRecord as MapCatalogRecord } from './MapView'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CardField { key: string; label: string; type: string }

interface SiteConfig {
  site_name: string; tagline: string | null; primary_color: string; secondary_color: string
  logo_text: string | null; show_hero: boolean; hero_title: string; hero_subtitle: string | null
  hero_cta_text: string; hero_bg_color: string; hero_record_ids: string[]
  catalog_enabled: boolean; catalog_title: string
  footer_text: string | null; footer_contact: string | null
  card_fields: CardField[]; chatbot_enabled: boolean; chatbot_button_label: string
  [key: string]: unknown
}

interface CatalogRecord {
  id: string
  data: Record<string, unknown>
  project_id: string
  project_name: string
  developer_id: string | null
  scraped_at: string | null
}

interface CatalogResponse {
  total: number
  items: CatalogRecord[]
  locations: string[]
  project_statuses: string[]
  projects: Array<{ id: string; name: string }>
}

interface HeroRecord { id: string; data: Record<string, unknown> }

interface TextEntry { key: string; label: string; value: string; isArray: boolean; items?: string[] }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MEDIA_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api').replace(/\/api\/?$/, '')
const IMG_EXT = /\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)(\?.*)?$/i
const HTTP = /^https?:\/\//

function toFull(val: string) { return val.startsWith('/media/') ? `${MEDIA_BASE}${val}` : val }

function detectImages(data: Record<string, unknown>): string[] {
  const seen = new Set<string>(); const out: string[] = []
  function walk(val: unknown, key = '') {
    if (!val) return
    if (typeof val === 'string') {
      let url: string | null = null
      if (val.startsWith('/media/')) url = toFull(val)
      else if (HTTP.test(val) && IMG_EXT.test(val.split('?')[0])) url = val
      if (url && !seen.has(url)) { seen.add(url); out.push(url) }
    } else if (Array.isArray(val)) { val.forEach(i => walk(i, key)) }
    else if (typeof val === 'object') { Object.entries(val as Record<string, unknown>).forEach(([k, v]) => walk(v, k)) }
  }
  Object.entries(data).forEach(([k, v]) => walk(v, k))
  return out
}

const FIELD_LABELS: Record<string, string> = {
  areas_comunes_imagenes: 'Áreas Comunes',
  lugares_cercanos:       'Lugares Cercanos',
}

function detectTextEntries(data: Record<string, unknown>, images: string[]): TextEntry[] {
  const imgSet = new Set(images)
  const isImg = (v: string) => v.startsWith('/media/') || imgSet.has(v) || imgSet.has(toFull(v)) || (HTTP.test(v) && IMG_EXT.test(v))
  const humanize = (k: string) => FIELD_LABELS[k] ?? k.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  const entries: TextEntry[] = []
  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined) continue
    const label = humanize(key)
    if (typeof val === 'string') {
      const cleaned = val.trim().replace(/\s*\n\s*/g, ', ').replace(/\s{2,}/g, ' ')
      if (!cleaned || isImg(val) || HTTP.test(val)) continue
      entries.push({ key, label, value: cleaned, isArray: false })
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

function extractModel(data: Record<string, unknown>): string | null {
  const v = data['modelo'] ?? data['model'] ?? data['tipo'] ?? data['type']
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

function extractBedrooms(data: Record<string, unknown>): number | null {
  const model = extractModel(data)
  if (model) {
    const m = model.match(/(\d+)\s*(?:dorms?|dormitorios?|hab\b|habitaciones?|bedrooms?)/i)
    if (m) return parseInt(m[1])
  }
  for (const k of ['dormitorios', 'dorms', 'bedrooms', 'habitaciones', 'habitacion']) {
    const v = data[k]
    if (typeof v === 'number') return v
    if (typeof v === 'string') { const n = parseInt(v); if (!isNaN(n)) return n }
  }
  return null
}

function extractArea(data: Record<string, unknown>): string | null {
  const model = extractModel(data)
  if (model) {
    const m = model.match(/(\d+(?:\.\d+)?)\s*m²?/i)
    if (m) return `${m[1]} m²`
  }
  for (const k of ['area', 'área', 'm2', 'metros', 'metraje', 'superficie']) {
    const v = data[k]
    if (v && (typeof v === 'number' || typeof v === 'string')) return `${v} m²`
  }
  return null
}

function statusBadgeClass(s: string): string {
  const t = (s || '').toLowerCase()
  if (t.includes('complet') || t.includes('disponib') || t.includes('inmediata') || t.includes('entrega')) return 'bg-emerald-100 text-emerald-700'
  if (t.includes('preventa') || t.includes('construc') || t.includes('próx') || t.includes('prox')) return 'bg-amber-100 text-amber-700'
  if (t.includes('agotad') || t.includes('vendid')) return 'bg-red-100 text-red-700'
  return 'bg-slate-100 text-slate-600'
}

function resolveProjectName(record: CatalogRecord): string {
  if (record.project_name) return record.project_name
  const url = String(record.data['url_propiedad'] ?? record.data['url_proyecto'] ?? record.data['url'] ?? '')
  if (url) {
    try {
      const SKIP = new Set(['proyecto', 'projects', 'propiedad', 'property', 'venta', 'sale', 'en-venta', 'departamentos'])
      const parts = new URL(url).pathname.split('/').filter(p => p && !SKIP.has(p.toLowerCase()))
      const slug = parts[parts.length - 1]
      if (slug) return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    } catch { /* invalid url */ }
  }
  return ''
}

// ─── StarRating ───────────────────────────────────────────────────────────────

function StarRating({ recordId, token, onLoginRequired }: {
  recordId: string; token: string | null; onLoginRequired: () => void
}) {
  const [current, setCurrent] = useState<number>(0)
  const [hover, setHover] = useState<number>(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Load existing rating on mount
  useEffect(() => {
    if (!token) return
    API.get('/preferences/my-ratings', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.data[recordId]) setCurrent(r.data[recordId]) })
      .catch(() => {})
  }, [recordId, token])

  const handleRate = async (stars: number) => {
    if (!token) { onLoginRequired(); return }
    if (saving) return
    setSaving(true)
    try {
      await API.post('/preferences/rate', { record_id: recordId, rating: stars }, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setCurrent(stars)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch {
      /* silent */
    } finally {
      setSaving(false)
    }
  }

  const display = hover || current

  return (
    <div className="flex flex-col items-start gap-1 mt-1">
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
        {saved ? '¡Calificación guardada!' : current ? `Tu calificación: ${current}/5` : 'Califica esta propiedad'}
      </span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(s => (
          <button
            key={s}
            disabled={saving}
            onClick={() => handleRate(s)}
            onMouseEnter={() => setHover(s)}
            onMouseLeave={() => setHover(0)}
            className="transition-transform hover:scale-110 disabled:opacity-50"
          >
            <Star
              className="w-6 h-6"
              fill={s <= display ? '#f59e0b' : 'none'}
              stroke={s <= display ? '#f59e0b' : '#cbd5e1'}
            />
          </button>
        ))}
      </div>
    </div>
  )
}


// ─── PropertyDetailModal ──────────────────────────────────────────────────────

function PropertyDetailModal({ record, primaryColor, secondaryColor, token = null, onClose, onLoginRequired = () => {} }: {
  record: CatalogRecord; primaryColor: string; secondaryColor: string
  token?: string | null; onClose: () => void; onLoginRequired?: () => void
}) {
  const [tab, setTab]               = useState<'info' | 'propiedades'>('info')
  const [cur, setCur]               = useState(0)
  const [units, setUnits]           = useState<CatalogRecord[]>([])
  const [loadingUnits, setLoadingUnits] = useState(false)

  const images = detectImages(record.data)
  const entries = detectTextEntries(record.data, images)
  const priceEntry  = findRole(entries, /precio|price|costo|valor|monto/i)
  const titleEntry  = findRole(entries, /nombre|name|proyecto|titulo|title/i)
  const locEntry    = findRole(entries, /ubicacion|location|district|zona|ciudad/i)
  const statusEntry = findRole(entries, /^estado/i)
  const descEntry   = findRole(entries, /^descripci/i)
  const modelEntry  = entries.find(e => e.key === 'modelo')
  const excluded    = new Set([priceEntry, titleEntry, locEntry, statusEntry, descEntry, modelEntry].filter(Boolean) as TextEntry[])
  const others      = entries.filter(e => !excluded.has(e))
  const title       = record.project_name || titleEntry?.value || '—'

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Fetch all units of the same project when "Propiedades" tab is opened
  useEffect(() => {
    if (tab !== 'propiedades' || !record.project_id) return
    setLoadingUnits(true)
    API.get('/public/catalog', { params: { project_id: record.project_id, skip: 0, limit: 100 } })
      .then(r => setUnits(r.data.items ?? []))
      .catch(() => {})
      .finally(() => setLoadingUnits(false))
  }, [tab, record.project_id])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-4 pb-0 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-slate-800 text-lg leading-snug">{title}</h3>
              {statusEntry && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${statusBadgeClass(statusEntry.value)}`}>
                  {statusEntry.value}
                </span>
              )}
            </div>
            {locEntry && (
              <p className="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3 flex-shrink-0" />{locEntry.value}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors flex-shrink-0 ml-2 mt-0.5">
            <FontAwesomeIcon icon={faXmark} className="w-5 h-5" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex px-6 mt-3 border-b border-slate-100 flex-shrink-0">
          {(['info', 'propiedades'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {t === 'info' ? 'Información' : 'Propiedades'}
            </button>
          ))}
        </div>

        {/* ── Tab: Información ── */}
        {tab === 'info' && (
          <div className="overflow-y-auto flex-1">
            {/* Image carousel */}
            {images.length > 0 && (
              <div className="relative h-64 bg-slate-100 flex-shrink-0">
                <img src={images[cur]} alt="" className="w-full h-full object-cover" />
                {images.length > 1 && (
                  <>
                    <div className="absolute top-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full">{cur + 1}/{images.length}</div>
                    <button onClick={() => setCur(c => Math.max(0, c - 1))} disabled={cur === 0}
                      className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-20 text-white rounded-full p-2 transition-all">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button onClick={() => setCur(c => Math.min(images.length - 1, c + 1))} disabled={cur === images.length - 1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-20 text-white rounded-full p-2 transition-all">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                    <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                      {images.slice(0, 8).map((_, i) => (
                        <button key={i} onClick={() => setCur(i)}
                          className={`rounded-full transition-all ${i === cur ? 'w-5 h-2 bg-white' : 'w-2 h-2 bg-white/50 hover:bg-white/80'}`} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Fields */}
            <div className="p-6">
              {priceEntry && (
                <p className="text-3xl font-extrabold mb-4" style={{ color: secondaryColor }}>{priceEntry.value}</p>
              )}
              <div className="flex flex-wrap gap-2 mb-5">
                {extractBedrooms(record.data) && (
                  <span className="flex items-center gap-1 text-xs font-medium bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full">
                    <BedDouble className="w-3.5 h-3.5" />{extractBedrooms(record.data)} dorms.
                  </span>
                )}
                {extractArea(record.data) && (
                  <span className="flex items-center gap-1 text-xs font-medium bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full">
                    <Maximize2 className="w-3.5 h-3.5" />{extractArea(record.data)}
                  </span>
                )}
                {extractModel(record.data) && !extractBedrooms(record.data) && (
                  <span className="text-xs font-medium bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full">
                    {extractModel(record.data)}
                  </span>
                )}
              </div>
              {descEntry && (
                <div className="mb-5 pb-5 border-b border-slate-100">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Descripción</p>
                  <p className="text-sm text-slate-600 leading-relaxed">{descEntry.value}</p>
                </div>
              )}
              <div className="mb-5 pb-5 border-b border-slate-100">
                <StarRating recordId={record.id} token={token} onLoginRequired={onLoginRequired} />
              </div>
              {others.length > 0 && (
                <div className="space-y-2">
                  {others.map(e => (
                    <div key={e.key} className="flex gap-3 items-start py-2.5 border-b border-slate-50 last:border-0">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-32 flex-shrink-0 pt-0.5">{e.label}</span>
                      <span className="text-sm text-slate-700 flex-1 leading-relaxed break-words">
                        {e.isArray && e.items ? (
                          <span className="flex flex-wrap gap-1">
                            {e.items.map((it, i) => (
                              <span key={i} className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-md">{it}</span>
                            ))}
                          </span>
                        ) : e.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Propiedades ── */}
        {tab === 'propiedades' && (
          <div className="overflow-y-auto flex-1 p-4">
            {loadingUnits ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: primaryColor + '40', borderTopColor: 'transparent' }} />
              </div>
            ) : units.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-16">No hay propiedades registradas para este proyecto.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-400 mb-1">{units.length} propiedad{units.length !== 1 ? 'es' : ''} disponible{units.length !== 1 ? 's' : ''}</p>
                {units.map(u => {
                  const uImages  = detectImages(u.data)
                  const uEntries = detectTextEntries(u.data, uImages)
                  const uPrice   = findRole(uEntries, /precio|price|costo|valor|monto/i)
                  const uStatus  = findRole(uEntries, /^estado/i)
                  const uBeds    = extractBedrooms(u.data)
                  const uArea    = extractArea(u.data)
                  const uModel   = extractModel(u.data)
                  const uImg     = uImages[0] ?? null

                  return (
                    <div key={u.id} className="flex gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-all">
                      {/* Thumbnail */}
                      {uImg ? (
                        <img src={uImg} alt="" className="w-20 h-20 object-cover rounded-lg flex-shrink-0" />
                      ) : (
                        <div className="w-20 h-20 bg-slate-100 rounded-lg flex-shrink-0 flex items-center justify-center">
                          <Building2 className="w-6 h-6 text-slate-300" />
                        </div>
                      )}
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        {uModel && (
                          <p className="text-sm font-semibold text-slate-800 leading-snug mb-1 line-clamp-1">{uModel}</p>
                        )}
                        {uPrice && (
                          <p className="text-base font-extrabold leading-none mb-1.5" style={{ color: secondaryColor }}>
                            {uPrice.value}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {uBeds && (
                            <span className="flex items-center gap-1 text-[11px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                              <BedDouble className="w-3 h-3" />{uBeds} dorms.
                            </span>
                          )}
                          {uArea && (
                            <span className="flex items-center gap-1 text-[11px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                              <Maximize2 className="w-3 h-3" />{uArea}
                            </span>
                          )}
                          {uStatus && (
                            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(uStatus.value)}`}>
                              {uStatus.value}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ─── PropertyCard ─────────────────────────────────────────────────────────────

function PropertyCard({ record, primaryColor, secondaryColor, token, onLoginRequired }: {
  record: CatalogRecord; primaryColor: string; secondaryColor: string
  token: string | null; onLoginRequired: () => void
}) {
  const [showModal, setShowModal] = useState(false)
  const images = detectImages(record.data)
  const heroImg = images[0] || null

  const entries = detectTextEntries(record.data, images)
  const priceEntry = findRole(entries, /precio|price|costo|valor|monto/i)
  const locEntry = findRole(entries, /ubicacion|location|district|zona|ciudad/i)
  const model = extractModel(record.data)
  const beds = extractBedrooms(record.data)
  const area = extractArea(record.data)
  const projectName = resolveProjectName(record)
  const locShort = locEntry ? locEntry.value.split(',')[0].trim() : null

  return (
    <>
      <div
        onClick={() => setShowModal(true)}
        className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col group"
      >
        {/* Image */}
        <div className="relative h-52 overflow-hidden bg-slate-100 flex-shrink-0">
          {heroImg
            ? <img src={heroImg} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-400" />
            : (
              <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: primaryColor + '15' }}>
                <Building2 className="w-12 h-12" style={{ color: primaryColor + '50' }} />
              </div>
            )
          }
          {/* Project badge top-right */}
          {projectName && (
            <div className="absolute top-3 right-3">
              <span className="text-[11px] font-bold text-white px-2.5 py-1 rounded-full shadow-lg backdrop-blur-sm"
                style={{ backgroundColor: primaryColor + 'e0' }}>
                {projectName}
              </span>
            </div>
          )}
          {/* Location badge bottom-left */}
          {locShort && (
            <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/60 to-transparent">
              <p className="text-white text-xs flex items-center gap-1 font-medium">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                {locShort}
              </p>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col flex-1 gap-2">
          {/* Price */}
          {priceEntry ? (
            <p className="text-xl font-extrabold leading-tight" style={{ color: secondaryColor }}>{priceEntry.value}</p>
          ) : (
            <p className="text-sm text-slate-400 italic">Precio a consultar</p>
          )}

          {/* Model */}
          {model && (
            <p className="text-sm font-medium text-slate-700 leading-snug line-clamp-2">{model}</p>
          )}

          {/* Chips */}
          {(beds || area) && (
            <div className="flex flex-wrap gap-1.5">
              {beds && (
                <span className="flex items-center gap-1 text-[11px] font-semibold bg-slate-50 border border-slate-200 text-slate-600 px-2 py-1 rounded-lg">
                  <BedDouble className="w-3 h-3" />{beds} dorms.
                </span>
              )}
              {area && (
                <span className="flex items-center gap-1 text-[11px] font-semibold bg-slate-50 border border-slate-200 text-slate-600 px-2 py-1 rounded-lg">
                  <Maximize2 className="w-3 h-3" />{area}
                </span>
              )}
            </div>
          )}

          {/* CTA */}
          <button
            className="mt-auto pt-1 w-full text-center text-xs font-bold py-2.5 rounded-xl transition-all border-2"
            style={{ borderColor: primaryColor, color: primaryColor }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = primaryColor
              e.currentTarget.style.color = 'white'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = ''
              e.currentTarget.style.color = primaryColor
            }}
          >
            Ver detalles →
          </button>
        </div>
      </div>

      {showModal && (
        <PropertyDetailModal
          record={record} primaryColor={primaryColor} secondaryColor={secondaryColor}
          token={token} onClose={() => setShowModal(false)} onLoginRequired={onLoginRequired}
        />
      )}
    </>
  )
}


// ─── Filter pill helpers ──────────────────────────────────────────────────────

const PRICE_RANGES = [
  { value: '',              label: 'Cualquier precio' },
  { value: '0-200000',      label: 'Hasta S/ 200k' },
  { value: '200000-400000', label: 'S/ 200k – S/ 400k' },
  { value: '400000-600000', label: 'S/ 400k – S/ 600k' },
  { value: '600000-800000', label: 'S/ 600k – S/ 800k' },
  { value: '800000+',       label: 'Más de S/ 800k' },
]

const BEDROOM_OPTIONS = [
  { value: '',   label: 'Todos' },
  { value: '1',  label: '1 Dorm.' },
  { value: '2',  label: '2 Dorms.' },
  { value: '3',  label: '3 Dorms.' },
  { value: '4+', label: '4+ Dorms.' },
]

function FilterPill({ label, value, options, onChange }: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)
  const valueLabel = selected?.value ? selected.label : 'Todos'

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 bg-white/12 hover:bg-white/22 backdrop-blur-md border border-white/25 rounded-xl pl-3 pr-2.5 py-2 transition-all whitespace-nowrap group"
      >
        <span className="text-white/55 text-[11px] font-semibold">{label}</span>
        <span className="text-white font-bold text-[13px] mx-0.5">{valueLabel}</span>
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`text-white/50 text-[9px] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 bg-white rounded-2xl shadow-2xl border border-slate-100 z-30 min-w-[190px] overflow-hidden py-1.5">
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                o.value === value
                  ? 'bg-blue-50 text-blue-700 font-bold'
                  : 'text-slate-700 hover:bg-slate-50 font-medium'
              }`}
            >
              {o.value === value && <FontAwesomeIcon icon={faCircleDot} className="text-blue-500 text-[10px]" />}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}


// ─── HeroBanner ───────────────────────────────────────────────────────────────

interface HeroFilters {
  location: string
  projectStatus: string
  bedrooms: string
  priceRange: string
}

function HeroBanner({ config, stats, locations, projectStatuses, filters, onSearch, onFilterChange }: {
  config: SiteConfig
  heroRecords?: HeroRecord[]
  stats: { total: number; locations: number; projects: number }
  locations: string[]
  projectStatuses: string[]
  filters: HeroFilters
  onSearch: (q: string) => void
  onFilterChange: (f: Partial<HeroFilters>) => void
}) {
  const [draft, setDraft] = useState('')
  const submit = () => onSearch(draft.trim())

  const locationOptions = [
    { value: '', label: 'Todas' },
    ...locations.map(l => ({ value: l, label: l })),
  ]
  const statusOptions = [
    { value: '', label: 'Todos' },
    ...projectStatuses.map(s => ({ value: s, label: s })),
  ]
  const hasFilters = filters.location || filters.projectStatus || filters.bedrooms || filters.priceRange

  const STATS = [
    { icon: faHome,        value: `${stats.total}+`,     label: 'Propiedades activas' },
    { icon: faBuilding,    value: `${stats.projects}+`,  label: 'Proyectos'           },
    { icon: faLocationDot, value: `${stats.locations}+`, label: 'Ubicaciones'         },
  ]

  return (
    <section className="relative overflow-hidden" style={{ minHeight: '74vh' }}>
      {/* Background */}
      <img
        src="/hero-bg.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover object-center"
      />
      {/* Blue-navy tinted overlay — matching reference */}
      <div className="absolute inset-0"
        style={{ background: 'linear-gradient(105deg, rgba(8,18,55,0.93) 0%, rgba(10,22,68,0.78) 45%, rgba(10,22,68,0.30) 75%, transparent 100%)' }}
      />

      {/* Content grid */}
      <div className="relative max-w-7xl mx-auto px-6 flex items-center gap-10 h-full" style={{ minHeight: '74vh' }}>

        {/* ── Left: text + search + pills ── */}
        <div className="flex-1 max-w-[600px] py-16">

          {/* Tag pill */}
          <div className="inline-flex items-center gap-2 border border-white/25 rounded-full px-4 py-1.5 mb-7">
            <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
            <span className="text-white/90 text-[11px] font-bold tracking-[0.18em] uppercase">
              TU PRÓXIMO HOGAR TE ESPERA
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-white font-black leading-[1.08] mb-4 drop-shadow-xl"
            style={{ fontSize: 'clamp(2.2rem, 4.5vw, 3.6rem)' }}>
            {config.hero_title}
          </h1>

          {/* Subtitle */}
          {config.hero_subtitle && (
            <p className="text-white/65 text-base leading-relaxed mb-7 max-w-lg">
              {config.hero_subtitle}
            </p>
          )}

          {/* Search bar — button integrated inside */}
          <div className="flex items-center bg-white rounded-2xl shadow-2xl mb-5 overflow-hidden max-w-[560px]">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="ml-5 text-slate-400 text-sm flex-shrink-0" />
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="Buscar por distrito, proyecto, zona..."
              className="flex-1 px-4 py-4 text-sm text-slate-700 placeholder-slate-400 focus:outline-none bg-transparent"
            />
            {draft && (
              <button
                onClick={() => { setDraft(''); onSearch('') }}
                className="p-2 mr-1 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <FontAwesomeIcon icon={faXmark} className="text-sm" />
              </button>
            )}
            <button
              onClick={submit}
              className="m-1.5 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:brightness-110 active:scale-95 flex-shrink-0"
              style={{ backgroundColor: config.secondary_color || '#1d4ed8' }}
            >
              Buscar
            </button>
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {locations.length > 0 && (
              <FilterPill label="Ubicación" value={filters.location} options={locationOptions}
                onChange={v => onFilterChange({ location: v })} />
            )}
            {statusOptions.length > 1 && (
              <FilterPill label="Estado" value={filters.projectStatus} options={statusOptions}
                onChange={v => onFilterChange({ projectStatus: v })} />
            )}
            <FilterPill label="Dormitorios" value={filters.bedrooms} options={BEDROOM_OPTIONS}
              onChange={v => onFilterChange({ bedrooms: v })} />
            <FilterPill label="Precio" value={filters.priceRange} options={PRICE_RANGES}
              onChange={v => onFilterChange({ priceRange: v })} />

            {/* Más filtros */}
            <button className="flex items-center gap-1.5 bg-white/12 hover:bg-white/22 backdrop-blur-md border border-white/25 rounded-xl px-3 py-2 text-white/80 hover:text-white text-[13px] font-semibold transition-all flex-shrink-0">
              <FontAwesomeIcon icon={faSlidersH} className="text-[11px]" />
              Más filtros
            </button>

            {hasFilters && (
              <button
                onClick={() => onFilterChange({ location: '', projectStatus: '', bedrooms: '', priceRange: '' })}
                className="flex items-center gap-1.5 bg-white/8 hover:bg-red-500/20 backdrop-blur-md border border-white/15 rounded-xl px-3 py-2 text-white/60 hover:text-white text-[13px] font-medium transition-all flex-shrink-0"
              >
                <FontAwesomeIcon icon={faXmark} className="text-[11px]" />
                Limpiar
              </button>
            )}
          </div>
        </div>

        {/* ── Right: floating stats ── */}
        {stats.total > 0 && (
          <div className="hidden lg:grid grid-cols-1 gap-3 flex-shrink-0 ml-auto">
            {STATS.map(s => (
              <div
                key={s.label}
                className="flex items-center gap-4 bg-white/10 backdrop-blur-xl border border-white/15 rounded-2xl px-6 py-4 text-white min-w-[220px]"
              >
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
                  <FontAwesomeIcon icon={s.icon} className="text-blue-300 text-base" />
                </div>
                <div>
                  <p className="text-3xl font-black tabular-nums leading-none">{s.value}</p>
                  <p className="text-[11px] text-white/55 font-semibold mt-0.5">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mobile stats */}
      {stats.total > 0 && (
        <div className="lg:hidden absolute bottom-0 left-0 right-0 bg-black/30 backdrop-blur-sm border-t border-white/10">
          <div className="max-w-7xl mx-auto px-6 py-3 flex justify-around">
            {STATS.map(s => (
              <div key={s.label} className="flex items-center gap-2 text-white">
                <FontAwesomeIcon icon={s.icon} className="text-blue-300 text-sm" />
                <div>
                  <p className="text-lg font-black leading-none">{s.value}</p>
                  <p className="text-[10px] text-white/55 font-medium">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

function FilterBar({ locations, projects, activeLocation, activeProject, onFilter, primaryColor }: {
  locations: string[]
  projects: Array<{ id: string; name: string }>
  activeLocation: string
  activeProject: string
  onFilter: (location: string, project: string) => void
  primaryColor: string
}) {
  const hasActive = activeLocation || activeProject
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5 text-slate-500">
        <SlidersHorizontal className="w-4 h-4" />
        <span className="text-sm font-medium">Filtrar:</span>
      </div>

      {/* Location filter */}
      {locations.length > 0 && (
        <select
          value={activeLocation}
          onChange={e => onFilter(e.target.value, activeProject)}
          className="text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 bg-white text-slate-700 cursor-pointer"
          style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
        >
          <option value="">Todas las ubicaciones</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      )}

      {/* Project filter */}
      {projects.length > 1 && (
        <select
          value={activeProject}
          onChange={e => onFilter(activeLocation, e.target.value)}
          className="text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 bg-white text-slate-700 cursor-pointer"
          style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
        >
          <option value="">Todos los proyectos</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}

      {/* Clear */}
      {hasActive && (
        <button
          onClick={() => onFilter('', '')}
          className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 px-3 py-2 rounded-xl hover:bg-slate-100 transition-colors"
        >
          <FontAwesomeIcon icon={faXmark} className="text-sm" />
          Limpiar
        </button>
      )}
    </div>
  )
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function PaginationBar({ total, limit, skip, onPage, primaryColor }: {
  total: number; limit: number; skip: number; onPage: (s: number) => void; primaryColor: string
}) {
  const cur = Math.floor(skip / limit)
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return null

  const maxVisible = 5
  let start = Math.max(0, cur - 2)
  const end = Math.min(totalPages - 1, start + maxVisible - 1)
  if (end - start < maxVisible - 1) start = Math.max(0, end - maxVisible + 1)
  const pages = []
  for (let i = start; i <= end; i++) pages.push(i)

  return (
    <div className="flex items-center justify-center gap-1.5 mt-10">
      <button
        onClick={() => onPage(Math.max(0, skip - limit))}
        disabled={cur === 0}
        className="flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> Anterior
      </button>
      <div className="flex gap-1">
        {start > 0 && <span className="w-9 h-9 flex items-center justify-center text-slate-400 text-sm">…</span>}
        {pages.map(p => (
          <button
            key={p}
            onClick={() => onPage(p * limit)}
            className="w-9 h-9 rounded-xl text-sm font-semibold transition-all"
            style={p === cur
              ? { backgroundColor: primaryColor, color: 'white' }
              : { color: '#475569' }
            }
          >
            {p + 1}
          </button>
        ))}
        {end < totalPages - 1 && <span className="w-9 h-9 flex items-center justify-center text-slate-400 text-sm">…</span>}
      </div>
      <button
        onClick={() => onPage(Math.min((totalPages - 1) * limit, skip + limit))}
        disabled={cur === totalPages - 1}
        className="flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors"
      >
        Siguiente <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const LIMIT = 12

export default function PublicSitePage() {
  const { user, token, logout, refresh, updateUser } = useAuth()
  const [showAuth, setShowAuth] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login')
  const [config, setConfig] = useState<SiteConfig | null>(null)
  const [heroRecords, setHeroRecords] = useState<HeroRecord[]>([])
  const [catalog, setCatalog] = useState<CatalogResponse>({ total: 0, items: [], locations: [], project_statuses: [], projects: [] })
  const [search, setSearch]       = useState('')
  const [location, setLocation]   = useState('')
  const [projectId, setProjectId] = useState('')
  const [bedrooms, setBedrooms]   = useState('')
  const [projectStatus, setProjectStatus] = useState('')
  const [priceRange, setPriceRange]       = useState('')
  const [skip, setSkip] = useState(0)
  const [loadingCfg, setLoadingCfg] = useState(true)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const catalogRef = useRef<HTMLElement>(null)

  // ── Map view state ──
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [mapItems, setMapItems] = useState<MapCatalogRecord[]>([])
  const [loadingMap, setLoadingMap] = useState(false)
  const [mapDetailRecord, setMapDetailRecord] = useState<CatalogRecord | null>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Load config + hero on mount
  useEffect(() => {
    API.get('/public/config')
      .then(r => { setConfig(r.data); return r.data })
      .then(() => {
        API.get('/public/hero').then(r => setHeroRecords(r.data)).catch(() => {})
      })
      .catch(() => {})
      .finally(() => setLoadingCfg(false))
  }, [])

  // Load catalog whenever filters/skip change
  useEffect(() => {
    if (!config) return
    setLoadingCatalog(true)
    const params: Record<string, string | number> = { skip, limit: LIMIT }
    if (search)        params.search         = search
    if (location)      params.location       = location
    if (projectId)     params.project_id     = projectId
    if (bedrooms)      params.bedrooms       = bedrooms
    if (projectStatus) params.project_status = projectStatus
    if (priceRange)    params.price_range    = priceRange
    API.get('/public/catalog', { params })
      .then(r => setCatalog(r.data))
      .catch(() => {})
      .finally(() => setLoadingCatalog(false))
  }, [config, search, location, projectId, bedrooms, projectStatus, priceRange, skip])

  // Fetch all items (no pagination) when switching to map mode
  useEffect(() => {
    if (viewMode !== 'map' || !config) return
    setLoadingMap(true)
    const params: Record<string, string | number> = { skip: 0, limit: 500 }
    if (search)    params.search     = search
    if (location)  params.location   = location
    if (projectId) params.project_id = projectId
    API.get('/public/catalog', { params })
      .then(r => setMapItems(r.data.items))
      .catch(() => {})
      .finally(() => setLoadingMap(false))
  }, [viewMode, config, search, location, projectId])

  const saveSearchHistory = useCallback((q: string, loc: string, proj: string) => {
    if (!token) return
    if (!q && !loc && !proj) return
    API.post('/preferences/search-history', { query: q || null, location: loc || null, project_id: proj || null, source: 'portal' }, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {})
  }, [token])

  const handleSearch = useCallback((q: string) => {
    setSearch(q); setSkip(0)
    saveSearchHistory(q, location, projectId)
  }, [location, projectId, saveSearchHistory])

  const handleHeroFilterChange = useCallback((partial: Partial<HeroFilters>) => {
    if ('location'      in partial) { setLocation(partial.location!); setSkip(0) }
    if ('projectStatus' in partial) { setProjectStatus(partial.projectStatus!); setSkip(0) }
    if ('bedrooms'      in partial) { setBedrooms(partial.bedrooms!); setSkip(0) }
    if ('priceRange'    in partial) { setPriceRange(partial.priceRange!); setSkip(0) }
    // Reset all if empty object (limpiar)
    if (Object.values(partial).every(v => v === '')) {
      setLocation(''); setProjectStatus(''); setBedrooms(''); setPriceRange(''); setSkip(0)
    }
  }, [])

  const handleFilter = useCallback((loc: string, proj: string) => {
    setLocation(loc); setProjectId(proj); setSkip(0)
    saveSearchHistory(search, loc, proj)
  }, [search, saveSearchHistory])

  const scrollToCatalog = () => catalogRef.current?.scrollIntoView({ behavior: 'smooth' })

  if (loadingCfg || !config) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const hasFilters = search || location || projectId
  const stats = { total: catalog.total, locations: catalog.locations.length, projects: catalog.projects.length }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-40 bg-white/96 backdrop-blur-md border-b border-slate-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-6">
          {/* Logo */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: config.primary_color }}>
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-800 text-base tracking-tight">{config.logo_text || config.site_name}</span>
          </div>

          {/* Nav links — desktop */}
          <div className="hidden md:flex items-center gap-1 ml-4">
            {[
              { label: 'Explorar', action: scrollToCatalog },
              { label: 'Proyectos', action: scrollToCatalog },
              { label: 'Ubicaciones', action: scrollToCatalog },
            ].map(link => (
              <button
                key={link.label}
                onClick={link.action}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
              >
                {link.label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {/* Favoritos */}
            {user && (
              <button className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors">
                <FontAwesomeIcon icon={faHeart} className="text-slate-400 text-sm" />
                <span>Favoritos</span>
              </button>
            )}

            {user ? (
              <div className="relative" ref={dropdownRef}>
                {/* Trigger */}
                <button
                  onClick={() => setShowDropdown(v => !v)}
                  className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-1.5 hover:bg-slate-50 transition-colors"
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: config.primary_color }}
                  >
                    {(user.name || user.email || 'U')[0].toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-slate-700 hidden sm:block truncate max-w-[100px]">
                    {user.name?.split(' ')[0] || user.email}
                  </span>
                  <FontAwesomeIcon
                    icon={faChevronDown}
                    className={`text-slate-400 text-[10px] transition-transform duration-200 ${showDropdown ? 'rotate-180' : ''}`}
                  />
                </button>

                {/* Dropdown panel */}
                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden z-50 animate-[fadeInDown_0.15s_ease]">
                    <button
                      onClick={() => { setShowDropdown(false); setShowProfile(true) }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <FontAwesomeIcon icon={faUser} className="w-4 text-slate-400" />
                      Mi perfil
                    </button>
                    <div className="h-px bg-slate-100 mx-3" />
                    <button
                      onClick={() => { setShowDropdown(false); logout() }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <FontAwesomeIcon icon={faRightFromBracket} className="w-4" />
                      Cerrar sesión
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl text-white transition-all hover:brightness-110 active:scale-95"
                style={{ backgroundColor: config.primary_color }}
              >
                <LogIn className="w-3.5 h-3.5" />
                Ingresar
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      {config.show_hero !== false && (
        <HeroBanner
          config={config}
          heroRecords={heroRecords}
          stats={stats}
          locations={catalog.locations}
          projectStatuses={catalog.project_statuses ?? []}
          filters={{ location, projectStatus, bedrooms, priceRange }}
          onSearch={handleSearch}
          onFilterChange={handleHeroFilterChange}
        />
      )}

      {/* ── Catalog ────────────────────────────────────────────────────────── */}
      <section ref={catalogRef} className={`py-10 px-4 sm:px-6 ${viewMode === 'list' ? 'max-w-7xl mx-auto' : 'max-w-screen-2xl mx-auto'}`}>

        {/* Section header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">
              {viewMode === 'map' ? 'Buscar por mapa' : (config.catalog_title || 'Propiedades disponibles')}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {viewMode === 'map'
                ? 'Explora los proyectos disponibles en el mapa y encuentra tu próximo hogar.'
                : loadingCatalog
                  ? 'Cargando...'
                  : `${catalog.total} propiedad${catalog.total !== 1 ? 'es' : ''} encontrada${catalog.total !== 1 ? 's' : ''}${hasFilters ? ' (con filtros activos)' : ''}`
              }
            </p>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Tab toggle Lista / Mapa */}
            <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                  viewMode === 'list'
                    ? 'bg-white shadow text-slate-800'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <LayoutList className="w-4 h-4" />
                Lista
              </button>
              <button
                onClick={() => setViewMode('map')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                  viewMode === 'map'
                    ? 'bg-white shadow text-slate-800'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Map className="w-4 h-4" />
                Mapa
              </button>
            </div>

            {/* Filter bar (list mode only) */}
            {viewMode === 'list' && (
              <FilterBar
                locations={catalog.locations}
                projects={catalog.projects}
                activeLocation={location}
                activeProject={projectId}
                onFilter={handleFilter}
                primaryColor={config.primary_color}
              />
            )}
          </div>
        </div>

        {/* ── Map view ── */}
        {viewMode === 'map' && (
          <MapView
            items={mapItems}
            loading={loadingMap}
            locations={catalog.locations}
            primaryColor={config.primary_color}
            activeLocation={location}
            onLocationFilter={loc => handleFilter(loc, projectId)}
            onOpenDetail={r => setMapDetailRecord(r as CatalogRecord)}
          />
        )}

        {/* Active filter chips (list mode) */}
        {viewMode === 'list' && hasFilters && (
          <div className="flex flex-wrap gap-2 mb-6">
            {search && (
              <span className="flex items-center gap-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-full">
                <FontAwesomeIcon icon={faMagnifyingGlass} className="text-[10px]" />"{search}"
                <button onClick={() => handleSearch('')} className="hover:text-blue-900"><FontAwesomeIcon icon={faXmark} className="text-[10px]" /></button>
              </span>
            )}
            {location && (
              <span className="flex items-center gap-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-full">
                <MapPin className="w-3 h-3" />{location}
                <button onClick={() => handleFilter('', projectId)} className="hover:text-emerald-900"><FontAwesomeIcon icon={faXmark} className="text-[10px]" /></button>
              </span>
            )}
            {projectId && (
              <span className="flex items-center gap-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-full">
                <Building2 className="w-3 h-3" />{catalog.projects.find(p => p.id === projectId)?.name || projectId}
                <button onClick={() => handleFilter(location, '')} className="hover:text-indigo-900"><FontAwesomeIcon icon={faXmark} className="text-[10px]" /></button>
              </span>
            )}
          </div>
        )}

        {/* Grid + Pagination (list mode only) */}
        {viewMode === 'list' && (
          <>
            {loadingCatalog ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: config.primary_color + '40', borderTopColor: 'transparent' }} />
                <p className="text-sm text-slate-400">Cargando propiedades...</p>
              </div>
            ) : catalog.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: config.primary_color + '15' }}>
                  <SlidersHorizontal className="w-8 h-8" style={{ color: config.primary_color }} />
                </div>
                <h3 className="font-semibold text-slate-700 mb-1">Sin resultados</h3>
                <p className="text-sm text-slate-400 mb-4">
                  {hasFilters ? 'No hay propiedades con los filtros seleccionados.' : 'No hay propiedades disponibles aún.'}
                </p>
                {hasFilters && (
                  <button
                    onClick={() => { handleSearch(''); handleFilter('', '') }}
                    className="text-sm font-semibold px-4 py-2 rounded-xl text-white transition-all hover:opacity-90"
                    style={{ backgroundColor: config.primary_color }}
                  >
                    Quitar todos los filtros
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {catalog.items.map(r => (
                  <PropertyCard
                    key={r.id}
                    record={r}
                    primaryColor={config.primary_color}
                    secondaryColor={config.secondary_color}
                    token={token}
                    onLoginRequired={() => { setAuthTab('login'); setShowAuth(true) }}
                  />
                ))}
              </div>
            )}

            <PaginationBar
              total={catalog.total}
              limit={LIMIT}
              skip={skip}
              onPage={setSkip}
              primaryColor={config.primary_color}
            />
          </>
        )}
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      {(config.footer_text || config.footer_contact) && (
        <footer className="bg-slate-800 text-slate-400 text-sm py-10 px-4 mt-8">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: config.primary_color }}>
                <Building2 className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-medium text-slate-300">{config.logo_text || config.site_name}</span>
            </div>
            <span>{config.footer_text}</span>
            {config.footer_contact && <span>{config.footer_contact}</span>}
          </div>
        </footer>
      )}

      {/* ── Chatbot ─────────────────────────────────────────────────────────── */}
      {config.chatbot_enabled && (
        <ChatWidget
          buttonLabel={config.chatbot_button_label}
          primaryColor={config.primary_color}
          secondaryColor={config.secondary_color}
          cardFields={config.card_fields}
          user={user}
          token={token}
          onRequestAuth={(tab) => { setAuthTab(tab); setShowAuth(true) }}
        />
      )}

      {/* ── Auth modal ──────────────────────────────────────────────────────── */}
      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={() => { setShowAuth(false); refresh() }}
          primaryColor={config.primary_color}
          initialTab={authTab}
        />
      )}

      {/* ── User profile modal ─────────────────────────────────────────────── */}
      {showProfile && user && token && (
        <UserProfileModal
          user={user}
          token={token}
          primaryColor={config.primary_color}
          onClose={() => setShowProfile(false)}
          onUserUpdated={u => { updateUser(u) }}
        />
      )}

      {/* ── Map detail modal ────────────────────────────────────────────────── */}
      {mapDetailRecord && (
        <PropertyDetailModal
          record={mapDetailRecord}
          primaryColor={config.primary_color}
          secondaryColor={config.secondary_color}
          token={token}
          onClose={() => setMapDetailRecord(null)}
          onLoginRequired={() => { setAuthTab('login'); setShowAuth(true) }}
        />
      )}
    </div>
  )
}
