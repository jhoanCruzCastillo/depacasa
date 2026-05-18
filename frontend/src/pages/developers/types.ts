export interface TField { name: string; is_child_url: boolean; is_image?: boolean }
export interface TNode  { id: string; name: string; parent_id: string | null; order?: number; fields?: TField[] }
