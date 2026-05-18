import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBuilding, faXmark, faAngleLeft, faAngleRight,
  faRuler, faBed, faBath, faLocationDot,
  faCalendarDays, faTableCells, faGlobe, faArrowUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons'
import { ScrapedRecord } from '../../../types'
import { allImages } from '../helpers/media'
import {
  extractTitle, extractPropId, extractStatus, extractPrice,
  extractArea, extractBedrooms, extractBathrooms, extractLocation,
  extractModel, extractDesc, extractTags, pick, statusClass,
} from '../helpers/extractors'
import { scaleIn } from '../animations'

interface Props {
  record: ScrapedRecord | null
  open: boolean
  onClose: () => void
}

export default function PropertyModal({ record, open, onClose }: Props) {
  const [idx, setIdx] = useState(0)
  const d    = record?.data || {}
  const imgs = useMemo(() => allImages(d), [d])

  useEffect(() => { setIdx(0) }, [record?.id])
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!record) return null

  const status      = extractStatus(d)
  const identifier  = extractPropId(d, record.id)
  const commonAreas = extractTags(d, ['áreas comunes', 'áreas comunes e interior', 'areas_comunes', 'common_areas', 'amenidades', 'amenities', 'comodidades'])
  const nearby      = extractTags(d, ['lugares cercanos', 'lugares_cercanos', 'nearby', 'near', 'puntos_interes'])
  const projStatus  = pick(d, ['estado_proyecto', 'entrega', 'fecha_entrega', 'delivery'])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            variants={scaleIn} initial="hidden" animate="visible" exit="exit"
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto z-10"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="font-bold text-gray-900 text-base truncate flex-1">{extractTitle(d)}</h2>
              {identifier && (
                <span className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded flex-shrink-0">{identifier}</span>
              )}
              {status && (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${statusClass(status)}`}>
                  ✓ {status}
                </span>
              )}
              <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition flex-shrink-0">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-2 gap-6">
                {/* Carousel */}
                <div>
                  {imgs.length > 0 ? (
                    <>
                      <div className="relative rounded-xl overflow-hidden bg-gray-100 aspect-[4/3]">
                        <img src={imgs[idx]} alt="" className="w-full h-full object-cover" />
                        <span className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">
                          {idx + 1} / {imgs.length}
                        </span>
                        {imgs.length > 1 && (
                          <>
                            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 hover:bg-white rounded-full flex items-center justify-center shadow transition disabled:opacity-40">
                              <FontAwesomeIcon icon={faAngleLeft} className="text-gray-700 text-sm" />
                            </button>
                            <button onClick={() => setIdx(i => Math.min(imgs.length - 1, i + 1))} disabled={idx === imgs.length - 1}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 hover:bg-white rounded-full flex items-center justify-center shadow transition disabled:opacity-40">
                              <FontAwesomeIcon icon={faAngleRight} className="text-gray-700 text-sm" />
                            </button>
                          </>
                        )}
                      </div>
                      {imgs.length > 1 && (
                        <div className="flex gap-1.5 mt-2 overflow-x-auto pb-0.5">
                          {imgs.slice(0, 8).map((img, i) => (
                            <button key={i} onClick={() => setIdx(i)}
                              className={`flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition ${
                                idx === i ? 'border-blue-500' : 'border-gray-200 hover:border-gray-300'
                              }`}>
                              <img src={img} alt="" className="w-full h-full object-cover" />
                            </button>
                          ))}
                          {imgs.length > 8 && (
                            <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gray-100 border-2 border-gray-200 flex items-center justify-center text-xs text-gray-500 font-medium">
                              +{imgs.length - 8}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="aspect-[4/3] rounded-xl bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center">
                      <FontAwesomeIcon icon={faBuilding} className="text-4xl text-gray-300" />
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="space-y-4">
                  {extractPrice(d) && (
                    <div>
                      <p className="text-2xl font-bold text-blue-600">{extractPrice(d)}</p>
                      <p className="text-xs text-gray-400">Precio de venta</p>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { val: extractArea(d),      icon: faRuler, label: 'Área total' },
                      { val: extractBedrooms(d),  icon: faBed,   label: 'Dormitorios' },
                      { val: extractBathrooms(d), icon: faBath,  label: 'Baños' },
                    ].filter(s => s.val).map(s => (
                      <div key={s.label} className="bg-gray-50 rounded-xl p-3 text-center">
                        <FontAwesomeIcon icon={s.icon} className="text-gray-400 text-xs mb-1 block mx-auto" />
                        <p className="font-semibold text-gray-800 text-sm">{s.val}</p>
                        <p className="text-[10px] text-gray-400">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  {[
                    { val: extractLocation(d), icon: faLocationDot, label: 'Ubicación' },
                    { val: extractModel(d),    icon: faBuilding,    label: 'Modelo' },
                  ].filter(r => r.val).map(r => (
                    <div key={r.label} className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
                        <FontAwesomeIcon icon={r.icon} className="text-gray-400 text-xs" />
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400">{r.label}</p>
                        <p className="text-sm font-medium text-gray-800">{r.val}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {extractDesc(d) && (
                <div className="pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Descripción</p>
                  <p className="text-sm text-gray-600 leading-relaxed">{extractDesc(d)}</p>
                </div>
              )}

              {commonAreas.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Áreas comunes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {commonAreas.map((t, i) => (
                      <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {nearby.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Lugares cercanos</p>
                  <div className="flex flex-wrap gap-1.5">
                    {nearby.map((t, i) => (
                      <span key={i} className="text-xs bg-gray-100 text-gray-600 border border-gray-200 rounded-full px-2.5 py-0.5">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {(projStatus || record.source_url) && (
                <div className="grid grid-cols-3 gap-3 pt-4 border-t border-gray-100">
                  {projStatus && (
                    <div className="flex flex-col items-center gap-1 p-3 bg-gray-50 rounded-xl">
                      <FontAwesomeIcon icon={faCalendarDays} className="text-gray-400" />
                      <span className="text-xs font-medium text-gray-700 text-center leading-tight">{projStatus}</span>
                      <span className="text-[10px] text-gray-400">Estado del proyecto</span>
                    </div>
                  )}
                  {record.source_url && (
                    <>
                      <a href={record.source_url} target="_blank" rel="noopener noreferrer"
                        className="flex flex-col items-center gap-1 p-3 bg-gray-50 rounded-xl hover:bg-blue-50 transition">
                        <FontAwesomeIcon icon={faTableCells} className="text-gray-400" />
                        <span className="text-xs font-medium text-gray-700">Ver proyecto</span>
                        <span className="text-[10px] text-gray-400">Sitio del proyecto</span>
                      </a>
                      <a href={record.source_url} target="_blank" rel="noopener noreferrer"
                        className="flex flex-col items-center gap-1 p-3 bg-gray-50 rounded-xl hover:bg-blue-50 transition">
                        <FontAwesomeIcon icon={faGlobe} className="text-gray-400" />
                        <span className="text-xs font-medium text-gray-700">Abrir sitio web</span>
                        <span className="text-[10px] text-gray-400">Página oficial</span>
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
              <button onClick={onClose}
                className="px-5 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                Cerrar
              </button>
              {record.source_url && (
                <a href={record.source_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition">
                  Abrir propiedad
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-xs" />
                </a>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
