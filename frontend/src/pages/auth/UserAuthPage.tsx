import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  User, Mail, Lock, Eye, EyeOff, Phone, ArrowRight,
  UserPlus, CheckCircle2, AlertCircle, Building2, ChevronLeft,
} from 'lucide-react'
import API from '../../services/api'
import { session } from '../../services/session'
import toast from 'react-hot-toast'

function PasswordField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? '••••••••'}
        className="w-full pl-10 pr-10 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
      <button type="button" onClick={() => setShow(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

export default function UserAuthPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string })?.from ?? '/public'

  const [tab, setTab] = useState<'login' | 'register'>('login')

  // Login state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  // Register state
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regPass, setRegPass] = useState('')
  const [regConfirm, setRegConfirm] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [regDone, setRegDone] = useState(false)

  // Already logged in as user → go to portal
  useEffect(() => {
    if (session.getType() === 'user') navigate(from, { replace: true })
  }, [navigate, from])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginLoading(true)
    try {
      const r = await API.post('/auth/login', { email: loginEmail.trim(), password: loginPass })
      session.clear()
      session.set({ type: 'user', token: r.data.token, name: r.data.user.name, email: r.data.user.email })
      navigate(from, { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Correo o contraseña incorrectos.')
    } finally { setLoginLoading(false) }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (regPass !== regConfirm) { toast.error('Las contraseñas no coinciden.'); return }
    if (regPass.length < 6) { toast.error('Mínimo 6 caracteres.'); return }
    setRegLoading(true)
    try {
      const r = await API.post('/auth/register', { name: regName.trim(), email: regEmail.trim(), phone: regPhone.trim() || null, password: regPass })
      session.clear()
      session.set({ type: 'user', token: r.data.token, name: r.data.user.name, email: r.data.user.email })
      setRegDone(true)
      setTimeout(() => navigate(from, { replace: true }), 1800)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Error al registrarse.')
    } finally { setRegLoading(false) }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(135deg, #e8f0fe 0%, #dce8fb 40%, #cfe0f8 100%)' }}>
      {/* Blobs */}
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full opacity-25 pointer-events-none" style={{ background: 'radial-gradient(circle, #93c5fd 0%, transparent 70%)', transform: 'translate(-30%, 30%)' }} />
      <div className="absolute top-0 right-0 w-[350px] h-[350px] rounded-full opacity-15 pointer-events-none" style={{ background: 'radial-gradient(circle, #a5b4fc 0%, transparent 70%)', transform: 'translate(30%, -30%)' }} />

      {/* Nav */}
      <nav className="relative z-10 px-6 py-4 flex items-center gap-4">
        <a href="/public" className="flex items-center gap-1.5 text-slate-600 hover:text-slate-800 transition-colors text-sm font-medium">
          <ChevronLeft className="w-4 h-4" /> Explorar propiedades
        </a>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-slate-800">Mi Portal Inmobiliario</span>
        </div>
      </nav>

      {/* Card */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-10">
        <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl border border-white/60 w-full max-w-[480px] flex flex-col overflow-hidden">

          {/* Tabs */}
          <div className="px-8 pt-8 pb-0 flex-shrink-0">
            <div className="flex gap-2 bg-slate-100 rounded-2xl p-1">
              <button onClick={() => setTab('login')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === 'login' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <User className="w-4 h-4" /> Iniciar sesión
              </button>
              <button onClick={() => { setTab('register'); setRegDone(false) }} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === 'register' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <UserPlus className="w-4 h-4" /> Crear cuenta
              </button>
            </div>
          </div>

          {/* Login */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="flex flex-col overflow-hidden" style={{ minHeight: 380 }}>
              <div className="flex-1 overflow-y-auto px-8 pt-6 pb-2 space-y-4">
                <div className="text-center mb-4">
                  <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
                    <User className="w-7 h-7 text-blue-600" />
                  </div>
                  <h1 className="text-xl font-bold text-slate-800">Bienvenido de vuelta</h1>
                  <p className="text-sm text-slate-500 mt-1">Accede a tus favoritos y propiedades guardadas</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Correo electrónico</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="tu@correo.com" required
                      className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Contraseña</label>
                  <PasswordField value={loginPass} onChange={setLoginPass} />
                </div>
              </div>
              <div className="px-8 pb-8 pt-4 space-y-3 border-t border-slate-100 bg-white/80 flex-shrink-0">
                <button type="submit" disabled={loginLoading}
                  className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-105 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}>
                  <ArrowRight className="w-4 h-4" /> {loginLoading ? 'Ingresando…' : 'Ingresar'}
                </button>
                <p className="text-center text-sm text-slate-500">
                  ¿Sin cuenta?{' '}
                  <button type="button" onClick={() => setTab('register')} className="text-blue-600 font-semibold hover:underline">Regístrate gratis</button>
                </p>
              </div>
            </form>
          )}

          {/* Register */}
          {tab === 'register' && !regDone && (
            <form onSubmit={handleRegister} className="flex flex-col overflow-hidden" style={{ minHeight: 480 }}>
              <div className="flex-1 overflow-y-auto px-8 pt-6 pb-2 space-y-4">
                <div className="text-center mb-4">
                  <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
                    <UserPlus className="w-7 h-7 text-blue-600" />
                  </div>
                  <h1 className="text-xl font-bold text-slate-800">Crea tu cuenta</h1>
                  <p className="text-sm text-slate-500 mt-1">Guarda favoritos y recibe alertas de propiedades</p>
                </div>
                {[
                  { label: 'Nombre completo', value: regName, setter: setRegName, type: 'text', placeholder: 'Tu nombre', Icon: User, required: true },
                  { label: 'Correo electrónico', value: regEmail, setter: setRegEmail, type: 'email', placeholder: 'tu@correo.com', Icon: Mail, required: true },
                  { label: 'Teléfono (opcional)', value: regPhone, setter: setRegPhone, type: 'tel', placeholder: '+51 999 999 999', Icon: Phone, required: false },
                ].map(({ label, value, setter, type, placeholder, Icon, required }) => (
                  <div key={label}>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
                    <div className="relative">
                      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input type={type} value={value} onChange={e => setter(e.target.value)} placeholder={placeholder} required={required}
                        className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                    </div>
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Contraseña</label>
                  <PasswordField value={regPass} onChange={setRegPass} placeholder="Mínimo 6 caracteres" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Confirmar contraseña</label>
                  <PasswordField value={regConfirm} onChange={setRegConfirm} placeholder="Repite tu contraseña" />
                  {regConfirm && regPass !== regConfirm && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Las contraseñas no coinciden</p>
                  )}
                </div>
              </div>
              <div className="px-8 pb-8 pt-4 space-y-3 border-t border-slate-100 bg-white/80 flex-shrink-0">
                <button type="submit" disabled={regLoading || (!!regConfirm && regPass !== regConfirm)}
                  className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-105 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}>
                  <UserPlus className="w-4 h-4" /> {regLoading ? 'Creando cuenta…' : 'Crear cuenta'}
                </button>
                <p className="text-center text-sm text-slate-500">
                  ¿Ya tienes cuenta?{' '}
                  <button type="button" onClick={() => setTab('login')} className="text-blue-600 font-semibold hover:underline">Inicia sesión</button>
                </p>
              </div>
            </form>
          )}

          {/* Register success */}
          {tab === 'register' && regDone && (
            <div className="flex flex-col flex-1 items-center justify-center px-8 py-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-lg font-bold text-slate-800">¡Cuenta creada!</h2>
              <p className="text-sm text-slate-500">Redirigiendo al portal…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
