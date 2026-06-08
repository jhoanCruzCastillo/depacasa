import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  TrendingUp,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Filter,
  Flame,
  Thermometer,
  Snowflake,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  FileCheck,
  FileX,
  FileQuestion,
  Award,
  BarChart3,
  FileText,
  ExternalLink,
  Image as ImageIcon,
  Pencil,
  Coins,
  Tag,
  Plus,
  Trash2,
  CreditCard,
  Package,
} from 'lucide-react'
import API from '../../services/api'
import toast from 'react-hot-toast'

interface TierInfo {
  key: 'muy_caliente' | 'caliente' | 'tibio' | 'frio'
  label: string
}

interface ScoreSummary {
  total: number
  max: number
  tier: TierInfo
}

interface SiteUser {
  id: string
  email: string
  name: string | null
  country: string | null
  phone: string | null
  created_at: string | null
  has_uploaded_documents?: boolean
  has_financial_document?: boolean
  financial_doc_status: 'pending' | 'approved' | 'rejected' | null
  financial_doc_notes: string | null
  financial_doc_reviewed_at: string | null
  financial_doc_reviewed_by: string | null
  score?: ScoreSummary
}

interface BreakdownItem {
  pts: number
  max: number
  detail: string[]
}

interface ScoreBreakdown {
  total: number
  max: number
  tier: TierInfo
  breakdown: {
    perfil: BreakdownItem
    presupuesto: BreakdownItem
    preferencias: BreakdownItem
    actividad: BreakdownItem & { last_activity_days_ago?: number }
    interes: BreakdownItem & { interested_count?: number }
    documento_subido: BreakdownItem
    documento_validado: BreakdownItem
  }
  financial_doc_status: string | null
  financial_doc_notes: string | null
  financial_doc_reviewed_at: string | null
  financial_doc_reviewed_by: string | null
}

interface ScoringConfig {
  perfil_max: number
  presupuesto_max: number
  preferencias_max: number
  actividad_max: number
  interes_max: number
  doc_subido_max: number
  doc_validado_max: number
  tier_muy_caliente_min: number
  tier_caliente_min: number
  tier_tibio_min: number
  price_muy_caliente: number
  price_caliente: number
  price_tibio: number
  price_frio: number
  price_currency: string
}

const DEFAULT_CONFIG: ScoringConfig = {
  perfil_max: 15,
  presupuesto_max: 10,
  preferencias_max: 10,
  actividad_max: 20,
  interes_max: 15,
  doc_subido_max: 10,
  doc_validado_max: 20,
  tier_muy_caliente_min: 76,
  tier_caliente_min: 56,
  tier_tibio_min: 31,
  price_muy_caliente: 0,
  price_caliente: 0,
  price_tibio: 0,
  price_frio: 0,
  price_currency: 'PEN',
}

const PAGE_SIZE = 20

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
const isImageUrl = (url: string): boolean =>
  /\.(jpg|jpeg|png|webp|gif|bmp|avif|heic)(?:$|[?#])/i.test(url)

const TIERS = [
  { key: 'muy_caliente', label: 'Muy caliente', color: 'text-red-600', bg: 'bg-red-100', border: 'border-red-200', icon: Flame },
  { key: 'caliente', label: 'Caliente', color: 'text-orange-600', bg: 'bg-orange-100', border: 'border-orange-200', icon: Thermometer },
  { key: 'tibio', label: 'Tibio', color: 'text-amber-600', bg: 'bg-amber-100', border: 'border-amber-200', icon: Thermometer },
  { key: 'frio', label: 'Frío', color: 'text-slate-500', bg: 'bg-slate-100', border: 'border-slate-200', icon: Snowflake },
]

const DOC_STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'none', label: 'Sin validar (ninguno)' },
  { value: 'pending', label: 'En revisión' },
  { value: 'approved', label: 'Aprobado' },
  { value: 'rejected', label: 'Rechazado' },
]

const formatDate = (value?: string | null, withTime = false): string => {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return withTime ? parsed.toLocaleString('es-PE') : parsed.toLocaleDateString('es-PE')
}

function TierBadge({ tier, score }: { tier: TierInfo; score: number }) {
  const cfg = TIERS.find(t => t.key === tier.key) || TIERS[3]
  const Icon = cfg.icon
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon className="w-3.5 h-3.5" />
      <span>{score}</span>
      <span className="font-medium opacity-75">/ 100</span>
    </div>
  )
}

