import type { ReactNode } from 'react'

// Conteúdo do tutorial "Primeiros passos". As imagens em /public/tutorial são
// fotos das telas reais do app (celular, tema Floresta, conta de demonstração);
// se uma tela mudar, a foto correspondente precisa ser refeita.

/** Retângulo do ponto de toque, em frações da tela fotografada (390×780). */
type Rect = { x: number; y: number; w: number; h: number }

const LARG_MENU = 0.5872 // a gaveta do menu ocupa esta fração da largura

const ALVO: Record<string, Rect> = {
  'topo-ia':           { x: 0.6984, y: 0.0122, w: 0.2709, h: 0.0462 },
  'menu-inicio':       { x: 0, y: 0.1013, w: LARG_MENU, h: 0.0615 },
  'menu-agenda':       { x: 0, y: 0.1628, w: LARG_MENU, h: 0.0615 },
  'menu-logistica':    { x: 0, y: 0.2244, w: LARG_MENU, h: 0.0615 },
  'menu-escola':       { x: 0, y: 0.3026, w: LARG_MENU, h: 0.0615 },
  'menu-filhos':       { x: 0, y: 0.6436, w: LARG_MENU, h: 0.0615 },
  'menu-compartilhar': { x: 0, y: 0.7051, w: LARG_MENU, h: 0.0615 },
  'menu-config':       { x: 0, y: 0.8667, w: LARG_MENU, h: 0.0615 },
  'filhos':            { x: 0.646, y: 0.125, w: 0.313, h: 0.0513 },
  'config':            { x: 0.0436, y: 0.392, w: 0.9128, h: 0.0718 },
  'alertas':           { x: 0.0949, y: 0.7664, w: 0.8103, h: 0.0602 },
  'compartilhar':      { x: 0.0949, y: 0.8887, w: 0.8103, h: 0.0586 },
  'ia-foto':           { x: 0.0513, y: 0.4695, w: 0.8974, h: 0.0615 },
  'ia-voz':            { x: 0.3974, y: 0.6877, w: 0.2051, h: 0.1026 },
  'ia-analisar':       { x: 0.0513, y: 0.8872, w: 0.8974, h: 0.0718 },
  'ia-salvar':         { x: 0.0513, y: 0.8926, w: 0.8974, h: 0.0667 },
  'ia-tipos':          { x: 0.051, y: 0.157, w: 0.897, h: 0.258 },
  'escola':            { x: 0.041, y: 0.2479, w: 0.4317, h: 0.0453 },
  'logistica':         { x: 0.45, y: 0.716, w: 0.302, h: 0.044 },
}

