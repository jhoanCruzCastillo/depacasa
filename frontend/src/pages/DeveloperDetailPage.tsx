import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDeveloper,
  updateDeveloper,
  getDeveloperUrlNodes,
  getDeveloperRecords,
  deleteRecords,
  getDeveloperTemplate,
} from '../services/api'
import { ScrapedRecord } from '../types'
import {
  ChevronRight, Edit2, Check, X, Loader2, ExternalLink,
  AlertTriangle, LayoutTemplate, Trash2, FileText,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TemplateField { name: string; is_child_url: boolean; is_image?: boolean }
interface TemplateNode {
  id: string; name: string; parent_id: string | null; order?: number; fields?: TemplateField[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isUrlValue = (v: unknown): v is string =>
  typeof v === 'string' && /^https?:\/\//i.test(v)

const normalizeUrl = (v: string) => v.trim().replace(/\/+$/, '')

const collectChildUrls = (record: ScrapedRecord, fieldNames?: string[]) => {
  const urls: string[] = []
  const push = (v: unknown) => {
    if (isUrlValue(v)) { urls.push(v); return }
    if (Array.isArray(v)) v.forEach(push)
  }
  if (fieldNames?.length) fieldNames.forEach(name => push(record.data?.[name]))
  else Object.values(record.data || {}).forEach(push)
  return Array.from(new Set(urls.map(normalizeUrl))).filter(Boolean)
}

const sectionPalette = [
  { bg: 'bg-indigo-50', border: 'border-indigo-200', accent: 'text-indigo-700', indent: 'border-l-indigo-300' },
  { bg: 'bg-sky-50', border: 'border-sky-200', accent: 'text-sky-700', indent: 'border-l-sky-300' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', accent: 'text-emerald-700', indent: 'border-l-emerald-300' },
  { bg: 'bg-amber-50', border: 'border-amber-200', accent: 'text-amber-700', indent: 'border-l-amber-300' },
]

// ─── FieldValue ───────────────────────────────────────────────────────────────
// Renders: media paths as images, arrays as chips/gallery, URLs as links, text as text

const MEDIA_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api').replace(/\/api\/?$/, '')
const toMediaUrl = (path: string) => path.startsWith('/media/') ? `${MEDIA_BASE}${path}` : path
const isMediaPath = (v: unknown): v is string => typeof v === 'string' && v.startsWith('/media/')
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?[^#]*)?$/i
const looksLikeImage = (v: unknown): v is string =>
  isMediaPath(v) || (typeof v === 'string' && isUrlValue(v) && IMAGE_EXT_RE.test(v.split('#')[0]))

function FieldValue({ value, compact = false, isImageField }: { value: unknown; compact?: boolean; isImageField?: boolean }) {
  // Array values
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-xs text-gray-400 italic">[ vacío ]</span>

    const hasImages = isImageField !== false && value.some(looksLikeImage)

    if (compact) {
      if (hasImages) {
        const first = value.find(looksLikeImage) as string
        const imgSrc = isMediaPath(first) ? toMediaUrl(first) : first
        return (
          <div className="flex items-center gap-2">
            <img src={imgSrc} className="h-10 w-10 rounded object-cover border border-gray-200 flex-shrink-0" alt="" />
            {value.length > 1 && <span className="text-xs text-gray-400">+{value.length - 1} más</span>}
          </div>
        )
      }
      return (
        <span className="text-xs text-indigo-600 font-medium bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
          [{value.length} items]
        </span>
      )
    }

    if (hasImages) {
      return (
        <div className="flex flex-wrap gap-2">
          {value.map((item, i) => {
            const str = String(item ?? '')
            if (looksLikeImage(str)) {
              const imgSrc = isMediaPath(str) ? toMediaUrl(str) : str
              return (
                <a key={i} href={imgSrc} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                  <img src={imgSrc} className="h-28 w-auto rounded-lg object-cover border border-gray-200 hover:opacity-90 transition-opacity" alt={`img-${i}`} />
                </a>
              )
            }
            return (
              <span key={i} className="text-xs text-gray-700 bg-gray-100 border border-gray-200 rounded-md px-2 py-0.5 self-center">{str}</span>
            )
          })}
        </div>
      )
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {value.map((item, i) => {
          const str = String(item ?? '')
          return isUrlValue(str) ? (
            <a
              key={i} href={str} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline bg-blue-50 border border-blue-200 rounded-md px-2 py-0.5 inline-flex items-center gap-0.5 max-w-[260px]"
              onClick={e => e.stopPropagation()}
            >
              <span className="truncate">{str}</span>
              <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
            </a>
          ) : (
            <span key={i} className="text-xs text-gray-700 bg-gray-100 border border-gray-200 rounded-md px-2 py-0.5">{str}</span>
          )
        })}
      </div>
    )
  }

  // Single image (local media path or remote image URL by extension)
  if (isImageField !== false && looksLikeImage(value)) {
    const imgSrc = isMediaPath(value) ? toMediaUrl(value) : value
    return compact ? (
      <img src={imgSrc} className="h-10 w-10 rounded object-cover border border-gray-200" alt="" />
    ) : (
      <a href={imgSrc} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
        <img src={imgSrc} className="max-h-48 w-auto rounded-lg object-contain border border-gray-200 hover:opacity-90 transition-opacity" alt="imagen" />
      </a>
    )
  }

  // URL as link
  if (isUrlValue(value)) {
    return (
      <a
        href={value} target="_blank" rel="noopener noreferrer"
        className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5"
        onClick={e => e.stopPropagation()}
      >
        <span className={compact ? 'max-w-[160px] truncate' : 'break-all'}>{value}</span>
        <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
      </a>
    )
  }

  // Plain text
  const str = value == null ? '—' : String(value)
  return (
    <span className={`text-xs text-gray-700 ${compact ? 'truncate block max-w-[200px]' : 'break-words'}`}>
      {str}
    </span>
  )
}

// ─── RecordDetailModal ────────────────────────────────────────────────────────

function RecordDetailModal({
  record, open, onClose, drillable, onDrill, imageFieldNames,
}: {
  record: ScrapedRecord | null
  open: boolean
  onClose: () => void
  drillable: boolean
  onDrill?: () => void
  imageFieldNames?: Set<string>
}) {
  if (!record) return null
  const keys = Object.keys(record.data || {})

  return (
    <Modal open={open} onClose={onClose} title="Detalle del registro" maxWidth="max-w-xl">
      {/* Status + date */}
      <div className="flex items-center gap-3 mb-5">
        <Badge variant={record.status === 'success' ? 'green' : record.status === 'partial' ? 'yellow' : 'red'}>
          {record.status === 'success' ? '✓ Completo' : record.status === 'partial' ? '⚠ Parcial' : '✕ Error'}
        </Badge>
        <span className="text-xs text-gray-400">
          {new Date(record.scraped_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      </div>

      {/* All fields */}
      {keys.length === 0 ? (
        <p className="text-sm text-gray-400 italic text-center py-8">Sin datos extraídos</p>
      ) : (
        <div className="space-y-3">
          {keys.map(k => {
            const val = record.data[k]
            const isArr = Array.isArray(val)
            return (
              <div key={k} className="flex gap-3 items-start">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex-shrink-0 w-28 pt-0.5">
                  {k}
                  {isArr && (
                    <span className="ml-1 text-indigo-400 font-normal normal-case tracking-normal">[ ]</span>
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <FieldValue value={val} compact={false} isImageField={imageFieldNames ? imageFieldNames.has(k) : undefined} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer */}
      <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
        {record.source_url ? (
          <a
            href={record.source_url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-blue-600 inline-flex items-center gap-1 min-w-0 truncate"
          >
            <span className="truncate">{record.source_url}</span>
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
          </a>
        ) : <span />}

        {drillable && onDrill && (
          <button
            onClick={() => { onDrill(); onClose() }}
            className="flex-shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            Ver catálogo hijo ↓
          </button>
        )}
      </div>
    </Modal>
  )
}

// ─── CatalogCard ──────────────────────────────────────────────────────────────

function CatalogCard({
  record, selected, onSelectForDrill, drillable, onOpenDetail, imageFieldNames,
}: {
  record: ScrapedRecord
  selected: boolean
  onSelectForDrill?: () => void
  drillable: boolean
  onOpenDetail: () => void
  imageFieldNames?: Set<string>
}) {
  const keys = Object.keys(record.data || {})

  // Separate image fields from text fields; pick the first image as the hero.
  // When imageFieldNames is defined (template known), only fields in the set are treated as images.
  let heroSrc: string | null = null
  const textKeys: string[] = []

  for (const k of keys) {
    const isImgField = imageFieldNames === undefined ? true : imageFieldNames.has(k)
    const val = record.data[k]
    if (isImgField && typeof val === 'string' && looksLikeImage(val)) {
      if (!heroSrc) heroSrc = isMediaPath(val) ? toMediaUrl(val) : val
    } else if (isImgField && Array.isArray(val)) {
      const firstImg = val.find(v => looksLikeImage(v)) as string | undefined
      if (firstImg) {
        if (!heroSrc) heroSrc = isMediaPath(firstImg) ? toMediaUrl(firstImg) : firstImg
      } else {
        textKeys.push(k)
      }
    } else {
      textKeys.push(k)
    }
  }

  const previewTextKeys = textKeys.slice(0, heroSrc ? 3 : 4)
  const extraCount = Math.max(0, keys.length - previewTextKeys.length - (heroSrc ? 1 : 0))

  return (
    <div
      onClick={onOpenDetail}
      className={`relative rounded-xl border overflow-hidden transition-all cursor-pointer group ${
        selected
          ? 'border-indigo-300 ring-2 ring-indigo-200 bg-white shadow-md'
          : 'border-gray-200 bg-white hover:border-indigo-200 hover:shadow-sm'
      }`}
    >
      {/* Hero image (full-width) */}
      {heroSrc && (
        <div className="h-40 bg-gray-100 overflow-hidden">
          <img
            src={heroSrc}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      )}

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <Badge variant={record.status === 'success' ? 'green' : record.status === 'partial' ? 'yellow' : 'red'}>
            {record.status === 'success' ? '✓ Completo' : record.status === 'partial' ? '⚠ Parcial' : '✕ Error'}
          </Badge>
          <span className="text-xs text-gray-400">
            {new Date(record.scraped_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
        </div>

        {/* Preview text fields */}
        <div className="space-y-1.5 mb-3">
          {previewTextKeys.map(k => (
            <div key={k} className="flex gap-2 items-start">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide w-24 flex-shrink-0 truncate pt-0.5">
                {k}
              </span>
              <div className="flex-1 min-w-0">
                <FieldValue value={record.data[k]} compact={true} isImageField={imageFieldNames ? imageFieldNames.has(k) : undefined} />
              </div>
            </div>
          ))}
        </div>

        {/* Footer row */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">
            {extraCount > 0 ? `+${extraCount} campo${extraCount !== 1 ? 's' : ''}` : ''}
          </span>
          <span className="text-blue-500 group-hover:text-blue-700 font-medium">Ver detalles →</span>
        </div>

        {/* Drill-down trigger */}
        {drillable && onSelectForDrill && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onSelectForDrill() }}
            className={`mt-2 w-full text-left text-xs font-semibold px-2 py-1 rounded-md transition-colors ${
              selected
                ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                : 'bg-gray-50 text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700'
            }`}
          >
            {selected ? '▾ Catálogo hijo abierto' : '↓ Abrir catálogo hijo'}
          </button>
        )}

        {record.source_url && (
          <p className="mt-2 text-xs text-gray-300 truncate">{record.source_url}</p>
        )}
      </div>
    </div>
  )
}

// ─── SectionCatalog ───────────────────────────────────────────────────────────

function SectionCatalog({
  title, level, records, totalCount, selectedId, onSelectForDrill, drillable, onOpenDetail, imageFieldNames,
}: {
  title: string
  level: number
  records: ScrapedRecord[]
  totalCount: number
  selectedId?: string
  onSelectForDrill?: (recordId: string) => void
  drillable: boolean
  onOpenDetail: (record: ScrapedRecord) => void
  imageFieldNames?: Set<string>
}) {
  const palette = sectionPalette[level % sectionPalette.length]
  const countLabel = totalCount > records.length
    ? `${records.length} de ${totalCount}`
    : `${totalCount}`

  return (
    <section className={`rounded-2xl border ${palette.border} ${palette.bg} p-4`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className={`text-[11px] font-semibold uppercase tracking-wide ${palette.accent}`}>Sección</p>
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        </div>
        <span className="text-xs text-gray-500">{countLabel} item{totalCount !== 1 ? 's' : ''}</span>
      </div>

      {records.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">Sin elementos en esta sección.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {records.map(record => (
              <CatalogCard
                key={record.id}
                record={record}
                selected={record.id === selectedId}
                onSelectForDrill={onSelectForDrill ? () => onSelectForDrill(record.id) : undefined}
                drillable={drillable}
                onOpenDetail={() => onOpenDetail(record)}
                imageFieldNames={imageFieldNames}
              />
            ))}
          </div>
          {drillable && !selectedId && (
            <p className="mt-4 text-xs text-gray-400 text-center">
              Haz clic en "Abrir catálogo hijo" en un registro para ver los elementos relacionados.
            </p>
          )}
        </>
      )}
    </section>
  )
}

// ─── DeveloperDetailPage ──────────────────────────────────────────────────────

export default function DeveloperDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const [editName, setEditName] = useState(false)
  const [editDesc, setEditDesc] = useState(false)
  const [nameVal, setNameVal] = useState('')
  const [descVal, setDescVal] = useState('')
  const [clearing, setClearing] = useState(false)
  const [selectedByNodeId, setSelectedByNodeId] = useState<Record<string, string>>({})
  const [modalRecord, setModalRecord] = useState<ScrapedRecord | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalNodeId, setModalNodeId] = useState<string | null>(null)

  const { data: developer, isLoading: loadingDev } = useQuery({
    queryKey: ['developer', id],
    queryFn: () => getDeveloper(id!).then(r => r.data),
    enabled: !!id,
  })

  const { data: nodes = [], isLoading: loadingNodes } = useQuery({
    queryKey: ['developerNodes', id],
    queryFn: () => getDeveloperUrlNodes(id!).then(r => r.data),
    enabled: !!id,
  })

  const { data: templateData } = useQuery({
    queryKey: ['template', id],
    queryFn: () => getDeveloperTemplate(id!).then(r => r.data),
    enabled: !!id,
  })

  const { data: records = [], isLoading: loadingRecords } = useQuery({
    queryKey: ['records', id],
    queryFn: () => getDeveloperRecords(id!).then(r => r.data),
    enabled: !!id,
  })

  const templateNodes = (templateData?.nodes || []) as TemplateNode[]
  const treeNodes = (templateNodes.length ? templateNodes : nodes) as TemplateNode[]

  const nodeById = useMemo(() => {
    const map: Record<string, TemplateNode> = {}
    treeNodes.forEach(n => { map[n.id] = n })
    return map
  }, [treeNodes])

  const rootNodes = useMemo(() =>
    treeNodes.filter(n => !n.parent_id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [treeNodes]
  )

  const childNodesByParent = useMemo(() => {
    const map: Record<string, TemplateNode[]> = {}
    treeNodes.forEach(n => {
      if (!n.parent_id) return
      if (!map[n.parent_id]) map[n.parent_id] = []
      map[n.parent_id].push(n)
    })
    Object.values(map).forEach(list => list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
    return map
  }, [treeNodes])

  const childUrlFieldsByNode = useMemo(() => {
    const map: Record<string, string[]> = {}
    templateNodes.forEach(n => {
      map[n.id] = (n.fields || []).filter(f => f.is_child_url).map(f => f.name)
    })
    return map
  }, [templateNodes])

  const imageFieldNamesByNodeId = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    templateNodes.forEach(n => {
      map[n.id] = new Set((n.fields || []).filter(f => f.is_image).map(f => f.name))
    })
    return map
  }, [templateNodes])

  const recordsByNodeId = useMemo(() => {
    const map: Record<string, ScrapedRecord[]> = {}
    ;(records as ScrapedRecord[]).forEach(rec => {
      if (!map[rec.url_node_id]) map[rec.url_node_id] = []
      map[rec.url_node_id].push(rec)
    })
    return map
  }, [records])

  useEffect(() => {
    if (developer) { setNameVal(developer.name); setDescVal(developer.description || '') }
  }, [developer])

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      updateDeveloper(id!, data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['developer', id] })
      queryClient.invalidateQueries({ queryKey: ['developers'] })
    },
  })

  const saveName = async () => {
    if (!nameVal.trim()) return
    try { await updateMutation.mutateAsync({ name: nameVal }); setEditName(false); toast.success('Cambios guardados') }
    catch { toast.error('Error al actualizar') }
  }
  const saveDesc = async () => {
    try { await updateMutation.mutateAsync({ description: descVal }); setEditDesc(false); toast.success('Cambios guardados') }
    catch { toast.error('Error al actualizar') }
  }
  const cancelName = () => { setEditName(false); setNameVal(developer?.name ?? '') }
  const cancelDesc = () => { setEditDesc(false); setDescVal(developer?.description ?? '') }

  const handleClearRecords = async () => {
    if (!window.confirm('¿Eliminar todos los registros extraídos? Esta acción no se puede deshacer.')) return
    setClearing(true)
    try {
      await deleteRecords(id!)
      queryClient.invalidateQueries({ queryKey: ['records', id] })
      setSelectedByNodeId({})
      toast.success('Registros eliminados')
    } catch { toast.error('Error al eliminar registros') }
    finally { setClearing(false) }
  }

  const clearDescendants = (nodeId: string, next: Record<string, string>) => {
    const children = childNodesByParent[nodeId] || []
    children.forEach(c => { delete next[c.id]; clearDescendants(c.id, next) })
  }

  const handleSelectRecord = (nodeId: string, recordId: string) => {
    setSelectedByNodeId(prev => {
      const next = { ...prev }
      if (next[nodeId] === recordId) { delete next[nodeId]; clearDescendants(nodeId, next) }
      else { next[nodeId] = recordId; clearDescendants(nodeId, next) }
      return next
    })
  }

  const openModal = (record: ScrapedRecord, nodeId: string, parentRecord?: ScrapedRecord, parentNodeId?: string) => {
    // If opened within a parent context, merge parent's shared fields into the child record
    let mergedRecord: ScrapedRecord = record
    try {
      if (parentRecord && parentNodeId && nodeById[parentNodeId]) {
        const parentNode = nodeById[parentNodeId]
        const sharedFieldNames: string[] = (parentNode.fields || []).filter((f: any) => f?.is_shared).map((f: any) => f.name)
        if (sharedFieldNames.length) {
          const childData = { ...(record.data || {}) }
          for (const fname of sharedFieldNames) {
            const childVal = childData[fname]
            const parentVal = parentRecord.data ? parentRecord.data[fname] : undefined
            const emptyChild = childVal === undefined || childVal === null || (Array.isArray(childVal) && childVal.length === 0) || (typeof childVal === 'string' && childVal.trim() === '')
            if ((childVal === undefined || emptyChild) && parentVal !== undefined) {
              childData[fname] = parentVal
            }
          }
          mergedRecord = { ...record, data: childData }
        }
      }
    } catch (e) {
      // guard: if anything fails, fallback to original record
      mergedRecord = record
    }

    setModalRecord(mergedRecord)
    setModalNodeId(nodeId)
    setModalOpen(true)
  }

  const getRecordsForNode = (nodeId: string, parentRecord?: ScrapedRecord, parentNodeId?: string) => {
    const all = recordsByNodeId[nodeId] || []
    if (!parentRecord || !parentNodeId) return all
    const childUrls = collectChildUrls(parentRecord, childUrlFieldsByNode[parentNodeId])
    if (childUrls.length === 0) return []
    const urlSet = new Set(childUrls.map(normalizeUrl))
    return all.filter(r => urlSet.has(normalizeUrl(r.source_url || '')))
  }

  const renderCatalogSection = (
    nodeId: string,
    level: number,
    sectionRecords: ScrapedRecord[],
    totalCount: number,
    parentRecord?: ScrapedRecord,
    parentNodeId?: string,
  ) => {
    const node = nodeById[nodeId]
    if (!node) return null
    const childNodes = childNodesByParent[nodeId] || []
    const drillable = childNodes.length > 0
    const selectedId = selectedByNodeId[nodeId]
    const selectedRecord = sectionRecords.find(r => r.id === selectedId)
    const imageFieldNames = imageFieldNamesByNodeId[nodeId]

    return (
      <div key={nodeId} className="space-y-4">
        <SectionCatalog
          title={node.name}
          level={level}
          records={sectionRecords}
          totalCount={totalCount}
          selectedId={selectedId}
          onSelectForDrill={drillable ? (recId) => handleSelectRecord(nodeId, recId) : undefined}
          drillable={drillable}
          onOpenDetail={(rec) => openModal(rec, nodeId, parentRecord, parentNodeId)}
          imageFieldNames={imageFieldNames}
        />

        {selectedRecord && drillable && (
          <div className={`pl-5 space-y-4 border-l-4 ${sectionPalette[level % sectionPalette.length].indent}`}>
            {childNodes.map(child => {
              const childRecords = getRecordsForNode(child.id, selectedRecord, nodeId)
              return (
                <div key={child.id}>
                  {renderCatalogSection(child.id, level + 1, childRecords, childRecords.length, selectedRecord, nodeId)}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const totalRecordsCount = (records as ScrapedRecord[]).length

  if (loadingDev) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
  }

  if (!developer) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertTriangle className="w-10 h-10 text-red-400 mb-3" />
        <p className="font-semibold text-gray-700 mb-1">Esta desarrolladora no existe o fue eliminada.</p>
        <Link to="/developers" className="text-blue-600 text-sm hover:underline mt-2">← Volver al catálogo</Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link to="/developers" className="text-blue-600 hover:underline font-medium">Desarrolladoras</Link>
        <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-gray-500 truncate">{developer.name}</span>
      </nav>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-bold text-xl select-none">
              {developer.name.split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            {editName ? (
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={nameVal} onChange={e => setNameVal(e.target.value)}
                  className="text-xl font-bold border-b-2 border-blue-500 outline-none bg-transparent flex-1 min-w-0"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') cancelName() }}
                />
                <button onClick={saveName} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                <button onClick={cancelName} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-xl font-bold text-gray-900 truncate">{developer.name}</h1>
                <button onClick={() => setEditName(true)} className="p-1 text-gray-300 hover:text-gray-500 hover:bg-gray-100 rounded transition flex-shrink-0">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <Badge variant={developer.source === 'tavily' ? 'blue' : 'gray'}>{developer.source}</Badge>
              </div>
            )}

            {editDesc ? (
              <div className="flex gap-2 items-start">
                <textarea
                  value={descVal} onChange={e => setDescVal(e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-xl p-2 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={2} autoFocus
                />
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button onClick={saveDesc} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                  <button onClick={cancelDesc} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X className="w-4 h-4" /></button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-1.5 group">
                <p className="text-sm text-gray-600 flex-1 leading-relaxed">
                  {developer.description || <span className="italic text-gray-400">Sin descripción</span>}
                </p>
                <button onClick={() => setEditDesc(true)} className="p-1 text-gray-300 hover:text-gray-500 hover:bg-gray-100 rounded transition flex-shrink-0 opacity-0 group-hover:opacity-100">
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}

            <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
              <a href={developer.base_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">
                {developer.base_url} <ExternalLink className="w-2.5 h-2.5" />
              </a>
              <span>·</span>
              <span>Creado: {new Date(developer.created_at).toLocaleDateString('es-MX')}</span>
            </div>
          </div>

          <Link
            to={`/templates/${id}/editor`}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            <LayoutTemplate className="w-4 h-4" />
            Configurar plantilla
          </Link>
        </div>
      </div>

      {/* Records section */}
      {loadingNodes ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
      ) : nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-2xl border border-gray-200">
          <FileText className="w-10 h-10 text-gray-300 mb-3" />
          <p className="font-semibold text-gray-700 mb-1">Sin plantilla de extracción configurada</p>
          <p className="text-sm text-gray-400 mb-5">Configura los selectores para comenzar a extraer datos</p>
          <Link
            to={`/templates/${id}/editor`}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            <LayoutTemplate className="w-4 h-4" />
            Ir a configurar plantilla →
          </Link>
        </div>
      ) : loadingRecords ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
      ) : totalRecordsCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-gray-200">
          <FileText className="w-8 h-8 text-gray-300 mb-2" />
          <p className="text-sm font-medium text-gray-600 mb-1">No hay datos extraídos aún</p>
          <p className="text-xs text-gray-400">Ejecuta el scraping para obtener información.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {totalRecordsCount} registro{totalRecordsCount !== 1 ? 's' : ''}
            </p>
            <button
              onClick={handleClearRecords}
              disabled={clearing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {clearing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              Limpiar registros
            </button>
          </div>

          {/* Sections (root nodes) */}
          {rootNodes.map(node => {
            const nodeRecords = recordsByNodeId[node.id] || []
            return renderCatalogSection(node.id, 0, nodeRecords, nodeRecords.length)
          })}
        </div>
      )}

      {/* Record detail modal */}
      <RecordDetailModal
        record={modalRecord}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        drillable={modalNodeId ? (childNodesByParent[modalNodeId] || []).length > 0 : false}
        onDrill={
          modalRecord && modalNodeId
            ? () => handleSelectRecord(modalNodeId!, modalRecord!.id)
            : undefined
        }
        imageFieldNames={modalNodeId ? imageFieldNamesByNodeId[modalNodeId] : undefined}
      />
    </div>
  )
}
