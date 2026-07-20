import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faXmark, faSpinner, faGlobe, faCheck,
} from '@fortawesome/free-solid-svg-icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ScrapedRecord, PropiedadStatus } from '../../../types'
import { updatePropiedad } from '../../../services/api'
import { extractTitle, extractPropId, propiedadStatusClass, recordStatusLabel } from '../helpers/extractors'

interface Props {
  record: ScrapedRecord | null
  open: boolean
  developerId: string
  onClose: () => void
}

const STATUS_FLOW: Record<PropiedadStatus, { label: string; next: PropiedadStatus; btnLabel: string; btnClass: string } | null> = {
  pending_review: { label: 'Pendiente de revisión', next: 'public', btnLabel: 'Publicar en portal', btnClass: 'bg-blue-600 hover:bg-blue-700 text-white' },
  success:        { label: 'Pendiente de revisión', next: 'public', btnLabel: 'Publicar en portal', btnClass: 'bg-blue-600 hover:bg-blue-700 text-white' },
  public:         { label: 'Público',               next: 'pending_review', btnLabel: 'Quitar del portal', btnClass: 'bg-amber-500 hover:bg-amber-600 text-white' },
  partial:        { label: 'Parcial',               next: 'public', btnLabel: 'Publicar en portal', btnClass: 'bg-blue-600 hover:bg-blue-700 text-white' },
  failed:         null,
}

export default function PropertyEditModal({ record, open, developerId, onClose }: Props) {
  const queryClient = useQueryClient()

  const d = record?.data || {}
  const [form, setForm] = useState({
    modelo:      '',
    dormitorios: '',
    baños:       '',
    m2:          '',
  })
  const [currentStatus, setCurrentStatus] = useState<PropiedadStatus>('pending_review')

  useEffect(() => {
    if (!record) return
    setForm({
      modelo:      String(d.modelo      ?? ''),
      dormitorios: String(d.dormitorios ?? ''),
      baños:       String(d.baños       ?? ''),
      m2:          String(d.m2          ?? ''),
    })
    setCurrentStatus((record.status || 'pending_review') as PropiedadStatus)
  }, [record?.id])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  const saveMut = useMutation({
    mutationFn: (data: Parameters<typeof updatePropiedad>[1]) =>
      updatePropiedad(record!.id, data).then(r => r.data),
    onSuccess: (updated) => {
      setCurrentStatus(updated.status as PropiedadStatus)
      queryClient.invalidateQueries({ queryKey: ['records', developerId] })
      toast.success('Propiedad actualizada')
    },
    onError: () => toast.error('Error al guardar'),
  })

  const handleSave = () => {
    saveMut.mutate({
      modelo:      form.modelo      || undefined,
      dormitorios: form.dormitorios || undefined,
      baños:       form.baños       || undefined,
      m2:          form.m2          || undefined,
    })
  }

  const handleStatusChange = () => {
    const flow = STATUS_FLOW[currentStatus]
    if (!flow) return
    saveMut.mutate({ status: flow.next }, {
      onSuccess: (updated) => {
        setCurrentStatus(updated.status as PropiedadStatus)
        toast.success(flow.next === 'public' ? 'Publicado en el portal' : 'Quitado del portal')
      },
    })
  }

  if (!record) return null

  const title  = extractTitle(d)
  const propId = extractPropId(d, record.id)
  const flow   = STATUS_FLOW[currentStatus]
  const url    = d.url_propiedad || d.url || d.link || null

  const field = (
    label: string,
    key: keyof typeof form,
    type: 'text' | 'number' = 'text',
    placeholder = ''
  ) => (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col"
            style={{ maxHeight: '90vh' }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-gray-900 text-base leading-snug truncate">{title}</h2>
                <p className="text-xs text-gray-400 font-mono mt-0.5">{propId}</p>
              </div>
              <button onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition text-gray-400 hover:text-gray-600 flex-shrink-0">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            {/* Status bar */}
            <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 flex-shrink-0">
              <span className="text-xs text-gray-500">Estado actual:</span>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${propiedadStatusClass(currentStatus)}`}>
                {recordStatusLabel(currentStatus)}
              </span>
              {flow && (
                <button
                  onClick={handleStatusChange}
                  disabled={saveMut.isPending}
                  className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-50 ${flow.btnClass}`}
                >
                  {saveMut.isPending
                    ? <FontAwesomeIcon icon={faSpinner} className="animate-spin" />
                    : <FontAwesomeIcon icon={faCheck} />
                  }
                  {flow.btnLabel}
                </button>
              )}
            </div>

            {/* Form */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              {field('Modelo / Descripción', 'modelo', 'text', 'Ej: TIPO 1 / 59 m2 / 1 dorm / 2 baños')}
              <div className="grid grid-cols-3 gap-3">
                {field('Dormitorios', 'dormitorios', 'number', '0')}
                {field('Baños', 'baños', 'number', '0')}
                {field('Área (m²)', 'm2', 'number', '0')}
              </div>
              {url && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">URL de la propiedad</p>
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline truncate">
                    <FontAwesomeIcon icon={faGlobe} className="text-[10px] flex-shrink-0" />
                    {url}
                  </a>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 flex-shrink-0">
              <button onClick={onClose}
                className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saveMut.isPending}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {saveMut.isPending && <FontAwesomeIcon icon={faSpinner} className="animate-spin text-xs" />}
                Guardar cambios
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
