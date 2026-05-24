import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBuilding, faXmark, faCircleCheck, faLocationDot, faGlobe,
  faArrowUpRightFromSquare, faHome, faCalendarDays,
  faMagnifyingGlass, faFilter, faChevronRight,
  faAngleLeft, faAngleRight, faExpand, faMapLocationDot,
} from '@fortawesome/free-solid-svg-icons'
import { ScrapedRecord } from '../../../types'
import { allImages, looksLikeImage } from '../helpers/media'
import { isUrlValue as _isUrlValue } from '../helpers/childUrls'
import {
  extractTitle, extractLocation, extractPrice, extractStatus, extractDesc,
  extractPropId, extractPropType, extractBedrooms, extractBathrooms, extractArea,
  recordStatusLabel, statusClass, pick,
} from '../helpers/extractors'
import { fadeUp } from '../animations'

const PER_PAGE = 10

// Fields already shown in the panel summary — exclude from the info dump
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
    return !(v as unknown[]).every(item => looksLikeImage(item))
  }) as [string, unknown[]][]

  const hasExtras = textFields.length > 0 || listFields.length > 0

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" exit="exit" className="p-4 space-y-5">
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
                <span className="text-gray-400 font-medium w-28 flex-shrink-0 truncate capitalize">
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

interface Props {
  record: ScrapedRecord
  childRecords: ScrapedRecord[]
  onClose: () => void
  onOpenProperty: (r: ScrapedRecord) => void
}

