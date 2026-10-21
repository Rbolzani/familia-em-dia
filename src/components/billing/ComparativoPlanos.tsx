import { Check, Minus } from 'lucide-react'
import { COMPARATIVO, DIAS_TESTE, NOTA_TABELA, PLANO_RECOMENDADO, type Celula } from '@/lib/planos-oferta'

// Tabela Básico × Família × Plus (T1) da tela Planos. O conteúdo vem de
// planos-oferta.ts — a mesma fonte dos e-mails e do cadastro. Os textos de
// apoio (etapas, nota) espelham a tabela da landing.

const COLUNAS = [
  { chave: 'basico', nome: 'Básico' },
  { chave: 'familia', nome: 'Família' },
  { chave: 'plus', nome: 'Plus' },
] as const

function Valor({ v, destaque }: { v: Celula; destaque: boolean }) {
  if (v === true) return <Check size={16} strokeWidth={2.6} color={destaque ? '#3D6641' : '#5A8C5E'} style={{ margin: '0 auto' }} aria-label="incluído" />
  if (v === false) return <Minus size={15} color="rgba(26,43,28,0.25)" style={{ margin: '0 auto' }} aria-label="não incluído" />
  return <span style={{ fontWeight: destaque ? 700 : 500 }}>{v}</span>
}

export default function ComparativoPlanos() {
  return (
    <section className="animate-fade-up" aria-labelledby="comparativo-titulo"
      style={{ background: '#fff', border: '1px solid rgba(61,102,65,0.16)', borderRadius: 16, padding: '16px 14px 12px', boxShadow: '0 4px 16px rgba(44,74,46,0.06)' }}>
      <h2 id="comparativo-titulo" style={{ fontSize: 16, fontWeight: 700, color: '#1A2B1C', margin: '0 0 2px' }}>Compare os planos</h2>
      <p style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', background: 'rgba(61,102,65,0.08)', borderRadius: 12, padding: '10px 12px', margin: '8px 0 12px', fontSize: 12.5, lineHeight: 1.45, color: '#1A2B1C' }}>
        <span><b>Dias 1 a {DIAS_TESTE}:</b> tudo do plano escolhido, sem pagar nada</span>
        <span><span aria-hidden="true" style={{ color: '#3D6641', fontWeight: 800 }}>→</span> <b>Dia {DIAS_TESTE + 1}:</b> primeira cobrança, no plano escolhido</span>
        <span><span aria-hidden="true" style={{ color: '#3D6641', fontWeight: 800 }}>→</span> <b>Quando quiser:</b> troque de plano ou cancele no app</span>
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, color: '#1A2B1C', minWidth: 320 }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left', padding: '6px 6px 8px 0', fontWeight: 600, color: 'rgba(26,43,28,0.50)', fontSize: 11 }}>Recurso</th>
              {COLUNAS.map(c => {
                const rec = c.chave === PLANO_RECOMENDADO
                return (
                  <th key={c.chave} scope="col" style={{
                    textAlign: 'center', padding: '6px 4px 8px', fontWeight: 800, fontSize: 12.5,
                    color: rec ? '#2C4A2E' : '#1A2B1C',
                    background: rec ? 'rgba(61,102,65,0.08)' : 'transparent',
                    borderRadius: rec ? '10px 10px 0 0' : 0,
                  }}>
                    {c.nome}
                    {rec && <span style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#3D6641', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Recomendado</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {COMPARATIVO.map((l, i) => (
              <tr key={l.recurso} style={{ borderTop: '1px solid rgba(61,102,65,0.10)' }}>
                <th scope="row" style={{ textAlign: 'left', padding: '8px 6px 8px 0', fontWeight: 500, color: 'rgba(26,43,28,0.75)', lineHeight: 1.35 }}>{l.recurso}</th>
                {COLUNAS.map(c => {
                  const rec = c.chave === PLANO_RECOMENDADO
                  return (
                    <td key={c.chave} style={{
                      textAlign: 'center', padding: '8px 4px', lineHeight: 1.3, fontVariantNumeric: 'tabular-nums',
                      background: rec ? 'rgba(61,102,65,0.08)' : 'transparent',
                      borderRadius: rec && i === COMPARATIVO.length - 1 ? '0 0 10px 10px' : 0,
                    }}>
                      <Valor v={l[c.chave]} destaque={rec} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: 'rgba(26,43,28,0.55)', margin: '10px 0 0', lineHeight: 1.5 }}>{NOTA_TABELA}</p>
    </section>
  )
}
