import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useDevelopers, useCreateDeveloper, useDeleteDeveloper, useUpdateDeveloper } from '../hooks/useDevelopers'
import { Developer } from '../types'
import {
  Plus, Search, Loader2, Building2, X, CheckCircle2,
  AlertTriangle, Activity, LayoutGrid, List, ChevronDown,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../components/ui/Modal'
import DeveloperCard from '../components/DeveloperCard'

const PAGE_SIZE = 12

function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false
  return new Date(dateStr).toDateString() === new Date().toDateString()
}

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
      <div className="flex gap-1.5 mb-3">
        <div className="h-5 w-14 bg-gray-100 rounded-full" />
        <div className="h-5 w-16 bg-gray-100 rounded-full" />
      </div>
      <div className="space-y-1.5 mb-4">
        <div className="h-3 bg-gray-100 rounded w-full" />
        <div className="h-3 bg-gray-100 rounded w-5/6" />
      </div>
      <div className="h-10 bg-gray-200 rounded-xl" />
    </div>
  )
}

type ViewMode = 'grid' | 'list'
type SourceFilter = 'all' | 'manual' | 'tavily'
type StatusFilter = 'all' | 'active' | 'error' | 'nodata'
type SortMode = 'recent' | 'name' | 'properties'

function Select({
  label, value, options, onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-3 pr-8 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
    </div>
  )
}

