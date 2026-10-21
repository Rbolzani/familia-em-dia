// Planos e limites — sem dependência de servidor: usado tanto pelas rotas
// (via billing.ts, que reexporta) quanto pelas telas (cadeados, contadores).

// Planos:
//   · basico / familia / plus — os três planos da oferta (desde a virada para o
//     teste com cartão). Preços e tabela em planos-oferta.ts.
//   · free    — gratuito do MODELO ANTIGO: só existe para contas criadas antes
//     da virada (teste sem cartão), que mantêm as condições com que foram
//     criadas (Termos 5.12). Não é oferecido a contas novas.
//   · pausada — conta do modelo novo sem assinatura válida (cancelada ao fim do
//     período, cartão recusado além da carência, ou cadastro não concluído).
//     Só leitura: a barreira real é o banco (`familia_pode_editar`, usada por
//     auth_can_edit); os limites zerados abaixo impedem as rotas de custo
//     (IA, voz, upload) de rodar mesmo que alguém as chame direto.
export type PlanId = 'free' | 'basico' | 'familia' | 'plus' | 'pausada'

// OCR de documentos: auto-preenche campos ao escanear. No Básico ele existe, mas
// cada leitura conta nos 30 reconhecimentos do mês (foto, texto e documentos
// somam juntos — decisão do Rogério, 20/10/2026).
const MB = 1024 * 1024
const GB = 1024 * MB

export interface LimitesDoPlano {
  children: number
  aiPerMonth: number          // reconhecimentos/mês: foto, print, texto e documentos
  partners: number            // pessoas na rede de apoio, além do dono
  ocr: boolean                // leitura de documentos no cofre
  documentSearch: boolean     // busca full-text dentro dos documentos
  storageLimitBytes: number   // 0 = sem upload de arquivos no cofre
  voice: boolean              // reconhecimento por voz
  whatsapp: boolean           // resumo diário no WhatsApp
  logistics: boolean          // logística de leva e busca
}

export const PLAN_LIMITS: Record<PlanId, LimitesDoPlano> = {
  // Gratuito antigo NÃO envia arquivo novo ao cofre — o envio é do plano pago.
  //
  // ⚠️ Zero aqui bloqueia o ENVIO, nunca o acesso. Ler e baixar não dependem
  // de plano em lugar nenhum (signed-url e a tela de detalhe não checam), e
  // nada apaga arquivo por troca de plano. Quem subiu documentos durante o
  // trial e voltou para o gratuito continua com tudo — só para de subir.
  //
  // Como o limite é zero, "liberar espaço" NÃO resolve para este plano: a
  // mensagem precisa apontar para a assinatura, não para apagar arquivos.
  free:    { children: 2,        aiPerMonth: 5,        partners: 0,        ocr: false, documentSearch: false, storageLimitBytes: 0,        voice: false, whatsapp: false, logistics: true  },
  basico:  { children: 2,        aiPerMonth: 30,       partners: 0,        ocr: true,  documentSearch: true,  storageLimitBytes: 200 * MB, voice: false, whatsapp: false, logistics: false },
  familia: { children: 3,        aiPerMonth: Infinity, partners: 1,        ocr: true,  documentSearch: true,  storageLimitBytes: 1 * GB,   voice: true,  whatsapp: true,  logistics: true  },
  plus:    { children: Infinity, aiPerMonth: Infinity, partners: Infinity, ocr: true,  documentSearch: true,  storageLimitBytes: 5 * GB,   voice: true,  whatsapp: true,  logistics: true  },
  pausada: { children: 0,        aiPerMonth: 0,        partners: 0,        ocr: false, documentSearch: true,  storageLimitBytes: 0,        voice: false, whatsapp: false, logistics: false },
}

/** Próximo plano que libera um recurso — usado pelo cadeado (upsell). */
export function planoQueLibera(atual: PlanId): 'familia' | 'plus' | null {
  if (atual === 'plus') return null
  if (atual === 'familia') return 'plus'
  return 'familia'
}

/**
 * Bytes em texto legível.
 *
 * As rotas de upload formatavam a cota com `Math.round(limit / 1024**3)`, que
 * só funciona para limites em GB. Com o gratuito em 50 MB isso passou a
 * imprimir "Seu plano permite 0 GB" — mensagem sem sentido justamente para
 * quem mais precisa entender o limite.
 */
export function formatarBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes % 1024 ** 3 === 0 ? 0 : 1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * Texto do 402 de cota. Vive aqui porque as DUAS rotas de upload precisam
 * dizer a mesma coisa — e antes cada uma tinha sua própria versão.
 *
 * Os três casos são diferentes de verdade, e a diferença importa:
 *
 *  · limite ZERO e nada guardado → nunca teve cofre; convite direto ao plano.
 *  · limite ZERO com arquivos    → usou o trial e voltou ao gratuito. Precisa
 *    ouvir, antes de qualquer outra coisa, que NÃO vai perder o que guardou.
 *    E "libere espaço" seria mentira: com limite zero, apagar não libera nada.
 *  · limite > 0 estourado        → aí sim liberar espaço resolve.
 */
export function mensagemDeCota(limit: number, used: number, incoming: number): string {
  if (limit === 0) {
    return used > 0
      ? `Seus ${formatarBytes(used)} de documentos continuam guardados e acessíveis. Para enviar novos arquivos, assine um plano.`
      : 'O envio de arquivos ao cofre faz parte dos planos pagos.'
  }
  return used > limit
    ? `Você está usando ${formatarBytes(used)}, acima dos ${formatarBytes(limit)} do seu plano. Seus documentos continuam guardados e acessíveis, mas para enviar novos é preciso liberar espaço ou mudar de plano.`
    : `Espaço insuficiente: você usa ${formatarBytes(used)} de ${formatarBytes(limit)} e este envio tem ${formatarBytes(incoming)}.`
}

export const PLAN_LABELS: Record<PlanId, string> = {
  free:    'Gratuito',
  basico:  'Básico',
  familia: 'Família',
  plus:    'Plus',
  pausada: 'Conta pausada',
}

