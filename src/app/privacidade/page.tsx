import type { Metadata } from 'next'
import LegalLayout from '@/components/legal/LegalLayout'
import { LEGAL_ENTITY } from '@/lib/legal'

export const metadata: Metadata = { title: 'Política de Privacidade · Família em Dia' }

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 style={{ fontFamily: 'var(--font-lora)', fontSize: 19, fontWeight: 700, color: '#1A2B1C', margin: '28px 0 10px' }}>{children}</h2>
)
const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ margin: '0 0 12px' }}>{children}</p>
)
const Li = ({ children }: { children: React.ReactNode }) => (
  <li style={{ margin: '0 0 8px' }}>{children}</li>
)

export default function PrivacidadePage() {
  return (
    <LegalLayout title="Política de Privacidade">
      <P>
        Esta Política descreve como a <strong>{LEGAL_ENTITY.nomeFantasia}</strong>, marca operada por
        {' '}{LEGAL_ENTITY.razaoSocial} (CNPJ {LEGAL_ENTITY.cnpj}), trata dados pessoais, em conformidade
        com a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados — LGPD). Ao usar o Serviço, você
        compreende as práticas aqui descritas.
      </P>

      <H>1. Controlador e Encarregado (DPO)</H>
      <P>
        O controlador dos dados é {LEGAL_ENTITY.razaoSocial} (CNPJ {LEGAL_ENTITY.cnpj}), com sede em
        {' '}{LEGAL_ENTITY.endereco}. O Encarregado pelo Tratamento de Dados Pessoais pode ser contatado em
        {' '}<strong>{LEGAL_ENTITY.dpoEmail}</strong> para exercício de direitos e demais questões de privacidade.
      </P>

      <H>2. Dados que coletamos</H>
      <ul>
        <Li><strong>Cadastro do responsável:</strong> nome completo, e-mail, telefone/celular, CPF e data de nascimento.</Li>
        <Li><strong>Dados dos filhos (crianças/adolescentes):</strong> nome, data de nascimento, escola, foto e
          informações de atividades — inseridos pelo responsável.</Li>
        <Li><strong>Documentos e dados sensíveis:</strong> arquivos que o Usuário opte por armazenar no cofre
          (ex.: documentos de identidade, carteirinhas, documentos de saúde), que podem conter
          <strong> dados pessoais sensíveis</strong>.</Li>
        <Li><strong>Dados de uso:</strong> registros de acesso, data/hora, dispositivo e interações com o Serviço.</Li>
        <Li><strong>Atribuição/marketing:</strong> origem do cadastro (UTM, página de referência) e preferências de comunicação.</Li>
        <Li><strong>Pagamento:</strong> dados processados pelo operador de pagamento (Stripe). <strong>Não
          armazenamos os dados completos do cartão</strong> em nossos servidores.</Li>
      </ul>

      <H>3. Dados de crianças e adolescentes</H>
      <P>
        O tratamento de dados de menores é realizado <strong>no melhor interesse da criança</strong>
        (art. 14 da LGPD) e fundado na inserção feita pelo responsável legal, que declara deter tal
        autoridade. Coletamos apenas os dados necessários à finalidade de organização da rotina do menor
        e não os utilizamos para publicidade direcionada a crianças. O responsável pode acessar, corrigir
        ou excluir esses dados a qualquer momento.
      </P>

      <H>4. Dados sensíveis</H>
      <P>
        Quando o Usuário armazena documentos que contenham dados sensíveis (ex.: saúde), o tratamento
        ocorre com base no consentimento e/ou para a tutela da saúde/melhor interesse, restrito ao
        armazenamento e à exibição segura ao próprio Usuário e aos responsáveis por ele autorizados.
      </P>

      <H>5. Finalidades e bases legais</H>
      <ul>
        <Li><strong>Execução de contrato</strong> (art. 7º, V): operar as funcionalidades, autenticar,
          processar assinatura e prestar suporte.</Li>
        <Li><strong>Cumprimento de obrigação legal/regulatória</strong> (art. 7º, II): obrigações fiscais e legais.</Li>
        <Li><strong>Legítimo interesse</strong> (art. 7º, IX): segurança, prevenção a fraudes e melhoria do Serviço.</Li>
        <Li><strong>Consentimento</strong> (art. 7º, I / art. 11): comunicações de marketing e tratamento de
          dados sensíveis, quando aplicável — revogável a qualquer tempo.</Li>
      </ul>

      <H>6. Operadores e compartilhamento</H>
      <P>Compartilhamos dados, no mínimo necessário, com operadores que viabilizam o Serviço:</P>
      <ul>
        <Li><strong>Supabase</strong> — hospedagem de banco de dados e armazenamento de arquivos;</Li>
        <Li><strong>Anthropic</strong> e <strong>Groq</strong> — processamento por IA (classificação de
          texto/imagem e transcrição de voz);</Li>
        <Li><strong>Stripe</strong> — processamento de pagamentos e assinaturas;</Li>
        <Li><strong>Meta (WhatsApp)</strong> — envio de mensagens e alertas;</Li>
        <Li><strong>Vercel</strong> — hospedagem da aplicação;</Li>
        <Li><strong>Resend</strong> — envio de e-mails da conta (confirmação de cadastro,
          redefinição de senha) e <strong>ImprovMX</strong> — recebimento dos e-mails de
          contato e suporte;</Li>
        <Li><strong>Sentry</strong> — monitoramento de erros da aplicação. Registra falhas
          técnicas para correção; não recebe conteúdo dos seus documentos, e identificadores
          pessoais como CPF, e-mail e telefone são removidos automaticamente antes do envio.</Li>
      </ul>
      <P>
        Não vendemos dados pessoais. O compartilhamento com responsáveis convidados ocorre por ação do
        próprio Usuário (compartilhamento de acesso).
      </P>

      <H>7. Transferência internacional</H>
      <P>
        Alguns operadores processam dados <strong>fora do Brasil</strong> (ex.: Estados Unidos). Nesses
        casos, adotamos salvaguardas contratuais e selecionamos fornecedores com padrões adequados de
        segurança, conforme os arts. 33 e seguintes da LGPD.
      </P>

      <H>8. Segurança</H>
      <P>
        Adotamos medidas técnicas e organizacionais para proteger os dados, incluindo isolamento por
        família a nível de banco (Row Level Security), controle de acesso por papel, armazenamento de
        documentos em bucket privado e acesso a arquivos por URLs assinadas temporárias. Nenhum sistema é
        infalível, mas trabalhamos continuamente para mitigar riscos.
      </P>

      <H>9. Retenção e eliminação</H>
      <P>
        Mantemos os dados enquanto a conta estiver ativa e pelo prazo necessário às finalidades e
        obrigações legais. O Usuário pode solicitar a exclusão da conta, hipótese em que os dados são
        eliminados, ressalvadas as informações que a lei exija reter.
      </P>

      <H>10. Direitos do titular</H>
      <P>Nos termos do art. 18 da LGPD, o titular pode, gratuitamente:</P>
      <ul>
        <Li>confirmar a existência de tratamento e acessar seus dados;</Li>
        <Li>corrigir dados incompletos, inexatos ou desatualizados;</Li>
        <Li>solicitar anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos;</Li>
        <Li>solicitar portabilidade, observados os segredos comercial e industrial;</Li>
        <Li>revogar o consentimento e se opor a tratamentos.</Li>
      </ul>
      <P>Para exercer seus direitos, contate o Encarregado em {LEGAL_ENTITY.dpoEmail}.</P>

      <H>11. Comunicações de marketing</H>
      <P>
        Só enviamos comunicações promocionais com o seu consentimento (opt-in), que pode ser revogado a
        qualquer momento na tela &quot;Minha Conta&quot; ou pelos próprios canais de envio.
      </P>

      <H>12. Cookies e tecnologias</H>
      <P>
        Utilizamos cookies e armazenamento local estritamente necessários para autenticação e
        funcionamento do Serviço, além de parâmetros de atribuição de origem (UTM) para fins estatísticos
        de aquisição.
      </P>

      <H>13. Alterações desta Política</H>
      <P>
        Podemos atualizar esta Política. Mudanças relevantes serão comunicadas e a versão vigente estará
        sempre disponível nesta página.
      </P>

      <H>14. Contato</H>
      <P>Encarregado (DPO): {LEGAL_ENTITY.dpoEmail} · Suporte: {LEGAL_ENTITY.email}.</P>
    </LegalLayout>
  )
}