function ScoreBar({ pts, max, color }: { pts: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((pts / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-slate-500 w-10 text-right">
        {pts}/{max}
      </span>
    </div>
  )
}

function DocStatusBadge({ status }: { status: string | null }) {
  if (status === 'approved')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
        <FileCheck className="w-3 h-3" /> Aprobado
      </span>
    )
  if (status === 'rejected')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
        <FileX className="w-3 h-3" /> Rechazado
      </span>
    )
  if (status === 'pending')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
        <Clock className="w-3 h-3" /> En revisión
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
      <FileQuestion className="w-3 h-3" /> Sin validar
    </span>
  )
}

const BREAKDOWN_LABELS: Record<string, { label: string; color: string }> = {
  perfil: { label: 'Perfil', color: 'bg-blue-500' },
  presupuesto: { label: 'Presupuesto', color: 'bg-violet-500' },
  preferencias: { label: 'Preferencias', color: 'bg-indigo-500' },
  actividad: { label: 'Actividad', color: 'bg-cyan-500' },
  interes: { label: 'Interés', color: 'bg-orange-500' },
  documento_subido: { label: 'Doc. subido', color: 'bg-emerald-500' },
  documento_validado: { label: 'Doc. validado', color: 'bg-green-600' },
}

// ── Pricing tab component ──────────────────────────────────────────────────────

