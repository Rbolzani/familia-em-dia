'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import {
  LayoutDashboard, BookOpen, HeartPulse, Trophy,
  CalendarDays, FolderLock, Sparkles, Leaf,
  Palette, Moon, Sun, SlidersHorizontal,
  Users, LogOut, Car, Settings, UserPlus, Bell, X, Clock, Star, UserCog,
  ChevronRight, Headphones, HelpCircle, FileText, Shield, ExternalLink, Wallet,
} from 'lucide-react'
import { ChildAvatar } from '@/app/(app)/children/ChildrenClient'
import { createClient } from '@/lib/supabase/client'
import { Toaster } from '@/components/ui/Toast'
import TourOverlay from '@/components/tour/TourOverlay'
import { useTour } from '@/components/tour/TourContext'

// ── Types ──────────────────────────────────────────────────────────────
interface SidebarChild {
  id: string
  name: string
  avatar_color: string
  avatar_url?: string | null
  birth_date: string | null
  school_name: string | null
}

interface Props {
  children: React.ReactNode
  sidebarChildren: SidebarChild[]
  activeFamilyId?: string | null
}

// ── Palettes ───────────────────────────────────────────────────────────
const PALETTES = [
  { name:'Floresta', hue:0,   sat:1.00, dot:'linear-gradient(140deg,#5A8C5E,#2C4A2E)' },
  { name:'Índigo',   hue:120, sat:1.10, dot:'linear-gradient(140deg,#6366F1,#3730A3)' },
  { name:'Âmbar',    hue:280, sat:1.20, dot:'linear-gradient(140deg,#F59E0B,#92400E)' },
  { name:'Rosa',     hue:210, sat:1.05, dot:'linear-gradient(140deg,#EC4899,#9D174D)' },
  { name:'Ardósia',  hue:0,   sat:0.08, dot:'linear-gradient(140deg,#64748B,#1E293B)' },
]


