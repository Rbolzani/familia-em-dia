'use client'
import { useState } from 'react'
import {
  ChevronDown, Rocket, CalendarDays, Sparkles,
  FolderLock, Car, Users, MessageCircle, CreditCard, Shield,
} from 'lucide-react'
import { DESCONTO_ANUAL_PCT, DIAS_TESTE, precoPorMes, reais } from '@/lib/planos-oferta'

interface FAQItem {
  q: string
  a: string
}

interface FAQSection {
  icon: React.ElementType
  title: string
  items: FAQItem[]
}

const SECTIONS: FAQSection[] = [
  {
    icon: Rocket,
    title: 'Primeiros passos',
    items: [
      {
        q: 'Como criar minha conta?',
        a: 'Acesse o app, clique em "Cadastrar" e informe seu e-mail e uma senha. Você receberá um e-mail de confirmação — clique no link para ativar sua conta.',
      },
      {
        q: 'Preciso instalar alguma coisa?',
        a: 'Não. O Família em Dia funciona direto no navegador. No celular, você pode adicioná-lo à tela inicial como um app (toque no menu do navegador → "Adicionar à tela inicial").',
      },
      {
        q: 'Como cadastro meus filhos?',
        a: 'Acesse Meus Filhos e toque em "Adicionar filho". Informe nome, data de nascimento e escola (opcional). Você pode cadastrar quantos filhos quiser conforme seu plano.',
      },
    ],
  },
  {
    icon: CalendarDays,
    title: 'Atividades e agenda',
    items: [
      {
        q: 'Qual a diferença entre Escola, Saúde e Atividades?',
        a: 'São categorias para organizar melhor. Escola reúne lições, provas e eventos escolares. Saúde guarda consultas, vacinas e histórico médico. Atividades cobre aulas extracurriculares como natação, inglês e esportes.',
      },
      {
        q: 'O que são lembretes/pendências?',
        a: 'São tarefas sem data definida — coisas do tipo "comprar material escolar" ou "renovar carteirinha". Ficam no mural da tela Início e você marca como concluído quando quiser.',
      },
      {
        q: 'Posso lançar a mesma atividade para mais de um filho ao mesmo tempo?',
        a: 'Sim. Ao criar uma atividade, selecione múltiplos filhos e o app cria registros individuais para cada um.',
      },
    ],
  },
  {
    icon: Sparkles,
    title: 'Captura por IA',
    items: [
      {
        q: 'Como funciona a captura por IA?',
        a: 'Na tela Captura IA, você pode fotografar a agenda escolar, colar um print ou digitar texto livre. A IA lê o conteúdo e classifica automaticamente em atividades (com data), lembretes (sem data) ou documentos — e você revisa antes de salvar.',
      },
      {
        q: 'Posso usar voz para capturar atividades?',
        a: 'Sim, no plano Família e Plus. Toque no botão de microfone na tela de Captura IA, fale o que precisa registrar e o app transcreve e analisa automaticamente.',
      },
      {
        q: 'A IA erra às vezes. O que fazer?',
        a: 'Antes de salvar, você revisa e edita todos os itens que a IA extraiu. Nada é salvo sem sua confirmação.',
      },
      {
        q: 'Quantas capturas por IA posso fazer?',
        a: 'No plano Básico, 30 reconhecimentos por mês (fotos, prints, textos e documentos somam juntos). Nos planos Família e Plus, uso ilimitado.',
      },
    ],
  },
  {
    icon: FolderLock,
    title: 'Cofre de Documentos',
    items: [
      {
        q: 'Que tipos de documentos posso guardar?',
        a: 'RG, carteiras de vacinação, planos de saúde, receitas, exames, certidões, contratos, carteirinhas, seguros e outros. O app detecta automaticamente o tipo ao fotografar.',
      },
      {
        q: 'A IA realmente preenche o documento sozinha?',
        a: 'Sim. Ao fotografar ou fazer upload de um documento, a IA identifica automaticamente o tipo (RG, carteirinha de vacinação, plano de saúde, contrato e outros), extrai os dados principais — nome, número, data de validade, emissor — e pré-preenche o formulário para você. Basta revisar e salvar em segundos, sem digitar nada.',
      },
      {
        q: 'Como encontro um documento específico rapidamente?',
        a: 'O cofre tem um buscador de palavras-chave que vasculha título, número do documento, nome do titular e observações ao mesmo tempo. Digite qualquer trecho — o número do CPF, o nome do plano de saúde, o tipo do exame — e o documento aparece instantaneamente.',
      },
      {
        q: 'O app avisa quando um documento vai vencer?',
        a: 'Sim. Documentos com data de validade cadastrada geram alertas no painel Início e no resumo diário via WhatsApp quando estão a menos de 30 dias do vencimento.',
      },
      {
        q: 'Os documentos são seguros?',
        a: 'Sim. Os arquivos ficam em armazenamento privado — ninguém de fora consegue acessar. O download usa links temporários que expiram em 1 hora.',
      },
      {
        q: 'Quanto espaço tenho para guardar documentos?',
        a: 'O cofre tem 200 MB no Básico, 1 GB no Família e 5 GB no Plus. Se o espaço acabar, nenhum arquivo é apagado: só os novos envios ficam bloqueados até liberar espaço ou mudar de plano.',
      },
    ],
  },
  {
    icon: Users,
    title: 'Compartilhamento com parceiro(a)',
    items: [
      {
        q: 'Como convido meu parceiro(a)?',
        a: 'Acesse Compartilhar Acesso e copie o link de convite ou envie pelo WhatsApp. Seu parceiro precisará ter uma conta no app para aceitar.',
      },
      {
        q: 'Quais níveis de acesso posso conceder?',
        a: 'Três opções: Apenas leitura (vê tudo, não edita), Leitura + logística (edita só quem leva/busca), Acesso completo (edita tudo como você).',
      },
      {
        q: 'Posso mudar o nível de acesso depois?',
        a: 'Sim, a qualquer momento em Compartilhar Acesso. Você também pode revogar o acesso completamente.',
      },
      {
        q: 'O parceiro vê meus dados financeiros ou de pagamento?',
        a: 'Não. O parceiro herda o plano da sua conta sem custo adicional, mas não tem acesso a nenhuma informação de pagamento ou assinatura.',
      },
      {
        q: 'Posso ter mais de um parceiro?',
        a: 'Depende do plano. Família permite 1 parceiro, Plus permite múltiplos.',
      },
    ],
  },
  {
    icon: Car,
    title: 'Logística — quem leva e quem busca',
    items: [
      {
        q: 'O que é a Logística?',
        a: 'É o módulo onde os responsáveis combinam quem leva e quem busca cada filho em cada atividade. Cada atividade tem dois "slots": Leva e Busca — que podem ser assumidos, sugeridos ou deixados em aberto. Para que a logística entre pessoas funcione, é necessário que o acesso esteja sendo compartilhado com ao menos um parceiro (veja a seção Compartilhamento acima).',
      },
      {
        q: 'Como assumo o transporte de uma atividade?',
        a: 'Na tela Logística ou direto no card da atividade, toque no slot "Leva" ou "Busca" e selecione seu nome. O registro é imediato e o seu parceiro vê a atualização em tempo real.',
      },
      {
        q: 'Como sugiro para o parceiro que ele/ela leve ou busque?',
        a: 'Toque no slot desejado e escolha o nome do parceiro. O app envia uma sugestão — o parceiro recebe uma notificação e pode aceitar ou recusar.',
      },
      {
        q: 'Como fico sabendo que recebi uma sugestão?',
        a: 'O sino de notificações no topo do app exibe um contador com as sugestões pendentes. Ao abrir, você vê o detalhe e pode aceitar ou recusar diretamente de lá. Você também vê o número de pendências destacado no menu Logística. Além disso, você recebe um aviso no WhatsApp informando que há uma ação pendente no app — o mesmo vale para notificações de recusa, para que nenhum combinado fique no esquecimento.',
      },
      {
        q: 'O que acontece se eu recusar uma sugestão?',
        a: 'O slot volta a ficar em aberto e o parceiro que fez a sugestão recebe uma notificação de recusa — no app e no WhatsApp. Qualquer um dos dois pode então assumir ou fazer uma nova sugestão.',
      },
      {
        q: 'E se os dois assumirem o mesmo slot ao mesmo tempo?',
        a: 'O app detecta o conflito e exibe um aviso: "fulano já assumiu — deseja reatribuir?" Você decide se quer substituir ou manter quem já estava.',
      },
      {
        q: 'O parceiro pode editar a logística sem minha permissão?',
        a: 'Depende do nível de acesso concedido. Acesso "Leitura + logística" permite que o parceiro edite apenas os slots de leva/busca, sem mexer em nenhum outro dado. Acesso "Apenas leitura" não permite nenhuma edição.',
      },
      {
        q: 'Se o acesso do parceiro for revogado, o que acontece com as fichas de logística que ele tinha assumido?',
        a: 'As fichas permanecem registradas para você ter o histórico. Os slots ficam disponíveis para serem reassumidos ou sugeridos normalmente.',
      },
    ],
  },
  {
    icon: MessageCircle,
    title: 'Alertas via WhatsApp',
    items: [
      {
        q: 'Como recebo o resumo diário?',
        a: 'Acesse Configurações → Alertas, informe seu número de WhatsApp e ative o resumo diário. Você escolhe o horário de envio.',
      },
      {
        q: 'O resumo é gratuito?',
        a: 'O resumo diário de atividades faz parte dos planos Família e Plus. O plano Básico não tem o resumo no WhatsApp.',
      },
      {
        q: 'Não estou recebendo as mensagens. O que fazer?',
        a: 'Verifique se o número está correto (com DDD), se o WhatsApp está ativo nesse número e se o resumo está habilitado nas configurações de alertas.',
      },
    ],
  },
  {
    icon: CreditCard,
    title: 'Planos e assinatura',
    items: [
      {
        q: 'Quais são os planos disponíveis?',
        a: `Básico (${reais(precoPorMes('basico', 'month'))}/mês), Família (${reais(precoPorMes('familia', 'month'))}/mês, o recomendado) e Família Plus (${reais(precoPorMes('plus', 'month'))}/mês). No plano anual há ${DESCONTO_ANUAL_PCT}% de desconto. A comparação completa está em Planos.`,
      },
      {
        q: 'Preciso cadastrar o cartão?',
        a: `Sim. O cartão é pedido no cadastro, mas nada é cobrado nos ${DIAS_TESTE} dias de teste. Você recebe avisos 7 dias, 3 dias e 1 dia antes da primeira cobrança.`,
      },
      {
        q: 'Como cancelo?',
        a: 'Na tela Planos do app, a qualquer momento. Cancelando durante o teste, nada é cobrado e você usa até o fim dos 14 dias.',
      },
      {
        q: 'Existe plano gratuito?',
        a: `Não. Todos os planos têm ${DIAS_TESTE} dias grátis para você conhecer antes de pagar.`,
      },
      {
        q: 'Posso trocar de plano?',
        a: 'Sim, a qualquer momento, inclusive durante o teste — sem custo até a primeira cobrança.',
      },
      {
        q: 'O que acontece se eu cancelar?',
        a: 'Você usa até o fim do período (ou do teste). Depois, a conta fica pausada: dá para ver tudo por 90 dias e reativar quando quiser.',
      },
      {
        q: 'Meu cartão foi recusado. E agora?',
        a: 'Você tem 7 dias para atualizar o cartão em Planos, sem perder o acesso. Avisamos por e-mail e WhatsApp.',
      },
      {
        q: 'Tenho reembolso?',
        a: 'Os 14 dias grátis servem para você conhecer o app antes de pagar, e você recebe avisos antes da primeira cobrança. Depois da cobrança não há reembolso proporcional; se algo deu errado, fale com o suporte.',
      },
    ],
  },
  {
    icon: Shield,
    title: 'Privacidade e segurança',
    items: [
      {
        q: 'Meus dados são compartilhados com terceiros?',
        a: 'Não. Os dados da sua família são privados e isolados. Consulte nossa Política de Privacidade para detalhes.',
      },
      {
        q: 'Posso excluir minha conta?',
        a: 'Sim. Entre em contato com o suporte e solicitaremos a exclusão completa de todos os seus dados.',
      },
    ],
  },
]

