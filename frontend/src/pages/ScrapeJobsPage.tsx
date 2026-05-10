import { useQuery } from '@tanstack/react-query'
import { getDevelopers, getDeveloperJobs } from '../services/api'
import { Developer, ScrapeJob } from '../types'
import { Link } from 'react-router-dom'
import { Loader2, CheckCircle, XCircle, Clock, Activity } from 'lucide-react'
import Badge from '../components/ui/Badge'

const statusIcon = {
  pending: <Clock className="w-4 h-4 text-yellow-500" />,
  running: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  completed: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <XCircle className="w-4 h-4 text-red-500" />,
}

const statusVariant: Record<string, 'green' | 'blue' | 'yellow' | 'red' | 'gray'> = {
  completed: 'green',
  running: 'blue',
  pending: 'yellow',
  failed: 'red',
}

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
}

function DeveloperJobs({ developer }: { developer: Developer }) {
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs', developer.id],
    queryFn: () => getDeveloperJobs(developer.id).then(r => r.data),
    refetchInterval: 5000,
  })

  if (isLoading) return null
  if (jobs.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
        <h3 className="font-semibold text-gray-900">{developer.name}</h3>
        <Link to={`/developers/${developer.id}`} className="text-xs text-blue-600 hover:underline">
          Ver registros
        </Link>
      </div>
      <div className="divide-y divide-gray-50">
        {jobs.slice(0, 5).map((job: ScrapeJob) => (
          <div key={job.id} className="px-5 py-3 flex items-center gap-4">
            <div className="flex-shrink-0">{statusIcon[job.status]}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant[job.status]}>{job.status}</Badge>
                {job.total_records > 0 && (
                  <span className="text-xs text-gray-500">{job.total_records} registros</span>
                )}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                Iniciado: {fmt(job.started_at)} · Fin: {fmt(job.finished_at)}
              </div>
              {job.error_log && (
                <p className="text-xs text-red-600 mt-1 truncate">{job.error_log}</p>
              )}
            </div>
            <span className="text-xs text-gray-400 flex-shrink-0">{fmt(job.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ScrapeJobsPage() {
  const { data: developers = [], isLoading } = useQuery({
    queryKey: ['developers'],
    queryFn: () => getDevelopers().then(r => r.data),
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Activity className="w-7 h-7 text-blue-600" />
        <h1 className="text-3xl font-bold text-gray-900">Trabajos de Scraping</h1>
      </div>
      <p className="text-gray-500 mb-6">Historial de ejecuciones por desarrolladora. Se actualiza cada 5 segundos.</p>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : developers.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p>No hay desarrolladoras registradas.</p>
          <Link to="/developers" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
            Ir a Desarrolladoras
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {developers.map((dev: Developer) => (
            <DeveloperJobs key={dev.id} developer={dev} />
          ))}
        </div>
      )}
    </div>
  )
}
