import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Coins, Lock, CreditCard, CheckCircle2, AlertCircle, ArrowRight, Shield } from 'lucide-react'
import API from '../../services/api'

interface Session {
  payment_id: string
  status: string
  amount: number
  currency: string
  credits: number
  package_label: string
  advisor_name: string | null
}

type PageState = 'loading' | 'error' | 'form' | 'processing' | 'success'

function formatCardNumber(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ')
}

function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return digits.slice(0, 2) + '/' + digits.slice(2)
}

function CardIcon({ number }: { number: string }) {
  const clean = number.replace(/\s/g, '')
  if (clean.startsWith('4')) return <span className="text-[11px] font-bold text-blue-600 tracking-tight">VISA</span>
  if (clean.startsWith('5') || clean.startsWith('2')) return <span className="text-[11px] font-bold text-red-500 tracking-tight">MC</span>
  return <CreditCard className="w-4 h-4 text-slate-400" />
}

export default function DronsPayPage() {
  const { paymentId } = useParams<{ paymentId: string }>()
  const navigate = useNavigate()

  const [pageState, setPageState] = useState<PageState>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const [cardName, setCardName] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardCvv, setCardCvv] = useState('')
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!paymentId) { setPageState('error'); setErrorMsg('ID de sesión inválido.'); return }
    API.get(`/credits/drons/session/${paymentId}`)
      .then(r => {
        if (r.data.status === 'completed') {
          setPageState('error'); setErrorMsg('Este pago ya fue procesado.'); return
        }
        if (r.data.status !== 'pending') {
          setPageState('error'); setErrorMsg('Sesión inválida o expirada.'); return
        }
        setSession(r.data)
        setPageState('form')
      })
      .catch(() => { setPageState('error'); setErrorMsg('Sesión de pago no encontrada.') })
  }, [paymentId])

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    const cleanNum = cardNumber.replace(/\s/g, '')
    if (cleanNum.length < 13) { setFormError('Ingresa un número de tarjeta válido.'); return }
    if (!cardExpiry.includes('/') || cardExpiry.length < 5) { setFormError('Fecha de vencimiento inválida.'); return }

    setPageState('processing')
    try {
      await API.post(`/credits/drons/session/${paymentId}/pay`, {
        card_name: cardName.trim(),
        card_number: cleanNum,
        card_expiry: cardExpiry,
      })
      setPageState('success')
      setTimeout(() => navigate('/asesores?payment=success'), 2800)
    } catch {
      setPageState('form')
      setFormError('No se pudo procesar el pago. Inténtalo de nuevo.')
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(145deg, #f0f4ff 0%, #e8eeff 50%, #f5f0ff 100%)' }}>

      {/* Nav */}
      <nav className="bg-slate-900 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-400 flex items-center justify-center">
            <Coins className="w-4 h-4 text-slate-900" />
          </div>
          <span className="font-black text-white text-lg tracking-tight">Drons <span className="text-amber-400">Pay</span></span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400 text-xs">
          <Lock className="w-3.5 h-3.5 text-emerald-400" />
          Pago seguro simulado
        </div>
      </nav>

      {/* Main */}
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">

          {/* LOADING */}
          {pageState === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-20">
              <div className="w-10 h-10 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
              <p className="text-slate-500 text-sm">Cargando sesión de pago…</p>
            </div>
          )}

          {/* ERROR */}
          {pageState === 'error' && (
            <div className="bg-white rounded-2xl shadow-lg border border-red-100 p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto">
                <AlertCircle className="w-7 h-7 text-red-500" />
              </div>
              <h2 className="text-lg font-bold text-slate-800">Sesión inválida</h2>
              <p className="text-sm text-slate-500">{errorMsg}</p>
              <button
                onClick={() => navigate('/asesores')}
                className="mt-2 px-5 py-2.5 bg-slate-800 text-white text-sm font-semibold rounded-xl hover:bg-slate-700 transition-colors"
              >
                Volver al portal
              </button>
            </div>
          )}

          {/* SUCCESS */}
          {pageState === 'success' && session && (
            <div className="bg-white rounded-2xl shadow-lg border border-emerald-100 p-10 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto animate-[pulse_1s_ease-in-out_1]">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h2 className="text-xl font-black text-slate-800">¡Pago completado!</h2>
              <div className="bg-amber-50 border border-amber-100 rounded-xl py-4 px-6 inline-flex flex-col items-center gap-1">
                <p className="text-xs text-amber-600 font-medium uppercase tracking-wide">Créditos acreditados</p>
                <p className="text-4xl font-black text-amber-500 flex items-center gap-2">
                  <Coins className="w-7 h-7" /> +{session.credits}
                </p>
              </div>
              <p className="text-slate-400 text-sm">Redirigiendo a tu portal…</p>
              <div className="w-6 h-6 border-4 border-slate-200 border-t-slate-500 rounded-full animate-spin mx-auto mt-2" />
            </div>
          )}

          {/* FORM */}
          {(pageState === 'form' || pageState === 'processing') && session && (
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">

              {/* Order summary */}
              <div className="bg-slate-800 px-6 py-5">
                <p className="text-slate-400 text-[11px] font-semibold uppercase tracking-widest mb-2">Resumen del pedido</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-400/20 border border-amber-400/30 flex items-center justify-center">
                      <Coins className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                      <p className="text-white font-bold text-sm">{session.package_label}</p>
                      <p className="text-amber-400 text-xs font-semibold">{session.credits} créditos</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-black text-xl">${session.amount.toFixed(2)}</p>
                    <p className="text-slate-400 text-xs">{session.currency}</p>
                  </div>
                </div>
                {session.advisor_name && (
                  <p className="text-slate-500 text-xs mt-3 pt-3 border-t border-slate-700">
                    Compra para: <span className="text-slate-300 font-medium">{session.advisor_name}</span>
                  </p>
                )}
              </div>

              {/* Payment form */}
              <form onSubmit={handlePay} className="px-6 py-6 space-y-5">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Datos de pago</p>

                {/* Card number */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Número de tarjeta</label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="1234  5678  9012  3456"
                      value={cardNumber}
                      onChange={e => setCardNumber(formatCardNumber(e.target.value))}
                      required
                      className="w-full pl-4 pr-12 py-3 border border-slate-200 rounded-xl text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <CardIcon number={cardNumber} />
                    </div>
                  </div>
                </div>

                {/* Card name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Nombre en tarjeta</label>
                  <input
                    type="text"
                    placeholder="JUAN PÉREZ"
                    value={cardName}
                    onChange={e => setCardName(e.target.value.toUpperCase())}
                    required
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-mono uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                  />
                </div>

                {/* Expiry + CVV */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Vencimiento</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="MM/AA"
                      value={cardExpiry}
                      onChange={e => setCardExpiry(formatExpiry(e.target.value))}
                      required
                      maxLength={5}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">CVV</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="•••"
                      value={cardCvv}
                      onChange={e => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      required
                      maxLength={4}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                    />
                  </div>
                </div>

                {formError && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {formError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={pageState === 'processing'}
                  className="w-full py-3.5 rounded-xl text-white font-black text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-70"
                  style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
                >
                  {pageState === 'processing' ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Procesando…
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      Pagar ${session.amount.toFixed(2)} {session.currency}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-4 pt-1">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    Simulación segura
                  </div>
                  <div className="w-px h-3 bg-slate-200" />
                  <p className="text-[11px] text-slate-300">Datos ficticios — no se procesa ningún cargo real</p>
                </div>
              </form>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
