import { useState, useEffect, useCallback } from 'react'
import {
  Building2, LogOut, User, Phone, Mail, ChevronLeft, Lock, Eye, EyeOff,
  ArrowRight, UserPlus, Flame, Thermometer, Snowflake, Star, ShoppingBag,
  CheckCircle2, UserCheck, X,
  Unlock, AlertCircle,
} from 'lucide-react'
import API from '../../services/api'
import toast from 'react-hot-toast'

const ADVISOR_TOKEN_KEY = 'advisor_token'

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
  properties: Array<{ id: string; title: string; interested: boolean; rating: number | null }>
  full_name: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  country: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const token = localStorage.getItem(ADVISOR_TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? '••••••••••'}
        className="w-full pl-10 pr-10 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
      <button type="button" onClick={() => setShow(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdvisorPortalPage() {
  const [advisor, setAdvisor] = useState<Advisor | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login')

  // auth forms
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirm, setRegConfirm] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [regDone, setRegDone] = useState(false)

  // dashboard
  const [dashTab, setDashTab] = useState<'marketplace' | 'contacts'>('marketplace')
  const [marketplace, setMarketplace] = useState<MarketplaceLead[]>([])
  const [marketplaceCurrency, setMarketplaceCurrency] = useState('PEN')
  const [marketplaceMsg, setMarketplaceMsg] = useState<string | null>(null)
  const [marketplaceLoading, setMarketplaceLoading] = useState(false)
  const [unlockModal, setUnlockModal] = useState<MarketplaceLead | null>(null)
  const [unlocking, setUnlocking] = useState(false)


  // ── Init ──
  useEffect(() => {
    const token = localStorage.getItem(ADVISOR_TOKEN_KEY)
    if (!token) { setAuthLoading(false); return }
    API.get('/chat/advisors/me/full', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        setAdvisor(r.data)
      })
      .catch(() => localStorage.removeItem(ADVISOR_TOKEN_KEY))
      .finally(() => setAuthLoading(false))
  }, [])


  useEffect(() => {
    if (!advisor) return
    fetchMarketplace()
  }, [advisor])


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

  // ── Auth handlers ──
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginLoading(true)
    try {
      const r = await API.post('/chat/advisors/login', { email: loginEmail.trim(), password: loginPassword })
      localStorage.setItem(ADVISOR_TOKEN_KEY, r.data.token)
      // load full profile
      const full = await API.get('/chat/advisors/me/full', { headers: { Authorization: `Bearer ${r.data.token}` } })
      setAdvisor(full.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Credenciales incorrectas')
    } finally { setLoginLoading(false) }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (regPassword !== regConfirm) { toast.error('Las contraseñas no coinciden'); return }
    if (regPassword.length < 6) { toast.error('Mínimo 6 caracteres'); return }
    setRegLoading(true)
    try {
      await API.post('/chat/advisors/register', { name: regName.trim(), email: regEmail.trim(), phone: regPhone.trim() || null, password: regPassword })
      setRegDone(true)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Error al registrarse')
    } finally { setRegLoading(false) }
  }

  const handleLogout = () => { localStorage.removeItem(ADVISOR_TOKEN_KEY); setAdvisor(null); setMarketplace([]) }

  // ── Unlock ──
  const handleUnlock = async () => {
    if (!unlockModal) return
    setUnlocking(true)
    try {
      const r = await API.post(`/chat/advisors/marketplace/${unlockModal.user_id}/unlock`, {}, { headers: apiHeaders() })
      toast.success('¡Contacto desbloqueado!')
      setUnlockModal(null)
      setMarketplace(prev => prev.map(l =>
        l.user_id === unlockModal.user_id
          ? { ...l, is_unlocked: true, full_name: r.data.full_name, email: r.data.email, phone: r.data.phone, whatsapp: r.data.whatsapp, country: r.data.country, display_name: r.data.full_name || l.display_name }
          : l
      ))
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Error al desbloquear')
    } finally { setUnlocking(false) }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  )

  // ══ DASHBOARD ══════════════════════════════════════════════════════════════
  if (advisor) {
    const unlockedLeads = marketplace.filter(l => l.is_unlocked)
    const lockedLeads = marketplace.filter(l => !l.is_unlocked)

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
              { id: 'marketplace', label: 'Marketplace', Icon: ShoppingBag, count: lockedLeads.length },
              { id: 'contacts',    label: 'Mis contactos', Icon: UserCheck, count: unlockedLeads.length },
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

              {marketplaceLoading ? (
                <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>
              ) : lockedLeads.length === 0 && !marketplaceMsg ? (
                <div className="text-center py-20 text-slate-400">
                  <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No hay leads disponibles en este momento.</p>
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
                        <div className="px-4 py-3 space-y-1.5">
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Interesado en</p>
                          {lead.properties.slice(0, 3).map(p => (
                            <div key={p.id} className="flex items-center gap-2 text-xs text-slate-600">
                              {p.interested
                                ? <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                                : p.rating ? <Star className="w-3 h-3 text-amber-400 flex-shrink-0" /> : <div className="w-3 h-3 rounded-full bg-slate-200 flex-shrink-0" />}
                              <span className="truncate">{p.title}</span>
                            </div>
                          ))}
                          {lead.properties.length > 3 && <p className="text-[10px] text-slate-400">+{lead.properties.length - 3} propiedades más</p>}
                        </div>

                        {/* Footer: price + unlock */}
                        <div className="px-4 pb-4 pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] text-slate-400 uppercase font-semibold">Precio de contacto</p>
                            <p className={`text-lg font-black ${tierCfg.color}`}>
                              {lead.price > 0 ? `${marketplaceCurrency} ${lead.price.toFixed(2)}` : 'Gratis'}
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

          {/* ── PROFILE tab ── */}
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

              <div className="bg-slate-50 rounded-xl p-4 text-center">
                <p className="text-xs text-slate-500 mb-1">Precio a pagar</p>
                <p className="text-3xl font-black text-slate-800">
                  {unlockModal.price > 0 ? `${marketplaceCurrency} ${unlockModal.price.toFixed(2)}` : 'Gratis'}
                </p>
              </div>

              <p className="text-xs text-slate-500 text-center">
                Al confirmar, se registrará el pago y podrás ver el nombre completo, correo, teléfono y WhatsApp del lead.
              </p>

              <div className="flex gap-2">
                <button onClick={() => setUnlockModal(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 font-medium transition-colors">
                  Cancelar
                </button>
                <button onClick={handleUnlock} disabled={unlocking}
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

  // ══ AUTH PAGE ══════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen relative flex flex-col overflow-hidden" style={{ background: 'linear-gradient(135deg, #e8f0fe 0%, #dce8fb 40%, #cfe0f8 100%)' }}>
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full opacity-30" style={{ background: 'radial-gradient(circle, #93c5fd 0%, #60a5fa 60%, transparent 100%)', transform: 'translate(-30%, 30%)' }} />
      <div className="absolute top-0 right-0 w-[350px] h-[350px] rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #a5b4fc 0%, transparent 70%)', transform: 'translate(30%, -30%)' }} />

      <nav className="relative z-10 px-6 py-4 flex items-center gap-4">
        <a href="/public" className="flex items-center gap-2 text-slate-600 hover:text-slate-800 transition-colors text-sm font-medium">
          <ChevronLeft className="w-4 h-4" /> Volver al portal
        </a>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-slate-800">Portal de Asesores</span>
        </div>
      </nav>

      <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-10">
        <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl border border-white/60 w-full max-w-[540px] h-[720px] flex flex-col overflow-hidden">

          {/* Tabs */}
          <div className="flex-shrink-0 px-8 pt-8 pb-0">
            <div className="flex gap-2 bg-slate-100 rounded-2xl p-1">
              <button onClick={() => setAuthTab('login')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${authTab === 'login' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <User className="w-4 h-4" /> Iniciar sesión
              </button>
              <button onClick={() => { setAuthTab('register'); setRegDone(false) }} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${authTab === 'register' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <UserPlus className="w-4 h-4" /> Registrarse
              </button>
            </div>
          </div>

          {/* Login form */}
          {authTab === 'login' && (
            <form onSubmit={handleLogin} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-8 pt-6 pb-2 space-y-4">
                <div className="text-center mb-5">
                  <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3"><User className="w-7 h-7 text-blue-600" /></div>
                  <h1 className="text-2xl font-bold text-slate-800">Acceso Asesores</h1>
                  <p className="text-sm text-slate-500 mt-1.5">Ingresa con tus credenciales para gestionar tus leads y oportunidades</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Correo electrónico</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="tu@correo.com" required className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Contraseña</label>
                  <PasswordInput value={loginPassword} onChange={setLoginPassword} />
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" className="w-4 h-4 rounded accent-blue-600" defaultChecked />
                    <span className="text-sm text-slate-600">Recordarme</span>
                  </label>
                  <button type="button" className="text-sm text-blue-600 hover:underline font-medium">¿Olvidaste tu contraseña?</button>
                </div>
              </div>
              <div className="flex-shrink-0 px-8 pb-8 pt-4 space-y-3 border-t border-slate-100 bg-white/80">
                <button type="submit" disabled={loginLoading} className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-105 disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}>
                  <ArrowRight className="w-4 h-4" /> {loginLoading ? 'Ingresando...' : 'Ingresar'}
                </button>
                <p className="text-center text-sm text-slate-500">
                  ¿Aún no tienes cuenta?{' '}
                  <button type="button" onClick={() => setAuthTab('register')} className="text-blue-600 font-semibold hover:underline">Regístrate</button>
                  {' '}para acceder al portal.
                </p>
              </div>
            </form>
          )}

          {/* Register form */}
          {authTab === 'register' && !regDone && (
            <form onSubmit={handleRegister} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-8 pt-6 pb-2 space-y-4">
                <div className="text-center mb-5">
                  <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3"><User className="w-7 h-7 text-blue-600" /></div>
                  <h1 className="text-2xl font-bold text-slate-800">Crear cuenta</h1>
                  <p className="text-sm text-slate-500 mt-1.5">Completa el formulario para solicitar acceso al portal de asesores</p>
                </div>
                {[
                  { label: 'Nombre completo', value: regName, setter: setRegName, type: 'text', placeholder: 'Tu nombre', Icon: User },
                  { label: 'Correo electrónico', value: regEmail, setter: setRegEmail, type: 'email', placeholder: 'tu@correo.com', Icon: Mail },
                  { label: 'Teléfono (opcional)', value: regPhone, setter: setRegPhone, type: 'tel', placeholder: '+51 999 999 999', Icon: Phone },
                ].map(({ label, value, setter, type, placeholder, Icon }) => (
                  <div key={label}>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
                    <div className="relative">
                      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input type={type} value={value} onChange={e => setter(e.target.value)} placeholder={placeholder} required={type !== 'tel'}
                        className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                    </div>
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Contraseña</label>
                  <PasswordInput value={regPassword} onChange={setRegPassword} placeholder="Mínimo 6 caracteres" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Confirmar contraseña</label>
                  <PasswordInput value={regConfirm} onChange={setRegConfirm} placeholder="Repite tu contraseña" />
                  {regConfirm && regPassword !== regConfirm && <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>}
                </div>
              </div>
              <div className="flex-shrink-0 px-8 pb-8 pt-4 space-y-3 border-t border-slate-100 bg-white/80">
                <button type="submit" disabled={regLoading || (!!regConfirm && regPassword !== regConfirm)} className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-105 disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}>
                  <UserPlus className="w-4 h-4" /> {regLoading ? 'Enviando...' : 'Crear cuenta'}
                </button>
                <p className="text-center text-sm text-slate-500">
                  ¿Ya tienes cuenta?{' '}
                  <button type="button" onClick={() => setAuthTab('login')} className="text-blue-600 font-semibold hover:underline">Inicia sesión</button>
                </p>
              </div>
            </form>
          )}

          {/* Register success */}
          {authTab === 'register' && regDone && (
            <div className="flex flex-col flex-1 items-center justify-center px-8 pb-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-lg font-bold text-slate-800">¡Solicitud enviada!</h2>
              <p className="text-sm text-slate-500">Tu cuenta está pendiente de aprobación. Un administrador te habilitará el acceso.</p>
              <button onClick={() => { setAuthTab('login'); setRegDone(false) }} className="w-full py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                Volver al inicio de sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
