import { useState, useRef, useEffect } from 'react'
import {
  MessageCircle, X, Send, Star, ChevronRight, ChevronLeft,
  Heart, Building2, MapPin, BedDouble, Bath, Maximize2, Paperclip,
  GalleryHorizontal, DollarSign, Eye,
} from 'lucide-react'
import {
  createWebChatSession,
  sendWebChatMessage,
  uploadWebChatAttachment,
} from '../../services/api'

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface CardField { key: string; label: string; type: string }
interface PropertyCard {
  index: number
  total: number
  record_id: string
  property_identifier?: string
  seen_by_user_before?: boolean | null
  data: Record<string, unknown>
}
interface Message {
  role: 'user' | 'assistant'
  content: string
  card: PropertyCard | null
  quick_replies?: string[]
}
interface SiteUser { id: string; email: string; name: string | null }
interface OutgoingPayload {
  content?: string
  attachment_urls?: string[]
  financial_document_url?: string
}

interface Props {
  buttonLabel?: string
  primaryColor?: string
  secondaryColor?: string
  cardFields?: CardField[]
  user?: SiteUser | null
  token?: string | null
  onRequestAuth?: (tab: 'login' | 'register') => void
}

// â”€â”€â”€ Image extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)(\?.*)?$/i
const HTTP = /^https?:\/\//
const IMAGE_KEY = /image|foto|photo|img|picture|thumbnail|portada|cover|banner|galeria|gallery|slider|src/i

const MEDIA_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api').replace(/\/api\/?$/, '')
const isMediaPath = (v: unknown): v is string => typeof v === 'string' && v.startsWith('/media/')
const toMediaUrl = (path: string) => `${MEDIA_BASE}${path}`

function extractAllImages(data: Record<string, unknown>): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  function walk(val: unknown, key = '') {
    if (!val) return
    if (typeof val === 'string') {
      let url: string | null = null
      if (isMediaPath(val)) {
        url = toMediaUrl(val)
      } else if (HTTP.test(val) && (IMAGE_EXT.test(val) || IMAGE_KEY.test(key))) {
        url = val
      }
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

// â”€â”€â”€ Field categorization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ROLE: Record<string, string> = {
  name: 'title', nombre: 'title', proyecto: 'title', project_name: 'title',
  title: 'title', titulo: 'title', proyecto_nombre: 'title',
  price: 'price', precio: 'price', price_range: 'price', rango_precio: 'price',
  costo: 'price', valor: 'price', monto: 'price',
  location: 'location', ubicacion: 'location', district: 'location',
  district_name: 'location', zona: 'location', direccion: 'location',
  address: 'location', ciudad: 'location', barrio: 'location', sector: 'location',
  bedrooms: 'bedrooms', dormitorios: 'bedrooms', habitaciones: 'bedrooms',
  rooms: 'bedrooms', dorms: 'bedrooms', cuartos: 'bedrooms',
  bathrooms: 'bathrooms', banos: 'bathrooms', baths: 'bathrooms', wc: 'bathrooms',
  area: 'area', m2: 'area', size: 'area', sqft: 'area',
  metros: 'area', superficie: 'area', metraje: 'area', area_m2: 'area',
  description: 'desc', descripcion: 'desc', "descripci\u00f3n": 'desc',
  details: 'desc', detalles: 'desc', info: 'desc', information: 'desc', sobre: 'desc',
  caracteristicas: 'desc', "caracter\u00edsticas": 'desc', resumen: 'desc', acerca: 'desc',
}

interface TF { key: string; label: string; value: string; role: string }
interface LF { key: string; label: string; values: string[] }

function humanize(k: string) {
  return k.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()
    .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function extractFields(data: Record<string, unknown>, images: string[]) {
  // images contains full URLs (media paths already converted); we also need to
  // detect raw /media/... paths in the data to exclude them from text fields.
  const imgUrlSet = new Set(images)
  const text: TF[] = []
  const lists: LF[] = []

  const isImgValue = (v: string) =>
    isMediaPath(v) || imgUrlSet.has(v) || imgUrlSet.has(toMediaUrl(v)) || (HTTP.test(v) && IMAGE_EXT.test(v))

  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined) continue
    const keyL = key.toLowerCase()

    if (typeof val === 'string') {
      if (!val.trim()) continue
      if (isImgValue(val)) continue
      text.push({ key, label: humanize(key), value: val.trim(), role: ROLE[keyL] || 'other' })
    } else if (typeof val === 'number') {
      text.push({ key, label: humanize(key), value: String(val), role: ROLE[keyL] || 'other' })
    } else if (typeof val === 'boolean') {
      text.push({ key, label: humanize(key), value: val ? 'Sí' : 'No', role: 'other' })
    } else if (Array.isArray(val)) {
      const items = val.filter(i => typeof i === 'string' && i.trim() && !isImgValue(i)).map(String)
      if (items.length) lists.push({ key, label: humanize(key), values: items })
    }
  }

  const roleOrder = ['title', 'price', 'location', 'bedrooms', 'bathrooms', 'area', 'desc', 'other']
  text.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role))
  return { text, lists }
}

