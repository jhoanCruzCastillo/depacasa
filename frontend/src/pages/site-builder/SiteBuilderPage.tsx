import { useState, useEffect, useCallback } from 'react'
import { Save, ExternalLink, Search, X, Check, ChevronLeft, ChevronRight, Building2 } from 'lucide-react'
import API from '../../services/api'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SiteConfig {
  site_name: string; tagline: string; logo_text: string
  primary_color: string; secondary_color: string
  footer_text: string; footer_contact: string
  show_hero: boolean; hero_title: string; hero_subtitle: string
  hero_cta_text: string; hero_bg_color: string; hero_record_ids: string[]
  featured_enabled: boolean; featured_title: string; featured_level: number
  featured_limit: number; featured_field_keys: string[]
  catalog_enabled: boolean; catalog_title: string; catalog_level: number
  catalog_columns: string; catalog_field_keys: string[]
  chatbot_enabled: boolean; chatbot_button_label: string; chatbot_greeting: string
}

interface BrowseRecord { id: string; data: Record<string, unknown> }

const BLANK: SiteConfig = {
  site_name: 'Mi Portal Inmobiliario', tagline: '', logo_text: '',
  primary_color: '#2563eb', secondary_color: '#059669',
  footer_text: '© 2025 Portal Inmobiliario', footer_contact: '',
  show_hero: true, hero_title: 'Encuentra tu propiedad ideal',
  hero_subtitle: 'Explora los mejores proyectos disponibles',
  hero_cta_text: 'Explorar propiedades', hero_bg_color: '#1e3a5f', hero_record_ids: [],
  featured_enabled: true, featured_title: 'Proyectos destacados',
  featured_level: 2, featured_limit: 6, featured_field_keys: [],
  catalog_enabled: true, catalog_title: 'Propiedades disponibles',
  catalog_level: 2, catalog_columns: '3', catalog_field_keys: [],
  chatbot_enabled: true, chatbot_button_label: '¿Necesitas ayuda?',
  chatbot_greeting: '¡Hola! Soy tu asistente inmobiliario. ¿Cuál es tu nombre?',
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{title}</h2>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

function Inp({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
  )
}

function Textarea({ value, onChange, rows = 2 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
  )
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-slate-300'}`}>
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  )
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5" />
      <div className="flex-1">
        <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
    </div>
  )
}

function LevelRadio({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-3">
      {[{ v: 1, label: 'Nivel 1 — Nodo raíz' }, { v: 2, label: 'Nivel 2 — Nodo hijo' }].map(opt => (
        <label key={opt.v} className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm transition-colors ${value === opt.v ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          <input type="radio" className="hidden" checked={value === opt.v} onChange={() => onChange(opt.v)} />
          {opt.label}
        </label>
      ))}
    </div>
  )
}

// ─── Field Key Selector ───────────────────────────────────────────────────────

function FieldKeySelector({ level, value, onChange }: {
  level: number; value: string[]; onChange: (v: string[]) => void
}) {
  const [discovered, setDiscovered] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    API.get('/site/fields/discover', { params: { level } })
      .then(r => setDiscovered(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [level])

  const toggle = (k: string) => {
    if (value.includes(k)) onChange(value.filter(f => f !== k))
    else onChange([...value, k])
  }

  if (loading) return <p className="text-xs text-slate-400">Cargando campos...</p>
  if (discovered.length === 0) return <p className="text-xs text-slate-400">No hay registros en este nivel aún.</p>

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">
        {value.length === 0 ? '✦ Mostrando todos los campos (auto-detectado)' : `${value.length} campo(s) seleccionados`}
      </p>
      <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
        {discovered.map(k => (
          <label key={k} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer text-xs transition-colors ${value.includes(k) ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <input type="checkbox" className="hidden" checked={value.includes(k)} onChange={() => toggle(k)} />
            <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${value.includes(k) ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}>
              {value.includes(k) && <Check className="w-2.5 h-2.5 text-white" />}
            </div>
            <span className="truncate">{k}</span>
          </label>
        ))}
      </div>
      {value.length > 0 && (
        <button onClick={() => onChange([])} className="mt-2 text-xs text-slate-400 hover:text-slate-600 underline">
          Limpiar selección (mostrar todos)
        </button>
      )}
    </div>
  )
}

// ─── Record Browser Modal ─────────────────────────────────────────────────────

const MEDIA_BASE_SB = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api').replace(/\/api\/?$/, '')
const IMG_EXT_SB = /\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)(\?.*)?$/i
const HTTP_SB = /^https?:\/\//

function getFirstImage(data: Record<string, unknown>): string | null {
  for (const [, val] of Object.entries(data)) {
    if (typeof val === 'string') {
      if (val.startsWith('/media/')) return `${MEDIA_BASE_SB}${val}`
      if (HTTP_SB.test(val) && IMG_EXT_SB.test(val)) return val
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') {
          if (item.startsWith('/media/')) return `${MEDIA_BASE_SB}${item}`
          if (HTTP_SB.test(item) && IMG_EXT_SB.test(item)) return item
        }
      }
    }
  }
  return null
}

