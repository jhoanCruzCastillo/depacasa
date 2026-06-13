import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faXmark, faUser, faPhone, faCommentDots, faGlobe, faBell,
  faLocationDot, faMapPin, faBed, faBath, faRulerCombined,
  faCoins, faBuilding, faCheck, faSpinner, faFloppyDisk,
  faStar, faHeart, faEye, faClockRotateLeft,
} from '@fortawesome/free-solid-svg-icons'
import { faStar as faStarOutline } from '@fortawesome/free-regular-svg-icons'
import API from '../services/api'
import type { SiteUser } from '../hooks/useAuth'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NearbyPlace {
  name: string
  priority: 'REQUIRED' | 'OPTIONAL'
}

interface Preferences {
  direccion: string | null
  direccion_priority: string | null
  ubicacion: string | null
  ubicacion_priority: string | null
  pais: string | null
  pais_priority: string | null
  bedrooms: number | null
  bedrooms_priority: string | null
  bathrooms: number | null
  bathrooms_priority: string | null
  m2: number | null
  m2_priority: string | null
  min_price: number | null
  min_price_priority: string | null
  max_price: number | null
  max_price_priority: string | null
  nearby_places: NearbyPlace[] | null
  property_type: string | null
  property_type_priority: string | null
}

const EMPTY_PREFS: Preferences = {
  direccion: null, direccion_priority: null,
  ubicacion: null, ubicacion_priority: null,
  pais: null, pais_priority: null,
  bedrooms: null, bedrooms_priority: null,
  bathrooms: null, bathrooms_priority: null,
  m2: null, m2_priority: null,
  min_price: null, min_price_priority: null,
  max_price: null, max_price_priority: null,
  nearby_places: null,
  property_type: null, property_type_priority: null,
}

// Safely parse API response into the typed Preferences shape
function parsePrefsFromApi(raw: Record<string, unknown>): Preferences {
  const nearby = Array.isArray(raw.nearby_places)
    ? (raw.nearby_places as Array<Record<string, unknown>>)
        .map(item => ({
          name: String(item.name ?? '').trim(),
          priority: item.priority === 'REQUIRED' ? 'REQUIRED' : 'OPTIONAL' as 'REQUIRED' | 'OPTIONAL',
        }))
        .filter(i => i.name)
    : null

  return {
    ...EMPTY_PREFS,
    ...(raw as Partial<Preferences>),
    nearby_places: nearby,
  }
}

// Display value for number inputs: null/0/undefined → empty string
const numVal = (v: number | null | undefined): string | number =>
  v !== null && v !== undefined && v !== 0 ? v : ''

// Parse number input, returning null for empty or 0
const parseNum = (s: string): number | null => {
  const n = parseFloat(s)
  return !isNaN(n) && n > 0 ? n : null
}

type Tab = 'info' | 'preferences' | 'history'

interface HistoryItem {
  record_id: string
  seen_in_chat: boolean
  rating: number | null
  interested: boolean
  comment: string | null
  seen_at: string | null
  rated_at: string | null
  created_at: string | null
  property: {
    id: string
    modelo: string
    dormitorios: string | null
    baños: string | null
    m2: string | null
    imagen: string | null
    precio: string | null
    proyecto_nombre: string | null
    ubicacion: string | null
  }
}

// ─── PriorityPill ─────────────────────────────────────────────────────────────

