import { useState, useEffect, useCallback } from 'react'
import {
  Users, Send, Plus, Pencil, Trash2, Search, X,
  ChevronLeft, ChevronRight, Mail, Globe, Phone, User,
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
                        onClick={() => openEmail(u)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 transition-colors"
                        title="Enviar correo de prueba"
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
