import { createClient } from '@/lib/supabase/client'
import { dosesRealmentePendentes, doseReminderTitle, DOSES_PENDENTES_KEY } from '@/lib/docTypes'
import type { DocType, VacinaItem } from '@/lib/docTypes'

/**
 * Cria no mural (activities com date=null) um lembrete por dose que o
 * comprovante mostra em branco.
 *
 * Vacina não tem "vencimento": o comprovante registra o que foi aplicado e
 * não agenda a dose seguinte. Por isso a dose faltante vira pendência sem
 * prazo, que os pais dão check quando tomarem — em vez de um alerta de
 * vencimento sobre uma data que ninguém marcou.
 *
 * Conveniência: se falhar, o documento já está salvo e o usuário pode criar o
 * lembrete à mão. Retorna quantos lembretes entraram.
 */
export async function createDoseReminders(opts: {
  docTitle: string
  childId: string | null
  vacinas: VacinaItem[] | undefined
  dosesPendentes: string[] | undefined
}): Promise<number> {
  const doses = dosesRealmentePendentes(opts.vacinas, opts.dosesPendentes)
  if (doses.length === 0) return 0

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0

  const rows = doses.map(d => ({
    user_id: user.id,
    child_id: opts.childId,
    category: 'saude' as const,
    title: doseReminderTitle(d, opts.docTitle),
    date: null,          // sem data = mural de lembretes
    status: 'pendente' as const,
    ai_generated: true,
  }))

  const { error } = await supabase.from('activities').insert(rows)
  if (error) return 0
  return rows.length
}

/**
 * Ponte entre o formulário e `createDoseReminders`, usada nos três pontos de
 * salvamento (upload no cofre, upload na gaveta, edição do detalhe).
 *
 * MUTA `metadata`: quando os lembretes são criados, apaga `doses_pendentes`
 * para que um segundo salvamento do mesmo documento não gere lembretes
 * duplicados. Se o usuário desmarcou o checkbox, a lista fica gravada e a
 * sugestão continua disponível numa próxima edição.
 */
export async function applyDoseReminders(opts: {
  docType: DocType
  values: Record<string, unknown>
  metadata: Record<string, unknown>
  docTitle: string
  childId: string | null
}): Promise<number> {
  if (opts.docType !== 'vacinacao') return 0
  if (opts.values.criar_lembrete_doses === false) return 0

  const created = await createDoseReminders({
    docTitle: opts.docTitle,
    childId: opts.childId,
    vacinas: opts.values.vacinas as VacinaItem[] | undefined,
    dosesPendentes: opts.values[DOSES_PENDENTES_KEY] as string[] | undefined,
  })
  if (created > 0) delete opts.metadata[DOSES_PENDENTES_KEY]
  return created
}
