'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  UserCog, Star, Bell, Headphones, HelpCircle,
  FileText, Shield, ChevronRight, LogOut, ExternalLink, ChartPie,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface SettingsItem {
  href?: string
  label: string
  icon: React.ElementType
  badge?: string
  onClick?: () => void
  danger?: boolean
  external?: boolean
}

interface SettingsSection {
  title: string
  items: SettingsItem[]
}

export default function SettingsClient({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter()

  async function handleLogout() {
    await createClient().auth.signOut()
    router.push('/auth/login')
  }

  const sections: SettingsSection[] = [
    {
      title: 'Conta',
      items: [
        { href: '/conta',   label: 'Minha Conta', icon: UserCog },
        { href: '/planos',  label: 'Planos',       icon: Star },
        { href: '/alertas', label: 'Alertas',      icon: Bell, badge: 'WhatsApp' },
      ],
    },
    {
      title: 'Ajuda',
      items: [
        { href: '/suporte', label: 'Suporte', icon: Headphones },
        { href: '/faq',     label: 'FAQ',     icon: HelpCircle },
      ],
    },
    {
      title: 'Legal',
      items: [
        { href: '/termos',      label: 'Termos de Uso', icon: FileText },
        { href: '/privacidade', label: 'Privacidade',   icon: Shield },
      ],
    },
    {
      title: 'Sobre',
      items: [
        { href: 'https://www.familiaemdia.com.br/marketing/Landing-Familia-em-Dia-P6-IA.html', label: 'Site', icon: ExternalLink, external: true },
      ],
    },
    // Só fundadores (decidido no servidor). Para os demais a lista fica como sempre foi.
    ...(isAdmin ? [{
      title: 'Admin',
      items: [{ href: '/admin', label: 'Painel do negócio', icon: ChartPie }],
    }] : []),
  ]

  return (
    <div style={{ minHeight:'100vh', background:'#F8F3EA', paddingBottom:'env(safe-area-inset-bottom, 24px)' }}>

      {/* Header */}
      <div style={{ padding:'20px 20px 16px', borderBottom:'1px solid rgba(61,102,65,0.12)' }}>
        <h1 style={{ fontFamily:'var(--font-lora)', fontSize:22, fontWeight:700, color:'#1A2B1C', margin:0 }}>
          Configurações
        </h1>
        <p style={{ fontSize:12.5, color:'rgba(26,43,28,0.45)', marginTop:4 }}>
          Preferências da sua conta
        </p>
      </div>

      <div style={{ padding:'16px 16px 0' }}>
        {sections.map((section, si) => (
          <div key={section.title} style={{ marginBottom:24 }}>
            {/* Section label */}
            <div style={{ fontSize:10.5, fontWeight:800, letterSpacing:'0.14em',
              textTransform:'uppercase', color:'rgba(26,43,28,0.38)',
              padding:'0 4px 8px' }}>
              {section.title}
            </div>

            {/* Items card */}
            <div style={{ background:'#FFFFFF', borderRadius:16,
              border:'1px solid rgba(61,102,65,0.10)',
              boxShadow:'0 2px 12px rgba(44,74,46,0.06)', overflow:'hidden' }}>
              {section.items.map((item, idx) => {
                const Icon = item.icon
                const inner = (
                  <>
                    <div style={{ width:36, height:36, borderRadius:10, flexShrink:0,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      background:'rgba(61,102,65,0.09)' }}>
                      <Icon size={17} strokeWidth={1.8} color={item.danger ? '#B45309' : '#3D6641'} />
                    </div>
                    <span style={{ flex:1, fontSize:15, fontWeight:500,
                      color: item.danger ? '#B45309' : '#1A2B1C' }}>
                      {item.label}
                    </span>
                    {item.badge && (
                      <span style={{ fontSize:10, fontWeight:700, background:'rgba(61,102,65,0.12)',
                        color:'rgba(26,43,28,0.55)', padding:'2px 7px', borderRadius:6, marginRight:4 }}>
                        {item.badge}
                      </span>
                    )}
                    <ChevronRight size={15} color="rgba(26,43,28,0.22)" />
                  </>
                )
                const rowStyle: React.CSSProperties = {
                  display:'flex', alignItems:'center', gap:12,
                  padding:'10px 14px',
                  borderBottom: idx < section.items.length - 1 ? '1px solid rgba(61,102,65,0.08)' : 'none',
                  textDecoration:'none', cursor:'pointer',
                }
                if (item.onClick) {
                  return (
                    <button key={item.label} onClick={item.onClick}
                      style={{ ...rowStyle, background:'none', border:'none', width:'100%', textAlign:'left' }}>
                      {inner}
                    </button>
                  )
                }
                return (
                  <Link key={item.label} href={item.href!} style={rowStyle}
                    {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    {inner}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}

        {/* Sair */}
        <div style={{ marginBottom:24 }}>
          <div style={{ background:'#FFFFFF', borderRadius:16,
            border:'1px solid rgba(61,102,65,0.10)',
            boxShadow:'0 2px 12px rgba(44,74,46,0.06)', overflow:'hidden' }}>
            <button onClick={handleLogout}
              style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px',
                width:'100%', background:'none', border:'none', cursor:'pointer', textAlign:'left' }}>
              <div style={{ width:36, height:36, borderRadius:10, flexShrink:0,
                display:'flex', alignItems:'center', justifyContent:'center',
                background:'rgba(196,154,108,0.12)' }}>
                <LogOut size={17} strokeWidth={1.8} color="#C49A6C" />
              </div>
              <span style={{ flex:1, fontSize:15, fontWeight:500, color:'#B45309' }}>
                Sair da conta
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
