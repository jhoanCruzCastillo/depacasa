import { useState, useMemo, useEffect, useRef } from 'react'
import { GoogleMap, useJsApiLoader, InfoWindow } from '@react-google-maps/api'
import { X, MapPin, BedDouble, Maximize2, SlidersHorizontal } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CatalogRecord {
  id: string
  data: Record<string, unknown>
  project_id: string
  project_name: string
  developer_id: string | null
  scraped_at: string | null
}

interface MapViewProps {
  items: CatalogRecord[]
  loading: boolean
  locations: string[]
  primaryColor: string
  activeLocation: string
  onLocationFilter: (loc: string) => void
  onOpenDetail: (r: CatalogRecord) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || ''
const LIMA_CENTER = { lat: -12.0464, lng: -77.0428 }
// Must be defined outside the component — stable reference required by useJsApiLoader
const GMAPS_LIBRARIES: ('geometry')[] = ['geometry']
const MEDIA_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api').replace(/\/api\/?$/, '')
const IMG_EXT = /\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)(\?.*)?$/i
const HTTP = /^https?:\/\//

const PRICE_LEGEND = [
  { label: 'Menos de S/ 300,000',      color: '#3b82f6' },
  { label: 'S/ 300,000 – S/ 450,000', color: '#22c55e' },
  { label: 'S/ 450,000 – S/ 600,000', color: '#f97316' },
  { label: 'Más de S/ 600,000',        color: '#ef4444' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toFull(val: string) {
  return val.startsWith('/media/') ? `${MEDIA_BASE}${val}` : val
}

function firstImage(data: Record<string, unknown>): string | null {
  function walk(val: unknown): string | null {
    if (!val) return null
    if (typeof val === 'string') {
      if (val.startsWith('/media/')) return toFull(val)
      if (HTTP.test(val) && IMG_EXT.test(val.split('?')[0])) return val
    }
    if (Array.isArray(val)) { for (const i of val) { const r = walk(i); if (r) return r } }
    if (typeof val === 'object') {
      for (const v of Object.values(val as Record<string, unknown>)) {
        const r = walk(v); if (r) return r
      }
    }
    return null
  }
  return walk(data)
}

function parsePriceSoles(data: Record<string, unknown>): number | null {
  const raw = String(data['precio_desde'] ?? data['precio'] ?? data['price'] ?? '')
  const digits = raw.replace(/[.\s]/g, '').replace(',', '')
  const m = digits.match(/\d{4,}/)
  if (!m) return null
  const n = parseInt(m[0])
  return n > 10_000 ? n : null
}

function formatPriceShort(n: number): string {
  if (n >= 1_000_000) return `S/${(n / 1_000_000).toFixed(1)}M`
  return `S/${Math.round(n / 1000)}K`
}

function getPriceColor(n: number | null): string {
  if (!n) return '#94a3b8'
  if (n < 300_000) return '#3b82f6'
  if (n < 450_000) return '#22c55e'
  if (n < 600_000) return '#f97316'
  return '#ef4444'
}

function extractBedrooms(data: Record<string, unknown>): number | null {
  const model = String(data['modelo'] ?? '')
  if (model) {
    const m = model.match(/(\d+)\s*(?:dorms?|dormitorios?|hab\b)/i)
    if (m) return parseInt(m[1])
  }
  for (const k of ['dormitorios', 'dorms', 'bedrooms', 'habitaciones']) {
    const v = data[k]
    if (typeof v === 'number') return v
    if (typeof v === 'string') { const n = parseInt(v); if (!isNaN(n)) return n }
  }
  return null
}

function extractArea(data: Record<string, unknown>): string | null {
  const model = String(data['modelo'] ?? '')
  if (model) {
    const m = model.match(/(\d+(?:\.\d+)?)\s*m²?/i)
    if (m) return `${m[1]} m²`
  }
  for (const k of ['area', 'área', 'm2', 'metros', 'metraje']) {
    const v = data[k]
    if (v) return `${v} m²`
  }
  return null
}

function getCoords(data: Record<string, unknown>): { lat: number; lng: number } | null {
  const raw = String(data['gmaps_coordinates'] ?? '')
  if (!raw) return null
  const parts = raw.split(',')
  if (parts.length !== 2) return null
  const lat = parseFloat(parts[0].trim())
  const lng = parseFloat(parts[1].trim())
  if (isNaN(lat) || isNaN(lng)) return null
  // Reject null-island (0,0) and out-of-range values
  if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

function resolveProjectName(record: CatalogRecord): string {
  if (record.project_name) return record.project_name
  const nombre = String(record.data['nombre'] ?? '')
  if (nombre) return nombre
  const url = String(record.data['url_propiedad'] ?? record.data['url'] ?? '')
  if (url) {
    try {
      const SKIP = new Set(['proyecto', 'projects', 'propiedad', 'venta', 'departamentos'])
      const parts = new URL(url).pathname.split('/').filter(p => p && !SKIP.has(p.toLowerCase()))
      const slug = parts[parts.length - 1]
      if (slug) return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    } catch { /* noop */ }
  }
  return '—'
}

function statusBadgeColor(s: string): string {
  const t = s.toLowerCase()
  if (t.includes('inmediata') || t.includes('entrega') || t.includes('disponib')) return '#10b981'
  if (t.includes('construc') || t.includes('preventa') || t.includes('próx')) return '#f59e0b'
  return '#6b7280'
}

// ─── Imperative marker icon (base64 SVG — reliable across all browsers) ──────

function makeSvgIcon(
  label: string, color: string, selected: boolean,
): google.maps.Icon {
  const w = Math.max(68, label.length * 9 + 28)
  const h = 36
  const bh = h - 8  // bubble height
  const sw = selected ? '2.5' : '1.5'
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`,
    `<rect x="1" y="1" width="${w - 2}" height="${bh}" rx="${bh / 2}"`,
    ` fill="${color}" stroke="white" stroke-width="${sw}"/>`,
    `<polygon points="${w / 2 - 5},${bh} ${w / 2},${h - 1} ${w / 2 + 5},${bh}"`,
    ` fill="${color}"/>`,
    `<text x="${w / 2}" y="${Math.round(bh * 0.67)}" text-anchor="middle"`,
    ` fill="white" font-size="12" font-weight="bold"`,
    ` font-family="Arial,sans-serif">${label}</text>`,
    '</svg>',
  ].join('')
  return {
    url: `data:image/svg+xml;base64,${btoa(svg)}`,
    scaledSize: new window.google.maps.Size(w, h),
    anchor: new window.google.maps.Point(w / 2, h),
  }
}

// ─── MapPopup ─────────────────────────────────────────────────────────────────

function MapPopup({ record, onOpenDetail }: { record: CatalogRecord; onOpenDetail: (r: CatalogRecord) => void }) {
  const img       = firstImage(record.data)
  const name      = resolveProjectName(record)
  const loc       = String(record.data['ubicacion'] ?? '').split('\n')[0].trim()
  const price     = parsePriceSoles(record.data)
  const priceStr  = String(record.data['precio_desde'] ?? record.data['precio'] ?? '')
  const beds      = extractBedrooms(record.data)
  const area      = extractArea(record.data)
  const estado    = String(record.data['estado_del_proyecto'] ?? '')

  return (
    <div style={{ fontFamily: 'system-ui,sans-serif', width: 220, overflow: 'hidden' }}>
      {img && (
        <div style={{ margin: '-12px -12px 10px', height: 120, overflow: 'hidden', position: 'relative', borderRadius: '8px 8px 0 0' }}>
          <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {estado && (
            <span style={{
              position: 'absolute', top: 8, left: 8, fontSize: 10, fontWeight: 700,
              color: 'white', background: statusBadgeColor(estado),
              padding: '2px 8px', borderRadius: 99,
            }}>
              {estado}
            </span>
          )}
        </div>
      )}

      <p style={{ fontWeight: 700, fontSize: 13, color: '#1e293b', margin: '0 0 2px', lineHeight: 1.3 }}>
        {name}
      </p>
      {loc && (
        <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 3 }}>
          📍 {loc}
        </p>
      )}
      {priceStr && (
        <p style={{ fontSize: 16, fontWeight: 800, color: getPriceColor(price), margin: '0 0 4px' }}>
          {priceStr}
        </p>
      )}
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#64748b', marginBottom: 10 }}>
        {beds && <span>🛏 {beds} dorms</span>}
        {area && <span>📐 {area}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => onOpenDetail(record)}
          style={{
            flex: 1, padding: '7px 0', fontSize: 11, fontWeight: 600,
            border: '1.5px solid #e2e8f0', borderRadius: 8, background: 'white',
            color: '#374151', cursor: 'pointer',
          }}
        >
          Ver proyecto
        </button>
        <button
          onClick={() => onOpenDetail(record)}
          style={{
            flex: 1, padding: '7px 0', fontSize: 11, fontWeight: 600,
            border: 'none', borderRadius: 8, background: '#2563eb',
            color: 'white', cursor: 'pointer',
          }}
        >
          Agendar visita
        </button>
      </div>
    </div>
  )
}

// ─── MapView ──────────────────────────────────────────────────────────────────

const MAP_OPTIONS: google.maps.MapOptions = {
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  zoomControlOptions: { position: 7 as google.maps.ControlPosition },
  styles: [
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  ],
}

export default function MapView({
  items, loading, locations, primaryColor,
  activeLocation, onLocationFilter, onOpenDetail,
}: MapViewProps) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: MAPS_KEY,
    libraries: GMAPS_LIBRARIES,
  })

  const [showPanel,      setShowPanel]      = useState(true)
  const [developerFilter, setDeveloperFilter] = useState('')
  const [minBedrooms,    setMinBedrooms]    = useState<number | null>(null)
  const [minPrice,       setMinPrice]       = useState(300_000)
  const [maxPrice,       setMaxPrice]       = useState(800_000)
  const [entregaFilter,  setEntregaFilter]  = useState('')
  const [selectedId,     setSelectedId]     = useState<string | null>(null)
  const [mapRef,         setMapRef]         = useState<google.maps.Map | null>(null)

  // Unique developer names derived from project_name
  const developerOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of items) {
      if (r.project_name) set.add(r.project_name)
    }
    return Array.from(set).sort()
  }, [items])

  // Unique delivery statuses from items
  const entregaOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of items) {
      const v = String(r.data['estado_del_proyecto'] ?? r.data['estado'] ?? '').trim()
      if (v) set.add(v)
    }
    return Array.from(set)
  }, [items])

  // Client-side filter
  const filtered = useMemo(() => items.filter(r => {
    if (developerFilter && r.project_name !== developerFilter) return false
    const price = parsePriceSoles(r.data)
    if (price !== null) {
      if (price < minPrice) return false
      if (maxPrice < 800_000 && price > maxPrice) return false
    }
    if (minBedrooms !== null) {
      const beds = extractBedrooms(r.data)
      if (beds === null) return false
      if (minBedrooms === 4 ? beds < 4 : beds !== minBedrooms) return false
    }
    if (entregaFilter) {
      const v = String(r.data['estado_del_proyecto'] ?? '').toLowerCase()
      if (!v.includes(entregaFilter.toLowerCase())) return false
    }
    return true
  }), [items, developerFilter, minBedrooms, minPrice, maxPrice, entregaFilter])

  // Records with coordinates (for map pins)
  const mappable = useMemo(() => filtered.filter(r => getCoords(r.data) !== null), [filtered])

  const selectedRecord = useMemo(
    () => (selectedId ? items.find(r => r.id === selectedId) ?? null : null),
    [selectedId, items],
  )

  const hasFilters = developerFilter || minBedrooms !== null || minPrice !== 300_000 || maxPrice < 800_000 || entregaFilter || activeLocation

  const clearFilters = () => {
    setDeveloperFilter('')
    setMinBedrooms(null)
    setMinPrice(300_000)
    setMaxPrice(800_000)
    setEntregaFilter('')
    onLocationFilter('')
  }

  // ── Imperative markers ────────────────────────────────────────────────────
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())

  // Recreate markers when the mappable set changes
  useEffect(() => {
    if (!mapRef || !isLoaded) return
    // Remove all existing markers
    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current.clear()
    // Add one marker per mappable record
    for (const r of mappable) {
      const coords = getCoords(r.data)!
      const price  = parsePriceSoles(r.data)
      const color  = getPriceColor(price)
      const label  = price ? formatPriceShort(price) : '?'
      const marker = new window.google.maps.Marker({
        position: coords,
        map: mapRef,
        icon: makeSvgIcon(label, color, false),
        zIndex: 1,
      })
      marker.addListener('click', () =>
        setSelectedId(prev => (prev === r.id ? null : r.id)),
      )
      markersRef.current.set(r.id, marker)
    }
    return () => {
      markersRef.current.forEach(m => m.setMap(null))
      markersRef.current.clear()
    }
  }, [mapRef, isLoaded, mappable])

  // Update icon of selected/deselected marker without recreating all markers
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const r = mappable.find(x => x.id === id)
      if (!r) return
      const price      = parsePriceSoles(r.data)
      const color      = getPriceColor(price)
      const label      = price ? formatPriceShort(price) : '?'
      const isSelected = id === selectedId
      marker.setIcon(makeSvgIcon(label, color, isSelected))
      marker.setZIndex(isSelected ? 100 : 1)
    })
  }, [selectedId, mappable])

  // Auto-fit map bounds when mappable items change
  useEffect(() => {
    if (!mapRef || !isLoaded || mappable.length === 0) return
    const bounds = new window.google.maps.LatLngBounds()
    for (const r of mappable) {
      const c = getCoords(r.data)
      if (c) bounds.extend(c)
    }
    if (mappable.length === 1) {
      mapRef.setCenter(getCoords(mappable[0].data)!)
      mapRef.setZoom(15)
    } else {
      mapRef.fitBounds(bounds, 60)
      // Prevent zooming out further than city-level after fitBounds
      const listener = window.google.maps.event.addListenerOnce(mapRef, 'bounds_changed', () => {
        if ((mapRef.getZoom() ?? 99) < 11) mapRef.setZoom(12)
      })
      return () => window.google.maps.event.removeListener(listener)
    }
  }, [mapRef, isLoaded, mappable])

  return (
    <div className="flex w-full rounded-2xl overflow-hidden border border-slate-200 shadow-sm"
      style={{ height: 'calc(100vh - 200px)', minHeight: 520 }}>

      {/* ── Left panel ───────────────────────────────────────────────────── */}
      {showPanel && (
        <div className="w-72 flex-shrink-0 bg-white flex flex-col border-r border-slate-200 overflow-hidden">

          {/* Filter header */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-700 text-sm">Filtros</span>
            </div>
            <div className="flex items-center gap-3">
              {hasFilters && (
                <button onClick={clearFilters}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline">
                  Limpiar filtros
                </button>
              )}
              <button onClick={() => setShowPanel(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filters body */}
          <div className="px-4 py-4 flex flex-col gap-4 flex-shrink-0 border-b border-slate-100">

            {/* Desarrolladora */}
            {developerOptions.length > 1 && (
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">
                  Desarrolladora
                </label>
                <select
                  value={developerFilter}
                  onChange={e => setDeveloperFilter(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700
                             focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all"
                >
                  <option value="">Todas</option>
                  {developerOptions.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}

            {/* Ubicación */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">
                Ubicación
              </label>
              <select
                value={activeLocation}
                onChange={e => onLocationFilter(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700
                           focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all"
              >
                <option value="">Todos los distritos</option>
                {locations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            {/* Tipo de inmueble (static for now) */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">
                Tipo de inmueble
              </label>
              <select
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700
                           focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all"
              >
                <option>Todos</option>
                <option>Departamento</option>
              </select>
            </div>

            {/* Dormitorios */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">
                Dormitorios
              </label>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setMinBedrooms(null)}
                  className={`flex-1 py-1.5 text-sm font-semibold rounded-xl border transition-all ${
                    minBedrooms === null
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  Todos
                </button>
                {[1, 2, 3, 4].map(n => (
                  <button
                    key={n}
                    onClick={() => setMinBedrooms(minBedrooms === n ? null : n)}
                    className={`flex-1 py-1.5 text-sm font-semibold rounded-xl border transition-all ${
                      minBedrooms === n
                        ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {n === 4 ? '4+' : n}
                  </button>
                ))}
              </div>
            </div>

            {/* Precio range */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">
                Precio (S/)
              </label>
              <div className="flex justify-between text-xs text-slate-500 mb-2">
                <span>{(minPrice / 1000).toFixed(0)},000</span>
                <span>{maxPrice >= 800_000 ? '800,000+' : `${(maxPrice / 1000).toFixed(0)},000`}</span>
              </div>
              <div className="flex flex-col gap-1">
                <input type="range" min={0} max={750_000} step={25_000}
                  value={minPrice}
                  onChange={e => setMinPrice(Math.min(Number(e.target.value), maxPrice - 50_000))}
                  className="w-full h-1.5 accent-blue-600 rounded-full" />
                <input type="range" min={50_000} max={800_000} step={25_000}
                  value={maxPrice}
                  onChange={e => setMaxPrice(Math.max(Number(e.target.value), minPrice + 50_000))}
                  className="w-full h-1.5 accent-blue-600 rounded-full" />
              </div>
            </div>

            {/* Entrega */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">
                Entrega
              </label>
              <select
                value={entregaFilter}
                onChange={e => setEntregaFilter(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700
                           focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 transition-all"
              >
                <option value="">Todas</option>
                {entregaOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            {/* Count + CTA */}
            <div>
              <p className="text-xs text-slate-500 mb-2.5">
                {filtered.length} {filtered.length === 1 ? 'proyecto encontrado' : 'proyectos encontrados'}
              </p>
              <button
                className="w-full py-2.5 text-sm font-bold text-white rounded-xl transition-all hover:opacity-90 active:scale-[.98]"
                style={{ backgroundColor: primaryColor }}
                onClick={() => setSelectedId(null)}
              >
                Ver resultados
              </button>
            </div>
          </div>

          {/* Property list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <p className="text-sm text-slate-400">Sin resultados con los filtros actuales.</p>
                <button onClick={clearFilters} className="text-xs text-blue-600 mt-2 hover:underline">
                  Limpiar filtros
                </button>
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-100">
                  {filtered.slice(0, 40).map(r => {
                    const price    = parsePriceSoles(r.data)
                    const priceStr = String(r.data['precio_desde'] ?? r.data['precio'] ?? '')
                    const img      = firstImage(r.data)
                    const name     = resolveProjectName(r)
                    const loc      = String(r.data['ubicacion'] ?? '').split('\n')[0].trim()
                    const beds     = extractBedrooms(r.data)
                    const area     = extractArea(r.data)

                    return (
                      <button
                        key={r.id}
                        onClick={() => { setSelectedId(r.id === selectedId ? null : r.id) }}
                        className={`w-full flex gap-3 px-3 py-3 text-left transition-colors ${
                          selectedId === r.id
                            ? 'bg-blue-50 border-l-2 border-blue-500'
                            : 'hover:bg-slate-50 border-l-2 border-transparent'
                        }`}
                      >
                        {img ? (
                          <img src={img} alt="" className="w-16 h-16 object-cover rounded-xl flex-shrink-0" />
                        ) : (
                          <div className="w-16 h-16 bg-slate-100 rounded-xl flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate leading-snug">{name}</p>
                          {loc && (
                            <p className="text-[10px] text-slate-400 flex items-center gap-0.5 mt-0.5">
                              <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                              <span className="truncate">{loc}</span>
                            </p>
                          )}
                          <p className="text-sm font-extrabold mt-1 leading-none"
                            style={{ color: priceStr ? getPriceColor(price) : '#94a3b8' }}>
                            {priceStr || 'A consultar'}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {beds && (
                              <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                                <BedDouble className="w-2.5 h-2.5" />{beds} dorms
                              </span>
                            )}
                            {area && (
                              <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                                <Maximize2 className="w-2.5 h-2.5" />{area}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
                {filtered.length > 40 && (
                  <p className="text-center text-xs text-slate-400 py-3">
                    +{filtered.length - 40} más — usa filtros para acotar
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Map area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 relative bg-slate-100 min-w-0">

        {/* Show-panel button (when panel is hidden) */}
        {!showPanel && (
          <button
            onClick={() => setShowPanel(true)}
            className="absolute top-3 left-3 z-20 bg-white shadow-md rounded-xl px-3 py-2 text-sm font-semibold
                       text-slate-700 flex items-center gap-2 hover:bg-slate-50 transition-colors border border-slate-200"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Mostrar filtros
          </button>
        )}

        {/* Price legend */}
        <div className="absolute top-3 right-3 z-20 bg-white/95 backdrop-blur shadow-md rounded-xl p-3 border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
            Leyenda de precios
          </p>
          <p className="text-[9px] text-slate-400 mb-2">Precio desde</p>
          {PRICE_LEGEND.map(({ label, color }) => (
            <div key={label} className="flex items-center gap-2 mb-1.5 last:mb-0">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[10px] text-slate-600 leading-none">{label}</span>
            </div>
          ))}
        </div>

        {/* Map pin count badge */}
        {mappable.length > 0 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">
            <div className="bg-slate-800/80 backdrop-blur text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg">
              {mappable.length} proyecto{mappable.length !== 1 ? 's' : ''} en el mapa
              {filtered.length > mappable.length && (
                <span className="ml-1 text-slate-400">
                  ({filtered.length - mappable.length} sin coordenadas)
                </span>
              )}
            </div>
          </div>
        )}

        {/* Google Map */}
        {!isLoaded ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400">Cargando mapa…</p>
          </div>
        ) : (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={LIMA_CENTER}
            zoom={13}
            options={MAP_OPTIONS}
            onLoad={map => setMapRef(map)}
            onClick={() => setSelectedId(null)}
          >
            {/* Markers are created imperatively in useEffect above */}

            {selectedRecord && getCoords(selectedRecord.data) && (
              <InfoWindow
                position={getCoords(selectedRecord.data)!}
                onCloseClick={() => setSelectedId(null)}
                options={{
                  pixelOffset: new window.google.maps.Size(0, -38),
                  maxWidth: 240,
                }}
              >
                <MapPopup record={selectedRecord} onOpenDetail={r => { onOpenDetail(r); setSelectedId(null) }} />
              </InfoWindow>
            )}
          </GoogleMap>
        )}
      </div>
    </div>
  )
}