const TIER_PRICING_ROWS: Array<{
  key: keyof ScoringConfig
  label: string
  color: string
  bg: string
  border: string
  Icon: typeof Flame
  desc: string
}> = [
  { key: 'price_muy_caliente', label: 'Muy caliente', color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200',    Icon: Flame,        desc: 'Lead con score máximo, muy listo para comprar' },
  { key: 'price_caliente',     label: 'Caliente',     color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', Icon: Thermometer,  desc: 'Lead activo con presupuesto y preferencias definidas' },
  { key: 'price_tibio',        label: 'Tibio',        color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-200',  Icon: Thermometer,  desc: 'Lead con actividad moderada, en proceso de decisión' },
  { key: 'price_frio',         label: 'Frío',         color: 'text-slate-500',  bg: 'bg-slate-50',  border: 'border-slate-200',  Icon: Snowflake,    desc: 'Lead reciente o con poca información' },
]

function PricingTab({ config, onSaved }: { config: ScoringConfig; onSaved: (c: ScoringConfig) => void }) {
  const [form, setForm] = useState<ScoringConfig>({ ...config })
  const [saving, setSaving] = useState(false)

  useEffect(() => { setForm({ ...config }) }, [config])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await API.put('/chat/scoring-config', form)
      onSaved(res.data)
      toast.success('Créditos actualizados')
    } catch {
      toast.error('Error al guardar los créditos')
    } finally {
      setSaving(false)
    }
  }

  const totalMax = form.perfil_max + form.presupuesto_max + form.preferencias_max +
    form.actividad_max + form.interes_max + form.doc_subido_max + form.doc_validado_max

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
        <Coins className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          Define los créditos que los asesores necesitarán para acceder a cada lead según su tier de calificación.
          Los tiers se calculan según los umbrales configurados en "Editar criterios".
        </p>
      </div>

      {/* Tier thresholds reminder */}
      <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Rangos de tier actuales</p>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="bg-slate-100 text-slate-500 px-3 py-1.5 rounded-full font-medium">Frío: 0 – {form.tier_tibio_min - 1} pts</span>
          <span className="bg-amber-100 text-amber-700 px-3 py-1.5 rounded-full font-medium">Tibio: {form.tier_tibio_min} – {form.tier_caliente_min - 1} pts</span>
          <span className="bg-orange-100 text-orange-700 px-3 py-1.5 rounded-full font-medium">Caliente: {form.tier_caliente_min} – {form.tier_muy_caliente_min - 1} pts</span>
          <span className="bg-red-100 text-red-700 px-3 py-1.5 rounded-full font-medium">Muy caliente: {form.tier_muy_caliente_min} – {totalMax} pts</span>
        </div>
      </div>

      {/* Credit cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TIER_PRICING_ROWS.map(({ key, label, color, bg, border, Icon, desc }) => (
          <div key={key} className={`rounded-xl border-2 ${border} ${bg} p-5 space-y-3`}>
            <div className="flex items-center gap-2">
              <Icon className={`w-5 h-5 ${color}`} />
              <span className={`font-bold text-base ${color}`}>{label}</span>
            </div>
            <p className="text-xs text-slate-500">{desc}</p>
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <input
                type="number"
                min={0}
                step={1}
                value={form[key] as number}
                onChange={e => setForm(f => ({ ...f, [key]: Math.round(parseFloat(e.target.value) || 0) }))}
                className="flex-1 border border-white/80 bg-white rounded-lg px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="0"
              />
              <span className="text-xs text-slate-400 font-medium">créditos</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
        >
          <Coins className="w-4 h-4" />
          {saving ? 'Guardando...' : 'Guardar créditos'}
        </button>
      </div>
    </div>
  )
}

// ── Packages config tab ───────────────────────────────────────────────────────

interface PkgConfig {
  id: string; label: string; credits: number; price: number
  badge: string; highlighted: boolean; active: boolean
}


function Toggle({ on, onToggle, color = 'bg-emerald-500' }: { on: boolean; onToggle: () => void; color?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex flex-shrink-0 w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer p-0 border-0 outline-none focus:ring-2 focus:ring-offset-1 focus:ring-amber-400 ${on ? color : 'bg-slate-200'}`}
    >
      <span className={`absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

function fromApi(p: Record<string, unknown>): PkgConfig {
  return {
    id: p.id as string,
    label: p.label as string,
    credits: p.credits as number,
    price: p.price as number,
    badge: (p.badge as string) ?? '',
    highlighted: p.is_highlighted as boolean,
    active: p.is_active as boolean,
  }
}

function toApi(p: PkgConfig) {
  return {
    label: p.label,
    credits: p.credits,
    price: p.price,
    badge: p.badge || null,
    is_highlighted: p.highlighted,
    is_active: p.active,
    sort_order: 0,
  }
}

function PackagesConfigTab() {
  const [basePriceValue, setBasePriceValue] = useState('0.50')
  const [basePriceCurrency, setBasePriceCurrency] = useState('USD')
  const [packages, setPackages] = useState<PkgConfig[]>([])
  const [loadingPkgs, setLoadingPkgs] = useState(true)
  const [editPkg, setEditPkg] = useState<PkgConfig | null>(null)
  const [savingBase, setSavingBase] = useState(false)
  const [savingPkg, setSavingPkg] = useState(false)

  useEffect(() => {
    API.get('/credits/settings').then(r => {
      setBasePriceValue(String(r.data.base_price))
      setBasePriceCurrency(r.data.currency)
    }).catch(() => {})
    API.get('/credits/packages').then(r => {
      setPackages(r.data.map(fromApi))
    }).catch(() => {}).finally(() => setLoadingPkgs(false))
  }, [])

  const handleToggleActive = async (pkg: PkgConfig) => {
    const updated = { ...pkg, active: !pkg.active }
    setPackages(prev => prev.map(p => p.id === pkg.id ? updated : p))
    try { await API.put(`/credits/packages/${pkg.id}`, toApi(updated)) }
    catch { setPackages(prev => prev.map(p => p.id === pkg.id ? pkg : p)); toast.error('Error al actualizar') }
  }

  const handleToggleHighlighted = async (pkg: PkgConfig) => {
    const updated = { ...pkg, highlighted: !pkg.highlighted }
    setPackages(prev => prev.map(p => p.id === pkg.id ? updated : p))
    try { await API.put(`/credits/packages/${pkg.id}`, toApi(updated)) }
    catch { setPackages(prev => prev.map(p => p.id === pkg.id ? pkg : p)); toast.error('Error al actualizar') }
  }

  const handleDelete = async (id: string) => {
    setPackages(prev => prev.filter(p => p.id !== id))
    try { await API.delete(`/credits/packages/${id}`) }
    catch { toast.error('Error al eliminar'); API.get('/credits/packages').then(r => setPackages(r.data.map(fromApi))) }
  }

  const handleAddPackage = () => {
    setEditPkg({ id: '', label: 'Nuevo paquete', credits: 20, price: 10, badge: '', highlighted: false, active: true })
  }

  const handleSavePkg = async (updated: PkgConfig) => {
    setSavingPkg(true)
    try {
      if (!updated.id) {
        const r = await API.post('/credits/packages', toApi(updated))
        setPackages(prev => [...prev, fromApi(r.data)])
      } else {
        const r = await API.put(`/credits/packages/${updated.id}`, toApi(updated))
        setPackages(prev => prev.map(p => p.id === updated.id ? fromApi(r.data) : p))
      }
      setEditPkg(null)
      toast.success('Paquete guardado')
    } catch { toast.error('Error al guardar el paquete') }
    finally { setSavingPkg(false) }
  }

  const handleSaveBase = async () => {
    setSavingBase(true)
    try {
      await API.put('/credits/settings', { base_price: parseFloat(basePriceValue) || 0.5, currency: basePriceCurrency })
      toast.success('Precio base guardado')
    } catch { toast.error('Error al guardar el precio base') }
    finally { setSavingBase(false) }
  }

  return (
    <div className="space-y-8">

      {/* ── Precio base ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-bold text-slate-700">Precio base por crédito</h2>
        </div>
        <p className="text-xs text-slate-500">
          Define el valor en dinero real de 1 crédito. Los asesores compran créditos a este precio al adquirir cualquier paquete.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-slate-600 font-medium">1 crédito =</span>
          <div className="flex gap-2">
            {CURRENCIES_BASE.map(c => (
              <button
                key={c}
                onClick={() => setBasePriceCurrency(c)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${basePriceCurrency === c ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
            <span className="px-3 py-2 bg-slate-50 text-slate-500 text-sm font-medium border-r border-slate-200">{basePriceCurrency}</span>
            <input
              type="number" min={0} step={0.01} value={basePriceValue}
              onChange={e => setBasePriceValue(e.target.value)}
              className="px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none w-24"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={handleSaveBase} disabled={savingBase}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            <Coins className="w-4 h-4" />
            {savingBase ? 'Guardando...' : 'Guardar precio base'}
          </button>
        </div>
      </div>

      {/* ── Paquetes ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-700">Paquetes de créditos</h2>
            <p className="text-xs text-slate-400 mt-0.5">Estos paquetes se muestran a los asesores en el portal de compra.</p>
          </div>
          <button
            onClick={handleAddPackage}
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700 transition-colors flex-shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar paquete
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-[11px] text-slate-400 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">Nombre</th>
                <th className="text-left px-4 py-3 font-semibold">Créditos</th>
                <th className="text-left px-4 py-3 font-semibold">Precio</th>
                <th className="text-left px-4 py-3 font-semibold">Badge</th>
                <th className="text-center px-4 py-3 font-semibold">Destacado</th>
                <th className="text-center px-4 py-3 font-semibold">Visible</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingPkgs ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400 text-xs">Cargando...</td></tr>
              ) : packages.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-400 text-xs">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No hay paquetes configurados.
                  </td>
                </tr>
              ) : packages.map(pkg => (
                <tr key={pkg.id} className={`transition-colors ${pkg.active ? 'hover:bg-slate-50' : 'opacity-40 bg-slate-50/60'}`}>
                  <td className="px-5 py-3.5 font-semibold text-slate-800">{pkg.label}</td>
                  <td className="px-4 py-3.5">
                    <span className="flex items-center gap-1.5">
                      <Coins className="w-3.5 h-3.5 text-amber-400" />
                      <span className="font-bold text-slate-700">{pkg.credits}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-semibold text-slate-700">${pkg.price} USD</td>
                  <td className="px-4 py-3.5">
                    {pkg.badge
                      ? <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[11px] font-semibold">{pkg.badge}</span>
                      : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <div className="flex justify-center">
                      <Toggle on={pkg.highlighted} onToggle={() => handleToggleHighlighted(pkg)} color="bg-blue-500" />
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <div className="flex justify-center">
                      <Toggle on={pkg.active} onToggle={() => handleToggleActive(pkg)} />
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => setEditPkg({ ...pkg })}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(pkg.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Package modal (add / edit) ── */}
      {editPkg && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-800">{editPkg.id ? 'Editar paquete' : 'Nuevo paquete'}</h2>
              <button onClick={() => setEditPkg(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              {([
                { label: 'Nombre',           field: 'label',   type: 'text'   },
                { label: 'Créditos',         field: 'credits', type: 'number' },
                { label: 'Precio (USD)',     field: 'price',   type: 'number' },
                { label: 'Badge (etiqueta)', field: 'badge',   type: 'text'   },
              ] as { label: string; field: keyof PkgConfig; type: string }[]).map(({ label, field, type }) => (
                <div key={field}>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">{label}</label>
                  <input
                    type={type}
                    value={editPkg[field] as string | number}
                    onChange={e => setEditPkg(prev => prev ? { ...prev, [field]: type === 'number' ? Number(e.target.value) : e.target.value } : null)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm text-slate-600">Destacado en el portal</span>
                <Toggle on={editPkg.highlighted} onToggle={() => setEditPkg(prev => prev ? { ...prev, highlighted: !prev.highlighted } : null)} color="bg-blue-500" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setEditPkg(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => handleSavePkg(editPkg)}
                disabled={savingPkg}
                className="flex-1 py-2.5 bg-amber-500 text-white text-sm font-bold rounded-xl hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {savingPkg ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default function LeadScoringPage() {
  const [users, setUsers] = useState<SiteUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [docFilter, setDocFilter] = useState('')

  const [detailUser, setDetailUser] = useState<SiteUser | null>(null)
  const [scoreBreakdown, setScoreBreakdown] = useState<ScoreBreakdown | null>(null)
  const [scoreLoading, setScoreLoading] = useState(false)


  const [pageTab, setPageTab] = useState<'leads' | 'pricing' | 'packages'>('leads')
  const [scoringConfig, setScoringConfig] = useState<ScoringConfig>(DEFAULT_CONFIG)
  const [configModalOpen, setConfigModalOpen] = useState(false)
  const [configForm, setConfigForm] = useState<ScoringConfig>(DEFAULT_CONFIG)
  const [configSaving, setConfigSaving] = useState(false)

  const [quickValidateUser, setQuickValidateUser] = useState<SiteUser | null>(null)
  const [quickValidateStatus, setQuickValidateStatus] = useState<'approved' | 'rejected' | 'pending'>('pending')
  const [quickValidateNotes, setQuickValidateNotes] = useState('')
  const [quickValidateReviewer, setQuickValidateReviewer] = useState('')
  const [quickValidating, setQuickValidating] = useState(false)
  const [quickDocUrl, setQuickDocUrl] = useState('')
  const [quickDocKind, setQuickDocKind] = useState<'pdf' | 'image' | 'file' | 'link' | null>(null)
  const [quickDocLoading, setQuickDocLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await API.get('/site-users/ranked', {
        params: {
          skip: page * PAGE_SIZE,
          limit: PAGE_SIZE,
          search: query,
          tier: tierFilter,
          doc_status: docFilter,
        },
      })
      setUsers(res.data.items)
      setTotal(res.data.total)
    } finally {
      setLoading(false)
    }
  }, [page, query, tierFilter, docFilter])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    API.get('/chat/scoring-config').then(r => {
      setScoringConfig(r.data)
      setConfigForm(r.data)
    }).catch(() => {})
  }, [])

  const openConfigModal = () => {
    setConfigForm({ ...scoringConfig })
    setConfigModalOpen(true)
  }

  const handleConfigSave = async () => {
    setConfigSaving(true)
    try {
      const res = await API.put('/chat/scoring-config', configForm)
      setScoringConfig(res.data)
      setConfigModalOpen(false)
      toast.success('Criterios actualizados')
      load()
    } catch {
      toast.error('Error al guardar los criterios')
    } finally {
      setConfigSaving(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(0)
    setQuery(search)
  }

  const openDetail = async (u: SiteUser) => {
    setDetailUser(u)
    setScoreBreakdown(null)
    setScoreLoading(true)
    try {
      const res = await API.get(`/site-users/${u.id}/score`)
      setScoreBreakdown(res.data)
    } catch {
      toast.error('No se pudo cargar el score detallado')
    } finally {
      setScoreLoading(false)
    }
  }

  const closeDetail = () => {
    setDetailUser(null)
    setScoreBreakdown(null)
  }

  const openQuickValidate = async (u: SiteUser) => {
    setQuickValidateUser(u)
    setQuickValidateStatus((u.financial_doc_status as 'approved' | 'rejected' | 'pending') || 'pending')
    setQuickValidateNotes(u.financial_doc_notes || '')
    setQuickValidateReviewer(u.financial_doc_reviewed_by || '')
    setQuickDocUrl('')
    setQuickDocKind(null)
    setQuickDocLoading(true)
    try {
      const res = await API.get(`/site-users/${u.id}/profile`)
      const docRaw =
        res.data?.documents?.financial_capacity_doc_url ||
        res.data?.lead?.financial_capacity_doc ||
        null
      const absUrl = toAbsoluteResourceUrl(docRaw)
      const kind: 'pdf' | 'image' | 'file' | null =
        res.data?.documents?.financial_capacity_doc_kind ||
        (isPdfUrl(docRaw || '') ? 'pdf' : isImageUrl(docRaw || '') ? 'image' : docRaw ? 'file' : null)
      setQuickDocUrl(absUrl)
      setQuickDocKind(kind)
    } catch {
      // no doc, not critical
    } finally {
      setQuickDocLoading(false)
    }
  }

  const handleQuickValidate = async () => {
    if (!quickValidateUser) return
    setQuickValidating(true)
    try {
      await API.post(`/site-users/${quickValidateUser.id}/validate-document`, {
        status: quickValidateStatus,
        notes: quickValidateNotes.trim() || null,
        reviewed_by: quickValidateReviewer.trim() || null,
      })
      toast.success('Validación guardada')
      setQuickValidateUser(null)
      load()
    } catch {
      toast.error('Error al guardar la validación')
    } finally {
      setQuickValidating(false)
    }
  }


  // Summary stats
  const tierCounts = TIERS.map(t => ({
    ...t,
    count: users.filter(u => u.score?.tier.key === t.key).length,
  }))

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Award className="w-6 h-6 text-amber-500" />
            Ajuste de precios
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {total} usuario{total !== 1 ? 's' : ''} · ordenados por puntuación
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, correo..."
              className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-2 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600 transition-colors"
          >
            Buscar
          </button>
          {query && (
            <button
              type="button"
              onClick={() => { setSearch(''); setQuery(''); setPage(0) }}
              className="p-2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>

      {/* Page tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setPageTab('leads')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${pageTab === 'leads' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <Award className="w-4 h-4" />
          Calificación de leads
        </button>
        <button
          onClick={() => setPageTab('pricing')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${pageTab === 'pricing' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <Coins className="w-4 h-4" />
          Créditos por calificación
        </button>
        <button
          onClick={() => setPageTab('packages')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${pageTab === 'packages' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <Package className="w-4 h-4" />
          Paquetes de créditos
        </button>
      </div>

      {/* ── PRICING TAB ── */}
      {pageTab === 'pricing' && (
        <PricingTab config={scoringConfig} onSaved={cfg => { setScoringConfig(cfg); setConfigForm(cfg) }} />
      )}

      {/* ── PACKAGES CONFIG TAB ── */}
      {pageTab === 'packages' && <PackagesConfigTab />}

      {/* ── LEADS TAB wrapper ── */}
      {pageTab === 'leads' && (<>

      {/* Tier summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tierCounts.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => {
                setTierFilter(tierFilter === t.key ? '' : t.key)
                setPage(0)
              }}
              className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                tierFilter === t.key
                  ? `${t.bg} ${t.border} ${t.color} shadow-sm`
                  : 'bg-white border-slate-100 hover:border-slate-200 text-slate-600'
              }`}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${tierFilter === t.key ? t.color : 'text-slate-400'}`} />
              <div>
                <p className="text-lg font-bold">{t.count}</p>
                <p className="text-xs font-medium">{t.label}</p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 font-medium">Doc. financiero:</span>
          {DOC_STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setDocFilter(opt.value); setPage(0) }}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                docFilter === opt.value
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {(tierFilter || docFilter || query) && (
          <button
            onClick={() => { setTierFilter(''); setDocFilter(''); setSearch(''); setQuery(''); setPage(0) }}
            className="text-xs text-slate-400 hover:text-slate-600 underline ml-2"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-400">Cargando...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Sin resultados para los filtros aplicados.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-semibold">#</th>
                <th className="text-left px-4 py-3 font-semibold">Usuario</th>
                <th className="text-left px-4 py-3 font-semibold">Puntuación</th>
                <th className="text-left px-4 py-3 font-semibold">Documentos</th>
                <th className="text-left px-4 py-3 font-semibold">Validación doc.</th>
                <th className="text-left px-4 py-3 font-semibold">Registro</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u, idx) => (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 text-slate-400 text-xs font-mono">
                    {page * PAGE_SIZE + idx + 1}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-amber-600">
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
                  <td className="px-4 py-3.5">
                    {u.score ? (
                      <TierBadge tier={u.score.tier} score={u.score.total} />
                    ) : (
                      <span className="text-slate-300 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {u.has_financial_document ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Subido
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">
                        <XCircle className="w-3 h-3" /> Sin doc.
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      onClick={() => openQuickValidate(u)}
                      className="rounded-full border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all bg-white px-1 py-0.5"
                      title="Validar documento"
                    >
                      <DocStatusBadge status={u.financial_doc_status} />
                    </button>
                  </td>
                  <td className="px-4 py-3.5 text-slate-400 text-xs">
                    {formatDate(u.created_at)}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <button
                      onClick={() => openDetail(u)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500 text-white text-xs rounded-lg hover:bg-amber-600 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Ver score
                    </button>
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
                  <span key={`e-${i}`} className="px-1">...</span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setPage(item as number)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                      page === item ? 'bg-amber-500 text-white' : 'hover:bg-slate-100 text-slate-600'
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

      {/* Score detail modal */}
      {detailUser && createPortal(
        <div className="fixed inset-0 bg-slate-900/60 z-[9999] p-3 md:p-6 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-sm font-bold text-amber-600 flex-shrink-0">
                  {(detailUser.name || detailUser.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="font-bold text-slate-800 text-base truncate">
                    {detailUser.name || 'Sin nombre'}
                  </h2>
                  <p className="text-xs text-slate-400 truncate">{detailUser.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {scoreBreakdown && (
                  <TierBadge tier={scoreBreakdown.tier} score={scoreBreakdown.total} />
                )}
                <button
                  onClick={closeDetail}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {scoreLoading ? (
                <div className="flex items-center justify-center h-40">
                  <div className="w-10 h-10 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
                </div>
              ) : scoreBreakdown ? (
                <>
                  {/* Score total visual */}
                  <section className="bg-slate-50 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-slate-700">Puntuación total</h3>
                      <span className="text-3xl font-black text-slate-800">
                        {scoreBreakdown.total}
                        <span className="text-base font-medium text-slate-400"> / 100</span>
                      </span>
                    </div>
                    <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          scoreBreakdown.tier.key === 'muy_caliente'
                            ? 'bg-red-500'
                            : scoreBreakdown.tier.key === 'caliente'
                            ? 'bg-orange-500'
                            : scoreBreakdown.tier.key === 'tibio'
                            ? 'bg-amber-400'
                            : 'bg-slate-400'
                        }`}
                        style={{ width: `${scoreBreakdown.total}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1.5">
                      <span>Frío</span>
                      <span>Tibio</span>
                      <span>Caliente</span>
                      <span>Muy caliente</span>
                    </div>
                  </section>

                  {/* Breakdown */}
                  <section>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                      Desglose por categoría
                    </h3>
                    <div className="space-y-3">
                      {Object.entries(scoreBreakdown.breakdown).map(([key, val]) => {
                        const meta = BREAKDOWN_LABELS[key]
                        if (!meta) return null
                        return (
                          <div key={key} className="bg-slate-50 rounded-xl px-4 py-3 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-slate-700">{meta.label}</span>
                              <span className="text-xs font-mono text-slate-500">{val.pts}/{val.max}</span>
                            </div>
                            <ScoreBar pts={val.pts} max={val.max} color={meta.color} />
                            {val.detail && val.detail.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {val.detail.map((d, i) => (
                                  <li key={i} className="text-[11px] text-slate-500 flex items-start gap-1.5">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    {d}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </section>

                  {/* Document validation */}
                  <section className="border border-slate-200 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-700">Validación de documento financiero</h3>
                      <DocStatusBadge status={scoreBreakdown.financial_doc_status} />
                    </div>

                    {scoreBreakdown.financial_doc_reviewed_at && (
                      <p className="text-xs text-slate-400">
                        Revisado el {formatDate(scoreBreakdown.financial_doc_reviewed_at, true)}
                        {scoreBreakdown.financial_doc_reviewed_by && (
                          <> por <span className="font-medium text-slate-600">{scoreBreakdown.financial_doc_reviewed_by}</span></>
                        )}
                      </p>
                    )}

                    {scoreBreakdown.financial_doc_notes && (
                      <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2 italic">
                        "{scoreBreakdown.financial_doc_notes}"
                      </p>
                    )}

                    {!scoreBreakdown.financial_doc_reviewed_at && !scoreBreakdown.financial_doc_notes && (
                      <p className="text-xs text-slate-400 italic">Sin revisión registrada aún.</p>
                    )}
                  </section>
                </>
              ) : (
                <div className="text-center py-10 text-slate-400">No se pudo cargar el score.</div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Quick validate modal */}
      {quickValidateUser && createPortal(
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-2">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[96vw] h-[94vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
              <div>
                <h2 className="text-base font-bold text-slate-800">Validar documento financiero</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {quickValidateUser.name
                    ? <>{quickValidateUser.name} · <span className="text-slate-300">{quickValidateUser.email}</span></>
                    : quickValidateUser.email}
                </p>
              </div>
              <button
                onClick={() => setQuickValidateUser(null)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body: two columns */}
            <div className="flex flex-1 overflow-hidden min-h-0">
              {/* Left: form */}
              <div className="w-80 flex-shrink-0 border-r border-slate-100 p-6 space-y-4 overflow-y-auto">
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Estado</p>
                  <div className="flex gap-2">
                    {(['pending', 'approved', 'rejected'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => setQuickValidateStatus(s)}
                        className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                          quickValidateStatus === s
                            ? s === 'approved'
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : s === 'rejected'
                              ? 'bg-red-600 text-white border-red-600'
                              : 'bg-amber-500 text-white border-amber-500'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {s === 'approved' ? 'Aprobar' : s === 'rejected' ? 'Rechazar' : 'En revisión'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Revisor</p>
                  <input
                    value={quickValidateReviewer}
                    onChange={e => setQuickValidateReviewer(e.target.value)}
                    placeholder="Tu nombre"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notas</p>
                  <textarea
                    value={quickValidateNotes}
                    onChange={e => setQuickValidateNotes(e.target.value)}
                    placeholder="Notas de validación (opcional)..."
                    rows={4}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  <button
                    onClick={handleQuickValidate}
                    disabled={quickValidating}
                    className="w-full py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-xl hover:bg-slate-900 disabled:opacity-50 transition-colors"
                  >
                    {quickValidating ? 'Guardando...' : 'Guardar validación'}
                  </button>
                  <button
                    onClick={() => setQuickValidateUser(null)}
                    className="w-full py-2 text-sm text-slate-500 hover:text-slate-700"
                  >
                    Cancelar
                  </button>
                </div>
              </div>

              {/* Right: document preview */}
              <div className="flex-1 bg-slate-100 flex flex-col overflow-hidden">
                {quickDocLoading ? (
                  <div className="flex-1 flex items-center justify-center text-slate-400">
                    <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
                  </div>
                ) : !quickDocUrl ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2 p-6">
                    <FileText className="w-10 h-10 opacity-40" />
                    <p className="text-sm">Sin documento financiero registrado</p>
                  </div>
                ) : quickDocKind === 'pdf' ? (
                  <div className="flex flex-col flex-1 overflow-hidden p-3 gap-2">
                    <div className="flex justify-end">
                      <a
                        href={quickDocUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Abrir en nueva pestaña
                      </a>
                    </div>
                    <iframe
                      src={quickDocUrl}
                      title="Documento financiero"
                      className="flex-1 rounded-xl border border-slate-200 bg-white"
                    />
                  </div>
                ) : quickDocKind === 'image' ? (
                  <div className="flex flex-col flex-1 overflow-hidden p-3 gap-2">
                    <div className="flex justify-end">
                      <a
                        href={quickDocUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Abrir en nueva pestaña
                      </a>
                    </div>
                    <div className="flex-1 overflow-auto bg-white rounded-xl border border-slate-200 flex items-start justify-center p-2">
                      <img
                        src={quickDocUrl}
                        alt="Documento financiero"
                        className="max-w-full object-contain"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-3 p-6 text-center">
                    <ImageIcon className="w-8 h-8 text-slate-400" />
                    <p className="text-sm">Este formato no tiene vista previa embebida.</p>
                    <a
                      href={quickDocUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Abrir documento
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Scoring legend */}
      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" />
            Criterios de puntuación (total: {
              scoringConfig.perfil_max + scoringConfig.presupuesto_max +
              scoringConfig.preferencias_max + scoringConfig.actividad_max +
              scoringConfig.interes_max + scoringConfig.doc_subido_max +
              scoringConfig.doc_validado_max
            } pts)
          </p>
          <button
            onClick={openConfigModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all"
          >
            <Pencil className="w-3.5 h-3.5" />
            Editar criterios
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-600">
          {[
            { label: 'Perfil',        desc: 'Nombre, tel, país, DNI, rating', pts: scoringConfig.perfil_max },
            { label: 'Presupuesto',   desc: 'Min/max precio definido',        pts: scoringConfig.presupuesto_max },
            { label: 'Preferencias',  desc: 'Ubicación, habitaciones, etc.',  pts: scoringConfig.preferencias_max },
            { label: 'Actividad',     desc: 'Vistas, ratings, recencia',      pts: scoringConfig.actividad_max },
            { label: 'Interés',       desc: '"Lo quiero" marcados',           pts: scoringConfig.interes_max },
            { label: 'Doc. subido',   desc: 'Documento financiero cargado',   pts: scoringConfig.doc_subido_max },
            { label: 'Doc. validado', desc: 'Aprobado manualmente',           pts: scoringConfig.doc_validado_max },
            {
              label: 'Tiers',
              desc: `Frío 0-${scoringConfig.tier_tibio_min - 1} · Tibio ${scoringConfig.tier_tibio_min}-${scoringConfig.tier_caliente_min - 1} · Caliente ${scoringConfig.tier_caliente_min}-${scoringConfig.tier_muy_caliente_min - 1} · Muy caliente ${scoringConfig.tier_muy_caliente_min}+`,
              pts: null,
            },
          ].map(({ label, desc, pts }) => (
            <div key={label} className="bg-white rounded-lg px-3 py-2 border border-slate-100">
              <p className="font-semibold text-slate-700">{label}</p>
              <p className="text-slate-400">{desc}{pts !== null ? ` · ${pts} pts` : ''}</p>
            </div>
          ))}
        </div>
      </div>

      </>)}

      {/* Config edit modal */}
      {configModalOpen && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-800">Editar criterios de puntuación</h2>
              <button onClick={() => setConfigModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Puntos máximos por categoría</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ['perfil_max',        'Perfil'],
                  ['presupuesto_max',   'Presupuesto'],
                  ['preferencias_max',  'Preferencias'],
                  ['actividad_max',     'Actividad'],
                  ['interes_max',       'Interés'],
                  ['doc_subido_max',    'Doc. subido'],
                  ['doc_validado_max',  'Doc. validado'],
                ] as [keyof ScoringConfig, string][]).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={configForm[key]}
                      onChange={e => setConfigForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Umbrales de tier (puntuación mínima)</p>
              <div className="grid grid-cols-3 gap-3">
                {([
                  ['tier_tibio_min',        'Tibio'],
                  ['tier_caliente_min',     'Caliente'],
                  ['tier_muy_caliente_min', 'Muy caliente'],
                ] as [keyof ScoringConfig, string][]).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={configForm[key]}
                      onChange={e => setConfigForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setConfigModalOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
                Cancelar
              </button>
              <button
                onClick={handleConfigSave}
                disabled={configSaving}
                className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {configSaving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
