'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Child } from '@/lib/types'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { useAccess } from '@/components/access/AccessContext'
import EmptyState from '@/components/ui/EmptyState'
import { Plus, Pencil, Trash2, Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import {
  Payment, PaymentMark, montarOcorrencias, competenciaAtual, competenciaAnterior,
  competenciaSeguinte, competenciaLabel, formatBRL, diasDeAtraso, hojeDs,
} from '@/lib/payments'

const emptyForm = { title: '', child_id: '', amount: '', due_day: '10', notes: '' }

/** Escolha explícita de "esta mensalidade não é de um filho específico". */
const SEM_FILHO = '__sem_filho__'

export default function MensalidadesClient({ initialPayments, initialMarks, children }: {
  initialPayments: Payment[]
  initialMarks: PaymentMark[]
  children: Child[]
}) {
  const supabase = createClient()
  const { canEdit } = useAccess()

  const [payments, setPayments] = useState<Payment[]>(initialPayments)
  const [marks, setMarks] = useState<PaymentMark[]>(initialMarks)
  const [competencia, setCompetencia] = useState(competenciaAtual())
  const [modal, setModal] = useState<{ mode: 'new' | 'edit'; payment?: Payment } | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [marcando, setMarcando] = useState<string | null>(null)

  // Reidrata quando o servidor manda props frescas (router.refresh / realtime).
  useEffect(() => { setPayments(initialPayments) }, [initialPayments])
  useEffect(() => { setMarks(initialMarks) }, [initialMarks])

  const hoje = hojeDs()
  const ocorrencias = montarOcorrencias(payments, marks, competencia, hoje)
  const emAberto = ocorrencias.filter(o => !o.pago)
  const totalAberto = emAberto.reduce((s, o) => s + (o.payment.amount ?? 0), 0)

  function openNew() {
    // Sem pré-seleção do primeiro filho: com mais de um, o default silencioso
    // grava a mensalidade na criança errada sem ninguém perceber. O campo
    // nasce vazio e obriga a escolha.
    setForm({ ...emptyForm })
    setModal({ mode: 'new' })
  }

  function openEdit(p: Payment) {
    setForm({
      title: p.title,
      child_id: p.child_id ?? SEM_FILHO,
      amount: p.amount !== null ? String(p.amount).replace('.', ',') : '',
      due_day: String(p.due_day),
      notes: p.notes ?? '',
    })
    setModal({ mode: 'edit', payment: p })
  }

  async function handleSave() {
    const dueDay = Number(form.due_day)
    if (!form.title.trim() || !dueDay) return

    // Só barra quando há filhos cadastrados: sem eles o campo nem aparece.
    if (children.length > 0 && form.child_id === '') {
      toast('Escolha de qual filho é a mensalidade.', 'error')
      return
    }
    setSaving(true)

    // Vírgula é o separador decimal que o usuário brasileiro digita; o banco
    // espera ponto. Campo vazio vira null, não 0 — "não sei o valor" é
    // diferente de "custa zero".
    const valorTxt = form.amount.trim().replace(/\./g, '').replace(',', '.')
    const amount = valorTxt === '' ? null : Number(valorTxt)
    if (amount !== null && Number.isNaN(amount)) {
      setSaving(false)
      toast('Valor inválido. Use apenas números, ex.: 280,00', 'error')
      return
    }

    const campos = {
      title: form.title.trim(),
      child_id: form.child_id && form.child_id !== SEM_FILHO ? form.child_id : null,
      amount,
      due_day: Math.min(Math.max(dueDay, 1), 31),
      notes: form.notes.trim() || null,
    }

    if (modal?.mode === 'edit' && modal.payment) {
      const { data, error } = await supabase.from('payments')
        .update(campos).eq('id', modal.payment.id)
        .select('*, child:children(name, avatar_color)').single()
      setSaving(false)
      if (error) { toast('Não foi possível salvar. Tente novamente.', 'error'); return }
      setPayments(prev => prev.map(p => p.id === data.id ? data as Payment : p))
      toast('Mensalidade atualizada ✓')
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setSaving(false); return }
      const { data, error } = await supabase.from('payments')
        .insert({ ...campos, user_id: user.id })
        .select('*, child:children(name, avatar_color)').single()
      setSaving(false)
      if (error) { toast('Não foi possível salvar. Tente novamente.', 'error'); return }
      setPayments(prev => [...prev, data as Payment])
      toast('Mensalidade criada ✓')
    }
    setModal(null)
  }

  async function handleDelete(p: Payment) {
    if (!confirm(`Excluir "${p.title}"? O histórico de pagamentos também será removido.`)) return
    const { error } = await supabase.from('payments').delete().eq('id', p.id)
    if (error) { toast('Não foi possível excluir.', 'error'); return }
    setPayments(prev => prev.filter(x => x.id !== p.id))
    setMarks(prev => prev.filter(m => m.payment_id !== p.id))
    toast('Mensalidade excluída')
  }

  async function togglePago(paymentId: string, pago: boolean) {
    setMarcando(paymentId)
    if (pago) {
      // Desmarcar: apaga a marca daquela competência. O histórico dos outros
      // meses fica intacto.
      const { error } = await supabase.from('payment_marks')
        .delete().eq('payment_id', paymentId).eq('competencia', competencia)
      setMarcando(null)
      if (error) { toast('Não foi possível desmarcar.', 'error'); return }
      setMarks(prev => prev.filter(m => !(m.payment_id === paymentId && m.competencia === competencia)))
    } else {
      const { data, error } = await supabase.from('payment_marks')
        .insert({ payment_id: paymentId, competencia }).select().single()
      setMarcando(null)
      if (error) { toast('Não foi possível marcar como pago.', 'error'); return }
      setMarks(prev => [...prev, data as PaymentMark])
    }
  }

  const ehMesAtual = competencia === competenciaAtual()

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-5 space-y-5" style={{ boxSizing: 'border-box' }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 animate-fade-up">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-lora)', color: '#1A2B1C' }}>
            Mensalidades
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(26,43,28,0.45)' }}>
            Pagamentos recorrentes das atividades
          </p>
        </div>
        {canEdit && (
          <button onClick={openNew}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition-all hover:brightness-105 active:scale-95 flex-shrink-0"
            style={{ background: '#fff', color: '#14463A', border: '1px solid rgba(20,70,58,0.18)', boxShadow: '0 2px 8px rgba(44,74,46,0.10)' }}>
            <Plus size={16} /> Nova
          </button>
        )}
      </div>

      {/* Navegação de competência + total em aberto */}
      <div className="card p-3 flex items-center gap-2 flex-wrap animate-fade-up">
        <button onClick={() => setCompetencia(c => competenciaAnterior(c))}
          className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:brightness-95 flex-none"
          style={{ background: 'rgba(61,102,65,0.07)', border: '1px solid rgba(61,102,65,0.14)', color: '#3D6641' }}
          title="Mês anterior">
          <ChevronLeft size={15} />
        </button>
        <span className="text-sm font-bold capitalize" style={{ color: '#1A2B1C' }}>
          {competenciaLabel(competencia)}
        </span>
        <button onClick={() => setCompetencia(c => competenciaSeguinte(c))}
          className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:brightness-95 flex-none"
          style={{ background: 'rgba(61,102,65,0.07)', border: '1px solid rgba(61,102,65,0.14)', color: '#3D6641' }}
          title="Próximo mês">
          <ChevronRight size={15} />
        </button>
        {!ehMesAtual && (
          <button onClick={() => setCompetencia(competenciaAtual())}
            className="px-3 py-1.5 rounded-full text-xs font-bold transition-all hover:brightness-95"
            style={{ background: 'rgba(61,102,65,0.07)', color: '#3D6641', border: '1px solid rgba(61,102,65,0.14)' }}>
            Mês atual
          </button>
        )}

        <span className="ml-auto text-xs font-bold flex-none" style={{ color: emAberto.length > 0 ? '#B91C1C' : 'rgba(26,43,28,0.45)' }}>
          {emAberto.length === 0
            ? 'tudo pago ✓'
            : `${formatBRL(totalAberto)} · ${emAberto.length} em aberto`}
        </span>
      </div>

      {/* Lista */}
      {ocorrencias.length === 0 ? (
        <EmptyState
          title="Nenhuma mensalidade cadastrada"
          subtitle="Cadastre os pagamentos recorrentes — natação, piano, pedagoga — e receba o alerta no dia do vencimento."
          actionLabel={canEdit ? 'Nova mensalidade' : undefined}
          onAction={canEdit ? openNew : undefined}
        />
      ) : (
        <div className="space-y-3">
          {ocorrencias.map((o, i) => {
            const st = o.status
            const cor = st === 'vencido' ? '#DC2626'
              : st === 'vence_hoje' ? '#D97706'
              : st === 'pago' ? '#3D6641'
              : 'rgba(26,43,28,0.35)'
            const atraso = st === 'vencido' ? diasDeAtraso(o.vencimento, hoje) : 0
            const selo = st === 'pago' ? 'Pago'
              : st === 'vence_hoje' ? '🔥 Vence hoje'
              : st === 'vencido' ? (atraso === 1 ? 'Venceu ontem' : `Venceu há ${atraso} dias`)
              // Dia vem de `o.vencimento` (já resolvido para o mês), NÃO de
              // `due_day`. A regra "todo dia 31" exibida cruamente anuncia
              // "Vence dia 31" em fevereiro — data que não existe. O alerta
              // sempre disparou no dia certo; era só a etiqueta que mentia.
              : `Vence dia ${Number(o.vencimento.slice(8, 10))}`

            return (
              <div key={o.payment.id} className="card p-4 animate-fade-up"
                style={{
                  animationDelay: `${i * 0.04}s`,
                  ...(st === 'vencido' || st === 'vence_hoje'
                    ? { borderLeft: `3px solid ${cor}` } : {}),
                  ...(o.pago ? { opacity: 0.72 } : {}),
                }}>
                <div className="flex items-start gap-3">

                  {/* Marcar como pago */}
                  <button
                    onClick={() => canEdit && togglePago(o.payment.id, o.pago)}
                    disabled={!canEdit || marcando === o.payment.id}
                    title={o.pago ? 'Desmarcar pagamento' : 'Marcar como pago'}
                    className="w-[26px] h-[26px] rounded-lg flex items-center justify-center flex-none mt-0.5 transition-all active:scale-90"
                    style={o.pago
                      ? { background: '#3D6641', border: '2px solid #3D6641', color: '#fff' }
                      : { background: '#fff', border: '2px solid rgba(26,43,28,0.22)', cursor: canEdit ? 'pointer' : 'not-allowed' }}>
                    {marcando === o.payment.id
                      ? <Loader2 size={13} className="animate-spin" style={{ color: o.pago ? '#fff' : '#3D6641' }} />
                      : o.pago && <Check size={14} strokeWidth={3.5} />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[15px]"
                        style={{ color: '#1A2B1C', textDecoration: o.pago ? 'line-through' : 'none' }}>
                        {o.payment.title}
                      </span>
                      {o.payment.child?.name && (
                        <span className="text-[11px] font-extrabold px-2 py-[2px] rounded-full text-white flex-none"
                          style={{ background: o.payment.child.avatar_color }}>
                          {o.payment.child.name}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-[15px] font-bold" style={{ color: '#1A2B1C' }}>
                        {formatBRL(o.payment.amount)}
                      </span>
                      <span className="text-[11px] font-bold px-2 py-[3px] rounded-full flex-none"
                        style={{ background: `${cor}14`, color: cor, border: `1px solid ${cor}33` }}>
                        {selo}
                      </span>
                    </div>

                    {o.payment.notes && (
                      <p className="text-xs mt-1.5" style={{ color: 'rgba(26,43,28,0.45)' }}>{o.payment.notes}</p>
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex-none flex gap-1">
                      <button onClick={() => openEdit(o.payment)} title="Editar"
                        className="w-8 h-8 rounded-[10px] flex items-center justify-center transition-all hover:brightness-95"
                        style={{ background: 'rgba(61,102,65,0.08)', border: '1px solid rgba(61,102,65,0.18)', color: '#3D6641' }}>
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDelete(o.payment)} title="Excluir"
                        className="w-8 h-8 rounded-[10px] flex items-center justify-center transition-all hover:brightness-95"
                        style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.16)', color: '#DC2626' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de criação/edição */}
      <Modal
        open={!!modal}
        onClose={() => { if (!saving) setModal(null) }}
        title={modal?.mode === 'edit' ? 'Editar mensalidade' : 'Nova mensalidade'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: 'rgba(26,43,28,0.55)' }}>
              O que é
            </label>
            {/* Sem autoFocus: no celular ele abre o teclado ao montar o modal,
                e o resto do formulário — inclusive o campo Filho — sai da área
                visível sem nenhuma pista de que existe. */}
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Ex.: Natação" className="input-field w-full" />
          </div>

          {/* Filho vem logo depois do título: é identidade da mensalidade,
              mais importante que valor e dia. Antes ficava abaixo deles e
              passava despercebido. */}
          {children.length > 0 && (
            <div>
              <label className="block text-xs font-bold mb-1.5" style={{ color: 'rgba(26,43,28,0.55)' }}>
                De qual filho?
              </label>
              <select value={form.child_id} onChange={e => setForm(f => ({ ...f, child_id: e.target.value }))}
                className="input-field w-full">
                <option value="">Selecione…</option>
                {children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                {/* Sentinela: "" é o estado "não escolhi ainda", que bloqueia o
                    salvamento. "Sem filho" precisa ser uma escolha explícita,
                    não o mesmo valor do campo em branco. */}
                <option value={SEM_FILHO}>Sem filho específico</option>
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1.5" style={{ color: 'rgba(26,43,28,0.55)' }}>
                Valor (R$)
              </label>
              <input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                inputMode="decimal" placeholder="280,00" className="input-field w-full" />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5" style={{ color: 'rgba(26,43,28,0.55)' }}>
                Vence todo dia
              </label>
              <select value={form.due_day} onChange={e => setForm(f => ({ ...f, due_day: e.target.value }))}
                className="input-field w-full">
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d =>
                  <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: 'rgba(26,43,28,0.55)' }}>
              Observações
            </label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Ex.: PIX chave 11 99999-0000" className="input-field w-full" />
          </div>

          <p className="text-[11px] italic" style={{ color: 'rgba(26,43,28,0.42)' }}>
            O alerta aparece no dia do vencimento e continua até você marcar como pago.
          </p>

          <div className="flex justify-end gap-3 pt-1">
            <Button variant="ghost" onClick={() => setModal(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.title.trim()}
              style={{ background: 'linear-gradient(140deg,#3D6641,#2C4A2E)', boxShadow: '0 4px 14px rgba(61,102,65,0.30)' }}>
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
