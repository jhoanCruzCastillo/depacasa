import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Search, ChevronLeft, ChevronRight, Building2, LogIn, LogOut,
  User, X, MapPin, BedDouble, Maximize2, SlidersHorizontal, Filter, Star,
  LayoutList, Map,
} from 'lucide-react'
import ChatWidget from '../../components/chat/ChatWidget'
import AuthModal from '../../components/auth/AuthModal'
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
            <X className="w-5 h-5" />
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

// ─── HeroCard (compact card for hero mosaic) ──────────────────────────────────

function HeroCard({ record, primaryColor, secondaryColor }: {
  record: HeroRecord; primaryColor: string; secondaryColor: string
}) {
  const [showModal, setShowModal] = useState(false)
  const images = detectImages(record.data)
  const heroImg = images[0]
  const entries = detectTextEntries(record.data, images)
  const titleEntry = findRole(entries, /nombre|name|proyecto|titulo|title/i)
  const priceEntry = findRole(entries, /precio|price|costo|valor|monto/i)
  const locEntry = findRole(entries, /ubicacion|location|district|zona|ciudad/i)

  const fakeRecord: CatalogRecord = { id: record.id, data: record.data, project_id: '', project_name: titleEntry?.value || 'Proyecto', developer_id: null, scraped_at: null }

  return (
    <>
      <div
        onClick={() => setShowModal(true)}
        className="relative rounded-2xl overflow-hidden cursor-pointer group shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
        style={{ minHeight: 220 }}
      >
        {heroImg
          ? <img src={heroImg} alt="" className="w-full h-full object-cover absolute inset-0 group-hover:scale-105 transition-transform duration-500" />
          : <div className="w-full h-full absolute inset-0" style={{ background: `linear-gradient(135deg, ${primaryColor}40, ${primaryColor}20)` }} />
        }
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="relative h-full flex flex-col justify-end p-4" style={{ minHeight: 220 }}>
          {titleEntry && (
            <h3 className="text-white font-bold text-sm leading-snug line-clamp-2 drop-shadow mb-1">{titleEntry.value}</h3>
          )}
          {priceEntry && (
            <p className="font-extrabold text-base drop-shadow" style={{ color: secondaryColor === '#059669' ? '#34d399' : secondaryColor }}>
              {priceEntry.value}
            </p>
          )}
          {locEntry && (
            <p className="text-white/80 text-xs flex items-center gap-1 mt-1">
              <MapPin className="w-3 h-3" />{locEntry.value}
            </p>
          )}
        </div>
      </div>
      {showModal && (
        <PropertyDetailModal record={fakeRecord} primaryColor={primaryColor} secondaryColor={secondaryColor} onClose={() => setShowModal(false)} />
      )}
    </>
  )
}

// ─── HeroBanner ───────────────────────────────────────────────────────────────

