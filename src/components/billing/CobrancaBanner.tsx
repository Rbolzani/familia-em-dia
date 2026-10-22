'use client'
// Faixa do topo no MODELO NOVO (teste com cartão). Textos aprovados pelo
// Rogério em 20/10/2026 (T8, T9, T15, T16, T17). A faixa do teste mantém a
// contagem de dias, como a do modelo antigo (TrialBanner, que segue valendo
// para as contas antigas).
import { useState } from 'react'
import { X, Clock, CreditCard, PauseCircle } from 'lucide-react'
import { useUpsell } from './Upsell'

export type FaixaCobranca =
  | { tipo: 'teste'; diasRestantes: number; cobrancaEm: string; plano: string; valor: string; conhecer: 'familia' | 'plus' | null; isOwner: boolean }
  | { tipo: 'cancelado'; noTeste: boolean; ate: string; isOwner: boolean }
  | { tipo: 'atraso'; ate: string; isOwner: boolean }
  | { tipo: 'pausada'; motivo: 'cancelada' | 'pagamento' | 'dono_saiu'; apagarEm: string; isOwner: boolean; dono: string | null }

export default function CobrancaBanner({ faixa }: { faixa: FaixaCobranca }) {
  const [fechada, setFechada] = useState(false)
  const { abrir } = useUpsell()
  // A faixa de conta pausada e a de cartão recusado não se fecham: são o que
  // explica por que nada pode ser editado / o que fazer para não pausar.
  if (fechada && (faixa.tipo === 'teste' || faixa.tipo === 'cancelado')) return null

  const alerta = faixa.tipo === 'atraso' || faixa.tipo === 'pausada'
  const bg = alerta ? 'linear-gradient(135deg,#FEF3C7,#FDE68A)' : 'linear-gradient(135deg,rgba(61,102,65,0.10),rgba(44,74,46,0.06))'
  const border = alerta ? '1px solid rgba(245,158,11,0.40)' : '1px solid rgba(61,102,65,0.20)'
  const color = alerta ? '#92400E' : '#2C4A2E'
  const iconBg = alerta ? 'linear-gradient(140deg,#F59E0B,#D97706)' : 'linear-gradient(140deg,#3D6641,#2C4A2E)'
  const Icone = faixa.tipo === 'atraso' ? CreditCard : faixa.tipo === 'pausada' ? PauseCircle : Clock

  let texto: React.ReactNode
  let botao: { rotulo: string; href?: string; onClick?: () => void } | null = null

  switch (faixa.tipo) {
    case 'teste': {
      const d = faixa.diasRestantes
      texto = d <= 0
        ? `Seu teste grátis termina hoje · primeira cobrança amanhã (${faixa.plano}, ${faixa.valor})`
        : `Teste grátis: ${d} dia${d > 1 ? 's' : ''} restante${d > 1 ? 's' : ''} · primeira cobrança em ${faixa.cobrancaEm} (${faixa.plano}, ${faixa.valor})`
      if (faixa.isOwner) {
        botao = faixa.conhecer
          ? { rotulo: faixa.conhecer === 'plus' ? 'Conhecer o Plus' : 'Conhecer o Família', onClick: () => abrir('conhecer') }
          : { rotulo: 'Gerenciar', href: '/planos' }
      }
      break
    }
    case 'cancelado':
      texto = faixa.noTeste
        ? `Assinatura cancelada · nenhuma cobrança será feita · acesso até ${faixa.ate}`
        : `Assinatura cancelada · acesso até ${faixa.ate}`
      if (faixa.isOwner) botao = { rotulo: 'Reativar', href: '/planos' }
      break
    case 'atraso':
      texto = faixa.isOwner
        ? <><strong>Não conseguimos cobrar seu cartão.</strong> Atualize até {faixa.ate} para não pausar a conta.</>
        : <>A assinatura da família está com o pagamento pendente.</>
      if (faixa.isOwner) botao = { rotulo: 'Atualizar cartão', href: '/planos?acao=cartao' }
      break
    case 'pausada':
      if (faixa.isOwner && faixa.motivo === 'dono_saiu') {
        texto = <><strong>Esta família agora é sua.</strong> Quem a criou saiu do Família em Dia, e os dados continuam aqui. A conta está pausada: dá para ver tudo, mas não criar nem editar até você assinar um plano. Sem assinatura, os dados ficam guardados até {faixa.apagarEm}.</>
        botao = { rotulo: 'Assinar', href: '/assinar?reativar=1' }
      } else if (faixa.isOwner) {
        texto = <><strong>Sua conta está pausada.</strong> {faixa.motivo === 'pagamento' ? 'Não conseguimos cobrar o cartão.' : 'A assinatura foi cancelada.'} Você ainda pode ver sua agenda e seus documentos, mas não pode criar nem editar. Seus dados ficam guardados até {faixa.apagarEm}; depois disso, a conta é apagada.</>
        botao = { rotulo: 'Reativar assinatura', href: '/assinar?reativar=1' }
      } else {
        const dono = faixa.dono ?? 'quem te convidou'
        texto = <><strong>A conta de {dono} está pausada.</strong> Você pode ver a agenda, mas não editar, até que {dono} reative a assinatura.</>
      }
      break
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: bg, border, borderRadius: 14, margin: '0 0 12px' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icone size={15} color="white" />
      </div>
      <p style={{ flex: 1, fontSize: 13, fontWeight: 600, color, margin: 0, lineHeight: 1.4 }}>{texto}</p>
      {botao && (botao.href
        ? <a href={botao.href} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 10, background: alerta ? 'linear-gradient(140deg,#F59E0B,#D97706)' : 'linear-gradient(140deg,#3D6641,#2C4A2E)', color: 'white', fontSize: 12, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>{botao.rotulo}</a>
        : <button onClick={botao.onClick} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(140deg,#3D6641,#2C4A2E)', color: 'white', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{botao.rotulo}</button>
      )}
      {(faixa.tipo === 'teste' || faixa.tipo === 'cancelado') && (
        <button onClick={() => setFechada(true)} aria-label="Fechar" style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 4, color, opacity: 0.55 }}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}
