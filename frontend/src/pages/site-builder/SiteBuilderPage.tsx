import { useState, useEffect } from 'react'
import { Plus, Trash2, GripVertical, ExternalLink, Save } from 'lucide-react'
import API from '../../services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CardField {
  key: string
  label: string
  type: string
}

interface SiteConfig {
  site_name: string
  tagline: string
  primary_color: string
  secondary_color: string
  logo_text: string
  show_hero: boolean
  hero_title: string
  hero_subtitle: string
  hero_cta_text: string
  hero_bg_color: string
  show_carousel: boolean
  carousel_title: string
  carousel_field_image: string
  show_listing: boolean
  listing_title: string
  listing_columns: string
  footer_text: string
  footer_contact: string
  card_fields: CardField[]
  chatbot_enabled: boolean
  chatbot_greeting: string
  chatbot_button_label: string
}

const FIELD_TYPES = [
  { value: 'title', label: 'Título principal' },
  { value: 'price', label: 'Precio (destacado)' },
  { value: 'text', label: 'Texto simple' },
  { value: 'badge', label: 'Etiqueta / Badge' },
  { value: 'image', label: 'Imagen' },
  { value: 'link', label: 'Enlace' },
]

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{title}</h2>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-slate-300'}`}
      >
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  )
}

// ─── Card Fields Editor ────────────────────────────────────────────────────────

