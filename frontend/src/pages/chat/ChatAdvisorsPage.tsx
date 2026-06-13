import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Users, Eye, KeyRound, X, Mail, Send, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import API from '../../services/api'
import {
  getChatAdvisors,
  getChatAdvisorClients,
  createChatAdvisor,
  updateChatAdvisor,
  deleteChatAdvisor,
  getDevelopers,
} from '../../services/api'

interface Developer { id: string; name: string }

interface Advisor {
  id: string
  name: string
  phone: string | null
  email: string | null
  whatsapp_number: string | null
  is_active: boolean
  developer_id: string | null
  developer_name: string | null
  created_at: string
  assigned_clients_count?: number
}

interface AdvisorClient {
  session_id: string
  site_user_id: string | null
  full_name: string | null
  email: string | null
  whatsapp: string | null
  country_of_residence: string | null
  document_number: string | null
  rating: number | null
  assigned_at: string | null
  notified_at: string | null
  profiling: Record<string, unknown>
  property: {
    record_id: string | null
    source_url: string | null
    title: string | null
    location: string | null
    price: string | null
  }
}

const EMPTY = { name: '', phone: '', email: '', whatsapp_number: '', is_active: true, developer_id: '' }

export default function ChatAdvisorsPage() {
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [loading, setLoading] = useState(true)
  const [developers, setDevelopers] = useState<Developer[]>([])
  const [modal, setModal] = useState<{ open: boolean; editing: Advisor | null }>({ open: false, editing: null })
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [clientsAdvisor, setClientsAdvisor] = useState<Advisor | null>(null)
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clients, setClients] = useState<AdvisorClient[]>([])

  const [pwdAdvisor, setPwdAdvisor] = useState<Advisor | null>(null)
  const [pwdValue, setPwdValue] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)

  const [emailTarget, setEmailTarget] = useState<Advisor | null>(null)
  const [emailSubject, setEmailSubject] = useState('Novedades del portal')
  const [emailBody, setEmailBody] = useState('')
  const [emailSending, setEmailSending] = useState(false)

  const load = async () => {
    try {
      const res = await getChatAdvisors()
      setAdvisors(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    getDevelopers().then(r => setDevelopers(r.data ?? [])).catch(() => {})
  }, [])

  const openCreate = () => { setForm({ ...EMPTY }); setModal({ open: true, editing: null }) }
  const openEdit = (a: Advisor) => {
    setForm({
      name: a.name,
      phone: a.phone || '',
      email: a.email || '',
      whatsapp_number: a.whatsapp_number || '',
      is_active: a.is_active,
      developer_id: a.developer_id || '',
    })
    setModal({ open: true, editing: a })
  }

  const openClients = async (advisor: Advisor) => {
    setClientsAdvisor(advisor)
    setClientsLoading(true)
    setClients([])
    try {
      const res = await getChatAdvisorClients(advisor.id)
      setClients(res.data.clients || [])
    } finally {
      setClientsLoading(false)
    }
  }

  const closeClients = () => {
    setClientsAdvisor(null)
    setClients([])
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = {
      name: form.name,
      phone: form.phone || undefined,
      email: form.email || undefined,
      whatsapp_number: form.whatsapp_number || undefined,
      is_active: form.is_active,
      developer_id: form.developer_id || null,
    }
    try {
      if (modal.editing) await updateChatAdvisor(modal.editing.id, payload)
      else await createChatAdvisor(payload)
      setModal({ open: false, editing: null })
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    await deleteChatAdvisor(deleteId)
    setDeleteId(null)
    load()
  }

  const handleSetPassword = async () => {
    if (!pwdAdvisor || pwdValue.length < 6) return
    setPwdSaving(true)
    try {
      await API.patch(`/chat/advisors/${pwdAdvisor.id}/set-password`, { password: pwdValue })
      toast.success('Contraseña establecida')
      setPwdAdvisor(null)
      setPwdValue('')
    } catch {
      toast.error('Error al establecer la contraseña')
    } finally {
      setPwdSaving(false)
    }
  }

  const openEmail = (a: Advisor) => {
    setEmailTarget(a)
    setEmailSubject('Novedades del portal')
    setEmailBody('')
  }

  const handleSendEmail = async () => {
    if (!emailTarget || !emailBody.trim()) return
    setEmailSending(true)
    try {
      await API.post(`/chat/advisors/${emailTarget.id}/send-email`, {
        subject: emailSubject.trim(),
        body: emailBody.trim(),
      })
      toast.success(`Correo enviado a ${emailTarget.email}`)
      setEmailTarget(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Error al enviar el correo')
    } finally {
      setEmailSending(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Cargando asesores...</div>

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Asesores de Venta</h1>
          <p className="text-sm text-slate-500 mt-1">{advisors.length} asesor{advisors.length !== 1 ? 'es' : ''}</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuevo asesor
        </button>
      </div>

      {advisors.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No hay asesores registrados.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-5 py-3 font-medium text-slate-600">Nombre</th>
                <th className="text-left px-5 py-3 font-medium text-slate-600">Telefono</th>
                <th className="text-left px-5 py-3 font-medium text-slate-600">Email</th>
                <th className="text-left px-5 py-3 font-medium text-slate-600">WhatsApp</th>
                <th className="text-left px-5 py-3 font-medium text-slate-600">Estado</th>
                <th className="text-left px-5 py-3 font-medium text-slate-600">Clientes</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {advisors.map(a => (
                <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-800">{a.name}</td>
                  <td className="px-5 py-3 text-slate-500">{a.phone || '-'}</td>
                  <td className="px-5 py-3 text-slate-500">{a.email || '-'}</td>
                  <td className="px-5 py-3 text-slate-500">{a.whatsapp_number || '-'}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {a.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => openClients(a)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {a.assigned_clients_count ?? 0}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => openEmail(a)}
                        disabled={!a.email}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        title={a.email ? 'Enviar correo' : 'Sin correo registrado'}
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Enviar
                      </button>
                      <button
                        onClick={() => { setPwdAdvisor(a); setPwdValue('') }}
                        className="p-1.5 text-slate-400 hover:text-amber-600 transition-colors"
                        title="Establecer contraseña"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button onClick={() => openEdit(a)} className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteId(a.id)} className="p-1.5 text-slate-400 hover:text-red-600 transition-colors">
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

      {modal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">{modal.editing ? 'Editar asesor' : 'Nuevo asesor'}</h2>
            {(['name', 'phone', 'email', 'whatsapp_number'] as const).map(field => (
              <div key={field}>
                <label className="block text-xs font-medium text-slate-600 mb-1 capitalize">
                  {field === 'whatsapp_number' ? 'WhatsApp (ej: whatsapp:+51...)' : field}
                  {field === 'name' && ' *'}
                </label>
                <input
                  value={form[field]}
                  onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
            {/* Developer select */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Desarrolladora</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <select
                  value={form.developer_id}
                  onChange={e => setForm(f => ({ ...f, developer_id: e.target.value }))}
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white appearance-none"
                >
                  <option value="">— Sin desarrolladora —</option>
                  {developers.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm text-slate-700">Activo</span>
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setModal({ open: false, editing: null })} className="px-4 py-2 text-sm text-slate-600">Cancelar</button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Eliminar asesor</h2>
            <p className="text-sm text-slate-600">Estas seguro? Esta accion no se puede deshacer.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm text-slate-600">Cancelar</button>
              <button onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors">Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {clientsAdvisor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Clientes asignados a {clientsAdvisor.name}</h2>
                <p className="text-sm text-slate-500">{clients.length} cliente{clients.length !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={closeClients} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                Cerrar
              </button>
            </div>

            <div className="p-6 overflow-auto max-h-[calc(85vh-80px)]">
              {clientsLoading ? (
                <div className="text-center py-16 text-slate-400">Cargando clientes...</div>
              ) : clients.length === 0 ? (
                <div className="text-center py-16 text-slate-400">Este asesor aun no tiene clientes asignados.</div>
              ) : (
                <div className="space-y-4">
                  {clients.map(c => (
                    <div key={c.session_id} className="border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <p><span className="text-slate-500">Nombre:</span> <span className="text-slate-800 font-medium">{c.full_name || '-'}</span></p>
                        <p><span className="text-slate-500">Email:</span> <span className="text-slate-800">{c.email || '-'}</span></p>
                        <p><span className="text-slate-500">WhatsApp:</span> <span className="text-slate-800">{c.whatsapp || '-'}</span></p>
                        <p><span className="text-slate-500">Pais:</span> <span className="text-slate-800">{c.country_of_residence || '-'}</span></p>
                        <p><span className="text-slate-500">Documento:</span> <span className="text-slate-800">{c.document_number || '-'}</span></p>
                        <p><span className="text-slate-500">Rating:</span> <span className="text-slate-800">{c.rating ?? '-'}</span></p>
                      </div>

                      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
                        <p className="font-semibold text-slate-700">Propiedad de interes</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                          <p><span className="text-slate-500">Titulo:</span> <span className="text-slate-800">{c.property.title || '-'}</span></p>
                          <p><span className="text-slate-500">Ubicacion:</span> <span className="text-slate-800">{c.property.location || '-'}</span></p>
                          <p><span className="text-slate-500">Precio:</span> <span className="text-slate-800">{c.property.price || '-'}</span></p>
                          <p><span className="text-slate-500">Record ID:</span> <span className="text-slate-800 break-all">{c.property.record_id || '-'}</span></p>
                          <p className="md:col-span-2"><span className="text-slate-500">URL:</span> <span className="text-slate-800 break-all">{c.property.source_url || '-'}</span></p>
                        </div>
                      </div>

                      <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm">
                        <p className="font-semibold text-blue-800">Perfilamiento</p>
                        <pre className="mt-2 text-xs text-blue-900 whitespace-pre-wrap overflow-x-auto">
                          {JSON.stringify(c.profiling || {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Send email modal */}
      {emailTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Enviar correo</h2>
              <button onClick={() => setEmailTarget(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-500">
              Para: <span className="font-medium text-slate-700">{emailTarget.name}</span>{' '}
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
              <button onClick={() => setEmailTarget(null)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
                Cancelar
              </button>
              <button
                onClick={handleSendEmail}
                disabled={emailSending || !emailBody.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
                {emailSending ? 'Enviando...' : 'Enviar correo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set password modal */}
      {pwdAdvisor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-800">Establecer contraseña</h2>
                <p className="text-xs text-slate-400 mt-0.5">{pwdAdvisor.name}</p>
              </div>
              <button onClick={() => setPwdAdvisor(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Nueva contraseña</label>
              <input
                type="password"
                value={pwdValue}
                onChange={e => setPwdValue(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              {pwdValue.length > 0 && pwdValue.length < 6 && (
                <p className="text-xs text-red-500 mt-1">Mínimo 6 caracteres</p>
              )}
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setPwdAdvisor(null)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
                Cancelar
              </button>
              <button
                onClick={handleSetPassword}
                disabled={pwdSaving || pwdValue.length < 6}
                className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {pwdSaving ? 'Guardando...' : 'Guardar contraseña'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
