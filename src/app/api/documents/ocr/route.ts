import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { getFamilyPlan, PLAN_LIMITS, consumirChamadaIa, mensagemLimiteDiario } from '@/lib/billing'
import { DOC_TYPES, DOC_TYPE_KEYS, getDocType, metadataFields, type DocType } from '@/lib/docTypes'
import { normalizeImage } from '@/lib/image'
import { sniff, SNIFF_BYTES } from '@/lib/fileSniff'

// O padrão da Vercel é 10s, e o tempo de SUBIDA DO ARQUIVO conta para a
// duração da função — um PDF grande em 4G passa disso. O mesmo ajuste já
// existia em upload, [id]/files e ai-extract; esta rota tinha ficado de fora.
//
// ⚠️ Isto NÃO era a causa da falha no celular (cheguei a supor que fosse e
// estava errado: um timeout deixaria a ampulheta girando por 10s, e ela não
// chegava a aparecer). É correção legítima e independente.
export const maxDuration = 60

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const MAX_FILE_BYTES = 12 * 1024 * 1024

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
- Retorne apenas o JSON.

REGRA CRÍTICA — números vêm do papel, nunca da memória:
Todo NÚMERO que você colocar em um campo (nº de documento, nº de carteirinha,
CPF, registro ANS, CRM) tem que aparecer LITERALMENTE no "ocr_text" que você
transcreveu. Copie dígito por dígito do que está escrito.
Se a imagem estiver girada, borrada, cortada ou com baixa resolução e você não
conseguir ler o número inteiro com certeza, devolva null — NÃO complete com
dígitos plausíveis, não deduza pelo formato típico, não use um número parecido
de outra parte do documento.
Um campo vazio é útil (a pessoa preenche); um número errado é pior que nada,
porque parece certo e vai ser salvo sem conferência.
Documentos costumam ter VÁRIOS números diferentes (ex.: nº da carteirinha e
Cartão Nacional de Saúde são coisas distintas) — não misture os dígitos de um
com os de outro.`

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

    // Teto diário (achado O3): no plano pago o limite mensal é Infinity, então
    // não havia teto nenhum e cada chamada custa dinheiro na Anthropic.
    const cota = await consumirChamadaIa(user.id)
    if (!cota.permitido) {
      return NextResponse.json({ error: mensagemLimiteDiario(cota) }, { status: 429 })
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
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'Arquivo muito grande (máx. 12 MB)' }, { status: 400 })
      }

      const bytes = Buffer.from(await file.arrayBuffer())

      // O CONTEÚDO decide o ramo — nunca `file.type`.
      //
      // Antes era `file.type === 'application/pdf'`. Seletores de arquivo no
      // Android entregam esse campo vazio ou 'application/octet-stream' com
      // frequência, e aí o PDF caía no ramo de imagem, que não trata PDF, e a
      // rota respondia 400. Mesmo arquivo, comportamento oposto entre desktop
      // e celular — que era exatamente o sintoma relatado.
      const kind = sniff(new Uint8Array(bytes.subarray(0, SNIFF_BYTES)))

      if (kind === 'pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } })
        continue
      }

      const normalized = await normalizeImage(bytes, file.type, file.name)
      if (!normalized) {
        // O log traz o que o navegador reportou E o que a assinatura diz —
        // sem os dois lados, um relato de "não funciona no celular" volta a
        // ser adivinhação.
        //
        // Mas NÃO o nome do arquivo: "20240321 CNH Rogério.pdf" carrega o
        // nome da pessoa, e o Sentry transforma console.* em breadcrumb e
        // manda para os EUA. A extensão responde a mesma pergunta.
        console.error('[ocr] formato nao suportado', {
          ext: (file.name.split('.').pop() ?? '').toLowerCase().slice(0, 8),
          type: file.type || '(vazio)',
          size: file.size,
          assinatura: kind ?? '(nao reconhecida)',
        })
        return NextResponse.json(
          { error: 'Formato não suportado para OCR (use JPG, PNG, WebP, PDF ou foto da câmera)' },
          { status: 400 })
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

    // ── Ancoragem: todo NÚMERO precisa existir no texto transcrito ──────────
    //
    // Caso real que motivou isto: foto de carteirinha de convênio girada 90°.
    // O cartão trazia "989 571 965638 011" e o CNS "898005183567028"; o campo
    // "Nº da carteirinha" foi preenchido com "6886569669280011" — 16 dígitos,
    // que não estão em lugar nenhum do cartão. Com o texto na vertical o
    // modelo lê mal e COMPLETA o que não conseguiu ler, porque número de
    // carteirinha é um padrão que ele conhece.
    //
    // O prompt já mandava não inventar. Pedido não é garantia — mesma lição
    // do sanitizePayments nas mensalidades. Aqui existe uma âncora barata: o
    // próprio `ocr_text` que o modelo acabou de transcrever. Se os dígitos do
    // campo não aparecem lá, o valor não veio do documento.
    //
    // Compara só DÍGITOS porque a transcrição preserva a formatação do papel
    // ("989 571 965638 011") e o campo costuma vir limpo.
    //
    // Fica em null em vez de errado: campo vazio o usuário preenche; campo
    // com número plausível e falso ele confere por cima e salva.
    const digitos = (s: string) => s.replace(/\D/g, '')
    const textoDigitos = digitos(typeof parsed.ocr_text === 'string' ? parsed.ocr_text : '')
    const descartados: string[] = []

    /** Mantém o valor só se os dígitos dele estiverem na transcrição. */
    function ancorado(campo: string, v: unknown): unknown {
      if (typeof v !== 'string') return v
      const d = digitos(v)
      // Menos de 5 dígitos não é identificador (é dose, série, andar…), e
      // exigir âncora aí geraria falso positivo.
      if (d.length < 5) return v
      if (textoDigitos.includes(d)) return v
      descartados.push(campo)
      return null
    }

    const rawMeta = (parsed.metadata && typeof parsed.metadata === 'object') ? parsed.metadata : {}
    const metadata: Record<string, unknown> = {}
    for (const k of Object.keys(rawMeta)) {
      if (!allowed.has(k) || rawMeta[k] == null || rawMeta[k] === '') continue
      const v = ancorado(`metadata.${k}`, rawMeta[k])
      if (v != null && v !== '') metadata[k] = v
    }

    const docNumber = ancorado('doc_number', parsed.doc_number ?? null)

    if (descartados.length > 0) {
      // Sem log, uma alucinação some sem deixar rastro — e é justamente o que
      // precisamos medir para saber se o prompt está bom.
      console.warn('[ocr] campos descartados por nao constarem no texto:', descartados)
    }

    return NextResponse.json({
      doc_type: docType,
      ocr_text: typeof parsed.ocr_text === 'string' ? parsed.ocr_text.slice(0, 12000) : '',
      title: parsed.title ?? null,
      description: parsed.description ?? null,
      doc_number: docNumber,
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