/** Recorte de uma foto real: janela [y0,y1] × [x0,x1] da tela, com contornos. */
export function Foto({ arq, y0 = 0, y1 = 1, x0 = 0, x1 = 1, alvos = [], alt }: {
  arq: string; y0?: number; y1?: number; x0?: number; x1?: number; alvos?: string[]; alt: string
}) {
  const lw = x1 - x0, lh = y1 - y0
  return (
    <div style={{
      position: 'relative', overflow: 'hidden', width: '100%', borderRadius: 12,
      border: '1px solid rgba(61,102,65,0.18)', background: '#EDE9DF',
      aspectRatio: `${lw * 390} / ${lh * 780}`,
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/tutorial/${arq}.jpg`} alt={alt} loading="lazy" draggable={false}
        style={{ position: 'absolute', maxWidth: 'none', display: 'block',
          width: `${100 / lw}%`, left: `${(-x0 / lw) * 100}%`, top: `${(-y0 / lh) * 100}%` }} />
      {alvos.map(n => {
        const r = ALVO[n]
        return (
          <span key={n} aria-hidden style={{
            position: 'absolute', borderRadius: 10, border: '3px solid #FF6B5C',
            boxShadow: '0 0 0 4px rgba(255,107,92,0.22)',
            left: `${((r.x - x0) / lw) * 100}%`, top: `${((r.y - y0) / lh) * 100}%`,
            width: `${(r.w / lw) * 100}%`, height: `${(r.h / lh) * 100}%`,
          }}>
            <span style={{ position: 'absolute', right: -4, bottom: -20, fontSize: 20, filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.3))' }}>👆</span>
          </span>
        )
      })}
    </div>
  )
}

const Menu = ({ itens }: { itens: string[] }) =>
  <Foto arq="menu" x1={LARG_MENU} alvos={itens} alt="Menu lateral do aplicativo, com o item deste passo contornado" />

const B = ({ children }: { children: ReactNode }) => <b style={{ color: '#2C4A2E' }}>{children}</b>

export type PassoId = 'filhos' | 'alertas' | 'compartilhar' | 'ia' | 'escola' | 'agenda' | 'logistica'

export interface Passo {
  id: PassoId
  titulo: string
  /** Caminho no app, mostrado em pílulas. */
  onde: string[]
  /** Onde fica: foto do menu (ou da barra do topo) + a instrução para chegar. */
  guia: { rotulo?: string; largo?: boolean; img: ReactNode; celular: ReactNode; computador: ReactNode }
  quadros: { txt: ReactNode; img: ReactNode; pago?: string }[]
  dica: string
  ir: { rotulo: string; href: string }
  /** Recurso de plano pago: aviso curto mostrado a quem está no gratuito. */
  pago?: string
  /** Quem vê o passo: convidados só veem o que podem executar. */
  exige?: 'dono' | 'editar' | 'logistica'
}

export const PASSOS: Passo[] = [
  {
    id: 'filhos', titulo: 'Cadastre seus filhos', onde: ['☰ Menu', 'Meus Filhos'], exige: 'editar',
    guia: {
      img: <Menu itens={['menu-filhos']} />,
      celular: <>Toque no <B>☰</B> no canto de cima para abrir o menu e escolha <B>Meus Filhos</B>.</>,
      computador: <>No menu à esquerda, clique em <B>Meus Filhos</B>.</>,
    },
    quadros: [
      { txt: <>Toque em <B>+ Adicionar</B> (ou na bolinha <B>Novo</B>) e preencha nome, nascimento e escola.</>,
        img: <Foto arq="filhos" y0={0.05} y1={0.37} alvos={['filhos']} alt="Tela Meus Filhos, com o botão Adicionar contornado" /> },
    ],
    dica: 'Tudo no app é organizado por filho: comece por aqui.',
    ir: { rotulo: 'Ir para Meus Filhos', href: '/children' },
  },
  {
    id: 'alertas', titulo: 'Ajuste o resumo diário do WhatsApp', onde: ['☰ Menu', 'Configurações', 'Alertas'],
    pago: 'O resumo diário no WhatsApp está disponível somente nos planos pagos.',
    guia: {
      img: <Menu itens={['menu-config']} />,
      celular: <>Abra o menu <B>☰</B> e toque em <B>Configurações</B>, no pé do menu.</>,
      computador: <>No pé do menu à esquerda, clique em <B>Configurações</B> e depois em <B>Alertas</B>.</>,
    },
    quadros: [
      { txt: <>Em Configurações, toque em <B>Alertas</B>.</>,
        img: <Foto arq="config" y0={0.258} y1={0.598} alvos={['config']} alt="Tela Configurações, com o item Alertas contornado" /> },
      { txt: <>Confira o número e o <B>horário do envio</B>. Depois toque em <B>Enviar resumo de teste agora</B>.</>,
        img: <Foto arq="alertas" y0={0.4} y1={0.87} alvos={['alertas']} alt="Tela Alertas, com o botão de enviar resumo de teste contornado" /> },
    ],
    dica: 'Dá para desligar ou trocar o horário quando quiser.',
    ir: { rotulo: 'Ir para Alertas', href: '/alertas' },
  },
  {
    id: 'compartilhar', titulo: 'Compartilhe com sua rede de apoio', onde: ['☰ Menu', 'Compartilhar Acesso'], exige: 'dono',
    pago: 'O compartilhamento de acesso está disponível somente nos planos pagos.',
    guia: {
      img: <Menu itens={['menu-compartilhar']} />,
      celular: <>Abra o menu <B>☰</B> e toque em <B>Compartilhar Acesso</B>.</>,
      computador: <>No menu à esquerda, clique em <B>Compartilhar Acesso</B>.</>,
    },
    quadros: [
      { txt: <>Escolha o <B>nível de acesso</B> da pessoa (pai, avó, babá) e toque em <B>Gerar link de convite</B>. Envie o link pelo WhatsApp.</>,
        img: <Foto arq="compartilhar" y0={0.55} y1={0.97} alvos={['compartilhar']} alt="Tela Compartilhar Acesso, com os níveis de acesso e o botão Gerar link de convite contornado" /> },
    ],
    dica: 'Você pode mudar o nível ou remover o acesso depois.',
    ir: { rotulo: 'Ir para Compartilhar Acesso', href: '/configuracoes' },
  },
  {
    id: 'ia', titulo: 'Capture com a IA: foto, print ou áudio', onde: ['✨ Captura IA'], exige: 'editar',
    guia: {
      rotulo: 'Onde fica: no topo de todas as telas', largo: true,
      img: <Foto arq="inicio" y1={0.2} alvos={['topo-ia']} alt="Barra do topo do aplicativo, com o botão Captura IA contornado" />,
      celular: <>A Captura IA não fica no menu lateral: é o <B>botão coral no canto de cima</B>, sempre visível.</>,
      computador: <>A Captura IA não fica no menu lateral: é o <B>botão coral no canto de cima</B>, sempre visível.</>,
    },
    quadros: [
      { txt: <><B>Foto ou print:</B> na aba Foto / Imagem, toque em <B>Tirar foto</B> ou escolha imagens da galeria. No computador, dá para colar um print.</>,
        img: <Foto arq="ia-foto" y0={0.2} y1={0.62} alvos={['ia-foto']} alt="Captura por IA, aba Foto / Imagem, com o botão Tirar foto contornado" /> },
      { txt: <><B>Áudio:</B> na aba Texto livre ou áudio, <B>segure o microfone</B>, fale (&quot;natação do Pedro quinta às 17h&quot;) e solte.</>,
        pago: 'A captura por áudio está disponível somente nos planos pagos.',
        img: <Foto arq="ia-voz" y0={0.38} y1={0.84} alvos={['ia-voz']} alt="Captura por IA, aba Texto livre ou áudio, com o microfone contornado" /> },
      { txt: <>Toque em <B>Analisar e classificar com IA</B>.</>,
        img: <Foto arq="ia-analisar" y0={0.62} alvos={['ia-analisar']} alt="Botão Analisar e classificar com IA contornado" /> },
      { txt: <>Confira os itens (dá para corrigir data, filho e tipo) e toque em <B>Salvar</B>.</>,
        img: <Foto arq="ia-salvar" y0={0.62} alvos={['ia-salvar']} alt="Resultado da análise, com o botão Salvar itens selecionados contornado" /> },
    ],
    dica: 'Nada é salvo sem você revisar.',
    ir: { rotulo: 'Ir para a Captura por IA', href: '/ia' },
  },
  {
    id: 'escola', titulo: 'Escola: aula, prova ou atividade?', onde: ['✨ Captura IA', 'ou', '☰ Menu', 'Escola'], exige: 'editar',
    guia: {
      img: <Menu itens={['menu-escola']} />,
      celular: <>Na tela <B>Escola</B> (menu <B>☰</B>), três abas separam <B>Atividades escolares</B>, <B>Rotina de aulas</B> e <B>Calendário de provas</B>.</>,
      computador: <>Na tela <B>Escola</B> (menu à esquerda), três abas separam <B>Atividades escolares</B>, <B>Rotina de aulas</B> e <B>Calendário de provas</B>.</>,
    },
    quadros: [
      { txt: <>Ao capturar pela IA, escolha <B>o que você capturou</B> antes de salvar: fotografou a grade de horários? <B>Rotina de aulas</B>. O calendário de provas? <B>Calendário de provas</B>.</>,
        img: <Foto arq="ia-resultado" y0={0.08} y1={0.56} alvos={['ia-tipos']} alt="Resultado da captura por IA, com o seletor do tipo de item de escola contornado" /> },
      { txt: <>Na tela Escola, toque na aba do tipo que quer ver. O que você cria com <B>+ Nova</B> entra na aba aberta.</>,
        img: <Foto arq="escola" y0={0.06} y1={0.46} alvos={['escola']} alt="Tela Escola, com a aba Rotina de aulas contornada" /> },
    ],
    dica: 'Aulas e provas têm seção própria no resumo do WhatsApp.',
    ir: { rotulo: 'Ir para Escola', href: '/escola' },
  },
  {
    id: 'agenda', titulo: 'Confira no Início e na Agenda', onde: ['☰ Menu', 'Início', 'e', 'Agenda'],
    guia: {
      img: <Menu itens={['menu-inicio', 'menu-agenda']} />,
      celular: <><B>Início</B> e <B>Agenda</B> são os dois primeiros itens do menu <B>☰</B>.</>,
      computador: <><B>Início</B> e <B>Agenda</B> são os dois primeiros itens do menu à esquerda.</>,
    },
    quadros: [
      { txt: <>O <B>Início</B> mostra o que há <B>hoje e na semana</B>, as provas, os lembretes e os alertas.</>,
        img: <Foto arq="inicio" y0={0.05} y1={0.62} alt="Tela Início, com os compromissos de hoje e da semana" /> },
      { txt: <>A <B>Agenda</B> mostra o <B>mês inteiro</B>. Toque em um dia ou em um item para ver os detalhes.</>,
        img: <Foto arq="agenda" y0={0.05} y1={0.72} alt="Tela Agenda, com o calendário do mês" /> },
    ],
    dica: 'Se algo não apareceu, confira se a data foi salva certa.',
    ir: { rotulo: 'Ir para a Agenda', href: '/calendario' },
  },
  {
    id: 'logistica', titulo: 'Combine quem leva e quem busca', onde: ['☰ Menu', 'Logística'], exige: 'logistica',
    guia: {
      img: <Menu itens={['menu-logistica']} />,
      celular: <>Abra o menu <B>☰</B> e toque em <B>Logística</B>.</>,
      computador: <>No menu à esquerda, clique em <B>Logística</B>.</>,
    },
    quadros: [
      { txt: <>Cada atividade tem duas fichas: <B>LEVA</B> e <B>BUSCA</B>. Toque em <B>Definir</B> para assumir você ou <B>sugerir</B> a alguém da rede de apoio.</>,
        img: <Foto arq="logistica" y0={0.35} y1={0.9} alvos={['logistica']} alt="Tela Logística, com a ficha Busca: Definir contornada" /> },
      { txt: <>A ficha tracejada com relógio (Natação · BUSCA Rafael) é uma <B>sugestão aguardando resposta</B>. Quando a pessoa aceita, todos veem na hora.</>,
        img: <Foto arq="logistica" y0={0.36} y1={0.52} alt="Atividade Natação, com a ficha de busca sugerida aguardando resposta" /> },
    ],
    dica: 'As mesmas fichas aparecem no Início, em Escola, Saúde e Atividades.',
    ir: { rotulo: 'Ir para Logística', href: '/logistica' },
  },
]
