import { useState } from 'react'
import { X, Mail, Lock, Eye, EyeOff, Bell } from 'lucide-react'
import { SiteUser, useAuth } from '../../hooks/useAuth'

interface Props {
  onClose: () => void
  onSuccess: (user: SiteUser) => void
  primaryColor?: string
}

export default function AuthModal({ onClose, onSuccess, primaryColor = '#2563eb' }: Props) {
  const { login, register } = useAuth()
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newsletter, setNewsletter] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = tab === 'login'
        ? await login(email, password)
        : await register(email, password, newsletter)
      onSuccess(user)
      onClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Ocurrió un error. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 text-lg">
            {tab === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 px-6">
          {(['login', 'register'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError('') }}
              className={`pb-2.5 mr-6 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-current text-current'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
              style={tab === t ? { color: primaryColor, borderColor: primaryColor } : {}}
            >
              {t === 'login' ? 'Iniciar sesión' : 'Registrarse'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Correo electrónico</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="tu@correo.com"
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 transition-shadow"
                style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Mínimo 6 caracteres"
                className="w-full pl-9 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 transition-shadow"
                style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Newsletter (register only) */}
          {tab === 'register' && (
            <label className="flex items-start gap-2.5 cursor-pointer group">
              <div className="relative mt-0.5 flex-shrink-0">
                <input
                  type="checkbox"
                  checked={newsletter}
                  onChange={e => setNewsletter(e.target.checked)}
                  className="sr-only peer"
                />
                <div
                  className="w-4 h-4 rounded border-2 border-slate-300 peer-checked:border-transparent flex items-center justify-center transition-colors"
                  style={newsletter ? { backgroundColor: primaryColor, borderColor: primaryColor } : {}}
                >
                  {newsletter && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-sm text-slate-700 font-medium">
                  <Bell className="w-3.5 h-3.5 text-slate-400" />
                  Recibir novedades
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Te avisaremos sobre nuevas propiedades según tus preferencias.
                </p>
              </div>
            </label>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-xs rounded-xl px-3 py-2.5">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-white font-semibold text-sm transition-opacity disabled:opacity-60 hover:opacity-90"
            style={{ backgroundColor: primaryColor }}
          >
            {loading ? 'Cargando...' : tab === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>

          {/* Switch tab hint */}
          <p className="text-center text-xs text-slate-400">
            {tab === 'login' ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
            <button
              type="button"
              onClick={() => { setTab(tab === 'login' ? 'register' : 'login'); setError('') }}
              className="font-medium underline"
              style={{ color: primaryColor }}
            >
              {tab === 'login' ? 'Regístrate' : 'Inicia sesión'}
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}