// â”€â”€â”€ Lightbox â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Lightbox({ images, start, onClose }: { images: string[]; start: number; onClose: () => void }) {
  const [cur, setCur] = useState(start)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setCur(c => Math.max(0, c - 1))
      if (e.key === 'ArrowRight') setCur(c => Math.min(images.length - 1, c + 1))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [images.length, onClose])

  return (
    <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col" onClick={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-white">
          <GalleryHorizontal className="w-4 h-4 opacity-60" />
          <span className="text-sm opacity-80">{cur + 1} / {images.length}</span>
        </div>
        <button onClick={onClose} className="text-white/60 hover:text-white p-1 transition-colors">
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Main image */}
      <div className="flex-1 flex items-center justify-center relative min-h-0 px-12" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setCur(c => Math.max(0, c - 1))}
          disabled={cur === 0}
          className="absolute left-3 p-2 bg-white/10 hover:bg-white/20 disabled:opacity-20 rounded-full text-white transition-colors"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <img
          key={cur}
          src={images[cur]}
          alt=""
          className="max-h-full max-w-full object-contain rounded-lg"
        />
        <button
          onClick={() => setCur(c => Math.min(images.length - 1, c + 1))}
          disabled={cur === images.length - 1}
          className="absolute right-3 p-2 bg-white/10 hover:bg-white/20 disabled:opacity-20 rounded-full text-white transition-colors"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="flex gap-2 px-4 py-3 overflow-x-auto flex-shrink-0" onClick={e => e.stopPropagation()}>
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setCur(i)}
              className={`flex-shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-all ${i === cur ? 'border-white scale-105' : 'border-transparent opacity-50 hover:opacity-80'}`}
            >
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// â”€â”€â”€ Image Carousel (inside card) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ImageCarousel({ images, onOpen }: { images: string[]; onOpen: (i: number) => void }) {
  const [cur, setCur] = useState(0)

  if (images.length === 0) return null

  if (images.length === 1) {
    return (
      <div className="relative h-48 cursor-zoom-in group" onClick={() => onOpen(0)}>
        <img src={images[0]} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 flex items-center justify-center transition-colors">
          <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 drop-shadow transition-opacity" />
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Main image */}
      <div className="relative h-48 cursor-zoom-in group" onClick={() => onOpen(cur)}>
        <img src={images[cur]} alt="" className="w-full h-full object-cover transition-opacity" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />

        {/* Counter badge */}
        <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
          <GalleryHorizontal className="w-3 h-3" />
          {cur + 1}/{images.length}
        </div>

        {/* Arrows */}
        <button
          onClick={e => { e.stopPropagation(); setCur(c => Math.max(0, c - 1)) }}
          disabled={cur === 0}
          className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-20 text-white rounded-full p-1 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={e => { e.stopPropagation(); setCur(c => Math.min(images.length - 1, c + 1)) }}
          disabled={cur === images.length - 1}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-20 text-white rounded-full p-1 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Thumbnail strip */}
      <div className="flex gap-1.5 px-2 py-2 bg-slate-50 overflow-x-auto">
        {images.map((img, i) => (
          <button
            key={i}
            onClick={() => setCur(i)}
            className={`flex-shrink-0 w-14 h-10 rounded overflow-hidden border-2 transition-all ${i === cur ? 'border-blue-500 scale-105' : 'border-transparent opacity-60 hover:opacity-90'}`}
          >
            <img src={img} alt="" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}

// â”€â”€â”€ Star Rating â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function StarRating({ rating, onChange }: { rating: number; onChange: (r: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <button
          key={s}
          onClick={() => onChange(s)}
          onMouseEnter={() => setHover(s)}
          onMouseLeave={() => setHover(0)}
          className="transition-transform hover:scale-125 focus:outline-none"
        >
          <Star
            className="w-6 h-6 transition-colors"
            fill={(hover || rating) >= s ? '#f59e0b' : 'none'}
            stroke={(hover || rating) >= s ? '#f59e0b' : '#cbd5e1'}
          />
        </button>
      ))}
      {rating > 0 && <span className="ml-1.5 text-xs text-amber-600 font-semibold">{rating}/5</span>}
    </div>
  )
}