function FAQAccordion({ items }: { items: FAQItem[] }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
      {items.map((item, i) => (
        <div key={i}
          style={{ background:'#FFFFFF', borderRadius: i === 0 ? '14px 14px 4px 4px' : i === items.length - 1 ? '4px 4px 14px 14px' : 4,
            border:'1px solid rgba(61,102,65,0.10)', overflow:'hidden' }}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
              gap:12, padding:'14px 16px', background:'none', border:'none', cursor:'pointer', textAlign:'left' }}>
            <span style={{ fontSize:14, fontWeight:600, color:'#1A2B1C', lineHeight:1.4, flex:1 }}>
              {item.q}
            </span>
            <ChevronDown size={16} color="rgba(61,102,65,0.55)"
              style={{ flexShrink:0, transition:'transform 0.2s', transform: open === i ? 'rotate(180deg)' : 'rotate(0deg)' }} />
          </button>
          {open === i && (
            <div style={{ padding:'0 16px 16px', borderTop:'1px solid rgba(61,102,65,0.08)' }}>
              <p style={{ margin:'12px 0 0', fontSize:13.5, color:'rgba(26,43,28,0.68)', lineHeight:1.65 }}>
                {item.a}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function FAQPage() {
  return (
    <div style={{ minHeight:'100vh', background:'#F8F3EA', paddingBottom:'env(safe-area-inset-bottom, 32px)' }}>

      {/* Header */}
      <div style={{ padding:'28px 24px 20px', borderBottom:'1px solid rgba(61,102,65,0.12)' }}>
        <h1 style={{ fontFamily:'var(--font-lora)', fontSize:22, fontWeight:700, color:'#1A2B1C', margin:'0 0 4px' }}>
          Perguntas frequentes
        </h1>
        <p style={{ fontSize:13, color:'rgba(26,43,28,0.50)', margin:0 }}>
          Encontre respostas rápidas sobre o app
        </p>
      </div>

      <div style={{ padding:'20px 16px', display:'flex', flexDirection:'column', gap:28 }}>
        {SECTIONS.map((section) => {
          const Icon = section.icon
          return (
            <div key={section.title}>
              {/* Section header */}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <div style={{ width:28, height:28, borderRadius:8, display:'flex', alignItems:'center',
                  justifyContent:'center', background:'rgba(61,102,65,0.10)', flexShrink:0 }}>
                  <Icon size={14} color="#3D6641" strokeWidth={2} />
                </div>
                <span style={{ fontSize:11, fontWeight:800, letterSpacing:'0.13em',
                  textTransform:'uppercase', color:'rgba(26,43,28,0.45)' }}>
                  {section.title}
                </span>
              </div>
              <FAQAccordion items={section.items} />
            </div>
          )
        })}

        {/* Footer CTA */}
        <div style={{ background:'rgba(61,102,65,0.06)', borderRadius:14, padding:'18px 20px',
          border:'1px solid rgba(61,102,65,0.10)', textAlign:'center' }}>
          <p style={{ fontSize:13.5, fontWeight:600, color:'#1A2B1C', margin:'0 0 4px' }}>
            Não encontrou o que procurava?
          </p>
          <p style={{ fontSize:12.5, color:'rgba(26,43,28,0.50)', margin:'0 0 14px' }}>
            Nossa equipe está pronta para ajudar.
          </p>
          <a href="/suporte"
            style={{ display:'inline-flex', alignItems:'center', gap:8,
              padding:'10px 22px', borderRadius:11, textDecoration:'none',
              background:'linear-gradient(135deg,#FF8A6E,#FF6B5C)',
              boxShadow:'0 3px 12px rgba(255,107,92,0.28)' }}>
            <MessageCircle size={14} color="#fff" />
            <span style={{ fontSize:13.5, fontWeight:700, color:'#fff' }}>Falar com o suporte</span>
          </a>
        </div>
      </div>
    </div>
  )
}