function PriorityPill({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const isRequired = value === 'REQUIRED'
  return (
    <button
      type="button"
      onClick={() => onChange(isRequired ? 'OPTIONAL' : 'REQUIRED')}
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all select-none ${
        isRequired
          ? 'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200'
          : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
      }`}
    >
      {isRequired ? 'Obligatorio' : 'Preferencia'}
    </button>
  )
}

// ─── FieldRow ─────────────────────────────────────────────────────────────────

function FieldRow({ icon, label, children, priority, onPriorityChange }: {
  icon: typeof faUser
  label: string
  children: React.ReactNode
  priority?: string | null
  onPriorityChange?: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide select-none">
          <FontAwesomeIcon icon={icon} className="text-slate-400 w-3 h-3" />
          {label}
        </label>
        {onPriorityChange !== undefined && (
          <PriorityPill value={priority ?? null} onChange={onPriorityChange} />
        )}
      </div>
      {children}
    </div>
  )
}

// ─── NearbyTagsInput ──────────────────────────────────────────────────────────

function NearbyTagsInput({ values, onChange }: {
  values: NearbyPlace[]
  onChange: (v: NearbyPlace[]) => void
}) {
  const [input, setInput] = useState('')

  const add = () => {
    const name = input.trim()
    if (!name || values.some(v => v.name.toLowerCase() === name.toLowerCase())) return
    onChange([...values, { name, priority: 'OPTIONAL' }])
    setInput('')
  }

  const remove = (name: string) => onChange(values.filter(v => v.name !== name))

  const togglePriority = (name: string) =>
    onChange(values.map(v =>
      v.name === name ? { ...v, priority: v.priority === 'REQUIRED' ? 'OPTIONAL' : 'REQUIRED' } : v
    ))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5 flex-wrap min-h-[28px]">
        {values.map(v => (
          <span
            key={v.name}
            className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-colors ${
              v.priority === 'REQUIRED'
                ? 'bg-orange-50 text-orange-700 border-orange-200'
                : 'bg-indigo-50 text-indigo-700 border-indigo-100'
            }`}
          >
            {v.name}
            <button
              type="button"
              onClick={() => togglePriority(v.name)}
              title="Cambiar importancia"
              className={`text-[9px] font-bold px-1 py-0.5 rounded-full transition-colors ${
                v.priority === 'REQUIRED'
                  ? 'bg-orange-200 text-orange-800 hover:bg-orange-300'
                  : 'bg-indigo-100 text-indigo-500 hover:bg-indigo-200'
              }`}
            >
              {v.priority === 'REQUIRED' ? 'OBL' : 'PREF'}
            </button>
            <button
              type="button"
              onClick={() => remove(v.name)}
              className="text-slate-400 hover:text-red-500 leading-none font-bold ml-0.5"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
          }}
          placeholder="Escribe un lugar y presiona Enter…"
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent bg-white"
        />
        <button
          type="button"
          onClick={add}
          className="px-2.5 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors"
        >
          +
        </button>
      </div>
      {values.length > 0 && (
        <p className="text-[10px] text-slate-400">
          Toca <span className="font-bold text-indigo-500">PREF</span> / <span className="font-bold text-orange-500">OBL</span> en cada lugar para cambiar su importancia.
        </p>
      )}
    </div>
  )
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-indigo-600' : 'bg-slate-200'}`}
    >
      <motion.span
        className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow"
        animate={{ left: checked ? '1.375rem' : '0.125rem' }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  user: SiteUser
  token: string
  primaryColor: string
  onClose: () => void
  onUserUpdated: (u: SiteUser) => void
  initialTab?: Tab
}

