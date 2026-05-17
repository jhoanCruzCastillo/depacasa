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
  MapPin,
  Tag,
  Clock,
  Star,
  MessageSquare,
  FileText,
  ExternalLink,
  Image as ImageIcon,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import API from '../../services/api'
import toast from 'react-hot-toast'

interface SiteUser {
  id: string
  email: string
  name: string | null
  country: string | null
  phone: string | null
  wants_newsletter: boolean
  created_at: string | null
  has_uploaded_documents?: boolean
  has_financial_document?: boolean
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

interface UserProfile {
  user: SiteUser
  lead: LeadData
  documents?: DocumentsSummary
  preferences: Record<string, unknown> | null
  context?: Record<string, unknown>
  preferences_updated_at?: string | null
  interactions: Interaction[]
  search_history: SearchEntry[]
}

type DetailTabId = 'profile' | 'document' | 'preferences' | 'activity'
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

const describeNumericPreference = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const type = input.tipo
  if (type === 'exacto' && typeof input.exacto === 'number') {
    return `Exacto: ${input.exacto}`
  }
  if (type === 'rango') {
    const min = typeof input.min === 'number' ? input.min : null
    const max = typeof input.max === 'number' ? input.max : null
    if (min !== null && max !== null) return `${min} - ${max}`
    if (min !== null) return `Desde ${min}`
    if (max !== null) return `Hasta ${max}`
  }
  return null
}

