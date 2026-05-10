import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useDevelopers, useCreateDeveloper, useDeleteDeveloper } from '../hooks/useDevelopers'
import { Developer, ScrapeJob } from '../types'
import { Plus, Search, Trash2, Loader2, Building2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../components/ui/Modal'
import DeveloperCard from '../components/DeveloperCard'

const PAGE_SIZE = 12

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 animate-pulse">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-gray-200 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
      <div className="space-y-1.5 mb-3">
        <div className="h-3 bg-gray-100 rounded w-full" />
        <div className="h-3 bg-gray-100 rounded w-5/6" />
      </div>
      <div className="flex gap-1.5 mb-4">
        <div className="h-5 w-14 bg-gray-100 rounded-full" />
        <div className="h-5 w-20 bg-gray-100 rounded-full" />
        <div className="h-5 w-16 bg-gray-100 rounded-full" />
      </div>
      <div className="h-10 bg-gray-200 rounded-xl" />
    </div>
  )
}


export default function DevelopersPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ name: '', description: '', base_url: '' })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const { data: developers = [], isLoading, error } = useDevelopers()
  const createMutation = useCreateDeveloper()
  const deleteMutation = useDeleteDeveloper()
  const queryClient = useQueryClient()

  const filtered = developers.filter((d: Developer) =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    (d.description || '').toLowerCase().includes(search.toLowerCase()) ||
    d.base_url.toLowerCase().includes(search.toLowerCase())
  )
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handleSearch = useCallback((v: string) => { setSearch(v); setPage(0) }, [])

  const validate = () => {
    const errors: Record<string, string> = {}
    if (!formData.name.trim()) errors.name = 'El nombre es requerido'
    if (!formData.base_url.trim()) errors.base_url = 'La URL es requerida'
    else if (!/^https?:\/\//i.test(formData.base_url)) errors.base_url = 'Ingresa una URL válida (https://...)'
    return errors
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errors = validate()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    try {
      await createMutation.mutateAsync({ ...formData, source: 'manual' })
      setFormData({ name: '', description: '', base_url: '' })
      setFormErrors({})
      setShowForm(false)
      toast.success('Desarrolladora agregada correctamente')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al crear desarrolladora')
    }
  }

  const handleDelete = async (dev: Developer) => {
    if (!confirm(`¿Eliminar "${dev.name}"? Esta acción no se puede deshacer.`)) return
    try {
      await deleteMutation.mutateAsync(dev.id)
      toast.success('Desarrolladora eliminada')
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const closeModal = () => {
    setShowForm(false)
    setFormData({ name: '', description: '', base_url: '' })
    setFormErrors({})
  }

  // Get last job per developer from cache
  const getLastJob = (devId: string): ScrapeJob | null => {
    const jobs: ScrapeJob[] = queryClient.getQueryData(['jobs', devId]) ?? []
    return jobs[0] ?? null
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Desarrolladoras</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              {developers.length} plataformas
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Plataformas inmobiliarias registradas en el sistema.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nueva
        </button>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar desarrolladora..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
          />
          {search && (
            <button
              onClick={() => handleSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {search && (
          <span className="text-sm text-gray-500">
            {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <span>Error al cargar desarrolladoras. Verifica que el backend esté corriendo.</span>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['developers'] })}
            className="ml-auto underline hover:no-underline flex-shrink-0"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : paginated.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <Building2 className="w-7 h-7 text-gray-400" />
          </div>
          <p className="font-semibold text-gray-700 mb-1">
            {search ? `Sin resultados para "${search}"` : 'No hay desarrolladoras registradas'}
          </p>
          <p className="text-sm text-gray-400 mb-5">
            {search
              ? 'Intenta con otro término de búsqueda.'
              : 'Comienza buscando plataformas inmobiliarias con Tavily o agrégalas manualmente.'}
          </p>
          {!search && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Agregar manualmente
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {paginated.map((dev: Developer) => (
              <div key={dev.id} className="relative group">
                <DeveloperCard
                  dev={dev}
                  href={`/developers/${dev.id}`}
                  lastJob={getLastJob(dev.id)}
                />
                <button
                  onClick={() => handleDelete(dev)}
                  className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                  title="Eliminar"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Pagination + info */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-gray-500">
                Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} de {filtered.length} resultados
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Anterior
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => {
                  const idx = totalPages <= 7 ? i : Math.max(0, Math.min(page - 3, totalPages - 7)) + i
                  return (
                    <button
                      key={idx}
                      onClick={() => setPage(idx)}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition ${
                        page === idx
                          ? 'bg-blue-600 text-white'
                          : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  )
                })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page === totalPages - 1}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create Modal */}
      <Modal open={showForm} onClose={closeModal} title="Agregar Desarrolladora">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={e => { setFormData(f => ({ ...f, name: e.target.value })); setFormErrors(er => ({ ...er, name: '' })) }}
              placeholder="Ej: Nexo Inmobiliaria"
              className={`w-full border rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                formErrors.name ? 'border-red-300 bg-red-50' : 'border-gray-200'
              }`}
            />
            {formErrors.name && <p className="mt-1 text-xs text-red-600">{formErrors.name}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              URL Base <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.base_url}
              onChange={e => { setFormData(f => ({ ...f, base_url: e.target.value })); setFormErrors(er => ({ ...er, base_url: '' })) }}
              onBlur={e => {
                if (e.target.value && !/^https?:\/\//i.test(e.target.value)) {
                  setFormData(f => ({ ...f, base_url: 'https://' + f.base_url }))
                }
              }}
              placeholder="https://www.ejemplo.com"
              className={`w-full border rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                formErrors.base_url ? 'border-red-300 bg-red-50' : 'border-gray-200'
              }`}
            />
            {formErrors.base_url && <p className="mt-1 text-xs text-red-600">{formErrors.base_url}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción</label>
            <textarea
              value={formData.description}
              onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe brevemente esta plataforma..."
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              rows={3}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {createMutation.isPending ? 'Agregando...' : 'Agregar →'}
            </button>
            <button
              type="button"
              onClick={closeModal}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