export default function DevelopersPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ name: '', description: '', base_url: '' })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [editDev, setEditDev] = useState<Developer | null>(null)
  const [editData, setEditData] = useState({ name: '', description: '', base_url: '', proyectos_url: '' })
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('recent')

  const { data: developers = [], isLoading, error } = useDevelopers()
  const createMutation = useCreateDeveloper()
  const updateMutation = useUpdateDeveloper()
  const deleteMutation = useDeleteDeveloper()
  const queryClient = useQueryClient()

  // Stats (computed from list)
  const total = developers.length
  const active = developers.filter((d: Developer) => d.last_sync_status === 'completed').length
  const withErrors = developers.filter((d: Developer) => d.last_sync_status === 'failed').length
  const syncedToday = developers.filter(
    (d: Developer) => isToday(d.last_sync_at) && d.last_sync_status === 'completed',
  ).length

  // Filter + sort
  let filtered = developers.filter((d: Developer) => {
    const matchSearch =
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      (d.description || '').toLowerCase().includes(search.toLowerCase()) ||
      d.base_url.toLowerCase().includes(search.toLowerCase())

    const matchSource =
      sourceFilter === 'all' ||
      (sourceFilter === 'manual' && d.source === 'manual') ||
      (sourceFilter === 'tavily' && d.source === 'tavily')

    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && d.last_sync_status === 'completed') ||
      (statusFilter === 'error' && d.last_sync_status === 'failed') ||
      (statusFilter === 'nodata' && !d.last_sync_status)

    return matchSearch && matchSource && matchStatus
  })

  filtered = [...filtered].sort((a: Developer, b: Developer) => {
    if (sortMode === 'name') return a.name.localeCompare(b.name)
    if (sortMode === 'properties') return (b.propiedades_count ?? 0) - (a.propiedades_count ?? 0)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

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

  const openEdit = (dev: Developer) => {
    setEditDev(dev)
    setEditData({
      name: dev.name,
      description: dev.description ?? '',
      base_url: dev.base_url,
      proyectos_url: dev.proyectos_url ?? '',
    })
    setEditErrors({})
  }

  const closeEdit = () => {
    setEditDev(null)
    setEditErrors({})
  }

  const validateEdit = () => {
    const errors: Record<string, string> = {}
    if (!editData.name.trim()) errors.name = 'El nombre es requerido'
    if (!editData.base_url.trim()) errors.base_url = 'La URL es requerida'
    else if (!/^https?:\/\//i.test(editData.base_url)) errors.base_url = 'Ingresa una URL válida (https://...)'
    return errors
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errors = validateEdit()
    if (Object.keys(errors).length) { setEditErrors(errors); return }
    if (!editDev) return
    try {
      await updateMutation.mutateAsync({
        id: editDev.id,
        data: {
          name: editData.name.trim(),
          description: editData.description.trim() || null,
          base_url: editData.base_url.trim(),
          proyectos_url: editData.proyectos_url.trim() || null,
        },
      })
      toast.success('Desarrolladora actualizada')
      closeEdit()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Error al actualizar')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Desarrolladoras</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              {total} plataformas
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

      {/* Stats cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{total}</p>
            <p className="text-xs text-gray-500 mt-0.5">Total desarrolladoras</p>
            <p className="text-[10px] text-gray-400">Plataformas registradas</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600">{active}</p>
            <p className="text-xs text-gray-500 mt-0.5">Activas</p>
            <p className="text-[10px] text-gray-400">Plataformas operativas</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
            <Activity className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-purple-600">{syncedToday}</p>
            <p className="text-xs text-gray-500 mt-0.5">Sincronizadas hoy</p>
            <p className="text-[10px] text-gray-400">Plataformas actualizadas</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-orange-500">{withErrors}</p>
            <p className="text-xs text-gray-500 mt-0.5">Con errores</p>
            <p className="text-[10px] text-gray-400">Requieren atención</p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
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

        {/* Filters */}
        <Select
          label="Fuente"
          value={sourceFilter}
          onChange={v => { setSourceFilter(v as SourceFilter); setPage(0) }}
          options={[
            { value: 'all', label: 'Fuente: Todas' },
            { value: 'manual', label: 'Manual' },
            { value: 'tavily', label: 'Tavily' },
          ]}
        />
        <Select
          label="Estado"
          value={statusFilter}
          onChange={v => { setStatusFilter(v as StatusFilter); setPage(0) }}
          options={[
            { value: 'all', label: 'Estado: Todos' },
            { value: 'active', label: 'Activa' },
            { value: 'error', label: 'Con errores' },
            { value: 'nodata', label: 'Sin datos' },
          ]}
        />
        <Select
          label="Ordenar"
          value={sortMode}
          onChange={v => setSortMode(v as SortMode)}
          options={[
            { value: 'recent', label: '↕ Más recientes' },
            { value: 'name', label: '↕ Nombre A-Z' },
            { value: 'properties', label: '↕ Más propiedades' },
          ]}
        />

        {/* View toggle */}
        <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden ml-auto">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2.5 transition-colors ${viewMode === 'grid' ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2.5 transition-colors border-l border-gray-200 ${viewMode === 'list' ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>

        <span className="text-sm text-gray-500 flex-shrink-0">
          {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
        </span>
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

      {/* Grid / List */}
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
            {search || sourceFilter !== 'all' || statusFilter !== 'all'
              ? 'Sin resultados para los filtros actuales'
              : 'No hay desarrolladoras registradas'}
          </p>
          <p className="text-sm text-gray-400 mb-5">
            {search || sourceFilter !== 'all' || statusFilter !== 'all'
              ? 'Prueba cambiando los filtros.'
              : 'Comienza agregando plataformas inmobiliarias manualmente.'}
          </p>
          {!search && sourceFilter === 'all' && statusFilter === 'all' && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Agregar manualmente
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {paginated.map((dev: Developer) => (
            <DeveloperCard
              key={dev.id}
              dev={dev}
              href={`/developers/${dev.id}`}
              onDelete={() => handleDelete(dev)}
              onEdit={() => openEdit(dev)}
            />
          ))}
        </div>
      ) : (
        /* List view */
        <div className="flex flex-col gap-2">
          {paginated.map((dev: Developer) => (
            <div key={dev.id} className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center gap-4 hover:shadow-sm transition-shadow">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-xs select-none flex-shrink-0 ${
                  ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500'][
                    nameHash(dev.name) % 4
                  ]
                }`}
              >
                {initials(dev.name)}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm text-gray-900">{dev.name}</span>
                {dev.description && (
                  <span className="text-xs text-gray-400 ml-2 truncate hidden sm:inline">{dev.description}</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
                <span>{(dev.proyectos_count ?? 0).toLocaleString()} proyectos</span>
                <span>{(dev.propiedades_count ?? 0).toLocaleString()} props.</span>
              </div>
              {dev.last_sync_status === 'completed' && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 flex-shrink-0">Activa</span>
              )}
              {dev.last_sync_status === 'failed' && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 flex-shrink-0">Error</span>
              )}
              <div className="flex items-center gap-2 flex-shrink-0">
                <a
                  href={`/developers/${dev.id}`}
                  className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Gestionar
                </a>
                <button
                  onClick={() => handleDelete(dev)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-gray-500">
            Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} de {filtered.length}
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

      {/* Edit Modal */}
      <Modal open={!!editDev} onClose={closeEdit} title="Editar información desarrolladora">
        {editDev && (
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Nombre <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={editData.name}
                onChange={e => { setEditData(d => ({ ...d, name: e.target.value })); setEditErrors(er => ({ ...er, name: '' })) }}
                className={`w-full border rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  editErrors.name ? 'border-red-300 bg-red-50' : 'border-gray-200'
                }`}
              />
              {editErrors.name && <p className="mt-1 text-xs text-red-600">{editErrors.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">URL Base</label>
              <input
                type="text"
                value={editData.base_url}
                onChange={e => { setEditData(d => ({ ...d, base_url: e.target.value })); setEditErrors(er => ({ ...er, base_url: '' })) }}
                className={`w-full border rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  editErrors.base_url ? 'border-red-300 bg-red-50' : 'border-gray-200'
                }`}
              />
              {editErrors.base_url && <p className="mt-1 text-xs text-red-600">{editErrors.base_url}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">URL Proyectos</label>
              <input
                type="text"
                value={editData.proyectos_url}
                onChange={e => setEditData(d => ({ ...d, proyectos_url: e.target.value }))}
                placeholder="https://ejemplo.com/proyectos"
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción</label>
              <textarea
                value={editData.description}
                onChange={e => setEditData(d => ({ ...d, description: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={4}
              />
            </div>
            {/* Footer meta */}
            <div className="flex items-center justify-between pt-1 gap-3">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="px-2 py-1 bg-gray-100 rounded-lg">
                  Fuente: <strong>{editDev.source === 'tavily' ? 'Tavily' : 'Manual'}</strong>
                </span>
                <span className="px-2 py-1 bg-gray-100 rounded-lg">
                  Creado: <strong>{new Date(editDev.created_at).toLocaleDateString('es-PE')}</strong>
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Guardar
                </button>
              </div>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

// helpers used in list view
function nameHash(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return h
}
function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}