function getFirstTitle(data: Record<string, unknown>): string {
  for (const [k, v] of Object.entries(data)) {
    if (/nombre|name|proyecto|titulo|title/i.test(k) && typeof v === 'string' && v.trim()) return v.trim()
  }
  const first = Object.values(data).find(v => typeof v === 'string' && (v as string).trim())
  return typeof first === 'string' ? first.slice(0, 60) : 'Sin título'
}

function RecordBrowserModal({ selected, onConfirm, onClose }: {
  selected: string[]
  onConfirm: (ids: string[]) => void
  onClose: () => void
}) {
  const [level, setLevel] = useState(2)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [records, setRecords] = useState<BrowseRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<string[]>(selected)

  const LIMIT = 24

  const load = useCallback(() => {
    setLoading(true)
    API.get('/site/records/browse', { params: { level, search: query, limit: LIMIT, skip: page * LIMIT } })
      .then(r => { setRecords(r.data.items); setTotal(r.data.total) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [level, query, page])

  useEffect(() => { load() }, [load])

  const toggle = (id: string) => {
    if (picked.includes(id)) setPicked(p => p.filter(x => x !== id))
    else setPicked(p => [...p, id])
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-slate-800">Seleccionar registros para el hero</h3>
            <p className="text-xs text-slate-400 mt-0.5">{picked.length} seleccionados</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0 flex-wrap">
          <div className="flex gap-2">
            {[{ v: 1, l: 'Nivel 1' }, { v: 2, l: 'Nivel 2' }].map(opt => (
              <button key={opt.v} onClick={() => { setLevel(opt.v); setPage(0) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${level === opt.v ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                {opt.l}
              </button>
            ))}
          </div>
          <div className="flex-1 flex gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setQuery(search); setPage(0) } }}
              placeholder="Buscar..." className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={() => { setQuery(search); setPage(0) }}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors">
              <Search className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : records.length === 0 ? (
            <p className="text-center text-slate-400 py-12">No hay registros.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {records.map(rec => {
                const img = getFirstImage(rec.data)
                const title = getFirstTitle(rec.data)
                const isSel = picked.includes(rec.id)
                return (
                  <button key={rec.id} onClick={() => toggle(rec.id)}
                    className={`relative rounded-xl overflow-hidden border-2 transition-all text-left ${isSel ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}>
                    <div className="h-28 bg-slate-100">
                      {img ? <img src={img} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center"><Building2 className="w-8 h-8 text-slate-300" /></div>}
                    </div>
                    <div className="p-2">
                      <p className="text-xs text-slate-700 font-medium leading-tight line-clamp-2">{title}</p>
                    </div>
                    {isSel && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 px-5 py-3 border-t border-slate-100 flex-shrink-0">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-slate-500">Pág. {page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={() => setPicked([])} className="text-xs text-slate-400 hover:text-slate-600 underline">
            Limpiar selección
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
            <button onClick={() => { onConfirm(picked); onClose() }}
              className="px-5 py-2 text-sm rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors">
              Confirmar ({picked.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = ['General', 'Hero', 'Destacados', 'Catálogo', 'Chatbot']

function GeneralTab({ cfg, set }: { cfg: SiteConfig; set: (p: Partial<SiteConfig>) => void }) {
  return (
    <div className="space-y-5">
      <Section title="Identidad">
        <Field label="Nombre del sitio"><Inp value={cfg.site_name} onChange={v => set({ site_name: v })} /></Field>
        <Field label="Tagline / subtítulo del navbar"><Inp value={cfg.tagline} onChange={v => set({ tagline: v })} placeholder="Ej: Los mejores proyectos inmobiliarios" /></Field>
        <Field label="Logo (texto)"><Inp value={cfg.logo_text} onChange={v => set({ logo_text: v })} placeholder="Vacío = usa el nombre del sitio" /></Field>
      </Section>
      <Section title="Colores">
        <ColorPicker label="Color primario" value={cfg.primary_color} onChange={v => set({ primary_color: v })} />
        <ColorPicker label="Color secundario (precios / botones de acción)" value={cfg.secondary_color} onChange={v => set({ secondary_color: v })} />
      </Section>
      <Section title="Pie de página">
        <Field label="Texto del footer"><Inp value={cfg.footer_text} onChange={v => set({ footer_text: v })} /></Field>
        <Field label="Contacto / info adicional"><Inp value={cfg.footer_contact} onChange={v => set({ footer_contact: v })} /></Field>
      </Section>
    </div>
  )
}

function HeroTab({ cfg, set }: { cfg: SiteConfig; set: (p: Partial<SiteConfig>) => void }) {
  const [showBrowser, setShowBrowser] = useState(false)

  return (
    <div className="space-y-5">
      <Section title="Textos del hero (fallback cuando no hay registros)">
        <Field label="Título principal"><Inp value={cfg.hero_title} onChange={v => set({ hero_title: v })} /></Field>
        <Field label="Subtítulo"><Inp value={cfg.hero_subtitle} onChange={v => set({ hero_subtitle: v })} /></Field>
        <Field label="Texto del botón CTA"><Inp value={cfg.hero_cta_text} onChange={v => set({ hero_cta_text: v })} /></Field>
        <ColorPicker label="Color de fondo hero" value={cfg.hero_bg_color} onChange={v => set({ hero_bg_color: v })} />
      </Section>

      <Section title="Carrusel del hero — registros destacados">
        <p className="text-xs text-slate-500">
          Selecciona los registros que aparecerán en el carrusel principal. Si está vacío se usarán los primeros registros de la sección Destacados.
        </p>

        {cfg.hero_record_ids.length > 0 && (
          <div className="bg-slate-50 rounded-xl p-3 space-y-1">
            <p className="text-xs font-semibold text-slate-500">{cfg.hero_record_ids.length} registro(s) seleccionado(s)</p>
            <div className="flex flex-wrap gap-1.5">
              {cfg.hero_record_ids.map((id, i) => (
                <span key={id} className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-mono">
                  #{i + 1} {id.slice(0, 8)}…
                  <button onClick={() => set({ hero_record_ids: cfg.hero_record_ids.filter(x => x !== id) })}
                    className="hover:text-blue-900"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          </div>
        )}

        <button onClick={() => setShowBrowser(true)}
          className="px-4 py-2 text-sm rounded-xl border border-blue-200 text-blue-600 font-medium hover:bg-blue-50 transition-colors">
          {cfg.hero_record_ids.length > 0 ? 'Cambiar selección' : 'Seleccionar registros para el hero'}
        </button>

        {showBrowser && (
          <RecordBrowserModal
            selected={cfg.hero_record_ids}
            onConfirm={ids => set({ hero_record_ids: ids })}
            onClose={() => setShowBrowser(false)}
          />
        )}
      </Section>
    </div>
  )
}

function FeaturedTab({ cfg, set }: { cfg: SiteConfig; set: (p: Partial<SiteConfig>) => void }) {
  return (
    <div className="space-y-5">
      <Section title="Configuración">
        <Toggle value={cfg.featured_enabled} onChange={v => set({ featured_enabled: v })} label="Mostrar sección destacados" />
        <Field label="Título de la sección"><Inp value={cfg.featured_title} onChange={v => set({ featured_title: v })} /></Field>
        <Field label="Nivel de registros a mostrar">
          <LevelRadio value={cfg.featured_level} onChange={v => set({ featured_level: v })} />
        </Field>
        <Field label="Cantidad de items">
          <div className="flex gap-2 flex-wrap">
            {[3, 4, 6, 8, 10, 12].map(n => (
              <button key={n} onClick={() => set({ featured_limit: n })}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${cfg.featured_limit === n ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {n}
              </button>
            ))}
          </div>
        </Field>
      </Section>
      <Section title="Campos a mostrar en las tarjetas">
        <FieldKeySelector level={cfg.featured_level} value={cfg.featured_field_keys} onChange={v => set({ featured_field_keys: v })} />
      </Section>
    </div>
  )
}

function CatalogTab({ cfg, set }: { cfg: SiteConfig; set: (p: Partial<SiteConfig>) => void }) {
  return (
    <div className="space-y-5">
      <Section title="Configuración">
        <Toggle value={cfg.catalog_enabled} onChange={v => set({ catalog_enabled: v })} label="Mostrar catálogo" />
        <Field label="Título del catálogo"><Inp value={cfg.catalog_title} onChange={v => set({ catalog_title: v })} /></Field>
        <Field label="Nivel de registros a mostrar">
          <LevelRadio value={cfg.catalog_level} onChange={v => set({ catalog_level: v })} />
        </Field>
        <Field label="Columnas">
          <div className="flex gap-2">
            {[{ v: '2', l: '2 col.' }, { v: '3', l: '3 col.' }, { v: '4', l: '4 col.' }].map(opt => (
              <button key={opt.v} onClick={() => set({ catalog_columns: opt.v })}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${cfg.catalog_columns === opt.v ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {opt.l}
              </button>
            ))}
          </div>
        </Field>
      </Section>
      <Section title="Campos a mostrar en las tarjetas">
        <FieldKeySelector level={cfg.catalog_level} value={cfg.catalog_field_keys} onChange={v => set({ catalog_field_keys: v })} />
      </Section>
    </div>
  )
}

function ChatbotTab({ cfg, set }: { cfg: SiteConfig; set: (p: Partial<SiteConfig>) => void }) {
  return (
    <div className="space-y-5">
      <Section title="Configuración del chatbot">
        <Toggle value={cfg.chatbot_enabled} onChange={v => set({ chatbot_enabled: v })} label="Habilitar chatbot en el portal" />
        <Field label="Texto del botón flotante"><Inp value={cfg.chatbot_button_label} onChange={v => set({ chatbot_button_label: v })} /></Field>
        <Field label="Mensaje de bienvenida"><Textarea value={cfg.chatbot_greeting} onChange={v => set({ chatbot_greeting: v })} rows={3} /></Field>
      </Section>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SiteBuilderPage() {
  const [tab, setTab] = useState(0)
  const [cfg, setCfg] = useState<SiteConfig>(BLANK)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    API.get('/site/config')
      .then(r => setCfg({ ...BLANK, ...r.data }))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const set = (patch: Partial<SiteConfig>) => setCfg(c => ({ ...c, ...patch }))

  const save = async () => {
    setSaving(true)
    try {
      await API.put('/site/config', cfg)
      toast.success('Configuración guardada')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Constructor del portal</h1>
          <p className="text-sm text-slate-400 mt-0.5">Configura el aspecto y contenido del portal público</p>
        </div>
        <div className="flex gap-2">
          <a href="/portal" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
            <ExternalLink className="w-4 h-4" />
            Ver portal
          </a>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors">
            <Save className="w-4 h-4" />
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${tab === i ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 0 && <GeneralTab cfg={cfg} set={set} />}
      {tab === 1 && <HeroTab cfg={cfg} set={set} />}
      {tab === 2 && <FeaturedTab cfg={cfg} set={set} />}
      {tab === 3 && <CatalogTab cfg={cfg} set={set} />}
      {tab === 4 && <ChatbotTab cfg={cfg} set={set} />}
    </div>
  )
}