function CardFieldsEditor({ fields, onChange }: {
  fields: CardField[]
  onChange: (fields: CardField[]) => void
}) {
  const [newField, setNewField] = useState<CardField>({ key: '', label: '', type: 'text' })

  const add = () => {
    if (!newField.key.trim() || !newField.label.trim()) return
    onChange([...fields, { ...newField, key: newField.key.trim(), label: newField.label.trim() }])
    setNewField({ key: '', label: '', type: 'text' })
  }

  const remove = (i: number) => onChange(fields.filter((_, idx) => idx !== i))

  const move = (i: number, dir: -1 | 1) => {
    const next = [...fields]
    const j = i + dir
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  const update = (i: number, patch: Partial<CardField>) => {
    onChange(fields.map((f, idx) => idx === i ? { ...f, ...patch } : f))
  }

  return (
    <div className="space-y-3">
      {fields.map((field, i) => (
        <div key={i} className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg bg-slate-50">
          <div className="flex flex-col gap-0.5">
            <button onClick={() => move(i, -1)} className="text-slate-400 hover:text-slate-600 disabled:opacity-30" disabled={i === 0}>
              <GripVertical className="w-3.5 h-3.5 rotate-90" />
            </button>
            <button onClick={() => move(i, 1)} className="text-slate-400 hover:text-slate-600 disabled:opacity-30" disabled={i === fields.length - 1}>
              <GripVertical className="w-3.5 h-3.5 rotate-90 scale-y-[-1]" />
            </button>
          </div>
          <input
            value={field.key}
            onChange={e => update(i, { key: e.target.value })}
            placeholder="clave"
            className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            value={field.label}
            onChange={e => update(i, { label: e.target.value })}
            placeholder="Etiqueta"
            className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <select
            value={field.type}
            onChange={e => update(i, { type: e.target.value })}
            className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button onClick={() => remove(i)} className="p-1 text-slate-400 hover:text-red-500 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {/* Add new field */}
      <div className="flex items-center gap-2 p-2 border border-dashed border-slate-300 rounded-lg">
        <input
          value={newField.key}
          onChange={e => setNewField(f => ({ ...f, key: e.target.value }))}
          placeholder="clave_campo"
          className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <input
          value={newField.label}
          onChange={e => setNewField(f => ({ ...f, label: e.target.value }))}
          placeholder="Etiqueta visible"
          className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={newField.type}
          onChange={e => setNewField(f => ({ ...f, type: e.target.value }))}
          className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button
          onClick={add}
          disabled={!newField.key.trim() || !newField.label.trim()}
          className="p-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-xs text-slate-400">
        La <strong>clave</strong> debe coincidir exactamente con el campo del registro scrapeado (ej. <code>price</code>, <code>location</code>).
      </p>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SiteBuilderPage() {
  const [config, setConfig] = useState<SiteConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    API.get('/site/config').then(r => setConfig(r.data))
  }, [])

  const set = (patch: Partial<SiteConfig>) => setConfig(c => c ? { ...c, ...patch } : c)

  const save = async () => {
    if (!config) return
    setSaving(true)
    try {
      await API.put('/site/config', config)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  if (!config) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Cargando configuración...</div>
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Constructor del sitio público</h1>
          <p className="text-sm text-slate-500 mt-1">Configura cómo se ve el portal visible para los usuarios</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/public"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Vista previa
          </a>
          <button
            onClick={save}
            disabled={saving}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors ${
              saved ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'
            } disabled:opacity-50`}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Guardando...' : saved ? '¡Guardado!' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {/* General */}
      <Section title="General">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nombre del sitio">
            <Input value={config.site_name} onChange={v => set({ site_name: v })} />
          </Field>
          <Field label="Eslogan (opcional)">
            <Input value={config.tagline || ''} onChange={v => set({ tagline: v })} placeholder="Tu eslogan aquí..." />
          </Field>
          <Field label="Texto del logo (deja vacío para usar el nombre)">
            <Input value={config.logo_text || ''} onChange={v => set({ logo_text: v })} />
          </Field>
        </div>
        <div className="flex gap-6">
          <Field label="Color primario">
            <div className="flex items-center gap-2">
              <input type="color" value={config.primary_color} onChange={e => set({ primary_color: e.target.value })}
                className="w-10 h-9 rounded border border-slate-200 cursor-pointer p-0.5" />
              <Input value={config.primary_color} onChange={v => set({ primary_color: v })} />
            </div>
          </Field>
          <Field label="Color secundario (precios, CTA)">
            <div className="flex items-center gap-2">
              <input type="color" value={config.secondary_color} onChange={e => set({ secondary_color: e.target.value })}
                className="w-10 h-9 rounded border border-slate-200 cursor-pointer p-0.5" />
              <Input value={config.secondary_color} onChange={v => set({ secondary_color: v })} />
            </div>
          </Field>
        </div>
      </Section>

      {/* Hero */}
      <Section title="Sección Hero (portada)">
        <Toggle value={config.show_hero} onChange={v => set({ show_hero: v })} label="Mostrar hero" />
        {config.show_hero && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Título principal">
              <Input value={config.hero_title} onChange={v => set({ hero_title: v })} />
            </Field>
            <Field label="Subtítulo">
              <Input value={config.hero_subtitle || ''} onChange={v => set({ hero_subtitle: v })} />
            </Field>
            <Field label="Texto del botón CTA">
              <Input value={config.hero_cta_text} onChange={v => set({ hero_cta_text: v })} />
            </Field>
            <Field label="Color de fondo del hero">
              <div className="flex items-center gap-2">
                <input type="color" value={config.hero_bg_color} onChange={e => set({ hero_bg_color: e.target.value })}
                  className="w-10 h-9 rounded border border-slate-200 cursor-pointer p-0.5" />
                <Input value={config.hero_bg_color} onChange={v => set({ hero_bg_color: v })} />
              </div>
            </Field>
          </div>
        )}
      </Section>

      {/* Carousel */}
      <Section title="Carrusel de destacados">
        <Toggle value={config.show_carousel} onChange={v => set({ show_carousel: v })} label="Mostrar carrusel" />
        {config.show_carousel && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Título del carrusel">
              <Input value={config.carousel_title} onChange={v => set({ carousel_title: v })} />
            </Field>
            <Field label="Campo de imagen (clave del dato)">
              <Input value={config.carousel_field_image} onChange={v => set({ carousel_field_image: v })}
                placeholder="ej. image_url, foto, thumbnail" />
            </Field>
          </div>
        )}
      </Section>

      {/* Listing */}
      <Section title="Listado de propiedades">
        <Toggle value={config.show_listing} onChange={v => set({ show_listing: v })} label="Mostrar listado" />
        {config.show_listing && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Título de la sección">
              <Input value={config.listing_title} onChange={v => set({ listing_title: v })} />
            </Field>
            <Field label="Columnas por fila">
              <select
                value={config.listing_columns}
                onChange={e => set({ listing_columns: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="2">2 columnas</option>
                <option value="3">3 columnas</option>
                <option value="4">4 columnas</option>
              </select>
            </Field>
          </div>
        )}
      </Section>

      {/* Card fields */}
      <Section title="Campos de la tarjeta de propiedad">
        <p className="text-xs text-slate-500 -mt-2">
          Define qué datos del registro scrapeado mostrar en cada tarjeta y cómo presentarlos.
        </p>
        <CardFieldsEditor
          fields={config.card_fields}
          onChange={fields => set({ card_fields: fields })}
        />
      </Section>

      {/* Footer */}
      <Section title="Footer">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Texto del footer">
            <Input value={config.footer_text || ''} onChange={v => set({ footer_text: v })}
              placeholder="© 2025 Mi Portal Inmobiliario" />
          </Field>
          <Field label="Contacto en el footer">
            <Input value={config.footer_contact || ''} onChange={v => set({ footer_contact: v })}
              placeholder="contacto@portal.com" />
          </Field>
        </div>
      </Section>

      {/* Chatbot */}
      <Section title="Chatbot del sitio">
        <Toggle value={config.chatbot_enabled} onChange={v => set({ chatbot_enabled: v })} label="Mostrar chatbot flotante" />
        {config.chatbot_enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Texto del botón flotante">
              <Input value={config.chatbot_button_label} onChange={v => set({ chatbot_button_label: v })} />
            </Field>
            <div />
            <Field label="Mensaje inicial del chatbot">
              <textarea
                value={config.chatbot_greeting}
                onChange={e => set({ chatbot_greeting: e.target.value })}
                rows={3}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
          </div>
        )}
      </Section>

      {/* Save (bottom) */}
      <div className="flex justify-end pb-6">
        <button
          onClick={save}
          disabled={saving}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-sm font-medium transition-colors ${
            saved ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'
          } disabled:opacity-50`}
        >
          <Save className="w-4 h-4" />
          {saving ? 'Guardando...' : saved ? '¡Guardado!' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
