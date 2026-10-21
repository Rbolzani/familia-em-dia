'use client'
// Caixa do cadeado (T10) — aparece em TODO recurso fora do plano: barra
// lateral (Logística, Alertas no WhatsApp), botão de voz, rede de apoio,
// "adicionar filho", cotas de reconhecimento e do cofre, e o botão da faixa
// do teste. Sempre com o botão para o plano seguinte (upsell).
// Textos aprovados pelo Rogério em 20/10/2026.
import { createContext, useCallback, useContext, useState } from 'react'
import { Lock, X } from 'lucide-react'
import { medir } from '@/lib/medicao'
import { NOME_PLANO, precoCobrado, reais, type Ciclo } from '@/lib/planos-oferta'
import type { PlanId } from '@/lib/planos-limites'

export type RecursoUpsell =
  | 'logistica' | 'rede' | 'voz' | 'whatsapp' | 'filho' | 'reconhecimentos' | 'cofre'
  | 'conhecer'   // botão "Conhecer o Família/Plus" da faixa do teste

type Alvo = 'familia' | 'plus'

function proximoMes(): string {
  const d = new Date(); d.setMonth(d.getMonth() + 1, 1)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}

/** Título, texto e plano-alvo de cada cadeado, conforme o plano atual. */
function textos(r: RecursoUpsell, plano: PlanId): { titulo: string; texto: string; alvo: Alvo } {
  const naFamilia = plano === 'familia'
  switch (r) {
    case 'logistica': return { alvo: 'familia', titulo: 'Combine quem leva e quem busca', texto: 'No Família, você e mais uma pessoa da sua rede de apoio dividem o leva e busca, com aviso no WhatsApp.' }
    case 'voz': return { alvo: 'familia', titulo: 'Fale em vez de digitar', texto: 'No Família, é só gravar um áudio e a agenda se organiza sozinha.' }
    case 'whatsapp': return { alvo: 'familia', titulo: 'A agenda do dia no seu WhatsApp', texto: 'No Família, todo dia, no horário que você escolher, chega o resumo das atividades, lembretes, vacinas e documentos.' }
    case 'reconhecimentos': return { alvo: 'familia', titulo: 'Você usou os 30 reconhecimentos deste mês', texto: `No Família, fotos, prints, textos e documentos são reconhecidos sem limite. O contador do Básico volta a zero em ${proximoMes()}.` }
    case 'rede': return naFamilia
      ? { alvo: 'plus', titulo: 'Rede de apoio sem limite', texto: 'O Família inclui você + 1 pessoa. No Plus, todos que ajudam na rotina entram.' }
      : { alvo: 'familia', titulo: 'Traga quem ajuda você', texto: 'No Família, o pai, a avó ou a babá veem a mesma agenda que você, com o nível de acesso que você escolher.' }
    case 'filho': return naFamilia
      ? { alvo: 'plus', titulo: 'Filhos sem limite', texto: 'O Família tem até 3 filhos. No Plus, você cadastra quantos quiser.' }
      : { alvo: 'familia', titulo: 'Cadastre mais um filho', texto: 'O Básico tem até 2 filhos. No Família são até 3; no Plus, ilimitados.' }
    case 'cofre': return naFamilia
      ? { alvo: 'plus', titulo: 'Seu cofre de 1 GB está cheio', texto: 'No Plus são 5 GB. Nenhum arquivo é apagado.' }
      : { alvo: 'familia', titulo: 'Seu cofre de 200 MB está cheio', texto: 'No Família são 1 GB; no Plus, 5 GB. Nenhum arquivo é apagado.' }
    case 'conhecer': return naFamilia
      ? { alvo: 'plus', titulo: 'Conheça o Plus', texto: 'Filhos e rede de apoio ilimitados, cofre de 5 GB e suporte prioritário.' }
      : { alvo: 'familia', titulo: 'Conheça o Família', texto: 'Por R$ 5 a mais: mais 1 filho, rede de apoio, reconhecimento ilimitado, reconhecimento por voz, resumo diário no WhatsApp e cofre de 1 GB.' }
  }
}

interface Ctx { plano: PlanId; abrir: (r: RecursoUpsell) => void }
const UpsellCtx = createContext<Ctx>({ plano: 'familia', abrir: () => {} })
export function useUpsell() { return useContext(UpsellCtx) }

