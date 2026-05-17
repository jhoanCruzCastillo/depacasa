import axios from 'axios'
import { Developer, UrlNode, Field, Selector, ScrapeJob, ScrapedRecord } from '../types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

const API = axios.create({
  baseURL: API_URL,
  timeout: 30000,
})

API.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error)
)

API.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(error)
)

// Developers
export const getDevelopers = (params?: { skip?: number; limit?: number; search?: string }) =>
  API.get<Developer[]>('/developers', { params })
export const getDeveloper = (id: string) => API.get<Developer>(`/developers/${id}`)
export const createDeveloper = (data: Partial<Developer>) => API.post<Developer>('/developers', data)
export const bulkCreateDevelopers = (items: Partial<Developer>[]) =>
  API.post<Developer[]>('/developers/bulk', items)
export const updateDeveloper = (id: string, data: Partial<Developer>) =>
  API.patch<Developer>(`/developers/${id}`, data)
export const deleteDeveloper = (id: string) => API.delete(`/developers/${id}`)

// Developer URL nodes (summary list)
export const getDeveloperUrlNodes = (developerId: string) =>
  API.get(`/developers/${developerId}/url-nodes`)

// Developer scraped records
export const getDeveloperRecords = (developerId: string, params?: { node_id?: string; skip?: number; limit?: number }) =>
  API.get<ScrapedRecord[]>(`/developers/${developerId}/records`, { params })
export const deleteRecords = (developerId: string, nodeId?: string) =>
  API.delete(`/developers/${developerId}/records`, { params: nodeId ? { node_id: nodeId } : undefined })

// Developer template
export const getDeveloperTemplate = (developerId: string) =>
  API.get(`/developers/${developerId}/template`)
export const saveDeveloperTemplate = (developerId: string, template: any) =>
  API.post(`/developers/${developerId}/template`, template)

// URL Nodes (low-level CRUD via templates router)
export const getUrlNodes = (developerId: string) =>
  API.get<UrlNode[]>(`/templates/developers/${developerId}/url-nodes`)
export const createUrlNode = (data: Partial<UrlNode>) =>
  API.post<UrlNode>('/templates/url-nodes', data)
export const updateUrlNode = (id: string, data: Partial<UrlNode>) =>
  API.put<UrlNode>(`/templates/url-nodes/${id}`, data)
export const deleteUrlNode = (id: string) => API.delete(`/templates/url-nodes/${id}`)

// Fields
export const getFieldNameSuggestions = (q: string) =>
  API.get<string[]>(`/templates/fields/suggestions`, { params: { q } })
export const getFields = (nodeId: string) =>
  API.get<Field[]>(`/templates/url-nodes/${nodeId}/fields`)
export const createField = (data: Partial<Field>) => API.post<Field>('/templates/fields', data)
export const updateField = (id: string, data: Partial<Field>) =>
  API.put<Field>(`/templates/fields/${id}`, data)
export const deleteField = (id: string) => API.delete(`/templates/fields/${id}`)

// Run single-field scrape
export const runFieldScrape = (data: {
  developer_id: string
  url_node_id: string
  node_url: string
  container_selector?: string | null
  field: {
    name: string
    is_child_url: boolean
    plain_text: boolean
    is_shared: boolean
    is_list: boolean
    list_container: string | null
    is_image: boolean
    extract_attr: string | null
    order: number
    selectors: Array<{ value: string; order: number }>
  }
}) => API.post('/scrape/field/run', data)

// Selectors
export const getSelectors = (fieldId: string) =>
  API.get<Selector[]>(`/templates/fields/${fieldId}/selectors`)
export const createSelector = (data: Partial<Selector>) =>
  API.post<Selector>('/templates/selectors', data)
export const updateSelector = (id: string, data: Partial<Selector>) =>
  API.put<Selector>(`/templates/selectors/${id}`, data)
export const deleteSelector = (id: string) => API.delete(`/templates/selectors/${id}`)

// Scrape Jobs
export const startScrapeJob = (developerId: string) =>
  API.post<ScrapeJob>(`/scrape/${developerId}/run`)
