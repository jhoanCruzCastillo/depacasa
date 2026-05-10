import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getDeveloper,
  getDeveloperTemplate,
  saveDeveloperTemplate,
  startScrapeJob,
  getDeveloperRecords,
  updateDeveloper,
  getFieldNameSuggestions,
} from '../services/api'
import {
  ChevronRight, Save, Play, Plus, Trash2, ChevronDown, ChevronUp,
  GripVertical, Settings, Info, Database, Loader2, X,
  ExternalLink, AlertCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../components/ui/Modal'
import ScrapeProgress from '../components/scrape/ScrapeProgress'
import Badge from '../components/ui/Badge'
import VisualSelectorModal from '../components/visual-selector/VisualSelectorModal'
import { Developer, ScrapeJob, ScrapedRecord } from '../types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SelectorDraft { id: string; value: string; order: number }
interface FieldDraft { id: string; name: string; is_child_url: boolean; plain_text: boolean; is_shared: boolean; is_list: boolean; list_container: string; is_image: boolean; extract_attr: string; order: number; selectors: SelectorDraft[] }
interface NodeDraft { client_id: string; parent_client_id: string | null; name: string; url: string; container_selector: string; order: number; fields: FieldDraft[] }

let _c = 0
const uid = () => `d${++_c}`
const emptyNode = (parent: string | null = null, order = 0): NodeDraft => ({ client_id: uid(), parent_client_id: parent, name: '', url: '', container_selector: '', order, fields: [] })
const emptyField = (order = 0): FieldDraft => ({ id: uid(), name: '', is_child_url: false, plain_text: false, is_shared: false, is_list: false, list_container: '', is_image: false, extract_attr: '', order, selectors: [] })
const emptySelector = (order = 0): SelectorDraft => ({ id: uid(), value: '', order })

// ─── Tab types ────────────────────────────────────────────────────────────────

type Tab = 'template' | 'properties' | 'records'

const TAB_META: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'template', label: 'Plantilla de extracción', icon: Settings },
  { id: 'properties', label: 'Propiedades', icon: Info },
  { id: 'records', label: 'Proyectos', icon: Database },
]

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TemplateEditorPage() {
  const { developerId } = useParams<{ developerId: string }>()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<Tab>('template')
  const [nodes, setNodes] = useState<NodeDraft[]>([])
  const [saving, setSaving] = useState(false)
  const [scrapeJobId, setScrapeJobId] = useState<string | null>(null)
  const [showScrapeModal, setShowScrapeModal] = useState(false)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [selectorNodeId, setSelectorNodeId] = useState<string | null>(null)
  const [selectorUrl, setSelectorUrl] = useState('')

  const { data: developer, isLoading: loadingDev } = useQuery({
    queryKey: ['developer', developerId],
    queryFn: () => getDeveloper(developerId!).then(r => r.data),
    enabled: !!developerId,
  })

  const { data: templateData, isLoading: loadingTemplate } = useQuery({
    queryKey: ['template', developerId],
    queryFn: () => getDeveloperTemplate(developerId!).then(r => r.data),
    enabled: !!developerId,
  })

  useEffect(() => {
    if (templateData?.nodes?.length) {
      setNodes(templateData.nodes.map((n: any) => ({
        client_id: n.id,
        parent_client_id: n.parent_id || null,
        name: n.name,
        url: n.url,
        container_selector: n.container_selector || '',
        order: n.order,
        fields: (n.fields || []).map((f: any) => ({
          id: f.id || uid(),
          name: f.name,
          is_child_url: f.is_child_url,
          plain_text: f.plain_text ?? false,
          is_shared: f.is_shared ?? false,
          is_list: f.is_list ?? false,
          list_container: f.list_container ?? '',
          is_image: f.is_image ?? false,
          extract_attr: f.extract_attr ?? '',
          order: f.order,
          selectors: (f.selectors || []).map((s: any) => ({ id: s.id || uid(), value: s.value, order: s.order })),
        })),
      })))
    } else if (!loadingTemplate && nodes.length === 0) {
      setNodes([emptyNode(null, 0)])
    }
  }, [templateData, loadingTemplate])

  const rootNodes = nodes.filter(n => !n.parent_client_id)

  const updateNode = (cid: string, patch: Partial<NodeDraft>) =>
    setNodes(prev => prev.map(n => n.client_id === cid ? { ...n, ...patch } : n))

  const removeNode = (cid: string) => {
    const kill = new Set<string>()
    const collect = (id: string) => { kill.add(id); nodes.filter(n => n.parent_client_id === id).forEach(c => collect(c.client_id)) }
    collect(cid)
    setNodes(prev => prev.filter(n => !kill.has(n.client_id)))
  }

  const addChildNode = (parent: string) => {
    const siblings = nodes.filter(n => n.parent_client_id === parent)
    setNodes(prev => [...prev, emptyNode(parent, siblings.length)])
  }

  const openSelector = (nodeId: string, url: string) => {
    if (!url) return
    setSelectorNodeId(nodeId)
    setSelectorUrl(url)
    setSelectorOpen(true)
  }

  const applyVisualFields = (payload: { cardSelector?: string; fields: Array<{ name: string; selector: string; type: string }> }) => {
    if (!selectorNodeId) return
    const cardSelector = payload.cardSelector?.trim() || ''
    const newFields = payload.fields
      .filter(field => field.selector?.trim())
      .map((field, index) => ({
        id: uid(),
        name: (field.name?.trim() || `campo_${index + 1}`).toLowerCase(),
        is_child_url: field.type === 'url',
        plain_text: false,
        is_shared: false,
        is_list: false,
        list_container: '',
        is_image: false,
        extract_attr: '',
        order: index,
        selectors: [field.selector.trim()].map((value, order) => ({ id: uid(), value, order })),
      }))
    updateNode(selectorNodeId, { container_selector: cardSelector, fields: newFields })
  }

  const normalizeNodes = (raw: NodeDraft[]) =>
    raw.map(n => ({
      ...n,
      fields: n.fields.map(f => ({
        ...f,
        name: f.name.trim().toLowerCase(),
        extract_attr: f.extract_attr && f.extract_attr !== '_' ? f.extract_attr : null,
        list_container: f.list_container?.trim() || null,
      })),
    }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveDeveloperTemplate(developerId!, { nodes: normalizeNodes(nodes) })
      queryClient.invalidateQueries({ queryKey: ['template', developerId] })
      toast.success('Plantilla guardada correctamente')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndRun = async () => {
    if (nodes.every(n => !n.url)) {
      toast.error('Configura al menos un nodo con URL antes de ejecutar')
      return
    }
    setSaving(true)
    try {
      await saveDeveloperTemplate(developerId!, { nodes: normalizeNodes(nodes) })
      queryClient.invalidateQueries({ queryKey: ['template', developerId] })
      const res = await startScrapeJob(developerId!)
      setScrapeJobId(res.data.id)
      setShowScrapeModal(true)
      toast.success('Scraping iniciado')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error al ejecutar')
    } finally {
      setSaving(false)
    }
  }

  const handleScrapeDone = (job: ScrapeJob) => {
    queryClient.invalidateQueries({ queryKey: ['records', developerId] })
    if (job.status === 'completed') {
      toast.success(`Scraping completado — ${job.total_records} registros extraídos`)
    } else {
      toast.error('El scraping falló. Revisa el log de error.')
    }
  }

  if (loadingDev || loadingTemplate) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  if (!developer) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p>Desarrolladora no encontrada.</p>
        <Link to="/templates" className="text-blue-600 hover:underline mt-2 inline-block">← Volver a Plantillas</Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">

      {/* ─── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm mb-4 overflow-hidden flex-shrink-0">
        <div className="px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1 text-sm">
              <Link to="/templates" className="text-blue-600 hover:underline font-medium whitespace-nowrap">
                Plantillas de Extracción
              </Link>
              <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <span className="text-gray-700 font-medium truncate">{developer.name}</span>
              <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <span className="text-gray-400">Editor</span>
            </nav>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={developer.base_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
            >
              <span className="max-w-[180px] truncate">{developer.base_url}</span>
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </a>
          </div>

          {/* Actions */}
          {activeTab === 'template' && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <Save className="w-4 h-4" />
                Guardar
              </button>
              <button
                onClick={handleSaveAndRun}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Guardar y Ejecutar
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-t border-gray-100 px-5">
          {TAB_META.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Tab content ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'template' && (
          <TabTemplate
            nodes={nodes}
            rootNodes={rootNodes}
            updateNode={updateNode}
            removeNode={removeNode}
            addChildNode={addChildNode}
            onAddRoot={() => setNodes(prev => [...prev, emptyNode(null, prev.filter(n => !n.parent_client_id).length)])}
            onOpenSelector={openSelector}
          />
        )}
        {activeTab === 'properties' && <TabProperties developer={developer} developerId={developerId!} />}
        {activeTab === 'records' && <TabRecords developerId={developerId!} />}
      </div>

      {/* ─── Scrape progress modal ────────────────────────────────────────────── */}
      <Modal open={showScrapeModal} onClose={() => setShowScrapeModal(false)} title="Progreso del Scraping" maxWidth="max-w-md">
        {scrapeJobId && (
          <>
            <ScrapeProgress jobId={scrapeJobId} onDone={handleScrapeDone} />
            <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
              <button onClick={() => setShowScrapeModal(false)} className="text-sm text-gray-500 hover:text-gray-700">
                Cerrar
              </button>
              <button
                onClick={() => { setShowScrapeModal(false); setActiveTab('records') }}
                className="text-sm text-blue-600 font-medium hover:underline"
              >
                Ver registros →
              </button>
            </div>
          </>
        )}
      </Modal>

      <VisualSelectorModal
        open={selectorOpen}
        url={selectorUrl}
        onClose={() => {
          setSelectorOpen(false)
          setSelectorNodeId(null)
          setSelectorUrl('')
        }}
        onConfirm={(payload) => {
          applyVisualFields(payload)
          setSelectorOpen(false)
          setSelectorNodeId(null)
          setSelectorUrl('')
        }}
      />
    </div>
  )
}

// ─── Tab: Plantilla de extracción ────────────────────────────────────────────

function TabTemplate({
  nodes, rootNodes, updateNode, removeNode, addChildNode, onAddRoot, onOpenSelector,
}: {
  nodes: NodeDraft[]
  rootNodes: NodeDraft[]
  updateNode: (cid: string, p: Partial<NodeDraft>) => void
  removeNode: (cid: string) => void
  addChildNode: (parent: string) => void
  onAddRoot: () => void
  onOpenSelector: (nodeId: string, url: string) => void
}) {
  if (rootNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-4">
          <Settings className="w-6 h-6 text-blue-400" />
        </div>
        <p className="font-medium text-gray-700 mb-1">Sin secciones configuradas</p>
        <p className="text-sm text-gray-400 mb-4">Agrega una sección raíz para comenzar</p>
        <button
          onClick={onAddRoot}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition"
        >
          <Plus className="w-4 h-4" /> Agregar sección
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {rootNodes.map(node => (
        <UrlNodeEditor
          key={node.client_id}
          node={node}
          allNodes={nodes}
          depth={0}
          onUpdate={updateNode}
          onRemove={removeNode}
          onAddChild={addChildNode}
          onOpenSelector={onOpenSelector}
        />
      ))}
      <button
        onClick={onAddRoot}
        className="w-full flex items-center justify-center gap-2 py-4 border-2 border-dashed border-gray-200 rounded-2xl text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/40 transition-all"
      >
        <Plus className="w-4 h-4" />
        Agregar sección raíz
      </button>
    </div>
  )
}

// ─── Tab: Propiedades ─────────────────────────────────────────────────────────

function TabProperties({ developer, developerId }: { developer: Developer; developerId: string }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(developer.name)
  const [description, setDescription] = useState(developer.description || '')
  const [baseUrl, setBaseUrl] = useState(developer.base_url)
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateDeveloper(developerId, { name, description, base_url: baseUrl })
      queryClient.invalidateQueries({ queryKey: ['developer', developerId] })
      queryClient.invalidateQueries({ queryKey: ['developers'] })
      toast.success('Propiedades guardadas')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-5">Información de la desarrolladora</h3>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">URL Base</label>
            <input
              type="url"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <div className="px-3.5 py-2 rounded-xl bg-gray-50 border border-gray-100 text-xs text-gray-500">
              Fuente: <strong className="text-gray-700 capitalize">{developer.source}</strong>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-gray-50 border border-gray-100 text-xs text-gray-500">
              Creado: <strong className="text-gray-700">{new Date(developer.created_at).toLocaleDateString('es-MX')}</strong>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="ml-auto flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Tab: Proyectos (records) ─────────────────────────────────────────────────

function TabRecords({ developerId }: { developerId: string }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['records', developerId],
    queryFn: () => getDeveloperRecords(developerId).then(r => r.data),
    enabled: !!developerId,
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <Database className="w-6 h-6 text-gray-400" />
        </div>
        <p className="font-medium text-gray-700 mb-1">Sin registros extraídos</p>
        <p className="text-sm text-gray-400 mb-4">
          Configura la plantilla y ejecuta el scraping para ver los datos aquí
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{records.length} registro{records.length !== 1 ? 's' : ''} extraído{records.length !== 1 ? 's' : ''}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {(records as ScrapedRecord[]).map(rec => {
          const keys = Object.keys(rec.data || {})
          const isOpen = expanded === rec.id
          return (
            <div key={rec.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition">
              <div className="flex items-center justify-between mb-3">
                <Badge variant={rec.status === 'success' ? 'green' : rec.status === 'partial' ? 'yellow' : 'red'}>
                  {rec.status}
                </Badge>
                <span className="text-xs text-gray-400">
                  {new Date(rec.scraped_at).toLocaleDateString('es-MX')}
                </span>
              </div>
              <div className="space-y-1.5">
                {keys.slice(0, isOpen ? keys.length : 3).map(k => (
                  <div key={k} className="flex gap-2">
                    <span className="text-xs font-medium text-gray-400 uppercase tracking-wide w-20 flex-shrink-0">{k}</span>
                    <span className="text-xs text-gray-700 truncate">{String(rec.data[k] ?? '—')}</span>
                  </div>
                ))}
              </div>
              {keys.length > 3 && (
                <button
                  onClick={() => setExpanded(isOpen ? null : rec.id)}
                  className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  {isOpen
                    ? <><ChevronUp className="w-3 h-3" /> Ver menos</>
                    : <><ChevronDown className="w-3 h-3" /> Ver {keys.length - 3} más</>}
                </button>
              )}
              <a
                href={rec.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block text-xs text-blue-400 hover:text-blue-600 truncate"
              >
                {rec.source_url}
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── UrlNodeEditor (recursivo) ────────────────────────────────────────────────

const depthColors = [
  'border-l-blue-400',
  'border-l-violet-400',
  'border-l-emerald-400',
  'border-l-orange-400',
]

function UrlNodeEditor({
  node, allNodes, depth, onUpdate, onRemove, onAddChild, onOpenSelector,
}: {
  node: NodeDraft
  allNodes: NodeDraft[]
  depth: number
  onUpdate: (cid: string, p: Partial<NodeDraft>) => void
  onRemove: (cid: string) => void
  onAddChild: (parent: string) => void
  onOpenSelector: (nodeId: string, url: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const children = allNodes.filter(n => n.parent_client_id === node.client_id)
  const hasChildUrlField = node.fields.some(f => f.is_child_url)

  const addField = () =>
    onUpdate(node.client_id, { fields: [...node.fields, emptyField(node.fields.length)] })

  const addListField = () =>
    onUpdate(node.client_id, { fields: [...node.fields, { ...emptyField(node.fields.length), is_list: true }] })

  const updateField = (fid: string, patch: Partial<FieldDraft>) =>
    onUpdate(node.client_id, { fields: node.fields.map(f => f.id === fid ? { ...f, ...patch } : f) })

  const removeField = (fid: string) =>
    onUpdate(node.client_id, { fields: node.fields.filter(f => f.id !== fid) })

  return (
    <div
      className={`bg-white rounded-2xl border border-gray-200 shadow-sm border-l-4 ${depthColors[depth % depthColors.length]} overflow-hidden`}
      style={{ marginLeft: depth * 20 }}
    >
      {/* Node header */}
      <div className="flex items-center gap-3 px-5 py-4 bg-gray-50/60 border-b border-gray-100">
        <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
        <div className={`flex-1 grid gap-3 ${depth === 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nombre de sección</label>
            <input
              value={node.name}
              onChange={e => onUpdate(node.client_id, { name: e.target.value })}
              placeholder={depth === 0 ? 'Ej: Proyectos' : 'Ej: Detalle del proyecto'}
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            />
          </div>
          {depth === 0 ? (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">URL de origen</label>
              <div className="flex items-center gap-2">
                <input
                  value={node.url}
                  onChange={e => onUpdate(node.client_id, { url: e.target.value })}
                  placeholder="https://..."
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                />
                <button
                  type="button"
                  onClick={() => onOpenSelector(node.client_id, node.url)}
                  disabled={!node.url}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Abrir selector visual ↗
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-violet-50 border border-violet-100 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
              <p className="text-xs text-violet-600">
                URL dinámica — tomada del campo <span className="font-semibold">URL hija</span> del nodo padre
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
            title={collapsed ? 'Expandir' : 'Colapsar'}
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onRemove(node.client_id)}
            className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition"
            title="Eliminar sección"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-5 py-4">
          {/* Container selector */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <label className="block text-xs font-semibold text-blue-700 mb-1">Selector del contenedor (card)</label>
            <p className="text-xs text-blue-500 mb-2">
              Selector CSS del elemento repetido que agrupa los campos de cada card. Ej: <code className="bg-blue-100 px-0.5 rounded font-mono">div.listing-card</code>
            </p>
            <input
              value={node.container_selector}
              onChange={e => onUpdate(node.client_id, { container_selector: e.target.value })}
              placeholder="Ej: div.card, article.proyecto, li.item"
              className="w-full border border-blue-200 bg-white rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Fields */}
          {node.fields.length > 0 && (
            <div className="space-y-3 mb-4">
              {node.fields.map(field => (
                <FieldEditor key={field.id} field={field} onUpdate={updateField} onRemove={removeField} />
              ))}
            </div>
          )}

          {/* Add field / Add list */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={addField}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-2 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Agregar campo
            </button>
            <button
              onClick={addListField}
              className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-3 py-2 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Agregar lista
            </button>
          </div>

          {/* Add child node (only if there's a "Es URL hija" field) */}
          {hasChildUrlField && (
            <button
              onClick={() => onAddChild(node.client_id)}
              className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 border border-violet-200 bg-violet-50 hover:bg-violet-100 rounded-lg px-3 py-2 transition mb-4"
            >
              <Plus className="w-3.5 h-3.5" />
              Agregar sección hija
            </button>
          )}

          {/* Children */}
          {children.length > 0 && (
            <div className="space-y-3 mt-2">
              {children.map(child => (
                <UrlNodeEditor
                  key={child.client_id}
                  node={child}
                  allNodes={allNodes}
                  depth={depth + 1}
                  onUpdate={onUpdate}
                  onRemove={onRemove}
                  onAddChild={onAddChild}
                  onOpenSelector={onOpenSelector}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── FieldNameAutocomplete ────────────────────────────────────────────────────

function FieldNameAutocomplete({
  value, onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(-1)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false); setFocused(-1)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const fetch = (q: string) => {
    clearTimeout(timer.current)
    if (q.length < 1) { setSuggestions([]); setOpen(false); return }
    timer.current = setTimeout(async () => {
      try {
        const res = await getFieldNameSuggestions(q)
        setSuggestions(res.data)
        setOpen(res.data.length > 0)
        setFocused(-1)
      } catch {
        setSuggestions([]); setOpen(false)
      }
    }, 200)
  }

  const select = (name: string) => { onChange(name); setOpen(false); setFocused(-1) }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(f => Math.min(f + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocused(f => Math.max(f - 1, -1)) }
    else if (e.key === 'Enter' && focused >= 0) { e.preventDefault(); select(suggestions[focused]) }
    else if (e.key === 'Escape') { setOpen(false); setFocused(-1) }
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); fetch(e.target.value) }}
        onFocus={() => { if (suggestions.length > 0) setOpen(true) }}
        onKeyDown={onKeyDown}
        placeholder="nombre_campo (ej: precio, ubicacion)"
        className="w-full border border-gray-200 bg-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {suggestions.map((s, i) => (
            <li
              key={s}
              onMouseDown={() => select(s)}
              className={`px-3 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2 ${
                i === focused ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="font-mono text-xs uppercase tracking-wider font-semibold">{s}</span>
              <span className="text-gray-400 text-xs normal-case">({s})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── FieldEditor ──────────────────────────────────────────────────────────────

function FieldEditor({
  field, onUpdate, onRemove,
}: {
  field: FieldDraft
  onUpdate: (id: string, p: Partial<FieldDraft>) => void
  onRemove: (id: string) => void
}) {
  const addSelector = () =>
    onUpdate(field.id, { selectors: [...field.selectors, emptySelector(field.selectors.length)] })

  const updSel = (sid: string, value: string) =>
    onUpdate(field.id, { selectors: field.selectors.map(s => s.id === sid ? { ...s, value } : s) })

  const rmSel = (sid: string) =>
    onUpdate(field.id, { selectors: field.selectors.filter(s => s.id !== sid) })

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3.5">
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-2.5">

          {/* Field name */}
          <div className="flex items-center gap-2">
            <FieldNameAutocomplete
              value={field.name}
              onChange={v => onUpdate(field.id, { name: v })}
            />
            {field.is_list && (
              <span className="flex-shrink-0 text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-md font-medium border border-indigo-200">
                lista [ ]
              </span>
            )}
            {field.is_image && (
              <span className="flex-shrink-0 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md font-medium border border-emerald-200">
                imagen
              </span>
            )}
          </div>

          {/* Selector chain */}
          <div className="space-y-1.5">
            {/* Description header */}
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium text-gray-500">Selectores CSS</p>
              <span className="text-xs text-gray-400">— de más general a más específico</span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed -mt-0.5">
              El primer selector es el <span className="font-medium text-gray-500">contenedor externo</span> (ej: <code className="bg-gray-100 px-0.5 rounded font-mono">div.card</code>),
              el último es el <span className="font-medium text-gray-500">elemento con el valor</span> (ej: <code className="bg-gray-100 px-0.5 rounded font-mono">span.precio</code>).
              El sistema los une como selector descendiente.
            </p>

            {field.selectors.map((sel, idx) => (
              <div key={sel.id} className="flex items-center gap-2 pl-1">
                {idx === 0 ? (
                  <span className="text-xs text-gray-400 w-14 flex-shrink-0 text-right">externo</span>
                ) : idx === field.selectors.length - 1 && field.selectors.length > 1 ? (
                  <span className="text-xs text-gray-400 w-14 flex-shrink-0 text-right">específico</span>
                ) : (
                  <span className="text-xs text-gray-300 w-14 flex-shrink-0 text-center">↓</span>
                )}
                <input
                  value={sel.value}
                  onChange={e => updSel(sel.id, e.target.value)}
                  placeholder={
                    idx === 0
                      ? 'Ej: div.lista-proyectos  (contenedor padre)'
                      : idx === field.selectors.length - 1 && idx > 0
                      ? 'Ej: span.precio  (elemento con el valor)'
                      : `Ej: div.item-card  (nivel ${idx + 1})`
                  }
                  className="flex-1 border border-gray-200 bg-white rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <button
                  onClick={() => rmSel(sel.id)}
                  className="text-gray-300 hover:text-red-400 transition flex-shrink-0"
                  title="Eliminar nivel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={addSelector}
              className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 hover:underline ml-16 mt-1"
            >
              <Plus className="w-3 h-3" />
              {field.selectors.length === 0 ? 'Agregar selector CSS' : 'Agregar nivel descendente'}
            </button>
          </div>

          {/* Toggles row */}
          <div className="flex items-center gap-4 pt-0.5 flex-wrap">
            {/* URL hija toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => onUpdate(field.id, { is_child_url: !field.is_child_url, plain_text: false })}
                className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${
                  field.is_child_url ? 'bg-violet-500' : 'bg-gray-200'
                }`}
              >
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                  field.is_child_url ? 'translate-x-4' : ''
                }`} />
              </div>
              <span className="text-xs text-gray-600 whitespace-nowrap">URL hija</span>
            </label>

            {/* Texto plano toggle — disabled when is_child_url */}
            <label className={`flex items-center gap-2 select-none ${field.is_child_url ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
              <div
                onClick={() => !field.is_child_url && onUpdate(field.id, { plain_text: !field.plain_text })}
                className={`relative w-8 h-4 rounded-full transition-colors ${
                  field.plain_text ? 'bg-amber-500' : 'bg-gray-200'
                } ${field.is_child_url ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                  field.plain_text ? 'translate-x-4' : ''
                }`} />
              </div>
              <span className="text-xs text-gray-600 whitespace-nowrap">Texto plano</span>
            </label>

            {/* Campo compartido toggle — disabled when is_child_url */}
            <label className={`flex items-center gap-2 select-none ${field.is_child_url ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
              <div
                onClick={() => !field.is_child_url && onUpdate(field.id, { is_shared: !field.is_shared })}
                className={`relative w-8 h-4 rounded-full transition-colors ${
                  field.is_shared ? 'bg-teal-500' : 'bg-gray-200'
                } ${field.is_child_url ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                  field.is_shared ? 'translate-x-4' : ''
                }`} />
              </div>
              <span className="text-xs text-gray-600 whitespace-nowrap">Campo compartido</span>
            </label>

            {/* Extraer atributo toggle */}
            <label className={`flex items-center gap-2 select-none ${field.is_child_url ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
              <div
                onClick={() => !field.is_child_url && onUpdate(field.id, { extract_attr: field.extract_attr ? '' : '_' })}
                className={`relative w-8 h-4 rounded-full transition-colors ${
                  field.extract_attr ? 'bg-rose-500' : 'bg-gray-200'
                } ${field.is_child_url ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                  field.extract_attr ? 'translate-x-4' : ''
                }`} />
              </div>
              <span className="text-xs text-gray-600 whitespace-nowrap">Extraer atributo</span>
            </label>

            {/* Lista toggle */}
            <label className={`flex items-center gap-2 select-none ${field.is_child_url ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
              <div
                onClick={() => !field.is_child_url && onUpdate(field.id, { is_list: !field.is_list })}
                className={`relative w-8 h-4 rounded-full transition-colors ${
                  field.is_list ? 'bg-indigo-500' : 'bg-gray-200'
                } ${field.is_child_url ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                  field.is_list ? 'translate-x-4' : ''
                }`} />
              </div>
              <span className="text-xs text-gray-600 whitespace-nowrap">Lista</span>
            </label>

            {/* Imagen toggle */}
            <label className={`flex items-center gap-2 select-none ${field.is_child_url ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
              <div
                onClick={() => !field.is_child_url && onUpdate(field.id, { is_image: !field.is_image })}
                className={`relative w-8 h-4 rounded-full transition-colors ${
                  field.is_image ? 'bg-emerald-500' : 'bg-gray-200'
                } ${field.is_child_url ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                  field.is_image ? 'translate-x-4' : ''
                }`} />
              </div>
              <span className="text-xs text-gray-600 whitespace-nowrap">Imagen</span>
            </label>
          </div>

          {/* Atributo input — visible cuando toggle activo */}
          {field.extract_attr !== '' && !field.is_child_url && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 whitespace-nowrap">Nombre del atributo:</span>
              <input
                value={field.extract_attr === '_' ? '' : field.extract_attr}
                onChange={e => onUpdate(field.id, { extract_attr: e.target.value || '_' })}
                placeholder="ej: src, data-price, href, atr"
                className="flex-1 border border-rose-200 bg-white rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-rose-400"
              />
            </div>
          )}

          {/* Info boxes */}
          {field.is_child_url && (
            <div className="flex items-start gap-1.5 p-2.5 bg-violet-50 rounded-lg border border-violet-100">
              <AlertCircle className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-violet-600 leading-relaxed">
                El valor extraído se usará como URL para navegar a la sección hija.
                El selector debe capturar un elemento <code className="bg-violet-100 px-0.5 rounded font-mono">{'<a>'}</code> para obtener el <code className="bg-violet-100 px-0.5 rounded font-mono">href</code>.
              </p>
            </div>
          )}

          {field.plain_text && !field.is_child_url && (
            <div className="flex items-start gap-1.5 p-2.5 bg-amber-50 rounded-lg border border-amber-100">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-700 leading-relaxed">
                Extrae todo el texto visible del elemento y sus hijos, ignorando las etiquetas HTML.{' '}
                <span className="font-medium">Ejemplo:</span>{' '}
                <code className="bg-amber-100 px-0.5 rounded font-mono">{'<p>Edificio <strong>en Lima</strong></p>'}</code>
                {' → '}<code className="bg-amber-100 px-0.5 rounded font-mono">"Edificio en Lima"</code>
              </p>
            </div>
          )}

          {field.is_shared && !field.is_child_url && (
            <div className="flex items-start gap-1.5 p-2.5 bg-teal-50 rounded-lg border border-teal-100">
              <AlertCircle className="w-3.5 h-3.5 text-teal-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-teal-700 leading-relaxed">
                Se extrae una sola vez de la página y se agrega a todos los registros del catálogo.
                Útil para campos únicos como descripción general, nombre del proyecto, ciudad, etc.
              </p>
            </div>
          )}

          {field.extract_attr && field.extract_attr !== '_' && !field.is_child_url && (
            <div className="flex items-start gap-1.5 p-2.5 bg-rose-50 rounded-lg border border-rose-100">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-rose-700 leading-relaxed">
                Extrae el valor del atributo <code className="bg-rose-100 px-0.5 rounded font-mono">{field.extract_attr}</code> del elemento.{' '}
                Ejemplo: <code className="bg-rose-100 px-0.5 rounded font-mono">{'<div class="hijo" ' + field.extract_attr + '="valor">'}</code>
                {' → '}<code className="bg-rose-100 px-0.5 rounded font-mono">"valor"</code>
              </p>
            </div>
          )}

          {field.is_image && !field.is_child_url && (
            <div className="flex items-start gap-1.5 p-2.5 bg-emerald-50 rounded-lg border border-emerald-100">
              <AlertCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-emerald-700 leading-relaxed">
                Las imágenes se <strong>descargarán y guardarán localmente</strong> al ejecutar el scraping.
                Se mostrarán como imágenes en la vista de datos. Usa con <span className="font-medium">Extraer atributo</span>{' '}
                (<code className="bg-emerald-100 px-0.5 rounded font-mono">src</code>, <code className="bg-emerald-100 px-0.5 rounded font-mono">href</code>) para obtener la URL.
              </p>
            </div>
          )}

          {field.is_list && !field.is_child_url && (
            <div className="space-y-2 p-2.5 bg-indigo-50 rounded-lg border border-indigo-100">
              <div className="flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-indigo-700 leading-relaxed">
                  Extrae <strong>múltiples elementos</strong> y los guarda como array.
                  Define un <strong>contenedor de lista</strong> para acotar la búsqueda a un sub-elemento específico dentro del card (evita mezclar con otros contenedores del mismo tipo).
                </p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-indigo-600 font-medium whitespace-nowrap flex-shrink-0">Contenedor de lista:</span>
                <input
                  value={field.list_container}
                  onChange={e => onUpdate(field.id, { list_container: e.target.value })}
                  placeholder="Ej: div.galeria, div.contA:nth-child(1)  (vacío = busca en todo el card)"
                  className="flex-1 border border-indigo-200 bg-white rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => onRemove(field.id)}
          className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition flex-shrink-0 mt-0.5"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
