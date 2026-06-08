import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import {
  Building2, LogOut, ChevronLeft, Flame, Thermometer, Snowflake, Star, ShoppingBag,
  CheckCircle2, UserCheck, X,
  Unlock, AlertCircle, Filter, ChevronDown,
  Coins, CreditCard, History, Phone,
} from 'lucide-react'
import API from '../../services/api'
import { session } from '../../services/session'
import toast from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Advisor {
  id: string; name: string; email: string | null; phone: string | null
  whatsapp_number: string | null; is_active: boolean
  developer_id: string | null; developer_name: string | null
  bio: string | null; specialty: string | null
}

interface MarketplaceLead {
  user_id: string
  display_name: string
  masked_email: string | null
  is_unlocked: boolean
  score: number
  tier_key: string
  tier_label: string
  price: number
  currency: string
  properties: Array<{ id: string; title: string; interested: boolean; rating: number | null; project_name: string | null; project_location: string | null }>
  full_name: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  country: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface CreditPackagePublic {
  id: string; label: string; credits: number; price: number; badge: string | null
  is_highlighted: boolean; is_active: boolean; sort_order: number
}
interface CreditTx {
  id: string; type: string; amount: number; balance_after: number
  description: string | null; created_at: string | null
}

const TIER_CFG: Record<string, { color: string; bg: string; border: string; Icon: typeof Flame }> = {
  muy_caliente: { color: 'text-red-600',    bg: 'bg-red-100',    border: 'border-red-200',    Icon: Flame },
  caliente:     { color: 'text-orange-600', bg: 'bg-orange-100', border: 'border-orange-200', Icon: Thermometer },
  tibio:        { color: 'text-amber-600',  bg: 'bg-amber-100',  border: 'border-amber-200',  Icon: Thermometer },
  frio:         { color: 'text-slate-500',  bg: 'bg-slate-100',  border: 'border-slate-200',  Icon: Snowflake },
}

function TierBadge({ tier, score }: { tier: string; score: number }) {
  const cfg = TIER_CFG[tier] || TIER_CFG.frio
  const Icon = cfg.Icon
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon className="w-3.5 h-3.5" /> {score}/100
    </div>
  )
}

