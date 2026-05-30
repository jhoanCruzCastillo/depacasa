import { useState, useEffect, useCallback } from 'react'
import {
  Users,
  Send,
  Pencil,
  Trash2,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Mail,
  Globe,
  Phone,
  User,
  Eye,
  Tag,
  Clock,
  FileText,
  ExternalLink,
  Image as ImageIcon,
  CheckCircle2,
  XCircle,
  Flame,
  Thermometer,
  Snowflake,
  FileCheck,
  FileX,
  FileQuestion,
} from 'lucide-react'
import API from '../../services/api'
import toast from 'react-hot-toast'

interface TierInfo {
  key: 'muy_caliente' | 'caliente' | 'tibio' | 'frio'
  label: string
}

interface ScoreSummary {
  total: number
  max: number
  tier: TierInfo
}

interface SiteUser {
  id: string
  email: string
  name: string | null
  country: string | null
  phone: string | null
  whatsapp: string | null
  wants_newsletter: boolean
  role: string | null
  created_at: string | null
  has_uploaded_documents?: boolean
  has_financial_document?: boolean
  financial_doc_status: 'pending' | 'approved' | 'rejected' | null
  financial_doc_notes: string | null
  financial_doc_reviewed_at: string | null
  financial_doc_reviewed_by: string | null
  score?: ScoreSummary
}

interface Interaction {
  record_id: string
  rating: number | null
  interested: boolean
  seen_in_chat: boolean
  rated_at: string | null
  seen_at: string | null
  created_at: string | null
  source_url: string | null
  property_title: string | null
  property_model: string | null
  property_location: string | null
  property_price: string | null
}

interface LeadData {
  full_name: string | null
  whatsapp: string | null
  document_number: string | null
  financial_capacity_doc: string | null
  country_of_residence: string | null
  record_id: string | null
  rating: number | null
  updated_at: string | null
}

interface SearchEntry {
  id: string
  query: string | null
  location: string | null
  source: string
  created_at: string | null
}

interface DocumentsSummary {
  has_uploaded_documents: boolean
  has_financial_document: boolean
  identity_document: string | null
  financial_capacity_doc_url: string | null
  financial_capacity_doc_kind: 'pdf' | 'image' | 'file' | 'link' | null
}

interface BudgetContext {
  min?: number | null
  max?: number | null
  currency?: string
  strictness?: string
}

interface BehaviorSignals {
  viewed_record_ids?: string[]
  rated_record_ids?: string[]
  interested_record_ids?: string[]
  discarded_record_ids?: string[]
}

interface ConversationMemory {
  last_search_description?: string | null
  ajustes_aceptados?: string[]
  ajustes_rechazados?: string[]
}

interface ConsolidatedContext {
  budget_context?: BudgetContext
  lead_profile?: Record<string, unknown>
  behavior_signals?: BehaviorSignals
  conversation_memory?: ConversationMemory
}

interface UserProfile {
  user: SiteUser
  lead: LeadData
  documents?: DocumentsSummary
  score?: ScoreSummary
  preferences: Record<string, unknown> | null
  context?: ConsolidatedContext
  preferences_updated_at?: string | null
  interactions: Interaction[]
  search_history: SearchEntry[]
}

type DetailTabId = 'profile' | 'document' | 'preferences'

const TIER_CONFIG: Record<string, { color: string; bg: string; border: string; Icon: typeof Flame }> = {
  muy_caliente: { color: 'text-red-600', bg: 'bg-red-100', border: 'border-red-200', Icon: Flame },
  caliente: { color: 'text-orange-600', bg: 'bg-orange-100', border: 'border-orange-200', Icon: Thermometer },
  tibio: { color: 'text-amber-600', bg: 'bg-amber-100', border: 'border-amber-200', Icon: Thermometer },
  frio: { color: 'text-slate-500', bg: 'bg-slate-100', border: 'border-slate-200', Icon: Snowflake },
}

function TierBadge({ score }: { score: ScoreSummary }) {
  const cfg = TIER_CONFIG[score.tier.key] || TIER_CONFIG.frio
  const Icon = cfg.Icon
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon className="w-3 h-3" />
      <span>{score.total}/100</span>
    </div>
  )
}

