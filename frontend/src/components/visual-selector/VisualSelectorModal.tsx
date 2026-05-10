import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, MousePointer2, Sparkles, RotateCcw, Check, Plus, Trash2, Eye,
} from 'lucide-react'
import Badge from '../ui/Badge'

type Mode = 'manual' | 'ai'

interface CapturedField {
  id: string
  name: string
  selector: string
  preview: string
  matches: number
  type: 'text' | 'url' | 'number' | 'image'
  confidence?: number
  enabled: boolean
}

interface ValidationResult {
  card_count: number
  results: Array<{
    name: string
    selector: string
    found: number
    missing: number
    total: number
  }>
  preview: Array<Record<string, string | null>>
}

interface VisualSelectorModalProps {
  open: boolean
  url: string
  onClose: () => void
  onConfirm: (payload: { cardSelector?: string; fields: CapturedField[] }) => void
}

let _id = 0
const uid = () => `vs_${++_id}`

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
const wsUrl = apiUrl.replace(/\/api\/?$/, '').replace(/^http/, 'ws') + '/ws/visual-selector'

const confidenceColor = (value?: number) => {
  if (value == null) return 'gray'
  if (value >= 0.9) return 'green'
  if (value >= 0.7) return 'yellow'
  return 'red'
}

export default function VisualSelectorModal({ open, url, onClose, onConfirm }: VisualSelectorModalProps) {
  const wsRef = useRef<WebSocket | null>(null)
  const sessionRef = useRef<string | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const lastHoverRef = useRef(0)
  const scrollYRef = useRef(0)
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('manual')
  const [selectionEnabled, setSelectionEnabled] = useState(true)
  const [fields, setFields] = useState<CapturedField[]>([])
  const [cardSelector, setCardSelector] = useState('')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [errors, setErrors] = useState<string | null>(null)
  const [loadingAI, setLoadingAI] = useState(false)
  const [validating, setValidating] = useState(false)
  const [wsConnecting, setWsConnecting] = useState(true)
  const [scrolling, setScrolling] = useState(false)

  const enabledFields = useMemo(() => fields.filter(f => f.enabled && f.selector.trim()), [fields])

  useEffect(() => {
    if (!open) return
    setFields([])
    setCardSelector('')
    setValidation(null)
    setErrors(null)
    setScreenshot(null)
    setSessionId(null)
    sessionRef.current = null
    setViewport(null)
    setMode('manual')
    setSelectionEnabled(true)
    setWsConnecting(true)
    scrollYRef.current = 0

    // Timeout: si en 50s no llega session_started, mostrar error accionable
    const loadTimeout = setTimeout(() => {
      setWsConnecting(false)
      if (!sessionRef.current) {
        setErrors('No se pudo conectar al backend. Verifica que el servidor está activo e inténtalo de nuevo.')
      }
    }, 50_000)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        type: 'start_session',
        url,
        viewport: { width: 1280, height: 720 },
      }))
    })

    ws.addEventListener('error', () => {
      setWsConnecting(false)
      setErrors('Error de conexión con el backend. Asegúrate de que el servidor está corriendo en localhost:8000.')
    })

    ws.addEventListener('close', (event) => {
      setWsConnecting(false)
      if (!sessionRef.current && event.code !== 1000) {
        setErrors('La conexión con el backend se cerró inesperadamente. Intenta abrir el selector de nuevo.')
      }
    })

    ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data)
      if (payload.type === 'session_started') {
        clearTimeout(loadTimeout)
        setWsConnecting(false)
        setSessionId(payload.session_id)
        sessionRef.current = payload.session_id
        setViewport(payload.viewport)
        setScreenshot(payload.screenshot)
        return
      }
      if (payload.type === 'snapshot') {
        setScreenshot(payload.screenshot)
        return
      }
      if (payload.type === 'selection') {
        if (payload.screenshot) setScreenshot(payload.screenshot)
        const data = payload.data
        const preview = data.preview || data.text || ''
        const inferredType = data.tag_name === 'a' || /^https?:\/\//i.test(preview) ? 'url' : 'text'
        setFields(prev => ([
          ...prev,
          {
            id: uid(),
            name: '',
            selector: data.selector || '',
            preview: preview || '',
            matches: data.matches ?? 0,
            type: inferredType,
            enabled: true,
          },
        ]))
        return
      }
      if (payload.type === 'ai_result') {
        setLoadingAI(false)
        const data = payload.data || {}
        setCardSelector(data.card_selector || '')
        setFields((data.fields || []).map((field: any) => ({
          id: uid(),
          name: field.name || '',
          selector: field.selector || '',
          preview: '',
          matches: 0,
          type: field.type || 'text',
          confidence: field.confidence,
          enabled: true,
        })))
        return
      }
      if (payload.type === 'validation_result') {
        setValidating(false)
        setValidation(payload.data || null)
        if (payload.errors?.length) {
          setErrors(payload.errors.join(' '))
        } else {
          setErrors(null)
        }
        return
      }
      if (payload.type === 'error') {
        setLoadingAI(false)
        setValidating(false)
        setErrors(payload.message || 'Error inesperado')
        return
      }
    })

    return () => {
      clearTimeout(loadTimeout)
      if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current)
      if (wsRef.current) {
        if (sessionRef.current) {
          wsRef.current.send(JSON.stringify({ type: 'end_session', session_id: sessionRef.current }))
        }
        wsRef.current.close()
      }
    }
  }, [open, url])

  const toViewportCoords = (event: React.MouseEvent) => {
    if (!viewport || !imageRef.current) return null
    const rect = imageRef.current.getBoundingClientRect()
    const x = (event.clientX - rect.left) * (viewport.width / rect.width)
    const y = (event.clientY - rect.top) * (viewport.height / rect.height)
    return {
      x: Math.max(0, Math.min(viewport.width, Math.round(x))),
      y: Math.max(0, Math.min(viewport.height, Math.round(y))),
    }
  }

  const send = (payload: Record<string, any>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify(payload))
  }

  const handleWheel = (event: React.WheelEvent) => {
    if (!sessionId) return
    event.preventDefault()
    scrollYRef.current = Math.max(0, scrollYRef.current + event.deltaY)
    setScrolling(true)
    if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current)
    scrollDebounceRef.current = setTimeout(() => {
      send({ type: 'scroll', session_id: sessionId, scroll_y: Math.round(scrollYRef.current) })
      setScrolling(false)
    }, 80)
  }

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!selectionEnabled || mode !== 'manual') return
    const now = Date.now()
    if (now - lastHoverRef.current < 250) return  // 250ms: menos frecuente, JPEG compensa
    lastHoverRef.current = now
    const coords = toViewportCoords(event)
    if (!coords) return
    send({ type: 'hover', session_id: sessionId, ...coords })
  }

  const handleClick = (event: React.MouseEvent) => {
    const coords = toViewportCoords(event)
    if (!coords) return
    if (!selectionEnabled || mode !== 'manual') {
      // Modo interacción: clic real en la página (cookies, modales, etc.)
      send({ type: 'free_click', session_id: sessionId, ...coords })
      return
    }
    send({ type: 'select', session_id: sessionId, ...coords })
  }

  const handleValidate = () => {
    if (!sessionId || enabledFields.length === 0) return
    setValidating(true)
    send({
      type: 'validate',
      session_id: sessionId,
      card_selector: cardSelector.trim() || null,
      fields: enabledFields.map(field => ({
        name: field.name || 'campo',
        selector: field.selector,
        type: field.type,
      })),
    })
  }

  const handleGenerateAI = () => {
    if (!sessionId) return
    setLoadingAI(true)
    setErrors(null)
    send({ type: 'ai_generate', session_id: sessionId })
  }

  const handleConfirm = () => {
    onConfirm({
      cardSelector: cardSelector.trim() || undefined,
      fields: enabledFields,
    })
    onClose()
  }

  const handleUndo = () => {
    setFields(prev => prev.slice(0, -1))
  }

  const updateField = (id: string, patch: Partial<CapturedField>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm">
      <div className="absolute inset-4 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500">URL activa</p>
            <p className="text-sm font-semibold text-gray-900 truncate">{url}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode('manual')}
              className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition ${
                mode === 'manual' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-600'
              }`}
            >
              <MousePointer2 className="w-4 h-4 inline-block mr-1.5" />
              Manual
            </button>
            <button
              onClick={() => setMode('ai')}
              className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition ${
                mode === 'ai' ? 'border-purple-500 text-purple-600 bg-purple-50' : 'border-gray-200 text-gray-600'
              }`}
            >
              <Sparkles className="w-4 h-4 inline-block mr-1.5" />
              Asistido por IA
            </button>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-[1.2fr_0.8fr] gap-0">
          {/* Left panel */}
          <div className="border-r border-gray-100 bg-gray-50 flex flex-col">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Eye className="w-4 h-4" />
                {mode === 'manual' ? 'Selector visual activo' : 'Vista de la página'}
              </div>
              {mode === 'manual' && (
                <button
                  onClick={() => setSelectionEnabled(v => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    selectionEnabled
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  }`}
                  title={selectionEnabled ? 'Haz clic sobre elementos para capturar selectores' : 'Modo libre: haz clic en la página para interactuar (aceptar cookies, cerrar modales, etc.)'}
                >
                  {selectionEnabled ? '🟢 Selección ON' : '🔵 Interacción'}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-auto p-4">
              {screenshot ? (
                <div className="relative">
                  <img
                    ref={imageRef}
                    src={screenshot}
                    alt="Visual selector"
                    className={`w-full rounded-xl shadow-sm border border-gray-200 bg-white select-none transition-opacity duration-100 ${
                      scrolling ? 'opacity-70' : 'opacity-100'
                    }`}
                    draggable={false}
                    onWheel={handleWheel}
                    onMouseMove={handleMouseMove}
                    onClick={handleClick}
                    style={{ cursor: selectionEnabled && mode === 'manual' ? 'crosshair' : 'default' }}
                  />
                  {scrolling && (
                    <div className="absolute top-2 right-2 bg-black/50 text-white text-[10px] px-2 py-1 rounded-md">
                      Cargando...
                    </div>
                  )}
                  <p className="mt-2 text-center text-[10px] text-gray-400">
                    🖱 Usa la rueda del mouse para hacer scroll en la página
                  </p>
                </div>
              ) : errors ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-sm">
                  <p className="text-red-500 text-center max-w-xs">{errors}</p>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg bg-gray-900 text-white text-xs hover:bg-gray-700"
                  >
                    Cerrar e intentar de nuevo
                  </button>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-gray-400">
                  <div className="w-7 h-7 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                  <span>Abriendo navegador y cargando página...</span>
                  <span className="text-xs text-gray-300">{url}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex flex-col h-full">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">
                  {mode === 'manual' ? 'Campos capturados' : 'Campos detectados por IA'}
                </p>
                <p className="text-sm font-semibold text-gray-900">{fields.length} campo{fields.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                {mode === 'ai' && (
                  <button
                    onClick={handleGenerateAI}
                    className="px-3 py-2 rounded-lg text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700"
                  >
                    {loadingAI ? 'Generando...' : fields.length ? 'Regenerar' : 'Generar con IA'}
                  </button>
                )}
                <button
                  onClick={handleValidate}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:bg-gray-800"
                  disabled={validating || enabledFields.length === 0}
                >
                  {validating ? 'Validando...' : 'Validar selectores'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-4">
              <div className={`border rounded-xl p-3 ${mode === 'ai' ? 'bg-purple-50 border-purple-100' : 'bg-blue-50 border-blue-100'}`}>
                <label className={`text-xs font-medium ${mode === 'ai' ? 'text-purple-700' : 'text-blue-700'}`}>
                  Selector del contenedor (card)
                </label>
                <p className={`text-xs mt-0.5 mb-2 ${mode === 'ai' ? 'text-purple-500' : 'text-blue-500'}`}>
                  CSS del elemento repetido que agrupa cada card. Ej: <code className="font-mono">div.listing-card</code>
                </p>
                <input
                  value={cardSelector}
                  onChange={e => setCardSelector(e.target.value)}
                  className={`w-full border rounded-lg px-3 py-2 text-xs font-mono bg-white ${mode === 'ai' ? 'border-purple-100' : 'border-blue-200'}`}
                  placeholder="div.card, article.proyecto, li.item..."
                />
              </div>

              {fields.length === 0 && (
                <div className="text-sm text-gray-400 text-center py-10">
                  {mode === 'manual'
                    ? 'Haz clic sobre la página para capturar un campo.'
                    : 'Genera los campos con IA para continuar.'}
                </div>
              )}

              {fields.map(field => (
                <div key={field.id} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={field.enabled}
                      onChange={e => updateField(field.id, { enabled: e.target.checked })}
                    />
                    <input
                      value={field.name}
                      onChange={e => updateField(field.id, { name: e.target.value })}
                      placeholder="nombre_campo"
                      className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs"
                    />
                    {field.confidence != null && (
                      <Badge variant={confidenceColor(field.confidence)}>
                        {Math.round(field.confidence * 100)}%
                      </Badge>
                    )}
                    <select
                      value={field.type}
                      onChange={e => updateField(field.id, { type: e.target.value as CapturedField['type'] })}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-xs"
                    >
                      <option value="text">text</option>
                      <option value="url">url</option>
                      <option value="number">number</option>
                      <option value="image">image</option>
                    </select>
                    <button
                      onClick={() => setFields(prev => prev.filter(f => f.id !== field.id))}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    value={field.selector}
                    onChange={e => updateField(field.id, { selector: e.target.value })}
                    placeholder=".card .price"
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                  />
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Preview: {field.preview || '—'}</span>
                    <span>{field.matches ? `${field.matches} coincidencias` : 'sin coincidencias'}</span>
                  </div>
                </div>
              ))}

              {mode === 'manual' && (
                <button
                  onClick={() => setFields(prev => ([
                    ...prev,
                    {
                      id: uid(),
                      name: '',
                      selector: '',
                      preview: '',
                      matches: 0,
                      type: 'text',
                      enabled: true,
                    },
                  ]))}
                  className="flex items-center gap-2 text-xs text-blue-600 hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" /> Agregar campo
                </button>
              )}

              {validation && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs space-y-2">
                  <p className="font-semibold text-gray-700">Resultado de validación</p>
                  {validation.results.map((item, idx) => (
                    <div key={`${item.selector}-${idx}`} className="flex justify-between">
                      <span className="text-gray-600">{item.name}</span>
                      <span className="text-gray-500">
                        {item.found}/{item.total} encontrados
                      </span>
                    </div>
                  ))}
                  {validation.preview.length > 0 && (
                    <pre className="bg-white border border-gray-200 rounded-lg p-2 overflow-auto text-[10px] text-gray-600">
                      {JSON.stringify(validation.preview, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {errors && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {errors}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {mode === 'manual' && fields.length > 0 && (
                  <button
                    onClick={handleUndo}
                    className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Deshacer
                  </button>
                )}
                <button
                  onClick={() => setFields([])}
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Limpiar todo
                </button>
              </div>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 flex items-center gap-1.5"
                disabled={enabledFields.length === 0}
              >
                <Check className="w-4 h-4" /> Confirmar →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
