// Cofre inteligente — schema único de naturezas de documento (v1c).
// Esta é a FONTE DA VERDADE: alimenta o prompt do OCR, o formulário dinâmico
// e a tela de detalhe. Adicionar um novo tipo = só uma entrada aqui.

import type { DocumentCategory } from './types'

export type DocType =
  | 'identidade'
  | 'contrato'
  | 'boleto'
  | 'exame_medico'
  | 'receita_medica'
  | 'carteirinha_saude'
  | 'vacinacao'
  | 'boletim_escolar'
  | 'autorizacao'
  | 'outro'

// Formato do campo — controla máscara/validação e como o OCR deve devolver.
export type FieldFormat =
  | 'texto'
  | 'textarea'
  | 'data'        // YYYY-MM-DD
  | 'valor'       // monetário (R$)
  | 'cpf_cnpj'
  | 'crm'
  | 'sim_nao'     // boolean
  | 'vacinas'     // lista estruturada: {nome,data_aplicacao,dose,proxima_dose}

export interface DocField {
  key: string
  label: string
  format: FieldFormat
  // Se mapeia para uma COLUNA existente de `documents` (rótulo contextual por
  // tipo). Sem `column` => vai para o jsonb `metadata`.
  column?: 'doc_number' | 'issuer' | 'issue_date' | 'expires_at' | 'description'
}

export interface DocTypeDef {
  type: DocType
  label: string            // rótulo amigável
  category: DocumentCategory // gaveta destino sugerida
  childLabel: string       // como chamar o "filho" neste contexto
  fields: DocField[]       // campos específicos (além de título/filho/tags/arquivos)
}

// Uma entrada de vacina (estrutura do campo 'vacinas') — apenas HISTÓRICO do
// que já foi aplicado.
//
// Não existe "proxima_dose" de propósito: comprovantes de vacinação registram
// só as doses tomadas, sem agendar as seguintes. O campo existia e o OCR o
// preenchia com a data da dose SEGUINTE já aplicada, transformando histórico
// em agendamento — e o app passava a alertar "dose vencida" sobre uma dose que
// já tinha sido tomada. Vacina tem histórico e pendência, não vencimento.
export interface VacinaItem {
  nome: string
  data_aplicacao: string | null  // YYYY-MM-DD
  dose: string | null            // ex.: "1ª dose", "reforço"
}

// Doses com campo IMPRESSO no comprovante mas SEM data preenchida — ex.: o
// cartão traz o bloco "2ª DOSE" em branco. É leitura do documento, nunca
// inferência de calendário vacinal. Vira sugestão de lembrete no mural.
export type DosesPendentes = string[]

// Chave do metadata onde a lista vive. Não é um DocField (não é editável à
// mão), então seedDocValues/splitDocValues a tratam como caso especial.
export const DOSES_PENDENTES_KEY = 'doses_pendentes'

/**
 * Título do lembrete de dose faltante, ex.: "Tomar 2ª dose — Tríplice viral".
 * Se o nome da vacina já estiver embutido na descrição da dose, não repete.
 */
export function doseReminderTitle(dose: string, docTitle: string): string {
  const d = dose.trim()
  const t = docTitle.trim()
  const base = /^(tomar|aplicar)\b/i.test(d) ? d : `Tomar ${d}`
  if (!t || base.toLowerCase().includes(t.toLowerCase())) return base.slice(0, 80)
  return `${base} — ${t}`.slice(0, 80)
}

/**
 * Doses ainda pendentes de verdade: tira da lista do OCR as que já aparecem
 * como aplicadas em `vacinas`. Sem isso, o registro da dose faltante não
 * silenciaria o aviso — o usuário preencheria a 2ª dose e o app continuaria
 * cobrando por ela.
 */
export function dosesRealmentePendentes(
  vacinas: VacinaItem[] | undefined,
  dosesPendentes: string[] | undefined,
): string[] {
  // "2ª dose", "2a Dose" e "2º reforço" precisam casar. O indicador ordinal
  // (ª/º) não é acento — o NFD não o decompõe —, então é removido à parte, e
  // o "a"/"o" solto depois de um dígito também.
  const norm = (s: string) =>
    s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[ªº]/g, '')
      .replace(/(\d)[ao](?![a-z0-9])/g, '$1')
      .replace(/[^a-z0-9]/g, '')
  const aplicadas = new Set(
    (vacinas ?? []).filter(v => v.data_aplicacao && v.dose).map(v => norm(v.dose as string)),
  )
  return (dosesPendentes ?? []).filter(d => d && !aplicadas.has(norm(d)))
}

