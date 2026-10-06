'use client'
import { useState } from 'react'
import { Save, Lock, AlertTriangle, Trash2, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { formatCPF, formatPhoneBR, isValidPhoneBR } from '@/lib/cpf'
import { addressError, normalizeAddress, type Address } from '@/lib/address'
import AddressFields from '@/components/AddressFields'

interface Props {
  email: string
  fullName: string
  phone: string
  birthDate: string
  cpf: string
  address: Address
  termsAccepted: boolean
  marketingConsent: boolean
  isOwner: boolean
  hasPartners: boolean
}

export default function ContaClient({ email, fullName, phone, birthDate, cpf, address, termsAccepted, marketingConsent, isOwner, hasPartners }: Props) {
  const [name, setName]       = useState(fullName)
  const [phoneV, setPhoneV]   = useState(phone ? formatPhoneBR(phone) : '')
  const [birth, setBirth]     = useState(birthDate)
  const [addr, setAddr]       = useState<Address>(address)
  // Contas criadas antes do aceite existir no cadastro ainda não aceitaram os
  // Termos: o servidor exige o aceite no primeiro salvamento, então a caixa
  // precisa aparecer aqui. Depois de aceito, some.
  const [accepted, setAccepted] = useState(termsAccepted)
  const [terms, setTerms]       = useState(false)
  const [consent, setConsent] = useState(marketingConsent)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  // ── Exclusão de conta ─────────────────────────────────────────────────────
  const [showDeleteModal,   setShowDeleteModal]   = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteLoading,     setDeleteLoading]     = useState(false)
  const [deleteError,       setDeleteError]       = useState('')

  async function handleDeleteAccount() {
    if (deleteConfirmText !== 'EXCLUIR') return
    setDeleteLoading(true)
    setDeleteError('')
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'EXCLUIR' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro desconhecido')
      window.location.href = '/auth/login'
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Erro ao excluir conta. Tente novamente.')
      setDeleteLoading(false)
    }
  }

  const phoneOk = phoneV.length === 0 || isValidPhoneBR(phoneV)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (name.trim().length < 3) { setError('Informe seu nome completo.'); return }
    if (!isValidPhoneBR(phoneV)) { setError('Celular inválido. Use DDD + número.'); return }
    if (!birth) { setError('Informe sua data de nascimento.'); return }
    if (!accepted && !terms) { setError('É necessário aceitar os Termos de Uso e a Política de Privacidade.'); return }
    // Endereço é opcional para parceiro convidado; se começou a preencher,
    // tem que terminar. Em branco, o salvamento não mexe no que já existe.
    const endereco = normalizeAddress(addr)
    const temEndereco = Object.values(endereco).some(Boolean)
    if (temEndereco) {
      const problema = addressError(endereco)
      if (problema) { setError(problema); return }
    }

    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: name, phone: phoneV, birth_date: birth, marketing_consent: consent,
          ...(temEndereco ? { address: endereco } : {}),
          ...(!accepted ? { terms_accepted: terms } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erro ao salvar.')
      setAccepted(true)
      toast('Dados atualizados ✓')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido.')
    } finally {
      setSaving(false)
    }
  }

  const labelStyle = { color: 'rgba(26,43,28,0.55)' } as const

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div className="animate-fade-up">
        <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: '#3D6641' }}>Configurações</p>
        <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 30, fontWeight: 700, color: '#1A2B1C', lineHeight: 1.1 }}>
          Minha Conta
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(26,43,28,0.45)' }}>
          Gerencie seus dados pessoais
        </p>
      </div>

      <form onSubmit={handleSave} className="animate-fade-up rounded-2xl p-6 space-y-4"
        style={{ background: 'linear-gradient(160deg,#FFFFFF,#FAFAF7)', border: '1px solid rgba(61,102,65,0.18)', boxShadow: '0 2px 12px rgba(44,74,46,0.07)' }}>

        <div>
          <label className="block text-xs font-semibold mb-2" style={labelStyle}>Nome completo</label>
          <input type="text" required value={name} onChange={e => setName(e.target.value)} className="input-field" />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold mb-2" style={labelStyle}>
            E-mail <Lock size={11} />
          </label>
          <input type="email" value={email} disabled className="input-field" style={{ opacity: 0.6 }} />
          <p className="text-xs mt-1" style={{ color: 'rgba(26,43,28,0.40)' }}>Para alterar o e-mail, fale com o suporte.</p>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-2" style={labelStyle}>Celular</label>
          <input type="tel" inputMode="numeric" required value={phoneV}
            onChange={e => setPhoneV(formatPhoneBR(e.target.value))}
            placeholder="(11) 90000-0000" className="input-field"
            style={!phoneOk ? { borderColor: '#E0607A' } : undefined} />
          {!phoneOk && <p className="text-xs mt-1" style={{ color: '#C0405A' }}>Celular incompleto.</p>}
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold mb-2" style={labelStyle}>
            CPF <Lock size={11} />
          </label>
          <input type="text" value={cpf ? formatCPF(cpf) : '—'} disabled className="input-field" style={{ opacity: 0.6 }} />
          <p className="text-xs mt-1" style={{ color: 'rgba(26,43,28,0.40)' }}>O CPF não pode ser alterado. Em caso de erro, fale com o suporte.</p>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-2" style={labelStyle}>Data de nascimento</label>
          <input type="date" required value={birth} onChange={e => setBirth(e.target.value)}
            max={new Date().toISOString().slice(0, 10)} className="input-field" />
        </div>

        <div className="pt-2">
          <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#3D6641' }}>Endereço</p>
          <p className="text-xs mb-3" style={{ color: 'rgba(26,43,28,0.50)' }}>
            Usado na nota fiscal da sua assinatura.
          </p>
          <AddressFields value={addr} onChange={setAddr} />
        </div>

        {!accepted && (
          <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
            <input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)}
              className="mt-0.5" style={{ accentColor: '#3D6641', width: 16, height: 16 }} />
            <span className="text-xs leading-relaxed" style={{ color: 'rgba(26,43,28,0.70)' }}>
              Li e aceito os{' '}
              <a href="/termos" target="_blank" className="font-semibold underline" style={{ color: '#3D6641' }}>Termos de Uso</a>
              {' '}e a{' '}
              <a href="/privacidade" target="_blank" className="font-semibold underline" style={{ color: '#3D6641' }}>Política de Privacidade</a>.
            </span>
          </label>
        )}

        <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
            className="mt-0.5" style={{ accentColor: '#3D6641', width: 16, height: 16 }} />
          <span className="text-xs leading-relaxed" style={{ color: 'rgba(26,43,28,0.60)' }}>
            Quero receber dicas, novidades e ofertas da Família em Dia por e-mail e WhatsApp.
          </span>
        </label>

        {error && (
          <div className="text-xs font-semibold px-4 py-3 rounded-2xl"
            style={{ background: '#FFF0F4', color: '#C0405A', border: '1px solid rgba(240,100,130,0.2)' }}>
            ⚠ {error}
          </div>
        )}

        <button type="submit" disabled={saving}
          className="flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-60"
          style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', boxShadow: '0 4px 16px rgba(255,107,92,0.30)' }}>
          {saving
            ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            : <><Save size={15} /> Salvar alterações</>
          }
        </button>
      </form>

      {/* ── Zona de perigo ─────────────────────────────────────────────── */}
      <div className="animate-fade-up rounded-2xl p-6"
        style={{ border: '1px solid rgba(220,38,38,0.20)', background: 'linear-gradient(160deg,#FFFFFF 0%,#FFF8F8 100%)' }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.10)' }}>
            <AlertTriangle size={14} color="#DC2626" />
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1A2B1C' }}>Zona de perigo</h2>
        </div>
        <p style={{ fontSize: 13, color: 'rgba(26,43,28,0.55)', marginBottom: 16, lineHeight: 1.6 }}>
          A exclusão é permanente e irreversível. Todos os seus dados serão removidos em conformidade com a LGPD.
        </p>
        <button
          onClick={() => setShowDeleteModal(true)}
          className="flex items-center gap-2 py-2.5 px-4 rounded-xl font-bold transition-all hover:brightness-95 active:scale-[0.98]"
          style={{ background: 'rgba(220,38,38,0.09)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.22)', fontSize: 13, cursor: 'pointer' }}>
          <Trash2 size={14} />
          Excluir minha conta permanentemente
        </button>
      </div>

      {/* ── Modal de confirmação de exclusão ───────────────────────────────── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(10,18,11,0.70)', backdropFilter: 'blur(4px)' }}>
          <div className="animate-scale-in" style={{
            background: 'linear-gradient(160deg,#FFFFFF,#FFF8F8)', borderRadius: 20,
            padding: '28px 24px', maxWidth: 420, width: '100%',
            border: '1px solid rgba(220,38,38,0.18)', boxShadow: '0 24px 64px rgba(0,0,0,0.24)',
          }}>
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.10)' }}>
                <AlertTriangle size={28} color="#DC2626" />
              </div>
            </div>

            <h3 style={{ fontFamily: 'var(--font-lora)', fontSize: 19, fontWeight: 700, color: '#1A2B1C', textAlign: 'center', marginBottom: 14 }}>
              Excluir conta permanentemente?
            </h3>

            {isOwner && hasPartners ? (
              <div style={{ background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
                <p style={{ fontSize: 12.5, lineHeight: 1.65, color: '#78350F', margin: 0 }}>
                  <strong>Você tem parceiros ativos.</strong> A propriedade da família será transferida automaticamente para o parceiro mais antigo. Todos os dados (filhos, atividades, documentos) permanecem intactos para quem continuar.
                </p>
              </div>
            ) : !isOwner ? (
              <div style={{ background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
                <p style={{ fontSize: 12.5, lineHeight: 1.65, color: '#78350F', margin: 0 }}>
                  <strong>Você é parceiro nesta família.</strong> Seus marcadores de quem leva/busca serão liberados. Nenhum outro dado da família será perdido.
                </p>
              </div>
            ) : (
              <div style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.20)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
                <p style={{ fontSize: 12.5, lineHeight: 1.65, color: '#991B1B', margin: 0 }}>
                  <strong>Atenção:</strong> você não tem parceiros. Todos os seus dados — filhos, atividades, documentos e arquivos — serão excluídos permanentemente. <strong>Esta ação não pode ser desfeita.</strong>
                </p>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: '#1A2B1C', display: 'block', marginBottom: 7 }}>
                Para confirmar, digite{' '}
                <span style={{ color: '#DC2626', fontFamily: 'monospace', fontSize: 13 }}>EXCLUIR</span>:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="EXCLUIR"
                autoFocus
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  border: `1.5px solid ${deleteConfirmText === 'EXCLUIR' ? '#DC2626' : 'rgba(220,38,38,0.22)'}`,
                  fontSize: 14, color: '#1A2B1C', outline: 'none', fontFamily: 'monospace',
                  letterSpacing: '0.06em', background: '#fff', transition: 'border-color .15s',
                }}
              />
            </div>

            {deleteError && (
              <p style={{ color: '#DC2626', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>{deleteError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); setDeleteError('') }}
                disabled={deleteLoading}
                style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: '1.5px solid rgba(61,102,65,0.22)', background: '#fff', color: '#1A2B1C', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteLoading || deleteConfirmText !== 'EXCLUIR'}
                style={{
                  flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 700,
                  cursor: deleteConfirmText === 'EXCLUIR' && !deleteLoading ? 'pointer' : 'not-allowed',
                  transition: 'all .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  background: deleteConfirmText === 'EXCLUIR' ? 'linear-gradient(140deg,#DC2626,#991B1B)' : 'rgba(220,38,38,0.25)',
                  color: '#fff',
                  boxShadow: deleteConfirmText === 'EXCLUIR' ? '0 4px 14px rgba(220,38,38,0.30)' : 'none',
                  opacity: deleteLoading ? 0.7 : 1,
                }}>
                {deleteLoading
                  ? <><Loader2 size={14} className="animate-spin" /> Excluindo...</>
                  : 'Excluir conta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
