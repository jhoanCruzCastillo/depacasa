import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faPencil, faCheck, faXmark, faChevronRight, faArrowUpRightFromSquare,
  faMagnifyingGlass, faSpinner, faTrash, faTriangleExclamation, faBuilding,
  faScrewdriverWrench, faRobot,
} from '@fortawesome/free-solid-svg-icons'
import {
  getDeveloper, updateDeveloper,
  getDeveloperRecords, deleteRecords, extractPropertyFields,
} from '../services/api'
import { ScrapedRecord } from '../types'
import toast from 'react-hot-toast'
import { extractTitle, extractLocation } from './developers/helpers/extractors'
import ProjectCard         from './developers/components/ProjectCard'
import PropertyModal       from './developers/components/PropertyModal'
import ProjectDetailPanel  from './developers/components/ProjectDetailPanel'

export default function DeveloperDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const [editName, setEditName]           = useState(false)
  const [nameVal, setNameVal]             = useState('')
  const [clearing, setClearing]           = useState(false)
  const [extracting, setExtracting]       = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [modalRecord, setModalRecord]     = useState<ScrapedRecord | null>(null)
  const [modalOpen, setModalOpen]         = useState(false)

  const { data: developer, isLoading: loadingDev } = useQuery({
    queryKey: ['developer', id],
    queryFn:  () => getDeveloper(id!).then(r => r.data),
    enabled: !!id,
  })

  const { data: records = [], isLoading: loadingRecords } = useQuery({
    queryKey: ['records', id],
    queryFn:  () => getDeveloperRecords(id!).then(r => r.data),
    enabled: !!id,
  })

  const proyectos = useMemo(() =>
    (records as ScrapedRecord[]).filter(r => r.type === 'proyecto'),
    [records]
  )

  const propiedadesByProyectoId = useMemo(() => {
    const m: Record<string, ScrapedRecord[]> = {}
    ;(records as ScrapedRecord[])
      .filter(r => {
        if (r.type !== 'propiedad' || !r.proyecto_id) return false
        const d = r.data || {}
        if (!d.modelo && !d.dormitorios && !d.m2 && !d.imagen_modelo && !d.modelo_imagen) return false
        if (typeof d.modelo === 'string' && d.modelo.split('/')[0].trim().toLowerCase() === 'null') return false
        return true
      })
      .forEach(r => { ;(m[r.proyecto_id!] ??= []).push(r) })
    return m
  }, [records])

  useEffect(() => { if (developer) setNameVal(developer.name) }, [developer])

  const updateMut = useMutation({
    mutationFn: (data: { name: string }) => updateDeveloper(id!, data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['developer', id] })
      queryClient.invalidateQueries({ queryKey: ['developers'] })
    },
  })

  const saveName = async () => {
    if (!nameVal.trim()) return
    try { await updateMut.mutateAsync({ name: nameVal }); setEditName(false); toast.success('Nombre actualizado') }
    catch { toast.error('Error al actualizar') }
  }

  const handleClear = async () => {
    if (!window.confirm('¿Eliminar todos los registros? Esta acción no se puede deshacer.')) return
    setClearing(true)
    try {
      await deleteRecords(id!)
      queryClient.invalidateQueries({ queryKey: ['records', id] })
      setSelectedId(null)
      toast.success('Registros eliminados')
    } catch { toast.error('Error al eliminar') }
    finally { setClearing(false) }
  }

  const handleExtract = async () => {
    setExtracting(true)
    try {
      const { data } = await extractPropertyFields(id!)
      queryClient.invalidateQueries({ queryKey: ['records', id] })
      toast.success(
        `Extracción completada: ${data.updated} propiedades actualizadas` +
        (data.ai_calls > 0 ? ` (${data.ai_calls} con IA)` : '')
      )
    } catch { toast.error('Error al extraer campos') }
    finally { setExtracting(false) }
  }

  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return proyectos
    const q = projectSearch.toLowerCase()
    return proyectos.filter(r => {
      const d = r.data || {}
      return extractTitle(d).toLowerCase().includes(q) || extractLocation(d).toLowerCase().includes(q)
    })
  }, [proyectos, projectSearch])

  const childRecordsForSelected = useMemo((): ScrapedRecord[] => {
    if (!selectedId) return []
    return propiedadesByProyectoId[selectedId] || []
  }, [selectedId, propiedadesByProyectoId])

  const childCountByProjectId = useMemo(() => {
    const m: Record<string, number> = {}
    proyectos.forEach(p => { m[p.id] = (propiedadesByProyectoId[p.id] || []).length })
    return m
  }, [proyectos, propiedadesByProyectoId])

  const selectedRecord = selectedId ? proyectos.find(r => r.id === selectedId) ?? null : null

  if (loadingDev) {
    return (
      <div className="flex items-center justify-center py-24">
        <FontAwesomeIcon icon={faSpinner} className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  if (!developer) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <FontAwesomeIcon icon={faTriangleExclamation} className="w-10 h-10 text-red-400 mb-3" />
        <p className="font-semibold text-gray-700 mb-1">Esta desarrolladora no existe o fue eliminada.</p>
        <Link to="/developers" className="text-blue-600 text-sm hover:underline mt-2">← Volver al catálogo</Link>
      </div>
    )
  }

  const initials = developer.name.split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()

  return (
    <div className="flex flex-col gap-5 min-h-0">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link to="/developers" className="text-blue-600 hover:underline font-medium">Desarrolladoras</Link>
        <FontAwesomeIcon icon={faChevronRight} className="text-gray-400 text-xs" />
        <span className="text-gray-500 truncate">{developer.name}</span>
      </nav>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg select-none flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            {editName ? (
              <div className="flex items-center gap-2">
                <input value={nameVal} onChange={e => setNameVal(e.target.value)}
                  className="text-lg font-bold border-b-2 border-blue-500 outline-none bg-transparent flex-1 min-w-0"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditName(false); setNameVal(developer.name) } }} />
                <button onClick={saveName} className="p-1 text-green-600 hover:bg-green-50 rounded transition">
                  <FontAwesomeIcon icon={faCheck} className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => { setEditName(false); setNameVal(developer.name) }} className="p-1 text-gray-400 hover:bg-gray-100 rounded transition">
                  <FontAwesomeIcon icon={faXmark} className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-gray-900 truncate">{developer.name}</h1>
                <button onClick={() => setEditName(true)} className="p-1 text-gray-300 hover:text-gray-500 hover:bg-gray-100 rounded transition flex-shrink-0">
                  <FontAwesomeIcon icon={faPencil} className="text-xs" />
                </button>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                  {developer.source}
                </span>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-0.5">Desarrolladora</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
              <a href={developer.base_url} target="_blank" rel="noopener noreferrer"
                className="text-blue-600 hover:underline inline-flex items-center gap-0.5">
                {developer.base_url}
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="ml-0.5 text-[9px]" />
              </a>
              <span>·</span>
              <span>Creado: {new Date(developer.created_at).toLocaleDateString('es-MX')}</span>
            </div>
          </div>
          <Link to={`/templates/${id}/editor`}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition flex-shrink-0">
            <FontAwesomeIcon icon={faScrewdriverWrench} className="text-sm" />
            Configurar plantilla
          </Link>
        </div>
      </div>

      {/* Projects grid */}
      <div className="flex flex-col gap-4">
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none" />
            <input type="text" placeholder="Buscar proyecto..."
              value={projectSearch} onChange={e => setProjectSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
          </div>
          <span className="text-sm text-gray-400">{filteredProjects.length} proyectos</span>
          <div className="flex-1" />
          {proyectos.length > 0 && (
            <button onClick={handleExtract} disabled={extracting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-600 border border-violet-200 rounded-lg hover:bg-violet-50 disabled:opacity-50 transition">
              {extracting
                ? <FontAwesomeIcon icon={faSpinner} className="w-3 h-3 animate-spin" />
                : <FontAwesomeIcon icon={faRobot} className="w-3 h-3" />
              }
              Extraer campos IA
            </button>
          )}
          {(records as ScrapedRecord[]).length > 0 && (
            <button onClick={handleClear} disabled={clearing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition">
              {clearing
                ? <FontAwesomeIcon icon={faSpinner} className="w-3 h-3 animate-spin" />
                : <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
              }
              Limpiar registros
            </button>
          )}
        </div>

        {/* Cards */}
        {loadingRecords ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-xl border border-gray-200 overflow-hidden animate-pulse bg-white">
                <div className="h-44 bg-gray-100" />
                <div className="p-4 space-y-2">
                  <div className="h-3 bg-gray-100 rounded w-1/3" />
                  <div className="h-4 bg-gray-100 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-gray-200 text-center">
            <FontAwesomeIcon icon={faBuilding} className="w-10 h-10 text-gray-300 mb-3" />
            <p className="font-semibold text-gray-700 mb-1">
              {projectSearch ? `Sin resultados para "${projectSearch}"` : 'No hay proyectos extraídos'}
            </p>
            <p className="text-sm text-gray-400">
              {projectSearch ? 'Intenta con otro término.' : 'Ejecuta el scraping para obtener proyectos.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map(record => (
              <ProjectCard
                key={record.id}
                record={record}
                selected={record.id === selectedId}
                childCount={childCountByProjectId[record.id] ?? 0}
                onClick={() => setSelectedId(record.id === selectedId ? null : record.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Project detail modal */}
      {createPortal(
        <AnimatePresence>
          {selectedRecord && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              onClick={() => setSelectedId(null)}
            >
              <motion.div
                className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col min-h-0"
                style={{ maxHeight: '90vh', height: '90vh', willChange: 'transform' }}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                onClick={e => e.stopPropagation()}
              >
                <ProjectDetailPanel
                  record={selectedRecord}
                  childRecords={childRecordsForSelected}
                  onClose={() => setSelectedId(null)}
                  onOpenProperty={r => { setModalRecord(r); setModalOpen(true) }}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Property detail modal */}
      <PropertyModal record={modalRecord} open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
