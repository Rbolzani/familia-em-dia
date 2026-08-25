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
// ⚠️ Espelha o CHECK de activities_school_kind_check no banco — incluir um
// valor aqui sem rodar a migração faz o INSERT falhar com erro 23514.
export type SchoolKind = 'atividade' | 'aula' | 'prova'
export const SCHOOL_KIND_LABELS: Record<SchoolKind, string> = {
  atividade: 'Atividades escolares',
  aula: 'Rotina de aulas',
  prova: 'Calendário de provas',
}
export const SCHOOL_KIND_EMOJI: Record<SchoolKind, string> = {
  atividade: '📘',
  aula: '🕘',
  prova: '📝',
}
// Ordem de exibição das abas em /escola e no seletor da captura por IA.
export const SCHOOL_KINDS: SchoolKind[] = ['atividade', 'aula', 'prova']

// Tipos que NÃO entram nas visões gerais (calendário mensal, logística,
// dashboard, agenda do WhatsApp): cada um tem superfície própria. `aula` sai
// por volume (~45/semana afogariam a agenda); `prova` sai por decisão de
// produto — tem aba e seção de WhatsApp próprias.
export const SCHOOL_KINDS_APARTE: SchoolKind[] = ['aula', 'prova']

// Filtro PostgREST equivalente, para as queries que montam as visões gerais.
// Precisa ser "is null OR = atividade", e não "!= aula": as linhas antigas e
// as de outras categorias têm school_kind NULL, e um `neq` sozinho as
// descartaria junto. Centralizado aqui porque estava repetido em 5 arquivos —
// e agora que são dois tipos excluídos, divergir sairia caro.
export const SCHOOL_KIND_GERAL_FILTER = 'school_kind.is.null,school_kind.eq.atividade'

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
  // Só para category = 'escola': separa trabalhos/eventos ('atividade'),
  // rotina diária de aulas ('aula') e provas ('prova'). NULL = 'atividade'.
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
