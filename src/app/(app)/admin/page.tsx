import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { fundadorLogado } from '@/lib/admin'
import { montarPainel } from '@/lib/admin-painel'
import { formatPhoneBR } from '@/lib/cpf'

// Nunca em cache e nunca indexada: a resposta depende de quem está logado e
// traz dados pessoais de todos os clientes.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Painel do negócio', robots: { index: false, follow: false } }

const FUSO = 'America/Sao_Paulo'
const data = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const reais = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((100 * parte) / todo) : 0)

function quando(diasRestantes: number) {
  if (diasRestantes <= 0) return 'hoje'
  if (diasRestantes === 1) return 'amanhã'
  return `em ${diasRestantes} dias`
}
function haQuanto(iso: string | null) {
  if (!iso) return 'nunca'
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  return `há ${dias} dias`
}
function uso(filhos: number, atividades: number) {
  if (filhos === 0) return 'sem filho cadastrado'
  return `${filhos} ${filhos === 1 ? 'filho' : 'filhos'} · ${atividades} ${atividades === 1 ? 'atividade' : 'atividades'}`
}

export default async function AdminPage() {
  // ⚠️ A ÚNICA porta desta página. Quem não é fundador recebe 404 — a mesma
  // resposta de um endereço que não existe — antes de qualquer consulta.
  // Sem sessão o proxy já mandou para o login; isto cobre quem está logado.
  if (!(await fundadorLogado())) notFound()

  const p = await montarPainel()
  const r = p.resumo
  const outros = [
    r.convidados > 0 && `${r.convidados} ${r.convidados === 1 ? 'convidado por link' : 'convidados por link'}`,
    r.incompletos > 0 && `${r.incompletos} com cadastro antigo não concluído`,
  ].filter(Boolean) as string[]

  const etapas: [string, number, string?][] = [
    ['Criaram conta', p.funil.criaram],
    ['Confirmaram o e-mail e entraram', p.funil.concluiram],
    ['Cadastraram um filho', p.funil.comFilho],
    ['Usaram a captura por IA', p.funil.usaramIa],
    ['Assinaram', p.funil.assinaram, '#FF6B5C'],
    ['Cancelaram', p.funil.cancelaram, '#9A8F7A'],
  ]
  const rt = p.retencao

  return (
    <div className="adm">
      <style>{CSS}</style>

      <header>
        <p className="adm-olho">Admin</p>
        <h1>Painel do negócio</h1>
        <p className="adm-sub">Somente leitura · atualizado ao abrir a página</p>
      </header>

      {p.avisos.map(a => <p key={a} className="adm-aviso">{a}</p>)}

      <section aria-label="Resumo">
        <div className="adm-numeros">
          <div className="adm-num"><b>{r.cadastros}</b><span>cadastros no total</span></div>
          <div className="adm-num"><b>{r.emTeste}</b><span>em teste grátis</span></div>
          <div className="adm-num"><b>{r.semUso}</b><span>cadastraram e não usaram</span></div>
          <div className="adm-num"><b>{r.assinantes}</b><span>assinantes pagantes</span></div>
          <div className="adm-num">
            <b className="adm-par"><span>{r.pagantesFamilia}<small>Família</small></span><span>{r.pagantesPlus}<small>Plus</small></span></b>
            <span>pagantes por plano</span>
          </div>
          <div className="adm-num"><b>{r.gratuito}</b><span>no plano gratuito</span></div>
          <div className="adm-num adm-cortesia"><b>{r.cortesia}</b><span>contas cortesia (administradores)</span></div>
          <div className="adm-num"><b>{r.cancelaram}</b><span>cancelaram</span></div>
          <div className="adm-num adm-destaque"><b>{reais(r.receitaMensalCentavos)}</b><span>receita mensal recorrente</span></div>
          <div className="adm-num"><b>{r.vagasUsadas} <small>de {r.vagasTotal}</small></b><span>vagas de lançamento usadas</span></div>
        </div>
        {outros.length > 0 && <p className="adm-ver">O total de cadastros inclui também {outros.join(', ')}.</p>}
      </section>

      <section className="adm-cartao">
        <div className="adm-cab"><h2>Funil</h2><small>dos cadastros até a assinatura</small></div>
        <div className="adm-funil">
          {etapas.map(([rotulo, n, cor]) => (
            <div className="adm-f" key={rotulo}>
              <span>{rotulo}</span>
              <span className="adm-b"><i style={{ width: `${Math.min(100, pct(n, p.funil.criaram))}%`, ...(cor ? { background: cor } : {}) }} /></span>
              <span className="adm-v">{n}</span>
            </div>
          ))}
        </div>
        <div className="adm-funil adm-fora">
          <div className="adm-f">
            <span>Contas cortesia (administradores)</span>
            <span className="adm-b"><i style={{ width: `${Math.min(100, pct(r.cortesia, p.funil.criaram))}%`, background: '#5B8DEF' }} /></span>
            <span className="adm-v">{r.cortesia}</span>
          </div>
        </div>
        <p className="adm-ver">As contas cortesia têm acesso completo sem pagar: entram em &quot;Criaram conta&quot;, mas não aparecem como gratuitas nem como pagantes.</p>
        <p className="adm-ver" style={{ marginTop: 4 }}>&quot;Assinaram&quot; conta quem assina hoje e quem cancelou depois. &quot;Cancelaram&quot; são os que assinaram e hoje não pagam mais.</p>
      </section>

      <div className="adm-duas">
        <section className="adm-cartao">
          <div className="adm-cab"><h2>Depois dos 14 dias de teste</h2></div>
          <div className="adm-rolar">
            <table style={{ minWidth: 280 }}>
              <tbody>
                <tr><td>Cancelaram a assinatura ainda nos 14 dias</td><td className="adm-n"><b>{rt.cancelouNoTeste}</b></td></tr>
                <tr><td>Passaram dos 14 dias e estão no gratuito</td><td className="adm-n"><b>{rt.ficouGratis}</b></td></tr>
                <tr><td>Passaram dos 14 dias e pagam um plano hoje</td><td className="adm-n"><b>{rt.pagandoApos}</b></td></tr>
                <tr><td>Cancelaram a assinatura depois dos 14 dias</td><td className="adm-n"><b>{rt.cancelouApos}</b></td></tr>
              </tbody>
            </table>
          </div>
          <p className="adm-ver">Os 14 dias contam da criação da conta. Cada pessoa entra em um grupo só. Ficam de fora quem ainda está no teste, contas cortesia, convidados e cadastros antigos não concluídos.</p>
        </section>

        <section className="adm-cartao">
          <div className="adm-cab"><h2>Tempo de base</h2><small>há quanto tempo estão conosco</small></div>
          <div className="adm-rolar">
            <table style={{ minWidth: 280 }}>
              <thead><tr><th>Faixa</th><th className="adm-n">Cadastros</th><th className="adm-n">Pagantes</th></tr></thead>
              <tbody>
                {p.tempoDeBase.map(t => (
                  <tr key={t.faixa}><td>{t.faixa}</td><td className="adm-n">{t.cadastros}</td><td className="adm-n">{t.pagantes}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="adm-ver">Cadastros contam da criação da conta (sem convidados). Pagantes contam do início da assinatura atual.</p>
        </section>
      </div>

      <section className="adm-cartao">
        <div className="adm-cab">
          <h2>Em teste grátis</h2>
          <small>{r.emTeste} {r.emTeste === 1 ? 'pessoa' : 'pessoas'} · quem expira antes aparece primeiro</small>
        </div>
        {p.emTeste.length === 0 ? <p className="adm-vazio">Ninguém em teste grátis no momento.</p> : (
          <div className="adm-rolar">
            <table>
              <thead><tr><th>Quem</th><th>Celular</th><th>Teste termina</th><th>Origem</th><th>Uso até agora</th><th>Último acesso</th></tr></thead>
              <tbody>
                {p.emTeste.map(t => (
                  <tr key={t.email}>
                    <td className="adm-quem">
                      <b>{t.nome}</b><span>{t.email}</span>
                      {t.deixouCartao && <span className="adm-p adm-az" style={{ marginTop: 4 }}>já deixou o cartão</span>}
                    </td>
                    <td className="adm-nq">{t.celular ? formatPhoneBR(t.celular) : '—'}</td>
                    <td>
                      <span className={`adm-p ${t.diasRestantes <= 2 ? 'adm-verm' : t.diasRestantes <= 6 ? 'adm-amb' : 'adm-ok'}`}>{quando(t.diasRestantes)}</span>
                      <span className="adm-data">{data(t.fimDoTeste)}</span>
                    </td>
                    <td>{t.origem}</td>
                    <td className="adm-uso">{uso(t.filhos, t.atividades)}</td>
                    <td className="adm-nq">{haQuanto(t.ultimoAcesso)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="adm-cartao">
        <div className="adm-cab">
          <h2>Cadastraram e não usaram</h2>
          <small>{r.semUso} {r.semUso === 1 ? 'conta' : 'contas'} sem nenhum filho cadastrado · mais recentes primeiro</small>
        </div>
        {p.semUso.length === 0 ? <p className="adm-vazio">Todo mundo que criou conta já cadastrou um filho.</p> : (
          <div className="adm-rolar">
            <table>
              <thead><tr><th>Quem</th><th>Celular</th><th>Conta criada</th><th>Teste termina</th><th>Último acesso</th><th>Lembrete por e-mail</th></tr></thead>
              <tbody>
                {p.semUso.map(i => (
                  <tr key={i.email}>
                    <td className="adm-quem">
                      <b>{i.nome || '—'}</b><span>{i.email}</span>
                      {!i.emailConfirmado
                        ? <span className="adm-p adm-cin" style={{ marginTop: 4 }}>e-mail não confirmado</span>
                        : !i.cadastroConcluido && <span className="adm-p adm-cin" style={{ marginTop: 4 }}>cadastro antigo, não concluído</span>}
                    </td>
                    <td className="adm-nq">{i.celular ? formatPhoneBR(i.celular) : '—'}</td>
                    <td className="adm-nq">{data(i.criadoEm)}<span className="adm-data">{haQuanto(i.criadoEm)}</span></td>
                    <td className="adm-nq">{i.fimDoTeste ? data(i.fimDoTeste) : 'já terminou'}</td>
                    <td className="adm-nq">{haQuanto(i.ultimoAcesso)}</td>
                    <td className="adm-nq">
                      {i.lembreteEm
                        ? <span className="adm-p adm-ok">enviado em {data(i.lembreteEm)}</span>
                        : <span className="adm-p adm-cin">{i.emailConfirmado && i.fimDoTeste ? 'ainda não enviado' : 'não será enviado'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="adm-ver">Sem filho cadastrado o app fica vazio, então é o sinal de que a pessoa ainda não começou. O lembrete sai uma única vez, por volta das 10h, para quem criou a conta há mais de 24 horas, confirmou o e-mail e ainda está no teste grátis. Quem está no teste aparece também em &quot;Em teste grátis&quot;. Convidados por link e contas cortesia ficam de fora.</p>
      </section>

      <section className="adm-cartao">
        <div className="adm-cab"><h2>Assinantes</h2><small>{r.assinantes} {r.assinantes === 1 ? 'pagante' : 'pagantes'}</small></div>
        {p.assinantes.length === 0 ? <p className="adm-vazio">Nenhum assinante pagante ainda.</p> : (
          <div className="adm-rolar">
            <table>
              <thead><tr><th>Quem</th><th>Plano</th><th>Período</th><th className="adm-n">Valor</th><th>Próxima cobrança</th><th>Desde</th></tr></thead>
              <tbody>
                {p.assinantes.map(a => (
                  <tr key={a.email + a.desde}>
                    <td className="adm-quem">
                      <b>{a.nome}</b><span>{a.email}</span>
                      {a.cancelaNoFim && <span className="adm-p adm-amb" style={{ marginTop: 4 }}>cancela ao fim do período</span>}
                    </td>
                    <td>{a.plano} {a.lancamento && <span className="adm-p adm-cor">lançamento</span>}</td>
                    <td>{a.periodo}</td>
                    <td className="adm-n">{reais(a.centavos)}</td>
                    <td className="adm-nq">{data(a.proximaCobranca)}</td>
                    <td className="adm-nq">{data(a.desde)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="adm-duas">
        <section className="adm-cartao">
          <div className="adm-cab"><h2>Origem dos clientes</h2></div>
          <div className="adm-rolar">
            <table style={{ minWidth: 300 }}>
              <thead><tr><th>Como conheceu</th><th className="adm-n">Cadastros</th><th className="adm-n">Assinaram</th><th className="adm-n">Taxa</th></tr></thead>
              <tbody>
                {p.origem.map(o => (
                  <tr key={o.origem}><td>{o.origem}</td><td className="adm-n">{o.cadastros}</td><td className="adm-n">{o.assinaram}</td><td className="adm-n">{pct(o.assinaram, o.cadastros)}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.campanhas.length > 0 && (
            <div className="adm-rolar" style={{ marginTop: 14 }}>
              <table style={{ minWidth: 300 }}>
                <thead><tr><th>Link de campanha</th><th className="adm-n">Cadastros</th><th className="adm-n">Assinaram</th><th className="adm-n">Taxa</th></tr></thead>
                <tbody>
                  {p.campanhas.map(o => (
                    <tr key={o.origem}><td>{o.origem}</td><td className="adm-n">{o.cadastros}</td><td className="adm-n">{o.assinaram}</td><td className="adm-n">{pct(o.assinaram, o.cadastros)}%</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="adm-ver">Origem é a resposta dada no cadastro; convidados por link não entram. Os links de campanha aparecem quando alguém chega por um endereço marcado.</p>
        </section>

        <section className="adm-cartao">
          <div className="adm-cab"><h2>Cancelamentos</h2><small>{p.cancelamentos.length} no total</small></div>
          {p.cancelamentos.length === 0 ? <p className="adm-vazio">Nenhum cancelamento.</p> : p.cancelamentos.map((c, i) => (
            <div className="adm-motivo" key={c.nome + c.canceladoEm + i}>
              <b>{c.nome}</b> <span className="adm-p adm-cin">{c.plano}</span>{' '}
              {c.reembolsado && <span className="adm-p adm-ok">reembolsado</span>}
              <span className="adm-linha2">
                cancelou em {data(c.canceladoEm)} · assinou por {c.dias} {c.dias === 1 ? 'dia' : 'dias'}
                {c.motivo && <> · motivo: {c.motivo}</>}
              </span>
              {c.comentario && <q>{c.comentario}</q>}
            </div>
          ))}
        </section>
      </div>

      <p className="adm-pe">O painel mostra dados de cadastro, de assinatura e contagens de uso. Nunca o conteúdo: nomes dos filhos, agenda e documentos do cofre dos clientes ficam de fora.</p>
    </div>
  )
}

const CSS = `
.adm{max-width:960px;margin:0 auto;padding:24px 16px 40px;display:flex;flex-direction:column;gap:22px;color:#1A2B1C;font-size:14.5px;line-height:1.5;min-width:0}
.adm h1{font-family:var(--font-lora),Georgia,serif;font-weight:700;font-size:30px;line-height:1.1;margin:0}
.adm h2{font-family:var(--font-lora),Georgia,serif;font-weight:600;font-size:19px;margin:0}
.adm-olho{font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#3D6641;margin:0 0 2px}
.adm-sub{color:rgba(26,43,28,.42);margin:4px 0 0;font-size:13.5px}
.adm-aviso{margin:0;background:rgba(245,158,11,.14);color:#92400E;border-radius:12px;padding:10px 14px;font-size:13.5px;font-weight:500}
.adm-cab{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.adm-cab small{font-size:12.5px;color:rgba(26,43,28,.42)}
.adm-cartao{background:#fff;border:1px solid rgba(61,102,65,.18);border-radius:16px;box-shadow:0 1px 2px rgba(30,51,32,.05),0 8px 22px rgba(30,51,32,.07);padding:16px 18px;min-width:0}
.adm-numeros{display:grid;grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:10px}
.adm-num{background:#fff;border:1px solid rgba(61,102,65,.18);border-radius:14px;box-shadow:0 1px 2px rgba(30,51,32,.05),0 8px 22px rgba(30,51,32,.07);padding:13px 15px}
.adm-num b{display:block;font-family:var(--font-lora),Georgia,serif;font-size:28px;line-height:1.05;font-variant-numeric:tabular-nums}
.adm-num b small{font-size:15px;color:rgba(26,43,28,.42)}
.adm-cortesia{border-style:dashed;border-color:rgba(91,141,239,.55);background:#F4F7FF}
.adm-fora{margin-top:10px;padding-top:10px;border-top:1px dashed rgba(61,102,65,.25)}
.adm-num b.adm-par{display:flex;flex-wrap:wrap;gap:4px 14px}
.adm-num b.adm-par span{display:flex;align-items:baseline;gap:5px;font-size:28px;color:inherit}
.adm-num b.adm-par small{font-family:var(--font-dm),system-ui,sans-serif;font-size:12.5px;font-weight:500}
.adm-num span{font-size:12.5px;color:rgba(26,43,28,.62)}
.adm-destaque{background:#14463A;border-color:#14463A;color:#fff}
.adm-destaque span{color:#C9DDD6}
.adm-funil{display:grid;gap:8px;margin-top:4px}
.adm-f{display:grid;grid-template-columns:170px 1fr 44px;gap:10px;align-items:center;font-size:13.5px}
.adm-b{height:22px;border-radius:7px;background:#F1EADB;overflow:hidden;display:block}
.adm-b i{display:block;height:100%;border-radius:7px;background:#3D6641}
.adm-v{font-variant-numeric:tabular-nums;font-weight:700;text-align:right}
.adm-rolar{overflow-x:auto;margin:0 -4px;padding:0 4px}
.adm table{border-collapse:collapse;width:100%;min-width:640px;font-size:13.5px}
.adm th{text-align:left;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:rgba(26,43,28,.42);padding:6px 10px 8px;border-bottom:1.5px solid rgba(61,102,65,.18);white-space:nowrap}
.adm td{padding:10px;border-bottom:1px solid rgba(61,102,65,.18);vertical-align:top}
.adm tr:last-child td{border-bottom:0}
.adm td.adm-n,.adm th.adm-n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.adm-nq{white-space:nowrap}
.adm-quem b{display:block;font-weight:700}
.adm-quem span{font-size:12.5px;color:rgba(26,43,28,.42)}
.adm-p{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:99px;white-space:nowrap}
.adm-quem .adm-p{display:table}
.adm-verm{background:rgba(220,38,38,.10);color:#C0302B!important}
.adm-amb{background:rgba(245,158,11,.14);color:#B45309!important}
.adm-ok{background:rgba(47,107,79,.12);color:#2F6B4F!important}
.adm-cor{background:rgba(255,107,92,.12);color:#B5432A!important}
.adm-az{background:#E3ECFF;color:#2F5FC4!important}
.adm-cin{background:#F1EADB;color:rgba(26,43,28,.62)!important}
.adm-data{display:block;font-size:12px;color:rgba(26,43,28,.42);margin-top:3px}
.adm-uso{font-size:12.5px;color:rgba(26,43,28,.62);white-space:nowrap}
.adm-ver{font-size:12.5px;color:rgba(26,43,28,.42);margin:10px 2px 0}
.adm-vazio{font-size:13.5px;color:rgba(26,43,28,.55);margin:4px 0 0}
.adm-duas{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px}
.adm-motivo{padding:11px 0;border-bottom:1px solid rgba(61,102,65,.18)}
.adm-motivo:last-child{border-bottom:0;padding-bottom:0}
.adm-motivo:first-of-type{padding-top:0}
.adm-linha2{display:block;font-size:12.5px;color:rgba(26,43,28,.42);margin-top:2px}
.adm-motivo q{display:block;font-size:13.5px;color:rgba(26,43,28,.62);margin-top:3px;quotes:"“" "”"}
.adm-pe{font-size:12.5px;color:rgba(26,43,28,.42);border-top:1px solid rgba(61,102,65,.18);padding-top:14px;margin:0}
@media (max-width:640px){.adm-f{grid-template-columns:118px 1fr 36px}}
`
