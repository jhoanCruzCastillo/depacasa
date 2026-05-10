import { useState, useEffect } from 'react'
import { MessageSquare, Send, ChevronDown, ChevronUp, Phone, Plus, Pencil, Trash2 } from 'lucide-react'
import {
  getChatUsers, getChatUser, createChatUser, updateChatUser,
  deleteChatUser, sendChatMessage,
} from '../../services/api'

interface ChatUser {
  id: string
  phone_number: string
  name: string | null
  profile: Record<string, unknown>
  created_at: string
  updated_at: string | null
  conversation_state: string | null
  last_message: { content: string; direction: string; created_at: string } | null
}

interface Conversation {
  id: string
  state: string
  ideal_description: string | null
  created_at: string
  messages: { direction: string; content: string; created_at: string }[]
}

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  greeting: { label: 'Saludando', color: 'bg-blue-100 text-blue-700' },
  presenting: { label: 'Presentando', color: 'bg-violet-100 text-violet-700' },
  contact_requested: { label: 'Contacto solicitado', color: 'bg-green-100 text-green-700' },
}

const emptyForm = { phone_number: '', name: '' }

export default function ChatUsersPage() {
  const [users, setUsers] = useState<ChatUser[]>([])
  const [loading, setLoading] = useState(true)

  // Expand conversation
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ id: string; conversations: Conversation[] } | null>(null)

  // Create/Edit modal
  const [userModal, setUserModal] = useState<{ open: boolean; editing: ChatUser | null }>({ open: false, editing: null })
  const [userForm, setUserForm] = useState({ ...emptyForm })
  const [userSaving, setUserSaving] = useState(false)
  const [userError, setUserError] = useState('')

  // Send message modal
  const [sendModal, setSendModal] = useState<ChatUser | null>(null)
  const [sendText, setSendText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await getChatUsers({ limit: 100 })
      setUsers(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleExpand = async (user: ChatUser) => {
    if (expanded === user.id) { setExpanded(null); setDetail(null); return }
    setExpanded(user.id)
    const res = await getChatUser(user.id)
    setDetail(res.data)
  }

  const openCreate = () => {
    setUserForm({ ...emptyForm })
    setUserError('')
    setUserModal({ open: true, editing: null })
  }

  const openEdit = (user: ChatUser) => {
    setUserForm({ phone_number: user.phone_number, name: user.name || '' })
    setUserError('')
    setUserModal({ open: true, editing: user })
  }

  const normalizePhone = (raw: string) => {
    const t = raw.trim()
    if (!t) return t
    // Auto-add whatsapp: prefix if missing
    if (!t.startsWith('whatsapp:')) return `whatsapp:${t}`
    return t
  }

  const handleUserSave = async () => {
    if (!userForm.phone_number.trim()) { setUserError('El número es requerido'); return }
    setUserSaving(true)
    setUserError('')
    try {
      const payload = { phone_number: normalizePhone(userForm.phone_number), name: userForm.name.trim() || undefined }
      if (userModal.editing) await updateChatUser(userModal.editing.id, payload)
      else await createChatUser(payload)
      setUserModal({ open: false, editing: null })
      load()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setUserError(msg || 'Error al guardar el usuario')
    } finally {
      setUserSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    await deleteChatUser(deleteId)
    setDeleteId(null)
    if (expanded === deleteId) { setExpanded(null); setDetail(null) }
    load()
  }

  const handleSend = async () => {
    if (!sendModal || !sendText.trim()) return
    setSending(true)
    setSendError('')
    try {
      await sendChatMessage(sendModal.id, sendText.trim())
      setSendModal(null)
      setSendText('')
      load()
    } catch {
      setSendError('Error al enviar. Verifica la configuración de Twilio.')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Cargando usuarios...</div>

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Usuarios de WhatsApp</h1>
          <p className="text-sm text-slate-500 mt-1">{users.length} usuario{users.length !== 1 ? 's' : ''} registrado{users.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Agregar usuario
        </button>
      </div>

      {users.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Aún no hay usuarios. Agrégalos manualmente o aparecerán cuando envíen un mensaje al chatbot.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map(user => {
            const stateInfo = user.conversation_state ? STATE_LABELS[user.conversation_state] : null
            const isExpanded = expanded === user.id
            const userDetail = isExpanded ? detail : null

            return (
              <div key={user.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Phone className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800">{user.name || user.phone_number}</span>
                      {user.name && <span className="text-xs text-slate-400">{user.phone_number}</span>}
                      {stateInfo && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stateInfo.color}`}>
                          {stateInfo.label}
                        </span>
                      )}
                    </div>
                    {user.last_message && (
                      <p className="text-sm text-slate-500 truncate mt-0.5">
                        {user.last_message.direction === 'outbound' ? '↑ ' : '↓ '}
                        {user.last_message.content}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-xs text-slate-400 mr-1">
                      {new Date(user.created_at).toLocaleDateString('es-PE')}
                    </span>
                    <button
                      onClick={() => { setSendModal(user); setSendText(''); setSendError('') }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 transition-colors"
                      title="Enviar mensaje"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Enviar
                    </button>
                    <button onClick={() => openEdit(user)} className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors" title="Editar">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => setDeleteId(user.id)} className="p-1.5 text-slate-400 hover:text-red-600 transition-colors" title="Eliminar">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleExpand(user)} className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {isExpanded && userDetail && (
                  <div className="border-t border-slate-100 px-5 py-4 bg-slate-50 space-y-4">
                    <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">Historial de conversaciones</div>
                    {userDetail.conversations.length === 0 ? (
                      <p className="text-sm text-slate-400">Sin conversaciones aún.</p>
                    ) : (
                      userDetail.conversations.map(conv => (
                        <div key={conv.id} className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span className={`px-2 py-0.5 rounded-full font-medium ${STATE_LABELS[conv.state]?.color || 'bg-slate-100 text-slate-600'}`}>
                              {STATE_LABELS[conv.state]?.label || conv.state}
                            </span>
                            <span>{new Date(conv.created_at).toLocaleString('es-PE')}</span>
                          </div>
                          {conv.ideal_description && (
                            <p className="text-sm text-slate-600 italic">"{conv.ideal_description}"</p>
                          )}
                          <div className="space-y-2 max-h-60 overflow-y-auto">
                            {conv.messages.map((msg, i) => (
                              <div key={i} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-xs px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
                                  msg.direction === 'outbound'
                                    ? 'bg-green-500 text-white rounded-br-sm'
                                    : 'bg-slate-100 text-slate-700 rounded-bl-sm'
                                }`}>
                                  {msg.content}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create / Edit user modal */}
      {userModal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">
              {userModal.editing ? 'Editar usuario' : 'Agregar usuario'}
            </h2>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Número de WhatsApp <span className="text-red-500">*</span>
              </label>
              <input
                value={userForm.phone_number}
                onChange={e => setUserForm(f => ({ ...f, phone_number: e.target.value }))}
                placeholder="whatsapp:+51980490696"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">Formato: whatsapp:+51XXXXXXXXX</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nombre (opcional)</label>
              <input
                value={userForm.name}
                onChange={e => setUserForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Nombre del contacto"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {userError && <p className="text-sm text-red-500">{userError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setUserModal({ open: false, editing: null })}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleUserSave}
                disabled={userSaving || !userForm.phone_number.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {userSaving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send message modal */}
      {sendModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Enviar mensaje</h2>
            <p className="text-sm text-slate-500">
              Para: <span className="font-medium text-slate-700">{sendModal.name || sendModal.phone_number}</span>
            </p>
            <textarea
              value={sendText}
              onChange={e => setSendText(e.target.value)}
              placeholder="Escribe tu mensaje aquí..."
              rows={4}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            {sendError && <p className="text-sm text-red-500">{sendError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setSendModal(null); setSendText(''); setSendError('') }}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !sendText.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
                {sending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Eliminar usuario</h2>
            <p className="text-sm text-slate-600">¿Estás seguro? Se eliminará el usuario y todo su historial.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm text-slate-600">Cancelar</button>
              <button onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