export const DOC_TYPES: Record<DocType, DocTypeDef> = {
  identidade: {
    type: 'identidade', label: 'Documento de identidade', category: 'identidade', childLabel: 'Titular',
    fields: [
      { key: 'doc_number', label: 'Nº do documento', format: 'texto', column: 'doc_number' },
      { key: 'issuer', label: 'Órgão expedidor', format: 'texto', column: 'issuer' },
      { key: 'issue_date', label: 'Data de expedição', format: 'data', column: 'issue_date' },
      { key: 'expires_at', label: 'Validade', format: 'data', column: 'expires_at' },
      { key: 'holder_name', label: 'Nome do titular', format: 'texto' },
      { key: 'cpf', label: 'CPF', format: 'cpf_cnpj' },
      { key: 'birth_date', label: 'Data de nascimento', format: 'data' },
      { key: 'naturalidade', label: 'Naturalidade', format: 'texto' },
    ],
  },
  contrato: {
    type: 'contrato', label: 'Contrato', category: 'contratos', childLabel: 'Vinculado a',
    fields: [
      { key: 'objeto', label: 'Objeto / finalidade', format: 'textarea' },
      { key: 'partes', label: 'Partes envolvidas', format: 'texto' },
      { key: 'partes_doc', label: 'CNPJ/CPF das partes', format: 'texto' },
      { key: 'issue_date', label: 'Data de assinatura', format: 'data', column: 'issue_date' },
      { key: 'vigencia_inicio', label: 'Vigência (início)', format: 'data' },
      { key: 'expires_at', label: 'Vigência (fim) / validade', format: 'data', column: 'expires_at' },
      { key: 'valor', label: 'Valor', format: 'valor' },
      { key: 'renovacao', label: 'Reajuste / renovação', format: 'texto' },
    ],
  },
  boleto: {
    type: 'boleto', label: 'Boleto / financeiro', category: 'financeiro', childLabel: 'Referente a',
    fields: [
      { key: 'beneficiario', label: 'Beneficiário / cedente', format: 'texto' },
      { key: 'valor', label: 'Valor', format: 'valor' },
      { key: 'expires_at', label: 'Vencimento', format: 'data', column: 'expires_at' },
      { key: 'competencia', label: 'Competência / referência', format: 'texto' },
      { key: 'linha_digitavel', label: 'Linha digitável', format: 'texto' },
    ],
  },
  exame_medico: {
    type: 'exame_medico', label: 'Exame médico', category: 'saude', childLabel: 'Paciente',
    fields: [
      { key: 'tipo_exame', label: 'Tipo de exame', format: 'texto' },
      { key: 'medico', label: 'Médico', format: 'texto' },
      { key: 'crm', label: 'CRM', format: 'crm' },
      { key: 'laboratorio', label: 'Laboratório / clínica', format: 'texto' },
      { key: 'issue_date', label: 'Data de realização', format: 'data', column: 'issue_date' },
      { key: 'expires_at', label: 'Validade', format: 'data', column: 'expires_at' },
    ],
  },
  receita_medica: {
    type: 'receita_medica', label: 'Receita médica', category: 'saude', childLabel: 'Paciente',
    fields: [
      { key: 'medicamento', label: 'Medicamento / finalidade', format: 'textarea' },
      { key: 'medico', label: 'Médico', format: 'texto' },
      { key: 'crm', label: 'CRM', format: 'crm' },
      { key: 'issue_date', label: 'Data de emissão', format: 'data', column: 'issue_date' },
      { key: 'expires_at', label: 'Validade', format: 'data', column: 'expires_at' },
      { key: 'uso_continuo', label: 'Uso contínuo', format: 'sim_nao' },
    ],
  },
  carteirinha_saude: {
    type: 'carteirinha_saude', label: 'Carteirinha de plano de saúde', category: 'carteirinhas', childLabel: 'Beneficiário',
    fields: [
      { key: 'issuer', label: 'Operadora / convênio', format: 'texto', column: 'issuer' },
      { key: 'doc_number', label: 'Nº da carteirinha', format: 'texto', column: 'doc_number' },
      { key: 'plano', label: 'Plano / acomodação', format: 'texto' },
      { key: 'ans', label: 'Registro ANS', format: 'texto' },
      { key: 'expires_at', label: 'Validade', format: 'data', column: 'expires_at' },
    ],
  },
  vacinacao: {
    type: 'vacinacao', label: 'Carteira de vacinação', category: 'vacinacao', childLabel: 'Paciente',
    fields: [
      { key: 'issuer', label: 'Posto / clínica', format: 'texto', column: 'issuer' },
      { key: 'vacinas', label: 'Vacinas', format: 'vacinas' },
    ],
  },
  boletim_escolar: {
    type: 'boletim_escolar', label: 'Boletim escolar', category: 'escolar', childLabel: 'Aluno',
    fields: [
      { key: 'issuer', label: 'Escola', format: 'texto', column: 'issuer' },
      { key: 'ano_letivo', label: 'Ano letivo', format: 'texto' },
      { key: 'periodo', label: 'Período / bimestre', format: 'texto' },
      { key: 'serie_turma', label: 'Série / turma', format: 'texto' },
      { key: 'situacao', label: 'Situação', format: 'texto' },
      { key: 'issue_date', label: 'Data', format: 'data', column: 'issue_date' },
    ],
  },
  autorizacao: {
    type: 'autorizacao', label: 'Autorização', category: 'autorizacoes', childLabel: 'Autorizado',
    fields: [
      { key: 'tipo', label: 'Tipo', format: 'texto' },
      { key: 'autorizante', label: 'Autorizante(s)', format: 'texto' },
      { key: 'finalidade', label: 'Finalidade', format: 'textarea' },
      { key: 'expires_at', label: 'Validade', format: 'data', column: 'expires_at' },
    ],
  },
  outro: {
    type: 'outro', label: 'Outro documento', category: 'outros', childLabel: 'Filho',
    fields: [
      { key: 'doc_number', label: 'Nº do documento', format: 'texto', column: 'doc_number' },
      { key: 'issuer', label: 'Emissor', format: 'texto', column: 'issuer' },
      { key: 'issue_date', label: 'Data de emissão', format: 'data', column: 'issue_date' },
      { key: 'expires_at', label: 'Validade', format: 'data', column: 'expires_at' },
    ],
  },
}

