import { useEffect, useRef, useState } from 'react'
import { X, Trash2, Check, RotateCcw, Navigation2, Tag, MousePointer2, Camera, Database } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
type FieldType = 'container' | 'text' | 'url' | 'number' | 'image'
type ActiveTab = 'listing' | 'detail'

interface FieldToggles {
  is_child_url: boolean
  is_list: boolean
  is_image: boolean
  is_shared: boolean
  plain_text: boolean
  extract_attr: string
}

export interface Annotation {
  id: string
  label: string
  field_name: string
  field_type: FieldType
  selector: string
  parent_id: string | null
  is_nav_link: boolean
  tab: ActiveTab
  scroll_y: number
  viewport_rect: { x1: number; y1: number; x2: number; y2: number }
  matches: number
  preview: string
  inferring: boolean
  color: string
  context: string
  fieldHint: string
  hoverEnabled: boolean
  is_list: boolean
  is_shared: boolean
  plain_text: boolean
  extract_attr: string
}

export interface CapturedField {
  id: string
  name: string
  selector: string
  preview: string
  matches: number
  type: 'text' | 'url' | 'number' | 'image'
  confidence?: number
  enabled: boolean
  is_child_url: boolean
  is_list: boolean
  is_image: boolean
  is_shared: boolean
  plain_text: boolean
  extract_attr: string
}

export interface VisualSelectorPayload {
  cardSelector?: string
  fields: CapturedField[]
  detailContainerSelector?: string
  detailFields?: CapturedField[]
}

interface Props {
  open: boolean
  url: string
  existingFields?: Array<{ name: string; tab: ActiveTab }>
  onClose: () => void
  onConfirm: (payload: VisualSelectorPayload) => void
}

interface Popup {
  annotationId: string
  label: string
  fieldHint: string
  hoverEnabled: boolean
  popupX: number
  popupY: number
  color: string
}

