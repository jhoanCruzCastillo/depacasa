import { useState, useEffect, useRef } from 'react'
import { Search, ChevronLeft, ChevronRight, Building2, LogIn, LogOut, User, X } from 'lucide-react'
import ChatWidget from '../../components/chat/ChatWidget'
import AuthModal from '../../components/auth/AuthModal'
import { useAuth } from '../../hooks/useAuth'
import API from '../../services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CardField {
  key: string
  label: string
  type: 'title' | 'price' | 'text' | 'badge' | 'image' | 'link'
}

interface SiteConfig {
  site_name: string
  tagline: string | null
  primary_color: string
  secondary_color: string
  logo_text: string | null
  show_hero: boolean
  hero_title: string
  hero_subtitle: string | null
  hero_cta_text: string
  hero_bg_color: string
  show_carousel: boolean
  carousel_title: string
  carousel_field_image: string
  show_listing: boolean
  listing_title: string
  listing_columns: string
  footer_text: string | null
  footer_contact: string | null
  card_fields: CardField[]
  chatbot_enabled: boolean
  chatbot_button_label: string
}

interface PublicRecord {
  id: string
  data: Record<string, unknown>
  scraped_at: string | null
}

interface TextEntry {
  key: string
  label: string
  value: string
  isArray: boolean
  items?: string[]
}

// ─── Image detection helpers ──────────────────────────────────────────────────

const MEDIA_BASE_PUB = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api').replace(/\/api\/?$/, '')
const IMG_EXT_RE = /\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)(\?.*)?$/i
const IMG_KEY_RE = /image|foto|photo|img|picture|thumbnail|portada|cover|banner|galeria|gallery|slider/i
const HTTP_RE = /^https?:\/\//

function toFullUrl(val: string): string {
  return val.startsWith('/media/') ? `${MEDIA_BASE_PUB}${val}` : val
}

function isImgValue(val: string, imgSet: Set<string>): boolean {
  const full = toFullUrl(val)
  return val.startsWith('/media/') || imgSet.has(val) || imgSet.has(full) || (HTTP_RE.test(val) && IMG_EXT_RE.test(val))
}

function detectImages(data: Record<string, unknown>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  function walk(val: unknown, key = '') {
    if (!val) return
    if (typeof val === 'string') {
      let url: string | null = null
      if (val.startsWith('/media/')) url = toFullUrl(val)
      else if (HTTP_RE.test(val) && (IMG_EXT_RE.test(val) || IMG_KEY_RE.test(key))) url = val
      if (url && !seen.has(url)) { seen.add(url); out.push(url) }
    } else if (Array.isArray(val)) {
      val.forEach(item => walk(item, key))
    } else if (typeof val === 'object') {
      Object.entries(val as Record<string, unknown>).forEach(([k, v]) => walk(v, k))
    }
  }
  Object.entries(data).forEach(([k, v]) => walk(v, k))
  return out
}

function humanizeKey(k: string) {
  return k.replace(/_/g, ' ').split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function detectTextEntries(data: Record<string, unknown>, images: string[]): TextEntry[] {
  const imgSet = new Set(images)
  const results: TextEntry[] = []
  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined) continue
    const label = humanizeKey(key)
    if (typeof val === 'string') {
      if (!val.trim() || isImgValue(val, imgSet)) continue
      results.push({ key, label, value: val.trim(), isArray: false })
    } else if (typeof val === 'number') {
      results.push({ key, label, value: String(val), isArray: false })
    } else if (Array.isArray(val)) {
      const items = val.filter(i => typeof i === 'string' && i.trim() && !isImgValue(i, imgSet)).map(String)
      if (items.length) results.push({ key, label, value: items.join(', '), isArray: true, items })
    }
  }
  return results
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ColsClass(cols: string) {
  if (cols === '2') return 'grid-cols-1 sm:grid-cols-2'
  if (cols === '4') return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
}

// ─── MiniCarousel (inside card) ───────────────────────────────────────────────

