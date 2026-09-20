import type { Metadata } from 'next'
import LegalLayout from '@/components/legal/LegalLayout'
import { LEGAL_ENTITY } from '@/lib/legal'

export const metadata: Metadata = { title: 'Termos de Uso · Família em Dia' }

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 19, fontWeight: 700, color: '#1A2B1C', margin: '28px 0 10px' }}>{children}</h2>
)
const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ margin: '0 0 12px' }}>{children}</p>
)
const Li = ({ children }: { children: React.ReactNode }) => (
  <li style={{ margin: '0 0 8px' }}>{children}</li>
)

export default function TermosPage() {
  return (
    <LegalLayout title="Termos de Uso">
      <P>
        Estes Termos de Uso (&quot;Termos&quot;) regem o acesso e a utilização da plataforma
        <strong> {LEGAL_ENTITY.nomeFantasia}</strong> (&quot;Plataforma&quot;, &quot;Serviço&quot; ou &quot;App&quot;),
        marca operada por {LEGAL_ENTITY.razaoSocial}, inscrita no CNPJ sob o nº {LEGAL_ENTITY.cnpj},
        com sede em {LEGAL_ENTITY.endereco} (&quot;{LEGAL_ENTITY.nomeFantasia}&quot;, &quot;nós&quot;).
        Ao criar uma conta ou utilizar o Serviço, você (&quot;Usuário&quot;) declara ter lido,
        compreendido e aceitado integralmente estes Termos e a nossa Política de Privacidade.
      </P>

      <H>1. Objeto e descrição do serviço</H>
      <P>
        A Plataforma é um serviço de software como serviço (SaaS) voltado à organização da rotina
        familiar, incluindo: gestão de atividades escolares, de saúde e extracurriculares dos filhos;
        cofre digital para armazenamento de documentos; captura e classificação de informações por
        inteligência artificial; logística entre responsáveis; resumos e alertas por mensagem; e
        compartilhamento de acesso entre responsáveis.
      </P>

      <H>2. Elegibilidade e cadastro</H>
      <P>
        Para usar o Serviço, o Usuário deve ser <strong>maior de 18 anos</strong> e plenamente capaz.
        O Usuário compromete-se a fornecer informações verídicas, completas e atualizadas (incluindo
        nome, e-mail, telefone, CPF e data de nascimento) e a mantê-las atualizadas. O Usuário é
        responsável pela confidencialidade de suas credenciais e por toda atividade realizada em sua conta.
      </P>

      <H>3. Cadastro de filhos e dados de crianças e adolescentes</H>
      <P>
        Ao cadastrar filhos ou inserir dados de crianças e adolescentes, o Usuário <strong>declara e
        garante</strong> ser o pai, a mãe ou o responsável legal da criança, ou possuir autorização do
        responsável legal, detendo poderes para tratar tais dados em nome e no melhor interesse do menor,
        nos termos do art. 14 da Lei nº 13.709/2018 (LGPD). O Usuário é o único responsável pela licitude
        da inserção desses dados e por obter, quando aplicável, o consentimento do outro responsável.
      </P>

      <H>4. Compartilhamento de acesso entre responsáveis</H>
      <P>
        O Serviço permite convidar outros responsáveis com diferentes níveis de acesso (apenas leitura,
        leitura e logística, ou acesso completo). O Usuário que gera o convite é responsável por escolher
        o destinatário e o nível adequado. Ao aceitar um convite, o convidado passa a visualizar os dados
        compartilhados conforme o nível concedido. O titular da conta pode alterar ou revogar acessos a
        qualquer tempo.
      </P>

      <H>5. Planos, assinatura, cobrança e cancelamento</H>
      <ul>
        <Li>O Serviço oferece um plano gratuito e planos pagos (Família e Família Plus), em ciclos mensal
          ou anual, conforme os preços exibidos na Plataforma.</Li>
        <Li>Novos usuários podem ter direito a um período de teste gratuito, concedido uma única vez. Ao
          fim do teste, salvo cancelamento, a assinatura é convertida em cobrança no plano escolhido.</Li>
        <Li>Os pagamentos são processados por operador externo (Stripe). A assinatura é
          <strong> recorrente</strong> e renovada automaticamente até o cancelamento.</Li>
        <Li>O Usuário pode cancelar a qualquer momento. Fora do prazo de arrependimento descrito abaixo,
          o acesso pago permanece até o fim do período já pago, sem novas cobranças. Trocas de plano
          podem gerar cobrança proporcional (proração).</Li>
        <Li><strong>Direito de arrependimento (7 dias).</strong> Em até <strong>7 dias corridos contados
          da cobrança</strong>, o cancelamento feito pela Plataforma devolve <strong>integralmente</strong>
          o valor pago, por estorno no mesmo meio de pagamento, e encerra a assinatura
          <strong> imediatamente</strong> — já que o valor é devolvido, o acesso pago não continua.
          O prazo vale para a contratação e para trocas de plano que gerem nova cobrança; a
          <strong> renovação automática não abre novo prazo</strong>, por não se tratar de nova
          contratação. Direito previsto no art. 49 do Código de Defesa do Consumidor.</Li>
        <Li><strong>Exclusão da conta encerra a cobrança.</strong> Ao excluir a conta, a assinatura é
          cancelada de imediato; se a exclusão ocorrer dentro do prazo de arrependimento, o valor é
          devolvido na mesma operação.</Li>
      </ul>

      <H>6. Inteligência artificial</H>
      <P>
        Os recursos de IA auxiliam na organização e classificação de informações e podem conter
        imprecisões. As sugestões geradas <strong>não constituem aconselhamento médico, jurídico,
        financeiro ou profissional</strong>, e o Usuário deve conferir os dados antes de utilizá-los.
        A Família em Dia não se responsabiliza por decisões tomadas com base exclusivamente em saídas
        automatizadas.
      </P>

      <H>7. Conteúdo do Usuário</H>
      <P>
        O Usuário mantém todos os direitos sobre os dados e arquivos que inserir (&quot;Conteúdo do
        Usuário&quot;). O Usuário concede à Família em Dia uma licença limitada, não exclusiva e
        revogável, restrita ao necessário para operar, hospedar, processar e exibir o Conteúdo do Usuário
        com a finalidade de prestar o Serviço. Não usamos o Conteúdo do Usuário para outras finalidades
        sem base legal adequada.
      </P>

      <H>8. Uso aceitável</H>
      <P>É vedado ao Usuário, entre outras condutas:</P>
      <ul>
        <Li>inserir dados de terceiros sem autorização ou base legal;</Li>
        <Li>violar direitos de propriedade intelectual ou de privacidade;</Li>
        <Li>tentar acessar contas, famílias ou dados de outros usuários;</Li>
        <Li>realizar engenharia reversa, sobrecarregar ou comprometer a segurança da Plataforma;</Li>
        <Li>utilizar o Serviço para fins ilícitos.</Li>
      </ul>

      <H>9. Propriedade intelectual</H>
      <P>
        A Plataforma, sua marca, layout, código e demais elementos são de titularidade da Família em Dia
        e protegidos por lei. Estes Termos não transferem ao Usuário qualquer direito de propriedade
        intelectual sobre o Serviço.
      </P>

      <H>10. Disponibilidade e alterações</H>
      <P>
        Empregamos esforços razoáveis para manter o Serviço disponível, mas ele é fornecido &quot;no estado
        em que se encontra&quot;, podendo sofrer interrupções para manutenção ou por fatores alheios ao
        nosso controle. Podemos alterar, suspender ou descontinuar funcionalidades, mediante aviso quando
        a alteração for relevante.
      </P>

      <H>11. Limitação de responsabilidade</H>
      <P>
        Na máxima extensão permitida pela legislação, a Família em Dia não responde por danos indiretos,
        lucros cessantes ou perda de dados decorrentes de uso inadequado, caso fortuito ou força maior.
        Nada nestes Termos limita responsabilidades que não possam ser excluídas por lei, em especial as
        decorrentes do Código de Defesa do Consumidor.
      </P>

      <H>12. Rescisão</H>
      <P>
        O Usuário pode encerrar sua conta a qualquer momento pela própria Plataforma. O encerramento
        <strong> cancela a assinatura</strong> (item 5) e implica a eliminação dos dados conforme a
        Política de Privacidade, <strong>incluindo os arquivos guardados no cofre e as fotos</strong>,
        ressalvadas as hipóteses de guarda legal obrigatória. Podemos suspender ou encerrar contas que
        violem estes Termos.
      </P>

      <H>13. Alterações destes Termos</H>
      <P>
        Podemos atualizar estes Termos periodicamente. Mudanças relevantes serão comunicadas e poderão
        exigir novo aceite. A versão vigente está sempre disponível nesta página.
      </P>

      <H>14. Lei aplicável e foro</H>
      <P>
        Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro do
        domicílio do consumidor para dirimir controvérsias, conforme o Código de Defesa do Consumidor.
      </P>

      <H>15. Contato</H>
      <P>Dúvidas sobre estes Termos: {LEGAL_ENTITY.email}.</P>
    </LegalLayout>
  )
}