export const DOC_TYPE_KEYS = Object.keys(DOC_TYPES) as DocType[]

export function getDocType(type: string | null | undefined): DocTypeDef {
  return DOC_TYPES[(type as DocType)] ?? DOC_TYPES.outro
}

// Campos que vão para o jsonb metadata (os que NÃO mapeiam a coluna existente).
export function metadataFields(type: DocType): DocField[] {
  return DOC_TYPES[type].fields.filter(f => !f.column)
}

type ColumnKey = 'doc_number' | 'issuer' | 'issue_date' | 'expires_at' | 'description'

interface DocSource {
  doc_number?: string | null
  issuer?: string | null
  issue_date?: string | null
  expires_at?: string | null
  description?: string | null
  metadata?: Record<string, unknown> | null
}

// Valor inicial de um campo conforme o formato.
function emptyFor(f: DocField): unknown {
  if (f.format === 'vacinas') return [] as VacinaItem[]
  if (f.format === 'sim_nao') return false
  return ''
}

// Monta o mapa de valores (keyed por field.key) a partir de uma fonte (resultado
// do OCR ou um AppDocument). Campos de coluna vêm de source[column]; campos de
// metadata vêm de source.metadata[key].
export function seedDocValues(type: DocType, source: DocSource): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of DOC_TYPES[type].fields) {
    if (f.column) out[f.key] = (source[f.column] ?? '') as unknown
    else out[f.key] = source.metadata?.[f.key] ?? emptyFor(f)
  }
  // `doses_pendentes` não é campo editável — é saída do OCR que alimenta a
  // sugestão de lembrete. Sem este passthrough ela se perderia aqui (e no
  // split), e a sugestão nunca apareceria.
  if (type === 'vacinacao') {
    out[DOSES_PENDENTES_KEY] = source.metadata?.[DOSES_PENDENTES_KEY] ?? []
  }
  return out
}

// Separa os valores em colunas de `documents` e metadata (jsonb).
export function splitDocValues(type: DocType, values: Record<string, unknown>): {
  columns: Partial<Record<ColumnKey, string | null>>
  metadata: Record<string, unknown>
} {
  const columns: Partial<Record<ColumnKey, string | null>> = {}
  const metadata: Record<string, unknown> = {}
  for (const f of DOC_TYPES[type].fields) {
    const v = values[f.key]
    if (f.column) {
      columns[f.column] = (v == null || v === '') ? null : String(v)
    } else if (f.format === 'sim_nao') {
      metadata[f.key] = !!v
    } else if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
      continue
    } else {
      metadata[f.key] = v
    }
  }
  if (type === 'vacinacao') {
    const pend = values[DOSES_PENDENTES_KEY]
    if (Array.isArray(pend) && pend.length > 0) metadata[DOSES_PENDENTES_KEY] = pend
  }
  return { columns, metadata }
}
