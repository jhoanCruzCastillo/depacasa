import { useState, useEffect, useCallback } from 'react'
import {
  Users, Send, Pencil, Trash2, Search, X,
  ChevronLeft, ChevronRight, Mail, Globe, Phone, User,
  Eye, MapPin, BedDouble, Tag, Clock, Star, MessageSquare,
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
}

interface UserPreference {
  location: string | null
  bedrooms: number | null
  min_price: number | null
  max_price: number | null
  features: string[]
  keywords: string[]
  raw_description: string | null
  updated_at: string | null
}

interface Interaction {
  record_id: string
  rating: number | null
  interested: boolean
  seen_in_chat: boolean
  rated_at: string | null
}

interface SearchEntry {
  id: string
  query: string | null
  location: string | null
  source: string
  created_at: string | null
}

interface UserProfile {
  user: SiteUser
  preferences: UserPreference | null
  interactions: Interaction[]
  search_history: SearchEntry[]
}

const PAGE_SIZE = 20

const emptyForm = { name: '', email: '', country: '', phone: '', wants_newsletter: false }

export default function ChatUsersPage() {
  const [users, setUsers] = useState<SiteUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  // Edit modal
  const [editModal, setEditModal] = useState<SiteUser | null>(null)
  const [editForm, setEditForm] = useState({ ...emptyForm })
  const [editSaving, setEditSaving] = useState(false)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<SiteUser | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Send email modal
  const [emailTarget, setEmailTarget] = useState<SiteUser | null>(null)
  const [emailSubject, setEmailSubject] = useState('Novedades del portal')
  const [emailBody, setEmailBody] = useState('')
  const [sending, setSending] = useState(false)

  // Detail modal
  const [detailProfile, setDetailProfile] = useState<UserProfile | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const openDetail = async (u: SiteUser) => {
    setDetailLoading(true)
    setDetailProfile(null)
    try {
      const res = await API.get(`/site-users/${u.id}/profile`)
      setDetailProfile(res.data)
    } catch {
      toast.error('No se pudo cargar el perfil del usuario')
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

  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(0)
    setQuery(search)
  }

  // ── Edit ──────────────────────────────────────────────────────────────────────

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

  // ── Delete ────────────────────────────────────────────────────────────────────

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

  // ── Send email ────────────────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Usuarios registrados</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} usuario{total !== 1 ? 's' : ''} en total</p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, correo o país…"
              className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button type="submit" className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            Buscar
          </button>
          {query && (
            <button type="button" onClick={() => { setSearch(''); setQuery(''); setPage(0) }}
              className="p-2 text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-400">Cargando…</div>
      ) : users.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>{query ? 'Sin resultados para esa búsqueda.' : 'Aún no hay usuarios registrados.'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">Usuario</th>
                <th className="text-left px-4 py-3 font-semibold">País</th>
                <th className="text-left px-4 py-3 font-semibold">Teléfono</th>
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
                        <p className="font-medium text-slate-800">{u.name || <span className="text-slate-400 italic">Sin nombre</span>}</p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">{u.country || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3.5 text-slate-600">{u.phone || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3.5 text-slate-400 text-xs">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString('es-PE') : '—'}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openDetail(u)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 transition-colors"
                        title="Ver perfil completo"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Perfil
                      </button>
                      <button
                        onClick={() => openEmail(u)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 transition-colors"
                        title="Enviar correo"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Enviar
                      </button>
                      <button onClick={() => openEdit(u)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors" title="Editar">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteTarget(u)}
                        className="p-1.5 text-slate-400 hover:text-red-600 transition-colors" title="Eliminar">
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => p - 1)} disabled={page === 0}
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors">
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
                  <span key={`e${i}`} className="px-1">…</span>
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
                )
              )}
            <button
              onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Edit modal ─────────────────────────────────────────────────────────── */}
      {editModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Editar usuario</h2>
              <button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {[
              { label: 'Nombre', field: 'name', icon: User, placeholder: 'Nombre del usuario' },
              { label: 'Correo electrónico', field: 'email', icon: Mail, placeholder: 'correo@ejemplo.com' },
              { label: 'País', field: 'country', icon: Globe, placeholder: 'Ej: Perú' },
              { label: 'Teléfono', field: 'phone', icon: Phone, placeholder: '+51 999 999 999' },
            ].map(({ label, field, icon: Icon, placeholder }) => (
              <div key={field}>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">{label}</label>
                <div className="relative">
                  <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={(editForm as Record<string, string>)[field]}
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
              <button onClick={() => setEditModal(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancelar</button>
              <button
                onClick={handleEditSave}
                disabled={editSaving || !editForm.email.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {editSaving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ────────────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Eliminar usuario</h2>
            <p className="text-sm text-slate-600">
              ¿Eliminar a <span className="font-medium">{deleteTarget.name || deleteTarget.email}</span>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancelar</button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── User detail modal ─────────────────────────────────────────────────── */}
      {(detailLoading || detailProfile) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600">
                  {detailProfile ? (detailProfile.user.name || detailProfile.user.email).charAt(0).toUpperCase() : '…'}
                </div>
                <div>
                  <h2 className="font-bold text-slate-800 text-base">
                    {detailProfile?.user.name || <span className="text-slate-400 italic">Sin nombre</span>}
                  </h2>
                  <p className="text-xs text-slate-400">{detailProfile?.user.email}</p>
                </div>
              </div>
              <button onClick={() => setDetailProfile(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center py-24 text-slate-400">
                <div className="w-8 h-8 border-4 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            ) : detailProfile && (
              <div className="overflow-y-auto flex-1 p-6 space-y-6">

                {/* Basic info */}
                <section>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Información del usuario</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { icon: Mail, label: 'Correo', value: detailProfile.user.email },
                      { icon: User, label: 'Nombre', value: detailProfile.user.name || '—' },
                      { icon: Globe, label: 'País', value: detailProfile.user.country || '—' },
                      { icon: Phone, label: 'Teléfono', value: detailProfile.user.phone || '—' },
                    ].map(({ icon: Icon, label, value }) => (
                      <div key={label} className="flex items-start gap-2.5 bg-slate-50 rounded-xl p-3">
                        <Icon className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
                          <p className="text-sm text-slate-700 font-medium break-all">{value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Preferences */}
                <section>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Preferencias detectadas</h3>
                  {detailProfile.preferences ? (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {detailProfile.preferences.location && (
                          <span className="flex items-center gap-1.5 text-xs font-medium bg-white border border-indigo-200 text-indigo-700 px-3 py-1.5 rounded-full">
                            <MapPin className="w-3 h-3" />{detailProfile.preferences.location}
                          </span>
                        )}
                        {detailProfile.preferences.bedrooms && (
                          <span className="flex items-center gap-1.5 text-xs font-medium bg-white border border-indigo-200 text-indigo-700 px-3 py-1.5 rounded-full">
                            <BedDouble className="w-3 h-3" />{detailProfile.preferences.bedrooms} dormitorio{detailProfile.preferences.bedrooms !== 1 ? 's' : ''}
                          </span>
                        )}
                        {detailProfile.preferences.min_price && (
                          <span className="text-xs font-medium bg-white border border-indigo-200 text-indigo-700 px-3 py-1.5 rounded-full">
                            Desde S/ {detailProfile.preferences.min_price.toLocaleString()}
                          </span>
                        )}
                        {detailProfile.preferences.max_price && (
                          <span className="text-xs font-medium bg-white border border-indigo-200 text-indigo-700 px-3 py-1.5 rounded-full">
                            Hasta S/ {detailProfile.preferences.max_price.toLocaleString()}
                          </span>
                        )}
                        {(detailProfile.preferences.keywords || []).map(k => (
                          <span key={k} className="flex items-center gap-1 text-xs bg-white border border-slate-200 text-slate-600 px-2.5 py-1.5 rounded-full">
                            <Tag className="w-3 h-3" />{k}
                          </span>
                        ))}
                      </div>
                      {detailProfile.preferences.raw_description && (
                        <div className="mt-2">
                          <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide mb-1">Descripción original</p>
                          <p className="text-sm text-slate-600 italic leading-relaxed">"{detailProfile.preferences.raw_description}"</p>
                        </div>
                      )}
                      {detailProfile.preferences.updated_at && (
                        <p className="text-[10px] text-indigo-300 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Actualizado: {new Date(detailProfile.preferences.updated_at).toLocaleString('es-PE')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400 italic">Sin preferencias registradas aún.</p>
                  )}
                </section>

                {/* Search history */}
                {detailProfile.search_history.length > 0 && (
                  <section>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Historial de búsquedas</h3>
                    <div className="space-y-2">
                      {detailProfile.search_history.map(h => (
                        <div key={h.id} className="flex items-start gap-3 bg-slate-50 rounded-xl px-4 py-3">
                          <MessageSquare className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            {h.query && <p className="text-sm text-slate-700 truncate">"{h.query}"</p>}
                            {h.location && <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" />{h.location}</p>}
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${h.source === 'chatbot' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                              {h.source === 'chatbot' ? 'Chat' : 'Portal'}
                            </span>
                            {h.created_at && (
                              <span className="text-[10px] text-slate-300">
                                {new Date(h.created_at).toLocaleDateString('es-PE')}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Interactions / ratings */}
                {detailProfile.interactions.filter(i => i.rating !== null || i.interested).length > 0 && (
                  <section>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Propiedades calificadas</h3>
                    <div className="space-y-2">
                      {detailProfile.interactions.filter(i => i.rating !== null || i.interested).map(i => (
                        <div key={i.record_id} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-400 font-mono truncate">{i.record_id}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {i.interested && (
                              <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full">Interesado</span>
                            )}
                            {i.rating !== null && (
                              <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600">
                                <Star className="w-3 h-3 fill-amber-400 stroke-amber-400" />
                                {i.rating}/5
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Send email modal ──────────────────────────────────────────────────── */}
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
              Para: <span className="font-medium text-slate-700">{emailTarget.name || emailTarget.email}</span>
              {' '}<span className="text-slate-400">({emailTarget.email})</span>
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
                placeholder="Escribe el contenido del correo…"
                rows={5}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEmailTarget(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancelar</button>
              <button
                onClick={handleSendEmail}
                disabled={sending || !emailBody.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
                {sending ? 'Enviando…' : 'Enviar correo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
