import { useState, useEffect } from 'react'
import {
  Building2, LogOut, User, Phone, Mail, FileCheck, FileQuestion,
  Clock, FileX, ChevronLeft, Lock, Eye, EyeOff, ArrowRight, UserPlus,
} from 'lucide-react'
import API from '../../services/api'
import toast from 'react-hot-toast'

const ADVISOR_TOKEN_KEY = 'advisor_token'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Advisor {
  id: string
  name: string
  email: string | null
  phone: string | null
  whatsapp_number: string | null
  is_active: boolean
}

interface Lead {
  user_id: string | null
  full_name: string | null
  whatsapp: string | null
  email: string | null
  document_number: string | null
  country_of_residence: string | null
  financial_capacity_doc: string | null
  financial_doc_status: string | null
  rating: number | null
  session_id: string
  updated_at: string | null
}

// ─── Small components ─────────────────────────────────────────────────────────

function DocBadge({ status }: { status: string | null }) {
  if (status === 'approved')
    return <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full"><FileCheck className="w-3 h-3" />Aprobado</span>
  if (status === 'rejected')
    return <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full"><FileX className="w-3 h-3" />Rechazado</span>
  if (status === 'pending')
    return <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full"><Clock className="w-3 h-3" />En revisión</span>
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full"><FileQuestion className="w-3 h-3" />Sin validar</span>
}

function PasswordInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? '••••••••••'}
        className="w-full pl-10 pr-10 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

