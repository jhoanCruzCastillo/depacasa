import { useState, useEffect } from 'react'
import { Save, Settings } from 'lucide-react'
import { getChatConfig, updateChatConfig } from '../../services/api'

interface Config {
  top_n_properties: number
  greeting_message: string
  contact_message: string
  no_results_message: string
  no_more_message: string
}

const FIELDS: { key: keyof Config; label: string; type: 'number' | 'textarea'; hint?: string }[] = [
  {
    key: 'top_n_properties',
    label: 'Propiedades máximas por sesión',
    type: 'number',
    hint: 'Máximo de propiedades que el chatbot puede mostrar en una conversación.',
  },
  {
    key: 'greeting_message',
    label: 'Mensaje de saludo',
    type: 'textarea',
    hint: 'Se envía cuando un usuario inicia conversación. Usa {user_name} para el nombre.',
  },
  {
    key: 'contact_message',
    label: 'Mensaje de confirmación de contacto',
    type: 'textarea',
    hint: 'Se envía cuando el usuario hace clic en "Lo quiero".',
  },
  {
    key: 'no_results_message',
    label: 'Mensaje sin resultados',
    type: 'textarea',
    hint: 'Se envía cuando el matchmaking no encuentra propiedades.',
  },
  {
    key: 'no_more_message',
    label: 'Mensaje sin más propiedades',
    type: 'textarea',
    hint: 'Se envía cuando el usuario ha visto todas las propiedades disponibles.',
  },
]

export default function ChatConfigPage() {
  const [config, setConfig] = useState<Config | null>(null)
  const [form, setForm] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getChatConfig()
      .then(res => { setConfig(res.data); setForm(res.data) })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    if (!form) return
    setSaving(true)
    try {
      const res = await updateChatConfig(form)
      setConfig(res.data)
      setForm(res.data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const isDirty = form && config && JSON.stringify(form) !== JSON.stringify(config)

  if (loading || !form) return <div className="flex items-center justify-center h-64 text-slate-400">Cargando configuración...</div>

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-slate-400" />
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Configuración del Chatbot</h1>
          <p className="text-sm text-slate-500 mt-0.5">Ajusta el comportamiento y mensajes del asistente.</p>
        </div>
      </div>

      <div className="space-y-5">
        {FIELDS.map(field => (
          <div key={field.key} className="bg-white rounded-xl border border-slate-200 p-5 space-y-2">
            <label className="block font-medium text-slate-700 text-sm">{field.label}</label>
            {field.hint && <p className="text-xs text-slate-400">{field.hint}</p>}
            {field.type === 'number' ? (
              <input
                type="number"
                min={1}
                max={20}
                value={form[field.key] as number}
                onChange={e => setForm(f => f ? { ...f, [field.key]: parseInt(e.target.value) || 3 } : f)}
                className="w-24 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <textarea
                value={form[field.key] as string}
                onChange={e => setForm(f => f ? { ...f, [field.key]: e.target.value } : f)}
                rows={4}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-green-600 font-medium">Guardado correctamente</span>}
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