function DocStatusBadge({ status }: { status: string | null }) {
  if (status === 'approved')
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full"><FileCheck className="w-2.5 h-2.5" /> Aprobado</span>
  if (status === 'rejected')
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full"><FileX className="w-2.5 h-2.5" /> Rechazado</span>
  if (status === 'pending')
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full"><Clock className="w-2.5 h-2.5" /> En revisión</span>
  return <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full"><FileQuestion className="w-2.5 h-2.5" /> Sin validar</span>
}
type EditableFieldKey = 'name' | 'email' | 'country' | 'phone'

const PAGE_SIZE = 20
const emptyForm = { name: '', email: '', country: '', phone: '', wants_newsletter: false }

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
const PUBLIC_BASE_URL = API_URL.replace(/\/api\/?$/, '')

const toAbsoluteResourceUrl = (raw?: string | null): string => {
  const value = (raw || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value
  if (value.startsWith('//')) return `https:${value}`
  if (value.startsWith('/')) return `${PUBLIC_BASE_URL}${value}`
  return `${PUBLIC_BASE_URL}/${value}`
}

const isPdfUrl = (url: string): boolean => /\.pdf(?:$|[?#])/i.test(url)
const isImageUrl = (url: string): boolean => /\.(jpg|jpeg|png|webp|gif|bmp|avif|heic)(?:$|[?#])/i.test(url)

const formatDate = (value?: string | null, withTime = false): string => {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return withTime ? parsed.toLocaleString('es-PE') : parsed.toLocaleDateString('es-PE')
}

const PREF_FIELD_DEFS: Array<{ key: string; label: string; priorityKey: string; isNearby?: boolean }> = [
  { key: 'direccion',      label: 'Dirección',         priorityKey: 'direccion_priority' },
  { key: 'ubicacion',      label: 'Ubicación',         priorityKey: 'ubicacion_priority' },
  { key: 'pais',           label: 'País',              priorityKey: 'pais_priority' },
  { key: 'bedrooms',       label: 'Habitaciones',      priorityKey: 'bedrooms_priority' },
  { key: 'bathrooms',      label: 'Baños',             priorityKey: 'bathrooms_priority' },
  { key: 'm2',             label: 'M²',                priorityKey: 'm2_priority' },
  { key: 'min_price',      label: 'Precio mínimo',     priorityKey: 'min_price_priority' },
  { key: 'max_price',      label: 'Precio máximo',     priorityKey: 'max_price_priority' },
  { key: 'nearby_places',  label: 'Zonas cercanas',    priorityKey: '',                  isNearby: true },
  { key: 'property_type',  label: 'Tipo de propiedad', priorityKey: 'property_type_priority' },
]

const formatPrefValue = (val: unknown): string => {
  if (val === null || val === undefined || val === '') return '-'
  if (Array.isArray(val)) {
    if (val.length === 0) return '-'
    // New format: [{name, priority}]
    if (typeof val[0] === 'object' && val[0] !== null && 'name' in (val[0] as object)) {
      return (val as Array<{ name: string; priority?: string }>)
        .map(i => `${i.name}${i.priority === 'REQUIRED' ? ' ●' : ''}`)
        .join(', ')
    }
    return val.map(v => String(v).trim()).filter(Boolean).join(', ')
  }
  return String(val)
}

export default function ChatUsersPage() {
  const [users, setUsers] = useState<SiteUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const [editModal, setEditModal] = useState<SiteUser | null>(null)
  const [editForm, setEditForm] = useState({ ...emptyForm })
  const [editSaving, setEditSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<SiteUser | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [emailTarget, setEmailTarget] = useState<SiteUser | null>(null)
  const [emailSubject, setEmailSubject] = useState('Novedades del portal')
  const [emailBody, setEmailBody] = useState('')
  const [sending, setSending] = useState(false)

  const [detailTarget, setDetailTarget] = useState<SiteUser | null>(null)
  const [detailProfile, setDetailProfile] = useState<UserProfile | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailTab, setDetailTab] = useState<DetailTabId>('profile')

  const [docValidateStatus, setDocValidateStatus] = useState<'approved' | 'rejected' | 'pending'>('pending')
  const [docValidateNotes, setDocValidateNotes] = useState('')
  const [docValidateReviewer, setDocValidateReviewer] = useState('')
  const [docValidating, setDocValidating] = useState(false)

  const closeDetailModal = () => {
    setDetailLoading(false)
    setDetailProfile(null)
    setDetailTarget(null)
    setDetailTab('profile')
  }

  const openDetail = async (u: SiteUser) => {
    setDetailTarget(u)
    setDetailProfile(null)
    setDetailTab('profile')
    setDetailLoading(true)
    setDocValidateStatus((u.financial_doc_status as 'approved' | 'rejected' | 'pending') || 'pending')
    setDocValidateNotes(u.financial_doc_notes || '')
    setDocValidateReviewer(u.financial_doc_reviewed_by || '')
    try {
      const res = await API.get(`/site-users/${u.id}/profile`)
      setDetailProfile(res.data)
    } catch {
      toast.error('No se pudo cargar el detalle del usuario')
      setDetailTarget(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleDocValidate = async () => {
    if (!detailTarget) return
    setDocValidating(true)
    try {
      await API.post(`/site-users/${detailTarget.id}/validate-document`, {
        status: docValidateStatus,
        notes: docValidateNotes.trim() || null,
        reviewed_by: docValidateReviewer.trim() || null,
      })
      toast.success('Validación guardada')
      const res = await API.get(`/site-users/${detailTarget.id}/profile`)
      setDetailProfile(res.data)
      load()
    } catch {
      toast.error('Error al guardar la validación')
    } finally {
      setDocValidating(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await API.get('/site-users', {
        params: { skip: page * PAGE_SIZE, limit: PAGE_SIZE, search: query },
      })
      setUsers(res.data.items ?? [])
      setTotal(res.data.total ?? 0)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(detail || 'Error al cargar usuarios')
    } finally {
      setLoading(false)
    }
  }, [page, query])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(0)
    setQuery(search)
  }

  const openEdit = (u: SiteUser) => {
    setEditForm({
      name: u.name || '',
      email: u.email,
      country: u.country || '',
      phone: u.phone || '',
      wants_newsletter: u.wants_newsletter,
    })
    setEditModal(u)
  }

  const handleEditSave = async () => {
    if (!editModal) return
    setEditSaving(true)
    try {
      await API.put(`/site-users/${editModal.id}`, {
        name: editForm.name.trim() || null,
        email: editForm.email.trim(),
        country: editForm.country.trim() || null,
        phone: editForm.phone.trim() || null,
        wants_newsletter: editForm.wants_newsletter,
      })
      toast.success('Usuario actualizado')
      setEditModal(null)
      load()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Error al guardar')
    } finally {
      setEditSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await API.delete(`/site-users/${deleteTarget.id}`)
      toast.success('Usuario eliminado')
      setDeleteTarget(null)
      if (users.length === 1 && page > 0) setPage(p => p - 1)
      else load()
    } catch {
      toast.error('Error al eliminar')
    } finally {
      setDeleting(false)
    }
  }

  const openEmail = (u: SiteUser) => {
    setEmailTarget(u)
    setEmailSubject('Novedades del portal')
    setEmailBody('')
  }

  const handleSendEmail = async () => {
    if (!emailTarget || !emailBody.trim()) return
    setSending(true)
    try {
      await API.post(`/site-users/${emailTarget.id}/send-email`, {
        subject: emailSubject.trim(),
        body: emailBody.trim(),
      })
      toast.success(`Correo enviado a ${emailTarget.email}`)
      setEmailTarget(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Error al enviar el correo')
    } finally {
      setSending(false)
    }
  }

  const detailTitleSource = detailProfile?.user || detailTarget
  const detailDisplayName = detailTitleSource?.name || null
  const detailDisplayEmail = detailTitleSource?.email || ''

  const financialDocRaw =
    detailProfile?.documents?.financial_capacity_doc_url ||
    detailProfile?.lead?.financial_capacity_doc ||
    null
  const financialDocUrl = toAbsoluteResourceUrl(financialDocRaw)
  const financialDocKind =
    detailProfile?.documents?.financial_capacity_doc_kind ||
    (isPdfUrl(financialDocRaw || '') ? 'pdf' : isImageUrl(financialDocRaw || '') ? 'image' : null)

  const tabs: Array<{ id: DetailTabId; label: string }> = [
    { id: 'profile', label: 'Perfil' },
    { id: 'document', label: 'Documento financiero' },
    { id: 'preferences', label: 'Preferencias' },
  ]

  const editableFields: Array<{
    label: string
    field: EditableFieldKey
    icon: typeof User
    placeholder: string
  }> = [
    { label: 'Nombre', field: 'name', icon: User, placeholder: 'Nombre del usuario' },
    {
      label: 'Correo electronico',
      field: 'email',
      icon: Mail,
      placeholder: 'correo@ejemplo.com',
    },
    { label: 'Pais', field: 'country', icon: Globe, placeholder: 'Ej: Peru' },
    { label: 'Telefono', field: 'phone', icon: Phone, placeholder: '+51 999 999 999' },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Usuarios registrados</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {total} usuario{total !== 1 ? 's' : ''} en total
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, correo o pais..."
              className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
          >
            Buscar
          </button>
          {query && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setQuery('')
                setPage(0)
              }}
              className="p-2 text-slate-400 hover:text-slate-600"
              title="Limpiar busqueda"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-400">Cargando...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>{query ? 'Sin resultados para esa busqueda.' : 'Aun no hay usuarios registrados.'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">Usuario</th>
                <th className="text-left px-4 py-3 font-semibold">Pais</th>
                <th className="text-left px-4 py-3 font-semibold">Score</th>
                <th className="text-left px-4 py-3 font-semibold">Documentos</th>
                <th className="text-left px-4 py-3 font-semibold">Registro</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-600">
                        {(u.name || u.email).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">
                          {u.name || <span className="text-slate-400 italic">Sin nombre</span>}
                        </p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">
                    {u.country || <span className="text-slate-300">-</span>}
                  </td>
                  <td className="px-4 py-3.5">
                    {u.score ? (
                      <div className="flex flex-col gap-1">
                        <TierBadge score={u.score} />
                        <DocStatusBadge status={u.financial_doc_status} />
                      </div>
                    ) : (
                      <span className="text-slate-300 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {u.has_uploaded_documents ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Si
                        </span>
                        <p className="text-[10px] text-slate-500">
                          {u.has_financial_document
                            ? 'Con sustento financiero'
                            : 'Sin sustento financiero'}
                        </p>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full">
                        <XCircle className="w-3.5 h-3.5" />
                        No
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-400 text-xs">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openDetail(u)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 transition-colors"
                        title="Ver detalles del usuario"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Ver detalles
                      </button>
                      <button
                        onClick={() => openEmail(u)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 transition-colors"
                        title="Enviar correo"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Enviar
                      </button>
                      <button
                        onClick={() => openEdit(u)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i)
              .filter(i => i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1)
              .reduce<(number | '...')[]>((acc, i, idx, arr) => {
                if (idx > 0 && (arr[idx - 1] as number) < i - 1) acc.push('...')
                acc.push(i)
                return acc
              }, [])
              .map((item, i) =>
                item === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-1">
                    ...
                  </span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setPage(item as number)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                      page === item ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-600'
                    }`}
                  >
                    {(item as number) + 1}
                  </button>
                ),
              )}
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {editModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Editar usuario</h2>
              <button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {editableFields.map(({ label, field, icon: Icon, placeholder }) => (
              <div key={field}>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">{label}</label>
                <div className="relative">
                  <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={editForm[field]}
                    onChange={e => setEditForm(f => ({ ...f, [field]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            ))}

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={editForm.wants_newsletter}
                onChange={e => setEditForm(f => ({ ...f, wants_newsletter: e.target.checked }))}
                className="w-4 h-4 rounded accent-blue-600"
              />
              <span className="text-sm text-slate-700">Recibir novedades por correo</span>
            </label>

            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setEditModal(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving || !editForm.email.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Eliminar usuario</h2>
            <p className="text-sm text-slate-600">
              Eliminar a <span className="font-medium">{deleteTarget.name || deleteTarget.email}</span>? Esta
              accion no se puede deshacer.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(detailLoading || detailProfile || detailTarget) && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 p-3 md:p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full h-full flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600 flex-shrink-0">
                  {(detailDisplayName || detailDisplayEmail || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="font-bold text-slate-800 text-base truncate">
                    {detailDisplayName || 'Sin nombre'}
                  </h2>
                  <p className="text-xs text-slate-400 truncate">{detailDisplayEmail}</p>
                </div>
              </div>
              <button
                onClick={closeDetailModal}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
                title="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center flex-1 text-slate-400">
                <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            ) : detailProfile ? (
              <>
                <div className="px-6 pt-4 border-b border-slate-100 flex gap-2 overflow-x-auto">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setDetailTab(tab.id)}
                      className={`px-3.5 py-2 text-sm rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${
                        detailTab === tab.id
                          ? 'border-blue-600 text-blue-700 bg-blue-50'
                          : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-hidden">
                  {detailTab === 'profile' && (
                    <div className="h-full overflow-y-auto p-6 space-y-6">
                      {detailProfile.score && (
                        <section>
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                            Calificacion del lead
                          </h3>
                          <div className="flex items-center gap-4 bg-slate-50 rounded-xl p-4">
                            <TierBadge score={detailProfile.score} />
                            <div className="flex-1">
                              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                                <span>{detailProfile.score.tier.label}</span>
                                <span className="font-bold text-slate-700">{detailProfile.score.total}/{detailProfile.score.max} pts</span>
                              </div>
                              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    detailProfile.score.tier.key === 'muy_caliente' ? 'bg-red-500' :
                                    detailProfile.score.tier.key === 'caliente' ? 'bg-orange-500' :
                                    detailProfile.score.tier.key === 'tibio' ? 'bg-amber-400' : 'bg-slate-400'
                                  }`}
                                  style={{ width: `${(detailProfile.score.total / detailProfile.score.max) * 100}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </section>
                      )}

                      <section>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                          Informacion del usuario
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {[
                            { icon: Mail,  label: 'Correo',      value: detailProfile.user.email },
                            { icon: User,  label: 'Nombre',      value: detailProfile.user.name || '-' },
                            { icon: Phone, label: 'Teléfono',    value: detailProfile.user.phone || '-' },
                            { icon: Phone, label: 'WhatsApp',    value: detailProfile.user.whatsapp || '-' },
                            { icon: Globe, label: 'País',        value: detailProfile.user.country || '-' },
                            { icon: Tag,   label: 'Rol',         value: detailProfile.user.role || '-' },
                            { icon: Send,  label: 'Newsletter',  value: detailProfile.user.wants_newsletter ? 'Sí' : 'No' },
                            { icon: Clock, label: 'Registro',    value: formatDate(detailProfile.user.created_at, true) },
                          ].map(({ icon: Icon, label, value }) => (
                            <div key={label} className="flex items-start gap-2.5 bg-slate-50 rounded-xl p-3">
                              <Icon className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                                  {label}
                                </p>
                                <p className="text-sm text-slate-700 font-medium break-all">{value}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  )}

                  {detailTab === 'document' && (
                    <div className="h-full overflow-y-auto p-6 space-y-4">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                          <h3 className="text-sm font-semibold text-slate-700">Estado de documentos</h3>
                          <p className="text-sm text-slate-600 flex items-center gap-2">
                            {detailProfile.documents?.has_uploaded_documents ? (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                Documentos registrados
                              </>
                            ) : (
                              <>
                                <XCircle className="w-4 h-4 text-slate-400" />
                                Sin documentos registrados
                              </>
                            )}
                          </p>
                          <p className="text-sm text-slate-600 flex items-center gap-2">
                            {detailProfile.documents?.has_financial_document ? (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                Sustento financiero cargado
                              </>
                            ) : (
                              <>
                                <XCircle className="w-4 h-4 text-amber-500" />
                                Falta sustento financiero
                              </>
                            )}
                          </p>
                          <div className="pt-2 border-t border-slate-200 space-y-2 text-sm text-slate-600">
                            <p>
                              <span className="font-semibold text-slate-700">Documento identidad:</span>{' '}
                              {detailProfile.documents?.identity_document || '-'}
                            </p>
                            <p>
                              <span className="font-semibold text-slate-700">Tipo archivo:</span>{' '}
                              {detailProfile.documents?.financial_capacity_doc_kind || '-'}
                            </p>
                          </div>
                          {financialDocUrl && (
                            <a
                              href={financialDocUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
                            >
                              <ExternalLink className="w-4 h-4" />
                              Abrir documento
                            </a>
                          )}

                          {/* Validation panel */}
                          <div className="pt-3 border-t border-slate-200 space-y-3">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Validación manual</p>
                              <DocStatusBadge status={detailProfile.user.financial_doc_status} />
                            </div>
                            {detailProfile.user.financial_doc_reviewed_at && (
                              <p className="text-[11px] text-slate-400">
                                Revisado: {formatDate(detailProfile.user.financial_doc_reviewed_at, true)}
                                {detailProfile.user.financial_doc_reviewed_by && (
                                  <> · {detailProfile.user.financial_doc_reviewed_by}</>
                                )}
                              </p>
                            )}
                            {detailProfile.user.financial_doc_notes && (
                              <p className="text-xs text-slate-600 italic bg-white border border-slate-200 rounded-lg px-2 py-1.5">
                                "{detailProfile.user.financial_doc_notes}"
                              </p>
                            )}
                            <div className="flex gap-1.5">
                              {(['pending', 'approved', 'rejected'] as const).map(s => (
                                <button
                                  key={s}
                                  onClick={() => setDocValidateStatus(s)}
                                  className={`flex-1 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors ${
                                    docValidateStatus === s
                                      ? s === 'approved'
                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                        : s === 'rejected'
                                        ? 'bg-red-600 text-white border-red-600'
                                        : 'bg-amber-500 text-white border-amber-500'
                                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                  }`}
                                >
                                  {s === 'approved' ? 'Aprobar' : s === 'rejected' ? 'Rechazar' : 'En revisión'}
                                </button>
                              ))}
                            </div>
                            <input
                              value={docValidateReviewer}
                              onChange={e => setDocValidateReviewer(e.target.value)}
                              placeholder="Tu nombre (revisor)"
                              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <textarea
                              value={docValidateNotes}
                              onChange={e => setDocValidateNotes(e.target.value)}
                              placeholder="Notas de revisión..."
                              rows={2}
                              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                              onClick={handleDocValidate}
                              disabled={docValidating}
                              className="w-full py-2 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors"
                            >
                              {docValidating ? 'Guardando...' : 'Guardar validación'}
                            </button>
                          </div>
                        </div>

                        <div className="lg:col-span-2 bg-slate-100 rounded-xl p-3 min-h-[420px]">
                          {!financialDocUrl ? (
                            <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-slate-400 gap-2">
                              <FileText className="w-10 h-10" />
                              <p>No hay documento financiero para visualizar.</p>
                            </div>
                          ) : financialDocKind === 'pdf' ? (
                            <iframe
                              src={financialDocUrl}
                              title="Documento financiero"
                              className="w-full h-[70vh] rounded-lg border border-slate-200 bg-white"
                            />
                          ) : financialDocKind === 'image' ? (
                            <div className="h-[70vh] overflow-auto bg-white rounded-lg border border-slate-200">
                              <img
                                src={financialDocUrl}
                                alt="Documento financiero"
                                className="min-w-full object-contain"
                              />
                            </div>
                          ) : (
                            <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-slate-500 gap-3 text-center px-4">
                              <ImageIcon className="w-8 h-8 text-slate-400" />
                              <p>
                                El formato no tiene vista embebida. Abre el documento en una nueva
                                pestana.
                              </p>
                              <a
                                href={financialDocUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
                              >
                                <ExternalLink className="w-4 h-4" />
                                Abrir documento
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {detailTab === 'preferences' && (
                    <div className="h-full overflow-y-auto p-6 space-y-5">
                      <section className="bg-slate-50 rounded-xl p-4">
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <h3 className="text-sm font-semibold text-slate-700">Preferencias de búsqueda</h3>
                          <p className="text-xs text-slate-400">
                            {detailProfile.preferences_updated_at
                              ? `Actualizado: ${formatDate(detailProfile.preferences_updated_at, true)}`
                              : 'Sin actualizar aún'}
                          </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {PREF_FIELD_DEFS.map(({ key, label, priorityKey, isNearby }) => {
                            const prefs = detailProfile.preferences || {}
                            const val = prefs[key]
                            const priority = priorityKey ? prefs[priorityKey] as string | null | undefined : null
                            const isSet = val !== null && val !== undefined && val !== '' &&
                              !(Array.isArray(val) && val.length === 0)

                            if (isNearby) {
                              const items = Array.isArray(val)
                                ? (val as Array<{ name: string; priority?: string }>).filter(i => i?.name)
                                : []
                              return (
                                <div
                                  key={key}
                                  className={`rounded-lg border px-3 py-2.5 md:col-span-2 ${
                                    items.length ? 'bg-white border-slate-200' : 'bg-slate-50/60 border-slate-100'
                                  }`}
                                >
                                  <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 mb-1.5">
                                    {label}
                                  </p>
                                  {items.length ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {items.map(item => (
                                        <span
                                          key={item.name}
                                          className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border font-medium ${
                                            item.priority === 'REQUIRED'
                                              ? 'bg-orange-50 text-orange-700 border-orange-200'
                                              : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                          }`}
                                        >
                                          {item.name}
                                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full ${
                                            item.priority === 'REQUIRED'
                                              ? 'bg-orange-200 text-orange-800'
                                              : 'bg-indigo-100 text-indigo-500'
                                          }`}>
                                            {item.priority === 'REQUIRED' ? 'OBL' : 'PREF'}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-sm font-medium text-slate-300">-</p>
                                  )}
                                </div>
                              )
                            }

                            const displayValue = formatPrefValue(val)
                            return (
                              <div
                                key={key}
                                className={`rounded-lg border px-3 py-2.5 ${
                                  isSet
                                    ? 'bg-white border-slate-200'
                                    : 'bg-slate-50/60 border-slate-100'
                                }`}
                              >
                                <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 mb-0.5">
                                  {label}
                                </p>
                                <p className={`text-sm font-medium ${isSet ? 'text-slate-700' : 'text-slate-300'}`}>
                                  {displayValue}
                                </p>
                                {priority && (
                                  <span className={`mt-1.5 inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                    priority === 'REQUIRED'
                                      ? 'bg-orange-100 text-orange-700'
                                      : 'bg-indigo-100 text-indigo-700'
                                  }`}>
                                    {priority === 'REQUIRED' ? 'Obligatorio' : 'Preferencia'}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </section>

                    </div>
                  )}

                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-400">
                No se pudo cargar la informacion.
              </div>
            )}
          </div>
        </div>
      )}

      {emailTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Enviar correo de prueba</h2>
              <button onClick={() => setEmailTarget(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-500">
              Para: <span className="font-medium text-slate-700">{emailTarget.name || emailTarget.email}</span>{' '}
              <span className="text-slate-400">({emailTarget.email})</span>
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Asunto</label>
              <input
                value={emailSubject}
                onChange={e => setEmailSubject(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Mensaje</label>
              <textarea
                value={emailBody}
                onChange={e => setEmailBody(e.target.value)}
                placeholder="Escribe el contenido del correo..."
                rows={5}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEmailTarget(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendEmail}
                disabled={sending || !emailBody.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
                {sending ? 'Enviando...' : 'Enviar correo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
