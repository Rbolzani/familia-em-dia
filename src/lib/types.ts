export type ActivityCategory = 'escola' | 'saude' | 'extracurricular'
export type ActivityStatus = 'pendente' | 'concluido' | 'cancelado'

export interface Child {
  id: string
  user_id: string
  name: string
  birth_date: string | null
  school_name: string | null
  avatar_color: string
  avatar_url: string | null   // photo uploaded to Supabase Storage
  sort_order?: number
  created_at: string
}

// Tipos de item dentro da categoria "escola".
export type SchoolKind = 'atividade' | 'aula'
export const SCHOOL_KIND_LABELS: Record<SchoolKind, string> = {
  atividade: 'Atividades escolares',
  aula: 'Rotina de aulas',
}

export interface Activity {
  id: string
  user_id: string
  child_id: string
  category: ActivityCategory
  title: string
  description: string | null
  date: string | null
  time: string | null
  alert_days: number
  status: ActivityStatus
  location: string | null
  recurrence: string | null
  // Só para category = 'escola': separa provas/eventos ('atividade') da
  // rotina diária de aulas ('aula'). NULL equivale a 'atividade'.
  school_kind: SchoolKind | null
  ai_generated: boolean
  takes_user_id: string | null
  picks_user_id: string | null
  created_at: string
  // join
  child?: Child
}

export type DocumentCategory =
  | 'saude' | 'identidade' | 'contratos' | 'carteirinhas'
  | 'escolar' | 'vacinacao' | 'autorizacoes' | 'financeiro' | 'outros'

export type ChildRef = Pick<Child, 'id' | 'name' | 'avatar_color'>

export interface AppDocument {
  id: string
  user_id: string
  child_id: string | null
  category: DocumentCategory
  title: string
  description: string | null
  expires_at: string | null
  doc_number: string | null
  issuer: string | null
  issue_date: string | null
  tags: string[] | null
  doc_type: string | null                 // natureza (v1c) — ver lib/docTypes
  metadata: Record<string, unknown> | null // campos específicos do tipo (v1c)
  created_at: string
  child?: ChildRef | null
  files?: DocumentFile[]
}

export interface DocumentFile {
  id: string
  document_id: string
  user_id: string
  file_name: string
  file_size: number | null
  mime_type: string | null
  storage_path: string
  created_at: string
}

export interface AiInput {
  id: string
  user_id: string
  child_id: string | null
  raw_text: string | null
  image_url: string | null
  extracted_activities: Activity[] | null
  status: 'pending' | 'processed' | 'confirmed'
  created_at: string
}
