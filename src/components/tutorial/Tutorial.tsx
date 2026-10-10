'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useAccess } from '@/components/access/AccessContext'
import { PASSOS, type PassoId } from './passos'

// Tutorial "Primeiros passos": bolinha "?" fixa no canto inferior direito que
// abre um carrossel com um passo por cartão. Substitui o tour de primeiro
// acesso. Não abre sozinho: no primeiro acesso a bolinha pulsa e mostra um
// balão; depois de aberta uma vez, fica quieta.

interface Estado { gratuito: boolean; feitos: Partial<Record<PassoId, boolean>> }

const AVISO = 'fed-tutorial-mudou'
const ler = (chave: string) => { try { return localStorage.getItem(chave) } catch { return null } }
const gravar = (chave: string, valor: string) => {
  try { localStorage.setItem(chave, valor) } catch { /* sem armazenamento: segue sem lembrar */ }
  window.dispatchEvent(new Event(AVISO))
}
const assinar = (fn: () => void) => { window.addEventListener(AVISO, fn); return () => window.removeEventListener(AVISO, fn) }
/** Valor guardado no navegador; no servidor vale `noServidor` (evita piscar na hidratação). */
function useGuardado(chave: string, noServidor: string | null) {
  return useSyncExternalStore(assinar, () => ler(chave), () => noServidor)
}

const TELA_ESTREITA = '(max-width: 767px)'
const assinarTela = (fn: () => void) => {
  const mq = window.matchMedia(TELA_ESTREITA)
  mq.addEventListener('change', fn)
  return () => mq.removeEventListener('change', fn)
}