export const getScrapeJob = (jobId: string) => API.get<ScrapeJob>(`/scrape/jobs/${jobId}`)
export const getDeveloperJobs = (developerId: string) =>
  API.get<ScrapeJob[]>(`/scrape/${developerId}/jobs`)

// Search (Tavily)
export const searchDevelopers = (q: string) =>
  API.get<{
    query: string
    key_configured: boolean
    results: Array<{
      name: string
      url: string
      description: string
      already_registered: boolean
      developer_id: string | null
    }>
  }>('/search/developers', { params: { q } })

export const searchPlatforms = (query: string, maxResults?: number) =>
  API.get('/search/platforms', { params: { query, max_results: maxResults } })
export const verifyUrl = (url: string) =>
  API.post('/search/verify-url', null, { params: { url } })

// ── Chat ──────────────────────────────────────────────────────────────────────

export const getChatUsers = (params?: { skip?: number; limit?: number }) =>
  API.get('/chat/users', { params })
export const getChatUser = (id: string) => API.get(`/chat/users/${id}`)
export const createChatUser = (data: { phone_number: string; name?: string }) =>
  API.post('/chat/users', data)
export const updateChatUser = (id: string, data: { phone_number: string; name?: string }) =>
  API.patch(`/chat/users/${id}`, data)
export const deleteChatUser = (id: string) => API.delete(`/chat/users/${id}`)
export const sendChatMessage = (userId: string, message: string) =>
  API.post(`/chat/users/${userId}/send`, { message })

export const getChatTemplates = () => API.get('/chat/templates')
export const createChatTemplate = (data: {
  name: string; type: string; content: string; variables?: string[]; is_active?: boolean
}) => API.post('/chat/templates', data)
export const updateChatTemplate = (id: string, data: {
  name: string; type: string; content: string; variables?: string[]; is_active?: boolean
}) => API.put(`/chat/templates/${id}`, data)
export const deleteChatTemplate = (id: string) => API.delete(`/chat/templates/${id}`)

export const getChatAdvisors = () => API.get('/chat/advisors')
export const getChatAdvisorClients = (advisorId: string) => API.get(`/chat/advisors/${advisorId}/clients`)
export const createChatAdvisor = (data: {
  name: string; phone?: string; email?: string; whatsapp_number?: string; is_active?: boolean
}) => API.post('/chat/advisors', data)
export const updateChatAdvisor = (id: string, data: {
  name: string; phone?: string; email?: string; whatsapp_number?: string; is_active?: boolean
}) => API.put(`/chat/advisors/${id}`, data)
export const deleteChatAdvisor = (id: string) => API.delete(`/chat/advisors/${id}`)

export const getChatConfig = () => API.get('/chat/config')
export const updateChatConfig = (data: {
  top_n_properties?: number
  greeting_message?: string
  contact_message?: string
  no_results_message?: string
  no_more_message?: string
}) => API.put('/chat/config', data)

// ── Web Chatbot ───────────────────────────────────────────────────────────────

export const createWebChatSession = (token?: string | null) =>
  API.post('/chat/web/sessions', {}, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
export const sendWebChatMessage = (
  sessionId: string,
  payload:
    | string
    | {
        content?: string
        attachment_urls?: string[]
        financial_document_url?: string
      },
) => {
  const body = typeof payload === 'string' ? { content: payload } : payload
  return API.post(`/chat/web/sessions/${sessionId}/message`, body)
}

export const uploadWebChatAttachment = (sessionId: string, file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return API.post(`/chat/web/sessions/${sessionId}/attachments`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authRegister = (email: string, password: string, name: string, country?: string) =>
  API.post('/auth/register', { email, password, name, country })
export const authLogin = (email: string, password: string) =>
  API.post('/auth/login', { email, password })
export const authMe = (token: string) =>
  API.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } })

// ── Site Builder (admin) ──────────────────────────────────────────────────────

export const getSiteConfig = () => API.get('/site/config')
export const updateSiteConfig = (data: Record<string, unknown>) => API.put('/site/config', data)

// ── Public site ───────────────────────────────────────────────────────────────

export const getPublicSiteConfig = () => API.get('/public/config')
export const getPublicRecords = (params?: { skip?: number; limit?: number; search?: string }) =>
  API.get('/public/records', { params })

export default API
