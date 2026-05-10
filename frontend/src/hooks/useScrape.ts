import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { startScrapeJob, getScrapeJob, getDeveloperJobs } from '../services/api'

export const useStartScrape = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (developerId: string) => startScrapeJob(developerId).then(r => r.data),
    onSuccess: (_, developerId) => {
      queryClient.invalidateQueries({ queryKey: ['jobs', developerId] })
    },
  })
}

export const useScrapeJob = (jobId: string | null) => {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => getScrapeJob(jobId!).then(r => r.data),
    enabled: !!jobId,
    refetchInterval: (data) => {
      if (!data) return 3000
      const status = (data as any)?.status
      if (status === 'pending' || status === 'running') return 3000
      return false
    },
  })
}

export const useDeveloperJobs = (developerId: string | null) => {
  return useQuery({
    queryKey: ['jobs', developerId],
    queryFn: () => getDeveloperJobs(developerId!).then(r => r.data),
    enabled: !!developerId,
  })
}
