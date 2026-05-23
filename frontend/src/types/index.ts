export interface Developer {
  id: string
  name: string
  description: string | null
  base_url: string
  logo_url: string | null
  proyectos_url: string | null
  source: 'tavily' | 'manual'
  created_at: string
}

export interface UrlNode {
  id: string
  developer_id: string
  parent_id: string | null
  name: string
  url: string
  order: number
  created_at: string
}

export interface Field {
  id: string
  url_node_id: string
  name: string
  is_child_url: boolean
  order: number
  created_at: string
  inherited_from?: string | null
}

export interface Selector {
  id: string
  field_id: string
  value: string
  order: number
  created_at: string
}

export interface ScrapedRecord {
  id: string
  type: 'proyecto' | 'propiedad'
  proyecto_id: string | null
  data: Record<string, any>
  status: 'success' | 'partial' | 'failed'
  scraped_at: string
}

export interface ScrapeJob {
  id: string
  developer_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  started_at: string | null
  finished_at: string | null
  total_records: number
  error_log: string | null
  created_at: string
}
