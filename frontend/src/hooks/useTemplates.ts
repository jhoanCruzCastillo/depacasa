import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getUrlNodes,
  createUrlNode,
  updateUrlNode,
  deleteUrlNode,
  getFields,
  createField,
  updateField,
  deleteField,
  getSelectors,
  createSelector,
  updateSelector,
  deleteSelector,
} from '../services/api'

// URL Nodes
export const useUrlNodes = (developerId: string | null) => {
  return useQuery({
    queryKey: ['urlNodes', developerId],
    queryFn: async () => {
      if (!developerId) return []
      try {
        console.log('📥 Fetching URL nodes for developer:', developerId)
        const res = await getUrlNodes(developerId)
        console.log('✅ URL nodes loaded:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to fetch URL nodes:', error)
        throw error
      }
    },
    enabled: !!developerId,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}

export const useCreateUrlNode = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: any) => {
      try {
        console.log('📝 Creating URL node:', data)
        const res = await createUrlNode(data)
        console.log('✅ URL node created:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to create URL node:', error)
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['urlNodes'] })
    },
  })
}

export const useUpdateUrlNode = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      try {
        console.log('✏️ Updating URL node:', { id, data })
        const res = await updateUrlNode(id, data)
        console.log('✅ URL node updated:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to update URL node:', error)
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['urlNodes'] })
    },
  })
}

export const useDeleteUrlNode = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      try {
        console.log('🗑️ Deleting URL node:', id)
        await deleteUrlNode(id)
        console.log('✅ URL node deleted')
      } catch (error) {
        console.error('❌ Failed to delete URL node:', error)
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['urlNodes'] })
    },
  })
}

// Fields
export const useFields = (nodeId: string | null) => {
  return useQuery({
    queryKey: ['fields', nodeId],
    queryFn: async () => {
      if (!nodeId) return []
      try {
        console.log('📥 Fetching fields for node:', nodeId)
        const res = await getFields(nodeId)
        console.log('✅ Fields loaded:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to fetch fields:', error)
        throw error
      }
    },
    enabled: !!nodeId,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}

export const useCreateField = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: any) => {
      try {
        console.log('📝 Creating field:', data)
        const res = await createField(data)
        console.log('✅ Field created:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to create field:', error)
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields'] })
    },
  })
}

export const useUpdateField = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      try {
        console.log('✏️ Updating field:', { id, data })
        const res = await updateField(id, data)
        console.log('✅ Field updated:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to update field:', error)
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields'] })
    },
  })
}

export const useDeleteField = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      try {
        console.log('🗑️ Deleting field:', id)
        await deleteField(id)
        console.log('✅ Field deleted')
      } catch (error) {
        console.error('❌ Failed to delete field:', error)
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields'] })
    },
  })
}

// Selectors
export const useSelectors = (fieldId: string | null) => {
  return useQuery({
    queryKey: ['selectors', fieldId],
    queryFn: async () => {
      if (!fieldId) return []
      try {
        console.log('📥 Fetching selectors for field:', fieldId)
        const res = await getSelectors(fieldId)
        console.log('✅ Selectors loaded:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to fetch selectors:', error)
        throw error
      }
    },
    enabled: !!fieldId,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}

export const useCreateSelector = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: any) => {
      try {
        console.log('📝 Creating selector:', data)
        const res = await createSelector(data)
        console.log('✅ Selector created:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to create selector:', error)
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['selectors'] })
    },
  })
}

export const useUpdateSelector = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      try {
        console.log('✏️ Updating selector:', { id, data })
        const res = await updateSelector(id, data)
        console.log('✅ Selector updated:', res.data)
        return res.data
      } catch (error) {
        console.error('❌ Failed to update selector:', error)
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['selectors'] })
    },
  })
}

export const useDeleteSelector = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      try {
        console.log('🗑️ Deleting selector:', id)
        await deleteSelector(id)
        console.log('✅ Selector deleted')
      } catch (error) {
        console.error('❌ Failed to delete selector:', error)
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['selectors'] })
    },
  })
}
