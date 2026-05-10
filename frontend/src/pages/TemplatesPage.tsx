import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getDevelopers, bulkCreateDevelopers } from '../services/api'
import { useTavilySearch, TavilyResult } from '../hooks/useTavilySearch'
import { useCreateDeveloper } from '../hooks/useDevelopers'
import { Developer } from '../types'
import {
  Search, Plus, Loader2, CheckSquare, Square, Check,
  AlertCircle, Globe, ExternalLink, ChevronLeft, ChevronRight, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../components/ui/Modal'
import DeveloperCard from '../components/DeveloperCard'

const RIGHT_PAGE_SIZE = 8

// ─── Tavily result card ───────────────────────────────────────────────────────

function TavilyResultCard({
  result, selected, onToggle,
}: { result: TavilyResult; selected: boolean; onToggle: () => void }) {
  const disabled = result.already_registered
  const domain = (() => { try { return new URL(result.url).hostname } catch { return result.url } })()
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`

  return (
    <button
      onClick={!disabled ? onToggle : undefined}
      disabled={disabled}
      className={`w-full text-left rounded-xl border p-3.5 transition-all duration-150 ${
        disabled
          ? 'border-gray-100 bg-gray-50/80 cursor-default'
          : selected
          ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
          : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm cursor-pointer'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox / check */}
        <div className="mt-0.5 flex-shrink-0">
          {disabled ? (
            <div className="w-5 h-5 rounded border border-gray-200 bg-white flex items-center justify-center">
              <Check className="w-3 h-3 text-green-500" />
            </div>
          ) : selected ? (
            <CheckSquare className="w-5 h-5 text-blue-600" />
          ) : (
            <Square className="w-5 h-5 text-gray-300" />
          )}
        </div>
        {/* Favicon */}
        <img
          src={faviconUrl}
          alt=""
          aria-hidden
          className="w-5 h-5 rounded mt-0.5 flex-shrink-0 object-contain"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={`font-semibold text-sm ${disabled ? 'text-gray-500' : 'text-gray-900'}`}>
              {result.name}
            </span>
            {disabled && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                <Check className="w-2.5 h-2.5" /> Ya agregado
              </span>
            )}
          </div>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline mb-1.5"
          >
            <Globe className="w-3 h-3 flex-shrink-0" />
            <span className="truncate max-w-[180px]">{domain}</span>
            <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
          </a>
          {result.description && (
            <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{result.description}</p>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'with_template' | 'without_template'

export default function TemplatesPage() {
  // Left panel
  const [query, setQuery] = useState('')
  const { results, loading: searching, error: searchError, keyConfigured, searched, search, clear } = useTavilySearch()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [addingBulk, setAddingBulk] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [manualForm, setManualForm] = useState({ name: '', base_url: '', description: '' })
  const [manualErrors, setManualErrors] = useState<Record<string, string>>({})

  // Right panel
  const [rightSearch, setRightSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [page, setPage] = useState(0)

  const queryClient = useQueryClient()
  const createMutation = useCreateDeveloper()

  const { data: developers = [], isLoading: loadingDevs } = useQuery({
    queryKey: ['developers'],
    queryFn: () => getDevelopers().then(r => r.data),
  })

  // Selectable (not registered) indices
  const selectableIdx = results.map((r, i) => ({ r, i })).filter(({ r }) => !r.already_registered).map(({ i }) => i)
  const allSelected = selectableIdx.length > 0 && selectableIdx.every(i => selected.has(i))

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIdx))
  const toggleOne = (i: number) => {
    const s = new Set(selected)
    s.has(i) ? s.delete(i) : s.add(i)
    setSelected(s)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim().length < 2) return
    search(query)
    setSelected(new Set())
  }

  const handleAddSelected = async () => {
    const items = Array.from(selected).map(i => ({
      name: results[i].name, base_url: results[i].url,
      description: results[i].description, source: 'tavily' as const,
    }))
    if (!items.length) return
    setAddingBulk(true)
    try {
      await bulkCreateDevelopers(items)
      queryClient.invalidateQueries({ queryKey: ['developers'] })
      setSelected(new Set())
      if (query) search(query)
      toast.success(`${items.length} desarrolladora${items.length > 1 ? 's' : ''} agregada${items.length > 1 ? 's' : ''} correctamente`)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error al agregar')
    } finally {
      setAddingBulk(false)
    }
  }

  const validateManual = () => {
    const errors: Record<string, string> = {}
    if (!manualForm.name.trim()) errors.name = 'El nombre es requerido'
    if (!manualForm.base_url.trim()) errors.base_url = 'La URL es requerida'
    else if (!/^https?:\/\//i.test(manualForm.base_url)) errors.base_url = 'Ingresa una URL válida'
    return errors
  }

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const errors = validateManual()
    if (Object.keys(errors).length) { setManualErrors(errors); return }
    try {
      await createMutation.mutateAsync({ ...manualForm, source: 'manual' })
      setManualForm({ name: '', base_url: '', description: '' })
      setManualErrors({})
      setShowManual(false)
      if (query) search(query)
      toast.success('Desarrolladora agregada correctamente')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error al agregar')
    }
  }

  const filteredDevs = useMemo(() => {
    return (developers as Developer[]).filter(d =>
      d.name.toLowerCase().includes(rightSearch.toLowerCase()) ||
      (d.description || '').toLowerCase().includes(rightSearch.toLowerCase()) ||
      d.base_url.toLowerCase().includes(rightSearch.toLowerCase())
    )
  }, [developers, rightSearch, filter])

  const totalPages = Math.ceil(filteredDevs.length / RIGHT_PAGE_SIZE)
  const pageDevs = filteredDevs.slice(page * RIGHT_PAGE_SIZE, (page + 1) * RIGHT_PAGE_SIZE)

  const filterLabels: Record<FilterKey, string> = { all: 'Todas', with_template: 'Con plantilla', without_template: 'Sin plantilla' }

  return (
    <div className="flex gap-5 h-[calc(100vh-3rem)]">

      {/* ════ LEFT PANEL (38%) ════════════════════════════════════════════════ */}
      <aside className="w-[38%] flex-shrink-0 flex flex-col bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-sm font-bold text-gray-900 mb-0.5">Buscar Plataformas</h2>
          <p className="text-xs text-gray-500 mb-3">Descubre nuevas inmobiliarias con Tavily AI</p>

          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); if (!e.target.value) clear() }}
                placeholder="Ej: inmobiliarias en Lima..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={searching || query.trim().length < 2}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {searching ? 'Buscando...' : 'Buscar'}
            </button>
          </form>
          {query.trim().length === 1 && (
            <p className="text-xs text-red-500 mt-1.5">Escribe al menos 2 caracteres</p>
          )}
        </div>

        {/* Results — scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* API key warning */}
          {searched && !keyConfigured && (
            <div className="m-4 flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800">API Key no configurada</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Agrega <code className="bg-amber-100 px-0.5 rounded">TAVILY_API_KEY</code> en <code className="bg-amber-100 px-0.5 rounded">backend/.env</code>
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {searchError && (
            <div className="m-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{searchError}</p>
            </div>
          )}

          {/* Skeleton */}
          {searching && (
            <div className="p-4 space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-gray-100 p-3.5 space-y-2 animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-5 h-5 bg-gray-200 rounded" />
                    <div className="w-5 h-5 bg-gray-100 rounded" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 bg-gray-200 rounded w-2/3" />
                      <div className="h-3 bg-gray-100 rounded w-1/2" />
                      <div className="h-3 bg-gray-100 rounded w-full" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Toolbar */}
          {!searching && results.length > 0 && (
            <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-2 flex items-center justify-between z-10">
              <span className="text-xs text-gray-500">
                {results.length} resultado{results.length !== 1 ? 's' : ''}
                {selected.size > 0 && <span className="ml-1 text-blue-600">· {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}</span>}
              </span>
              <div className="flex gap-2">
                <button onClick={clear} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
                  <X className="w-3 h-3" /> Limpiar
                </button>
                {selectableIdx.length > 0 && (
                  <button onClick={toggleAll} className="text-xs font-medium text-blue-600 hover:underline">
                    {allSelected ? 'Ninguno' : 'Todos'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Cards */}
          {!searching && results.length > 0 && (
            <div className="p-4 space-y-2">
              {results.map((r, i) => (
                <TavilyResultCard key={i} result={r} selected={selected.has(i)} onToggle={() => toggleOne(i)} />
              ))}
            </div>
          )}

          {/* Empty after search */}
          {!searching && searched && results.length === 0 && keyConfigured && !searchError && (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <Search className="w-8 h-8 text-gray-300 mb-2" />
              <p className="text-sm font-medium text-gray-700">Sin resultados</p>
              <p className="text-xs text-gray-400 mt-1">Prueba con términos más generales</p>
            </div>
          )}

          {/* Initial state */}
          {!searching && !searched && (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-3">
                <Search className="w-5 h-5 text-blue-400" />
              </div>
              <p className="text-sm font-medium text-gray-700">Busca plataformas inmobiliarias</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Usa Tavily para descubrir nuevas inmobiliarias y agregarlas con un clic
              </p>
            </div>
          )}
        </div>

        {/* Bottom actions */}
        <div className="border-t border-gray-100 p-4 space-y-2 flex-shrink-0 bg-white">
          {selected.size > 0 && (
            <button
              onClick={handleAddSelected}
              disabled={addingBulk}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {addingBulk ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {addingBulk ? 'Agregando...' : `Agregar seleccionadas (${selected.size})`}
            </button>
          )}
          <div className="relative flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-xs text-gray-400 flex-shrink-0">o</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>
          <button
            onClick={() => setShowManual(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Agregar manualmente
          </button>
        </div>
      </aside>

      {/* ════ RIGHT PANEL (62%) ═══════════════════════════════════════════════ */}
      <section className="flex-1 flex flex-col bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden min-w-0">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Desarrolladoras Registradas</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Total: <span className="font-semibold text-gray-700">{developers.length}</span>
              </p>
            </div>
          </div>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              value={rightSearch}
              onChange={e => { setRightSearch(e.target.value); setPage(0) }}
              placeholder="Filtrar desarrolladoras..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-1.5">
            {(Object.keys(filterLabels) as FilterKey[]).map(k => (
              <button
                key={k}
                onClick={() => { setFilter(k); setPage(0) }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filter === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {filterLabels[k]}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {loadingDevs ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-gray-100 p-5 animate-pulse">
                  <div className="flex gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-gray-200" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-3/4" />
                      <div className="h-3 bg-gray-100 rounded w-1/2" />
                    </div>
                  </div>
                  <div className="space-y-1.5 mb-3">
                    <div className="h-3 bg-gray-100 rounded w-full" />
                    <div className="h-3 bg-gray-100 rounded w-5/6" />
                  </div>
                  <div className="h-10 bg-gray-200 rounded-xl" />
                </div>
              ))}
            </div>
          ) : pageDevs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <Globe className="w-10 h-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-700 mb-1">
                {rightSearch ? `Sin resultados para "${rightSearch}"` : 'Sin desarrolladoras registradas'}
              </p>
              <p className="text-xs text-gray-400">
                {rightSearch ? 'Prueba otra búsqueda' : 'Usa el panel izquierdo para agregar plataformas'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {pageDevs.map((dev: Developer) => (
                <DeveloperCard key={dev.id} dev={dev} href={`/templates/${dev.id}/editor`} />
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between flex-shrink-0 bg-white">
            <span className="text-xs text-gray-500">Página {page + 1} de {totalPages}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
                const idx = totalPages <= 5 ? i : Math.max(0, Math.min(page - 2, totalPages - 5)) + i
                return (
                  <button
                    key={idx}
                    onClick={() => setPage(idx)}
                    className={`w-7 h-7 rounded-lg text-xs font-medium transition ${
                      page === idx ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {idx + 1}
                  </button>
                )
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Manual Add Modal */}
      <Modal open={showManual} onClose={() => { setShowManual(false); setManualErrors({}) }} title="Agregar Desarrolladora">
        <form onSubmit={handleManualAdd} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={manualForm.name}
              onChange={e => { setManualForm(f => ({ ...f, name: e.target.value })); setManualErrors(er => ({ ...er, name: '' })) }}
              placeholder="Ej: Nexo Inmobiliaria"
              className={`w-full border rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${manualErrors.name ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
            />
            {manualErrors.name && <p className="mt-1 text-xs text-red-600">{manualErrors.name}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              URL Base <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={manualForm.base_url}
              onChange={e => { setManualForm(f => ({ ...f, base_url: e.target.value })); setManualErrors(er => ({ ...er, base_url: '' })) }}
              onBlur={e => {
                if (e.target.value && !/^https?:\/\//i.test(e.target.value)) {
                  setManualForm(f => ({ ...f, base_url: 'https://' + f.base_url }))
                }
              }}
              placeholder="https://www.ejemplo.com"
              className={`w-full border rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${manualErrors.base_url ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
            />
            {manualErrors.base_url && <p className="mt-1 text-xs text-red-600">{manualErrors.base_url}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción</label>
            <textarea
              value={manualForm.description}
              onChange={e => setManualForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe brevemente esta plataforma..."
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={3}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {createMutation.isPending ? 'Agregando...' : 'Agregar →'}
            </button>
            <button
              type="button"
              onClick={() => { setShowManual(false); setManualErrors({}) }}
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