export default function ProjectDetailPanel({ record, childRecords, onClose, onOpenProperty }: Props) {
  const [tab, setTab]               = useState<'props' | 'info'>('props')
  const [page, setPage]             = useState(0)
  const [search, setSearch]         = useState('')
  const [imgIdx, setImgIdx]         = useState(0)
  const [lightboxOpen, setLightbox] = useState(false)

  const thumbStripRef  = useRef<HTMLDivElement>(null)
  const thumbRefsStrip = useRef<(HTMLButtonElement | null)[]>([])
  const thumbRefsBox   = useRef<(HTMLButtonElement | null)[]>([])

  const d             = record.data || {}
  const status        = extractStatus(d) || recordStatusLabel(record.status)
  const url           = pick(d, ['url_propiedad', 'url', 'link', 'href'])
  const gmapsUrl      = pick(d, ['gmaps_url'])
  const gmapsCoords   = pick(d, ['gmaps_coordinates'])
  const lastUpd       = new Date(record.scraped_at).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' })

  const allImgs = useMemo(() => allImages(d), [d])

  // Reset on record change
  useEffect(() => { setImgIdx(0); setLightbox(false) }, [record.id])

  // Scroll active thumbnail into view
  useEffect(() => {
    thumbRefsStrip.current[imgIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    thumbRefsBox.current[imgIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [imgIdx])

  const prevImg = useCallback(() => setImgIdx(i => (i - 1 + allImgs.length) % allImgs.length), [allImgs.length])
  const nextImg = useCallback(() => setImgIdx(i => (i + 1) % allImgs.length), [allImgs.length])

  // Keyboard nav for lightbox
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
    if (!search.trim()) return childRecords
    const q = search.toLowerCase()
    return childRecords.filter(r => {
      const rd = r.data || {}
      return extractTitle(rd).toLowerCase().includes(q)
        || extractPropId(rd, r.id).toLowerCase().includes(q)
        || extractPropType(rd).toLowerCase().includes(q)
    })
  }, [childRecords, search])

  const totalPages = Math.ceil(filtered.length / PER_PAGE)
  const pageItems  = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const hasImgs    = allImgs.length > 0

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Hero carousel ─────────────────────────────────── */}
      <div className="relative flex-shrink-0">

        {/* Main image */}
        <div
          className="h-44 bg-gray-200 overflow-hidden relative group"
          style={{ cursor: hasImgs ? 'zoom-in' : 'default' }}
          onClick={() => hasImgs && setLightbox(true)}
        >
          {hasImgs
            ? <img key={imgIdx} src={allImgs[imgIdx]} alt=""
                className="w-full h-full object-cover transition-opacity duration-200" />
            : <div className="w-full h-full bg-gradient-to-br from-blue-100 to-gray-200 flex items-center justify-center">
                <FontAwesomeIcon icon={faBuilding} className="text-4xl text-gray-300" />
              </div>
          }

          {/* Hover expand hint */}
          {hasImgs && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors flex items-center justify-center pointer-events-none">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 text-white rounded-full p-2.5">
                <FontAwesomeIcon icon={faExpand} className="text-sm" />
              </div>
            </div>
          )}

          {/* Counter */}
          {allImgs.length > 1 && (
            <div className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full pointer-events-none">
              {imgIdx + 1} / {allImgs.length}
            </div>
          )}

          {/* Prev / Next arrows */}
          {allImgs.length > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); prevImg() }}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-black/40 hover:bg-black/65 text-white rounded-full flex items-center justify-center transition opacity-0 group-hover:opacity-100 z-10"
              >
                <FontAwesomeIcon icon={faAngleLeft} className="text-xs" />
              </button>
              <button
                onClick={e => { e.stopPropagation(); nextImg() }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-black/40 hover:bg-black/65 text-white rounded-full flex items-center justify-center transition opacity-0 group-hover:opacity-100 z-10"
              >
                <FontAwesomeIcon icon={faAngleRight} className="text-xs" />
              </button>
            </>
          )}
        </div>

        {/* Close button (always visible) */}
        <button onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow transition z-20">
          <FontAwesomeIcon icon={faXmark} className="text-gray-600 text-sm" />
        </button>

        {/* Thumbnail strip */}
        {allImgs.length > 1 && (
          <div
            ref={thumbStripRef}
            className="flex gap-1.5 overflow-x-auto px-3 py-2 bg-gray-50 border-b border-gray-100"
            style={{ scrollbarWidth: 'none' }}
          >
            {allImgs.map((src, i) => (
              <button
                key={i}
                ref={el => { thumbRefsStrip.current[i] = el }}
                onClick={() => setImgIdx(i)}
                className={`w-12 h-9 flex-shrink-0 rounded overflow-hidden border-2 transition-all ${
                  i === imgIdx
                    ? 'border-blue-500 opacity-100 scale-105'
                    : 'border-transparent opacity-55 hover:opacity-85'
                }`}
              >
                <img src={src} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Project summary ───────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h2 className="font-bold text-gray-900 text-sm leading-snug flex-1">{extractTitle(d)}</h2>
          {status && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${statusClass(status)}`}>
              <FontAwesomeIcon icon={faCircleCheck} className="mr-0.5 text-[9px]" />{status}
            </span>
          )}
        </div>
        <div className="space-y-0.5 text-xs text-gray-500">
          {extractLocation(d) && (
            <div className="flex items-center gap-1.5">
              <FontAwesomeIcon icon={faLocationDot} className="text-gray-400 w-3 flex-shrink-0" />
              {extractLocation(d)}
            </div>
          )}
          {extractPrice(d) && (
            <div className="flex items-center gap-1.5 text-gray-700 font-medium">
              <span className="w-3 text-center text-gray-400">S/</span>
              Desde {extractPrice(d)}
            </div>
          )}
          {url && (
            <div className="flex items-center gap-1.5">
              <FontAwesomeIcon icon={faGlobe} className="text-gray-400 w-3 flex-shrink-0" />
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="text-blue-600 hover:underline truncate text-xs">
                {url.replace(/^https?:\/\//, '').slice(0, 50)}
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="ml-1 text-[9px]" />
              </a>
            </div>
          )}
          {gmapsUrl && (
            <div className="flex items-center gap-1.5">
              <FontAwesomeIcon icon={faMapLocationDot} className="text-green-500 w-3 flex-shrink-0" />
              <a href={gmapsUrl} target="_blank" rel="noopener noreferrer"
                className="text-green-600 hover:underline truncate text-xs font-medium">
                Ver en Google Maps
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="ml-1 text-[9px]" />
              </a>
              {gmapsCoords && (
                <span className="text-gray-400 text-[10px] font-mono ml-1 truncate">
                  ({gmapsCoords})
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Stats bar ─────────────────────────────────────── */}
      <div className="grid grid-cols-4 flex-shrink-0">
        {[
          { v: String(childRecords.length), l: 'Propiedades',        i: faHome },
          { v: extractPrice(d) || '—',      l: 'Precio desde',       i: null },
          { v: lastUpd,                      l: 'Últ. actualización', i: faCalendarDays },
          { v: status || '—',               l: 'Estado',              i: faCircleCheck },
        ].map((s, i) => (
          <div key={i} className={`py-2.5 px-2 text-center border-b border-gray-100 ${i < 3 ? 'border-r' : ''}`}>
            {s.i && <FontAwesomeIcon icon={s.i} className="text-gray-400 text-[10px] mb-0.5 block mx-auto" />}
            <p className="text-[11px] font-bold text-gray-900 truncate">{s.v}</p>
            <p className="text-[9px] text-gray-400 leading-tight">{s.l}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs ──────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200 px-4 flex-shrink-0">
        {(['props', 'info'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            {t === 'props' ? 'Propiedades' : 'Información del proyecto'}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {tab === 'props' ? (
            <motion.div key="props" variants={fadeUp} initial="hidden" animate="visible" exit="exit" className="p-4">
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[11px]" />
                  <input type="text" placeholder="Buscar propiedad..." value={search}
                    onChange={e => { setSearch(e.target.value); setPage(0) }}
                    className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition">
                  <FontAwesomeIcon icon={faFilter} className="text-[10px]" /> Filtros
                </button>
              </div>

              {filtered.length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-8">No se encontraron propiedades</p>
              ) : (
                <>
                  <div className="overflow-x-auto -mx-4 px-0">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-gray-400 font-semibold uppercase tracking-wide text-[10px]">
                          {['Propiedad', 'Tipo', 'Dorms', 'Baños', 'Área (m²)', 'Estado', 'Acción'].map(h => (
                            <th key={h} className="py-2 px-3 text-left first:pl-4 last:pr-4 whitespace-nowrap">{h}</th>
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
                          const pStat  = extractStatus(rd) || recordStatusLabel(r.status)

                          return (
                            <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                              <td className="py-2.5 px-3 pl-4">
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
                                    <p className="font-semibold text-gray-800 truncate max-w-[72px] text-[11px]">{pTitle}</p>
                                    <p className="text-gray-400 font-mono text-[9px]">{pId}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">{extractPropType(rd) || '—'}</td>
                              <td className="py-2.5 px-3 text-center text-gray-700 font-medium">{extractBedrooms(rd) || '—'}</td>
                              <td className="py-2.5 px-3 text-center text-gray-700 font-medium">{extractBathrooms(rd) || '—'}</td>
                              <td className="py-2.5 px-3 text-center text-gray-600">{extractArea(rd) || '—'}</td>
                              <td className="py-2.5 px-3 text-center">
                                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${statusClass(pStat)}`}>
                                  ✓ {pStat}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 pr-4 text-center">
                                <button onClick={() => onOpenProperty(r)}
                                  className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 hover:bg-blue-50 px-2 py-1 rounded-lg transition whitespace-nowrap">
                                  Ver detalles <FontAwesomeIcon icon={faChevronRight} className="text-[8px] ml-0.5" />
                                </button>
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
          ) : (
            <InfoTab key="info" d={d} />
          )}
        </AnimatePresence>
      </div>

      {/* ── Lightbox (portal → escapes any transform stacking context) ── */}
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
              {/* Top bar */}
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

              {/* Main image */}
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

                {/* Prev */}
                {allImgs.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); prevImg() }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/25 text-white rounded-full flex items-center justify-center transition"
                  >
                    <FontAwesomeIcon icon={faAngleLeft} className="text-lg" />
                  </button>
                )}

                {/* Next */}
                {allImgs.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); nextImg() }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/25 text-white rounded-full flex items-center justify-center transition"
                  >
                    <FontAwesomeIcon icon={faAngleRight} className="text-lg" />
                  </button>
                )}
              </div>

              {/* Thumbnail strip */}
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
                      i === imgIdx
                        ? 'border-white opacity-100 scale-105'
                        : 'border-transparent opacity-40 hover:opacity-80'
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
