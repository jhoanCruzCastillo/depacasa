import { useState } from 'react'
import { Smartphone, RefreshCw } from 'lucide-react'

interface WhatsAppMessage {
  direction: 'inbound' | 'outbound'
  content: string
}

const SAMPLE_PROPERTY = `🏠 *Propiedad 1 de 5*

• *Nombre:* Proyecto Residencial Sol de Miraflores
• *Ubicacion:* Av. Larco 1234, Miraflores, Lima
• *Precio:* S/. 450,000
• *Habitaciones:* 3
• *Banos:* 2
• *Area:* 95 m²
• *Descripcion:* Moderno departamento con vista al mar, acabados de lujo y zonas comunes equipadas.

¿Qué deseas hacer?
*1* ➡️ Ver más propiedades
*2* ✅ Lo quiero (contactar asesor)
*⭐* Calificar esta propiedad`

const SAMPLE_GREETING = `Hola! Soy tu asistente inmobiliario personal.

Estoy aqui para ayudarte a encontrar la propiedad ideal.

Cuentame, como describes tu propiedad ideal? Puedes mencionar:
- Ubicacion (distrito, ciudad)
- Tipo (departamento, casa, oficina...)
- Numero de habitaciones
- Presupuesto aproximado
- Caracteristicas importantes para ti`

const PRESETS = [
  { label: 'Saludo inicial', content: SAMPLE_GREETING, direction: 'outbound' as const },
  { label: 'Tarjeta de propiedad', content: SAMPLE_PROPERTY, direction: 'outbound' as const },
  { label: 'Respuesta usuario', content: 'Busco un departamento en Miraflores de 2 habitaciones, máximo 300 mil soles', direction: 'inbound' as const },
  { label: 'Lo quiero', content: 'Excelente eleccion! Un asesor de ventas se comunicara contigo muy pronto con todos los detalles de esta propiedad. Gracias por tu interes!', direction: 'outbound' as const },
]

export default function MessagePreviewPage() {
  const [messages, setMessages] = useState<WhatsAppMessage[]>([
    { direction: 'outbound', content: SAMPLE_GREETING },
    { direction: 'inbound', content: 'Busco un depa en Miraflores, 2 habitaciones, máximo 350 mil soles' },
    { direction: 'outbound', content: SAMPLE_PROPERTY },
  ])
  const [customText, setCustomText] = useState('')
  const [customDir, setCustomDir] = useState<'inbound' | 'outbound'>('outbound')

  const addPreset = (preset: typeof PRESETS[0]) => {
    setMessages(m => [...m, { direction: preset.direction, content: preset.content }])
  }

  const addCustom = () => {
    if (!customText.trim()) return
    setMessages(m => [...m, { direction: customDir, content: customText.trim() }])
    setCustomText('')
  }

  const clear = () => setMessages([])

  const removeMessage = (i: number) => setMessages(m => m.filter((_, idx) => idx !== i))

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Smartphone className="w-6 h-6 text-slate-400" />
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Vista Previa de Mensajes</h1>
          <p className="text-sm text-slate-500 mt-0.5">Visualiza cómo se verán los mensajes en WhatsApp.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Controls */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <p className="text-sm font-medium text-slate-700">Agregar mensaje predefinido</p>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => addPreset(p)}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 text-left text-slate-700 transition-colors"
                >
                  {p.direction === 'outbound' ? '↑ ' : '↓ '}{p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <p className="text-sm font-medium text-slate-700">Agregar mensaje personalizado</p>
            <div className="flex gap-2">
              <select
                value={customDir}
                onChange={e => setCustomDir(e.target.value as 'inbound' | 'outbound')}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="outbound">Chatbot ↑</option>
                <option value="inbound">Usuario ↓</option>
              </select>
            </div>
            <textarea
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              placeholder="Escribe el contenido del mensaje..."
              rows={4}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={addCustom}
              disabled={!customText.trim()}
              className="w-full px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Agregar a la vista previa
            </button>
          </div>

          <button
            onClick={clear}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Limpiar conversación
          </button>
        </div>

        {/* Phone mockup */}
        <div className="flex justify-center">
          <div className="w-[320px] flex flex-col" style={{ height: '620px' }}>
            {/* Phone frame */}
            <div className="flex-1 bg-white rounded-[40px] shadow-2xl border-4 border-slate-800 overflow-hidden flex flex-col">
              {/* Status bar */}
              <div className="bg-slate-800 px-6 pt-3 pb-2 flex items-center justify-between">
                <span className="text-white text-xs font-medium">9:41</span>
                <div className="w-16 h-3 bg-slate-600 rounded-full" />
                <div className="flex gap-1">
                  <div className="w-3 h-3 bg-slate-400 rounded-sm" />
                  <div className="w-3 h-3 bg-slate-400 rounded-sm" />
                </div>
              </div>
              {/* WhatsApp header */}
              <div className="bg-[#075e54] px-4 py-2.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#128c7e] flex items-center justify-center text-white text-xs font-bold">P</div>
                <div>
                  <p className="text-white text-sm font-semibold">PropBot</p>
                  <p className="text-[#9de0d9] text-xs">en línea</p>
                </div>
              </div>
              {/* Chat area */}
              <div
                className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
                style={{ background: '#e5ddd5 url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" opacity="0.05"><rect width="50" height="50" fill="none"/><circle cx="25" cy="25" r="10" stroke="gray" fill="none"/></svg>\')' }}
              >
                {messages.length === 0 && (
                  <p className="text-center text-xs text-slate-500 mt-10">La conversación aparecerá aquí</p>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`relative max-w-[85%] px-3 py-2 rounded-lg text-xs shadow-sm whitespace-pre-wrap cursor-pointer hover:opacity-80 ${
                        msg.direction === 'outbound'
                          ? 'bg-[#dcf8c6] text-slate-800 rounded-br-sm'
                          : 'bg-white text-slate-800 rounded-bl-sm'
                      }`}
                      onClick={() => removeMessage(i)}
                      title="Clic para eliminar"
                    >
                      {msg.content}
                      <span className="block text-right text-[10px] text-slate-400 mt-1">
                        {msg.direction === 'outbound' ? '✓✓' : ''} 9:41
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Input bar */}
              <div className="bg-[#f0f0f0] px-3 py-2 flex items-center gap-2">
                <div className="flex-1 bg-white rounded-full px-4 py-2 text-xs text-slate-400">Escribe un mensaje</div>
                <div className="w-8 h-8 rounded-full bg-[#075e54] flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
                  </svg>
                </div>
              </div>
            </div>
            <p className="text-center text-xs text-slate-400 mt-2">Clic en un mensaje para eliminarlo</p>
          </div>
        </div>
      </div>
    </div>
  )
}
