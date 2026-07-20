import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import {
  Play, Trash2, MousePointer2, Camera, Loader2, MessageSquare, X, Hand,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface ColumnDef {
  value: string
  label: string
  autoToggles?: Record<string, unknown>
}

interface CaptureRect {
  id: string
  rect: { x1: number; y1: number; x2: number; y2: number }
  thumbnail: string
  fieldName: string
  hoverEnabled: boolean
  context: string
  color: string
  scrollY: number
  parentId: string | null
}

interface DrawPopup {
  rect: { x1: number; y1: number; x2: number; y2: number }
  displayRect: { x1: number; y1: number; x2: number; y2: number }
  fieldName: string
  hoverEnabled: boolean
  context: string
}

interface ExtractionResult {
  items: Record<string, string | null>[]
  total_items: number
}

interface LevelState {
  url: string
  captures: CaptureRect[]
  fullCaptures: { id: string; dataUri: string; timestamp: number }[]
  extractResult: ExtractionResult | null
}

interface CaptureConfig {
  level1: { url: string; captures: Omit<CaptureRect, 'thumbnail'>[] }
  level2: { url: string; captures: Omit<CaptureRect, 'thumbnail'>[] } | null
}

export interface CaptureModeHandle {
  getCaptureConfig: () => CaptureConfig
  runFullExtraction: () => Promise<void>
}

interface Props {
  subTab: 'proyectos' | 'propiedades'
  columns: ColumnDef[]
  detailColumns?: ColumnDef[]
  initialCaptureConfig?: CaptureConfig | null
}

// ── Constants ────────────────────────────────────────────────────────────────

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
const wsUrl = apiUrl.replace(/\/api\/?$/, '').replace(/^http/, 'ws') + '/ws/visual-selector'

let _capId = 0
const capUid = () => `cap_${++_capId}`

const RECT_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6']

function fieldTypeLabel(col: ColumnDef): string {
  const t = col.autoToggles as Record<string, boolean> | undefined
  if (t?.is_image) return 'Imagen'
  if (t?.is_list) return 'Lista'
  if (t?.is_child_url) return 'URL'
  if (col.value.includes('precio')) return 'Precio'
  return 'Texto'
}

// ── Crop thumbnail from base64 screenshot ────────────────────────────────────

function cropThumbnail(
  screenshotDataUri: string,
  rect: { x1: number; y1: number; x2: number; y2: number },
  viewportW: number,
  viewportH: number,
): Promise<string> {
  return new Promise(resolve => {
    const img = new window.Image()
    img.onload = () => {
      const scaleX = img.naturalWidth / viewportW
      const scaleY = img.naturalHeight / viewportH
      const sx = Math.max(0, Math.round(rect.x1 * scaleX))
      const sy = Math.max(0, Math.round(rect.y1 * scaleY))
      const sw = Math.round((rect.x2 - rect.x1) * scaleX)
      const sh = Math.round((rect.y2 - rect.y1) * scaleY)
      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      } else {
        resolve('')
      }
    }
    img.onerror = () => resolve('')
    img.src = screenshotDataUri
  })
}

// ── Component ────────────────────────────────────────────────────────────────

