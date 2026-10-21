'use client'
import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Users, Copy, Check, Trash2, Crown, UserPlus, Eye, Truck, Pencil, Clock, MessageCircle, Lock } from 'lucide-react'
import type { PlanId } from '@/lib/planos-limites'
import { useUpsell } from '@/components/billing/Upsell'

type AccessRole = 'read_only' | 'logistics_editor' | 'full_editor'

interface Member {
  id: string
  user_id: string
  display_name: string | null
  role: string
  access_role: string | null
  joined_at: string
}
interface PendingInvite {
  id: string
  token: string
  invited_email: string | null
  access_role: string
  expires_at: string
}
interface Props {
  userId: string
  userEmail: string
  familyId: string | null
  isOwner: boolean
  ownerId: string | null
  ownerDisplayName: string | null
  ownerEmail: string | null
  baseUrl: string
  members: Member[]
  pendingInvites: PendingInvite[]
  plan: PlanId
  partnerLimit: number
}

const ROLES: { key: AccessRole; label: string; short: string; desc: string; icon: React.ElementType }[] = [
  { key: 'read_only',        label: 'Apenas leitura',     short: 'Só leitura',  desc: 'Vê tudo, sem editar nada.', icon: Eye },
  { key: 'logistics_editor', label: 'Leitura + logística', short: 'Logística',  desc: 'Vê tudo e marca quem leva/busca. Não edita atividades nem documentos.', icon: Truck },
  { key: 'full_editor',      label: 'Acesso completo',    short: 'Completo',    desc: 'Cria, edita e exclui tudo — igual ao proprietário.', icon: Pencil },
]
const roleMeta = (r: string) => ROLES.find(x => x.key === r) ?? ROLES[1]