export function UpsellProvider({ children, plano, ciclo, emTeste, fimTeste, isOwner }: {
  children: React.ReactNode
  plano: PlanId
  ciclo: Ciclo
  emTeste: boolean
  /** Fim do teste já formatado (dd/mm), quando em teste. */
  fimTeste: string | null
  isOwner: boolean
}) {
  const [aberto, setAberto] = useState<RecursoUpsell | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const abrir = useCallback((r: RecursoUpsell) => {
    medir('cadeado_clique', { recurso: r, plano })
    setErro(''); setAberto(r)
  }, [plano])

  async function assinar(alvo: Alvo) {
    setEnviando(true); setErro('')
    medir('upgrade_clique', { recurso: aberto ?? '', plano, alvo })
    try {
      const r = await fetch('/api/stripe/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: alvo, interval: ciclo }),
      })
      const j = await r.json()
      if (r.ok && j.url) { window.location.href = j.url; return }
      setErro(j.code === 'dados_pendentes' ? 'Abra a tela Planos para completar seus dados e mudar de plano.' : (j.error || 'Não foi possível mudar de plano agora.'))
    } catch { setErro('Sem conexão. Tente de novo.') }
    setEnviando(false)
  }

  const t = aberto ? textos(aberto, plano) : null
  const valorAlvo = t ? reais(precoCobrado(t.alvo, ciclo)) : ''

  return (
    <UpsellCtx.Provider value={{ plano, abrir }}>
      {children}
      {t && (
        <div role="dialog" aria-modal="true" onClick={() => setAberto(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,22,0.45)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 20, padding: '22px 22px 18px', maxWidth: 380, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.20)', position: 'relative' }}>
            <button onClick={() => setAberto(null)} aria-label="Fechar" style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#8A958B' }}><X size={16} /></button>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(140deg,#3D6641,#2C4A2E)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Lock size={17} color="#fff" />
            </div>
            <h3 style={{ fontFamily: 'var(--font-lora)', fontSize: 19, fontWeight: 700, color: '#1A2B1C', margin: '0 0 8px', lineHeight: 1.3 }}>{t.titulo}</h3>
            <p style={{ fontSize: 14, color: '#4A5A4C', margin: 0, lineHeight: 1.55 }}>{t.texto}</p>
            {isOwner ? (
              <>
                <p style={{ fontSize: 12.5, color: '#6B786C', margin: '12px 0 0', lineHeight: 1.5 }}>
                  {emTeste && fimTeste
                    ? `Muda agora e já pode usar. Seu teste continua até ${fimTeste}; a primeira cobrança será de ${valorAlvo}.`
                    : 'Você paga só a diferença proporcional deste mês, no mesmo cartão.'}
                </p>
                {erro && <p style={{ fontSize: 12.5, color: '#C0405A', margin: '10px 0 0' }}>{erro}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button onClick={() => assinar(t.alvo)} disabled={enviando}
                    style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: 'none', background: 'linear-gradient(140deg,#3D6641,#2C4A2E)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: enviando ? 0.6 : 1 }}>
                    {enviando ? 'Abrindo…' : t.alvo === 'plus' ? 'Mudar para o Plus' : `Assinar o ${NOME_PLANO.familia}`}
                  </button>
                  <button onClick={() => setAberto(null)}
                    style={{ padding: '11px 14px', borderRadius: 12, border: '1px solid #E2E8E1', background: '#fff', color: '#4A5A4C', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    Agora não
                  </button>
                </div>
              </>
            ) : (
              <p style={{ fontSize: 12.5, color: '#6B786C', margin: '12px 0 0' }}>Só quem criou a conta da família pode mudar o plano.</p>
            )}
          </div>
        </div>
      )}
    </UpsellCtx.Provider>
  )
}

/** Cadeado pequeno ao lado de um item travado. */
export function Cadeado({ size = 12 }: { size?: number }) {
  return <Lock size={size} aria-label="Recurso de outro plano" style={{ opacity: 0.7, flexShrink: 0 }} />
}

/** Página inteira de um recurso fora do plano (ex.: /logistica no Básico). */
export function RecursoTravado({ recurso }: { recurso: RecursoUpsell }) {
  const { plano, abrir } = useUpsell()
  const t = textos(recurso, plano)
  return (
    <div style={{ maxWidth: 460, margin: '40px auto', background: '#fff', borderRadius: 20, padding: 24, border: '1px solid rgba(61,102,65,0.12)', textAlign: 'center' }}>
      <div style={{ width: 44, height: 44, borderRadius: 13, background: 'linear-gradient(140deg,#3D6641,#2C4A2E)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
        <Lock size={19} color="#fff" />
      </div>
      <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 20, fontWeight: 700, color: '#1A2B1C', margin: '0 0 8px' }}>{t.titulo}</h2>
      <p style={{ fontSize: 14, color: '#4A5A4C', margin: '0 0 16px', lineHeight: 1.55 }}>{t.texto}</p>
      <button onClick={() => abrir(recurso)}
        style={{ padding: '11px 18px', borderRadius: 12, border: 'none', background: 'linear-gradient(140deg,#3D6641,#2C4A2E)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
        {t.alvo === 'plus' ? 'Mudar para o Plus' : 'Assinar o Família'}
      </button>
    </div>
  )
}
