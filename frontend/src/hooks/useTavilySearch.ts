import { useState } from 'react'
import { searchDevelopers } from '../services/api'

export interface TavilyResult {
  name: string
  url: string
  description: string
  already_registered: boolean
  developer_id: string | null
}

interface SearchState {
  results: TavilyResult[]
  loading: boolean
  error: string | null
  keyConfigured: boolean
  searched: boolean
}

export function useTavilySearch() {
  const [state, setState] = useState<SearchState>({
    results: [],
    loading: false,
    error: null,
    keyConfigured: true,
    searched: false,
  })

  const search = async (query: string) => {
    if (!query.trim()) return
    setState(s => ({ ...s, loading: true, error: null, searched: false }))
    try {
      const res = await searchDevelopers(query.trim())
      setState({
        results: res.data.results,
        loading: false,
        error: null,
        keyConfigured: res.data.key_configured,
        searched: true,
      })
    } catch (e: any) {
      setState(s => ({
        ...s,
        loading: false,
        error: e?.response?.data?.detail || 'Error al conectar con el servidor',
        searched: true,
      }))
    }
  }

  const clear = () =>
    setState({ results: [], loading: false, error: null, keyConfigured: true, searched: false })

  return { ...state, search, clear }
}
