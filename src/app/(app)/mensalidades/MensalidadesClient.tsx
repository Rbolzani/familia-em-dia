'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Child } from '@/lib/types'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { useAccess } from '@/components/access/AccessContext'
import EmptyState from '@/components/ui/EmptyState'
import { Plus, Pencil, Trash2, Check, ChevronLeft, ChevronRight, Loader2, ListChecks, X } from 'lucide-react'
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
  const visibleIds = ocorrencias.map(o => o.payment.id)

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

  // ── Seleção múltipla ──────────────────────────────────────────────────────
  // Mesmo motivo das abas de atividades: uma captura por IA pode criar várias
  // mensalidades de uma vez, e desfazer uma a uma é inviável.
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deletingBulk, setDeletingBulk] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState<string[] | null>(null)

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  function handleDeleteSelected() {
    // Interseção com o que está na tela: nunca apagar o que não está à vista.
    const ids = visibleIds.filter(id => selected.has(id))
    if (ids.length === 0) return
    setConfirmBulk(ids)
  }

  async function runBulkDelete() {
    if (!confirmBulk) return
    setDeletingBulk(true)

    // Em lotes: um .in() com centenas de UUIDs estoura o limite de tamanho da
    // URL no PostgREST e a requisição falha inteira.
    const CHUNK = 100
    const apagados: string[] = []
    for (let i = 0; i < confirmBulk.length; i += CHUNK) {
      const lote = confirmBulk.slice(i, i + CHUNK)
      const { error } = await supabase.from('payments').delete().in('id', lote)
      if (error) {
        // Remove só o que de fato saiu do banco — o estado local não pode
        // afirmar exclusões que não aconteceram.
        setPayments(prev => prev.filter(x => !apagados.includes(x.id)))
        setMarks(prev => prev.filter(m => !apagados.includes(m.payment_id)))
        setSelected(new Set())
        setDeletingBulk(false)
        setConfirmBulk(null)
        toast(apagados.length > 0
          ? `${apagados.length} excluída(s), mas o restante falhou. Tente de novo.`
          : 'Não foi possível excluir. Tente novamente.', 'error')
        return
      }
      apagados.push(...lote)
    }

    setPayments(prev => prev.filter(x => !apagados.includes(x.id)))
    setMarks(prev => prev.filter(m => !apagados.includes(m.payment_id)))
    setDeletingBulk(false)
    setConfirmBulk(null)
    exitSelectMode()
    toast(`${apagados.length} mensalidade${apagados.length !== 1 ? 's' : ''} excluída${apagados.length !== 1 ? 's' : ''}`)
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
  const selectedVisibleCount = visibleIds.filter(id => selected.has(id)).length
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length

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

      {/* Linha do "Selecionar", encostado à direita — mesmo lugar e formato
          das abas de Escola, Saúde e Atividades. */}
      {canEdit && !selectMode && ocorrencias.length > 0 && (
        <div className="flex gap-2 items-center animate-fade-up">
          <button
            onClick={() => setSelectMode(true)}
            title="Selecionar várias para excluir"
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all hover:brightness-105 active:scale-95"
            style={{ background: 'rgba(255,255,255,0.70)', color: 'rgba(26,43,28,0.50)', border: '1px solid rgba(61,102,65,0.14)' }}>
            <ListChecks size={14} /> Selecionar
          </button>
        </div>
      )}

      {/* Barra de seleção múltipla — sticky para o botão excluir seguir o
          scroll numa lista longa. */}
      {selectMode && (
        <div className="sticky top-2 z-20 rounded-2xl p-2.5 flex items-center gap-2 flex-wrap animate-fade-up"
          style={{ background: 'linear-gradient(140deg,#14463A,#0F3830)', boxShadow: '0 6px 20px rgba(20,70,58,0.30)' }}>
          <button onClick={exitSelectMode}
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all hover:brightness-125 active:scale-95"
            style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }} title="Sair da seleção">
            <X size={15} />
          </button>

          <span className="text-sm font-bold flex-shrink-0" style={{ color: '#fff' }}>
            {selectedVisibleCount === 0
              ? 'Selecione as mensalidades'
              : `${selectedVisibleCount} selecionada${selectedVisibleCount !== 1 ? 's' : ''}`}
          </span>

          <button
            onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(visibleIds))}
            className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:brightness-125 active:scale-95 flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}>
            {allVisibleSelected ? 'Limpar' : `Selecionar todas (${visibleIds.length})`}
          </button>

          <button
            onClick={handleDeleteSelected}
            disabled={selectedVisibleCount === 0 || deletingBulk}
            className="ml-auto flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex-shrink-0"
            style={selectedVisibleCount === 0 || deletingBulk
              ? { background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.40)', cursor: 'not-allowed' }
              : { background: '#F4522D', color: '#fff', boxShadow: '0 3px 12px rgba(244,82,45,0.40)' }}>
            <Trash2 size={13} />
            {deletingBulk ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      )}

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
              <div key={o.payment.id}
                className={`card p-4 animate-fade-up${selectMode ? ' cursor-pointer' : ''}`}
                onClick={selectMode ? () => toggleSelect(o.payment.id) : undefined}
                style={{
                  animationDelay: `${i * 0.04}s`,
                  ...(st === 'vencido' || st === 'vence_hoje'
                    ? { borderLeft: `3px solid ${cor}` } : {}),
                  ...(o.pago && !selectMode ? { opacity: 0.72 } : {}),
                  ...(selectMode && selected.has(o.payment.id)
                    ? { boxShadow: '0 0 0 2px #14463A', background: 'rgba(20,70,58,0.05)' } : {}),
                }}>
                <div className="flex items-start gap-3">

                  {/* Em modo seleção a caixa marca o card; fora dele, marca o
                      pagamento. São dois significados para o mesmo canto do
                      card, então nunca podem coexistir. */}
                  {selectMode ? (
                    <div
                      className="w-[26px] h-[26px] rounded-lg flex items-center justify-center flex-none mt-0.5"
                      style={selected.has(o.payment.id)
                        ? { background: '#14463A', border: '2px solid #14463A', color: '#fff' }
                        : { background: '#fff', border: '2px solid rgba(26,43,28,0.22)' }}>
                      {selected.has(o.payment.id) && <Check size={14} strokeWidth={3.5} />}
                    </div>
                  ) : (
                    /* Marcar como pago */
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
                  )}

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

                  {canEdit && !selectMode && (
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

      {/* Confirmação da exclusão em lote.
          O aviso não é decorativo: a lista mostra UM mês, mas a mensalidade é
          uma regra recorrente — apagá-la remove todos os meses, passados e
          futuros, junto com o histórico do que já foi pago. Quem exclui
          olhando para "agosto" precisa saber que não está apagando agosto. */}
      <Modal
        open={!!confirmBulk}
        onClose={() => { if (!deletingBulk) setConfirmBulk(null) }}
        title="Excluir mensalidades"
        size="sm"
      >
        {confirmBulk && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: '#1A2B1C' }}>
              Excluir <strong>{confirmBulk.length}</strong>{' '}
              {confirmBulk.length === 1 ? 'mensalidade' : 'mensalidades'}?
              Esta ação não pode ser desfeita.
            </p>

            <div className="p-3 rounded-2xl"
              style={{ background: 'rgba(244,82,45,0.06)', border: '1px solid rgba(244,82,45,0.20)' }}>
              <span className="text-xs leading-relaxed" style={{ color: 'rgba(26,43,28,0.75)' }}>
                A mensalidade é uma regra que vale <strong>todos os meses</strong>.
                Excluir apaga também os <strong>meses anteriores e futuros</strong> e
                o histórico do que já foi marcado como pago — não só{' '}
                {competenciaLabel(competencia)}.
              </span>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="ghost" onClick={() => setConfirmBulk(null)} disabled={deletingBulk}>
                Cancelar
              </Button>
              <Button
                onClick={runBulkDelete}
                disabled={deletingBulk}
                style={{ background: 'linear-gradient(140deg,#F4522D,#D93E1C)', boxShadow: '0 4px 14px rgba(244,82,45,0.35)' }}
              >
                {deletingBulk ? 'Excluindo...' : `Excluir ${confirmBulk.length}`}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