function HeroBanner({ config, heroRecords, stats, onSearch }: {
  config: SiteConfig
  heroRecords: HeroRecord[]
  stats: { total: number; locations: number; projects: number }
  onSearch: (q: string) => void
}) {
  const [draft, setDraft] = useState('')
  const submit = () => { onSearch(draft.trim()) }

  return (
    <section className="relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${config.primary_color} 0%, ${config.primary_color}cc 60%, ${config.primary_color}99 100%)` }}>
      {/* Decorative blobs */}
      <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-10 -translate-y-1/2 translate-x-1/3"
        style={{ backgroundColor: 'white' }} />
      <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full opacity-10 translate-y-1/2 -translate-x-1/4"
        style={{ backgroundColor: 'white' }} />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-10">
        {/* Headline */}
        <div className="max-w-2xl mb-8">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-tight mb-3 drop-shadow">
            {config.hero_title}
          </h1>
          {config.hero_subtitle && (
            <p className="text-white/80 text-base sm:text-lg">{config.hero_subtitle}</p>
          )}
        </div>

        {/* Search bar */}
        <div className="flex gap-2 max-w-2xl mb-8">
          <div className="flex-1 flex items-center gap-2 bg-white rounded-2xl px-4 py-3 shadow-xl">
            <Search className="w-5 h-5 text-slate-400 flex-shrink-0" />
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="Buscar por distrito, proyecto, tipo..."
              className="flex-1 text-sm text-slate-700 placeholder-slate-400 focus:outline-none bg-transparent"
            />
            {draft && (
              <button onClick={() => { setDraft(''); onSearch('') }} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={submit}
            className="px-6 py-3 rounded-2xl font-bold text-sm shadow-xl transition-all hover:opacity-90 active:scale-95 text-white flex-shrink-0"
            style={{ backgroundColor: config.secondary_color }}
          >
            Buscar
          </button>
        </div>

        {/* Stats */}
        {stats.total > 0 && (
          <div className="flex flex-wrap gap-6 mb-10">
            {[
              { value: stats.total, label: 'propiedades' },
              { value: stats.projects, label: 'proyectos' },
              { value: stats.locations, label: 'ubicaciones' },
            ].map(s => (
              <div key={s.label} className="text-white/90">
                <span className="text-2xl font-extrabold">{s.value}</span>
                <span className="text-sm ml-1.5 opacity-80">{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Featured property cards */}
        {heroRecords.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {heroRecords.slice(0, 4).map(r => (
              <HeroCard key={r.id} record={r} primaryColor={config.primary_color} secondaryColor={config.secondary_color} />
            ))}
          </div>
        )}
      </div>
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
          <X className="w-3.5 h-3.5" />
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
  const { user, token, logout, refresh } = useAuth()
  const [showAuth, setShowAuth] = useState(false)
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login')
  const [config, setConfig] = useState<SiteConfig | null>(null)
  const [heroRecords, setHeroRecords] = useState<HeroRecord[]>([])
  const [catalog, setCatalog] = useState<CatalogResponse>({ total: 0, items: [], locations: [], projects: [] })
  const [search, setSearch] = useState('')
  const [location, setLocation] = useState('')
  const [projectId, setProjectId] = useState('')
  const [skip, setSkip] = useState(0)
  const [loadingCfg, setLoadingCfg] = useState(true)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const catalogRef = useRef<HTMLElement>(null)

  // ── Map view state ──
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [mapItems, setMapItems] = useState<MapCatalogRecord[]>([])
  const [loadingMap, setLoadingMap] = useState(false)
  const [mapDetailRecord, setMapDetailRecord] = useState<CatalogRecord | null>(null)

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
    if (search) params.search = search
    if (location) params.location = location
    if (projectId) params.project_id = projectId
    API.get('/public/catalog', { params })
      .then(r => setCatalog(r.data))
      .catch(() => {})
      .finally(() => setLoadingCatalog(false))
  }, [config, search, location, projectId, skip])

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
      <nav className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: config.primary_color }}>
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-800 text-base">{config.logo_text || config.site_name}</span>
          </div>

          <div className="flex-1" />

          <button
            onClick={scrollToCatalog}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors hidden sm:block"
          >
            Ver propiedades
          </button>

          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600 hidden sm:block truncate max-w-[120px]">
                <User className="w-3.5 h-3.5 inline mr-1 text-slate-400" />{user.name || user.email}
              </span>
              <button onClick={logout} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <LogIn className="w-4 h-4" />
              Ingresar
            </button>
          )}
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      {config.show_hero !== false && (
        <HeroBanner
          config={config}
          heroRecords={heroRecords}
          stats={stats}
          onSearch={handleSearch}
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
                <Search className="w-3 h-3" />"{search}"
                <button onClick={() => handleSearch('')} className="hover:text-blue-900"><X className="w-3 h-3" /></button>
              </span>
            )}
            {location && (
              <span className="flex items-center gap-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-full">
                <MapPin className="w-3 h-3" />{location}
                <button onClick={() => handleFilter('', projectId)} className="hover:text-emerald-900"><X className="w-3 h-3" /></button>
              </span>
            )}
            {projectId && (
              <span className="flex items-center gap-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-full">
                <Building2 className="w-3 h-3" />{catalog.projects.find(p => p.id === projectId)?.name || projectId}
                <button onClick={() => handleFilter(location, '')} className="hover:text-indigo-900"><X className="w-3 h-3" /></button>
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
                  <Filter className="w-8 h-8" style={{ color: config.primary_color }} />
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
