export type SessionType = 'admin' | 'user' | 'advisor'

export interface AppSession {
  type: SessionType
  token: string
  name: string
  email: string | null
}

const KEY = 'drons_session'
const ADVISOR_TOKEN_KEY = 'advisor_token'

export const session = {
  get(): AppSession | null {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') }
    catch { return null }
  },

  set(s: AppSession): void {
    localStorage.setItem(KEY, JSON.stringify(s))
    // Backward compat: AdvisorPortalPage reads this key directly
    if (s.type === 'advisor') localStorage.setItem(ADVISOR_TOKEN_KEY, s.token)
    else localStorage.removeItem(ADVISOR_TOKEN_KEY)
  },

  clear(): void {
    localStorage.removeItem(KEY)
    localStorage.removeItem(ADVISOR_TOKEN_KEY)
  },

  getToken(): string | null {
    return this.get()?.token ?? null
  },

  getType(): SessionType | null {
    return this.get()?.type ?? null
  },

  authHeader(): Record<string, string> {
    const t = this.getToken()
    return t ? { Authorization: `Bearer ${t}` } : {}
  },
}