interface PendingInference {
  annotationId: string
  label: string
  parentLabel?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────
let _id = 0
const uid = () => `vs_${++_id}`

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
const wsUrl = apiUrl.replace(/\/api\/?$/, '').replace(/^http/, 'ws') + '/ws/visual-selector'

const TYPE_COLOR: Record<FieldType, string> = {
  container: '#3b82f6',
  text: '#16a34a',
  url: '#9333ea',
  number: '#ea580c',
  image: '#db2777',
}

const RECT_COLORS = [
  { hex: '#3b82f6', name: 'Azul' },
  { hex: '#22c55e', name: 'Verde' },
  { hex: '#ef4444', name: 'Rojo' },
  { hex: '#f59e0b', name: 'Ámbar' },
  { hex: '#8b5cf6', name: 'Morado' },
  { hex: '#ec4899', name: 'Rosa' },
  { hex: '#14b8a6', name: 'Teal' },
]

// Mirrors PROYECTO_COLUMNS + PROPIEDAD_COLUMNS from TemplateEditorPage exactly
const STANDARD_FIELDS: { value: string; label: string; group: string; autoToggles?: Partial<FieldToggles> }[] = [
  { value: 'url_propiedad',    label: 'URL del proyecto (enlace detalle)', group: 'Proyecto', autoToggles: { is_child_url: true } },
  { value: 'nombre',           label: 'Nombre del proyecto', group: 'Proyecto' },
  { value: 'estado_del_proyecto', label: 'Estado del proyecto', group: 'Proyecto' },
  { value: 'ubicacion',        label: 'Ubicación', group: 'Proyecto' },
  { value: 'precio_desde',     label: 'Precio desde', group: 'Proyecto' },
  { value: 'imagen',           label: 'Imagen del proyecto', group: 'Proyecto', autoToggles: { is_list: true, is_image: true } },
  { value: 'descripcion',      label: 'Descripción', group: 'Proyecto' },
  { value: 'areas_comunes_exterior_e_interior_img', label: 'Imágenes áreas (ext/int)', group: 'Proyecto', autoToggles: { is_list: true, is_image: true } },
  { value: 'areas_comunes',    label: 'Áreas comunes (lista)', group: 'Proyecto', autoToggles: { is_list: true } },
  { value: 'areas_comunes_imagenes', label: 'Áreas comunes (imágenes)', group: 'Proyecto', autoToggles: { is_list: true, is_image: true } },
  { value: 'lugares_cercanos', label: 'Lugares cercanos', group: 'Proyecto', autoToggles: { is_list: true } },
  { value: 'imagen_modelo',    label: 'Imagen del modelo', group: 'Propiedad', autoToggles: { is_image: true, extract_attr: 'src' } },
  { value: 'dormitorios',      label: 'Dormitorios', group: 'Propiedad' },
  { value: 'm2',               label: 'Metros cuadrados (m²)', group: 'Propiedad' },
  { value: 'modelo',           label: 'Modelo', group: 'Propiedad' },
  { value: 'modelo_imagen',    label: 'Imagen adicional del modelo', group: 'Propiedad', autoToggles: { is_image: true } },
  { value: 'descripcion',      label: 'Descripción (→ proyecto)', group: 'Propiedad', autoToggles: { is_shared: true } },
  { value: 'ubicacion',        label: 'Ubicación (→ proyecto)', group: 'Propiedad', autoToggles: { is_shared: true } },
  { value: 'lugares_cercanos', label: 'Lugares cercanos (→ proyecto)', group: 'Propiedad', autoToggles: { is_shared: true, is_list: true } },
  { value: 'areas_comunes',    label: 'Áreas comunes (→ proyecto)', group: 'Propiedad', autoToggles: { is_shared: true, is_list: true } },
  { value: 'areas_comunes_imagenes', label: 'Áreas comunes imgs (→ proyecto)', group: 'Propiedad', autoToggles: { is_shared: true, is_list: true, is_image: true } },
  { value: 'areas_comunes_exterior_e_interior_img', label: 'Imgs áreas ext/int (→ proyecto)', group: 'Propiedad', autoToggles: { is_shared: true, is_list: true, is_image: true } },
  { value: 'gmaps_url',         label: 'URL Google Maps (→ proyecto)', group: 'Propiedad', autoToggles: { is_shared: true, extract_attr: 'href' } },
  { value: 'gmaps_coordinates', label: 'Coordenadas Google Maps (→ proyecto)', group: 'Propiedad', autoToggles: { is_shared: true } },
]

const getAutoToggles = (fieldName: string): Partial<FieldToggles> =>
  STANDARD_FIELDS.find(f => f.value === fieldName)?.autoToggles ?? {}

// ── Component ─────────────────────────────────────────────────────────────────
export default function VisualSelectorModal({ open, url, existingFields, onClose, onConfirm }: Props) {
  const wsRef = useRef<WebSocket | null>(null)
  const sessionRef = useRef<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const scrollYRef = useRef(0)
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<PendingInference | null>(null)
  const popupInputRef = useRef<HTMLInputElement>(null)
  const annotationsRef = useRef<Annotation[]>([])
  const activeTabRef = useRef<ActiveTab>('listing')
  const viewportRef = useRef<{ width: number; height: number } | null>(null)
  const activeColorRef = useRef<string>(RECT_COLORS[0].hex)
  const captureColorRef = useRef<{
    color: string
    tab: ActiveTab
    firstRect: Annotation['viewport_rect']
    allRects: Annotation['viewport_rect'][]
  } | null>(null)

  const [, setSessionId] = useState<string | null>(null)
  const [, setViewport] = useState<{ width: number; height: number } | null>(null)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [wsConnecting, setWsConnecting] = useState(true)
  const [wsError, setWsError] = useState<string | null>(null)
  const [scrolling, setScrolling] = useState(false)

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [drawRect, setDrawRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [popup, setPopup] = useState<Popup | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('listing')
  const [navigateMode, setNavigateMode] = useState(false)
  const [detailPageOpened, setDetailPageOpened] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [interactionMode, setInteractionMode] = useState(false)
  const [activeColor, setActiveColor] = useState(RECT_COLORS[0].hex)

  const [aiModel, setAiModel] = useState('claude-sonnet-4-6')
  const [capturing, setCapturing] = useState(false)
  const [rawDataResult, setRawDataResult] = useState<Record<string, unknown> | null>(null)
  const [showRawData, setShowRawData] = useState(false)

  const setActiveColorSync = (c: string) => {
    setActiveColor(c)
    activeColorRef.current = c
  }

  const syncedSetAnnotations = (updater: ((prev: Annotation[]) => Annotation[]) | Annotation[]) => {
    setAnnotations(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      annotationsRef.current = next
      return next
    })
  }

  const send = (msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }

  // ── WS lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    syncedSetAnnotations([])
    setDrawRect(null)
    setPopup(null)
    setScreenshot(null)
    setSessionId(null)
    sessionRef.current = null
    setViewport(null)
    viewportRef.current = null
    setWsConnecting(true)
    setWsError(null)
    setActiveTab('listing')
    activeTabRef.current = 'listing'
    setNavigateMode(false)
    setDetailPageOpened(false)
    setLoadingDetail(false)
    setInteractionMode(false)
    setCapturing(false)
    setRawDataResult(null)
    setShowRawData(false)
    setActiveColorSync(RECT_COLORS[0].hex)
    captureColorRef.current = null
    scrollYRef.current = 0
    pendingRef.current = null
    annotationsRef.current = []

    fetch(`${apiUrl}/chat/config`)
      .then(r => r.json())
      .then((d: { ai_model?: string }) => setAiModel(d.ai_model || 'claude-sonnet-4-6'))
      .catch(() => {})

    const timeout = setTimeout(() => {
      if (!sessionRef.current) {
        setWsConnecting(false)
        setWsError('No se pudo conectar. Verifica que el servidor esté activo.')
      }
    }, 50_000)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'start_session', url, viewport: { width: 1280, height: 720 } }))
    })
    ws.addEventListener('error', () => {
      setWsConnecting(false)
      setWsError('Error de conexión. Asegúrate de que el servidor está corriendo.')
    })
    ws.addEventListener('close', (ev) => {
      setWsConnecting(false)
      if (!sessionRef.current && ev.code !== 1000) {
        setWsError('Conexión cerrada inesperadamente. Intenta de nuevo.')
      }
    })
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      switch (msg.type) {
        case 'session_started':
          clearTimeout(timeout)
          setWsConnecting(false)
          sessionRef.current = msg.session_id
          setSessionId(msg.session_id)
          setViewport(msg.viewport)
          viewportRef.current = msg.viewport
          setScreenshot(msg.screenshot)
          // Restore previously drawn annotations from localStorage
          try {
            const raw = localStorage.getItem(`vs_anns_${url}`)
            if (raw) {
              const parsed: Annotation[] = JSON.parse(raw).map((a: Annotation) => ({ ...a, inferring: false }))
              if (parsed.length) syncedSetAnnotations(parsed)
            }
          } catch { /* ok */ }
          break

        case 'snapshot':
          setScreenshot(msg.screenshot)
          setScrolling(false)
          break

        case 'rect_selected': {
          if (!pendingRef.current) break
          const { annotationId, label, parentLabel } = pendingRef.current
          const selector: string = msg.data?.selector || ''
          const preview: string = msg.data?.preview || ''
          if (msg.screenshot) setScreenshot(msg.screenshot)
          syncedSetAnnotations(prev =>
            prev.map(a => a.id === annotationId ? { ...a, selector, preview } : a)
          )
          send({
            type: 'infer_field',
            session_id: sessionRef.current,
            selector,
            label,
            parent_label: parentLabel ?? null,
          })
          break
        }

        case 'field_inferred': {
          if (!pendingRef.current) break
          const { annotationId } = pendingRef.current
          const { field_name, field_type } = msg.data || {}
          syncedSetAnnotations(prev =>
            prev.map(a =>
              a.id === annotationId
                ? { ...a, field_name: field_name || a.label, field_type: field_type || 'text', inferring: false }
                : a
            )
          )
          pendingRef.current = null
          break
        }

        case 'card_url':
          if (msg.url) {
            send({ type: 'open_detail', session_id: sessionRef.current, url: msg.url })
          } else {
            setNavigateMode(false)
            setLoadingDetail(false)
          }
          break

        case 'detail_opened':
          setLoadingDetail(false)
          setNavigateMode(false)
          setDetailPageOpened(true)
          setActiveTab('detail')
          activeTabRef.current = 'detail'
          scrollYRef.current = 0
          setScreenshot(msg.screenshot)
          break

        case 'tab_switched':
          setScrolling(false)
          scrollYRef.current = 0
          setScreenshot(msg.screenshot)
          break

        case 'capture_result': {
          setCapturing(false)
          setPopup(null)
          if (msg.screenshot) setScreenshot(msg.screenshot)

          const captureInfo = captureColorRef.current
          captureColorRef.current = null
          if (!captureInfo) break

          const d = msg.data || {}
          const cardSel: string = d.card_selector || ''
          const aiFields: Array<{
            name: string; selector: string; type: string
            is_image: boolean; is_child_url: boolean; is_list: boolean; extract_attr: string | null
          }> = d.fields || []

          // Remove all inferring annotations of this color+tab
          const inferringIds = new Set(
            annotationsRef.current
              .filter(a => a.inferring && a.color === captureInfo.color && a.tab === captureInfo.tab)
              .map(a => a.id)
          )
          syncedSetAnnotations(prev => prev.filter(a => !inferringIds.has(a.id)))

          if (cardSel && aiFields.length > 0) {
            // Catalog result: container + field children
            const containerAnn: Annotation = {
              id: uid(), label: d.catalog_type || 'catalog',
              field_name: 'card', field_type: 'container',
              selector: cardSel, parent_id: null, is_nav_link: false,
              tab: captureInfo.tab, scroll_y: scrollYRef.current,
              viewport_rect: captureInfo.firstRect,
              matches: 0, preview: cardSel, inferring: false,
              color: captureInfo.color, context: '', fieldHint: '', hoverEnabled: false,
              is_list: false, is_shared: false, plain_text: false, extract_attr: '',
            }
            const fieldAnns: Annotation[] = aiFields.map((f, i) => {
              const at = getAutoToggles(f.name)
              const rectPos = captureInfo.allRects?.[i] ?? captureInfo.firstRect
              return {
                id: uid(), label: f.name, field_name: f.name,
                field_type: (at.is_image || f.is_image ? 'image' : at.is_child_url || f.is_child_url ? 'url' : (f.type as FieldType)) || 'text',
                selector: f.selector || '', parent_id: containerAnn.id,
                is_nav_link: (at.is_child_url || f.is_child_url) && f.name === 'url_propiedad',
                tab: captureInfo.tab, scroll_y: scrollYRef.current,
                viewport_rect: rectPos,
                matches: 0, preview: f.selector || '', inferring: false,
                color: captureInfo.color, context: '', fieldHint: f.name, hoverEnabled: false,
                is_list: at.is_list ?? f.is_list ?? false,
                is_shared: at.is_shared ?? false,
                plain_text: at.plain_text ?? false,
                extract_attr: at.extract_attr ?? f.extract_attr ?? '',
              }
            })
            syncedSetAnnotations(prev => [...prev, containerAnn, ...fieldAnns])
          } else if (aiFields.length > 0) {
            // Single fields (Level 2 detail page)
            const fieldAnns: Annotation[] = aiFields.map((f, i) => {
              const at = getAutoToggles(f.name)
              const rectPos = captureInfo.allRects?.[i] ?? captureInfo.firstRect
              return {
                id: uid(), label: f.name, field_name: f.name,
                field_type: (at.is_image || f.is_image ? 'image' : at.is_child_url || f.is_child_url ? 'url' : (f.type as FieldType)) || 'text',
                selector: f.selector || '', parent_id: null, is_nav_link: false,
                tab: captureInfo.tab, scroll_y: scrollYRef.current,
                viewport_rect: rectPos,
                matches: 0, preview: f.selector || '', inferring: false,
                color: captureInfo.color, context: '', fieldHint: f.name, hoverEnabled: false,
                is_list: at.is_list ?? f.is_list ?? false,
                is_shared: at.is_shared ?? false,
                plain_text: at.plain_text ?? false,
                extract_attr: at.extract_attr ?? f.extract_attr ?? '',
              }
            })
            syncedSetAnnotations(prev => [...prev, ...fieldAnns])
          }
          break
        }

        case 'raw_data':
          setRawDataResult(msg.data || {})
          setShowRawData(true)
          break

        case 'error':
          setWsError(msg.message || 'Error inesperado')
          setCapturing(false)
          if (captureColorRef.current) {
            const ci = captureColorRef.current
            captureColorRef.current = null
            syncedSetAnnotations(prev => prev.map(a =>
              a.inferring && a.color === ci.color && a.tab === ci.tab ? { ...a, inferring: false } : a
            ))
          }
          if (pendingRef.current) {
            const id = pendingRef.current.annotationId
            syncedSetAnnotations(prev => prev.map(a => a.id === id ? { ...a, inferring: false } : a))
            pendingRef.current = null
          }
          setLoadingDetail(false)
          break
      }
    })

    return () => {
      clearTimeout(timeout)
      if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current)
      // Persist non-inferring annotations to localStorage so they survive re-opens
      try {
        const toSave = annotationsRef.current.filter(a => !a.inferring)
        if (toSave.length > 0) {
          localStorage.setItem(`vs_anns_${url}`, JSON.stringify(toSave))
        } else {
          localStorage.removeItem(`vs_anns_${url}`)
        }
      } catch { /* ok */ }
      if (wsRef.current) {
        try {
          if (sessionRef.current) wsRef.current.send(JSON.stringify({ type: 'end_session', session_id: sessionRef.current }))
        } catch { /* ok */ }
        wsRef.current.close()
      }
    }
  }, [open, url])

  useEffect(() => {
    if (popup) setTimeout(() => popupInputRef.current?.focus(), 40)
  }, [popup?.annotationId])

  const isFirstTabRender = useRef(true)
  useEffect(() => {
    if (isFirstTabRender.current) { isFirstTabRender.current = false; return }
    if (!sessionRef.current) return
    scrollYRef.current = 0
    send({ type: 'switch_tab', session_id: sessionRef.current, tab: activeTab })
  }, [activeTab])

  // ── Drawing ───────────────────────────────────────────────────────────────
  const findParent = (rx1: number, ry1: number, rx2: number, ry2: number, cW: number, cH: number): string | null => {
    const vp = viewportRef.current
    if (!vp) return null
    const cx = (rx1 + rx2) / 2
    const cy = (ry1 + ry2) / 2
    let bestId: string | null = null
    let bestArea = Infinity
    for (const ann of annotationsRef.current) {
      if (ann.field_type !== 'container' || ann.tab !== activeTabRef.current) continue
      const scrollDiff = ann.scroll_y - scrollYRef.current
      const dX1 = (ann.viewport_rect.x1 / vp.width) * cW
      const dY1 = ((ann.viewport_rect.y1 + scrollDiff) / vp.height) * cH
      const dX2 = (ann.viewport_rect.x2 / vp.width) * cW
      const dY2 = ((ann.viewport_rect.y2 + scrollDiff) / vp.height) * cH
      if (cx >= dX1 && cx <= dX2 && cy >= dY1 && cy <= dY2) {
        const area = (dX2 - dX1) * (dY2 - dY1)
        if (area < bestArea) { bestArea = area; bestId = ann.id }
      }
    }
    return bestId
  }

  const handleFreeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!sessionRef.current || !viewportRef.current) return
    const container = overlayRef.current!
    const bounds = container.getBoundingClientRect()
    const vp = viewportRef.current
    const x = Math.round(((e.clientX - bounds.left) / container.offsetWidth) * vp.width)
    const y = Math.round(((e.clientY - bounds.top) / container.offsetHeight) * vp.height)
    send({ type: 'free_click', session_id: sessionRef.current, x, y })
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!sessionRef.current || !viewportRef.current || popup) return
    if (interactionMode) { handleFreeClick(e); return }
    e.preventDefault()
    const container = overlayRef.current!
    const bounds = container.getBoundingClientRect()
    const startX = e.clientX - bounds.left
    const startY = e.clientY - bounds.top

    setDrawRect({ x1: startX, y1: startY, x2: startX, y2: startY })

    const onMove = (me: MouseEvent) => {
      setDrawRect({ x1: startX, y1: startY, x2: me.clientX - bounds.left, y2: me.clientY - bounds.top })
    }

    const onUp = (me: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)

      const endX = me.clientX - bounds.left
      const endY = me.clientY - bounds.top
      const rx1 = Math.min(startX, endX)
      const ry1 = Math.min(startY, endY)
      const rx2 = Math.max(startX, endX)
      const ry2 = Math.max(startY, endY)
      setDrawRect(null)
      if (rx2 - rx1 < 15 || ry2 - ry1 < 15) return

      const cW = container.offsetWidth
      const cH = container.offsetHeight
      const vp = viewportRef.current!
      const vx1 = Math.round((rx1 / cW) * vp.width)
      const vy1 = Math.round((ry1 / cH) * vp.height)
      const vx2 = Math.round((rx2 / cW) * vp.width)
      const vy2 = Math.round((ry2 / cH) * vp.height)
      const parent_id = findParent(rx1, ry1, rx2, ry2, cW, cH)
      const newId = uid()
      const color = activeColorRef.current

      syncedSetAnnotations(prev => [...prev, {
        id: newId, label: '', field_name: '', field_type: 'text',
        selector: '', parent_id, is_nav_link: false,
        tab: activeTabRef.current, scroll_y: scrollYRef.current,
        viewport_rect: { x1: vx1, y1: vy1, x2: vx2, y2: vy2 },
        matches: 0, preview: '', inferring: false,
        color, context: '', fieldHint: '', hoverEnabled: false,
        is_list: false, is_shared: false, plain_text: false, extract_attr: '',
      }])

      const px = Math.min(rx2 + 10, cW - 290)
      const py = Math.max(ry1, 0)
      setPopup({ annotationId: newId, label: '', fieldHint: '', hoverEnabled: false, popupX: px, popupY: py, color })
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleNavigateClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!sessionRef.current || !viewportRef.current) return
    const container = overlayRef.current!
    const bounds = container.getBoundingClientRect()
    const vp = viewportRef.current
    const x = Math.round(((e.clientX - bounds.left) / container.offsetWidth) * vp.width)
    const y = Math.round(((e.clientY - bounds.top) / container.offsetHeight) * vp.height)
    setLoadingDetail(true)
    send({ type: 'get_card_url', session_id: sessionRef.current, x, y })
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!sessionRef.current) return
    const delta = Math.round(e.deltaY)
    scrollYRef.current = Math.max(0, scrollYRef.current + delta)
    setScrolling(true)
    if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current)
    scrollDebounceRef.current = setTimeout(() => {
      send({ type: 'scroll', session_id: sessionRef.current, scroll_y: scrollYRef.current })
    }, 80)
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  const updateAnnotation = (id: string, patch: Partial<Annotation>) => {
    syncedSetAnnotations(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a))
  }

  const deleteAnnotation = (id: string) => {
    syncedSetAnnotations(prev => prev.filter(a => a.id !== id && a.parent_id !== id))
    if (popup?.annotationId === id) setPopup(null)
  }

  const undoLast = () => {
    const tabAnns = annotationsRef.current.filter(a => a.tab === activeTabRef.current && a.parent_id === null)
    if (tabAnns.length === 0) return
    const last = tabAnns[tabAnns.length - 1]
    deleteAnnotation(last.id)
  }

  const submitCapture = () => {
    if (!popup || capturing) return
    const color = popup.color

    const groupAnns = annotationsRef.current.filter(
      a => a.color === color && a.tab === activeTabRef.current && !a.inferring
    )
    if (groupAnns.length === 0) return

    // Mark all group annotations as inferring
    syncedSetAnnotations(prev => prev.map(a =>
      groupAnns.some(ga => ga.id === a.id)
        ? { ...a, inferring: true, context: a.id === popup.annotationId ? popup.label : a.context, fieldHint: a.id === popup.annotationId ? popup.fieldHint : a.fieldHint, hoverEnabled: a.id === popup.annotationId ? popup.hoverEnabled : a.hoverEnabled }
        : a
    ))

    captureColorRef.current = {
      color,
      tab: activeTabRef.current,
      firstRect: groupAnns[0].viewport_rect,
      allRects: groupAnns.map(a => a.viewport_rect),
    }

    const rects = groupAnns.map(a => ({
      x1: a.viewport_rect.x1, y1: a.viewport_rect.y1,
      x2: a.viewport_rect.x2, y2: a.viewport_rect.y2,
      field_hint: a.id === popup.annotationId ? popup.fieldHint : a.fieldHint,
    }))

    send({
      type: 'capture_color_group',
      session_id: sessionRef.current,
      color,
      rects,
      context: popup.label,
      hover: popup.hoverEnabled,
      ai_model: aiModel,
    })

    setCapturing(true)
    // Keep popup open to show spinner
  }

  const dismissPopup = () => {
    if (popup) {
      // Save popup values to annotation (keep it as pending rect)
      syncedSetAnnotations(prev => prev.map(a =>
        a.id === popup.annotationId
          ? { ...a, context: popup.label, fieldHint: popup.fieldHint, hoverEnabled: popup.hoverEnabled }
          : a
      ))
    }
    setPopup(null)
    setCapturing(false)
  }

  const reopenPopup = (ann: Annotation) => {
    if (capturing) return
    const container = overlayRef.current
    if (!container || !viewportRef.current) return
    const vp = viewportRef.current
    const cW = container.offsetWidth
    const cH = container.offsetHeight
    const scrollDiff = ann.scroll_y - scrollYRef.current
    const rx2 = (ann.viewport_rect.x2 / vp.width) * cW
    const ry1 = ((ann.viewport_rect.y1 + scrollDiff) / vp.height) * cH
    const px = Math.min(rx2 + 10, cW - 290)
    const py = Math.max(ry1, 0)
    setPopup({
      annotationId: ann.id,
      label: ann.context,
      fieldHint: ann.fieldHint,
      hoverEnabled: ann.hoverEnabled,
      popupX: px,
      popupY: py,
      color: ann.color,
    })
  }

  const handleExtractData = () => {
    const tabAnns = annotationsRef.current.filter(a => a.tab === activeTabRef.current && a.selector)
    const containerAnn = tabAnns.find(a => a.field_type === 'container')
    const fieldAnns = tabAnns.filter(a => a.field_type !== 'container')
    send({
      type: 'extract_raw_data',
      session_id: sessionRef.current,
      card_selector: containerAnn?.selector || null,
      fields: fieldAnns.map(a => ({
        name: a.field_name || a.label,
        selector: a.selector,
        type: a.field_type,
      })),
    })
  }

  // ── Overlay geometry ──────────────────────────────────────────────────────
  const getOverlayStyle = (ann: Annotation): React.CSSProperties | null => {
    const vp = viewportRef.current
    if (!vp) return null
    const container = overlayRef.current
    if (!container) return null
    const cW = container.offsetWidth
    const cH = container.offsetHeight
    const scrollDiff = ann.scroll_y - scrollYRef.current
    const x1 = (ann.viewport_rect.x1 / vp.width) * cW
    const y1 = ((ann.viewport_rect.y1 + scrollDiff) / vp.height) * cH
    const x2 = (ann.viewport_rect.x2 / vp.width) * cW
    const y2 = ((ann.viewport_rect.y2 + scrollDiff) / vp.height) * cH
    return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 }
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  const handleConfirm = () => {
    const toField = (ann: Annotation): CapturedField => {
      // autoToggles from standard field definition take precedence over AI inference
      const at = getAutoToggles(ann.field_name || ann.fieldHint)
      return {
        id: ann.id,
        name: ann.field_name || ann.label || 'campo',
        selector: ann.selector,
        preview: ann.preview,
        matches: ann.matches,
        type: ann.field_type as 'text' | 'url' | 'number' | 'image',
        confidence: 1.0,
        enabled: true,
        is_child_url: at.is_child_url ?? (ann.field_type === 'url'),
        is_list:      at.is_list      ?? ann.is_list,
        is_image:     at.is_image     ?? (ann.field_type === 'image'),
        is_shared:    at.is_shared    ?? ann.is_shared,
        plain_text:   at.plain_text   ?? ann.plain_text,
        extract_attr: at.extract_attr ?? ann.extract_attr,
      }
    }
    const listAnns = annotations.filter(a => a.tab === 'listing' && !a.inferring && a.selector)
    const listContainerAnn = listAnns.find(a => a.field_type === 'container')
    const detAnns = annotations.filter(a => a.tab === 'detail' && !a.inferring && a.selector)
    const detContainerAnn = detAnns.find(a => a.field_type === 'container')
    onConfirm({
      cardSelector: listContainerAnn?.selector,
      fields: listAnns.filter(a => a.field_type !== 'container').map(toField),
      detailContainerSelector: detContainerAnn?.selector,
      detailFields: detAnns.length ? detAnns.filter(a => a.field_type !== 'container').map(toField) : undefined,
    })
    onClose()
  }

  if (!open) return null

  const tabAnnotations = annotations.filter(a => a.tab === activeTab)
  const canExtract = tabAnnotations.some(a => a.selector && !a.inferring)
  const canConfirm = annotations.some(a => a.selector && !a.inferring)

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm">
      <div className="absolute inset-4 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* ── Toolbar ── */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">URL activa</p>
            <p className="text-sm font-semibold text-gray-900 truncate">{url}</p>
          </div>

          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => { setActiveTab('listing'); activeTabRef.current = 'listing' }}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'listing' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Level 1
            </button>
            <button
              onClick={() => {
                if (detailPageOpened) { setActiveTab('detail'); activeTabRef.current = 'detail' }
              }}
              disabled={!detailPageOpened}
              title={!detailPageOpened ? 'Usa "Navegar al detalle" en una anotación de URL primero' : ''}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'detail' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              } ${!detailPageOpened ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              Level 2
            </button>
          </div>

          {loadingDetail && (
            <div className="flex items-center gap-1.5 text-xs text-purple-600 animate-pulse">
              <div className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin" />
              Abriendo Level 2…
            </div>
          )}

          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-[1.2fr_0.8fr] overflow-hidden">

          {/* ── Left: Browser preview ── */}
          <div className="border-r border-gray-100 bg-gray-50 flex flex-col overflow-hidden">

            {/* Status bar */}
            <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between gap-2 flex-shrink-0">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {wsConnecting ? (
                  <><div className="w-3 h-3 border border-gray-300 border-t-blue-500 rounded-full animate-spin" /> Conectando…</>
                ) : screenshot ? (
                  navigateMode ? (
                    <><span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse inline-block" /> Haz clic en un card para abrir el detalle</>
                  ) : interactionMode ? (
                    <><span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse inline-block" /> Modo interacción: haz clic en la página normalmente</>
                  ) : (
                    <><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Arrastra para marcar un área</>
                  )
                ) : null}
              </div>
              {screenshot && !navigateMode && (
                <button
                  onClick={() => setInteractionMode(v => !v)}
                  title={interactionMode ? 'Cambiar a modo selección' : 'Cambiar a modo interacción'}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition flex-shrink-0 ${
                    interactionMode
                      ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <MousePointer2 className="w-3 h-3" />
                  {interactionMode ? 'Interacción' : 'Selección'}
                </button>
              )}
            </div>

            {/* Color palette */}
            {screenshot && (
              <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2.5 flex-shrink-0 bg-white">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide flex-shrink-0">Color:</span>
                <div className="flex items-center gap-1.5">
                  {RECT_COLORS.map(c => (
                    <button
                      key={c.hex}
                      title={c.name}
                      onClick={() => setActiveColorSync(c.hex)}
                      className="rounded-full transition-all flex-shrink-0"
                      style={{
                        width: activeColor === c.hex ? 22 : 17,
                        height: activeColor === c.hex ? 22 : 17,
                        background: c.hex,
                        boxShadow: activeColor === c.hex ? `0 0 0 2px white, 0 0 0 4px ${c.hex}` : 'none',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-gray-500 ml-0.5">
                  {RECT_COLORS.find(c => c.hex === activeColor)?.name}
                  {' '}·{' '}
                  {annotations.filter(a => a.color === activeColor && a.tab === activeTab && a.parent_id === null).length} rect(s)
                </span>
              </div>
            )}

            <div className="flex-1 overflow-auto p-4">
              {screenshot ? (
                <div className="relative">
                  <div
                    ref={overlayRef}
                    className="relative select-none"
                    onMouseDown={navigateMode ? undefined : handleMouseDown}
                    onClick={navigateMode ? handleNavigateClick : undefined}
                    onWheel={handleWheel}
                    style={{ cursor: navigateMode ? 'pointer' : interactionMode ? 'default' : 'crosshair' }}
                  >
                    <img
                      src={screenshot}
                      alt="Visual selector"
                      className="w-full rounded-xl shadow-sm border border-gray-200 block"
                      draggable={false}
                    />

                    {/* Annotation overlays — only root annotations (parent_id === null) */}
                    {annotations.filter(a => a.tab === activeTab && a.parent_id === null).map(ann => {
                      const style = getOverlayStyle(ann)
                      if (!style) return null
                      const color = ann.color || TYPE_COLOR[ann.field_type]
                      const isPending = !ann.selector && !ann.inferring
                      return (
                        <div
                          key={ann.id}
                          style={{
                            position: 'absolute',
                            border: `2px ${isPending ? 'dashed' : 'solid'}`,
                            borderColor: color,
                            borderRadius: 4,
                            backgroundColor: `${color}18`,
                            pointerEvents: 'none',
                            ...style,
                          }}
                        >
                          <span style={{
                            position: 'absolute', top: -22, left: 0,
                            background: color, color: '#fff',
                            fontSize: 10, padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
                            maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block',
                          }}>
                            {ann.inferring ? '⏳ Analizando…' : (ann.field_name || ann.label || '📍 Pendiente')}
                          </span>
                          {/* Corner button to reopen popup */}
                          {!ann.inferring && !capturing && (
                            <button
                              onMouseDown={e => { e.stopPropagation(); reopenPopup(ann) }}
                              title="Configurar"
                              style={{
                                pointerEvents: 'auto',
                                position: 'absolute',
                                top: 3, right: 3,
                                background: color,
                                border: 'none',
                                borderRadius: 3,
                                color: 'white',
                                cursor: 'pointer',
                                padding: '2px 5px',
                                fontSize: 10,
                                lineHeight: 1.2,
                                fontWeight: 600,
                              }}
                            >
                              ⚙
                            </button>
                          )}
                        </div>
                      )
                    })}

                    {/* Live drawing rect */}
                    {drawRect && (
                      <div style={{
                        position: 'absolute',
                        left: Math.min(drawRect.x1, drawRect.x2),
                        top: Math.min(drawRect.y1, drawRect.y2),
                        width: Math.abs(drawRect.x2 - drawRect.x1),
                        height: Math.abs(drawRect.y2 - drawRect.y1),
                        border: `2px dashed ${activeColor}`,
                        backgroundColor: `${activeColor}15`,
                        borderRadius: 4,
                        pointerEvents: 'none',
                      }} />
                    )}

                    {/* Popup */}
                    {popup && (
                      <div
                        style={{ position: 'absolute', left: popup.popupX, top: popup.popupY, zIndex: 50, width: 288 }}
                        className="bg-white rounded-xl shadow-xl border border-gray-200 p-3"
                        onMouseDown={e => e.stopPropagation()}
                      >
                        {/* Color indicator strip */}
                        <div
                          className="h-1 rounded-full mb-3"
                          style={{ background: popup.color }}
                        />
                        {capturing ? (
                          <div className="flex flex-col items-center gap-2 py-3">
                            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-xs text-gray-500 text-center">
                              Analizando con IA…<br />
                              <span className="text-gray-400">({aiModel})</span>
                            </p>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs font-semibold text-gray-700 mb-1.5">Contexto (opcional)</p>
                            <input
                              ref={popupInputRef}
                              value={popup.label}
                              onChange={e => setPopup(prev => prev ? { ...prev, label: e.target.value } : prev)}
                              onKeyDown={e => { if (e.key === 'Enter') submitCapture(); if (e.key === 'Escape') dismissPopup() }}
                              placeholder='Ej: "Catálogo de proyectos"'
                              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs mb-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />

                            <p className="text-xs font-semibold text-gray-700 mb-1.5">Campo estándar (opcional)</p>
                            <select
                              value={popup.fieldHint}
                              onChange={e => setPopup(prev => prev ? { ...prev, fieldHint: e.target.value } : prev)}
                              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs mb-2 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                            >
                              <option value="">— Dejar que IA decida —</option>
                              <optgroup label="Proyecto">
                                {STANDARD_FIELDS.filter(f => f.group === 'Proyecto').map(f => (
                                  <option key={f.value} value={f.value}>{f.label}</option>
                                ))}
                              </optgroup>
                              <optgroup label="Propiedad">
                                {STANDARD_FIELDS.filter(f => f.group === 'Propiedad').map(f => (
                                  <option key={f.value} value={f.value}>{f.label}</option>
                                ))}
                              </optgroup>
                            </select>

                            {/* Hover toggle */}
                            <label className="flex items-center gap-2 mb-2.5 cursor-pointer select-none group">
                              <div
                                onClick={() => {
                                  const ann = annotationsRef.current.find(a => a.id === popup.annotationId)
                                  const next = !popup.hoverEnabled
                                  setPopup(prev => prev ? { ...prev, hoverEnabled: next } : prev)
                                  if (!ann) return
                                  if (next) {
                                    send({
                                      type: 'hover_scan',
                                      session_id: sessionRef.current,
                                      x1: ann.viewport_rect.x1, y1: ann.viewport_rect.y1,
                                      x2: ann.viewport_rect.x2, y2: ann.viewport_rect.y2,
                                    })
                                  } else {
                                    send({ type: 'hover_reset', session_id: sessionRef.current })
                                  }
                                }}
                                className={`w-8 h-4 rounded-full transition-colors flex-shrink-0 relative ${popup.hoverEnabled ? 'bg-amber-400' : 'bg-gray-200'}`}
                              >
                                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${popup.hoverEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                              </div>
                              <span className="text-[11px] text-gray-500 leading-tight">
                                Hover <span className="text-gray-400">(contenido oculto)</span>
                              </span>
                            </label>

                            {/* Group info */}
                            {(() => {
                              const sameColor = annotationsRef.current.filter(
                                a => a.color === popup.color && a.tab === activeTabRef.current && !a.inferring
                              )
                              return sameColor.length > 1 ? (
                                <p className="text-[10px] text-blue-500 mb-2">
                                  ℹ {sameColor.length} rectángulos del mismo color serán enviados juntos a la IA
                                </p>
                              ) : null
                            })()}

                            <div className="flex gap-1.5">
                              <button
                                onClick={submitCapture}
                                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-white text-xs rounded-lg font-medium hover:opacity-90 transition"
                                style={{ background: popup.color }}
                              >
                                <Camera className="w-3.5 h-3.5" />
                                Capturar
                              </button>
                              <button
                                onClick={dismissPopup}
                                className="px-2 py-1.5 text-xs text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-50 transition"
                              >
                                ✕
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {scrolling && (
                    <div className="absolute top-2 right-6 bg-black/50 text-white text-[10px] px-2 py-1 rounded-md pointer-events-none">
                      Cargando...
                    </div>
                  )}
                  <p className="mt-2 text-center text-[10px] text-gray-400">
                    🖱 Rueda del mouse para scroll · Arrastra para marcar un área
                  </p>
                </div>
              ) : wsError ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-sm">
                  <p className="text-red-500 text-center max-w-xs">{wsError}</p>
                  <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-900 text-white text-xs hover:bg-gray-700">
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

          {/* ── Right: Annotations list ── */}
          <div className="flex flex-col overflow-hidden">
            {/* Existing template fields banner */}
            {(() => {
              const fieldsForTab = (existingFields ?? []).filter(f => f.tab === activeTab)
              if (!fieldsForTab.length) return null
              return (
                <div className="px-3 py-2 border-b border-amber-100 bg-amber-50 flex-shrink-0">
                  <p className="text-[10px] text-amber-600 uppercase tracking-wide font-semibold mb-1">Ya en plantilla</p>
                  <div className="flex flex-wrap gap-1">
                    {fieldsForTab.map(f => (
                      <span key={f.name} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white text-amber-700 border border-amber-200 font-medium">
                        {f.name}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })()}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-xs text-gray-500">
                  {activeTab === 'listing' ? 'Marcas del listado' : 'Marcas del detalle'}
                </p>
                <p className="text-sm font-semibold text-gray-900">
                  {tabAnnotations.length} anotación{tabAnnotations.length !== 1 ? 'es' : ''}
                </p>
              </div>
              {tabAnnotations.length > 0 && (
                <button
                  onClick={() => syncedSetAnnotations(prev => prev.filter(a => a.tab !== activeTab))}
                  className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Limpiar
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-3">
              {tabAnnotations.length === 0 && (
                <div className="text-sm text-gray-400 text-center py-12">
                  <Tag className="w-8 h-8 mx-auto mb-3 text-gray-200" />
                  <p className="font-medium text-gray-500 mb-1">Sin anotaciones</p>
                  <p className="text-xs">Arrastra un rectángulo sobre la página para marcar un área.</p>
                </div>
              )}

              {tabAnnotations.map(ann => (
                <div
                  key={ann.id}
                  className="rounded-xl border bg-white p-3 space-y-2 shadow-sm"
                  style={{ borderColor: ann.color ? `${ann.color}44` : '#f3f4f6' }}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-[5px]"
                      style={{ background: ann.color || TYPE_COLOR[ann.field_type] }}
                    />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <input
                          value={ann.field_name}
                          onChange={e => updateAnnotation(ann.id, { field_name: e.target.value })}
                          placeholder={ann.label || 'nombre_campo'}
                          className="border border-gray-200 rounded-lg px-2 py-1 text-xs flex-1 min-w-0 font-mono focus:outline-none focus:ring-1 focus:ring-blue-300"
                        />
                        <select
                          value={ann.field_type}
                          onChange={e => updateAnnotation(ann.id, { field_type: e.target.value as FieldType })}
                          className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs flex-shrink-0 focus:outline-none"
                        >
                          <option value="container">Contenedor</option>
                          <option value="text">Texto</option>
                          <option value="url">URL</option>
                          <option value="number">Número</option>
                          <option value="image">Imagen</option>
                        </select>
                        <button onClick={() => deleteAnnotation(ann.id)} className="text-gray-300 hover:text-red-500 flex-shrink-0 transition">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Nav link toggle */}
                      {ann.field_type === 'url' && ann.tab === 'listing' && (
                        <div className="space-y-1.5">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={ann.is_nav_link}
                              onChange={e => updateAnnotation(ann.id, { is_nav_link: e.target.checked })}
                              className="rounded"
                            />
                            <span className="text-xs text-purple-600 font-medium">Enlace de navegación al detalle</span>
                          </label>
                          {ann.is_nav_link && ann.selector && !detailPageOpened && (
                            <button
                              onClick={() => {
                                setLoadingDetail(true)
                                send({ type: 'navigate_from_selector', session_id: sessionRef.current, selector: ann.selector })
                              }}
                              disabled={loadingDetail}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 disabled:opacity-50 transition w-full justify-center"
                            >
                              <Navigation2 className="w-3.5 h-3.5" />
                              {loadingDetail ? 'Abriendo…' : 'Navegar al detalle →'}
                            </button>
                          )}
                          {ann.is_nav_link && detailPageOpened && (
                            <p className="text-[10px] text-emerald-600 font-medium">✓ Level 2 abierto</p>
                          )}
                        </div>
                      )}

                      {/* Selector / pending / inferring */}
                      {ann.inferring ? (
                        <div className="flex items-center gap-1.5 text-xs text-blue-500 py-1">
                          <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                          Analizando con IA...
                        </div>
                      ) : ann.selector ? (
                        <>
                          <input
                            value={ann.selector}
                            onChange={e => updateAnnotation(ann.id, { selector: e.target.value })}
                            placeholder=".card .titulo"
                            className="w-full border border-gray-100 bg-gray-50 rounded-lg px-2 py-1 text-[11px] font-mono text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-200"
                          />
                          {ann.label && (
                            <p className="text-[10px] text-gray-400 italic truncate">"{ann.label}"</p>
                          )}
                          {ann.field_type !== 'container' && (
                            <label className="flex items-center gap-1.5 cursor-pointer select-none mt-0.5">
                              <input
                                type="checkbox"
                                checked={ann.is_list}
                                onChange={e => updateAnnotation(ann.id, { is_list: e.target.checked })}
                                className="rounded"
                              />
                              <span className={`text-[11px] font-medium ${ann.is_list ? 'text-blue-600' : 'text-gray-400'}`}>
                                Lista de valores (guarda como JSON array)
                              </span>
                            </label>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-400 italic">Pendiente — haz clic en ⚙ para capturar</span>
                          <button
                            onClick={() => reopenPopup(ann)}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition"
                          >
                            ⚙
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between flex-shrink-0 gap-2">
              <button
                onClick={undoLast}
                disabled={tabAnnotations.filter(a => a.parent_id === null).length === 0}
                className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1 transition disabled:opacity-30 flex-shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Deshacer
              </button>
              <button
                onClick={handleExtractData}
                disabled={!canExtract}
                title={activeTab === 'detail' ? 'Extraer datos de la página de detalle actual' : 'Extraer datos del listado'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-300 text-emerald-700 text-xs font-medium hover:bg-emerald-50 disabled:opacity-30 transition"
              >
                <Database className="w-3.5 h-3.5" />
                {activeTab === 'detail' ? 'Ver datos' : 'Extraer datos'}
              </button>
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 flex items-center gap-1.5 disabled:opacity-40 transition"
              >
                <Check className="w-4 h-4" /> Confirmar →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── JSON raw data viewer ── */}
      {showRawData && rawDataResult && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <p className="font-semibold text-gray-900 text-sm">Datos extraídos (JSON crudo)</p>
                {'card_count' in rawDataResult && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {(rawDataResult as any).card_count} cards encontrados
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowRawData(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-[11px] text-gray-700 bg-gray-50 rounded-xl p-4 whitespace-pre-wrap font-mono leading-relaxed">
                {JSON.stringify(rawDataResult, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
