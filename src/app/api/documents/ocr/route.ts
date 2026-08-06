import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { getFamilyPlan, PLAN_LIMITS } from '@/lib/billing'
import { DOC_TYPES, DOC_TYPE_KEYS, getDocType, metadataFields, type DocType } from '@/lib/docTypes'
import { normalizeImage } from '@/lib/image'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const MAX_FILE_BYTES = 12 * 1024 * 1024
const PDF_TYPE = 'application/pdf'

// Catálogo de tipos derivado do schema (fonte única em lib/docTypes).
const CATALOG = DOC_TYPE_KEYS.map(t => {
  const def = DOC_TYPES[t]
  const root = def.fields.filter(f => f.column).map(f => `${f.column} = ${f.label}`).join('; ')
  const meta = def.fields.filter(f => !f.column).map(f => `${f.key} (${f.label})`).join('; ')
  return `- ${t} → ${def.label}\n    raiz: ${root || '—'}\n    metadata: ${meta || '—'}`
}).join('\n')

const PROMPT = `Você faz OCR e EXTRAÇÃO ESTRUTURADA de UM documento (1 ou 2 imagens — pode ser frente e verso — ou um PDF) enviado por um pai/mãe para um cofre digital familiar.

Hoje é: ${new Date().toISOString().split('T')[0]}

Tarefas:
1) Classifique a NATUREZA do documento em um de: ${DOC_TYPE_KEYS.join(', ')} (use "outro" se não tiver certeza).
2) Transcreva TODO o texto legível em "ocr_text" (fiel; pode ser longo). Se houver 2 imagens (frente/verso), junte o texto das duas.
3) Preencha os campos. Campos COMUNS vão na RAIZ do JSON; campos específicos do tipo vão dentro de "metadata".

Campos comuns na raiz (preencha conforme o significado no tipo — ver catálogo): title, description, doc_number, issuer, issue_date, expires_at.

Catálogo de tipos (o que extrair de cada um):
${CATALOG}

Regra especial — vacinacao:
"metadata.vacinas" é o HISTÓRICO do que JÁ FOI APLICADO. Array de objetos:
[{ "nome": "BCG", "data_aplicacao": "YYYY-MM-DD|null", "dose": "1ª dose|reforço|null" }]

NUNCA invente data de próxima dose. Comprovantes de vacinação registram apenas
as doses tomadas; não existe campo de agendamento neles. A data de uma dose
JAMAIS deve ser copiada como "próxima dose" de outra.

"metadata.doses_pendentes" é um array de textos curtos, para doses que têm
campo IMPRESSO no comprovante mas estão SEM data preenchida.
Ex.: o cartão traz os blocos "1ª DOSE" e "2ª DOSE", o primeiro preenchido e o
segundo em branco → ["2ª dose"].
Se todos os blocos impressos estiverem preenchidos, retorne [].
NUNCA deduza doses a partir de calendário vacinal, idade ou fabricante — só
reporte um campo que esteja visivelmente vazio no papel.

Formato de saída — retorne APENAS um JSON válido (sem markdown, sem texto fora):
{
  "doc_type": "<um dos tipos>",
  "ocr_text": "texto transcrito",
  "title": "nome curto e descritivo (ex: 'RG da Gabriela', 'Boleto escola março') ou null",
  "description": "string ou null",
  "doc_number": "string ou null",
  "issuer": "string ou null",
  "issue_date": "YYYY-MM-DD ou null",
  "expires_at": "YYYY-MM-DD ou null",
  "metadata": { ...chaves específicas do tipo... }
}

Regras:
- Datas SEMPRE no formato YYYY-MM-DD; se não houver, null.
- Não invente dados: campo ausente = null (ou ausente em metadata).
- "metadata" deve conter apenas as chaves do tipo classificado.
- Retorne apenas o JSON.`

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    // Gate de plano: OCR é recurso pago (Família/Plus), volume ilimitado.
    const plan = await getFamilyPlan()
    if (!PLAN_LIMITS[plan].ocr) {
      return NextResponse.json({ error: 'LIMIT_OCR', plan }, { status: 402 })
    }

    const form = await req.formData()
    // Aceita 'files' (até 2: frente+verso) com fallback a 'file' (compat).
    let files = form.getAll('files').filter(f => f instanceof File) as File[]
    const single = form.get('file')
    if (files.length === 0 && single instanceof File) files = [single]
    files = files.slice(0, 2)
    if (files.length === 0) return NextResponse.json({ error: 'Envie um arquivo' }, { status: 400 })

    const content: Anthropic.Messages.ContentBlockParam[] = []
    for (const file of files) {
      const isPdf = file.type === PDF_TYPE
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'Arquivo muito grande (máx. 12 MB)' }, { status: 400 })
      }
      if (isPdf) {
        const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } })
        continue
      }
      const bytes = Buffer.from(await file.arrayBuffer())
      const normalized = await normalizeImage(bytes, file.type, file.name)
      if (!normalized) {
        return NextResponse.json({ error: 'Formato não suportado para OCR (use JPG, PNG, WebP, PDF ou foto da câmera)' }, { status: 400 })
      }
      content.push({ type: 'image', source: { type: 'base64', media_type: normalized.mediaType, data: normalized.buffer.toString('base64') } })
    }
    content.push({ type: 'text', text: PROMPT })

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(jsonStr)

    // Valida o tipo e filtra o metadata para só as chaves daquele tipo.
    const docType: DocType = DOC_TYPE_KEYS.includes(parsed.doc_type) ? parsed.doc_type : 'outro'
    const allowed = new Set(metadataFields(docType).map(f => f.key))
    const rawMeta = (parsed.metadata && typeof parsed.metadata === 'object') ? parsed.metadata : {}
    const metadata: Record<string, unknown> = {}
    for (const k of Object.keys(rawMeta)) {
      if (allowed.has(k) && rawMeta[k] != null && rawMeta[k] !== '') metadata[k] = rawMeta[k]
    }

    return NextResponse.json({
      doc_type: docType,
      ocr_text: typeof parsed.ocr_text === 'string' ? parsed.ocr_text.slice(0, 12000) : '',
      title: parsed.title ?? null,
      description: parsed.description ?? null,
      doc_number: parsed.doc_number ?? null,
      issuer: parsed.issuer ?? null,
      issue_date: parsed.issue_date ?? null,
      expires_at: parsed.expires_at ?? null,
      metadata,
      category: getDocType(docType).category, // gaveta sugerida
    })
  } catch (e) {
    console.error('OCR error:', e)
    return NextResponse.json({ error: 'Não foi possível ler o documento. Tente novamente.' }, { status: 500 })
  }
}