// â”€â”€â”€ Full Property Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function PropertyCardView({
  card, cardFields, primaryColor, secondaryColor, onNext, onInterested, onRate, readonly,
}: {
  card: PropertyCard
  cardFields: CardField[]
  primaryColor: string
  secondaryColor: string
  onNext: () => void
  onInterested: (r: number) => void
  onRate?: (r: number) => void
  readonly?: boolean
}) {
  const [rating, setRating] = useState(0)
  const [lightboxStart, setLightboxStart] = useState<number | null>(null)
  const rateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const images = extractAllImages(card.data)
  const { text, lists } = extractFields(card.data, images)

  const titleF = text.find(f => f.role === 'title')
  const priceF = text.find(f => f.role === 'price')
  const locF = text.find(f => f.role === 'location')
  const bedsF = text.find(f => f.role === 'bedrooms')
  const bathF = text.find(f => f.role === 'bathrooms')
  const areaF = text.find(f => f.role === 'area')
  const descFields = text.filter(f => f.role === 'desc')
  const otherFields = text.filter(f => f.role === 'other')
  const propertyIdentifier = card.property_identifier || card.record_id
  const seenFlag = card.seen_by_user_before
  const seenLabel = seenFlag === null || seenFlag === undefined
    ? 'Estado de vista: no disponible'
    : seenFlag
      ? 'Ya vista por ti'
      : 'Nueva para ti'

  return (
    <>
      {/* Lightbox (portal-like, fixed overlay) */}
      {lightboxStart !== null && (
        <Lightbox images={images} start={lightboxStart} onClose={() => setLightboxStart(null)} />
      )}

      <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-lg bg-white">
        {/* Progress bar */}
        <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: primaryColor + '18' }}>
          <span className="text-xs font-bold" style={{ color: primaryColor }}>
            {card.index} / {card.total}
          </span>
          <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${(card.index / card.total) * 100}%`, backgroundColor: primaryColor }}
            />
          </div>
          {images.length > 0 && (
            <span className="text-xs text-slate-400 flex items-center gap-0.5">
              <GalleryHorizontal className="w-3 h-3" />
              {images.length}
            </span>
          )}
        </div>

        {/* Property meta */}
        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/70 space-y-1">
          <p className="text-[11px] text-slate-500">
            ID propiedad: <span className="font-mono text-slate-700 break-all">{propertyIdentifier}</span>
          </p>
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-slate-400" />
            {seenLabel}
          </p>
        </div>

        {/* Images */}
        {images.length > 0 ? (
          <ImageCarousel images={images} onOpen={i => setLightboxStart(i)} />
        ) : (
          <div className="h-24 flex items-center justify-center" style={{ backgroundColor: primaryColor + '10' }}>
            <Building2 className="w-10 h-10 opacity-20" style={{ color: primaryColor }} />
          </div>
        )}

        {/* Main info */}
        <div className="px-4 pt-3 pb-1 space-y-0.5">
          {titleF && <h3 className="font-bold text-slate-800 text-base leading-snug">{titleF.value}</h3>}
          {priceF && (
            <div className="flex items-center gap-1 pt-0.5">
              <DollarSign className="w-4 h-4 flex-shrink-0" style={{ color: secondaryColor }} />
              <span className="font-bold text-lg leading-none" style={{ color: secondaryColor }}>{priceF.value}</span>
            </div>
          )}
        </div>

        {/* Key metrics row */}
        {(locF || bedsF || bathF || areaF) && (
          <div className="px-4 pb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {locF && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />{locF.value}
              </span>
            )}
            {bedsF && (
              <span className="flex items-center gap-1">
                <BedDouble className="w-3.5 h-3.5 text-slate-400" />{bedsF.value} dorms.
              </span>
            )}
            {bathF && (
              <span className="flex items-center gap-1">
                <Bath className="w-3.5 h-3.5 text-slate-400" />{bathF.value} baños
              </span>
            )}
            {areaF && (
              <span className="flex items-center gap-1">
                <Maximize2 className="w-3.5 h-3.5 text-slate-400" />{areaF.value}
              </span>
            )}
          </div>
        )}

        {/* Description fields */}
        {descFields.length > 0 && (
          <div className="px-4 pb-2 space-y-2">
            {descFields.map(f => (
              <div key={f.key}>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-medium mb-0.5">{f.label}</p>
                <p className="text-xs text-slate-600 leading-relaxed break-words">{f.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Lists / arrays â†’ chips */}
        {lists.length > 0 && (
          <div className="px-4 pb-2 space-y-1.5">
            {lists.map(l => (
              <div key={l.key}>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-medium mb-1">{l.label}</p>
                <div className="flex flex-wrap gap-1">
                  {l.values.map((v, i) => (
                    <span
                      key={i}
                      className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: primaryColor + '15', color: primaryColor }}
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Other fields â€” single column, full text */}
        {otherFields.length > 0 && (
          <div className="px-4 pb-2 border-t border-slate-100 pt-2 space-y-2">
            {otherFields.map(f => (
              <div key={f.key}>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">{f.label}</p>
                <p className="text-xs text-slate-700 leading-relaxed break-words">{f.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Empty fallback */}
        {!titleF && !priceF && !locF && descFields.length === 0 && lists.length === 0 && otherFields.length === 0 && (
          <p className="px-4 pb-2 text-xs text-slate-400 italic">Sin datos adicionales.</p>
        )}

        {!readonly && (
          <>
            {/* Star rating */}
            <div className="px-4 pb-2 pt-2 border-t border-slate-100">
              <p className="text-xs text-slate-400 mb-1.5">¿Qué te parece?</p>
              <StarRating
                rating={rating}
                onChange={r => {
                  setRating(r)
                  if (onRate) {
                    if (rateTimerRef.current) clearTimeout(rateTimerRef.current)
                    rateTimerRef.current = setTimeout(() => onRate(r), 800)
                  }
                }}
              />
            </div>

            {/* Action buttons */}
            <div className="px-4 pb-4 pt-1 flex gap-2">
              <button
                onClick={onNext}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors font-medium"
              >
                Ver siguiente <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => onInterested(rating)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors"
                style={{ backgroundColor: secondaryColor }}
              >
                <Heart className="w-4 h-4" /> Lo quiero
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}

// â”€â”€â”€ Markdown-lite renderer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Md({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

// â”€â”€â”€ Main Widget â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function ChatWidget({
  buttonLabel = '¿Necesitas ayuda?',
  primaryColor = '#2563eb',
  secondaryColor = '#059669',
  cardFields = [],
  user,
  token,
  onRequestAuth,
}: Props) {
  const [open, setOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [state, setState] = useState('collecting_info')
  const [showRegBanner, setShowRegBanner] = useState(false)
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [attachmentError, setAttachmentError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
  const ALLOWED_ATTACHMENT_MIME_PREFIXES = ['image/']
  const ALLOWED_ATTACHMENT_MIME = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/rtf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.oasis.opendocument.text',
  ])

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [messages, loading])

  const startSession = async () => {
    if (sessionId) return
    setInitializing(true)
    try {
      const res = await createWebChatSession(token)
      setSessionId(res.data.session_id)
      setState(res.data.state)
      setMessages([{ role: 'assistant', content: res.data.message, card: res.data.card, quick_replies: res.data.quick_replies || [] }])
    } catch {
      setMessages([{ role: 'assistant', content: 'Error al iniciar la sesión. Recarga la página.', card: null, quick_replies: [] }])
    } finally {
      setInitializing(false)
    }
  }

  const handleOpen = () => {
    setOpen(true)
    if (!sessionId) startSession()
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  const sendRaw = async (payload: OutgoingPayload) => {
    if (!sessionId || loading || uploading) return
    setLoading(true)
    try {
      const res = await sendWebChatMessage(sessionId, payload, token)
      setMessages(m => {
        const preludes: Message[] = (res.data.prelude_messages || []).map((content: string) => ({
          role: 'assistant' as const,
          content,
          card: null,
          quick_replies: [],
        }))
        const main: Message = { role: 'assistant', content: res.data.message, card: res.data.card, quick_replies: res.data.quick_replies || [] }
        if (res.data.card && !user && !showRegBanner) setShowRegBanner(true)
        return [...m, ...preludes, main]
      })
      setState(res.data.state)
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Ocurrió un error. Intenta nuevamente.', card: null, quick_replies: [] }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const isAllowedAttachment = (file: File) => {
    const mime = (file.type || '').toLowerCase()
    return (
      ALLOWED_ATTACHMENT_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))
      || ALLOWED_ATTACHMENT_MIME.has(mime)
    )
  }

  const onAttachmentPick = (file: File | null) => {
    setAttachmentError('')
    if (!file) {
      setAttachmentFile(null)
      return
    }
    if (!isAllowedAttachment(file)) {
      setAttachmentFile(null)
      setAttachmentError('Tipo de archivo no permitido. Usa imagen o documento.')
      return
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachmentFile(null)
      setAttachmentError('El archivo supera 10 MB.')
      return
    }
    setAttachmentFile(file)
  }

  const clearAttachment = () => {
    setAttachmentFile(null)
    setAttachmentError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const shouldMarkAsFinancialDoc = () => {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    const contextText = String(lastAssistant?.content || '').toLowerCase()
    return /sustento|capacidad de compra|capacidad financiera|preaprob|credito aprobado|ayuda social/.test(contextText)
  }

  const uploadAttachmentIfAny = async (): Promise<{ attachmentUrls: string[]; financialDocumentUrl?: string }> => {
    if (!sessionId || !attachmentFile) return { attachmentUrls: [] }
    setUploading(true)
    try {
      const res = await uploadWebChatAttachment(sessionId, attachmentFile)
      const url = String(res.data?.attachment_url || '').trim()
      if (!url) throw new Error('missing attachment_url')
      const kind = String(res.data?.kind || '')
      const isLikelyFinancial = kind === 'document' && (
        shouldMarkAsFinancialDoc()
        || /capacidad|sustento|credito|crédito|preaprob|ayuda social|financ/i.test(input)
      )
      return {
        attachmentUrls: [url],
        financialDocumentUrl: isLikelyFinancial ? url : undefined,
      }
    } finally {
      setUploading(false)
    }
  }

  const send = async () => {
    const text = input.trim()
    if ((!text && !attachmentFile) || !sessionId || loading || uploading || state === 'contact_requested') return
    let attachmentUrls: string[] = []
    let financialDocumentUrl: string | undefined
    if (attachmentFile) {
      try {
        const uploaded = await uploadAttachmentIfAny()
        attachmentUrls = uploaded.attachmentUrls
        financialDocumentUrl = uploaded.financialDocumentUrl
      } catch {
        setAttachmentError('No se pudo subir el archivo. Intenta nuevamente.')
        return
      }
    }
    const userBubbleParts = [text]
    if (attachmentFile?.name) userBubbleParts.push(`[Adjunto] ${attachmentFile.name}`)
    const userBubbleText = userBubbleParts.filter(Boolean).join('\n').trim()
    setInput('')
    clearAttachment()
    setMessages(m => [...m, { role: 'user', content: userBubbleText || 'Adjunto archivo', card: null }])
    await sendRaw({
      content: text,
      attachment_urls: attachmentUrls,
      financial_document_url: financialDocumentUrl,
    })
  }

  const handleNext = () => {
    setMessages(m => [...m, { role: 'user', content: 'Ver siguiente', card: null }])
    sendRaw({ content: 'ver siguiente' })
  }

  const handleRate = (rating: number) => {
    if (!sessionId || loading || uploading) return
    const text = `Le doy ${rating} estrella${rating === 1 ? '' : 's'}`
    setMessages(m => [...m, { role: 'user', content: text, card: null }])
    sendRaw({ content: text })
  }

  const handleInterested = (_rating: number) => {
    const text = 'Lo quiero'
    setMessages(m => [...m, { role: 'user', content: text, card: null }])
    sendRaw({ content: text })
  }

  const handleQuickReply = (text: string) => {
    if (!text || !sessionId || loading || uploading) return
    setMessages(m => [...m, { role: 'user', content: text, card: null }])
    sendRaw({ content: text })
  }

  const isDone = state === 'contact_requested'
  const lastIdx = messages.length - 1

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={handleOpen}
          style={{ backgroundColor: primaryColor }}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-5 py-3 rounded-full text-white shadow-xl hover:opacity-90 active:scale-95 transition-all text-sm font-semibold"
        >
          <MessageCircle className="w-5 h-5 flex-shrink-0" />
          {buttonLabel}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[460px] max-h-[720px] flex flex-col rounded-2xl shadow-2xl bg-white border border-slate-200 overflow-hidden">
          {/* Header */}
          <div style={{ backgroundColor: primaryColor }} className="flex items-center justify-between px-5 py-3.5 flex-shrink-0">
            <div className="flex items-center gap-3 text-white">
              <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center">
                <MessageCircle className="w-4.5 h-4.5" />
              </div>
              <div>
                <p className="font-bold text-sm leading-tight">Asistente inmobiliario</p>
                <p className="text-[11px] text-white/70">En línea</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/60 hover:text-white p-1 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 bg-slate-50">
            {/* Session init spinner */}
            {initializing && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <div
                  className="w-9 h-9 rounded-full border-4 animate-spin"
                  style={{
                    borderColor: `${primaryColor}25`,
                    borderTopColor: primaryColor,
                  }}
                />
                <p className="text-xs text-slate-400">Iniciando conversación...</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className="space-y-2">
                {msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div
                      className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-sm text-sm text-white leading-relaxed"
                      style={{ backgroundColor: primaryColor }}
                    >
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Bot text bubble */}
                    <div className="flex justify-start">
                      <div className="max-w-[88%] px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm bg-white text-slate-700 shadow-sm border border-slate-100 leading-relaxed">
                        <Md text={msg.content} />
                      </div>
                    </div>

                    {/* Property card (if present) */}
                    {msg.card && (
                      <PropertyCardView
                        card={msg.card}
                        cardFields={cardFields}
                        primaryColor={primaryColor}
                        secondaryColor={secondaryColor}
                        onNext={handleNext}
                        onInterested={handleInterested}
                        onRate={handleRate}
                        readonly={i !== lastIdx || isDone}
                      />
                    )}
                    {i === lastIdx && !loading && !uploading && (msg.quick_replies || []).length > 0 && (
                      <div className="flex flex-wrap gap-2 pl-1">
                        {(msg.quick_replies || []).slice(0, 4).map((opt, idx) => (
                          <button
                            key={`${i}-${idx}-${opt}`}
                            onClick={() => handleQuickReply(opt)}
                            className="px-3 py-1.5 text-xs rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            {/* Typing indicator */}
            {(loading || uploading) && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-100 shadow-sm px-4 py-3 rounded-2xl rounded-bl-sm">
                  <div className="flex items-center gap-1.5">
                    {[0, 150, 300].map(d => (
                      <div
                        key={d}
                        className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            {/* Registration suggestion banner */}
            {showRegBanner && !user && onRequestAuth && (
              <div className="relative mx-1 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
                <button
                  onClick={() => setShowRegBanner(false)}
                  className="absolute top-2 right-2 text-slate-300 hover:text-slate-500 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <p className="text-xs text-slate-700 leading-relaxed pr-4">
                  <span className="font-semibold text-slate-800">Guarda tus preferencias</span> — Regístrate para recibir novedades de propiedades que se ajusten a lo que buscas.
                </p>
                <div className="flex gap-2 mt-2.5">
                  <button
                    onClick={() => onRequestAuth('register')}
                    className="flex-1 py-1.5 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ backgroundColor: primaryColor }}
                  >
                    Registrarme
                  </button>
                  <button
                    onClick={() => onRequestAuth('login')}
                    className="flex-1 py-1.5 rounded-xl text-xs font-medium border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-colors"
                  >
                    Ya tengo cuenta
                  </button>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 bg-white p-3 flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.txt,.rtf,.xls,.xlsx,.csv,.odt"
              onChange={e => onAttachmentPick(e.target.files?.[0] || null)}
            />
            {attachmentFile && (
              <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 bg-slate-50">
                <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                <span className="max-w-[250px] truncate">{attachmentFile.name}</span>
                <button
                  onClick={clearAttachment}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                  disabled={loading || uploading || isDone}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {attachmentError && (
              <p className="mb-2 text-[11px] text-rose-500">{attachmentError}</p>
            )}
            <div className="flex items-end gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || uploading || isDone}
                className="flex-shrink-0 w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-40 transition-opacity"
                title="Adjuntar archivo"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={isDone ? 'Conversación finalizada' : 'Escribe un mensaje o adjunta un archivo...'}
                disabled={isDone || loading || uploading}
                rows={1}
                className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 max-h-28 overflow-y-auto"
                style={{ lineHeight: '1.5', '--tw-ring-color': primaryColor } as React.CSSProperties}
              />
              <button
                onClick={send}
                disabled={(!input.trim() && !attachmentFile) || loading || uploading || isDone}
                className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white disabled:opacity-40 transition-opacity"
                style={{ backgroundColor: primaryColor }}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

