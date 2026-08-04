// Shared semantic activity-merge logic used by DashboardClient and ActivitiesPage.

const SYNONYM_MAP: Record<string, string> = {
  avaliacao: 'PROVA', prova: 'PROVA', teste: 'PROVA', exame: 'PROVA',
  atividade: 'TAREFA', licao: 'TAREFA', tarefa: 'TAREFA', exercicio: 'TAREFA',
  consulta: 'CONSULTA', retorno: 'CONSULTA', sessao: 'CONSULTA',
}
const STOP_WORDS = new Set(['de', 'da', 'do', 'dos', 'das', 'a', 'o', 'e', 'em', 'um', 'uma'])

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .split(' ')
    .filter(w => !STOP_WORDS.has(w))
    .map(w => SYNONYM_MAP[w] ?? w)
    .join(' ')
}

export function titlesSimilar(a: string, b: string): boolean {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (na === nb) return true
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na]
  if (longer.startsWith(shorter) || longer.endsWith(shorter) || longer.includes(shorter)) return true
  const setA = new Set(na.split(' '))
  const setB = new Set(nb.split(' '))
  const overlap = [...setA].filter(w => setB.has(w)).length
  return overlap / Math.max(setA.size, setB.size) >= 0.80
}

/**
 * Agrupa a MESMA atividade repetida para filhos diferentes num único card
 * (ex.: "Reunião de pais" da Gabi e do João vira um card com dois badges).
 *
 * O horário faz parte da identidade: duas aulas seguidas da mesma matéria
 * ("Zoom 12:30" e "Zoom 13:15") são eventos distintos e devem virar cards
 * separados, cada um com seu horário de início. Sem comparar `time`, elas
 * viravam um card só — exibindo apenas o primeiro horário e repetindo o
 * nome do filho uma vez por ocorrência.
 */
export function mergeActivities<T extends { title: string; date: string | null; time?: string | null; category: string }>(
  acts: T[]
): T[][] {
  const groups: T[][] = []
  for (const a of acts) {
    const existing = groups.find(g =>
      g[0].date === a.date &&
      (g[0].time ?? null) === (a.time ?? null) &&
      g[0].category === a.category &&
      titlesSimilar(g[0].title, a.title)
    )
    if (existing) existing.push(a)
    else groups.push([a])
  }
  return groups
}
