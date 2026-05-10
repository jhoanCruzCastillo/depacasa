import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, FileText } from 'lucide-react'
import { getChatTemplates, createChatTemplate, updateChatTemplate, deleteChatTemplate } from '../../services/api'

interface Template {
  id: string
  name: string
  type: string
  content: string
  variables: string[]
  is_active: boolean
  created_at: string
}

const TEMPLATE_TYPES = [
  { value: 'greeting', label: 'Saludo inicial' },
  { value: 'farewell', label: 'Despedida' },
  { value: 'property_card', label: 'Tarjeta de propiedad' },
  { value: 'contact_request', label: 'Solicitud de contacto' },
  { value: 'custom', label: 'Personalizado' },
]

const TYPE_COLORS: Record<string, string> = {
  greeting: 'bg-blue-100 text-blue-700',
  farewell: 'bg-slate-100 text-slate-600',
  property_card: 'bg-violet-100 text-violet-700',
  contact_request: 'bg-green-100 text-green-700',
  custom: 'bg-amber-100 text-amber-700',
}

const EMPTY: Omit<Template, 'id' | 'created_at'> = {
  name: '',
  type: 'greeting',
  content: '',
  variables: [],
  is_active: true,
}

export default function ChatTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ open: boolean; editing: Template | null }>({ open: false, editing: null })
  const [form, setForm] = useState({ ...EMPTY })
  const [varInput, setVarInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await getChatTemplates()
      setTemplates(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setForm({ ...EMPTY })
    setVarInput('')
    setModal({ open: true, editing: null })
  }

  const openEdit = (t: Template) => {
    setForm({ name: t.name, type: t.type, content: t.content, variables: t.variables, is_active: t.is_active })
    setVarInput('')
    setModal({ open: true, editing: t })
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.content.trim()) return
    setSaving(true)
    try {
      if (modal.editing) {
        await updateChatTemplate(modal.editing.id, form)
      } else {
        await createChatTemplate(form)
      }
      setModal({ open: false, editing: null })
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    await deleteChatTemplate(deleteId)
    setDeleteId(null)
    load()
  }

  const addVar = () => {
    const v = varInput.trim().replace(/[{}]/g, '')
    if (v && !form.variables.includes(v)) {
      setForm(f => ({ ...f, variables: [...f.variables, v] }))
    }
    setVarInput('')
  }

  const insertVar = (v: string) => {
    setForm(f => ({ ...f, content: f.content + `{${v}}` }))
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Cargando plantillas...</div>

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Plantillas de Mensajes</h1>
          <p className="text-sm text-slate-500 mt-1">{templates.length} plantilla{templates.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nueva plantilla
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No hay plantillas. Crea una para personalizar los mensajes del chatbot.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="font-semibold text-slate-800">{t.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[t.type] || TYPE_COLORS.custom}`}>
                      {TEMPLATE_TYPES.find(x => x.value === t.type)?.label || t.type}
                    </span>
                    {!t.is_active && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">Inactiva</span>
                    )}
                  </div>
                  {t.variables.length > 0 && (
                    <div className="flex gap-1 flex-wrap mb-2">
                      {t.variables.map(v => (
                        <code key={v} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{`{${v}}`}</code>
                      ))}
                    </div>
                  )}
                  <pre className="text-sm text-slate-600 whitespace-pre-wrap font-sans line-clamp-3 bg-slate-50 rounded-lg p-3">
                    {t.content}
                  </pre>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button onClick={() => openEdit(t)} className="p-2 text-slate-400 hover:text-blue-600 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => setDeleteId(t.id)} className="p-2 text-slate-400 hover:text-red-600 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-800">
              {modal.editing ? 'Editar plantilla' : 'Nueva plantilla'}
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: Saludo de bienvenida"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {TEMPLATE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-sm text-slate-700">Activa</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Variables disponibles</label>
              <div className="flex gap-2 items-center">
                <input
                  value={varInput}
                  onChange={e => setVarInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addVar()}
                  placeholder="nombre_variable"
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={addVar} className="px-3 py-1.5 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200 transition-colors">
                  Agregar
                </button>
              </div>
              {form.variables.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {form.variables.map(v => (
                    <button
                      key={v}
                      onClick={() => insertVar(v)}
                      title="Clic para insertar en el contenido"
                      className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200 hover:bg-blue-100 transition-colors"
                    >
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Contenido del mensaje</label>
              <textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Escribe el mensaje aquí..."
                rows={8}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setModal({ open: false, editing: null })}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.content.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Eliminar plantilla</h2>
            <p className="text-sm text-slate-600">¿Estás seguro? Esta acción no se puede deshacer.</p>
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