// ── Component ──────────────────────────────────────────────────────────
export default function AppLayout({ children, sidebarChildren: initial, activeFamilyId }: Props) {
  const pathname = usePathname()
  const router   = useRouter()
  const { isActive: tourActive } = useTour()

  // A lista vem pronta do Server Component; basta reidratar quando a prop
  // muda (navegação / router.refresh do RealtimeSync). Antes havia um SELECT
  // extra a cada troca de página, que só repetia o dado já recebido.
  const [liveChildren, setLiveChildren] = useState<SidebarChild[]>(initial)
  useEffect(() => { setLiveChildren(initial) }, [initial])

  const [palIdx,           setPalIdx]           = useState(0)
  const [sepia,            setSepia]            = useState(0)
  const [brightness,       setBrightness]       = useState(100)
  const [contrast,         setContrast]         = useState(100)
  const [darkMode,         setDarkMode]         = useState(false)
  const [mobileTemaOpen,   setMobileTemaOpen]   = useState(false)
  const [mobileSidebarOpen,setMobileSidebarOpen]= useState(false)
  const [desktopTweaksOpen,setDesktopTweaksOpen]= useState(false)
  const [cfgPanelOpen,     setCfgPanelOpen]     = useState(false)
  const cfgLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Notificações de logística ─────────────────────────────────────────
  const [pendingLogisticsCount, setPendingLogisticsCount] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState<{ id: string; type: string; payload: Record<string, string>; read: boolean; created_at: string }[]>([])
  const notifRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createClient()
    let userId: string

    async function loadNotifications() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      userId = user.id

      // Contar sugestões pendentes para mim na família ativa
      const sugQuery = supabase
        .from('logistics_suggestions')
        .select('id')
        .eq('proposed_to', user.id)
        .eq('status', 'pending')
      if (activeFamilyId) sugQuery.eq('family_id', activeFamilyId)
      const { data: suggestions } = await sugQuery
      setPendingLogisticsCount((suggestions ?? []).length)

      // Notificações in-app não lidas
      const { data: notifs } = await supabase
        .from('app_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)
      setNotifications((notifs ?? []) as typeof notifications)
    }

    loadNotifications()

    // Realtime: novas sugestões para mim
    const channel = supabase.channel('global_logistics_notif')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'logistics_suggestions' }, () => {
        loadNotifications()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_notifications' }, () => {
        loadNotifications()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
    // Assina uma vez por família ativa. Antes dependia de `pathname`, o que
    // derrubava e reabria o canal WebSocket (+3 queries) a CADA navegação —
    // principal causa da lentidão ao trocar de aba no mobile. O próprio
    // Realtime já mantém a lista atualizada, sem precisar do refetch por rota.
  }, [activeFamilyId])

  useEffect(() => {
    if (!notifOpen) return
    function handler(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [notifOpen])

  async function markAllRead() {
    const supabase = createClient()
    await supabase.from('app_notifications').update({ read: true }).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  function notifLabel(n: typeof notifications[number]): string {
    const p = n.payload
    if (n.type === 'logistics_suggestion') return `${p.proposed_by_name ?? 'Parceiro(a)'} sugeriu uma tarefa de logística para você`
    if (n.type === 'logistics_rejected') return `${p.rejected_by_name ?? 'Parceiro(a)'} recusou sua sugestão: ${p.activity_title ?? ''}`
    if (n.type === 'logistics_accepted') return `${p.accepted_by_name ?? 'Parceiro(a)'} aceitou sua sugestão: ${p.activity_title ?? ''}`
    return 'Notificação de logística'
  }

  const unreadCount = notifications.filter(n => !n.read).length + pendingLogisticsCount

  const appRef    = useRef<HTMLDivElement>(null)
  const navRef    = useRef<HTMLDivElement>(null)   // mobile sidebar — same filter as app-wrap
  const cfgPanelRef = useRef<HTMLDivElement>(null) // cfg sub-panel — outside app-wrap, needs filter

  // ── Apply CSS filter ────────────────────────────────────────────────
  // IMPORTANTE: um `filter` no wrapper do app inteiro promove a árvore toda a
  // uma camada de composição e vira containing block dos position:fixed —
  // caríssimo no mobile. Por isso, no tema padrão (Floresta, sem ajustes), a
  // propriedade é REMOVIDA em vez de receber um filtro identidade
  // (hue-rotate(0deg) saturate(1)... é visualmente nulo, mas custa igual).
  useEffect(() => {
    const el    = appRef.current
    const nav   = navRef.current
    const cfg   = cfgPanelRef.current
    if (!el) return
    const { hue, sat } = PALETTES[palIdx]
    const isDefaultTheme = !darkMode && hue === 0 && sat === 1
      && sepia === 0 && brightness === 100 && contrast === 100
    let filterStr: string
    if (isDefaultTheme) {
      filterStr = ''
    } else if (darkMode) {
      const darkHue = (180 + hue) % 360
      filterStr = `invert(1) hue-rotate(${darkHue}deg) saturate(${(sat * 0.95).toFixed(2)}) brightness(0.90) contrast(1.06)`
    } else {
      filterStr = `hue-rotate(${hue}deg) saturate(${sat}) sepia(${sepia}%) brightness(${brightness}%) contrast(${contrast}%)`
    }
    el.style.filter = filterStr
    if (nav) nav.style.filter = filterStr
    if (cfg) cfg.style.filter = filterStr
  }, [palIdx, sepia, brightness, contrast, darkMode, cfgPanelOpen])

  // Close sidebar + cfg panel on navigation
  useEffect(() => {
    setCfgPanelOpen(false)
    if (!tourActive) setMobileSidebarOpen(false)
  }, [pathname, tourActive])

  // Durante o tour no mobile, força a sidebar verde aberta.
  useEffect(() => {
    if (tourActive && typeof window !== 'undefined' && window.innerWidth < 768) {
      setMobileSidebarOpen(true)
    }
  }, [tourActive, pathname, mobileSidebarOpen])

  function cfgEnter() {
    if (cfgLeaveTimer.current) clearTimeout(cfgLeaveTimer.current)
    setCfgPanelOpen(true)
  }
  function cfgLeave() {
    cfgLeaveTimer.current = setTimeout(() => setCfgPanelOpen(false), 120)
  }

  async function handleLogout() {
    await createClient().auth.signOut()
    router.push('/auth/login')
  }

  function isActive(href: string) {
    return pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
  }

  const panelBg = darkMode
    ? `linear-gradient(175deg,#111C12 0%,#0C1510 100%)`
    : `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E"),linear-gradient(175deg,#F2EAD8 0%,#E8DEC8 100%)`
  const panelText  = darkMode ? '#C8DEC9' : '#1A2B1C'
  const panelMuted = darkMode ? 'rgba(200,222,201,0.50)' : 'rgba(26,43,28,0.55)'
  const panelBorder= darkMode ? 'rgba(80,130,84,0.22)' : 'rgba(61,102,65,0.22)'

  // Cabeçalho de bloco da sidebar. Extraído porque agora são quatro e o
  // markup estava duplicado inteiro em cada um.
  function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
      <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.16em', textTransform:'uppercase',
        display:'flex', alignItems:'center', gap:8, padding:'0 10px 6px', color:'rgba(231,241,238,0.5)' }}>
        {children}
        <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.10)' }} />
      </div>
    )
  }

  // ── Desktop NavItem ──────────────────────────────────────────────────
  function NavItem({ href, label, icon: Icon, badge, tourId }: {
    href: string; label: string; icon: React.ElementType; badge?: number; tourId?: string
  }) {
    const active = isActive(href)
    return (
      <Link href={href} data-tour={tourId}
        className={`flex items-center gap-3 px-3 py-[6px] rounded-[11px] text-[14px] font-medium transition-all duration-150 relative mb-[1px] ${active ? 'nav-active' : 'hover:bg-white/[0.06]'}`}
        style={active ? { color:'#FFFFFF', fontWeight:700 } : { color:'rgba(231,241,238,0.72)' }}>
        {active && (
          <div className="absolute pointer-events-none"
            style={{ left:-12, top:'50%', transform:'translateY(-50%)', width:4, height:22,
              borderRadius:'0 4px 4px 0', background:'linear-gradient(180deg,#FF8A6E,#FF6B5C)' }} />
        )}
        <div className="w-7 h-7 rounded-[9px] flex items-center justify-center flex-none"
          style={active
            ? { background:'rgba(255,255,255,0.12)', color:'#FF6B5C' }
            : { background:'rgba(255,255,255,0.06)', color:'rgba(231,241,238,0.55)' }
          }>
          <Icon size={14} strokeWidth={active ? 2.5 : 1.8} />
        </div>
        <span className="flex-1 leading-none">{label}</span>
        {badge !== undefined && badge > 0 && (
          <div className="text-[10.5px] font-extrabold min-w-[20px] h-5 rounded-[7px] flex items-center justify-center px-[5px]"
            style={{ background:'#FF6B5C', color:'#fff', boxShadow:'0 2px 6px rgba(255,107,92,0.30)' }}>
            {badge}
          </div>
        )}
      </Link>
    )
  }

  // ── Mobile sidebar NavItem ──
  function MobileNavItem({ href, icon: Icon, label, amber, tourId }: {
    href: string; icon: React.ElementType; label: string; amber?: boolean; tourId?: string
  }) {
    const active = isActive(href)
    const color = amber
      ? (active ? '#E5B87A'   : 'rgba(196,154,108,0.72)')
      : (active ? '#FFFFFF'   : 'rgba(231,241,238,0.62)')
    const iconColor = active ? '#FF6B5C' : color
    return (
      <Link href={href} onClick={() => { if (!tourActive) setMobileSidebarOpen(false) }}
        data-tour={tourId}
        style={{ display:'flex', flexDirection:'row', alignItems:'center',
          gap:12, height:48, padding:'0 16px', position:'relative',
          textDecoration:'none', flexShrink:0 }}>
        {active && (
          <span style={{ position:'absolute', left:0, top:'50%', transform:'translateY(-50%)',
            width:4, height:28, borderRadius:'0 4px 4px 0',
            background: amber
              ? 'linear-gradient(180deg,#C49A6C,#E5B87A)'
              : 'linear-gradient(180deg,#FF8A6E,#FF6B5C)' }} />
        )}
        <span style={{ width:32, height:32, borderRadius:10, flexShrink:0,
          display:'flex', alignItems:'center', justifyContent:'center',
          background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)' }}>
          <Icon size={17} strokeWidth={active ? 2.5 : 1.8} color={iconColor} />
        </span>
        <span style={{ fontSize:14, fontWeight: active ? 700 : 500,
          color, letterSpacing:'0.01em', lineHeight:1 }}>{label}</span>
      </Link>
    )
  }

  // ── Desktop Configurações sub-panel item ──
  function CfgPanelItem({ href, label, icon: Icon, badge, external }: {
    href: string; label: string; icon: React.ElementType; badge?: string; external?: boolean
  }) {
    return (
      <Link href={href} onClick={() => setCfgPanelOpen(false)}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        onMouseEnter={cfgEnter} onMouseLeave={cfgLeave}
        style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 12px',
          borderRadius:9, textDecoration:'none', color:'rgba(231,241,238,0.82)',
          fontSize:12.5, fontWeight:500 }}
        className="hover:bg-white/[0.06]">
        <Icon size={13} strokeWidth={1.8} style={{ flexShrink:0 }} />
        <span style={{ flex:1 }}>{label}</span>
        {badge && (
          <span style={{ fontSize:9.5, fontWeight:700, background:'rgba(255,255,255,0.14)',
            color:'rgba(231,241,238,0.7)', padding:'1px 6px', borderRadius:5 }}>
            {badge}
          </span>
        )}
      </Link>
    )
  }

  return (
    <div className="min-h-screen relative overflow-x-hidden">

      {/* ══ APP WRAP ══ */}
      <div ref={appRef} className="app-wrap flex min-h-screen overflow-x-hidden" data-dark={darkMode ? '1' : undefined}>

        {/* ══ SIDEBAR (desktop only) ══ */}
        <aside className="hidden md:flex flex-col w-[256px] flex-shrink-0 fixed z-40"
          style={{
            height:'100vh', top:0, left:0, overflow:'hidden',
            backgroundImage:'linear-gradient(165deg,#10403A 0%,#08221F 72%)',
            borderRight:'1px solid rgba(255,255,255,0.08)',
            boxShadow:'4px 0 24px rgba(0,0,0,0.18)',
          }}>

          {/* Logo */}
          <div style={{ flexShrink:0, padding:'18px 14px 16px', borderBottom:'1px solid rgba(255,255,255,0.10)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:11 }}>
              <img src="/brand/icone-coral.svg" alt="" style={{ width:50, height:50, flex:'0 0 auto', display:'block' }} />
              <img src="/brand/logotipo-escuro.svg" alt="Família em Dia" style={{ flex:'1 1 auto', minWidth:0, width:'100%', height:'auto', display:'block' }} />
            </div>
          </div>

          {/* Nav — compact, no overflow so all items always visible */}
          <nav style={{ flex:1, minHeight:0, padding:'10px 12px', overflowY:'hidden' }}>
            <div style={{ marginBottom:10 }}>
              <SectionLabel>Principal</SectionLabel>
              <NavItem href="/dashboard"  label="Início"    icon={LayoutDashboard} />
              <NavItem href="/calendario" label="Agenda"    icon={CalendarDays} />
              <NavItem href="/logistica"  label="Logística" icon={Car} badge={pendingLogisticsCount} />
            </div>
            <div style={{ marginBottom:10 }}>
              <SectionLabel>Rotina</SectionLabel>
              <NavItem href="/escola"     label="Escola"     icon={BookOpen} />
              <NavItem href="/saude"      label="Saúde"      icon={HeartPulse} />
              <NavItem href="/atividades" label="Atividades" icon={Trophy} />
            </div>
            <div style={{ marginBottom:10 }}>
              <SectionLabel>Administrativo</SectionLabel>
              <NavItem href="/vault"         label="Documentos"   icon={FolderLock} />
              <NavItem href="/mensalidades"  label="Mensalidades" icon={Wallet} />
            </div>
            <div>
              <SectionLabel>Gerenciar</SectionLabel>
              {/* "Meus Filhos" existia só no menu do celular — no desktop o
                  caminho era o painel do rodapé, que ninguém adivinha. */}
              {/* Sem tourId: `nav-children` já marca o painel de Filhos no
                  rodapé, e dois elementos com o mesmo data-tour fariam o tour
                  apontar para o primeiro do DOM. */}
              <NavItem href="/children"      label="Meus Filhos"        icon={Users} />
              <NavItem href="/configuracoes" label="Compartilhar Acesso" icon={UserPlus} tourId="nav-invite" />
            </div>
          </nav>

          {/* Bottom section: Filhos + Configurações + Sair */}
          <div style={{ flexShrink:0, borderTop:'1px solid rgba(255,255,255,0.10)', display:'flex', flexDirection:'column' }}>

            {/* Filhos — scrollable */}
            <div data-tour="nav-children" style={{ padding:'8px 12px 4px', overflowY:'auto', maxHeight:160 }}>
              {/* Sem link de gerenciar: o caminho é o item "Meus Filhos" no
                  bloco Gerenciar. Este painel é vitrine de quem está
                  cadastrado — dois caminhos para a mesma tela deixavam a
                  navegação frouxa. */}
              <div style={{ padding:'0 8px 7px' }}>
                <span style={{ fontSize:10, fontWeight:800, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(231,241,238,0.5)' }}>Filhos</span>
              </div>
              {liveChildren.length === 0 ? (
                <Link href="/children">
                  <div className="flex items-center gap-2.5 transition-all hover:opacity-80"
                    style={{ padding:'9px 12px', borderRadius:12, border:'1.5px dashed rgba(255,255,255,0.22)',
                      color:'rgba(231,241,238,0.6)', fontSize:12.5, fontWeight:600 }}>
                    <Users size={14} color="rgba(231,241,238,0.6)" />
                    Cadastrar primeiro filho
                  </div>
                </Link>
              ) : (
                <div style={{ display:'flex', flexWrap:'wrap', gap:12, padding:'2px 4px' }}>
                  {liveChildren.map(child => (
                    <Link key={child.id} href="/children"
                      title={child.name}
                      className="transition-transform duration-150 hover:-translate-y-0.5"
                      style={{ width:48, textAlign:'center', textDecoration:'none' }}>
                      <div style={{ width:40, margin:'0 auto' }}>
                        <ChildAvatar child={{ ...child, avatar_url: child.avatar_url ?? null }} size={40} radius={20} />
                      </div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#E7F1EE', marginTop:4, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {child.name}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Configurações hover trigger */}
            <div style={{ padding:'0 12px 4px', borderTop:'1px solid rgba(255,255,255,0.08)' }}>
              <button
                onMouseEnter={cfgEnter}
                onMouseLeave={cfgLeave}
                style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'7px 10px',
                  borderRadius:11, background:'none', border:'none', cursor:'pointer',
                  color:'rgba(231,241,238,0.72)', fontSize:14, fontWeight:500 }}
                className="hover:bg-white/[0.06]">
                <div style={{ width:28, height:28, borderRadius:9, display:'flex', alignItems:'center',
                  justifyContent:'center', background:'rgba(255,255,255,0.06)', color:'rgba(231,241,238,0.55)', flexShrink:0 }}>
                  <Settings size={14} strokeWidth={1.8} />
                </div>
                <span style={{ flex:1, textAlign:'left' }}>Configurações</span>
                <ChevronRight size={13} style={{ opacity:0.5, color:'#E7F1EE' }} />
              </button>
            </div>

            {/* Sair + Tweaks */}
            <div style={{ padding:'2px 12px 10px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <button onClick={handleLogout}
                className="transition-all hover:bg-white/[0.06] rounded-[8px]"
                style={{ fontSize:11, fontWeight:500, color:'rgba(231,241,238,0.45)', padding:'6px 10px', background:'none', border:'none', cursor:'pointer' }}>
                Sair da conta
              </button>
              <button onClick={() => setDesktopTweaksOpen(true)}
                title="Personalizar tema"
                className="transition-all hover:bg-white/[0.10] rounded-[9px]"
                style={{ width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center',
                  background:'rgba(255,255,255,0.08)', border:'none', cursor:'pointer', flexShrink:0 }}>
                <Palette size={14} color="rgba(231,241,238,0.6)" />
              </button>
            </div>
          </div>

        </aside>

        {/* ══ MAIN ══ */}
        <main className="flex-1 min-w-0 md:ml-[256px] musgo-bg relative z-[1] flex flex-col main-container overflow-x-hidden md:h-screen md:overflow-y-auto"
          style={{ paddingBottom:'env(safe-area-inset-bottom, 0px)' }}>

          {/* ── Mobile topbar: [hambúrguer] [logo] [IA] ── */}
          <div className="md:hidden flex items-center justify-between px-3 sticky top-0 z-30 flex-shrink-0"
            style={{ background:'rgba(248,243,234,0.94)', backdropFilter:'blur(18px)',
              borderBottom:'1px solid rgba(61,102,65,0.12)', height:56 }}>

            {/* Hambúrguer */}
            <button
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Abrir menu"
              style={{ width:36, height:36, background:'rgba(61,102,65,0.10)', borderRadius:10,
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4,
                border:'none', cursor:'pointer', flexShrink:0 }}>
              <span style={{ width:15, height:1.8, background:'#2C4A2E', borderRadius:2, display:'block' }} />
              <span style={{ width:15, height:1.8, background:'#2C4A2E', borderRadius:2, display:'block' }} />
              <span style={{ width:15, height:1.8, background:'#2C4A2E', borderRadius:2, display:'block' }} />
            </button>

            {/* Notificações (sino) */}
            <div ref={notifRef} className="relative">
              <button
                onClick={() => { setNotifOpen(o => !o); if (!notifOpen) markAllRead() }}
                style={{ width:36, height:36, borderRadius:10, border:'none', cursor:'pointer', flexShrink:0, position:'relative',
                  background: unreadCount > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(61,102,65,0.10)',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Bell size={16} color={unreadCount > 0 ? '#D97706' : 'rgba(44,74,46,0.55)'} />
                {unreadCount > 0 && (
                  <span style={{ position:'absolute', top:-3, right:-3, minWidth:16, height:16, borderRadius:8,
                    background:'#D97706', color:'#fff', fontSize:9, fontWeight:800,
                    display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px' }}>
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Notif dropdown */}
              {notifOpen && (
                <div className="rounded-2xl shadow-xl z-50"
                  style={{ position:'fixed', top:60, right:8, left:8, maxWidth:360, margin:'0 auto', maxHeight:'70vh', overflowY:'auto',
                    background:'linear-gradient(160deg,#FFFFFF,#F8F3EA)',
                    border:'1px solid rgba(61,102,65,0.18)',
                    boxShadow:'0 8px 32px rgba(44,74,46,0.18)' }}>
                  <div className="flex items-center justify-between px-4 py-3"
                    style={{ borderBottom:'1px solid rgba(61,102,65,0.10)' }}>
                    <span style={{ fontSize:13, fontWeight:700, color:'#1A2B1C' }}>Notificações</span>
                    <Link href="/logistica" onClick={() => setNotifOpen(false)}
                      style={{ fontSize:11, fontWeight:700, color:'#2D6A35', textDecoration:'none' }}>
                      Ver logística →
                    </Link>
                  </div>
                  {pendingLogisticsCount > 0 && (
                    <div className="flex items-center gap-2 px-4 py-3"
                      style={{ background:'rgba(245,158,11,0.06)', borderBottom:'1px solid rgba(245,158,11,0.15)' }}>
                      <Clock size={13} color="#D97706" />
                      <span style={{ fontSize:12, color:'#92400E', fontWeight:600 }}>
                        {pendingLogisticsCount} sugestão{pendingLogisticsCount > 1 ? 'ões' : ''} de logística aguardando sua resposta
                      </span>
                    </div>
                  )}
                  {notifications.length === 0 && pendingLogisticsCount === 0 && (
                    <div style={{ padding:'24px 16px', textAlign:'center', fontSize:12, color:'rgba(26,43,28,0.40)', fontStyle:'italic' }}>
                      Nenhuma notificação
                    </div>
                  )}
                  {notifications.map(n => (
                    <div key={n.id} className="flex items-start gap-3 px-4 py-3"
                      style={{ borderBottom:'1px solid rgba(61,102,65,0.07)',
                        background: n.read ? 'transparent' : 'rgba(245,158,11,0.04)' }}>
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize:12, color:'#1A2B1C', lineHeight:1.4 }}>{notifLabel(n)}</p>
                        <p style={{ fontSize:10, color:'rgba(26,43,28,0.40)', marginTop:2 }}>
                          {new Date(n.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                        </p>
                      </div>
                      {!n.read && <div style={{ width:7, height:7, borderRadius:'50%', background:'#D97706', flexShrink:0, marginTop:4 }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Captura IA */}
            <Link href="/ia" data-tour="nav-ia">
              <div className="flex items-center gap-1.5 rounded-[13px] px-3"
                style={{ height:36, background:'linear-gradient(140deg,#FF8A6E,#FF6B5C)', boxShadow:'0 4px 14px rgba(255,107,92,0.34)' }}>
                <Sparkles size={13} color="#fff" />
                <span style={{ fontSize:12, fontWeight:700, color:'#fff', whiteSpace:'nowrap' }}>Captura IA</span>
              </div>
            </Link>
          </div>

          {children}
        </main>

      </div>{/* end app-wrap */}

      {/* ══════════════════════════════════════════════════════════════
          Siblings of app-wrap — CSS filter applied manually via refs
          ═══════════════════════════════════════════════════════════ */}

      {/* ── Desktop Configurações floating sub-panel (fora do app-wrap para position:fixed correto) ── */}
      {cfgPanelOpen && (
        <div
          ref={cfgPanelRef}
          onMouseEnter={cfgEnter}
          onMouseLeave={cfgLeave}
          style={{
            position:'fixed', left:256, bottom:50, zIndex:60,
            width:216,
            backgroundImage:'linear-gradient(165deg,#10403A 0%,#08221F 72%)',
            borderRadius:14,
            border:'1px solid rgba(255,255,255,0.10)',
            boxShadow:'4px 4px 28px rgba(0,0,0,0.30)',
            padding:'10px 6px',
          }}>
          <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase',
            color:'rgba(231,241,238,0.5)', padding:'2px 12px 4px' }}>Conta</div>
          <CfgPanelItem href="/conta"   label="Minha Conta" icon={UserCog} />
          <CfgPanelItem href="/planos"  label="Planos"      icon={Star} />
          <CfgPanelItem href="/alertas" label="Alertas"     icon={Bell} badge="WhatsApp" />
          <div style={{ height:1, background:'rgba(255,255,255,0.10)', margin:'6px 8px' }} />
          <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase',
            color:'rgba(231,241,238,0.5)', padding:'2px 12px 4px' }}>Ajuda</div>
          <CfgPanelItem href="/suporte" label="Suporte"  icon={Headphones} />
          <CfgPanelItem href="/faq"     label="FAQ"      icon={HelpCircle} />
          <div style={{ height:1, background:'rgba(255,255,255,0.10)', margin:'6px 8px' }} />
          <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase',
            color:'rgba(231,241,238,0.5)', padding:'2px 12px 4px' }}>Legal</div>
          <CfgPanelItem href="/termos"      label="Termos de Uso" icon={FileText} />
          <CfgPanelItem href="/privacidade" label="Privacidade"   icon={Shield} />
          <div style={{ height:1, background:'rgba(255,255,255,0.10)', margin:'6px 8px' }} />
          <div style={{ fontSize:10, fontWeight:800, letterSpacing:'0.14em', textTransform:'uppercase',
            color:'rgba(231,241,238,0.5)', padding:'2px 12px 4px' }}>Sobre</div>
          <CfgPanelItem href="https://www.familiaemdia.com.br/marketing/Landing-Familia-em-Dia-P6-IA.html" label="Site" icon={ExternalLink} external />
        </div>
      )}

      {/* ── Mobile sidebar overlay ── */}
      <div
        className="md:hidden fixed inset-0 z-[70]"
        onClick={() => setMobileSidebarOpen(false)}
        style={{
          background:'rgba(10,20,12,0.50)',
          opacity: mobileSidebarOpen ? 1 : 0,
          pointerEvents: mobileSidebarOpen ? 'auto' : 'none',
          transition:'opacity 0.22s ease',
        }}
      />

      {/* ── Mobile sidebar — 230px, slide-in via hambúrguer ── */}
      <div
        ref={navRef}
        className="md:hidden fixed top-0 left-0 bottom-0 z-[75]"
        style={{
          width:230,
          background:'linear-gradient(165deg,#10403A 0%,#08221F 72%)',
          borderRight:'1px solid rgba(255,255,255,0.08)',
          boxShadow:'6px 0 28px rgba(10,20,12,0.38)',
          transform: mobileSidebarOpen ? 'translateX(0)' : 'translateX(-230px)',
          transition:'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
          display:'flex',
          flexDirection:'column',
          paddingTop:'env(safe-area-inset-top, 0px)',
          paddingBottom:'env(safe-area-inset-bottom, 0px)',
        }}>

        {/* Logo + fechar */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'14px 16px 12px', borderBottom:'1px solid rgba(91,143,94,0.14)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, flex:1, minWidth:0 }}>
            <img src="/brand/icone-coral.svg" alt="" style={{ width:44, height:44, flex:'0 0 auto', display:'block' }} />
            <img src="/brand/logotipo-escuro.svg" alt="Família em Dia" style={{ flex:'1 1 auto', minWidth:0, width:'100%', height:'auto', display:'block' }} />
          </div>
          <button onClick={() => setMobileSidebarOpen(false)}
            style={{ width:30, height:30, borderRadius:8, border:'none', cursor:'pointer',
              background:'rgba(255,255,255,0.07)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <X size={15} color="rgba(180,220,185,0.60)" />
          </button>
        </div>

        {/* Main nav items */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-start', gap:0, padding:'8px 0 4px' }}>
          <MobileNavItem href="/dashboard"  icon={LayoutDashboard} label="Início"     />
          <MobileNavItem href="/calendario" icon={CalendarDays}    label="Agenda"     />
          <MobileNavItem href="/logistica"  icon={Car}             label="Logística"  />

          <div style={{ height:1, background:'rgba(91,143,94,0.18)', margin:'6px 16px' }} />

          <MobileNavItem href="/escola"     icon={BookOpen}        label="Escola"     />
          <MobileNavItem href="/saude"      icon={HeartPulse}      label="Saúde"      />
          <MobileNavItem href="/atividades" icon={Trophy}          label="Atividades" />

          <div style={{ height:1, background:'rgba(91,143,94,0.18)', margin:'6px 16px' }} />

          {/* Administrativo — mesmos blocos do desktop, para o menu não
              ensinar uma organização e a sidebar outra. */}
          <MobileNavItem href="/vault"        icon={FolderLock} label="Documentos"   />
          <MobileNavItem href="/mensalidades" icon={Wallet}     label="Mensalidades" />

          <div style={{ height:1, background:'rgba(91,143,94,0.18)', margin:'6px 16px' }} />

          <MobileNavItem href="/children"      icon={Users}    label="Meus Filhos"        tourId="nav-children" />
          <MobileNavItem href="/configuracoes" icon={UserPlus} label="Compartilhar Acesso" tourId="nav-invite" />
        </div>

        {/* Footer: Configurações → /settings + Sair */}
        <div style={{ flexShrink:0, borderTop:'1px solid rgba(91,143,94,0.18)', paddingBottom:8 }}>
          <Link href="/settings"
            onClick={() => setMobileSidebarOpen(false)}
            style={{ display:'flex', alignItems:'center', gap:12, height:48, padding:'0 16px',
              textDecoration:'none', flexShrink:0 }}>
            <span style={{ width:32, height:32, borderRadius:10, flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center',
              background:'rgba(255,255,255,0.07)' }}>
              <Settings size={17} strokeWidth={1.8} color="rgba(180,220,185,0.65)" />
            </span>
            <span style={{ fontSize:14, fontWeight:500, color:'rgba(180,220,185,0.65)', flex:1 }}>Configurações</span>
            <ChevronRight size={14} color="rgba(180,220,185,0.35)" />
          </Link>
          <button
            onClick={() => { setMobileSidebarOpen(false); handleLogout() }}
            style={{ display:'flex', flexDirection:'row', alignItems:'center',
              gap:12, height:48, padding:'0 16px', width:'100%',
              background:'none', border:'none', cursor:'pointer', flexShrink:0 }}>
            <span style={{ width:32, height:32, borderRadius:10, flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center',
              background:'rgba(255,255,255,0.05)' }}>
              <LogOut size={17} strokeWidth={1.8} color="rgba(196,154,108,0.72)" />
            </span>
            <span style={{ fontSize:14, fontWeight:500, color:'rgba(196,154,108,0.72)' }}>Sair da conta</span>
          </button>
        </div>

      </div>

      {/* ── Toasts globais (fora do app-wrap: cores fiéis em qualquer tema) ── */}
      <Toaster />

      {/* ── Desktop TWEAKS overlay (conditional render — no Tailwind responsive needed) ── */}
      {desktopTweaksOpen && (
        <div style={{ position:'fixed', inset:0, zIndex:58, background:'rgba(10,20,12,0.30)', backdropFilter:'blur(2px)' }}
          onClick={() => setDesktopTweaksOpen(false)} />
      )}

      {/* ── Desktop TWEAKS panel (always in DOM, slides in/out via transform) ── */}
      <div style={{
          position:'fixed', zIndex:59, top:0, right:0, bottom:0,
          display:'flex', flexDirection:'column',
          width:300,
          transform: desktopTweaksOpen ? 'translateX(0)' : 'translateX(100%)',
          transition:'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
          background: panelBg,
          backgroundSize: darkMode ? 'auto' : '200px 200px, 100% 100%',
          borderLeft:`1px solid ${panelBorder}`,
          boxShadow: darkMode ? '-8px 0 32px rgba(0,0,0,0.50)' : '-8px 0 32px rgba(44,74,46,0.20)',
        }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 20px 16px',
          borderBottom:`1px solid ${panelBorder}` }}>
          <div style={{ display:'flex', alignItems:'center', gap:8,
            fontFamily:'var(--font-lora)', fontSize:16, fontWeight:600, color:panelText }}>
            <Palette size={15} color={darkMode ? '#8CC891' : '#3D6641'} />
            Personalizar Tema
          </div>
          <button onClick={() => setDesktopTweaksOpen(false)}
            style={{ width:28, height:28, borderRadius:8, border:'none', background:'rgba(61,102,65,0.09)',
              display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
            <X size={14} color={panelMuted} />
          </button>
        </div>
        {/* Content */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px' }}>
          {/* Paleta */}
          <div style={{ marginBottom:24 }}>
            <div style={{ fontSize:11, fontWeight:700, marginBottom:12, color:panelMuted, textTransform:'uppercase', letterSpacing:'0.10em' }}>
              Paleta de cor
            </div>
            <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:8 }}>
              {PALETTES.map((p, i) => (
                <button key={p.name} title={p.name} onClick={() => setPalIdx(i)}
                  style={{
                    width:40, height:40, borderRadius:13, background:p.dot, cursor:'pointer',
                    boxShadow: palIdx===i ? '0 4px 14px rgba(0,0,0,0.35)' : '0 2px 8px rgba(44,74,46,0.12)',
                    border: palIdx===i ? '2.5px solid rgba(255,255,255,0.50)' : '2px solid transparent',
                    transform: palIdx===i ? 'scale(1.18)' : undefined,
                    transition:'all .2s',
                  }} />
              ))}
            </div>
            <div style={{ fontSize:12, fontStyle:'italic', color:panelMuted }}>{PALETTES[palIdx].name}</div>
          </div>
          {/* Dark mode */}
          <div style={{ paddingTop:18, borderTop:`1px solid ${panelBorder}` }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ fontSize:14, fontWeight:700, display:'flex', alignItems:'center', gap:8, color:panelText }}>
                {darkMode ? <Moon size={16}/> : <Sun size={16}/>}
                {darkMode ? 'Modo noturno' : 'Modo claro'}
              </div>
              <button onClick={() => setDarkMode(d => !d)}
                style={{ position:'relative', width:48, height:26, borderRadius:13, border:'none', cursor:'pointer',
                  background: darkMode ? 'linear-gradient(135deg,#3D6641,#2C4A2E)' : 'rgba(61,102,65,0.22)',
                  boxShadow:'0 1px 4px rgba(0,0,0,0.15)', flexShrink:0, transition:'background .25s' }}>
                <span style={{ position:'absolute', top:3, width:20, height:20, borderRadius:'50%', background:'white',
                  boxShadow:'0 2px 5px rgba(0,0,0,0.25)',
                  left: darkMode ? 25 : 3, transition:'left .3s cubic-bezier(.4,0,.2,1)' }} />
              </button>
            </div>
            <p style={{ fontSize:11.5, color:panelMuted, marginTop:6 }}>
              {darkMode ? 'Cores invertidas para uso noturno' : 'Cores naturais do aplicativo'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Mobile TEMA floating button ── */}
      <button
        className="mobile-tema-btn fixed z-[55] md:hidden"
        onClick={() => setMobileTemaOpen(true)}
        style={{
          bottom:20, right:16,
          width:44, height:44, borderRadius:'50%',
          background: darkMode
            ? 'rgba(80,130,84,0.28)'
            : 'linear-gradient(140deg,#2C4A2E,#1E3320)',
          backdropFilter:'blur(12px)',
          boxShadow: darkMode
            ? '0 4px 16px rgba(0,0,0,0.40), 0 0 0 1px rgba(90,140,94,0.30)'
            : '0 4px 16px rgba(44,74,46,0.35)',
          border: darkMode ? '1.5px solid rgba(90,140,94,0.35)' : '1.5px solid rgba(255,255,255,0.12)',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
        <SlidersHorizontal size={18} color={darkMode ? '#A8D4AB' : '#D4E8D5'} />
      </button>

      {/* ── Mobile TEMA sheet ── */}
      {mobileTemaOpen && (
        <>
          <div className="md:hidden fixed inset-0 z-[80]"
            style={{ background:'rgba(10,20,11,0.55)', backdropFilter:'blur(4px)' }}
            onClick={() => setMobileTemaOpen(false)} />
          <div className="md:hidden fixed left-0 right-0 z-[90] animate-slide-up"
            style={{
              bottom:0,
              borderRadius:'20px 20px 0 0',
              background:panelBg,
              backgroundSize: darkMode ? 'auto' : '200px 200px, 100% 100%',
              border:`1px solid ${panelBorder}`,
              boxShadow: darkMode
                ? '0 -8px 32px rgba(0,0,0,0.50)'
                : '0 -8px 32px rgba(44,74,46,0.20)',
              padding:'16px 24px 28px',
            }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom:16 }}>
              <div style={{ width:36, height:4, borderRadius:2, background: darkMode ? 'rgba(140,200,145,0.30)' : 'rgba(61,102,65,0.28)' }} />
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:20,
              fontFamily:'var(--font-lora)', fontSize:16, fontWeight:600, color:panelText }}>
              <Palette size={15} color={darkMode ? '#8CC891' : '#3D6641'} /> Personalizar Tema
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, marginBottom:10, color:panelMuted }}>Paleta de cor</div>
              <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                {PALETTES.map((p, i) => (
                  <button key={p.name} title={p.name} onClick={() => setPalIdx(i)}
                    style={{
                      width:36, height:36, borderRadius:12, background:p.dot, cursor:'pointer',
                      boxShadow: palIdx===i ? '0 4px 14px rgba(0,0,0,0.35)' : '0 2px 8px rgba(44,74,46,0.12)',
                      border: palIdx===i ? '2.5px solid rgba(255,255,255,0.50)' : '2px solid transparent',
                      transform: palIdx===i ? 'scale(1.18)' : undefined,
                      transition:'all .2s',
                    }} />
                ))}
              </div>
              <div style={{ fontSize:11, fontStyle:'italic', marginTop:8, color:panelMuted }}>{PALETTES[palIdx].name}</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop:12, borderTop:`1px solid ${panelBorder}` }}>
              <div style={{ fontSize:14, fontWeight:700, display:'flex', alignItems:'center', gap:8, color:panelMuted }}>
                {darkMode ? <Moon size={16}/> : <Sun size={16}/>}
                {darkMode ? 'Modo noturno' : 'Modo claro'}
              </div>
              <button onClick={() => setDarkMode(d => !d)}
                style={{ position:'relative', width:48, height:26, borderRadius:13, border:'none', cursor:'pointer',
                  background: darkMode ? 'linear-gradient(135deg,#3D6641,#2C4A2E)' : 'rgba(61,102,65,0.22)',
                  boxShadow:'0 1px 4px rgba(0,0,0,0.15)', flexShrink:0, transition:'background .25s' }}>
                <span style={{ position:'absolute', top:3, width:20, height:20, borderRadius:'50%', background:'white',
                  boxShadow:'0 2px 5px rgba(0,0,0,0.25)',
                  left: darkMode ? 25 : 3, transition:'left .3s cubic-bezier(.4,0,.2,1)' }} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Tour overlay — guia onboarding ── */}
      <TourOverlay />

    </div>
  )
}