export default function UserProfileModal({ user, token, primaryColor, onClose, onUserUpdated, initialTab }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'info')
  const [savingInfo, setSavingInfo] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [loadingPrefs, setLoadingPrefs] = useState(true)
  const headersRef = useRef({ Authorization: `Bearer ${token}` })

  const [info, setInfo] = useState({
    name: user.name ?? '',
    phone: user.phone ?? '',
    whatsapp: user.whatsapp ?? '',
    country: user.country ?? '',
    wants_newsletter: user.wants_newsletter,
  })

  const [prefs, setPrefs] = useState<Preferences>(EMPTY_PREFS)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Lock background scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    headersRef.current = { Authorization: `Bearer ${token}` }
    setLoadingPrefs(true)
    API.get('/preferences/me', { headers: headersRef.current })
      .then(r => setPrefs(parsePrefsFromApi(r.data.preferences ?? {})))
      .catch(() => toast.error('No se pudieron cargar las preferencias'))
      .finally(() => setLoadingPrefs(false))
  }, [token])

  useEffect(() => {
    if (tab !== 'history' || history.length > 0) return
    setLoadingHistory(true)
    API.get('/auth/me/history', { headers: headersRef.current })
      .then(r => setHistory(r.data.items ?? []))
      .catch(() => toast.error('No se pudo cargar el historial'))
      .finally(() => setLoadingHistory(false))
  }, [tab])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const setPref = <K extends keyof Preferences>(key: K, val: Preferences[K]) =>
    setPrefs(p => ({ ...p, [key]: val }))

  const handleSaveInfo = async () => {
    setSavingInfo(true)
    try {
      const res = await API.put('/auth/me', {
        name: info.name.trim() || null,
        phone: info.phone.trim() || null,
        whatsapp: info.whatsapp.trim() || null,
        country: info.country.trim() || null,
        wants_newsletter: info.wants_newsletter,
      }, { headers: headersRef.current })
      onUserUpdated(res.data)
      toast.success('Información guardada')
    } catch {
      toast.error('Error al guardar la información')
    } finally {
      setSavingInfo(false)
    }
  }

  const handleSavePrefs = async () => {
    setSavingPrefs(true)
    try {
      await API.put('/preferences/me', prefs, { headers: headersRef.current })
      toast.success('Preferencias guardadas')
    } catch {
      toast.error('Error al guardar las preferencias')
    } finally {
      setSavingPrefs(false)
    }
  }

  const inputCls = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent bg-white transition-shadow placeholder:text-slate-300'
  const numCls = inputCls + ' [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'info', label: 'Mi información' },
    { id: 'preferences', label: 'Mis preferencias' },
    { id: 'history', label: 'Historial' },
  ]

  const MEDIA_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api').replace(/\/api\/?$/, '')
  const IMG_EXT = /\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)(\?.*)?$/i
  const HTTP = /^https?:\/\//
  const resolveImg = (src: string | null | undefined) => {
    if (!src) return null
    if (HTTP.test(src)) return src
    if (IMG_EXT.test(src)) return `${MEDIA_BASE}/media/${src}`
    return null
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden"
          style={{ height: '760px' }}
          initial={{ opacity: 0, y: 48, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-7 pt-6 pb-5 flex-shrink-0">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold text-white flex-shrink-0"
              style={{ backgroundColor: primaryColor }}
            >
              {(user.name || user.email || 'U')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-800 truncate">{user.name || 'Sin nombre'}</p>
              <p className="text-xs text-slate-400 truncate">{user.email}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors flex-shrink-0"
            >
              <FontAwesomeIcon icon={faXmark} className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="relative flex px-7 border-b border-slate-100 flex-shrink-0">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative px-4 py-2.5 text-sm font-semibold transition-colors ${
                  tab === t.id ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
                {tab === t.id && (
                  <motion.div
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full"
                    layoutId="tab-underline"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">

              {tab === 'info' && (
                <motion.div
                  key="info"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.18 }}
                  className="p-7 space-y-5"
                >
                  <FieldRow icon={faUser} label="Nombre">
                    <input
                      value={info.name}
                      onChange={e => setInfo(f => ({ ...f, name: e.target.value }))}
                      placeholder="Tu nombre completo"
                      className={inputCls}
                    />
                  </FieldRow>

                  <FieldRow icon={faPhone} label="Teléfono">
                    <input
                      value={info.phone}
                      onChange={e => setInfo(f => ({ ...f, phone: e.target.value }))}
                      placeholder="+51 999 000 000"
                      className={inputCls}
                    />
                  </FieldRow>

                  <FieldRow icon={faCommentDots} label="WhatsApp">
                    <input
                      value={info.whatsapp}
                      onChange={e => setInfo(f => ({ ...f, whatsapp: e.target.value }))}
                      placeholder="+51 999 000 000"
                      className={inputCls}
                    />
                  </FieldRow>

                  <FieldRow icon={faGlobe} label="País">
                    <input
                      value={info.country}
                      onChange={e => setInfo(f => ({ ...f, country: e.target.value }))}
                      placeholder="Ej: Perú"
                      className={inputCls}
                    />
                  </FieldRow>

                  <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                        <FontAwesomeIcon icon={faBell} className="text-slate-400 text-xs" />
                        Recibir novedades
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">Te avisamos cuando haya nuevos proyectos</p>
                    </div>
                    <Toggle
                      checked={info.wants_newsletter}
                      onChange={v => setInfo(f => ({ ...f, wants_newsletter: v }))}
                    />
                  </div>

                </motion.div>
              )}

              {tab === 'preferences' && (
                <motion.div
                  key="preferences"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}
                  className="p-7 space-y-5"
                >
                  {loadingPrefs ? (
                    <div className="flex items-center justify-center py-16 text-slate-400">
                      <FontAwesomeIcon icon={faSpinner} className="animate-spin text-2xl" />
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-4">
                        <FieldRow icon={faLocationDot} label="Dirección"
                          priority={prefs.direccion_priority}
                          onPriorityChange={v => setPref('direccion_priority', v)}
                        >
                          <input
                            value={prefs.direccion ?? ''}
                            onChange={e => setPref('direccion', e.target.value.trim() || null)}
                            placeholder="Ej: Av. Javier Prado 1234"
                            className={inputCls}
                          />
                        </FieldRow>

                        <FieldRow icon={faMapPin} label="Ubicación / Distrito"
                          priority={prefs.ubicacion_priority}
                          onPriorityChange={v => setPref('ubicacion_priority', v)}
                        >
                          <input
                            value={prefs.ubicacion ?? ''}
                            onChange={e => setPref('ubicacion', e.target.value.trim() || null)}
                            placeholder="Ej: Miraflores, San Isidro…"
                            className={inputCls}
                          />
                        </FieldRow>

                        <FieldRow icon={faGlobe} label="País"
                          priority={prefs.pais_priority}
                          onPriorityChange={v => setPref('pais_priority', v)}
                        >
                          <input
                            value={prefs.pais ?? ''}
                            onChange={e => setPref('pais', e.target.value.trim() || null)}
                            placeholder="Ej: Perú"
                            className={inputCls}
                          />
                        </FieldRow>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <FieldRow icon={faBed} label="Habitaciones"
                          priority={prefs.bedrooms_priority}
                          onPriorityChange={v => setPref('bedrooms_priority', v)}
                        >
                          <input type="number" min={1}
                            value={numVal(prefs.bedrooms)}
                            onChange={e => setPref('bedrooms', parseNum(e.target.value))}
                            placeholder="Ej: 2"
                            className={numCls}
                          />
                        </FieldRow>

                        <FieldRow icon={faBath} label="Baños"
                          priority={prefs.bathrooms_priority}
                          onPriorityChange={v => setPref('bathrooms_priority', v)}
                        >
                          <input type="number" min={1}
                            value={numVal(prefs.bathrooms)}
                            onChange={e => setPref('bathrooms', parseNum(e.target.value))}
                            placeholder="Ej: 1"
                            className={numCls}
                          />
                        </FieldRow>

                        <FieldRow icon={faRulerCombined} label="M²"
                          priority={prefs.m2_priority}
                          onPriorityChange={v => setPref('m2_priority', v)}
                        >
                          <input type="number" min={1}
                            value={numVal(prefs.m2)}
                            onChange={e => setPref('m2', parseNum(e.target.value))}
                            placeholder="Ej: 80"
                            className={numCls}
                          />
                        </FieldRow>

                        <FieldRow icon={faBuilding} label="Tipo de propiedad"
                          priority={prefs.property_type_priority}
                          onPriorityChange={v => setPref('property_type_priority', v)}
                        >
                          <input
                            value={prefs.property_type ?? ''}
                            onChange={e => setPref('property_type', e.target.value.trim() || null)}
                            placeholder="Ej: Departamento"
                            className={inputCls}
                          />
                        </FieldRow>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <FieldRow icon={faCoins} label="Precio mínimo"
                          priority={prefs.min_price_priority}
                          onPriorityChange={v => setPref('min_price_priority', v)}
                        >
                          <input type="number" min={0}
                            value={numVal(prefs.min_price)}
                            onChange={e => setPref('min_price', parseNum(e.target.value))}
                            placeholder="S/ mínimo"
                            className={numCls}
                          />
                        </FieldRow>

                        <FieldRow icon={faCoins} label="Precio máximo"
                          priority={prefs.max_price_priority}
                          onPriorityChange={v => setPref('max_price_priority', v)}
                        >
                          <input type="number" min={0}
                            value={numVal(prefs.max_price)}
                            onChange={e => setPref('max_price', parseNum(e.target.value))}
                            placeholder="S/ máximo"
                            className={numCls}
                          />
                        </FieldRow>
                      </div>

                      <FieldRow icon={faMapPin} label="Zonas cercanas">
                        <NearbyTagsInput
                          values={prefs.nearby_places ?? []}
                          onChange={v => setPref('nearby_places', v.length ? v : null)}
                        />
                      </FieldRow>

                    </>
                  )}
                </motion.div>
              )}

              {tab === 'history' && (
                <motion.div
                  key="history"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18 }}
                  className="p-5 space-y-3"
                >
                  {loadingHistory ? (
                    <div className="flex items-center justify-center py-16 gap-2 text-slate-400 text-sm">
                      <FontAwesomeIcon icon={faSpinner} className="animate-spin" /> Cargando historial…
                    </div>
                  ) : history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                      <FontAwesomeIcon icon={faClockRotateLeft} className="w-10 h-10 text-slate-200" />
                      <p className="text-slate-400 text-sm font-medium">Sin historial aún</p>
                      <p className="text-slate-300 text-xs">Las propiedades que veas en el chatbot aparecerán aquí.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {history.map(item => {
                        const img = resolveImg(item.property.imagen)
                        return (
                          <div key={item.record_id} className="flex gap-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
                            {/* Imagen */}
                            <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-slate-200">
                              {img
                                ? <img src={img} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                : <div className="w-full h-full flex items-center justify-center"><FontAwesomeIcon icon={faBuilding} className="text-slate-300 text-xl" /></div>}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-semibold text-slate-800 text-sm truncate">{item.property.modelo}</p>
                                  {item.property.proyecto_nombre && (
                                    <p className="text-xs text-slate-400 truncate">{item.property.proyecto_nombre}</p>
                                  )}
                                </div>
                                {item.interested && (
                                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-bold bg-rose-100 text-rose-500 px-2 py-0.5 rounded-full">
                                    <FontAwesomeIcon icon={faHeart} className="w-2.5 h-2.5" /> Me interesa
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                                {item.property.dormitorios && (
                                  <span className="flex items-center gap-1">
                                    <FontAwesomeIcon icon={faBed} className="w-3 h-3" />{item.property.dormitorios}
                                  </span>
                                )}
                                {item.property.m2 && (
                                  <span className="flex items-center gap-1">
                                    <FontAwesomeIcon icon={faRulerCombined} className="w-3 h-3" />{item.property.m2} m²
                                  </span>
                                )}
                                {item.property.ubicacion && (
                                  <span className="flex items-center gap-1">
                                    <FontAwesomeIcon icon={faLocationDot} className="w-3 h-3" />{item.property.ubicacion}
                                  </span>
                                )}
                                {item.property.precio && (
                                  <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                    <FontAwesomeIcon icon={faCoins} className="w-3 h-3" />{item.property.precio}
                                  </span>
                                )}
                              </div>

                              {/* Calificación */}
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-0.5">
                                  {[1, 2, 3, 4, 5].map(star => (
                                    <FontAwesomeIcon
                                      key={star}
                                      icon={item.rating && star <= item.rating ? faStar : faStarOutline}
                                      className={`w-3 h-3 ${item.rating && star <= item.rating ? 'text-amber-400' : 'text-slate-300'}`}
                                    />
                                  ))}
                                </div>
                                {item.rating
                                  ? <span className="text-[10px] text-slate-400">{item.rating}/5</span>
                                  : <span className="text-[10px] text-slate-300 italic">Sin calificar</span>}
                                {item.seen_at && (
                                  <span className="ml-auto text-[10px] text-slate-300 flex items-center gap-1">
                                    <FontAwesomeIcon icon={faEye} className="w-2.5 h-2.5" />
                                    {new Date(item.seen_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}
                                  </span>
                                )}
                              </div>

                              {item.comment && (
                                <p className="text-[11px] text-slate-500 italic bg-white rounded-lg px-2 py-1 border border-slate-100">
                                  "{item.comment}"
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </motion.div>
              )}

            </AnimatePresence>
          </div>

          {/* Fixed footer — save button */}
          <div className="flex-shrink-0 px-7 py-4 border-t border-slate-100 bg-white">
            {tab === 'info' ? (
              <button
                onClick={handleSaveInfo}
                disabled={savingInfo}
                className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                style={{ backgroundColor: primaryColor }}
              >
                {savingInfo
                  ? <><FontAwesomeIcon icon={faSpinner} className="animate-spin" /> Guardando…</>
                  : <><FontAwesomeIcon icon={faFloppyDisk} /> Guardar información</>
                }
              </button>
            ) : tab === 'history' ? (
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl text-sm font-bold border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
              >
                Cerrar
              </button>
            ) : (
              <button
                onClick={handleSavePrefs}
                disabled={savingPrefs}
                className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                style={{ backgroundColor: primaryColor }}
              >
                {savingPrefs
                  ? <><FontAwesomeIcon icon={faSpinner} className="animate-spin" /> Guardando…</>
                  : <><FontAwesomeIcon icon={faCheck} /> Guardar preferencias</>
                }
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