function apiHeaders() {
  return session.getType() === 'advisor' ? session.authHeader() : {}
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdvisorPortalPage() {
  const navigate = useNavigate()
  const [advisor, setAdvisor] = useState<Advisor | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  // dashboard
  const [dashTab, setDashTab] = useState<'marketplace' | 'contacts' | 'credits'>('marketplace')
  const [creditBalance, setCreditBalance] = useState<number>(0)
  const [creditPackages, setCreditPackages] = useState<CreditPackagePublic[]>([])
  const [transactions, setTransactions] = useState<CreditTx[]>([])
  const [purchasingPkg, setPurchasingPkg] = useState<string | null>(null)
  const [loadingCredits, setLoadingCredits] = useState(false)
  const [marketplace, setMarketplace] = useState<MarketplaceLead[]>([])
  const [marketplaceCurrency, setMarketplaceCurrency] = useState('PEN')
  const [marketplaceMsg, setMarketplaceMsg] = useState<string | null>(null)
  const [marketplaceLoading, setMarketplaceLoading] = useState(false)
  const [unlockModal, setUnlockModal] = useState<MarketplaceLead | null>(null)
  const [unlocking, setUnlocking] = useState(false)

  // filters
  const [filterTier, setFilterTier] = useState<string>('all')
  const [filterProject, setFilterProject] = useState<string>('all')
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)


  // ── Init ──
  useEffect(() => {
    const token = session.getType() === 'advisor' ? session.getToken() : null
    if (!token) { setAuthLoading(false); return }
    API.get('/chat/advisors/me/full', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setAdvisor(r.data))
      .catch(() => session.clear())
      .finally(() => setAuthLoading(false))
  }, [])


  useEffect(() => {
    if (!advisor) return
    fetchMarketplace()
    fetchCredits()
    fetchCreditPackages()

    // Detect return from Drons Pay checkout
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'success') {
      toast.success('¡Pago completado! Tus créditos han sido acreditados.')
      setDashTab('credits')
      window.history.replaceState({}, '', '/asesores')
    }
  }, [advisor])

  useEffect(() => {
    if (!projectDropdownOpen) return
    const close = () => setProjectDropdownOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [projectDropdownOpen])


  const fetchMarketplace = useCallback(async () => {
    setMarketplaceLoading(true)
    try {
      const r = await API.get('/chat/advisors/marketplace', { headers: apiHeaders() })
      setMarketplace(r.data.leads ?? [])
      setMarketplaceCurrency(r.data.currency ?? 'PEN')
      setMarketplaceMsg(r.data.message ?? null)
    } catch { /* non-critical */ }
    finally { setMarketplaceLoading(false) }
  }, [])

  const fetchCredits = useCallback(async () => {
    setLoadingCredits(true)
    try {
      const r = await API.get('/credits/me', { headers: apiHeaders() })
      setCreditBalance(r.data.balance)
      setTransactions(r.data.transactions ?? [])
    } catch { /* non-critical */ }
    finally { setLoadingCredits(false) }
  }, [])

  const fetchCreditPackages = useCallback(async () => {
    try {
      const r = await API.get('/credits/packages/public')
      setCreditPackages(r.data)
    } catch { /* non-critical */ }
  }, [])

  const handleLogout = () => { session.clear(); navigate('/advisor/auth', { replace: true }) }

  // ── Unlock ──
  const handleUnlock = async () => {
    if (!unlockModal) return
    setUnlocking(true)
    try {
      const r = await API.post(`/chat/advisors/marketplace/${unlockModal.user_id}/unlock`, {}, { headers: apiHeaders() })
      toast.success('¡Contacto desbloqueado!')
      if (r.data.new_balance !== undefined) setCreditBalance(r.data.new_balance)
      setUnlockModal(null)
      setMarketplace(prev => prev.map(l =>
        l.user_id === unlockModal.user_id
          ? { ...l, is_unlocked: true, full_name: r.data.full_name, email: r.data.email, phone: r.data.phone, whatsapp: r.data.whatsapp, country: r.data.country, display_name: r.data.full_name || l.display_name }
          : l
      ))
      fetchCredits()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Error al desbloquear')
    } finally { setUnlocking(false) }
  }

  // ── Purchase credits — redirects to Drons Pay checkout ──
  const handlePurchase = async (pkgId: string) => {
    setPurchasingPkg(pkgId)
    try {
      const r = await API.post('/credits/purchase', { package_id: pkgId }, { headers: apiHeaders() })
      window.location.href = r.data.checkout_url
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Error al iniciar el pago')
      setPurchasingPkg(null)
    }
  }

  // ── Derived filter data (must be at top level — Rules of Hooks) ──────────────
  const availableProjects = useMemo(() => {
    const seen = new Map<string, string>()
    marketplace.filter(l => !l.is_unlocked).forEach(lead => {
      lead.properties.forEach(p => {
        if (p.project_name && !seen.has(p.project_name)) {
          seen.set(p.project_name, p.project_name)
        }
      })
    })
    return Array.from(seen.values()).sort()
  }, [marketplace])

  const filteredLockedLeads = useMemo(() => {
    return marketplace.filter(l => {
      if (l.is_unlocked) return false
      if (filterTier !== 'all' && l.tier_key !== filterTier) return false
      if (filterProject !== 'all' && !l.properties.some(p => p.project_name === filterProject)) return false
      return true
    })
  }, [marketplace, filterTier, filterProject])

  // ─────────────────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  )

  // ══ DASHBOARD ══════════════════════════════════════════════════════════════
  if (advisor) {
    const unlockedLeads = marketplace.filter(l => l.is_unlocked)
    const lockedLeads = filteredLockedLeads

    return (
      <div className="min-h-screen bg-slate-50">
        {/* Navbar */}
        <nav className="sticky top-0 z-40 bg-white border-b border-slate-100 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-4">
            <a href="/public" className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 transition-colors text-sm">
              <ChevronLeft className="w-4 h-4" /> Volver al portal
            </a>
            <div className="flex items-center gap-2 ml-2">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <Building2 className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-bold text-slate-800 text-sm">Portal de Asesores</span>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDashTab('credits')}
                className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all text-xs font-bold ${dashTab === 'credits' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'}`}
              >
                <Coins className="w-3.5 h-3.5" />
                {creditBalance} cr
              </button>
              <div className="hidden sm:flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-1.5">
                <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600">{advisor.name[0].toUpperCase()}</div>
                <div className="text-xs leading-tight">
                  <p className="font-semibold text-slate-700">{advisor.name}</p>
                  {advisor.developer_name && <p className="text-slate-400">{advisor.developer_name}</p>}
                </div>
              </div>
              <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-500 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50">
                <LogOut className="w-3.5 h-3.5" /> Salir
              </button>
            </div>
          </div>

          {/* Dashboard tabs */}
          <div className="max-w-6xl mx-auto px-4 flex gap-1 border-t border-slate-100">
            {[
              { id: 'marketplace', label: 'Marketplace',   Icon: ShoppingBag, count: lockedLeads.length   },
              { id: 'contacts',    label: 'Mis contactos', Icon: UserCheck,   count: unlockedLeads.length },
              { id: 'credits',     label: 'Créditos',      Icon: Coins,       count: null                 },
            ].map(({ id, label, Icon, count }) => (
              <button
                key={id}
                onClick={() => setDashTab(id as typeof dashTab)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${dashTab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                <Icon className="w-4 h-4" />
                {label}
                {count !== null && count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${dashTab === id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
                )}
              </button>
            ))}
          </div>
        </nav>

        <div className="max-w-6xl mx-auto px-4 py-8">

          {/* ── MARKETPLACE tab ── */}
          {dashTab === 'marketplace' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h1 className="text-xl font-bold text-slate-800">Marketplace de leads</h1>
                  <p className="text-sm text-slate-500 mt-0.5">Clientes interesados en propiedades de {advisor.developer_name || 'tu desarrolladora'}</p>
                </div>
                {!advisor.developer_id && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm text-amber-700">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    Contacta al administrador para que asocie tu cuenta a una desarrolladora.
                  </div>
                )}
              </div>

              {marketplaceMsg && !marketplace.length && (
                <div className="text-center py-20 text-slate-400">
                  <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>{marketplaceMsg}</p>
                </div>
              )}

              {/* ── Filters ── */}
              {!marketplaceLoading && marketplace.some(l => !l.is_unlocked) && (
                <div className="flex flex-wrap items-center gap-3">
                  {/* Tier chips */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="flex items-center gap-1 text-xs text-slate-500 font-medium mr-1">
                      <Filter className="w-3.5 h-3.5" /> Temperatura:
                    </span>
                    {[
                      { key: 'all',         label: 'Todos' },
                      { key: 'muy_caliente', label: 'Muy caliente', color: 'bg-red-100 text-red-700 border-red-200',     activeColor: 'bg-red-500 text-white border-red-500' },
                      { key: 'caliente',     label: 'Caliente',     color: 'bg-orange-100 text-orange-700 border-orange-200', activeColor: 'bg-orange-500 text-white border-orange-500' },
                      { key: 'tibio',        label: 'Tibio',        color: 'bg-amber-100 text-amber-700 border-amber-200',   activeColor: 'bg-amber-500 text-white border-amber-500' },
                      { key: 'frio',         label: 'Frío',         color: 'bg-slate-100 text-slate-600 border-slate-200',   activeColor: 'bg-slate-500 text-white border-slate-500' },
                    ].map(({ key, label, color, activeColor }) => (
                      <button
                        key={key}
                        onClick={() => setFilterTier(key)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                          filterTier === key
                            ? (activeColor || 'bg-slate-800 text-white border-slate-800')
                            : (color || 'bg-white text-slate-600 border-slate-200 hover:border-slate-300')
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Project dropdown */}
                  {availableProjects.length > 1 && (
                    <div className="relative">
                      <button
                        onClick={e => { e.stopPropagation(); setProjectDropdownOpen(v => !v) }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:border-slate-300 transition-colors"
                      >
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        {filterProject === 'all' ? 'Todos los proyectos' : filterProject}
                        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${projectDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {projectDropdownOpen && (
                        <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[200px]">
                          <button
                            onClick={() => { setFilterProject('all'); setProjectDropdownOpen(false) }}
                            className={`w-full text-left px-4 py-2 text-xs font-medium transition-colors ${filterProject === 'all' ? 'text-blue-600 bg-blue-50' : 'text-slate-600 hover:bg-slate-50'}`}
                          >
                            Todos los proyectos
                          </button>
                          {availableProjects.map(name => (
                            <button
                              key={name}
                              onClick={() => { setFilterProject(name); setProjectDropdownOpen(false) }}
                              className={`w-full text-left px-4 py-2 text-xs font-medium transition-colors ${filterProject === name ? 'text-blue-600 bg-blue-50' : 'text-slate-600 hover:bg-slate-50'}`}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Active filter count / clear */}
                  {(filterTier !== 'all' || filterProject !== 'all') && (
                    <button
                      onClick={() => { setFilterTier('all'); setFilterProject('all') }}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors ml-1"
                    >
                      <X className="w-3.5 h-3.5" /> Limpiar filtros
                    </button>
                  )}
                </div>
              )}

              {marketplaceLoading ? (
                <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>
              ) : lockedLeads.length === 0 && !marketplaceMsg ? (
                <div className="text-center py-20 text-slate-400">
                  <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  {filterTier !== 'all' || filterProject !== 'all'
                    ? <p>No hay leads que coincidan con los filtros seleccionados.</p>
                    : <p>No hay leads disponibles en este momento.</p>
                  }
                  {(filterTier !== 'all' || filterProject !== 'all') && (
                    <button onClick={() => { setFilterTier('all'); setFilterProject('all') }} className="mt-2 text-sm text-blue-600 hover:underline font-medium">
                      Limpiar filtros
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {lockedLeads.map(lead => {
                    const tierCfg = TIER_CFG[lead.tier_key] || TIER_CFG.frio
                    return (
                      <div key={lead.user_id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                        {/* Card header */}
                        <div className={`px-4 py-3 flex items-center justify-between ${tierCfg.bg} border-b ${tierCfg.border}`}>
                          <div className="flex items-center gap-2.5">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white ${lead.tier_key === 'muy_caliente' ? 'bg-red-500' : lead.tier_key === 'caliente' ? 'bg-orange-500' : lead.tier_key === 'tibio' ? 'bg-amber-500' : 'bg-slate-400'}`}>
                              {lead.display_name[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="font-semibold text-slate-800 text-sm">{lead.display_name}</p>
                              {lead.masked_email && <p className="text-xs text-slate-400">{lead.masked_email}</p>}
                            </div>
                          </div>
                          <TierBadge tier={lead.tier_key} score={lead.score} />
                        </div>

                        {/* Properties */}
                        <div className="px-4 py-3 space-y-2">
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Interesado en</p>
                          {lead.properties.slice(0, 3).map(p => (
                            <div key={p.id} className="flex items-start gap-2">
                              <div className="mt-0.5 flex-shrink-0">
                                {p.interested
                                  ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                  : p.rating ? <Star className="w-3 h-3 text-amber-400" /> : <div className="w-3 h-3 rounded-full bg-slate-200" />}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs text-slate-700 font-medium truncate">{p.title}</p>
                                {(p.project_name || p.project_location) && (
                                  <p className="text-[10px] text-slate-400 truncate">
                                    {[p.project_name, p.project_location].filter(Boolean).join(' · ')}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                          {lead.properties.length > 3 && <p className="text-[10px] text-slate-400">+{lead.properties.length - 3} propiedades más</p>}
                        </div>

                        {/* Footer: price + unlock */}
                        <div className="px-4 pb-4 pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] text-slate-400 uppercase font-semibold">Costo de desbloqueo</p>
                            <p className={`text-lg font-black flex items-center gap-1 ${tierCfg.color}`}>
                              {lead.price > 0
                                ? <><Coins className="w-4 h-4" />{lead.price} crédito{lead.price !== 1 ? 's' : ''}</>
                                : 'Gratis'}
                            </p>
                          </div>
                          <button
                            onClick={() => setUnlockModal(lead)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all hover:brightness-105 active:scale-[0.98] ${lead.tier_key === 'muy_caliente' ? 'bg-red-500' : lead.tier_key === 'caliente' ? 'bg-orange-500' : lead.tier_key === 'tibio' ? 'bg-amber-500' : 'bg-slate-500'}`}
                          >
                            <Unlock className="w-3.5 h-3.5" /> Desbloquear
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── CONTACTS tab ── */}
          {dashTab === 'contacts' && (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-bold text-slate-800">Mis contactos</h1>
                <p className="text-sm text-slate-500 mt-0.5">{unlockedLeads.length} lead{unlockedLeads.length !== 1 ? 's' : ''} desbloqueado{unlockedLeads.length !== 1 ? 's' : ''}</p>
              </div>

              {unlockedLeads.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                  <Lock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>Aún no has desbloqueado ningún contacto.</p>
                  <button onClick={() => setDashTab('marketplace')} className="mt-3 text-sm text-blue-600 hover:underline font-medium">Ir al Marketplace</button>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                        <th className="text-left px-5 py-3 font-semibold">Lead</th>
                        <th className="text-left px-4 py-3 font-semibold">Contacto</th>
                        <th className="text-left px-4 py-3 font-semibold">País</th>
                        <th className="text-left px-4 py-3 font-semibold">Puntuación</th>
                        <th className="text-left px-4 py-3 font-semibold">Propiedades</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {unlockedLeads.map(lead => (
                        <tr key={lead.user_id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 flex-shrink-0">
                                {(lead.full_name || lead.email || '?')[0].toUpperCase()}
                              </div>
                              <div>
                                <p className="font-medium text-slate-800">{lead.full_name || <span className="italic text-slate-400">Sin nombre</span>}</p>
                                {lead.email && <p className="text-xs text-slate-400">{lead.email}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 space-y-0.5">
                            {lead.phone && <p className="text-xs text-slate-600 flex items-center gap-1"><Phone className="w-3 h-3 text-slate-400" />{lead.phone}</p>}
                            {lead.whatsapp && (
                              <a href={`https://wa.me/${lead.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
                                <Phone className="w-3 h-3" />WA: {lead.whatsapp}
                              </a>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-slate-500 text-sm">{lead.country || '-'}</td>
                          <td className="px-4 py-3.5"><TierBadge tier={lead.tier_key} score={lead.score} /></td>
                          <td className="px-4 py-3.5 text-xs text-slate-500">{lead.properties.length} propiedad{lead.properties.length !== 1 ? 'es' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── CREDITS tab ── */}
          {dashTab === 'credits' && (
            <div className="space-y-8">
              {/* Header */}
              <div>
                <h1 className="text-xl font-bold text-slate-800">Mis créditos</h1>
                <p className="text-sm text-slate-500 mt-0.5">Compra créditos para desbloquear contactos del marketplace</p>
              </div>

              {/* Balance card */}
              <div className="rounded-2xl p-6 text-white shadow-lg" style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 60%, #3b82f6 100%)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-200 text-sm font-medium">Saldo disponible</p>
                    <p className="text-6xl font-black mt-1 tracking-tight">{creditBalance}</p>
                    <p className="text-blue-200 text-sm mt-1">crédito{creditBalance !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center">
                    <Coins className="w-12 h-12 text-white/70" />
                  </div>
                </div>
                {creditBalance === 0 && (
                  <div className="mt-5 bg-white/10 rounded-xl px-4 py-2.5 text-sm text-blue-100">
                    Aún no tienes créditos. ¡Elige un paquete para empezar a desbloquear leads!
                  </div>
                )}
              </div>

              {/* Credit packages */}
              <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Paquetes disponibles</h2>
                {creditPackages.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
                    {loadingCredits ? 'Cargando paquetes...' : 'No hay paquetes disponibles en este momento.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {creditPackages.map(pkg => (
                      <div
                        key={pkg.id}
                        className={`relative rounded-2xl border-2 p-5 flex flex-col gap-4 transition-all hover:shadow-md ${pkg.is_highlighted ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                      >
                        {pkg.badge && (
                          <span className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${pkg.is_highlighted ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white'}`}>
                            {pkg.badge}
                          </span>
                        )}

                        <div>
                          <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${pkg.is_highlighted ? 'text-blue-500' : 'text-slate-400'}`}>
                            {pkg.label}
                          </p>
                          <div className="flex items-end gap-2">
                            <span className="text-4xl font-black text-slate-800 leading-none">{pkg.credits}</span>
                            <span className="text-slate-500 font-medium text-sm mb-0.5">créditos</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 text-sm text-slate-500">
                          <Coins className="w-4 h-4 text-amber-400 flex-shrink-0" />
                          <span className="font-semibold">${(pkg.price / pkg.credits).toFixed(2)}</span>
                          <span className="text-slate-400">por crédito</span>
                        </div>

                        <div className="mt-auto pt-2 border-t border-slate-100 space-y-3">
                          <p className="text-2xl font-black text-slate-800">
                            ${pkg.price}
                            <span className="text-sm font-medium text-slate-400 ml-1">USD</span>
                          </p>
                          <button
                            onClick={() => handlePurchase(pkg.id)}
                            disabled={purchasingPkg === pkg.id}
                            className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-105 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 ${pkg.is_highlighted ? 'bg-blue-600 text-white' : 'bg-slate-800 text-white'}`}
                          >
                            <CreditCard className="w-4 h-4" />
                            {purchasingPkg === pkg.id ? 'Procesando...' : 'Comprar'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5" />
                  Los créditos se acreditan al instante.
                </p>
              </div>

              {/* Transaction history */}
              <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Historial de transacciones</h2>
                {transactions.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 flex flex-col items-center justify-center py-16 gap-3">
                    <History className="w-10 h-10 text-slate-200" />
                    <p className="text-slate-400 text-sm">No hay transacciones registradas aún.</p>
                    <p className="text-xs text-slate-300">Tus compras de créditos aparecerán aquí.</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50 text-[11px] text-slate-400 uppercase tracking-wider">
                          <th className="text-left px-5 py-3 font-semibold">Descripción</th>
                          <th className="text-right px-4 py-3 font-semibold">Monto</th>
                          <th className="text-right px-4 py-3 font-semibold">Saldo</th>
                          <th className="text-right px-5 py-3 font-semibold">Fecha</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {transactions.map(tx => (
                          <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-5 py-3.5 text-slate-700">
                              {tx.description || (tx.type === 'purchase' ? 'Compra de créditos' : tx.type === 'deduction' ? 'Desbloqueo de lead' : tx.type)}
                            </td>
                            <td className={`px-4 py-3.5 text-right font-bold ${tx.amount > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {tx.amount > 0 ? '+' : ''}{tx.amount} cr
                            </td>
                            <td className="px-4 py-3.5 text-right text-slate-500 text-xs">{tx.balance_after} cr</td>
                            <td className="px-5 py-3.5 text-right text-slate-400 text-xs">
                              {tx.created_at ? new Date(tx.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* ── Unlock confirm modal ── */}
        {unlockModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
              <div className="flex items-start justify-between">
                <h2 className="text-base font-bold text-slate-800">Desbloquear contacto</h2>
                <button onClick={() => setUnlockModal(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className={`rounded-xl p-4 space-y-2 border ${(TIER_CFG[unlockModal.tier_key] || TIER_CFG.frio).border} ${(TIER_CFG[unlockModal.tier_key] || TIER_CFG.frio).bg}`}>
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-slate-800">{unlockModal.display_name}</p>
                  <TierBadge tier={unlockModal.tier_key} score={unlockModal.score} />
                </div>
                <p className="text-xs text-slate-500">{unlockModal.properties.length} propiedad{unlockModal.properties.length !== 1 ? 'es' : ''} de interés</p>
              </div>

              <div className="bg-slate-50 rounded-xl p-4 text-center space-y-1">
                <p className="text-xs text-slate-500">Créditos necesarios</p>
                <p className="text-3xl font-black text-slate-800 flex items-center justify-center gap-2">
                  <Coins className="w-7 h-7 text-amber-500" />
                  {unlockModal.price > 0 ? `${unlockModal.price}` : 'Gratis'}
                </p>
                {unlockModal.price > 0 && (
                  <p className="text-xs text-slate-400">
                    Saldo tras desbloqueo: <span className={creditBalance - unlockModal.price < 0 ? 'text-red-500 font-bold' : 'font-semibold text-slate-600'}>{creditBalance - unlockModal.price} cr</span>
                  </p>
                )}
              </div>

              {creditBalance < unlockModal.price && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  No tienes suficientes créditos.{' '}
                  <button onClick={() => { setUnlockModal(null); setDashTab('credits') }} className="underline font-semibold">Comprar créditos</button>
                </div>
              )}

              {creditBalance >= unlockModal.price && (
                <p className="text-xs text-slate-500 text-center">
                  Al confirmar se descontarán los créditos y podrás ver el nombre completo, correo, teléfono y WhatsApp del lead.
                </p>
              )}

              <div className="flex gap-2">
                <button onClick={() => setUnlockModal(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 font-medium transition-colors">
                  Cancelar
                </button>
                <button onClick={handleUnlock} disabled={unlocking || creditBalance < unlockModal.price}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  <Unlock className="w-4 h-4" />
                  {unlocking ? 'Desbloqueando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // No advisor session → redirect to auth page
  return <Navigate to="/advisor/auth" replace />
}
