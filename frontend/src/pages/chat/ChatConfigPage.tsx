import { useState, useEffect } from 'react'
import { Save, Settings, Cpu, FlaskConical, CheckCircle, XCircle, Loader2, Clock } from 'lucide-react'
import { getChatConfig, updateChatConfig, testAIModel } from '../../services/api'

interface Config {
  top_n_properties: number
  greeting_message: string
  contact_message: string
  no_results_message: string
  no_more_message: string
  ai_model: string
}

const AI_MODELS: { id: string; name: string; badge: string; badgeColor: string; desc: string; provider: 'anthropic' | 'openai' }[] = [
  // ── Anthropic ──
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    badge: 'Recomendado',
    badgeColor: 'bg-indigo-100 text-indigo-600',
    desc: 'Balance óptimo entre velocidad, calidad y costo. Ideal para producción.',
    provider: 'anthropic',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    badge: 'Rápido',
    badgeColor: 'bg-emerald-100 text-emerald-600',
    desc: 'El más veloz y económico. Bueno para respuestas simples y alto volumen.',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    badge: 'Máxima calidad',
    badgeColor: 'bg-amber-100 text-amber-600',
    desc: 'El más capaz de Anthropic. Mayor costo y latencia.',
    provider: 'anthropic',
  },
  // ── OpenAI ──
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    badge: 'OpenAI',
    badgeColor: 'bg-green-100 text-green-600',
    desc: 'Modelo principal de OpenAI. Multimodal, rápido y con alta capacidad de razonamiento.',
    provider: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    badge: 'OpenAI · Rápido',
    badgeColor: 'bg-green-100 text-green-600',
    desc: 'Versión ligera de GPT-4o. Muy económico, ideal para alto volumen de conversaciones.',
    provider: 'openai',
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    badge: 'OpenAI',
    badgeColor: 'bg-green-100 text-green-600',
    desc: 'Última generación de GPT-4. Mayor precisión en seguimiento de instrucciones.',
    provider: 'openai',
  },
]

const FIELDS: { key: keyof Omit<Config, 'ai_model'>; label: string; type: 'number' | 'textarea'; hint?: string }[] = [
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

interface TestResult {
  model: string
  provider: string
  response: string
  latency_ms: number
  ok: boolean
  error: string | null
}

export default function ChatConfigPage() {
  const [config, setConfig] = useState<Config | null>(null)
  const [form, setForm] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testPrompt, setTestPrompt] = useState('¿Cuántas habitaciones tiene un departamento estándar?')
  const [testResults, setTestResults] = useState<Record<string, TestResult | 'loading'>>({})

  const handleTest = async (model: string) => {
    setTestResults(r => ({ ...r, [model]: 'loading' }))
    try {
      const res = await testAIModel(model, testPrompt)
      setTestResults(r => ({ ...r, [model]: res.data }))
    } catch {
      setTestResults(r => ({ ...r, [model]: { model, provider: model.startsWith('gpt') ? 'openai' : 'anthropic', response: '', latency_ms: 0, ok: false, error: 'Error de red' } }))
    }
  }

  const handleTestAll = () => {
    const anthropicModel = AI_MODELS.find(m => m.provider === 'anthropic')!.id
    const openaiModel = AI_MODELS.find(m => m.provider === 'openai')!.id
    handleTest(anthropicModel)
    handleTest(openaiModel)
  }

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

      {/* ── Modelo de IA ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-indigo-500" />
          <span className="font-semibold text-slate-800 text-sm">Modelo de inteligencia artificial</span>
        </div>
        <p className="text-xs text-slate-400">El modelo de Anthropic que usará el chatbot para entender y responder a los usuarios.</p>
        {(['anthropic', 'openai'] as const).map(provider => (
          <div key={provider} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1">
              {provider === 'anthropic' ? 'Anthropic' : 'OpenAI / ChatGPT'}
            </p>
            {AI_MODELS.filter(m => m.provider === provider).map(m => {
              const selected = form.ai_model === m.id
              return (
                <label
                  key={m.id}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                    selected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="ai_model"
                    value={m.id}
                    checked={selected}
                    onChange={() => setForm(f => f ? { ...f, ai_model: m.id } : f)}
                    className="mt-0.5 accent-indigo-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-800 text-sm">{m.name}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.badgeColor}`}>{m.badge}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{m.desc}</p>
                    <p className="text-[10px] font-mono text-slate-300 mt-1">{m.id}</p>
                  </div>
                </label>
              )
            })}
          </div>
        ))}
      </div>

      {/* ── Panel de prueba ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-violet-500" />
            <span className="font-semibold text-slate-800 text-sm">Probar proveedores</span>
          </div>
          <button
            onClick={handleTestAll}
            disabled={Object.values(testResults).some(r => r === 'loading')}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {Object.values(testResults).some(r => r === 'loading')
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Probando...</>
              : <><FlaskConical className="w-3.5 h-3.5" /> Probar ambos</>}
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Mensaje de prueba</label>
          <input
            value={testPrompt}
            onChange={e => setTestPrompt(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="Escribe un mensaje para probar..."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(['anthropic', 'openai'] as const).map(provider => {
            const repModel = AI_MODELS.find(m => m.provider === provider)!
            const result = testResults[repModel.id]
            return (
              <div key={provider} className={`rounded-xl border-2 p-4 space-y-3 transition-colors ${
                !result ? 'border-slate-200 bg-slate-50'
                : result === 'loading' ? 'border-violet-200 bg-violet-50'
                : (result as TestResult).ok ? 'border-emerald-200 bg-emerald-50'
                : 'border-red-200 bg-red-50'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                    </p>
                    <p className="text-[11px] font-mono text-slate-400">{repModel.id}</p>
                  </div>
                  <button
                    onClick={() => handleTest(repModel.id)}
                    disabled={result === 'loading'}
                    className="text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-colors"
                  >
                    {result === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Probar'}
                  </button>
                </div>

                {!result && (
                  <p className="text-xs text-slate-400 italic">Sin resultado aún. Pulsa "Probar" o "Probar ambos".</p>
                )}
                {result === 'loading' && (
                  <div className="flex items-center gap-2 text-xs text-violet-600">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Esperando respuesta...
                  </div>
                )}
                {result && result !== 'loading' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      {(result as TestResult).ok
                        ? <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        : <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                      <span className={`text-xs font-semibold ${(result as TestResult).ok ? 'text-emerald-700' : 'text-red-700'}`}>
                        {(result as TestResult).ok ? 'Conexión exitosa' : 'Error de conexión'}
                      </span>
                      <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-400">
                        <Clock className="w-3 h-3" />{(result as TestResult).latency_ms} ms
                      </span>
                    </div>
                    {(result as TestResult).ok ? (
                      <p className="text-xs text-slate-700 bg-white rounded-lg p-2.5 border border-slate-200 leading-relaxed">
                        {(result as TestResult).response}
                      </p>
                    ) : (
                      <p className="text-xs text-red-600 bg-white rounded-lg p-2.5 border border-red-200 font-mono break-all">
                        {(result as TestResult).error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Mensajes y comportamiento ── */}
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
