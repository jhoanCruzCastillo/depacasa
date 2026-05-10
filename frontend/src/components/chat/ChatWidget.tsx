import { useState, useRef, useEffect } from 'react'
import {
  MessageCircle, X, Send, Star, ChevronRight, ChevronLeft,
  Heart, Building2, MapPin, BedDouble, Bath, Maximize2,
  GalleryHorizontal, DollarSign,
} from 'lucide-react'
import API from '../../services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CardField { key: string; label: string; type: string }
interface PropertyCard { index: number; total: number; record_id: string; data: Record<string, unknown> }
interface Message { role: 'user' | 'assistant'; content: string; card: PropertyCard | null }
interface SiteUser { id: string; email: string; name: string | null }

interface Props {
  buttonLabel?: string
  primaryColor?: string
  secondaryColor?: string
  cardFields?: CardField[]
  user?: SiteUser | null
  token?: string | null
}

// ─── Image extraction ─────────────────────────────────────────────────────────

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

// ─── Field categorization ─────────────────────────────────────────────────────

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
  description: 'desc', descripcion: 'desc', descripción: 'desc',
  details: 'desc', detalles: 'desc', info: 'desc', information: 'desc', sobre: 'desc',
  caracteristicas: 'desc', características: 'desc', resumen: 'desc', acerca: 'desc',
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

// ─── Lightbox ─────────────────────────────────────────────────────────────────

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

// ─── Image Carousel (inside card) ─────────────────────────────────────────────

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

// ─── Star Rating ───────────────────────────────────────────────────────────────

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

// ─── Full Property Card ────────────────────────────────────────────────────────

function PropertyCardView({
  card, cardFields, primaryColor, secondaryColor, onNext, onInterested, readonly,
}: {
  card: PropertyCard
  cardFields: CardField[]
  primaryColor: string
  secondaryColor: string
  onNext: () => void
  onInterested: (r: number) => void
  readonly?: boolean
}) {
  const [rating, setRating] = useState(0)
  const [lightboxStart, setLightboxStart] = useState<number | null>(null)

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

        {/* Lists / arrays → chips */}
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

        {/* Other fields — single column, full text */}
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
              <StarRating rating={rating} onChange={setRating} />
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

// ─── Markdown-lite renderer ────────────────────────────────────────────────────

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

// ─── Main Widget ───────────────────────────────────────────────────────────────

export default function ChatWidget({
  buttonLabel = '¿Necesitas ayuda?',
  primaryColor = '#2563eb',
  secondaryColor = '#059669',
  cardFields = [],
  user,
  token,
}: Props) {
  const [open, setOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [state, setState] = useState('collecting_info')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [messages, loading])

  const startSession = async () => {
    if (sessionId) return
    try {
      const res = await API.post('/chat/web/sessions', {}, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      setSessionId(res.data.session_id)
      setState(res.data.state)
      setMessages([{ role: 'assistant', content: res.data.message, card: res.data.card }])
    } catch {
      setMessages([{ role: 'assistant', content: 'Error al iniciar la sesión. Recarga la página.', card: null }])
    }
  }

  const handleOpen = () => {
    setOpen(true)
    if (!sessionId) startSession()
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  const sendRaw = async (content: string) => {
    if (!sessionId || loading) return
    setLoading(true)
    try {
      const res = await API.post(`/chat/web/sessions/${sessionId}/message`, { content })
      setMessages(m => [...m, { role: 'assistant', content: res.data.message, card: res.data.card }])
      setState(res.data.state)
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Ocurrió un error. Intenta nuevamente.', card: null }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || !sessionId || loading || state === 'contact_requested') return
    setInput('')
    setMessages(m => [...m, { role: 'user', content: text, card: null }])
    await sendRaw(text)
  }

  const handleNext = () => {
    setMessages(m => [...m, { role: 'user', content: 'Ver siguiente', card: null }])
    sendRaw('ver siguiente')
  }

  const handleInterested = (rating: number) => {
    const text = rating > 0 ? `Lo quiero, le doy ${rating} estrellas` : 'Lo quiero'
    setMessages(m => [...m, { role: 'user', content: text, card: null }])
    sendRaw(text)
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
                        readonly={i !== lastIdx || isDone}
                      />
                    )}
                  </>
                )}
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
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
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 bg-white p-3 flex items-end gap-2 flex-shrink-0">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={isDone ? 'Conversación finalizada' : 'Escribe un mensaje...'}
              disabled={isDone || loading}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 max-h-28 overflow-y-auto"
              style={{ lineHeight: '1.5', '--tw-ring-color': primaryColor } as React.CSSProperties}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading || isDone}
              className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: primaryColor }}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
