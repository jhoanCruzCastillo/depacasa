import { useState, useEffect } from 'react'
import { authLogin, authRegister } from '../services/api'

export interface SiteUser {
  id: string
  email: string
  name: string | null
  country: string | null
  phone: string | null
  wants_newsletter: boolean
}

const TOKEN_KEY = 'site_auth_token'
const USER_KEY = 'site_auth_user'

export function useAuth() {
  const [user, setUser] = useState<SiteUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY)
    const savedUser = localStorage.getItem(USER_KEY)
    if (savedToken && savedUser) {
      try {
        setToken(savedToken)
        setUser(JSON.parse(savedUser))
      } catch {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
      }
    }
    setLoading(false)
  }, [])

  const _persist = (t: string, u: SiteUser) => {
    localStorage.setItem(TOKEN_KEY, t)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
    setToken(t)
    setUser(u)
  }

  const login = async (email: string, password: string): Promise<SiteUser> => {
    const r = await authLogin(email, password)
    _persist(r.data.token, r.data.user)
    return r.data.user
  }

  const register = async (email: string, password: string, wants_newsletter: boolean): Promise<SiteUser> => {
    const r = await authRegister(email, password, wants_newsletter)
    _persist(r.data.token, r.data.user)
    return r.data.user
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }

  return { user, token, loading, login, register, logout }
}
