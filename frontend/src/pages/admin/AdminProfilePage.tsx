import { useState, useEffect, useRef } from 'react'
import {
  User, Phone, Globe, Lock, Eye, EyeOff, Save, ShieldCheck,
  CheckCircle, AlertCircle, Mail, AtSign,
} from 'lucide-react'
import { session } from '../../services/session'
import { authAdminMe, updateAdminProfile, changeAdminPassword } from '../../services/api'
import toast from 'react-hot-toast'

interface AdminUser {
  id: string
  email: string
  name: string | null
  phone: string | null
  whatsapp: string | null
  country: string | null
}

const inputCls =
  'w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white placeholder:text-gray-300 transition-shadow'

function FieldGroup({ icon: Icon, label, children }: {
  icon: React.ElementType; label: string; children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </label>
      {children}
    </div>
  )
}

export default function AdminProfilePage() {
  const token = session.getToken() ?? ''
  const [user, setUser] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Profile form
  const [name, setName]         = useState('')
  const [phone, setPhone]       = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [country, setCountry]   = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Password form
  const [currentPwd, setCurrentPwd]   = useState('')
  const [newPwd, setNewPwd]           = useState('')
  const [confirmPwd, setConfirmPwd]   = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew]         = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [savingPwd, setSavingPwd]     = useState(false)

  const securityRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    authAdminMe(token)
      .then(r => {
        const u: AdminUser = r.data
        setUser(u)
        setName(u.name ?? '')
        setPhone(u.phone ?? '')
        setWhatsapp(u.whatsapp ?? '')
        setCountry(u.country ?? '')
      })
      .catch(() => toast.error('No se pudo cargar el perfil'))
      .finally(() => setLoading(false))
  }, [token])

  // Scroll to #security if URL has hash
  useEffect(() => {
    if (window.location.hash === '#security') {
      setTimeout(() => securityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    }
  }, [])

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const res = await updateAdminProfile(token, {
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
        country: country.trim() || undefined,
      })
      setUser(res.data)
      // Sync name in session
      const s = session.get()
      if (s) session.set({ ...s, name: res.data.name ?? s.name })
      toast.success('Perfil actualizado')
    } catch {
      toast.error('Error al guardar el perfil')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPwd) { toast.error('Ingresa tu contraseña actual'); return }
    if (newPwd.length < 6) { toast.error('La nueva contraseña debe tener al menos 6 caracteres'); return }
    if (newPwd !== confirmPwd) { toast.error('Las contraseñas no coinciden'); return }
    setSavingPwd(true)
    try {
      await changeAdminPassword(token, currentPwd, newPwd)
      toast.success('Contraseña actualizada correctamente')
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? 'Error al cambiar la contraseña'
      toast.error(msg)
    } finally {
      setSavingPwd(false)
    }
  }

  const pwdStrength = (pwd: string): { label: string; color: string; width: string } => {
    if (!pwd) return { label: '', color: 'bg-gray-200', width: 'w-0' }
    if (pwd.length < 6) return { label: 'Muy corta', color: 'bg-red-400', width: 'w-1/4' }
    if (pwd.length < 8) return { label: 'Débil', color: 'bg-orange-400', width: 'w-2/4' }
    const hasUpper = /[A-Z]/.test(pwd)
    const hasNum   = /\d/.test(pwd)
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd)
    const score = [hasUpper, hasNum, hasSpecial].filter(Boolean).length
    if (score === 3) return { label: 'Fuerte', color: 'bg-emerald-500', width: 'w-full' }
    if (score >= 1) return { label: 'Moderada', color: 'bg-yellow-400', width: 'w-3/4' }
    return { label: 'Débil', color: 'bg-orange-400', width: 'w-2/4' }
  }

  const strength = pwdStrength(newPwd)
  const initials = (user?.name || user?.email || 'A').slice(0, 2).toUpperCase()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Perfil y Seguridad</h1>
        <p className="text-sm text-gray-500 mt-1">Administra tu información y credenciales de acceso.</p>
      </div>

      {/* ── Avatar card ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-bold text-xl flex-shrink-0 select-none">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-lg leading-tight truncate">{user?.name || 'Sin nombre'}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <span className="text-sm text-gray-500 truncate">{user?.email}</span>
          </div>
          <span className="inline-flex items-center gap-1 mt-2 text-[11px] font-semibold bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-full">
            <ShieldCheck className="w-3 h-3" /> Administrador
          </span>
        </div>
      </div>

      {/* ── Profile info ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-2 pb-1 border-b border-gray-50">
          <User className="w-4 h-4 text-blue-500" />
          <h2 className="font-semibold text-gray-800">Información de perfil</h2>
        </div>

        <FieldGroup icon={AtSign} label="Correo electrónico">
          <input
            value={user?.email ?? ''}
            disabled
            className={inputCls + ' bg-gray-50 text-gray-400 cursor-not-allowed'}
          />
          <p className="text-[11px] text-gray-400">El correo no puede modificarse desde aquí.</p>
        </FieldGroup>

        <FieldGroup icon={User} label="Nombre completo">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Tu nombre completo"
            className={inputCls}
          />
        </FieldGroup>

        <div className="grid grid-cols-2 gap-4">
          <FieldGroup icon={Phone} label="Teléfono">
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+51 999 000 000"
              className={inputCls}
            />
          </FieldGroup>
          <FieldGroup icon={Phone} label="WhatsApp">
            <input
              value={whatsapp}
              onChange={e => setWhatsapp(e.target.value)}
              placeholder="+51 999 000 000"
              className={inputCls}
            />
          </FieldGroup>
        </div>

        <FieldGroup icon={Globe} label="País">
          <input
            value={country}
            onChange={e => setCountry(e.target.value)}
            placeholder="Ej: Perú"
            className={inputCls}
          />
        </FieldGroup>

        <div className="pt-2">
          <button
            onClick={handleSaveProfile}
            disabled={savingProfile}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            <Save className="w-4 h-4" />
            {savingProfile ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {/* ── Security ── */}
      <div ref={securityRef} id="security" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-2 pb-1 border-b border-gray-50">
          <Lock className="w-4 h-4 text-indigo-500" />
          <h2 className="font-semibold text-gray-800">Seguridad</h2>
        </div>

        <p className="text-sm text-gray-500">
          Cambia tu contraseña regularmente para mantener tu cuenta segura.
        </p>

        <FieldGroup icon={Lock} label="Contraseña actual">
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={currentPwd}
              onChange={e => setCurrentPwd(e.target.value)}
              placeholder="••••••••"
              className={inputCls + ' pr-10'}
            />
            <button
              type="button"
              onClick={() => setShowCurrent(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </FieldGroup>

        <FieldGroup icon={Lock} label="Nueva contraseña">
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className={inputCls + ' pr-10'}
            />
            <button
              type="button"
              onClick={() => setShowNew(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {/* Strength bar */}
          {newPwd && (
            <div className="space-y-1 mt-1">
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-300 ${strength.color} ${strength.width}`} />
              </div>
              <p className="text-[11px] text-gray-400">{strength.label}</p>
            </div>
          )}
        </FieldGroup>

        <FieldGroup icon={Lock} label="Confirmar nueva contraseña">
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)}
              placeholder="Repite la nueva contraseña"
              className={inputCls + ' pr-10'}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {/* Match indicator */}
          {confirmPwd && newPwd && (
            <div className={`flex items-center gap-1 text-[11px] mt-1 ${confirmPwd === newPwd ? 'text-emerald-600' : 'text-red-500'}`}>
              {confirmPwd === newPwd
                ? <><CheckCircle className="w-3 h-3" /> Las contraseñas coinciden</>
                : <><AlertCircle className="w-3 h-3" /> Las contraseñas no coinciden</>
              }
            </div>
          )}
        </FieldGroup>

        <div className="pt-2">
          <button
            onClick={handleChangePassword}
            disabled={savingPwd || !currentPwd || !newPwd || !confirmPwd}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            {savingPwd ? 'Actualizando…' : 'Actualizar contraseña'}
          </button>
        </div>
      </div>

    </div>
  )
}