export default function ConfiguracoesClient({
  userId, userEmail, familyId, isOwner, ownerId, ownerDisplayName, ownerEmail, baseUrl,
  members: initialMembers, pendingInvites: initialInvites,
  plan, partnerLimit,
}: Props) {
  const supabase = createClient()
  const router = useRouter()
  const [members, setMembers]   = useState<Member[]>(initialMembers)
  const [invites, setInvites]   = useState<PendingInvite[]>(initialInvites)
  // IDs de convites já compartilhados — filtrados mesmo após router.refresh()
  const sharedIds = useRef<Set<string>>(new Set())
  // Realtime: reflete partner entrando / mudança de acesso ao vivo
  useEffect(() => { setMembers(initialMembers) }, [initialMembers])
  useEffect(() => {
    setInvites(initialInvites.filter(i => !sharedIds.current.has(i.id)))
  }, [initialInvites])
  const [email, setEmail]       = useState('')
  const [role, setRole]         = useState<AccessRole>('logistics_editor')
  const [generating, setGenerating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError]       = useState('')
  const inviteUrl = (token: string) => `${window.location.origin}/convite/${token}`

  async function generateInvite() {
    setError('')
    const mail = email.trim().toLowerCase() || null
    if (mail && !mail.includes('@')) { setError('Email inválido.'); return }
    setGenerating(true)

    // Ensure family exists (owner bootstrap)
    let fid = familyId
    if (!fid) {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: fam } = await supabase.from('families').insert({ created_by: user!.id }).select('id').single()
      fid = fam?.id ?? null
      if (fid) await supabase.from('family_members').insert({ family_id: fid, user_id: user!.id, role: 'owner' })
    }
    if (!fid) { setError('Não foi possível criar a família.'); setGenerating(false); return }

    const res = await fetch('/api/invites/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invited_email: mail, access_role: role, family_id: fid }),
    })
    const data = await res.json()

    if (!res.ok) {
      if (res.status === 402) {
        setError(data.message ?? 'Limite de parceiros atingido. Faça upgrade do plano.')
      } else {
        setError(data.error ?? 'Erro ao gerar o convite.')
      }
      setGenerating(false)
      return
    }

    setInvites(prev => [data as PendingInvite, ...prev])
    setEmail('')
    setGenerating(false)
  }

  function hideInvite(id: string) {
    sharedIds.current.add(id)
    setInvites(prev => prev.filter(i => i.id !== id))
  }

  async function markShared(id: string) {
    await supabase.from('family_invites').update({ shared_at: new Date().toISOString() }).eq('id', id)
  }

  async function copyLink(inv: PendingInvite) {
    await navigator.clipboard.writeText(inviteUrl(inv.token))
    setCopiedId(inv.id)
    markShared(inv.id)
    setTimeout(() => hideInvite(inv.id), 1500)
  }

  function openWhatsapp(inv: PendingInvite) {
    const url = inviteUrl(inv.token)
    const msg = `Oi! Te convidei para acompanhar a rotina dos nossos filhos no app Família em Dia. É só acessar e aceitar: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
    markShared(inv.id)
    hideInvite(inv.id)
  }

  async function revokeInvite(id: string) {
    await supabase.from('family_invites').update({ status: 'expired' }).eq('id', id)
    setInvites(prev => prev.filter(i => i.id !== id))
  }

  async function changeRole(memberId: string, newRole: AccessRole) {
    const prev = members
    setMembers(ms => ms.map(m => m.id === memberId ? { ...m, access_role: newRole } : m))
    const { error: upErr } = await supabase.from('family_members').update({ access_role: newRole }).eq('id', memberId)
    if (upErr) setMembers(prev)
  }

  async function revokePartner(memberId: string) {
    if (!confirm('Revogar o acesso deste parceiro?')) return
    await supabase.from('family_members').delete().eq('id', memberId)
    setMembers(prev => prev.filter(m => m.id !== memberId))
  }

  const partners = members.filter(m => m.role === 'partner')
  const me = members.find(m => m.user_id === userId)
  const { abrir: abrirUpsell } = useUpsell()
  const sharingBlocked = partnerLimit === 0
  const atPartnerLimit = partnerLimit !== Infinity && partners.length >= partnerLimit

  const cardStyle: React.CSSProperties = {
    background: 'linear-gradient(160deg,#FFFFFF 0%,#F8F3EA 100%)',
    border: '1px solid rgba(61,102,65,0.18)',
    boxShadow: '0 4px 16px rgba(44,74,46,0.08),0 1px 4px rgba(44,74,46,0.05)',
    borderRadius: 16,
    padding: '20px 20px',
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-5 space-y-5">
      {/* Header */}
      <div className="animate-fade-up">
        <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: '#2D6A35' }}>⚙️ Sistema</p>
        <h1 style={{ fontFamily: 'var(--font-lora)', fontSize: 24, fontWeight: 700, color: '#1A2B1C' }}>Configurações</h1>
        <p style={{ fontSize: 13, color: 'rgba(26,43,28,0.45)', marginTop: 2 }}>{userEmail}</p>
      </div>

      {/* Compartilhar acesso */}
      <div style={cardStyle} className="animate-fade-up">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(61,102,65,0.10)' }}>
            <Users size={14} color="#2D6A35" />
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1A2B1C' }}>Compartilhar acesso</h2>
        </div>

        {/* Members */}
        <div className="space-y-2 mb-5">
          {/* Owner — sempre o proprietário real da família ativa, mesmo quando quem está olhando é um parceiro */}
          <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgba(61,102,65,0.06)', border: '1px solid rgba(61,102,65,0.12)' }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white flex-none"
              style={{ background: 'linear-gradient(140deg,#3D6641,#2C4A2E)' }}>
              {(isOwner ? (me?.display_name ?? userEmail) : (ownerDisplayName ?? ownerEmail ?? 'P')).charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B1C' }}>
                {isOwner
                  ? <>Você <span style={{ fontSize: 11, color: 'rgba(26,43,28,0.45)', fontWeight: 400 }}>({userEmail})</span></>
                  : <>{ownerDisplayName ?? ownerEmail ?? 'Proprietário(a)'}{ownerEmail && ownerDisplayName ? <span style={{ fontSize: 11, color: 'rgba(26,43,28,0.45)', fontWeight: 400 }}> ({ownerEmail})</span> : null}</>
                }
              </div>
              <div style={{ fontSize: 11, color: 'rgba(26,43,28,0.45)' }}>Proprietário(a){ownerId === userId ? '' : ' · convidou você'}</div>
            </div>
            <Crown size={15} style={{ color: '#C49A6C', flexShrink: 0 }} />
          </div>

          {/* Partners */}
          {partners.map(p => {
            const rm = roleMeta(p.access_role ?? 'logistics_editor')
            return (
              <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)' }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white flex-none"
                  style={{ background: 'linear-gradient(140deg,#6366f1,#4338CA)' }}>
                  {(p.display_name ?? 'P').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B1C' }}>{p.display_name ?? 'Parceiro(a)'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(26,43,28,0.45)' }}>
                    Parceiro · desde {new Date(p.joined_at).toLocaleDateString('pt-BR')}
                  </div>
                </div>
                {isOwner ? (
                  <>
                    <select
                      value={p.access_role ?? 'logistics_editor'}
                      onChange={e => changeRole(p.id, e.target.value as AccessRole)}
                      style={{ fontSize: 11, padding: '5px 7px', borderRadius: 8, border: '1px solid rgba(61,102,65,0.25)', background: '#fff', color: '#1A2B1C', cursor: 'pointer', flexShrink: 0 }}
                      title="Tipo de acesso">
                      {ROLES.map(r => <option key={r.key} value={r.key}>{r.short}</option>)}
                    </select>
                    <button onClick={() => revokePartner(p.id)}
                      className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                      style={{ background: '#FFF0EB', color: '#F4522D', flexShrink: 0 }} title="Revogar acesso">
                      <Trash2 size={13} />
                    </button>
                  </>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#4338CA', flexShrink: 0 }}>{rm.short}</span>
                )}
              </div>
            )
          })}

          {partners.length === 0 && (
            <div style={{ fontSize: 13, color: 'rgba(26,43,28,0.40)', textAlign: 'center', padding: '12px 0', fontStyle: 'italic' }}>
              Nenhum parceiro com acesso ainda
            </div>
          )}
        </div>

        {/* Pending invites */}
        {isOwner && invites.length > 0 && (
          <div className="space-y-2 mb-5">
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(26,43,28,0.45)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Convites pendentes
            </div>
            {invites.map(inv => {
              const rm = roleMeta(inv.access_role)
              return (
                <div key={inv.id} className="p-3 rounded-xl" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.22)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Clock size={13} style={{ color: '#92400E', flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1A2B1C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inv.invited_email ?? '🔗 Link aberto (sem email)'}
                      </div>
                      <div style={{ fontSize: 10.5, color: '#92400E' }}>
                        {rm.short} · expira {new Date(inv.expires_at).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <button onClick={() => revokeInvite(inv.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                      style={{ background: '#FFF0EB', color: '#F4522D', flexShrink: 0 }} title="Cancelar convite">
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => copyLink(inv)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-bold transition-all hover:brightness-105"
                      style={{ background: copiedId === inv.id ? '#2D6A35' : 'rgba(61,102,65,0.10)', color: copiedId === inv.id ? '#fff' : '#2D6A35', fontSize: 12 }}>
                      {copiedId === inv.id ? <><Check size={12} /> Copiado!</> : <><Copy size={12} /> Copiar link</>}
                    </button>
                    <button onClick={() => openWhatsapp(inv)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-bold transition-all hover:brightness-105"
                      style={{ background: '#25D366', color: '#fff', fontSize: 12, border: 'none', cursor: 'pointer' }}>
                      <MessageCircle size={12} /> WhatsApp
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Invite form — owner only */}
        {isOwner ? (
          <div>
            <div style={{ height: 1, background: 'rgba(61,102,65,0.12)', marginBottom: 16 }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2D6A35', marginBottom: 10 }}>Convidar parceiro(a)</div>

            {/* Banner de upgrade — plano gratuito ou limite atingido */}
            {plan !== 'pausada' && (sharingBlocked || atPartnerLimit) && (
              <div style={{ background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.30)', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
                <div className="flex items-start gap-2">
                  <Lock size={14} style={{ color: '#92400E', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <p style={{ fontSize: 12.5, fontWeight: 700, color: '#78350F', margin: '0 0 4px' }}>
                      {sharingBlocked
                        ? 'Traga quem ajuda você'
                        : 'Rede de apoio sem limite'}
                    </p>
                    <p style={{ fontSize: 12, color: '#92400E', margin: '0 0 8px', lineHeight: 1.5 }}>
                      {sharingBlocked
                        ? 'No Família, o pai, a avó ou a babá veem a mesma agenda que você, com o nível de acesso que você escolher.'
                        : 'O Família inclui você + 1 pessoa. No Plus, todos que ajudam na rotina entram.'}
                    </p>
                    <button type="button" onClick={() => abrirUpsell('rede')}
                      style={{ display: 'inline-block', background: 'linear-gradient(140deg,#C49A6C,#A07840)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>
                      {sharingBlocked ? 'Assinar o Família' : 'Mudar para o Plus'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!sharingBlocked && !atPartnerLimit && (
              <>
                <div className="space-y-2 mb-3">
                  {ROLES.map(r => {
                    const sel = role === r.key
                    return (
                      <button key={r.key} onClick={() => setRole(r.key)}
                        className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl transition-all"
                        style={{ background: sel ? 'rgba(61,102,65,0.10)' : '#fff', border: `1.5px solid ${sel ? '#3D6641' : 'rgba(61,102,65,0.15)'}`, cursor: 'pointer' }}>
                        <div className="w-4 h-4 rounded-full flex items-center justify-center flex-none" style={{ marginTop: 1, border: `1.5px solid ${sel ? '#3D6641' : 'rgba(61,102,65,0.35)'}`, background: sel ? '#3D6641' : '#fff' }}>
                          {sel && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5">
                            <r.icon size={13} style={{ color: '#2D6A35' }} />
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1A2B1C' }}>{r.label}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'rgba(26,43,28,0.55)', marginTop: 2, lineHeight: 1.4 }}>{r.desc}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {error && <p style={{ color: '#DC2626', fontSize: 12, marginBottom: 10 }}>{error}</p>}

                <button onClick={generateInvite} disabled={generating}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-white transition-all hover:brightness-105 active:scale-95 disabled:opacity-60"
                  style={{ background: 'linear-gradient(140deg,#FF8A6E,#FF6B5C)', fontSize: 14, boxShadow: '0 4px 14px rgba(255,107,92,0.28)' }}>
                  <UserPlus size={16} />
                  {generating ? 'Gerando...' : 'Gerar link de convite'}
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'rgba(26,43,28,0.50)', padding: '8px 12px', background: 'rgba(61,102,65,0.05)', borderRadius: 10, fontStyle: 'italic' }}>
            Você está no ambiente de outro usuário. Apenas o proprietário pode convidar novos parceiros.
          </div>
        )}
      </div>
    </div>
  )
}