const CaptureMode = forwardRef<CaptureModeHandle, Props>(function CaptureMode({ subTab, columns, detailColumns, initialCaptureConfig }, ref) {
  const wsRef = useRef<WebSocket | null>(null)
  const sessionRef = useRef<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const scrollYRef = useRef(0)
  const viewportRef = useRef<{ width: number; height: number }>({ width: 1280, height: 960 })
  const screenshotRef = useRef<string | null>(null)

  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [, setConnected] = useState(false)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [captures, setCaptures] = useState<CaptureRect[]>([])
  const [drawRect, setDrawRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [popup, setPopup] = useState<DrawPopup | null>(null)
  const [scrolling, setScrolling] = useState(false)
  const [clickMode, setClickMode] = useState(false)
  const [fullCaptures, setFullCaptures] = useState<{ id: string; dataUri: string; timestamp: number }[]>([])
  const [capturingFull, setCapturingFull] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [hoverActive, setHoverActive] = useState(false)
  const [confirmDeleteCapture, setConfirmDeleteCapture] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractResult, setExtractResult] = useState<ExtractionResult | null>(null)
  const [captureLevel, setCaptureLevel] = useState<1 | 2>(1)
  const [detailUrl, setDetailUrl] = useState<string | null>(null)
  const [level1Saved, setLevel1Saved] = useState<LevelState | null>(null)
  const [level2Saved, setLevel2Saved] = useState<LevelState | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const drawingRef = useRef(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)

  // Keep screenshotRef in sync
  useEffect(() => { screenshotRef.current = screenshot }, [screenshot])

  // ── WS connection ──────────────────────────────────────────────────────────

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const connectAndRender = useCallback(() => {
    if (!url.trim()) return

    // Close existing connection
    if (wsRef.current) {
      if (sessionRef.current) {
        send({ type: 'end_session', session_id: sessionRef.current })
      }
      wsRef.current.close()
    }

    setLoading(true)
    setScreenshot(null)
    setCaptures([])
    setPopup(null)
    scrollYRef.current = 0

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      ws.send(JSON.stringify({
        type: 'start_session',
        url: url.trim(),
        viewport: { width: 1280, height: 960 },
      }))
    }

    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data)

      // Dispatch to pending promise resolvers (for sequential execution)
      const resolver = pendingResolvers.current.get(data.type)
      if (resolver) { resolver(data); return }

      if (data.type === 'session_started') {
        sessionRef.current = data.session_id
        viewportRef.current = data.viewport || { width: 1280, height: 720 }
        setScreenshot(data.screenshot)
        setLoading(false)
      } else if (data.type === 'snapshot') {
        setScreenshot(data.screenshot)
        setScrolling(false)
      } else if (data.type === 'detail_opened') {
        setScreenshot(data.screenshot)
        setLoadingDetail(false)
      } else if (data.type === 'tab_switched') {
        setScreenshot(data.screenshot)
      } else if (data.type === 'extract_result') {
        setExtractResult(data.data)
        setExtracting(false)
      } else if (data.type === 'full_page_screenshot') {
        const cap = { id: capUid(), dataUri: data.screenshot, timestamp: Date.now() }
        setFullCaptures(prev => [...prev, cap])
        setCapturingFull(false)
      } else if (data.type === 'error') {
        console.error('[CaptureMode WS]', data.message)
        setLoading(false)
        setCapturingFull(false)
      }
    }

    ws.onerror = () => {
      setLoading(false)
      setConnected(false)
    }

    ws.onclose = () => {
      setConnected(false)
    }
  }, [url, send])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'end_session', session_id: sessionRef.current }))
      }
      wsRef.current?.close()
    }
  }, [])

  // ── Scroll handling ────────────────────────────────────────────────────────

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!sessionRef.current || scrolling) return
    const delta = e.deltaY > 0 ? 200 : -200
    const newY = Math.max(0, scrollYRef.current + delta)
    scrollYRef.current = newY
    setScrolling(true)
    send({ type: 'scroll', session_id: sessionRef.current, scroll_y: newY })
  }, [scrolling, send])

  // ── Scale helpers ──────────────────────────────────────────────────────────
  // With object-contain the image is scaled to fit within its container while
  // keeping aspect ratio.  We need the DISPLAYED image size, not the container.

  const getScale = useCallback(() => {
    const el = overlayRef.current
    if (!el) return { sx: 1, sy: 1 }
    const rect = el.getBoundingClientRect()
    return {
      sx: viewportRef.current.width / rect.width,
      sy: viewportRef.current.height / rect.height,
    }
  }, [])

  // ── Full page capture ───────────────────────────────────────────────────────

  const captureFullPage = useCallback(() => {
    if (!sessionRef.current || capturingFull) return
    setCapturingFull(true)
    send({ type: 'full_page_screenshot', session_id: sessionRef.current })
  }, [capturingFull, send])

  // ── Hover all toggle ────────────────────────────────────────────────────────

  const toggleHovers = useCallback(() => {
    if (!sessionRef.current) return
    const next = !hoverActive
    setHoverActive(next)
    send({ type: next ? 'activate_hovers' : 'deactivate_hovers', session_id: sessionRef.current })
  }, [hoverActive, send])

  // ── Click mode (dismiss cookie banners etc.) ────────────────────────────────

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (!clickMode || !sessionRef.current) return
    const el = overlayRef.current
    if (!el) return
    const bounds = el.getBoundingClientRect()
    const vp = viewportRef.current
    const x = Math.round(((e.clientX - bounds.left) / bounds.width) * vp.width)
    const y = Math.round(((e.clientY - bounds.top) / bounds.height) * vp.height)
    if (x < 0 || x > vp.width || y < 0 || y > vp.height) return
    send({ type: 'free_click', session_id: sessionRef.current, x, y })
  }, [clickMode, send])

  // ── Drawing ────────────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (clickMode) return
    if (popup) return
    const el = overlayRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    drawingRef.current = true
    startRef.current = { x, y }
    setDrawRect({ x1: x, y1: y, x2: x, y2: y })
  }, [clickMode, popup])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drawingRef.current || !startRef.current) return
    const el = overlayRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - r.left, r.width))
    const y = Math.max(0, Math.min(e.clientY - r.top, r.height))
    setDrawRect({
      x1: Math.min(startRef.current.x, x),
      y1: Math.min(startRef.current.y, y),
      x2: Math.max(startRef.current.x, x),
      y2: Math.max(startRef.current.y, y),
    })
  }, [])

  const handleMouseUp = useCallback(() => {
    if (!drawingRef.current || !drawRect) return
    drawingRef.current = false
    startRef.current = null

    const w = drawRect.x2 - drawRect.x1
    const h = drawRect.y2 - drawRect.y1
    if (w < 10 || h < 10) {
      setDrawRect(null)
      return
    }

    // Convert to viewport coords
    const { sx, sy } = getScale()
    const vpRect = {
      x1: Math.round(drawRect.x1 * sx),
      y1: Math.round(drawRect.y1 * sy),
      x2: Math.round(drawRect.x2 * sx),
      y2: Math.round(drawRect.y2 * sy),
    }

    setPopup({
      rect: vpRect,
      displayRect: { ...drawRect },
      fieldName: '',
      hoverEnabled: false,
      context: '',
    })
  }, [drawRect, getScale])

  // ── Confirm capture ────────────────────────────────────────────────────────

  const confirmCapture = useCallback(async () => {
    if (!popup || !screenshotRef.current) return

    const thumbnail = await cropThumbnail(
      screenshotRef.current,
      popup.rect,
      viewportRef.current.width,
      viewportRef.current.height,
    )

    // Auto-detect parent: find the smallest existing rect that fully contains this new one
    const r = popup.rect
    const margin = 8
    let parentId: string | null = null
    let parentArea = Infinity
    for (const cap of captures) {
      if (cap.parentId !== null) continue // only top-level can be parents
      const p = cap.rect
      if (p.x1 <= r.x1 + margin && p.y1 <= r.y1 + margin && p.x2 >= r.x2 - margin && p.y2 >= r.y2 - margin) {
        const area = (p.x2 - p.x1) * (p.y2 - p.y1)
        if (area < parentArea) { parentArea = area; parentId = cap.id }
      }
    }

    const colorIdx = captures.length % RECT_COLORS.length
    const capture: CaptureRect = {
      id: capUid(),
      rect: popup.rect,
      thumbnail,
      fieldName: popup.fieldName,
      hoverEnabled: popup.hoverEnabled,
      context: popup.context,
      color: RECT_COLORS[colorIdx],
      scrollY: scrollYRef.current,
      parentId,
    }

    setCaptures(prev => [...prev, capture])
    setPopup(null)
    setDrawRect(null)
  }, [popup, captures])

  const cancelPopup = useCallback(() => {
    setPopup(null)
    setDrawRect(null)
  }, [])

  const removeCapture = useCallback((id: string) => {
    // Also remove children
    setCaptures(prev => prev.filter(c => c.id !== id && c.parentId !== id))
  }, [])

  const updateCaptureField = useCallback((id: string, fieldName: string) => {
    setCaptures(prev => prev.map(c => c.id === id ? { ...c, fieldName } : c))
  }, [])

  // ── WS promise wrapper for sequential execution ────────────────────────────

  const pendingResolvers = useRef<Map<string, (data: Record<string, unknown>) => void>>(new Map())

  const waitForWs = useCallback((msgType: string, timeoutMs = 60000): Promise<Record<string, unknown>> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingResolvers.current.delete(msgType)
        reject(new Error(`WS timeout waiting for ${msgType}`))
      }, timeoutMs)
      pendingResolvers.current.set(msgType, (data) => {
        clearTimeout(timer)
        pendingResolvers.current.delete(msgType)
        resolve(data)
      })
    })
  }, [])

  // ── Execution state ────────────────────────────────────────────────────────

  const [executing, setExecuting] = useState(false)
  const [execProgress, setExecProgress] = useState<{ phase: string; current: number; total: number; url: string } | null>(null)
  const [execResults, setExecResults] = useState<Record<string, string | null>[]>([])

  // Columns for the active level
  const activeColumns = captureLevel === 2 && detailColumns ? detailColumns : columns

  // ── Expose config to parent via ref ────────────────────────────────────────

  // ── Full extraction pipeline ────────────────────────────────────────────────

  const runFullExtraction = useCallback(async () => {
    if (!sessionRef.current || fullCaptures.length === 0 || executing) return
    const parentRects = captures.filter(c => c.parentId === null)
    if (parentRects.length === 0) return
    const parent = parentRects[0]
    const children = captures.filter(c => c.parentId === parent.id && c.fieldName)
    if (children.length === 0) return

    setExecuting(true)
    setExecResults([])
    setExecProgress({ phase: 'Extrayendo catálogo...', current: 0, total: 0, url: '' })

    try {
      // Step 1: Extract Level 1
      const fullB64 = fullCaptures[0].dataUri.replace(/^data:image\/\w+;base64,/, '')
      const itemB64 = parent.thumbnail.replace(/^data:image\/\w+;base64,/, '')
      const fields = children.map(c => {
        const col = activeColumns.find(co => co.value === c.fieldName)
        const toggles = col?.autoToggles as Record<string, boolean> | undefined
        const isUrl = !!(toggles?.is_child_url || c.fieldName.includes('url'))
        return { name: c.fieldName, label: col?.label ?? c.fieldName, is_url: isUrl }
      })

      send({
        type: 'extract_from_capture',
        session_id: sessionRef.current,
        full_page_b64: fullB64,
        item_crop_b64: itemB64,
        fields,
        context: parent.context || 'Catálogo de proyectos inmobiliarios',
      })

      const l1Result = await waitForWs('extract_result', 90000) as { data: ExtractionResult }
      const items = l1Result.data?.items ?? []
      setExecProgress({ phase: 'Catálogo extraído', current: 0, total: items.length, url: '' })

      // Step 2: For each item with url_propiedad, navigate + extract Level 2
      const l2Captures = level2Saved?.captures ?? []
      const l2Parent = l2Captures.find(c => c.parentId === null)
      const l2Children = l2Parent ? l2Captures.filter(c => c.parentId === l2Parent.id && c.fieldName) : []
      const hasL2 = l2Parent && l2Children.length > 0

      const merged: Record<string, string | null>[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const detUrl = item.url_propiedad
        let detailData: Record<string, string | null> = {}

        if (hasL2 && detUrl) {
          setExecProgress({ phase: `Detalle ${i + 1}/${items.length}`, current: i + 1, total: items.length, url: detUrl })
          try {
            send({ type: 'open_detail', session_id: sessionRef.current, url: detUrl })
            await waitForWs('detail_opened', 30000)

            send({ type: 'full_page_screenshot', session_id: sessionRef.current })
            const fpResult = await waitForWs('full_page_screenshot', 30000) as { screenshot: string }
            const detFullB64 = fpResult.screenshot.replace(/^data:image\/\w+;base64,/, '')
            const detItemB64 = l2Parent!.thumbnail?.replace(/^data:image\/\w+;base64,/, '') || detFullB64.slice(0, 5000)

            const detFields = l2Children.map(c => {
              const col = (detailColumns ?? columns).find(co => co.value === c.fieldName)
              const toggles = col?.autoToggles as Record<string, boolean> | undefined
              return { name: c.fieldName, label: col?.label ?? c.fieldName, is_url: !!(toggles?.is_child_url) }
            })

            send({
              type: 'extract_from_capture',
              session_id: sessionRef.current,
              full_page_b64: detFullB64,
              item_crop_b64: detItemB64,
              fields: detFields,
              context: 'Página de detalle de proyecto inmobiliario',
            })
            const l2Result = await waitForWs('extract_result', 90000) as { data: ExtractionResult }
            detailData = l2Result.data?.items?.[0] ?? {}
          } catch (e) {
            console.warn(`Detail extraction failed for ${detUrl}:`, e)
          }
        }
        merged.push({ ...item, ...detailData })
      }

      setExecResults(merged)
      setExecProgress(null)
    } catch (e) {
      console.error('Full extraction failed:', e)
      setExecProgress({ phase: `Error: ${e}`, current: 0, total: 0, url: '' })
    } finally {
      setExecuting(false)
    }
  }, [executing, fullCaptures, captures, activeColumns, level2Saved, detailColumns, columns, send, waitForWs])

  useImperativeHandle(ref, () => ({
    getCaptureConfig: (): CaptureConfig => ({
      level1: {
        url,
        captures: captures.map(({ thumbnail: _, ...rest }) => rest),
      },
      level2: level2Saved ? {
        url: level2Saved.url,
        captures: level2Saved.captures.map(({ thumbnail: _, ...rest }) => rest),
      } : detailUrl ? {
        url: detailUrl,
        captures: captureLevel === 2 ? captures.map(({ thumbnail: _, ...rest }) => rest) : [],
      } : null,
    }),
    runFullExtraction,
  }), [url, captures, level2Saved, detailUrl, captureLevel, runFullExtraction])

  // ── Restore from saved config ──────────────────────────────────────────────

  useEffect(() => {
    if (!initialCaptureConfig) return
    const cfg = initialCaptureConfig
    if (cfg.level1.url) setUrl(cfg.level1.url)
    if (cfg.level1.captures.length) {
      setCaptures(cfg.level1.captures.map(c => ({ ...c, thumbnail: '' })))
    }
    if (cfg.level2) {
      setDetailUrl(cfg.level2.url)
      setLevel2Saved({
        url: cfg.level2.url,
        captures: cfg.level2.captures.map(c => ({ ...c, thumbnail: '' })),
        fullCaptures: [],
        extractResult: null,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Extract data via AI ─────────────────────────────────────────────────────

  const handleExtract = useCallback(() => {
    if (extracting || fullCaptures.length === 0) return
    const parentRects = captures.filter(c => c.parentId === null)
    if (parentRects.length === 0) return

    const parent = parentRects[0]
    const children = captures.filter(c => c.parentId === parent.id && c.fieldName)
    if (children.length === 0) return

    const fullB64 = fullCaptures[0].dataUri.replace(/^data:image\/\w+;base64,/, '')
    const itemB64 = parent.thumbnail.replace(/^data:image\/\w+;base64,/, '')

    const fields = children.map(c => {
      const col = activeColumns.find(co => co.value === c.fieldName)
      const toggles = col?.autoToggles as Record<string, boolean> | undefined
      const isUrl = !!(toggles?.is_child_url || c.fieldName.includes('url') || c.fieldName.includes('gmaps'))
      return { name: c.fieldName, label: col?.label ?? c.fieldName, is_url: isUrl }
    })

    setExtracting(true)
    setExtractResult(null)
    send({
      type: 'extract_from_capture',
      session_id: sessionRef.current,
      full_page_b64: fullB64,
      item_crop_b64: itemB64,
      fields,
      context: parent.context || (captureLevel === 1 ? 'Catálogo de proyectos inmobiliarios' : 'Página de detalle de proyecto'),
    })
  }, [extracting, fullCaptures, captures, activeColumns, captureLevel, send])

  // ── Level navigation ────────────────────────────────────────────────────────

  const navigateToDetail = useCallback((detUrl: string) => {
    if (!sessionRef.current || !detUrl) return
    // Save Level 1 state
    setLevel1Saved({ url, captures, fullCaptures, extractResult })
    // Switch to Level 2
    setDetailUrl(detUrl)
    setCaptureLevel(2)
    setCaptures(level2Saved?.captures ?? [])
    setFullCaptures(level2Saved?.fullCaptures ?? [])
    setExtractResult(level2Saved?.extractResult ?? null)
    setLoadingDetail(true)
    send({ type: 'open_detail', session_id: sessionRef.current, url: detUrl })
  }, [url, captures, fullCaptures, extractResult, level2Saved, send])

  const switchToLevel1 = useCallback(() => {
    if (!sessionRef.current) return
    // Save Level 2 state
    setLevel2Saved({ url: detailUrl ?? '', captures, fullCaptures, extractResult })
    // Restore Level 1
    if (level1Saved) {
      setUrl(level1Saved.url)
      setCaptures(level1Saved.captures)
      setFullCaptures(level1Saved.fullCaptures)
      setExtractResult(level1Saved.extractResult)
    }
    setCaptureLevel(1)
    send({ type: 'switch_tab', session_id: sessionRef.current, tab: 'listing' })
  }, [detailUrl, captures, fullCaptures, extractResult, level1Saved, send])

  // ── Render ─────────────────────────────────────────────────────────────────

  const { sx, sy } = getScale()

  return (
    <div className="flex gap-3">
      {/* ── Left: URL input + rendered page ──────────────────────────────── */}
      <div className="flex flex-col min-w-0" style={{ width: '70%' }}>
        {/* Level tabs */}
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg border border-gray-200">
            <button
              onClick={() => { if (captureLevel === 2) switchToLevel1() }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                captureLevel === 1 ? 'bg-white shadow-sm text-blue-700' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Nivel 1 — Catálogo
            </button>
            <button
              onClick={() => { /* Level 2 activates via Navegar button */ }}
              disabled={!detailUrl}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                captureLevel === 2 ? 'bg-white shadow-sm text-violet-700' : 'text-gray-400'
              } ${!detailUrl ? 'opacity-40 cursor-not-allowed' : 'hover:text-gray-600'}`}
            >
              Nivel 2 — Detalle
              {detailUrl && <span className="ml-1 text-[9px] text-gray-400">({new URL(detailUrl).pathname.slice(0, 25)}…)</span>}
            </button>
          </div>
          {loadingDetail && <Loader2 className="w-4 h-4 animate-spin text-violet-500" />}
        </div>

        {/* URL bar */}
        <div className="flex gap-2 mb-3">
          <input
            type="url"
            value={captureLevel === 2 ? (detailUrl ?? '') : url}
            onChange={e => { if (captureLevel === 1) setUrl(e.target.value) }}
            onKeyDown={e => e.key === 'Enter' && captureLevel === 1 && connectAndRender()}
            readOnly={captureLevel === 2}
            placeholder={captureLevel === 1 ? 'URL de la página a capturar...' : 'URL del detalle'}
            className={`flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none ${
              captureLevel === 2 ? 'bg-gray-50 text-gray-500' : 'focus:ring-2 focus:ring-blue-200 focus:border-blue-400'
            }`}
          />
          <button
            onClick={connectAndRender}
            disabled={!url.trim() || loading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Renderizar
          </button>
          {screenshot && (
            <>
              <button
                onClick={() => setClickMode(m => !m)}
                title={clickMode ? 'Modo click activo — clic para volver a dibujar' : 'Modo interacción — clic en banners, cookies, etc.'}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition ${
                  clickMode
                    ? 'bg-amber-50 border-amber-300 text-amber-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <Hand className="w-4 h-4" />
                Click
              </button>
              <button
                onClick={captureFullPage}
                disabled={capturingFull}
                title="Capturar página completa (full scroll)"
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition"
              >
                {capturingFull ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                Captura completa
              </button>
              <button
                onClick={toggleHovers}
                title={hoverActive ? 'Desactivar hover forzado' : 'Forzar :hover en todos los elementos'}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition ${
                  hoverActive
                    ? 'bg-violet-50 border-violet-300 text-violet-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <MousePointer2 className="w-4 h-4" />
                Hover
              </button>
            </>
          )}
        </div>

        {/* Screenshot area — container shrinks to fit the image */}
        <div
          className="overflow-hidden bg-gray-100 rounded-xl border border-gray-200"
          onWheel={handleWheel}
        >
          {!screenshot && !loading && (
            <div className="flex flex-col items-center justify-center text-gray-400" style={{ minHeight: 350 }}>
              <Camera className="w-10 h-10 mb-2 text-gray-300" />
              <p className="text-sm">Ingresa una URL y haz clic en Renderizar</p>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center bg-white/80" style={{ minHeight: 350 }}>
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-2" />
              <p className="text-sm text-gray-500">Cargando página...</p>
            </div>
          )}

          {screenshot && (
            <div
              ref={overlayRef}
              className="relative select-none"
              style={{ cursor: clickMode ? 'pointer' : popup ? 'default' : 'crosshair' }}
              onClick={handleOverlayClick}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                if (drawingRef.current) {
                  drawingRef.current = false
                  startRef.current = null
                  if (!popup) setDrawRect(null)
                }
              }}
            >
              <img
                src={screenshot}
                alt="Página renderizada"
                className="w-full block"
                draggable={false}
              />
                {/* Existing capture rects */}
                {captures.map(cap => {
                  // Convert viewport coords back to display coords
                  const dx1 = cap.rect.x1 / sx
                  const dy1 = cap.rect.y1 / sy
                  const dw = (cap.rect.x2 - cap.rect.x1) / sx
                  const dh = (cap.rect.y2 - cap.rect.y1) / sy
                  // Only show rects that belong to current scroll position (±5px tolerance)
                  if (Math.abs(cap.scrollY - scrollYRef.current) > 5) return null
                  return (
                    <div
                      key={cap.id}
                      className="absolute pointer-events-none"
                      style={{
                        left: dx1, top: dy1, width: dw, height: dh,
                        border: `2px solid ${cap.color}`,
                        background: `${cap.color}15`,
                        borderRadius: 4,
                      }}
                    >
                      <span
                        className="absolute -top-5 left-0 text-[10px] font-bold text-white px-1.5 py-0.5 rounded"
                        style={{ background: cap.color }}
                      >
                        {cap.fieldName ? `[${cap.fieldName.toUpperCase()}]` : `[CAMPO ${captures.indexOf(cap) + 1}]`}
                      </span>
                    </div>
                  )
                })}

                {/* Current drawing rect */}
                {drawRect && !popup && (
                  <div
                    className="absolute border-2 border-dashed border-blue-500 bg-blue-500/10 rounded pointer-events-none"
                    style={{
                      left: drawRect.x1, top: drawRect.y1,
                      width: drawRect.x2 - drawRect.x1, height: drawRect.y2 - drawRect.y1,
                    }}
                  />
                )}

                {/* Popup after drawing */}
                {popup && drawRect && (
                  <div
                    className="absolute z-20 bg-white rounded-xl shadow-2xl border border-gray-200 p-3 w-64"
                    style={{
                      left: Math.min(drawRect.x2 + 8, (overlayRef.current?.clientWidth ?? 600) - 270),
                      top: Math.max(0, drawRect.y1),
                    }}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    {/* Field selector */}
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">Campo</label>
                    <select
                      value={popup.fieldName}
                      onChange={e => setPopup(p => p && ({ ...p, fieldName: e.target.value }))}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg mb-2 focus:ring-2 focus:ring-blue-200 outline-none"
                    >
                      <option value="">— Seleccionar campo —</option>
                      {activeColumns.map(col => (
                        <option key={col.value} value={col.value}>{col.label}</option>
                      ))}
                    </select>

                    {/* Hover toggle */}
                    <label className="flex items-center gap-2 text-xs mb-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={popup.hoverEnabled}
                        onChange={e => setPopup(p => p && ({ ...p, hoverEnabled: e.target.checked }))}
                        className="rounded border-gray-300"
                      />
                      <MousePointer2 className="w-3 h-3 text-gray-400" />
                      <span className="text-gray-600">Hover (revelar contenido oculto)</span>
                    </label>

                    {/* Context for AI */}
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                      <MessageSquare className="w-3 h-3 inline mr-1" />
                      Contexto para IA
                    </label>
                    <textarea
                      value={popup.context}
                      onChange={e => setPopup(p => p && ({ ...p, context: e.target.value }))}
                      placeholder="Ej: 'Extraer el precio principal en soles'"
                      rows={2}
                      className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg mb-3 resize-none focus:ring-2 focus:ring-blue-200 outline-none"
                    />

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={confirmCapture}
                        className="flex-1 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition"
                      >
                        Confirmar
                      </button>
                      <button
                        onClick={cancelPopup}
                        className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200 transition"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Captures panel ────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden self-start sticky top-2" style={{ width: '30%', maxHeight: 'calc(100vh - 200px)' }}>
        {/* Full-page captures */}
        <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-sm font-semibold text-gray-700">Capturas de página</h3>
          {fullCaptures.length > 0 ? (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
              {fullCaptures.map((fc, idx) => (
                <div key={fc.id} className="relative flex-shrink-0 group">
                  <button
                    onClick={() => setPreviewImage(fc.dataUri)}
                    className="w-20 h-14 rounded-lg border-2 border-gray-200 overflow-hidden hover:border-blue-400 hover:shadow-md transition bg-white"
                    title={`Captura ${idx + 1} — clic para ver`}
                  >
                    <img src={fc.dataUri} alt={`Captura ${idx + 1}`} className="w-full h-full object-cover object-top" />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteCapture(fc.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-600"
                    title="Eliminar captura"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400 mt-0.5">
              Usa "Captura completa" para capturar toda la página
            </p>
          )}
        </div>

        {/* Captures hierarchy */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {captures.length === 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Camera className="w-7 h-7 text-gray-200 mb-1.5" />
              <p className="text-[11px] text-gray-400">
                1. Dibuja un rect grande (item)<br />
                2. Dibuja rects hijos (campos)
              </p>
            </div>
          )}

          {/* Parent rects (items) with their children */}
          {captures.filter(c => c.parentId === null).map(parent => {
            const children = captures.filter(c => c.parentId === parent.id)
            const isItem = children.length > 0 || !parent.fieldName
            return (
              <div key={parent.id} className="rounded-lg border border-gray-200 overflow-hidden">
                {/* Parent header */}
                <div className="flex items-center gap-2 p-2 bg-blue-50/50">
                  <div className="w-10 h-7 rounded border-2 flex-shrink-0 overflow-hidden bg-gray-200" style={{ borderColor: parent.color }}>
                    {parent.thumbnail && <img src={parent.thumbnail} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    {isItem ? (
                      <span className="text-[11px] font-semibold text-blue-700">
                        Item del catálogo
                      </span>
                    ) : (
                      <select
                        value={parent.fieldName}
                        onChange={e => updateCaptureField(parent.id, e.target.value)}
                        className="w-full px-1 py-0.5 text-[10px] border border-gray-200 rounded bg-white"
                      >
                        <option value="">— Campo —</option>
                        {activeColumns.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    )}
                    {parent.context && (
                      <p className="text-[9px] text-gray-400 truncate mt-0.5" title={parent.context}>{parent.context}</p>
                    )}
                  </div>
                  <button onClick={() => removeCapture(parent.id)} className="p-0.5 text-gray-300 hover:text-red-500 transition">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                {/* Children (fields) */}
                {children.length > 0 && (
                  <div className="divide-y divide-gray-100">
                    {children.map(child => {
                      const col = activeColumns.find(c => c.value === child.fieldName)
                      return (
                        <div key={child.id} className="flex items-center gap-2 px-2 py-1.5 pl-5 bg-white">
                          <div className="w-8 h-5 rounded border flex-shrink-0 overflow-hidden bg-gray-100" style={{ borderColor: child.color }}>
                            {child.thumbnail && <img src={child.thumbnail} alt="" className="w-full h-full object-cover" />}
                          </div>
                          <select
                            value={child.fieldName}
                            onChange={e => updateCaptureField(child.id, e.target.value)}
                            className="flex-1 px-1 py-0.5 text-[10px] border border-gray-200 rounded bg-white"
                          >
                            <option value="">— Campo —</option>
                            {activeColumns.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                          {col && (
                            <span className="text-[9px] text-gray-400 flex-shrink-0">
                              {fieldTypeLabel(col)}
                            </span>
                          )}
                          <button onClick={() => removeCapture(child.id)} className="p-0.5 text-gray-300 hover:text-red-500 transition">
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* Orphan rects rendered inside parents loop above */}
        </div>

        {/* Extract button */}
        {captures.some(c => c.parentId === null) && captures.some(c => c.parentId !== null && c.fieldName) && fullCaptures.length > 0 && (
          <div className="border-t border-gray-100 px-3 py-2.5">
            <button
              onClick={handleExtract}
              disabled={extracting}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition"
            >
              {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {extracting ? 'Extrayendo...' : 'Extraer datos'}
            </button>
          </div>
        )}

        {/* Extract result table */}
        {extractResult && extractResult.items.length > 0 && (() => {
          const items = extractResult.items
          const colKeys = Object.keys(items[0]).filter(k => items.some(it => it[k] !== null))
          return (
            <div className="border-t border-gray-100 bg-gray-50/50 flex flex-col" style={{ maxHeight: 280 }}>
              <div className="flex items-center justify-between px-3 py-1.5">
                <p className="text-[10px] font-semibold text-gray-500 uppercase">
                  {extractResult.total_items} item(s) extraídos
                </p>
                <button onClick={() => setExtractResult(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex-1 overflow-auto px-1 pb-2">
                <table className="w-full text-[10px] border-collapse">
                  <thead>
                    <tr className="bg-gray-100 sticky top-0">
                      <th className="px-1.5 py-1 text-left text-gray-500 font-semibold border border-gray-200">#</th>
                      {colKeys.map(k => (
                        <th key={k} className="px-1.5 py-1 text-left text-gray-500 font-semibold border border-gray-200 whitespace-nowrap">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={i} className="hover:bg-blue-50/50">
                        <td className="px-1.5 py-1 border border-gray-200 text-gray-400">{i + 1}</td>
                        {colKeys.map(k => {
                          const val = item[k]
                          const isUrl = k === 'url_propiedad' || k.includes('url')
                          return (
                            <td key={k} className="px-1.5 py-1 border border-gray-200 text-gray-700 max-w-[120px] truncate">
                              {isUrl && val ? (
                                <button
                                  onClick={() => navigateToDetail(val)}
                                  className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                                  title={val}
                                >
                                  Navegar →
                                </button>
                              ) : (
                                <span title={val ?? ''} className="block truncate">{val ?? '—'}</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {/* Execution progress */}
        {execProgress && (
          <div className="border-t border-gray-100 px-3 py-2 bg-blue-50/50">
            <div className="flex items-center gap-2 mb-1">
              <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
              <p className="text-[10px] font-semibold text-blue-600">{execProgress.phase}</p>
            </div>
            {execProgress.total > 0 && (
              <>
                <div className="w-full bg-blue-100 rounded-full h-1.5 mb-1">
                  <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${(execProgress.current / execProgress.total) * 100}%` }} />
                </div>
                {execProgress.url && <p className="text-[9px] text-blue-400 truncate">{execProgress.url}</p>}
              </>
            )}
          </div>
        )}

        {/* Execution results */}
        {execResults.length > 0 && (() => {
          const colKeys = Object.keys(execResults[0]).filter(k => execResults.some(it => it[k] !== null))
          return (
            <div className="border-t border-gray-100 bg-emerald-50/50 flex flex-col" style={{ maxHeight: 250 }}>
              <div className="flex items-center justify-between px-3 py-1.5">
                <p className="text-[10px] font-semibold text-emerald-600 uppercase">{execResults.length} resultado(s) completos</p>
                <button onClick={() => setExecResults([])} className="text-gray-400 hover:text-gray-600"><X className="w-3 h-3" /></button>
              </div>
              <div className="flex-1 overflow-auto px-1 pb-2">
                <table className="w-full text-[10px] border-collapse">
                  <thead><tr className="bg-emerald-100 sticky top-0">
                    <th className="px-1.5 py-1 text-left text-emerald-700 font-semibold border border-emerald-200">#</th>
                    {colKeys.map(k => <th key={k} className="px-1.5 py-1 text-left text-emerald-700 font-semibold border border-emerald-200 whitespace-nowrap">{k}</th>)}
                  </tr></thead>
                  <tbody>{execResults.map((item, i) => (
                    <tr key={i} className="hover:bg-emerald-50"><td className="px-1.5 py-1 border border-emerald-200 text-gray-400">{i+1}</td>
                      {colKeys.map(k => <td key={k} className="px-1.5 py-1 border border-emerald-200 text-gray-700 max-w-[100px] truncate" title={item[k] ?? ''}>{item[k] ?? '—'}</td>)}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {/* Available fields */}
        <div className="border-t border-gray-100 px-3 py-2 bg-gray-50/50">
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">
            Campos ({subTab === 'proyectos' ? 'Proyecto' : 'Propiedad'})
          </p>
          <div className="flex flex-wrap gap-1">
            {activeColumns.map(col => {
              const assigned = captures.some(c => c.fieldName === col.value)
              return (
                <span
                  key={col.value}
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    assigned ? 'bg-emerald-100 text-emerald-600 line-through' : 'bg-gray-100 text-gray-500'
                  }`}
                  title={col.label}
                >
                  {col.value}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Confirm delete modal ──────────────────────────────────────────── */}
      {confirmDeleteCapture && (
        <div
          className="fixed inset-0 z-[65] bg-black/50 flex items-center justify-center p-8"
          onClick={() => setConfirmDeleteCapture(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-5 w-80 text-center"
            onClick={e => e.stopPropagation()}
          >
            <Trash2 className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-700 mb-1">¿Eliminar esta captura?</p>
            <p className="text-xs text-gray-400 mb-4">Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteCapture(null)}
                className="flex-1 px-3 py-2 text-sm font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setFullCaptures(prev => prev.filter(c => c.id !== confirmDeleteCapture))
                  setConfirmDeleteCapture(null)
                }}
                className="flex-1 px-3 py-2 text-sm font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview modal ──────────────────────────────────────────────────── */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-8"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-5xl w-full max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
              <span className="text-sm font-medium text-gray-700">Captura de página completa</span>
              <button
                onClick={() => setPreviewImage(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2 bg-gray-100">
              <img
                src={previewImage}
                alt="Captura completa"
                className="w-full block rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export default CaptureMode
