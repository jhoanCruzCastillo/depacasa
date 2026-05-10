import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDevelopers, createDeveloper, updateDeveloper, deleteDeveloper } from '../services/api'

export const useDevelopers = () => {
  return useQuery({
    queryKey: ['developers'],
    queryFn: async () => {
      try {
        console.log('📥 Fetching developers...')
        const res = await getDevelopers()
        console.log('✅ Developers loaded:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to fetch developers:', error)
        throw error
      }
    },
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}

export const useCreateDeveloper = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: any) => {
      try {
        console.log('📝 Creating developer:', data)
        const res = await createDeveloper(data)
        console.log('✅ Developer created:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to create developer:', error)
        throw error
      }
    },
    onSuccess: () => {
      console.log('🔄 Invalidating developers query')
      queryClient.invalidateQueries({ queryKey: ['developers'] })
    },
    onError: (error) => {
      console.error('❌ Mutation error:', error)
    },
  })
}

export const useUpdateDeveloper = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      try {
        console.log('✏️ Updating developer:', { id, data })
        const res = await updateDeveloper(id, data)
        console.log('✅ Developer updated:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to update developer:', error)
        throw error
      }
    },
    onSuccess: () => {
      console.log('🔄 Invalidating developers query')
      queryClient.invalidateQueries({ queryKey: ['developers'] })
    },
    onError: (error) => {
      console.error('❌ Mutation error:', error)
    },
  })
}

export const useDeleteDeveloper = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      try {
        console.log('🗑️ Deleting developer:', id)
        await deleteDeveloper(id)
        console.log('✅ Developer deleted')
      } catch (error) {
        console.error('❌ Failed to delete developer:', error)
        throw error
      }
    },
    onSuccess: () => {
      console.log('🔄 Invalidating developers query')
      queryClient.invalidateQueries({ queryKey: ['developers'] })
    },
    onError: (error) => {
      console.error('❌ Mutation error:', error)
    },
  })
}
