import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Mail, Eye, EyeOff, Lock, AlertCircle } from 'lucide-react'
import API from '../../services/api'
import { session } from '../../services/session'

export default function AdminAuthPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Already logged in as admin → go to panel
  useEffect(() => {
    if (session.getType() === 'admin') navigate('/', { replace: true })
  }, [navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await API.post('/auth/admin/login', { email: email.trim(), password })
      session.clear()
      session.set({ type: 'admin', token: r.data.token, name: r.data.user.name, email: r.data.user.email })
      navigate('/', { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Credenciales incorrectas.')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 px-4">

      {/* Card */}
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-900/40">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-black text-white tracking-tight">Panel de Administración</h1>
            <p className="text-slate-500 text-sm mt-0.5">Acceso restringido al equipo interno</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-7 space-y-5 shadow-2xl">

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Correo electrónico</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="admin@ejemplo.com" required autoFocus
                className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
              <input
                type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required
                className="w-full pl-10 pr-10 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-950/60 border border-red-900 rounded-xl px-4 py-2.5 text-sm text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
          >
            {loading
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verificando…</>
              : 'Iniciar sesión'}
          </button>
        </form>

        <p className="text-center text-slate-700 text-xs mt-6">
          ¿Eres asesor?{' '}
          <a href="/advisor/auth" className="text-slate-500 hover:text-slate-300 transition-colors">Acceso asesores</a>
          {' · '}
          <a href="/public" className="text-slate-500 hover:text-slate-300 transition-colors">Portal público</a>
        </p>
      </div>
    </div>
  )
}