function formatDate(val?: string | null) {
  if (!val) return '-'
  const d = new Date(val)
  return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('es-PE')
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdvisorPortalPage() {
  const [advisor, setAdvisor] = useState<Advisor | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [tab, setTab] = useState<'login' | 'register'>('login')

  // login form
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  // register form
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirm, setRegConfirm] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [regDone, setRegDone] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem(ADVISOR_TOKEN_KEY)
    if (!token) { setAuthLoading(false); return }
    API.get('/chat/advisors/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setAdvisor(r.data); fetchLeads(r.data.id, token) })
      .catch(() => localStorage.removeItem(ADVISOR_TOKEN_KEY))
      .finally(() => setAuthLoading(false))
  }, [])

  const fetchLeads = async (advisorId: string, token: string) => {
    setLoadingLeads(true)
    try {
      const r = await API.get(`/chat/advisors/${advisorId}/clients`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setLeads(r.data.clients ?? [])
    } catch { /* non-critical */ }
    finally { setLoadingLeads(false) }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginLoading(true)
    try {
      const r = await API.post('/chat/advisors/login', { email: loginEmail.trim(), password: loginPassword })
      localStorage.setItem(ADVISOR_TOKEN_KEY, r.data.token)
      setAdvisor(r.data.advisor)
      fetchLeads(r.data.advisor.id, r.data.token)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Credenciales incorrectas')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (regPassword !== regConfirm) { toast.error('Las contraseñas no coinciden'); return }
    if (regPassword.length < 6) { toast.error('La contraseña debe tener al menos 6 caracteres'); return }
    setRegLoading(true)
    try {
      await API.post('/chat/advisors/register', {
        name: regName.trim(),
        email: regEmail.trim(),
        phone: regPhone.trim() || null,
        password: regPassword,
      })
      setRegDone(true)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Error al registrarse')
    } finally {
      setRegLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem(ADVISOR_TOKEN_KEY)
    setAdvisor(null)
    setLeads([])
  }

  // ── Loading spinner ──
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  // ── Dashboard (logged in) ──
  if (advisor) {
    return (
      <div className="min-h-screen bg-slate-50">
        <nav className="sticky top-0 z-40 bg-white border-b border-slate-100 shadow-sm">
          <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-4">
            <a href="/public" className="flex items-center gap-2 text-slate-500 hover:text-slate-700 transition-colors text-sm">
              <ChevronLeft className="w-4 h-4" />
              Volver al portal
            </a>
            <div className="flex items-center gap-2 ml-2">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <Building2 className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-bold text-slate-800 text-sm">Portal de Asesores</span>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600">
                {advisor.name[0].toUpperCase()}
              </div>
              <span className="text-sm font-medium text-slate-700 hidden sm:block">{advisor.name}</span>
              <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-500 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50">
                <LogOut className="w-3.5 h-3.5" />
                Salir
              </button>
            </div>
          </div>
        </nav>

        <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Bienvenido, {advisor.name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {loadingLeads ? 'Cargando leads...' : `${leads.length} lead${leads.length !== 1 ? 's' : ''} asignado${leads.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-100 p-4 flex flex-wrap gap-4 text-sm text-slate-600">
            {advisor.email && <span className="flex items-center gap-1.5"><Mail className="w-4 h-4 text-slate-400" />{advisor.email}</span>}
            {advisor.phone && <span className="flex items-center gap-1.5"><Phone className="w-4 h-4 text-slate-400" />{advisor.phone}</span>}
          </div>

          {loadingLeads ? (
            <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>
          ) : leads.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <User className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Aún no tienes leads asignados.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                    <th className="text-left px-5 py-3 font-semibold">Lead</th>
                    <th className="text-left px-4 py-3 font-semibold">Contacto</th>
                    <th className="text-left px-4 py-3 font-semibold">País</th>
                    <th className="text-left px-4 py-3 font-semibold">Doc. financiero</th>
                    <th className="text-left px-4 py-3 font-semibold">Última actividad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leads.map(lead => (
                    <tr key={lead.session_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 flex-shrink-0">
                            {(lead.full_name || lead.email || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-slate-800">{lead.full_name || <span className="text-slate-400 italic">Sin nombre</span>}</p>
                            {lead.email && <p className="text-xs text-slate-400">{lead.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="space-y-0.5">
                          {lead.whatsapp && (
                            <a href={`https://wa.me/${lead.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-emerald-600 hover:underline text-xs">
                              <Phone className="w-3 h-3" />{lead.whatsapp}
                            </a>
                          )}
                          {lead.document_number && <p className="text-xs text-slate-400">DNI: {lead.document_number}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-500 text-sm">{lead.country_of_residence || <span className="text-slate-300">-</span>}</td>
                      <td className="px-4 py-3.5"><DocBadge status={lead.financial_capacity_doc ? lead.financial_doc_status : null} /></td>
                      <td className="px-4 py-3.5 text-slate-400 text-xs">{formatDate(lead.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Auth page ──
  return (
    <div className="min-h-screen relative flex flex-col overflow-hidden" style={{ background: 'linear-gradient(135deg, #e8f0fe 0%, #dce8fb 40%, #cfe0f8 100%)' }}>
      {/* Decorative blobs */}
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full opacity-30" style={{ background: 'radial-gradient(circle, #93c5fd 0%, #60a5fa 60%, transparent 100%)', transform: 'translate(-30%, 30%)' }} />
      <div className="absolute top-0 right-0 w-[350px] h-[350px] rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #a5b4fc 0%, transparent 70%)', transform: 'translate(30%, -30%)' }} />

      {/* Navbar */}
      <nav className="relative z-10 px-6 py-4 flex items-center gap-4">
        <a href="/public" className="flex items-center gap-2 text-slate-600 hover:text-slate-800 transition-colors text-sm font-medium">
          <ChevronLeft className="w-4 h-4" />
          Volver al portal
        </a>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-slate-800">Portal de Asesores</span>
        </div>
      </nav>

      {/* Card */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-10">
        <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl border border-white/60 w-full max-w-[540px] h-[720px] flex flex-col overflow-hidden">

          {/* ── Tabs (fixed top) ── */}
          <div className="flex-shrink-0 px-8 pt-8 pb-0">
            <div className="flex gap-2 bg-slate-100 rounded-2xl p-1">
              <button
                onClick={() => setTab('login')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === 'login' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <User className="w-4 h-4" />
                Iniciar sesión
              </button>
              <button
                onClick={() => { setTab('register'); setRegDone(false) }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === 'register' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <UserPlus className="w-4 h-4" />
                Registrarse
              </button>
            </div>
          </div>

          {/* ── Login form ── */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="flex flex-col flex-1 overflow-hidden">
              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-8 pt-6 pb-2 space-y-4">
                <div className="text-center mb-5">
                  <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
                    <User className="w-7 h-7 text-blue-600" />
                  </div>
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

              {/* Fixed footer */}
              <div className="flex-shrink-0 px-8 pb-8 pt-4 space-y-3 border-t border-slate-100 bg-white/80">
                <button type="submit" disabled={loginLoading} className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}>
                  <ArrowRight className="w-4 h-4" />
                  {loginLoading ? 'Ingresando...' : 'Ingresar'}
                </button>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-xs text-slate-400">o continúa con</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                <button type="button" className="w-full py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  Google
                </button>
                <p className="text-center text-sm text-slate-500">
                  ¿Aún no tienes cuenta?{' '}
                  <button type="button" onClick={() => setTab('register')} className="text-blue-600 font-semibold hover:underline">Regístrate</button>
                  {' '}para acceder al portal.
                </p>
              </div>
            </form>
          )}

          {/* ── Register form ── */}
          {tab === 'register' && !regDone && (
            <form onSubmit={handleRegister} className="flex flex-col flex-1 overflow-hidden">
              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-8 pt-6 pb-2 space-y-4">
                <div className="text-center mb-5">
                  <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
                    <User className="w-7 h-7 text-blue-600" />
                  </div>
                  <h1 className="text-2xl font-bold text-slate-800">Crear cuenta</h1>
                  <p className="text-sm text-slate-500 mt-1.5">Completa el formulario para solicitar acceso al portal de asesores</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Nombre completo</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="text" value={regName} onChange={e => setRegName(e.target.value)} placeholder="Tu nombre" required className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Correo electrónico</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} placeholder="tu@correo.com" required className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Teléfono <span className="text-slate-400 font-normal">(opcional)</span></label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="tel" value={regPhone} onChange={e => setRegPhone(e.target.value)} placeholder="+51 999 999 999" className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Contraseña</label>
                  <PasswordInput value={regPassword} onChange={setRegPassword} placeholder="Mínimo 6 caracteres" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Confirmar contraseña</label>
                  <PasswordInput value={regConfirm} onChange={setRegConfirm} placeholder="Repite tu contraseña" />
                  {regConfirm && regPassword !== regConfirm && (
                    <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>
                  )}
                </div>
              </div>

              {/* Fixed footer */}
              <div className="flex-shrink-0 px-8 pb-8 pt-4 space-y-3 border-t border-slate-100 bg-white/80">
                <button type="submit" disabled={regLoading || (!!regConfirm && regPassword !== regConfirm)} className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}>
                  <UserPlus className="w-4 h-4" />
                  {regLoading ? 'Enviando...' : 'Crear cuenta'}
                </button>
                <p className="text-center text-sm text-slate-500">
                  ¿Ya tienes cuenta?{' '}
                  <button type="button" onClick={() => setTab('login')} className="text-blue-600 font-semibold hover:underline">Inicia sesión</button>
                </p>
              </div>
            </form>
          )}

          {/* ── Register success ── */}
          {tab === 'register' && regDone && (
            <div className="flex flex-col flex-1 items-center justify-center px-8 pb-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                <FileCheck className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-lg font-bold text-slate-800">¡Solicitud enviada!</h2>
              <p className="text-sm text-slate-500">Tu cuenta está pendiente de aprobación. Un administrador revisará tu solicitud y te habilitará el acceso.</p>
              <button onClick={() => { setTab('login'); setRegDone(false) }} className="w-full py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                Volver al inicio de sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
