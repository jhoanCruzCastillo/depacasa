import { useEffect, useRef } from 'react'
import { useScrapeJob } from '../../hooks/useScrape'
import { ScrapeJob } from '../../types'
import { CheckCircle, XCircle, Loader2, Clock } from 'lucide-react'

interface ScrapeProgressProps {
  jobId: string
  developerName?: string
  onDone?: (job: ScrapeJob) => void
}

function elapsed(startedAt: string | null): string {
  if (!startedAt) return '00:00'
  const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export default function ScrapeProgress({ jobId, developerName, onDone }: ScrapeProgressProps) {
  const { data: job } = useScrapeJob(jobId)
  const logRef = useRef<HTMLDivElement>(null)

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job])

  useEffect(() => {
    if (job && (job.status === 'completed' || job.status === 'failed')) {
      onDone?.(job)
    }
  }, [job?.status])

  if (!job) {
    return (
      <div className="flex items-center gap-3 py-6 justify-center text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        <span className="text-sm">Iniciando scraping...</span>
      </div>
    )
  }

  const isDone = job.status === 'completed' || job.status === 'failed'
  const isRunning = job.status === 'running'
  const isPending = job.status === 'pending'

  return (
    <div className="space-y-4">
      {/* Status header */}
      <div className="flex items-center gap-3">
        {job.status === 'completed' && <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />}
        {job.status === 'failed' && <XCircle className="w-6 h-6 text-red-500 flex-shrink-0" />}
        {isRunning && <Loader2 className="w-6 h-6 text-blue-500 animate-spin flex-shrink-0" />}
        {isPending && <Clock className="w-6 h-6 text-yellow-500 flex-shrink-0" />}
        <div>
          <p className="font-semibold text-gray-900">
            {job.status === 'completed' && '✓ Scraping Completado'}
            {job.status === 'failed' && '✕ Error en el Scraping'}
            {isRunning && 'Extrayendo datos...'}
            {isPending && 'En espera...'}
          </p>
          {developerName && (
            <p className="text-sm text-gray-500">{developerName}</p>
          )}
        </div>
        {isRunning && (
          <span className="ml-auto text-xs text-gray-400 font-mono flex-shrink-0">
            {elapsed(job.started_at)}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {(isRunning || isPending) && (
        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all ${
              isRunning ? 'bg-blue-500 animate-pulse w-1/2' : 'bg-yellow-400 w-1/6'
            }`}
          />
        </div>
      )}

      {/* Completed stats */}
      {job.status === 'completed' && (
        <div className="bg-green-50 border border-green-100 rounded-xl p-4 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Registros extraídos</span>
            <span className="font-semibold text-green-700">{job.total_records}</span>
          </div>
          {job.started_at && job.finished_at && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Tiempo total</span>
              <span className="font-mono text-gray-700">
                {elapsed(job.started_at)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Error detail */}
      {job.status === 'failed' && job.error_log && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-red-700 mb-2">Detalle del error:</p>
          <p className="text-xs text-red-700 font-mono break-all leading-relaxed">{job.error_log}</p>
        </div>
      )}

      {/* Live records count */}
      {isRunning && job.total_records > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Registros extraídos hasta ahora: <span className="font-semibold text-gray-900">{job.total_records}</span>
        </div>
      )}

      {/* Timestamps */}
      {isDone && (
        <p className="text-xs text-gray-400">
          {job.started_at && <>Iniciado: {new Date(job.started_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</>}
          {job.finished_at && <> · Finalizado: {new Date(job.finished_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</>}
        </p>
      )}
    </div>
  )
}