function MiniCarousel({ images, primaryColor }: { images: string[]; primaryColor: string }) {
  const [cur, setCur] = useState(0)

  if (images.length === 0) {
    return (
      <div className="h-44 flex items-center justify-center" style={{ backgroundColor: primaryColor + '12' }}>
        <Building2 className="w-10 h-10" style={{ color: primaryColor + '60' }} />
      </div>
    )
  }

  return (
    <div className="relative h-44 overflow-hidden bg-slate-100 group">
      <img src={images[cur]} alt="" className="w-full h-full object-cover" />

      {images.length > 1 && (
        <>
          <div className="absolute top-2 right-2 bg-black/50 text-white text-[11px] px-1.5 py-0.5 rounded-full">
            {cur + 1}/{images.length}
          </div>
          <button
            onClick={e => { e.stopPropagation(); setCur(c => Math.max(0, c - 1)) }}
            disabled={cur === 0}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-0 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); setCur(c => Math.min(images.length - 1, c + 1)) }}
            disabled={cur === images.length - 1}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-0 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          {/* Dot indicators */}
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={e => { e.stopPropagation(); setCur(i) }}
                className={`w-1.5 h-1.5 rounded-full transition-all ${i === cur ? 'bg-white scale-125' : 'bg-white/50'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── PropertyModal ────────────────────────────────────────────────────────────

function PropertyModal({ images, entries, primaryColor, secondaryColor, onClose }: {
  images: string[]
  entries: TextEntry[]
  primaryColor: string
  secondaryColor: string
  onClose: () => void
}) {
  const [cur, setCur] = useState(0)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const titleEntry = entries.find(e => /nombre|name|proyecto|titulo|title/i.test(e.key))
  const priceEntry = entries.find(e => /precio|price|costo|valor|monto/i.test(e.key))
  const others = entries.filter(e => e !== titleEntry && e !== priceEntry)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 flex-shrink-0">
          <h3 className="font-bold text-slate-800 text-base truncate">
            {titleEntry?.value || 'Detalles de la propiedad'}
          </h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0 ml-3">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Image carousel */}
          {images.length > 0 && (
            <div className="relative h-64 bg-slate-100 flex-shrink-0">
              <img src={images[cur]} alt="" className="w-full h-full object-cover" />
              {images.length > 1 && (
                <>
                  <div className="absolute top-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
                    {cur + 1} / {images.length}
                  </div>
                  <button
                    onClick={() => setCur(c => Math.max(0, c - 1))}
                    disabled={cur === 0}
                    className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-20 text-white rounded-full p-2 transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setCur(c => Math.min(images.length - 1, c + 1))}
                    disabled={cur === images.length - 1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-20 text-white rounded-full p-2 transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
                    {images.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCur(i)}
                        className={`w-2 h-2 rounded-full transition-all ${i === cur ? 'bg-white scale-125' : 'bg-white/50'}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Fields */}
          <div className="p-5 space-y-1">
            {priceEntry && (
              <p className="font-bold text-2xl mb-3" style={{ color: secondaryColor }}>
                {priceEntry.value}
              </p>
            )}
            {others.map(e => (
              <div key={e.key} className="flex gap-3 items-start py-2 border-b border-slate-50 last:border-0">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-32 flex-shrink-0 pt-0.5">
                  {e.label}
                </span>
                <span className="text-sm text-slate-700 flex-1 leading-relaxed break-words">
                  {e.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Property Card ─────────────────────────────────────────────────────────────

const PREVIEW_FIELDS = 4

function PropertyCard({ record, fields, primaryColor, secondaryColor }: {
  record: PublicRecord
  fields: CardField[]
  primaryColor: string
  secondaryColor: string
}) {
  const [showModal, setShowModal] = useState(false)

  const images = detectImages(record.data)
  const allEntries = detectTextEntries(record.data, images)

  const titleKey = fields.find(f => f.type === 'title')?.key
  const priceKey = fields.find(f => f.type === 'price')?.key

  const titleEntry = allEntries.find(e => e.key === titleKey)
    || allEntries.find(e => /nombre|name|proyecto|titulo|title/i.test(e.key))
  const priceEntry = allEntries.find(e => e.key === priceKey)
    || allEntries.find(e => /precio|price|costo|valor|monto/i.test(e.key))

  const specialKeys = new Set([titleEntry?.key, priceEntry?.key].filter(Boolean) as string[])
  const otherEntries = allEntries.filter(e => !specialKeys.has(e.key))
  const previewEntries = otherEntries.slice(0, PREVIEW_FIELDS)

  return (
    <>
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 hover:shadow-md transition-shadow flex flex-col">
        {/* Image carousel */}
        <MiniCarousel images={images} primaryColor={primaryColor} />

        {/* Content */}
        <div className="p-4 flex flex-col flex-1 gap-2">
          {titleEntry && (
            <h3 className="font-bold text-slate-800 text-base leading-tight">{titleEntry.value}</h3>
          )}
          {priceEntry && (
            <p className="font-semibold text-lg leading-none" style={{ color: secondaryColor }}>
              {priceEntry.value}
            </p>
          )}

          {/* Characteristics */}
          {previewEntries.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-slate-50 flex-1">
              {previewEntries.map(e => (
                <div key={e.key} className="flex gap-2 text-xs">
                  <span className="text-slate-400 font-medium uppercase tracking-wide w-24 flex-shrink-0 truncate">
                    {e.label}
                  </span>
                  <span className="text-slate-600 flex-1 truncate">{e.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Ver detalles button */}
          <button
            onClick={() => setShowModal(true)}
            className="mt-auto w-full text-center text-xs font-semibold py-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
            style={{ borderColor: primaryColor + '40', color: primaryColor }}
          >
            Ver detalles →
          </button>
        </div>
      </div>

      {showModal && (
        <PropertyModal
          images={images}
          entries={allEntries}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}

// ─── Featured Carousel (horizontal strip at top) ───────────────────────────────

function FeaturedCarousel({ records, primaryColor }: {
  records: PublicRecord[]
  primaryColor: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = (dir: 'l' | 'r') => {
    ref.current?.scrollBy({ left: dir === 'l' ? -300 : 300, behavior: 'smooth' })
  }

  const featured = records.filter(r => detectImages(r.data).length > 0)
  if (featured.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => scroll('l')}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white shadow-md rounded-full p-2 hover:bg-slate-50 transition-colors -ml-4"
      >
        <ChevronLeft className="w-5 h-5 text-slate-600" />
      </button>
      <div ref={ref} className="flex gap-4 overflow-x-auto pb-2" style={{ scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}>
        {featured.map(record => {
          const imgs = detectImages(record.data)
          const entries = detectTextEntries(record.data, imgs)
          const titleEntry = entries.find(e => /nombre|name|proyecto|titulo|title/i.test(e.key))
          return (
            <div
              key={record.id}
              className="flex-shrink-0 w-72 rounded-2xl overflow-hidden shadow-sm relative"
              style={{ scrollSnapAlign: 'start' }}
            >
              <img src={imgs[0]} alt={titleEntry?.value || ''} className="w-full h-48 object-cover" />
              {titleEntry && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                  <p className="text-white font-semibold text-sm truncate">{titleEntry.value}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        onClick={() => scroll('r')}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white shadow-md rounded-full p-2 hover:bg-slate-50 transition-colors -mr-4"
      >
        <ChevronRight className="w-5 h-5 text-slate-600" />
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PublicSitePage() {
  const { user, token, logout } = useAuth()
  const [showAuth, setShowAuth] = useState(false)
  const [config, setConfig] = useState<SiteConfig | null>(null)
  const [records, setRecords] = useState<PublicRecord[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [loadingCfg, setLoadingCfg] = useState(true)
  const [loadingRec, setLoadingRec] = useState(true)

  const LIMIT = 12

  useEffect(() => {
    API.get('/public/config').then(r => setConfig(r.data)).finally(() => setLoadingCfg(false))
  }, [])

  useEffect(() => {
    setLoadingRec(true)
    API.get('/public/records', { params: { skip: page * LIMIT, limit: LIMIT, search: query } })
      .then(r => { setRecords(r.data.items); setTotal(r.data.total) })
      .finally(() => setLoadingRec(false))
  }, [page, query])

  const doSearch = () => { setPage(0); setQuery(search) }

  const scrollToListing = () => {
    document.getElementById('listing')?.scrollIntoView({ behavior: 'smooth' })
  }

  if (loadingCfg || !config) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Navbar */}
      <nav className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: config.primary_color }}>
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-800 text-base">
              {config.logo_text || config.site_name}
            </span>
          </div>
          {config.tagline && (
            <span className="hidden sm:block text-sm text-slate-400 italic">{config.tagline}</span>
          )}
          <div className="flex items-center gap-2">
            {config.show_listing && (
              <button
                onClick={scrollToListing}
                className="text-sm font-medium px-4 py-1.5 rounded-lg text-white transition-opacity hover:opacity-85"
                style={{ backgroundColor: config.primary_color }}
              >
                {config.listing_title}
              </button>
            )}
            {user ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-sm text-slate-600">
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="hidden sm:block max-w-[120px] truncate">{user.name || user.email}</span>
                </div>
                <button
                  onClick={logout}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:block">Salir</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                Ingresar
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      {config.show_hero && (
        <section
          className="relative flex flex-col items-center justify-center text-center px-4 py-24 sm:py-32"
          style={{ backgroundColor: config.hero_bg_color }}
        >
          <div className="absolute inset-0 bg-black/20" />
          <div className="relative z-10 max-w-3xl mx-auto space-y-5">
            <h1 className="text-3xl sm:text-5xl font-extrabold text-white leading-tight">
              {config.hero_title}
            </h1>
            {config.hero_subtitle && (
              <p className="text-lg sm:text-xl text-white/80 max-w-xl mx-auto">{config.hero_subtitle}</p>
            )}
            <button
              onClick={scrollToListing}
              className="inline-block mt-2 px-8 py-3 rounded-full text-white font-semibold text-base shadow-lg hover:opacity-90 transition-opacity"
              style={{ backgroundColor: config.secondary_color }}
            >
              {config.hero_cta_text}
            </button>
          </div>
        </section>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-14">
        {/* Featured carousel */}
        {config.show_carousel && records.length > 0 && (
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-5">{config.carousel_title}</h2>
            <FeaturedCarousel records={records} primaryColor={config.primary_color} />
          </section>
        )}

        {/* Listing */}
        {config.show_listing && (
          <section id="listing">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-800">{config.listing_title}</h2>
                <p className="text-sm text-slate-400 mt-0.5">{total} propiedad{total !== 1 ? 'es' : ''}</p>
              </div>
              <div className="flex gap-2">
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  placeholder="Buscar..."
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 w-56"
                  style={{ '--tw-ring-color': config.primary_color } as React.CSSProperties}
                />
                <button
                  onClick={doSearch}
                  className="p-2 rounded-lg text-white transition-opacity hover:opacity-85"
                  style={{ backgroundColor: config.primary_color }}
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>
            </div>

            {loadingRec ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : records.length === 0 ? (
              <div className="text-center py-20 text-slate-400">
                <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No se encontraron propiedades.</p>
              </div>
            ) : (
              <div className={`grid gap-5 ${ColsClass(config.listing_columns)}`}>
                {records.map(r => (
                  <PropertyCard
                    key={r.id}
                    record={r}
                    fields={config.card_fields}
                    primaryColor={config.primary_color}
                    secondaryColor={config.secondary_color}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors"
                >
                  Anterior
                </button>
                <span className="text-sm text-slate-500">
                  Página {page + 1} de {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors"
                >
                  Siguiente
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Footer */}
      {(config.footer_text || config.footer_contact) && (
        <footer className="mt-10 bg-slate-800 text-slate-400 text-sm py-8 px-4">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>{config.footer_text}</span>
            {config.footer_contact && <span>{config.footer_contact}</span>}
          </div>
        </footer>
      )}

      {/* Chatbot widget */}
      {config.chatbot_enabled && (
        <ChatWidget
          buttonLabel={config.chatbot_button_label}
          primaryColor={config.primary_color}
          secondaryColor={config.secondary_color}
          cardFields={config.card_fields}
          user={user}
          token={token}
        />
      )}

      {/* Auth modal */}
      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={() => setShowAuth(false)}
          primaryColor={config.primary_color}
        />
      )}
    </div>
  )
}
