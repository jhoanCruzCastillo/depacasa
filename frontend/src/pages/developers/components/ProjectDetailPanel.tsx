import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBuilding, faXmark, faCircleCheck, faLocationDot, faGlobe,
  faArrowUpRightFromSquare, faHome, faCalendarDays,
  faMagnifyingGlass, faChevronRight,
  faAngleLeft, faAngleRight, faExpand, faMapLocationDot, faTag,
  faPencil, faChevronDown, faSpinner, faCheckSquare,
} from '@fortawesome/free-solid-svg-icons'
import toast from 'react-hot-toast'
import { ScrapedRecord, PropiedadStatus } from '../../../types'
import { updatePropiedad } from '../../../services/api'
import { allImages, looksLikeImage } from '../helpers/media'
import { isUrlValue as _isUrlValue } from '../helpers/childUrls'
import {
  extractTitle, extractLocation, extractPrice, extractStatus, extractDesc,
  extractPropId, extractPropType, extractBedrooms, extractBathrooms, extractArea,
  recordStatusLabel, propiedadStatusClass, statusClass, pick,
} from '../helpers/extractors'
import { fadeUp } from '../animations'

const PER_PAGE         = 10
const GALLERY_PER_PAGE = 12

const SUMMARY_FIELDS = new Set([
  'ubicacion', 'ubicación', 'location', 'distrito', 'ciudad', 'zona', 'direccion', 'barrio',
  'precio_desde', 'precio desde', 'precio', 'price', 'costo', 'valor', 'rango_precio', 'precio_venta',
  'estado_del_proyecto', 'estado del proyecto', 'estado_proyecto', 'estado', 'status', 'disponibilidad', 'estado_disponibilidad',
  'descripcion', 'descripción', 'description', 'resumen', 'detalle', 'acerca',
  'nombre', 'name', 'titulo', 'title', 'proyecto', 'project_name', 'nombre_proyecto',
  'url_propiedad', 'url_proyecto', 'url', 'link', 'href',
  'gmaps_url', 'gmaps_coordinates',
])

const FIELD_LABELS: Record<string, string> = {
  areas_comunes_imagenes: 'Áreas comunes',
  lugares_cercanos:       'Lugares cercanos',
}