const getPreferenceDisplay = (
  preferences: Record<string, unknown> | null,
): Array<{ label: string; mode: string; value: string }> => {
  if (!preferences) return []
  const defs: Array<{ key: string; label: string }> = [
    { key: 'ubicacion', label: 'Ubicacion' },
    { key: 'zonas_cercanas', label: 'Zonas cercanas' },
    { key: 'areas_comunes', label: 'Areas comunes' },
    { key: 'habitaciones', label: 'Habitaciones' },
    { key: 'banos', label: 'Banos' },
    { key: 'metros_cuadrados', label: 'Metros cuadrados' },
  ]

  const rows: Array<{ label: string; mode: string; value: string }> = []
  for (const def of defs) {
    const raw = preferences[def.key]
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const mode = typeof item.modo === 'string' ? item.modo : 'preferencia'
    const rawValue = item.valor

    let displayValue: string | null = null
    if (typeof rawValue === 'string') {
      displayValue = rawValue.trim() || null
    } else if (Array.isArray(rawValue)) {
      const list = rawValue.map(v => String(v).trim()).filter(Boolean)
      displayValue = list.length ? list.join(', ') : null
    } else {
      displayValue = describeNumericPreference(rawValue)
    }

    if (displayValue) {
      rows.push({
        label: def.label,
        mode,
        value: displayValue,
      })
    }
  }

  return rows
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await API.get('/site-users', {
        params: { skip: page * PAGE_SIZE, limit: PAGE_SIZE, search: query },
      })
      setUsers(res.data.items)
      setTotal(res.data.total)
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

  const preferenceRows = getPreferenceDisplay(detailProfile?.preferences || null)

  const tabs: Array<{ id: DetailTabId; label: string }> = [
    { id: 'profile', label: 'Perfil' },
    { id: 'document', label: 'Documento financiero' },
    { id: 'preferences', label: 'Preferencias' },
    { id: 'activity', label: 'Actividad' },
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
                <th className="text-left px-4 py-3 font-semibold">Telefono</th>
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
                  <td className="px-4 py-3.5 text-slate-600">
                    {u.phone || <span className="text-slate-300">-</span>}
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
                      <section>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                          Informacion del usuario
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {[
                            { icon: Mail, label: 'Correo', value: detailProfile.user.email },
                            { icon: User, label: 'Nombre', value: detailProfile.user.name || '-' },
                            { icon: Phone, label: 'Telefono', value: detailProfile.user.phone || '-' },
                            { icon: Globe, label: 'Pais', value: detailProfile.user.country || '-' },
                            {
                              icon: Send,
                              label: 'Newsletter',
                              value: detailProfile.user.wants_newsletter ? 'Si' : 'No',
                            },
                            {
                              icon: Clock,
                              label: 'Registro',
                              value: formatDate(detailProfile.user.created_at, true),
                            },
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

                      <section>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                          Datos capturados por chatbot
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {[
                            { icon: User, label: 'Nombre completo', value: detailProfile.lead?.full_name || '-' },
                            { icon: Phone, label: 'WhatsApp', value: detailProfile.lead?.whatsapp || '-' },
                            { icon: Tag, label: 'Documento', value: detailProfile.lead?.document_number || '-' },
                            {
                              icon: Globe,
                              label: 'Pais residencia',
                              value:
                                detailProfile.lead?.country_of_residence ||
                                detailProfile.user.country ||
                                '-',
                            },
                            { icon: Eye, label: 'Record interesado', value: detailProfile.lead?.record_id || '-' },
                            {
                              icon: Clock,
                              label: 'Ultima captura',
                              value: formatDate(detailProfile.lead?.updated_at, true),
                            },
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
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <h3 className="text-sm font-semibold text-slate-700">Preferencias V2</h3>
                          <p className="text-xs text-slate-400">
                            Actualizado: {formatDate(detailProfile.preferences_updated_at, true)}
                          </p>
                        </div>

                        {preferenceRows.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {preferenceRows.map(item => (
                              <div
                                key={`${item.label}-${item.value}`}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                              >
                                <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400">
                                  {item.label}
                                </p>
                                <p className="text-sm text-slate-700 font-medium break-words">
                                  {item.value}
                                </p>
                                <p className="text-[11px] mt-1 inline-block px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                                  {item.mode === 'obligatorio' ? 'Obligatorio' : 'Preferencia'}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-slate-400">
                            No hay preferencias estructuradas registradas.
                          </p>
                        )}
                      </section>

                      <section className="bg-slate-50 rounded-xl p-4">
                        <h3 className="text-sm font-semibold text-slate-700 mb-2">Contexto consolidado</h3>
                        <pre className="text-xs text-slate-600 overflow-x-auto whitespace-pre-wrap break-words bg-white border border-slate-200 rounded-lg p-3">
                          {JSON.stringify(detailProfile.context || {}, null, 2)}
                        </pre>
                      </section>
                    </div>
                  )}

                  {detailTab === 'activity' && (
                    <div className="h-full overflow-y-auto p-6 space-y-6">
                      <section>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                          Historial de busquedas
                        </h3>
                        {detailProfile.search_history.length === 0 ? (
                          <p className="text-sm text-slate-400">Sin historial registrado.</p>
                        ) : (
                          <div className="space-y-2">
                            {detailProfile.search_history.map(h => (
                              <div key={h.id} className="flex items-start gap-3 bg-slate-50 rounded-xl px-4 py-3">
                                <MessageSquare className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  {h.query && <p className="text-sm text-slate-700">"{h.query}"</p>}
                                  {h.location && (
                                    <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                                      <MapPin className="w-3 h-3" />
                                      {h.location}
                                    </p>
                                  )}
                                </div>
                                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                  <span
                                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                      h.source === 'chatbot'
                                        ? 'bg-blue-100 text-blue-600'
                                        : 'bg-slate-100 text-slate-500'
                                    }`}
                                  >
                                    {h.source === 'chatbot' ? 'Chat' : 'Portal'}
                                  </span>
                                  <span className="text-[10px] text-slate-300">
                                    {formatDate(h.created_at)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>

                      <section>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                          Interacciones de propiedades
                        </h3>
                        {detailProfile.interactions.length === 0 ? (
                          <p className="text-sm text-slate-400">Sin interacciones registradas.</p>
                        ) : (
                          <div className="space-y-2">
                            {detailProfile.interactions.map(i => (
                              <div
                                key={`${i.record_id}-${i.created_at || 'x'}`}
                                className="bg-slate-50 rounded-xl px-4 py-3 space-y-2"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-700 truncate">
                                      {i.property_title ||
                                        i.property_model ||
                                        i.property_location ||
                                        i.record_id}
                                    </p>
                                    <p className="text-[11px] text-slate-400 font-mono truncate">
                                      {i.record_id}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {i.interested && (
                                      <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                                        Interesado
                                      </span>
                                    )}
                                    {i.rating !== null && (
                                      <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600">
                                        <Star className="w-3 h-3 fill-amber-400 stroke-amber-400" />
                                        {i.rating}/5
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {i.property_price && (
                                  <p className="text-xs text-slate-500">Precio: {i.property_price}</p>
                                )}
                                <p className="text-[11px] text-slate-400">Visto: {formatDate(i.seen_at)}</p>
                                {i.source_url && (
                                  <a
                                    href={i.source_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-blue-600 hover:underline break-all inline-block"
                                  >
                                    {i.source_url}
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
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