export default function Tutorial({ userId }: { userId: string }) {
  const pathname = usePathname()
  const access = useAccess()
  const [aberto, setAberto] = useState(false)
  const [estado, setEstado] = useState<Estado | null>(null)
  const [balaoFechado, setBalaoFechado] = useState(false)
  const trilho = useRef<HTMLDivElement>(null)
  const travado = useRef(0)

  const celular = useSyncExternalStore(assinarTela, () => window.matchMedia(TELA_ESTREITA).matches, () => true)
  const visto = useGuardado(`fed-tutorial-visto-${userId}`, '1') === '1'
  const viuAgenda = useGuardado(`fed-tutorial-agenda-${userId}`, null) === '1'
  const guardado = Number(useGuardado(`fed-tutorial-passo-${userId}`, '0') ?? 0)

  // Todos veem todos os passos. Quem entrou por convite e não pode executar um
  // deles recebe só um aviso de que a ação depende do nível de acesso.
  const passos = PASSOS
  const semPermissao = (exige: (typeof PASSOS)[number]['exige']) =>
    exige === 'dono' ? !access.isOwner
    : exige === 'editar' ? !access.canEdit
    : exige === 'logistica' ? !access.canLogistics
    : false
  const atual = Math.max(0, Math.min(passos.length - 1, Number.isFinite(guardado) ? guardado : 0))

  // "Conferir na Agenda" não deixa rastro no banco: vale ter aberto a Agenda.
  useEffect(() => {
    if (userId && pathname === '/calendario' && ler(`fed-tutorial-agenda-${userId}`) !== '1') gravar(`fed-tutorial-agenda-${userId}`, '1')
  }, [pathname, userId])

  // O balão do primeiro acesso some sozinho; a bolinha continua pulsando.
  useEffect(() => {
    const t = setTimeout(() => setBalaoFechado(true), 15000)
    return () => clearTimeout(t)
  }, [])

  // Ao abrir, o carrossel volta ao passo em que a pessoa parou.
  useEffect(() => {
    if (aberto && trilho.current) trilho.current.scrollLeft = atual * trilho.current.clientWidth
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na abertura
  }, [aberto])

  useEffect(() => {
    if (!aberto) return
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aberto])

  if (!userId || passos.length === 0) return null

  function abrir() {
    setAberto(true)
    if (!visto) gravar(`fed-tutorial-visto-${userId}`, '1')
    fetch('/api/tutorial').then(r => (r.ok ? r.json() : null)).then(d => { if (d) setEstado(d) }).catch(() => {})
  }
  function irPara(i: number) {
    const n = Math.max(0, Math.min(passos.length - 1, i))
    gravar(`fed-tutorial-passo-${userId}`, String(n))
    // Enquanto a rolagem programada acontece, o evento de scroll não pode mexer
    // no passo atual: toques rápidos nas setas pulariam para o cartão errado.
    travado.current = Date.now() + 600
    trilho.current?.scrollTo({ left: n * trilho.current.clientWidth, behavior: 'smooth' })
  }
  function aoRolar() {
    if (Date.now() < travado.current || !trilho.current) return
    const i = Math.round(trilho.current.scrollLeft / Math.max(1, trilho.current.clientWidth))
    if (i !== atual) gravar(`fed-tutorial-passo-${userId}`, String(i))
  }

  const feito = (id: PassoId) => (id === 'agenda' ? viuAgenda : !!estado?.feitos[id])
  const avisoPago = (texto: string) => (
    <div style={{ fontSize: 12, lineHeight: 1.4, color: '#92400E', background: 'rgba(245,158,11,0.13)', border: '1px solid rgba(180,83,9,0.18)', borderRadius: 10, padding: '7px 10px' }}>
      🔒 {texto}{' '}
      {access.isOwner && <Link href="/planos" onClick={() => setAberto(false)} style={{ fontWeight: 700, color: '#92400E', textDecoration: 'underline' }}>Ver planos</Link>}
    </div>
  )

  return (
    <>
      <style>{`
        @keyframes tutorial-pulso { 0% { transform: scale(.85); opacity: .7 } 100% { transform: scale(1.5); opacity: 0 } }
        .tutorial-bolinha { right: 12px; bottom: 76px; }
        .tutorial-balao { right: 74px; bottom: 86px; }
        @media (min-width: 768px) { .tutorial-bolinha { right: 24px; bottom: 24px; } .tutorial-balao { right: 88px; bottom: 34px; } }
        .tutorial-folha { left: 0; right: 0; bottom: 0; top: max(28px, env(safe-area-inset-top, 0px)); border-radius: 22px 22px 0 0; }
        @media (min-width: 768px) { .tutorial-folha { left: 50%; right: auto; top: 5vh; bottom: 5vh; width: 440px; margin-left: -220px; border-radius: 22px; } }
        .tutorial-trilho { scrollbar-width: none; }
        .tutorial-trilho::-webkit-scrollbar { display: none; }
        @media (prefers-reduced-motion: reduce) { .tutorial-bolinha::after { animation: none !important; } }
        .tutorial-pulsa::after { content: ""; position: absolute; inset: -5px; border-radius: 50%; border: 3px solid #FF6B5C; opacity: 0; animation: tutorial-pulso 2.2s ease-out infinite; }
      `}</style>

      {!visto && !balaoFechado && !aberto && (
        <button type="button" onClick={abrir} className="tutorial-balao fixed z-[55]"
          style={{ background: '#1E3320', color: '#F8F3EA', fontSize: 12.5, fontWeight: 600, padding: '8px 12px', borderRadius: '12px 12px 2px 12px', border: 0, boxShadow: '0 10px 26px rgba(30,51,32,0.25)' }}>
          Como usar? Toque aqui
        </button>
      )}
      <button type="button" onClick={abrir} aria-label="Abrir o tutorial de primeiros passos"
        className={`tutorial-bolinha fixed z-[55] ${visto ? '' : 'tutorial-pulsa'}`}
        style={{ width: 52, height: 52, borderRadius: '50%', border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', color: '#fff', fontSize: 26, fontWeight: 700, lineHeight: 1,
          boxShadow: '0 8px 22px rgba(255,107,92,0.45)' }}>
        ?
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-[95]" onClick={() => setAberto(false)} style={{ background: 'rgba(20,34,22,0.5)', backdropFilter: 'blur(2px)' }} />
          <div role="dialog" aria-modal="true" aria-label="Primeiros passos" className="tutorial-folha fixed z-[96] animate-slide-up"
            style={{ background: '#F8F3EA', color: '#1A2B1C', display: 'flex', flexDirection: 'column', boxShadow: '0 -14px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 8px' }}>
              <strong style={{ fontFamily: 'Lora, Georgia, serif', fontSize: 18 }}>Primeiros passos</strong>
              <span style={{ fontSize: 12, color: 'rgba(26,43,28,0.45)', fontVariantNumeric: 'tabular-nums' }}>{atual + 1} de {passos.length}</span>
              <button type="button" onClick={() => setAberto(false)} aria-label="Fechar"
                style={{ marginLeft: 'auto', width: 34, height: 34, borderRadius: '50%', border: 0, background: '#E7E4DA', color: '#2C4A2E', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <X size={17} />
              </button>
            </div>

            <div ref={trilho} onScroll={aoRolar} className="tutorial-trilho"
              style={{ flex: 1, minHeight: 0, display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory' }}>
              {passos.map((p, i) => (
                <article key={p.id} aria-label={`Passo ${i + 1}: ${p.titulo}`}
                  style={{ flex: 'none', width: '100%', scrollSnapAlign: 'center', overflowY: 'auto', padding: '4px 16px 14px', display: 'flex', flexDirection: 'column', gap: 11 }}>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <b style={{ flex: 'none', width: 34, height: 34, borderRadius: '50%', background: feito(p.id) ? '#5A8C5E' : '#3D6641', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                      {feito(p.id) ? <Check size={18} strokeWidth={3} /> : i + 1}
                    </b>
                    <h4 style={{ fontFamily: 'Lora, Georgia, serif', fontSize: 18, lineHeight: 1.2, margin: 0, flex: 1 }}>{p.titulo}</h4>
                    {feito(p.id) && <span style={{ flex: 'none', fontSize: 11, fontWeight: 700, color: '#2C4A2E', background: '#D4E8D5', borderRadius: 99, padding: '3px 9px' }}>Feito</span>}
                  </div>

                  {estado?.gratuito && p.pago && avisoPago(p.pago)}
                  {semPermissao(p.exige) && (
                    <div style={{ fontSize: 12, lineHeight: 1.4, color: 'rgba(26,43,28,0.72)', background: 'rgba(61,102,65,0.09)', border: '1px solid rgba(61,102,65,0.18)', borderRadius: 10, padding: '7px 10px' }}>
                      👀 Seu acesso a esta família não inclui esta ação. Quem convidou você pode fazer isso ou ampliar o seu acesso.
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: p.guia.largo ? '1fr' : '42% 1fr', gap: 12, alignItems: 'start', background: '#FBF8F1', border: '1px solid rgba(61,102,65,0.18)', borderRadius: 14, padding: 10 }}>
                    {p.guia.img}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5, lineHeight: 1.45, minWidth: 0 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#3D6641' }}>{p.guia.rotulo ?? 'Onde fica no menu'}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, fontSize: 12, color: 'rgba(26,43,28,0.62)' }}>
                        {p.onde.map((o, k) => (o === 'ou' || o === 'e')
                          ? <span key={k}>{o}</span>
                          : <em key={k} style={{ fontStyle: 'normal', fontWeight: 700, padding: '3px 9px', borderRadius: 99, whiteSpace: 'nowrap',
                              ...(o.startsWith('✨') ? { background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', color: '#fff' } : { background: '#D4E8D5', color: '#2C4A2E' }) }}>{o}</em>)}
                      </div>
                      <div>{celular ? p.guia.celular : p.guia.computador}</div>
                    </div>
                  </div>

                  {p.quadros.map((q, k) => (
                    <figure key={k} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <figcaption style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.45 }}>
                        <i style={{ flex: 'none', fontStyle: 'normal', width: 21, height: 21, borderRadius: '50%', background: '#D4E8D5', color: '#2C4A2E', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>{k + 1}</i>
                        <span>{q.txt}</span>
                      </figcaption>
                      {estado?.gratuito && q.pago && avisoPago(q.pago)}
                      {q.img}
                    </figure>
                  ))}

                  <div style={{ fontSize: 12.5, color: '#B45309', background: 'rgba(245,158,11,0.12)', borderRadius: 10, padding: '7px 10px' }}>💡 {p.dica}</div>
                  <Link href={p.ir.href} onClick={() => setAberto(false)}
                    style={{ alignSelf: 'flex-start', background: '#3D6641', color: '#fff', fontWeight: 700, fontSize: 13, padding: '10px 14px', borderRadius: 12, textDecoration: 'none' }}>
                    {p.ir.rotulo} →
                  </Link>
                </article>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid rgba(61,102,65,0.18)', background: '#FBF8F1' }}>
              <button type="button" onClick={() => irPara(atual - 1)} disabled={atual === 0} aria-label="Passo anterior"
                style={{ width: 42, height: 42, borderRadius: '50%', border: '1px solid rgba(61,102,65,0.18)', background: '#fff', color: '#2C4A2E', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: atual === 0 ? 0.35 : 1, cursor: atual === 0 ? 'default' : 'pointer' }}>
                <ChevronLeft size={19} />
              </button>
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 6 }}>
                {passos.map((p, i) => (
                  <i key={p.id} style={{ height: 7, borderRadius: 7, transition: 'width .2s', width: i === atual ? 20 : 7, background: i === atual ? '#3D6641' : feito(p.id) ? '#8FBF93' : 'rgba(61,102,65,0.25)' }} />
                ))}
              </div>
              <button type="button" onClick={() => irPara(atual + 1)} disabled={atual === passos.length - 1} aria-label="Próximo passo"
                style={{ width: 42, height: 42, borderRadius: '50%', border: '1px solid rgba(61,102,65,0.18)', background: '#fff', color: '#2C4A2E', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: atual === passos.length - 1 ? 0.35 : 1, cursor: atual === passos.length - 1 ? 'default' : 'pointer' }}>
                <ChevronRight size={19} />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