function InfoTab({ d }: { d: Record<string, unknown> }) {
  const desc = extractDesc(d)

  const textFields = Object.entries(d).filter(([k, v]) => {
    if (SUMMARY_FIELDS.has(k.toLowerCase())) return false
    if (Array.isArray(v)) return false
    if (looksLikeImage(v)) return false
    if (_isUrlValue(v)) return false
    const str = String(v ?? '').trim()
    return str !== '' && str.toLowerCase() !== 'null'
  })

  const listFields = Object.entries(d).filter(([k, v]) => {
    if (SUMMARY_FIELDS.has(k.toLowerCase())) return false
    if (!Array.isArray(v) || v.length === 0) return false
    return !(v as unknown[]).some(item => looksLikeImage(item))
  }) as [string, unknown[]][]

  const hasExtras = textFields.length > 0 || listFields.length > 0

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" exit="exit" className="p-5 space-y-5">
      {desc && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Descripción</p>
          <p className="text-xs text-gray-600 leading-relaxed">{desc}</p>
        </div>
      )}

      {listFields.map(([k, items]) => (
        <div key={k}>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {FIELD_LABELS[k] ?? k.replace(/_/g, ' ')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(items as unknown[]).map((item, i) => (
              <span key={i} className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-[10px] leading-tight">
                {String(item)}
              </span>
            ))}
          </div>
        </div>
      ))}

      {textFields.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Datos del proyecto</p>
          <div className="space-y-1.5">
            {textFields.map(([k, v]) => (
              <div key={k} className="flex gap-3 text-xs">
                <span className="text-gray-400 font-medium w-36 flex-shrink-0 truncate capitalize">
                  {FIELD_LABELS[k] ?? k.replace(/_/g, ' ')}
                </span>
                <span className="text-gray-700 flex-1 break-words">{String(v ?? '—')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!desc && !hasExtras && (
        <p className="text-center text-xs text-gray-400 py-6">Sin información adicional del proyecto</p>
      )}
    </motion.div>
  )
}

const STATUS_OPTIONS: { value: PropiedadStatus; label: string }[] = [
  { value: 'pending_review', label: 'Pendiente' },
  { value: 'public',         label: 'Público'   },
  { value: 'partial',        label: 'Parcial'   },
  { value: 'failed',         label: 'Error'     },
]

interface Props {
  record: ScrapedRecord
  childRecords: ScrapedRecord[]
  developerId: string
  onClose: () => void
  onOpenProperty: (r: ScrapedRecord) => void
  onEditProperty: (r: ScrapedRecord) => void
}

export default function ProjectDetailPanel({ record, childRecords, developerId, onClose, onOpenProperty, onEditProperty }: Props) {
  const queryClient = useQueryClient()

  const [tab, setTab]               = useState<'props' | 'info' | 'gallery'>('props')
  const [page, setPage]             = useState(0)
  const [galleryPage, setGalleryPage] = useState(0)
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState<string>('')
  const [pendingChange, setPendingChange] = useState<{ ids: string[]; newStatus: string } | null>(null)
  const [applying, setApplying]     = useState(false)
  const [imgIdx, setImgIdx]         = useState(0)
  const [lightboxOpen, setLightbox] = useState(false)

  // local status overrides so UI updates instantly before refetch
  const [localStatuses, setLocalStatuses] = useState<Record<string, PropiedadStatus>>({})

  const thumbRefsStrip = useRef<(HTMLButtonElement | null)[]>([])
  const thumbRefsBox   = useRef<(HTMLButtonElement | null)[]>([])

  const d           = record.data || {}
  const status      = extractStatus(d) || recordStatusLabel(record.status)
  const url         = pick(d, ['url_propiedad', 'url', 'link', 'href'])
  const gmapsUrl    = pick(d, ['gmaps_url'])
  const lastUpd     = new Date(record.scraped_at).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' })

  const allImgs = useMemo(() => allImages(d), [d])
  const hasImgs = allImgs.length > 0

  useEffect(() => {
    setImgIdx(0); setLightbox(false); setTab('props'); setSearch(''); setPage(0); setGalleryPage(0)
    setSelected(new Set()); setStatusFilter('all'); setBulkStatus(''); setLocalStatuses({})
  }, [record.id])

  useEffect(() => {
    thumbRefsStrip.current[imgIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    thumbRefsBox.current[imgIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [imgIdx])

  const prevImg = useCallback(() => setImgIdx(i => (i - 1 + allImgs.length) % allImgs.length), [allImgs.length])
  const nextImg = useCallback(() => setImgIdx(i => (i + 1) % allImgs.length), [allImgs.length])

  useEffect(() => {
    if (!lightboxOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  prevImg()
      if (e.key === 'ArrowRight') nextImg()
      if (e.key === 'Escape')     setLightbox(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightboxOpen, prevImg, nextImg])

  const filtered = useMemo(() => {
    let rows = childRecords
    if (statusFilter !== 'all') {
      rows = rows.filter(r => {
        const eff = (localStatuses[r.id] ?? r.status) as string
        if (statusFilter === 'pending') return eff === 'pending_review' || eff === 'success'
        return eff === statusFilter
      })
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r => {
        const rd = r.data || {}
        return extractTitle(rd).toLowerCase().includes(q)
          || extractPropId(rd, r.id).toLowerCase().includes(q)
          || extractPropType(rd).toLowerCase().includes(q)
      })
    }
    return rows
  }, [childRecords, search, statusFilter, localStatuses])

  const totalPages    = Math.ceil(filtered.length / PER_PAGE)
  const pageItems     = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE)

  // helpers
  const effectiveStatus = (r: ScrapedRecord) =>
    (localStatuses[r.id] ?? r.status) as PropiedadStatus

  const allSelected   = pageItems.length > 0 && pageItems.every(r => selected.has(r.id))
  const someSelected  = pageItems.some(r => selected.has(r.id)) && !allSelected

  const toggleRow = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const toggleAll = () => {
    if (allSelected) setSelected(prev => { const s = new Set(prev); pageItems.forEach(r => s.delete(r.id)); return s })
    else              setSelected(prev => { const s = new Set(prev); pageItems.forEach(r => s.add(r.id)); return s })
  }

  const applyStatusChange = async (ids: string[], newStatus: string) => {
    setApplying(true)
    try {
      await Promise.all(ids.map(id => updatePropiedad(id, { status: newStatus })))
      setLocalStatuses(prev => {
        const next = { ...prev }
        ids.forEach(id => { next[id] = newStatus as PropiedadStatus })
        return next
      })
      setSelected(new Set())
      setBulkStatus('')
      queryClient.invalidateQueries({ queryKey: ['records', developerId] })
      toast.success(ids.length === 1 ? 'Estado actualizado' : `${ids.length} propiedades actualizadas`)
    } catch { toast.error('Error al cambiar estado') }
    finally { setApplying(false); setPendingChange(null) }
  }

  const galleryTotal = Math.ceil(allImgs.length / GALLERY_PER_PAGE)
  const galleryItems = allImgs.slice(galleryPage * GALLERY_PER_PAGE, (galleryPage + 1) * GALLERY_PER_PAGE)

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <FontAwesomeIcon icon={faBuilding} className="text-blue-600 text-sm" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-bold text-gray-900 text-base leading-snug">{extractTitle(d)}</h2>
            {status && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${statusClass(status)}`}>
                <FontAwesomeIcon icon={faCircleCheck} className="mr-0.5 text-[9px]" />{status}
              </span>
            )}
          </div>
          {extractLocation(d) && (
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-gray-500">
              <FontAwesomeIcon icon={faLocationDot} className="text-gray-400 w-3 flex-shrink-0" />
              {extractLocation(d)}
            </div>
          )}
        </div>
        <button onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition flex-shrink-0 text-gray-400 hover:text-gray-600">
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      {/* ── Price / links bar ────────────────────────────── */}
      {(extractPrice(d) || url || gmapsUrl) && (
        <div className="flex items-center gap-5 px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex-shrink-0 flex-wrap text-xs">
          {extractPrice(d) && (
            <span className="flex items-center gap-1.5 font-semibold text-gray-900">
              <FontAwesomeIcon icon={faTag} className="text-gray-400 text-[10px]" />
              Precio desde: {extractPrice(d)}
            </span>
          )}
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-600 hover:underline">
              <FontAwesomeIcon icon={faGlobe} className="text-[10px]" />
              Website
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-[9px] ml-0.5" />
            </a>
          )}
          {gmapsUrl && (
            <a href={gmapsUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-green-600 hover:underline">
              <FontAwesomeIcon icon={faMapLocationDot} className="text-[10px]" />
              Google Maps
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-[9px] ml-0.5" />
            </a>
          )}
        </div>
      )}

      {/* ── 2-column: carousel + summary ─────────────────── */}
      <div className="flex gap-5 p-5 border-b border-gray-100 flex-shrink-0">

        {/* Left: carousel */}
        <div className="flex-1 min-w-0">
          <div
            className="relative h-52 rounded-xl overflow-hidden bg-gray-100 group"
            style={{ cursor: hasImgs ? 'zoom-in' : 'default' }}
            onClick={() => hasImgs && setLightbox(true)}
          >
            {hasImgs
              ? <img src={allImgs[imgIdx]} alt="" className="w-full h-full object-cover transition-opacity duration-200" />
              : <div className="flex items-center justify-center h-full">
                  <FontAwesomeIcon icon={faBuilding} className="text-4xl text-gray-300" />
                </div>
            }
            {hasImgs && (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition flex items-center justify-center pointer-events-none">
                <div className="opacity-0 group-hover:opacity-100 transition bg-black/50 text-white rounded-full p-2">
                  <FontAwesomeIcon icon={faExpand} className="text-sm" />
                </div>
              </div>
            )}
            {allImgs.length > 1 && (
              <>
                <button onClick={e => { e.stopPropagation(); prevImg() }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-black/40 hover:bg-black/65 text-white rounded-full flex items-center justify-center transition opacity-0 group-hover:opacity-100 z-10">
                  <FontAwesomeIcon icon={faAngleLeft} className="text-xs" />
                </button>
                <button onClick={e => { e.stopPropagation(); nextImg() }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-black/40 hover:bg-black/65 text-white rounded-full flex items-center justify-center transition opacity-0 group-hover:opacity-100 z-10">
                  <FontAwesomeIcon icon={faAngleRight} className="text-xs" />
                </button>
                <div className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full pointer-events-none">
                  {imgIdx + 1} / {allImgs.length}
                </div>
              </>
            )}
          </div>

          {/* Thumbnail strip */}
          {allImgs.length > 1 && (
            <div className="flex gap-1.5 mt-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {allImgs.map((src, i) => (
                <button key={i} ref={el => { thumbRefsStrip.current[i] = el }} onClick={() => setImgIdx(i)}
                  className={`w-12 h-9 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                    i === imgIdx ? 'border-blue-500 opacity-100 scale-105' : 'border-transparent opacity-55 hover:opacity-80'
                  }`}>
                  <img src={src} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: summary card */}
        <div className="w-56 flex-shrink-0">
          <div className="bg-gray-50 rounded-xl p-4 h-full flex flex-col">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-3">Resumen del proyecto</p>
            <div className="space-y-3 flex-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 flex items-center gap-1.5">
                  <FontAwesomeIcon icon={faHome} className="text-gray-400 text-[10px]" />
                  Propiedades
                </span>
                <span className="font-bold text-gray-900">{childRecords.length}</span>
              </div>
              {extractPrice(d) && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <FontAwesomeIcon icon={faTag} className="text-gray-400 text-[10px]" />
                    Precio desde
                  </span>
                  <span className="font-bold text-gray-900 text-right max-w-[110px] truncate">{extractPrice(d)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 flex items-center gap-1.5">
                  <FontAwesomeIcon icon={faCalendarDays} className="text-gray-400 text-[10px]" />
                  Actualizado
                </span>
                <span className="font-semibold text-gray-700">{lastUpd}</span>
              </div>
              {status && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <FontAwesomeIcon icon={faCircleCheck} className="text-gray-400 text-[10px]" />
                    Estado
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusClass(status)}`}>{status}</span>
                </div>
              )}
            </div>
            <div className="mt-4 space-y-2">
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border border-blue-200 text-blue-600 text-xs font-medium hover:bg-blue-50 transition">
                  <FontAwesomeIcon icon={faGlobe} className="text-[10px]" />
                  Ver proyecto
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-[9px]" />
                </a>
              )}
              {gmapsUrl && (
                <a href={gmapsUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border border-green-200 text-green-600 text-xs font-medium hover:bg-green-50 transition">
                  <FontAwesomeIcon icon={faMapLocationDot} className="text-[10px]" />
                  Google Maps
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-[9px]" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200 px-5 flex-shrink-0">
        {(['props', 'info', 'gallery'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            {t === 'props'
              ? `Propiedades${childRecords.length > 0 ? ` (${childRecords.length})` : ''}`
              : t === 'info'
              ? 'Información del proyecto'
              : `Galería${allImgs.length > 0 ? ` (${allImgs.length})` : ''}`
            }
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <AnimatePresence mode="wait">

          {tab === 'props' && (
            <motion.div key="props" variants={fadeUp} initial="hidden" animate="visible" exit="exit" className="p-5">

              {/* Bulk action bar — visible only when rows are selected */}
              {selected.size > 0 && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl flex-wrap">
                  <FontAwesomeIcon icon={faCheckSquare} className="text-blue-500 text-sm flex-shrink-0" />
                  <span className="text-xs font-bold text-blue-700">{selected.size} seleccionada{selected.size !== 1 ? 's' : ''}</span>
                  <button onClick={() => setSelected(new Set())}
                    className="text-xs text-blue-600 hover:underline">Deseleccionar</button>
                  <span className="text-blue-300 mx-1">|</span>
                  <span className="text-xs text-gray-600">Cambiar estado a</span>
                  <div className="relative">
                    <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 pr-6 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer">
                      <option value="">Seleccionar estado</option>
                      {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <FontAwesomeIcon icon={faChevronDown} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-[9px] pointer-events-none" />
                  </div>
                  <button
                    disabled={!bulkStatus || applying}
                    onClick={() => bulkStatus && setPendingChange({ ids: [...selected], newStatus: bulkStatus })}
                    className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition ml-auto">
                    {applying ? <FontAwesomeIcon icon={faSpinner} className="animate-spin" /> : <FontAwesomeIcon icon={faChevronRight} className="text-[9px]" />}
                    Aplicar
                  </button>
                </div>
              )}

              {/* Search + status filter */}
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[11px]" />
                  <input type="text" placeholder="Buscar propiedad..." value={search}
                    onChange={e => { setSearch(e.target.value); setPage(0) }}
                    className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="relative flex-shrink-0">
                  <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}
                    className="text-xs border border-gray-200 rounded-lg pl-2.5 pr-7 py-1.5 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer font-medium text-gray-600">
                    <option value="all">Estado: Todos</option>
                    <option value="pending">Pendiente</option>
                    <option value="public">Público</option>
                    <option value="partial">Parcial</option>
                    <option value="failed">Error</option>
                  </select>
                  <FontAwesomeIcon icon={faChevronDown} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-[9px] pointer-events-none" />
                </div>
              </div>

              {filtered.length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-8">No se encontraron propiedades</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-gray-400 font-semibold uppercase tracking-wide text-[10px]">
                          <th className="py-2 pl-3 pr-1 w-8">
                            <input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected }}
                              onChange={toggleAll}
                              className="w-3.5 h-3.5 rounded border-gray-300 accent-blue-600 cursor-pointer" />
                          </th>
                          {['Propiedad', 'Tipo', 'Dorms', 'Baños', 'Área (m²)', 'Estado', 'Acción'].map(h => (
                            <th key={h} className="py-2 px-3 text-left last:pr-4 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageItems.map(r => {
                          const rd     = r.data || {}
                          const pImgs  = allImages(rd)
                          const pImg   = pImgs[0] ?? null
                          const pTitle = extractTitle(rd)
                          const pId    = extractPropId(rd, r.id)
                          const pSt    = effectiveStatus(r)

                          return (
                            <tr key={r.id}
                              className={`border-t border-gray-50 transition-colors ${selected.has(r.id) ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}>
                              <td className="py-2.5 pl-3 pr-1">
                                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)}
                                  className="w-3.5 h-3.5 rounded border-gray-300 accent-blue-600 cursor-pointer" />
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                                    {pImg
                                      ? <img src={pImg} alt="" className="w-full h-full object-cover" />
                                      : <div className="w-full h-full flex items-center justify-center">
                                          <FontAwesomeIcon icon={faHome} className="text-gray-300 text-[10px]" />
                                        </div>
                                    }
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-semibold text-gray-800 truncate max-w-[90px] text-[11px]">{pTitle}</p>
                                    <p className="text-gray-400 font-mono text-[9px]">{pId}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">{extractPropType(rd) || '—'}</td>
                              <td className="py-2.5 px-3 text-center text-gray-700 font-medium">{extractBedrooms(rd) || '—'}</td>
                              <td className="py-2.5 px-3 text-center text-gray-700 font-medium">{extractBathrooms(rd) || '—'}</td>
                              <td className="py-2.5 px-3 text-center text-gray-600">{extractArea(rd) || '—'}</td>
                              <td className="py-2.5 px-3">
                                {/* Inline status dropdown */}
                                <div className={`relative inline-flex items-center rounded-full ${propiedadStatusClass(pSt)}`}>
                                  <select
                                    value={pSt}
                                    onChange={e => setPendingChange({ ids: [r.id], newStatus: e.target.value })}
                                    className="appearance-none bg-transparent text-[10px] font-bold pl-2.5 pr-6 py-0.5 cursor-pointer border-0 focus:outline-none"
                                    style={{ color: 'inherit' }}
                                  >
                                    {STATUS_OPTIONS.map(o => (
                                      <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                  </select>
                                  <FontAwesomeIcon icon={faChevronDown} className="absolute right-1.5 text-[8px] pointer-events-none opacity-60" />
                                </div>
                              </td>
                              <td className="py-2.5 px-3 pr-4">
                                <div className="flex items-center gap-1.5 justify-center">
                                  <button onClick={() => onEditProperty(r)}
                                    className="flex items-center gap-1 text-[10px] font-semibold text-gray-600 hover:text-gray-800 border border-gray-200 hover:bg-gray-50 px-2 py-1 rounded-lg transition whitespace-nowrap">
                                    <FontAwesomeIcon icon={faPencil} className="text-[8px]" /> Editar
                                  </button>
                                  <button onClick={() => onOpenProperty(r)}
                                    className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 hover:bg-blue-50 px-2 py-1 rounded-lg transition whitespace-nowrap">
                                    Ver <FontAwesomeIcon icon={faChevronRight} className="text-[8px]" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                    <span className="text-[10px] text-gray-400">
                      Mostrando {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, filtered.length)} de {filtered.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-400 mr-1">10 por página</span>
                      <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                        className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40 transition">
                        <FontAwesomeIcon icon={faAngleLeft} className="text-gray-600 text-[10px]" />
                      </button>
                      <span className="w-6 h-6 rounded bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                        {page + 1}
                      </span>
                      <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                        className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40 transition">
                        <FontAwesomeIcon icon={faAngleRight} className="text-gray-600 text-[10px]" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {tab === 'info' && <InfoTab key="info" d={d} />}

          {tab === 'gallery' && (
            <motion.div key="gallery" variants={fadeUp} initial="hidden" animate="visible" exit="exit" className="p-5 flex flex-col gap-4">
              {allImgs.length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-8">Sin imágenes disponibles</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {galleryItems.map((src, i) => {
                      const globalIdx = galleryPage * GALLERY_PER_PAGE + i
                      return (
                        <button key={globalIdx} onClick={() => { setImgIdx(globalIdx); setLightbox(true) }}
                          className="aspect-square rounded-xl overflow-hidden bg-gray-100 hover:ring-2 hover:ring-blue-400 transition group relative">
                          <img src={src} alt="" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center">
                            <FontAwesomeIcon icon={faExpand} className="text-white opacity-0 group-hover:opacity-100 transition text-lg drop-shadow" />
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {galleryTotal > 1 && (
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                      <span className="text-[10px] text-gray-400">
                        {galleryPage * GALLERY_PER_PAGE + 1}–{Math.min((galleryPage + 1) * GALLERY_PER_PAGE, allImgs.length)} de {allImgs.length} imágenes
                      </span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setGalleryPage(p => Math.max(0, p - 1))} disabled={galleryPage === 0}
                          className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40 transition">
                          <FontAwesomeIcon icon={faAngleLeft} className="text-gray-600 text-[10px]" />
                        </button>
                        {Array.from({ length: galleryTotal }, (_, i) => i)
                          .slice(Math.max(0, galleryPage - 2), Math.min(galleryTotal, galleryPage + 3))
                          .map(p => (
                            <button key={p} onClick={() => setGalleryPage(p)}
                              className={`w-6 h-6 rounded text-[10px] font-bold flex items-center justify-center transition ${
                                p === galleryPage
                                  ? 'bg-blue-600 text-white'
                                  : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                              }`}>
                              {p + 1}
                            </button>
                          ))
                        }
                        <button onClick={() => setGalleryPage(p => Math.min(galleryTotal - 1, p + 1))} disabled={galleryPage >= galleryTotal - 1}
                          className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40 transition">
                          <FontAwesomeIcon icon={faAngleRight} className="text-gray-600 text-[10px]" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── Footer ────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 flex-shrink-0 bg-white">
        <button onClick={onClose}
          className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
          Cerrar
        </button>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition">
            <FontAwesomeIcon icon={faBuilding} />
            Gestionar proyecto
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-xs opacity-70" />
          </a>
        ) : (
          <span className="text-xs text-gray-400">Sin URL de proyecto</span>
        )}
      </div>

      {/* ── Confirmation dialog ───────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {pendingChange && (
            <motion.div
              className="fixed inset-0 z-[70] flex items-center justify-center p-4"
              style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setPendingChange(null)}
            >
              <motion.div
                className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm"
                initial={{ opacity: 0, scale: 0.95, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                onClick={e => e.stopPropagation()}
              >
                <h3 className="font-bold text-gray-900 text-base mb-1">¿Confirmar cambio de estado?</h3>
                <p className="text-sm text-gray-500 mb-5">
                  {pendingChange.ids.length === 1
                    ? 'Se actualizará el estado de esta propiedad a '
                    : `Se actualizarán ${pendingChange.ids.length} propiedades al estado `
                  }
                  <span className={`inline-flex items-center font-bold px-2 py-0.5 rounded-full text-xs ${propiedadStatusClass(pendingChange.newStatus as PropiedadStatus)}`}>
                    {STATUS_OPTIONS.find(o => o.value === pendingChange.newStatus)?.label ?? pendingChange.newStatus}
                  </span>
                  .
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setPendingChange(null)}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                    Cancelar
                  </button>
                  <button
                    onClick={() => applyStatusChange(pendingChange.ids, pendingChange.newStatus)}
                    disabled={applying}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
                    {applying && <FontAwesomeIcon icon={faSpinner} className="animate-spin text-xs" />}
                    Confirmar
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Lightbox ──────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {lightboxOpen && (
            <motion.div
              className="fixed inset-0 flex flex-col bg-black"
              style={{ zIndex: 9999 }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setLightbox(false)}
            >
              <div
                className="flex-shrink-0 flex items-center justify-between px-5 py-3 bg-black/60 border-b border-white/10"
                onClick={e => e.stopPropagation()}
              >
                <span className="text-white/70 text-sm font-medium">
                  {imgIdx + 1} <span className="text-white/30">/ {allImgs.length}</span>
                </span>
                <button
                  onClick={() => setLightbox(false)}
                  className="flex items-center gap-2 px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-lg border border-white/20 transition"
                >
                  <FontAwesomeIcon icon={faXmark} />
                  Cerrar
                </button>
              </div>

              <div
                className="flex-1 flex items-center justify-center relative px-16 py-6 min-h-0"
                onClick={e => e.stopPropagation()}
              >
                <AnimatePresence mode="wait">
                  <motion.img
                    key={imgIdx}
                    src={allImgs[imgIdx]}
                    alt=""
                    className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.14 }}
                  />
                </AnimatePresence>

                {allImgs.length > 1 && (
                  <>
                    <button
                      onClick={e => { e.stopPropagation(); prevImg() }}
                      className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/25 text-white rounded-full flex items-center justify-center transition"
                    >
                      <FontAwesomeIcon icon={faAngleLeft} className="text-lg" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); nextImg() }}
                      className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/25 text-white rounded-full flex items-center justify-center transition"
                    >
                      <FontAwesomeIcon icon={faAngleRight} className="text-lg" />
                    </button>
                  </>
                )}
              </div>

              <div
                className="flex-shrink-0 flex gap-2 overflow-x-auto px-6 py-3 bg-black/50 border-t border-white/10"
                style={{ scrollbarWidth: 'thin', scrollbarColor: '#555 transparent' }}
                onClick={e => e.stopPropagation()}
              >
                {allImgs.map((src, i) => (
                  <button
                    key={i}
                    ref={el => { thumbRefsBox.current[i] = el }}
                    onClick={() => setImgIdx(i)}
                    className={`w-16 h-12 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                      i === imgIdx ? 'border-white opacity-100 scale-105' : 'border-transparent opacity-40 hover:opacity-80'
                    }`}
                  >
                    <img src={src} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
