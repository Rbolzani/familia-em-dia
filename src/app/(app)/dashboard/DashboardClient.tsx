'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import {
  BookOpen, HeartPulse, Trophy, Sparkles,
  SunMedium, MapPin,
  ChevronLeft, ChevronRight,
  CalendarCheck, CalendarRange, Stethoscope,
  StickyNote, Plus, Trash2, Check, Syringe, Pencil, Loader2, AlertTriangle, FileWarning,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { ActivityQuickEdit, useActivityDelete } from '@/components/activities/ActivityQuickEdit'
import { toast } from '@/components/ui/Toast'
import { Activity, Child, SCHOOL_KINDS_APARTE, type SchoolKind } from '@/lib/types'
import { mergeActivities } from '@/lib/merge-activities'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { useAccess } from '@/components/access/AccessContext'
import type { ImportantAlert } from './page'
import { getVaultCategory } from '@/lib/vault'

// ── Types ──────────────────────────────────────────────────────────────────
type ActWithChild = Activity & { child: { name: string; avatar_color: string } }

interface Props {
  userName: string
  children: Child[]
  todayClasses:       ActWithChild[]  // rotina de aulas de hoje (escola/aula)
  todayActivities:    ActWithChild[]  // demais atividades de hoje (sem aulas)
  upcomingActivities: ActWithChild[]
  monthActivities:    ActWithChild[]   // full month — for mini-calendar dots + click detail
  reminders:          ActWithChild[]  // activities with no date
  importantAlerts:    ImportantAlert[]  // vencimentos de documentos do Cofre
}

// ── Textures ───────────────────────────────────────────────────────────────
const NOISE    = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.065'/%3E%3C/svg%3E")`
const NOISE_SM = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='150' height='150' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E")`

const STAT: React.CSSProperties = {
  borderRadius: '20px 13px 18px 15px',
  padding: '22px 20px',
  cursor: 'pointer',
  position: 'relative',
  overflow: 'hidden',
  background: `${NOISE}, linear-gradient(160deg,#FFFFFF 0%,#F7F2EA 100%)`,
  backgroundSize: '200px 200px, 100% 100%',
  border: '1px solid rgba(61,102,65,0.18)',
  boxShadow: '0 6px 22px rgba(44,74,46,0.11),0 2px 6px rgba(44,74,46,0.07),0 -1px 0 rgba(255,255,255,0.95) inset,0 1px 0 rgba(0,0,0,0.035) inset,inset 1px 0 rgba(255,255,255,0.55),inset -1px 0 rgba(0,0,0,0.022)',
  transition: 'transform 0.25s, box-shadow 0.25s',
}
const ACT: React.CSSProperties = {
  borderRadius: '17px 11px 15px 13px',
  padding: '15px 18px',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  marginBottom: 10,
  cursor: 'pointer',
  position: 'relative',
  overflow: 'hidden',
  background: `${NOISE}, linear-gradient(160deg,#FFFFFF 0%,#FAFAF7 100%)`,
  backgroundSize: '200px 200px, 100% 100%',
  border: '1px solid rgba(61,102,65,0.18)',
  boxShadow: '0 2px 10px rgba(44,74,46,0.09),0 -1px 0 rgba(255,255,255,0.95) inset,0 1px 0 rgba(0,0,0,0.03) inset,inset 1px 0 rgba(255,255,255,0.55)',
  transition: 'transform 0.22s, box-shadow 0.22s',
}
const MINI_CAL: React.CSSProperties = {
  borderRadius: '20px 13px 18px 15px',
  padding: 22,
  border: '1px solid rgba(61,102,65,0.22)',
  background: `${NOISE}, linear-gradient(155deg,#FFFFFF 0%,#F8F3EA 100%)`,
  backgroundSize: '200px 200px, 100% 100%',
  boxShadow: '0 6px 20px rgba(44,74,46,0.12),0 1px 4px rgba(44,74,46,0.08),0 -1px 0 rgba(255,255,255,0.85) inset,0 1px 0 rgba(0,0,0,0.04) inset',
}

// ── Category config ────────────────────────────────────────────────────────
type CatKey = 'escola'|'saude'|'extracurricular'
const CAT: Record<CatKey,{bar:string;barGlow:string;ibg:string;icolor:string;icon:React.ElementType;label:string}> = {
  escola:          { bar:'#3B82F6', barGlow:'rgba(59,130,246,0.35)', ibg:'linear-gradient(140deg,#DBEAFE,#BFDBFE)', icolor:'#2563EB', icon:BookOpen,    label:'Escola'         },
  saude:           { bar:'#3D6641', barGlow:'rgba(61,102,65,0.35)',  ibg:'linear-gradient(140deg,#D1FAE5,#A7F3D0)', icolor:'#065F46', icon:Stethoscope, label:'Saúde'          },
  extracurricular: { bar:'#C49A6C', barGlow:'rgba(196,154,108,0.35)',ibg:'linear-gradient(140deg,#FEF3C7,#FDE68A)', icolor:'#92400E', icon:Trophy,      label:'Extracurricular' },
}

function greet() {
  const h=new Date().getHours()
  return h<12?'Bom dia':h<18?'Boa tarde':'Boa noite'
}
function fmtDate() {
  return format(new Date(),"EEEE, d 'de' MMMM 'de' yyyy",{locale:ptBR}).replace(/^\w/,c=>c.toUpperCase())
}
function SectionH({ children }: { children: React.ReactNode }) {
  // flex-wrap + min-w-0: títulos longos com selo ("Alertas Importantes · 3
  // vencidos") formavam uma linha indivisível que empurrava a largura da
  // coluna no mobile. Fonte menor no celular pelo mesmo motivo.
  return (
    <div className="flex items-center gap-2 md:gap-3 mb-4 flex-wrap min-w-0 text-[18px] md:text-[22px]"
      style={{ fontFamily:'var(--font-lora)', fontWeight:600, color:'#1A2B1C' }}>
      {children}
      <span className="flex-1 h-[2px] rounded" style={{ background:'linear-gradient(90deg,rgba(61,102,65,0.22),transparent)', minWidth:20 }}/>
    </div>
  )
}

// Subcomponente para o botão de excluir do mini-calendário: useActivityDelete
// é um hook e não pode ser chamado dentro do .map da lista de atividades.
function MiniCalDeleteButton({ ids, title, onDeleted }: {
  ids: string[]; title: string; onDeleted: () => void
}) {
  const { deleting, remove } = useActivityDelete(onDeleted)
  return (
    <button onClick={()=>remove(ids, title)} disabled={deleting} title="Excluir atividade"
      className="w-6 h-6 rounded-[8px] flex items-center justify-center transition-all"
      style={{ background:'rgba(220,38,38,0.08)', border:'1px solid rgba(220,38,38,0.16)', color: deleting?'rgba(220,38,38,0.40)':'#DC2626' }}>
      {deleting ? <Loader2 size={11} className="animate-spin"/> : <Trash2 size={11}/>}
    </button>
  )
}

// ── Mini Calendar ──────────────────────────────────────────────────────────
function MiniCalendar({ activitiesByDate: initialByDate, canEdit, onChanged }: {
  activitiesByDate: Record<string, ActWithChild[]>; canEdit: boolean; onChanged: () => void
}) {
  const supabase = createClient()
  const today=new Date()
  const [yr,setYr]=useState(today.getFullYear())
  const [mo,setMo]=useState(today.getMonth())
  const [selected,setSelected]=useState<string|null>(null)
  const [editingId,setEditingId]=useState<string|null>(null)
  // Cache of fetched months — key = "yyyy-MM", value = activitiesByDate for that month
  const [cache, setCache]=useState<Record<string, Record<string, ActWithChild[]>>>({
    [`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`]: initialByDate,
  })
  // Bump após uma edição: zera o cache e força o refetch do mês. Mais simples
  // e correto que remendar o cache na mão, já que a atividade pode ter mudado
  // de data (sai de um dia, entra em outro).
  const [reloadKey,setReloadKey]=useState(0)

  const monthKey=`${yr}-${String(mo+1).padStart(2,'0')}`
  const activitiesByDate = cache[monthKey] ?? {}

  function afterEdit() {
    setEditingId(null)
    setCache({})
    setReloadKey(k => k + 1)
    onChanged()
  }

  // Fetch when navigating to an uncached month
  useEffect(() => {
    if (cache[monthKey]) return
    const moStart=`${yr}-${String(mo+1).padStart(2,'0')}-01`
    const moEnd=`${yr}-${String(mo+1).padStart(2,'0')}-${new Date(yr,mo+1,0).getDate()}`
    supabase.from('activities')
      .select('*, child:children(name, avatar_color)')
      .gte('date', moStart).lte('date', moEnd)
      .neq('status', 'cancelado')
      .order('date').order('time', { nullsFirst: false })
      .then(({ data }) => {
        const byDate = (data ?? []).reduce<Record<string, ActWithChild[]>>((acc, a) => {
          if (!a.date) return acc
          // Rotina de aulas e provas não pontuam o calendário — mesmo critério
          // aplicado no servidor ao mês inicial (ver dashboard/page.tsx).
          if (a.category === 'escola' && SCHOOL_KINDS_APARTE.includes(a.school_kind as SchoolKind)) return acc
          if (!acc[a.date]) acc[a.date] = []
          acc[a.date].push(a as ActWithChild)
          return acc
        }, {})
        setCache(prev => ({ ...prev, [monthKey]: byDate }))
      })
  }, [yr, mo, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function prev() { if(mo===0){setMo(11);setYr(y=>y-1)}else setMo(m=>m-1); setSelected(null) }
  function next() { if(mo===11){setMo(0);setYr(y=>y+1)}else setMo(m=>m+1); setSelected(null) }

  const monthLabel=format(new Date(yr,mo,1),'MMMM yyyy',{locale:ptBR}).replace(/^\w/,c=>c.toUpperCase())
  const firstDow=new Date(yr,mo,1).getDay()
  const lastDay=new Date(yr,mo+1,0).getDate()
  const prevLast=new Date(yr,mo,0).getDate()

  type Cell={d:number;ds:string;type:'prev'|'curr'|'next';isToday:boolean;hasEvent:boolean}
  const cells:Cell[]=[]
  for(let i=firstDow-1;i>=0;i--) cells.push({d:prevLast-i,ds:'',type:'prev',isToday:false,hasEvent:false})
  for(let d=1;d<=lastDay;d++){
    const ds=`${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const isT=today.getFullYear()===yr&&today.getMonth()===mo&&today.getDate()===d
    cells.push({d,ds,type:'curr',isToday:isT,hasEvent:!!activitiesByDate[ds]?.length})
  }
  while(cells.length<42) cells.push({d:cells.filter(c=>c.type==='next').length+1,ds:'',type:'next',isToday:false,hasEvent:false})

  const selectedActs = selected ? (activitiesByDate[selected] ?? []) : []
  const catIcon: Record<string,string> = { escola:'📚', saude:'🩺', extracurricular:'🏆' }

  return (
    <div style={MINI_CAL}>
      <div className="flex items-center justify-between mb-[18px]">
        <div style={{ fontFamily:'var(--font-lora)', fontSize:18, fontWeight:600, color:'#1A2B1C' }}>{monthLabel}</div>
        <div className="flex gap-[7px]">
          {[{fn:prev,I:ChevronLeft},{fn:next,I:ChevronRight}].map(({fn,I},i)=>(
            <button key={i} onClick={fn} className="w-[30px] h-[30px] rounded-[10px] flex items-center justify-center transition-all"
              style={{ background:'rgba(255,255,255,0.70)', border:'1px solid rgba(61,102,65,0.22)', boxShadow:'0 2px 8px rgba(44,74,46,0.10),0 -1px 0 rgba(255,255,255,0.80) inset', color:'rgba(26,43,28,0.58)' }}>
              <I size={13}/>
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-[2px] text-center mb-[2px]">
        {['D','S','T','Q','Q','S','S'].map((d,i)=>(
          <div key={i} style={{ fontSize:10, fontWeight:800, color:'rgba(26,43,28,0.36)', padding:'4px 0', letterSpacing:'0.06em', textTransform:'uppercase' }}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[2px]">
        {cells.map((cell,i)=>{
          const isSelected=selected===cell.ds&&cell.type==='curr'
          return (
            <div key={i}
              onClick={()=>{
                if(cell.type!=='curr'||!cell.hasEvent) return
                setSelected(s=>s===cell.ds?null:cell.ds)
              }}
              className="relative flex items-center justify-center rounded-[10px] transition-all"
              style={{ aspectRatio:'1', fontSize:12.5,
                fontWeight:cell.isToday?800:500,
                cursor:cell.hasEvent&&cell.type==='curr'?'pointer':'default',
                color:cell.isToday?'white':isSelected?'#3D6641':cell.type!=='curr'?'rgba(26,43,28,0.25)':'rgba(26,43,28,0.58)',
                background:cell.isToday?'linear-gradient(140deg,#1E5C4C,#14463A)':isSelected?'rgba(20,70,58,0.12)':undefined,
                boxShadow:cell.isToday?'0 3px 10px rgba(44,74,46,0.35),0 -1px 0 rgba(255,255,255,0.18) inset':undefined,
                outline:isSelected?'2px solid rgba(61,102,65,0.40)':'none',
              }}>
              {cell.d}
              {cell.hasEvent&&!cell.isToday&&(
                <span className="absolute bottom-[2px] left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                  style={{ background:isSelected?'#3D6641':'#C49A6C' }}/>
              )}
            </div>
          )
        })}
      </div>

      {/* Day detail panel */}
      {selected && selectedActs.length > 0 && (
        <div className="mt-4 pt-4" style={{ borderTop:'1px solid rgba(61,102,65,0.12)' }}>
          <div className="flex items-center justify-between mb-2">
            <p style={{ fontSize:12, fontWeight:700, color:'#1A2B1C' }}>
              {format(new Date(selected+'T00:00:00'),"d 'de' MMMM",{locale:ptBR}).replace(/^\w/,c=>c.toUpperCase())}
            </p>
            <span style={{ fontSize:11, color:'rgba(26,43,28,0.40)' }}>{selectedActs.length} atividade{selectedActs.length>1?'s':''}</span>
          </div>
          <div className="space-y-2">
            {mergeActivities(selectedActs).map((group, gi)=>{
              const a = group[0]
              if (editingId === a.id) {
                return (
                  <div key={a.id} className="p-2 rounded-[10px]"
                    style={{ background:'rgba(61,102,65,0.06)', border:'1px solid rgba(61,102,65,0.22)' }}>
                    <ActivityQuickEdit
                      ids={group.map(item => item.id)}
                      initial={{ title:a.title, date:a.date ?? null, time:a.time?.slice(0,5) ?? null, location:a.location ?? null }}
                      onDone={() => setEditingId(null)}
                      onSaved={afterEdit}
                    />
                  </div>
                )
              }
              return (
                <div key={a.id} className="flex items-center gap-2 p-2 rounded-[10px] group"
                  style={{ background:'rgba(61,102,65,0.06)', border:'1px solid rgba(61,102,65,0.10)' }}>
                  <span style={{ fontSize:14 }}>{catIcon[a.category]??'📅'}</span>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize:12, fontWeight:600, color:'#1A2B1C', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{a.title}</p>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:2 }}>
                      {group.map(item => item.child && (
                        <span key={item.id} style={{ fontSize:10, fontWeight:700, color:'white', background:item.child.avatar_color,
                          padding:'1px 7px', borderRadius:99, display:'inline-block' }}>
                          {item.child.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  {a.time && <span style={{ fontSize:11, color:'rgba(26,43,28,0.45)', flexShrink:0 }}>{a.time.slice(0,5)}</span>}
                  {canEdit && (
                    <div className="flex-none flex gap-1 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                      <button onClick={()=>setEditingId(a.id)} title="Editar atividade"
                        className="w-6 h-6 rounded-[8px] flex items-center justify-center transition-all"
                        style={{ background:'rgba(61,102,65,0.10)', border:'1px solid rgba(61,102,65,0.18)', color:'#3D6641' }}>
                        <Pencil size={11}/>
                      </button>
                      <MiniCalDeleteButton ids={group.map(item=>item.id)} title={a.title} onDeleted={afterEdit}/>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}


// ── Activity Row ───────────────────────────────────────────────────────────
function ActivityRow({ activities, canEdit, onChanged }: {
  activities: ActWithChild[]; canEdit: boolean; onChanged: () => void
}) {
  const activity = activities[0]
  const cat    = CAT[activity.category as CatKey]??CAT.escola
  const todayDs= format(new Date(), 'yyyy-MM-dd')
  const overdue= activity.status==='pendente'&&!!activity.date&&activity.date<todayDs
  const [editing, setEditing] = useState(false)
  const { deleting, remove } = useActivityDelete(onChanged)

  const dateLabel = activity.date
    ? format(new Date(activity.date+'T00:00:00'), "EEE, dd/MM", {locale:ptBR}).replace(/^\w/,c=>c.toUpperCase())
    : 'Sem data'

  // Em edição o card sai de dentro do <Link> — senão qualquer clique nos
  // campos navegaria para a página da categoria.
  if (editing) {
    return (
      <div style={{ ...ACT, alignItems:'stretch', cursor:'default' }}>
        <div className="absolute pointer-events-none"
          style={{ left:0, top:10, bottom:10, width:4, borderRadius:'0 4px 4px 0', background:cat.bar, boxShadow:`0 0 6px ${cat.barGlow}` }}/>
        <div className="flex-1 min-w-0">
          <ActivityQuickEdit
            ids={activities.map(a => a.id)}
            initial={{ title:activity.title, date:activity.date ?? null, time:activity.time?.slice(0,5) ?? null, location:activity.location ?? null }}
            onDone={() => setEditing(false)}
            onSaved={onChanged}
          />
        </div>
      </div>
    )
  }

  return (
    <Link href={`/${activity.category==='escola'?'escola':activity.category==='saude'?'saude':'atividades'}`}>
      <div style={ACT} className="group"
        onMouseEnter={e=>{const el=e.currentTarget as HTMLElement;el.style.transform='translateX(5px) rotate(0.25deg)';el.style.boxShadow='0 6px 20px rgba(44,74,46,0.12),0 1px 4px rgba(44,74,46,0.08),0 -1px 0 rgba(255,255,255,0.90) inset,0 1px 0 rgba(0,0,0,0.04) inset'}}
        onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.transform='';el.style.boxShadow=''}}>

        <div className="absolute pointer-events-none"
          style={{ left:0, top:10, bottom:10, width:4, borderRadius:'0 4px 4px 0', background:cat.bar, boxShadow:`0 0 6px ${cat.barGlow}` }}/>

        <div className="w-9 h-9 rounded-[11px] flex items-center justify-center flex-none"
          style={{ backgroundImage:cat.ibg, border:'1px solid rgba(0,0,0,0.07)', boxShadow:'0 1px 4px rgba(0,0,0,0.09),0 -1px 0 rgba(255,255,255,0.55) inset' }}>
          <cat.icon size={16} color={cat.icolor} strokeWidth={2}/>
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-bold" style={{ fontSize:14, color:'#1A2B1C', lineHeight:1.3 }}>{activity.title}</div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* All children badges (merged) */}
            {activities.map(a => a.child && (
              <span key={a.id} className="text-[11px] font-extrabold px-2.5 py-[3px] rounded-full text-white flex-shrink-0"
                style={{ background:a.child.avatar_color, boxShadow:`0 2px 6px ${a.child.avatar_color}55` }}>
                {a.child.name}
              </span>
            ))}
            <span className="text-[11px] font-bold px-2.5 py-[3px] rounded-full flex-shrink-0"
              style={{
                background:'rgba(255,255,255,0.75)',
                color:overdue?'#DC2626':'rgba(26,43,28,0.52)',
                border:`1px solid ${overdue?'rgba(220,38,38,0.22)':'rgba(61,102,65,0.18)'}`,
                boxShadow:'0 1px 4px rgba(44,74,46,0.08)',
              }}>
              {overdue ? '⚠ Atrasado' : activity.time ? `${activity.time.slice(0,5)} · ${dateLabel}` : dateLabel}
            </span>
            {activity.location && (
              <span className="text-[11px] italic flex items-center gap-1 truncate" style={{ color:'rgba(26,43,28,0.38)' }}>
                <MapPin size={10}/> {activity.location}
              </span>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex-none flex flex-col gap-1 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); setEditing(true) }}
              title="Editar atividade"
              className="w-7 h-7 rounded-[9px] flex items-center justify-center transition-all"
              style={{ background:'rgba(61,102,65,0.08)', border:'1px solid rgba(61,102,65,0.18)', color:'#3D6641' }}>
              <Pencil size={12}/>
            </button>
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); remove(activities.map(a=>a.id), activity.title) }}
              disabled={deleting}
              title="Excluir atividade"
              className="w-7 h-7 rounded-[9px] flex items-center justify-center transition-all"
              style={{ background:'rgba(220,38,38,0.08)', border:'1px solid rgba(220,38,38,0.16)', color: deleting?'rgba(220,38,38,0.40)':'#DC2626' }}>
              {deleting ? <Loader2 size={12} className="animate-spin"/> : <Trash2 size={12}/>}
            </button>
          </div>
        )}
      </div>
    </Link>
  )
}

// ── Reminders Panel ────────────────────────────────────────────────────────
const REMINDER_CAT: Record<string,{icon:string;color:string}> = {
  escola:          { icon:'📚', color:'#2563EB' },
  saude:           { icon:'🩺', color:'#065F46' },
  extracurricular: { icon:'🏆', color:'#92400E' },
}

function RemindersPanel({ initial, allChildren }: { initial: ActWithChild[]; allChildren: Child[] }) {
  const supabase = createClient()
  const { canEdit } = useAccess()
  const [items, setItems] = useState<ActWithChild[]>(initial)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [childId, setChildId] = useState(allChildren[0]?.id ?? '')
  const [category, setCategory] = useState<'escola'|'saude'|'extracurricular'>('escola')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string|null>(null)
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  // Reidrata quando as props mudam (realtime / router.refresh), sem atropelar
  // uma edição em andamento.
  useEffect(() => { if (!editingId) setItems(initial) }, [initial, editingId])

  async function handleAdd() {
    if (!text.trim() || !childId) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('activities').insert({
      user_id: user!.id, child_id: childId,
      category, title: text.trim(),
      date: null, alert_days: 0, ai_generated: false,
    }).select('*, child:children(name, avatar_color)').single()
    if (data) setItems(prev => [data as ActWithChild, ...prev])
    setText(''); setSaving(false); setAdding(false)
  }

  async function handleDone(id: string) {
    await supabase.from('activities').delete().eq('id', id)
    setItems(prev => prev.filter(x => x.id !== id))
  }

  // Lembrete é uma atividade sem data — só o título faz sentido editar aqui
  // (data/horário/local viriam a reboque e o transformariam em compromisso).
  async function handleRename(id: string) {
    const title = editText.trim()
    if (!title) { toast('O título não pode ficar vazio.', 'error'); return }
    setSavingEdit(true)
    const { error } = await supabase.from('activities').update({ title }).eq('id', id)
    setSavingEdit(false)
    if (error) { toast('Não foi possível salvar. Tente novamente.', 'error'); return }
    setItems(prev => prev.map(x => (x.id === id ? { ...x, title } : x)))
    setEditingId(null)
    toast('Lembrete atualizado ✓')
  }

  function startEdit(item: ActWithChild) {
    setEditingId(item.id)
    setEditText(item.title)
  }

  // Cara de quadro de cortiça: fundo terroso texturizado e sombra "para
  // dentro", como se os papéis estivessem presos numa superfície com
  // profundidade — em vez de mais um card branco igual aos outros.
  // Fundo liso. A sombra interna é o que dá a leitura de "superfície com
  // profundidade" em que os papéis estão presos — a textura de cortiça foi
  // testada e descartada por poluir visualmente.
  const PANEL: React.CSSProperties = {
    borderRadius: '20px 13px 18px 15px',
    border: '1px solid rgba(146,64,14,0.24)',
    background: '#E3CDA6',
    boxShadow: 'inset 0 2px 14px rgba(110,64,14,0.24), inset 0 -1px 0 rgba(255,255,255,0.25), 0 4px 18px rgba(44,74,46,0.12)',
    padding: '14px 12px',
  }

  return (
    <div style={PANEL}>
      {/* Sem título aqui: quem nomeia o bloco é o SectionH "Mural de
          Lembretes" logo acima — repetir seria redundante. Sobra só a
          contagem e o botão de adicionar. */}
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em]"
          style={{ color:'rgba(120,72,20,0.65)' }}>
          {items.length > 0 ? `${items.length} lembrete${items.length !== 1 ? 's' : ''}` : 'tudo em dia'}
        </span>
        {canEdit && (
          <button
            onClick={() => setAdding(a => !a)}
            title="Adicionar lembrete"
            className="w-7 h-7 rounded-[9px] flex items-center justify-center transition-all hover:scale-110"
            style={{ background:'rgba(255,255,255,0.75)', color: adding ? '#DC2626' : '#7A4A12', border:'1px solid rgba(120,72,20,0.20)', boxShadow:'0 1px 3px rgba(120,72,20,0.20)' }}>
            <Plus size={14} style={{ transform: adding ? 'rotate(45deg)' : 'none', transition:'transform .2s' }}/>
          </button>
        )}
      </div>

      {/* Quick-add form */}
      {adding && (
        <div className="mb-3 p-2.5 rounded-[13px] space-y-2"
          style={{ background:'rgba(61,102,65,0.05)', border:'1px solid rgba(61,102,65,0.14)' }}>
          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key==='Enter') handleAdd(); if (e.key==='Escape') setAdding(false) }}
            placeholder="Ex: Agendar consulta, levar documento..."
            className="w-full text-[13px] outline-none bg-transparent"
            style={{ color:'#1A2B1C' }}
          />
          <select value={category} onChange={e => setCategory(e.target.value as typeof category)}
            className="text-[11px] font-semibold border rounded-[9px] px-2 py-1 outline-none w-full"
            style={{ borderColor:'rgba(61,102,65,0.22)', background:'white', color:'#1A2B1C' }}>
            <option value="escola">📚 Escola</option>
            <option value="saude">🩺 Saúde</option>
            <option value="extracurricular">🏆 Atividade</option>
          </select>
          {allChildren.length > 1 && (
            <select value={childId} onChange={e => setChildId(e.target.value)}
              className="text-[11px] font-semibold border rounded-[9px] px-2 py-1 outline-none w-full"
              style={{ borderColor:'rgba(61,102,65,0.22)', background:'white', color:'#1A2B1C' }}>
              {allChildren.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button onClick={handleAdd} disabled={saving || !text.trim()}
            className="w-full py-1.5 rounded-[9px] text-[12px] font-bold transition-all disabled:opacity-50"
            style={{ background:'linear-gradient(140deg,#FF8A6E,#FF6B5C)', color:'#fff' }}>
            {saving ? 'Salvando...' : 'Adicionar'}
          </button>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !adding && (
        <div className="text-center py-6 rounded-[12px]"
          style={{ background:'rgba(255,255,255,0.35)', border:'1px dashed rgba(120,72,20,0.28)' }}>
          <div className="text-2xl mb-1">✅</div>
          <p className="text-[12px] italic" style={{ color:'rgba(90,55,15,0.65)' }}>
            Mural vazio.<br/>Nenhum lembrete pendente!
          </p>
        </div>
      )}

      {/* List */}
      <div className="space-y-2.5">
        {items.map((item, idx) => {
          const cat = REMINDER_CAT[item.category] ?? REMINDER_CAT.escola

          if (editingId === item.id) {
            return (
              <div key={item.id} className="p-2 rounded-[11px] space-y-1.5"
                style={{ background:'rgba(255,255,255,0.85)', border:'1px solid rgba(61,102,65,0.24)' }}>
                <input
                  value={editText} autoFocus
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => { if (e.key==='Enter') handleRename(item.id); if (e.key==='Escape') setEditingId(null) }}
                  className="w-full text-[12.5px] font-semibold outline-none rounded-[8px] px-2 py-1"
                  style={{ color:'#1A2B1C', background:'white', border:'1px solid rgba(61,102,65,0.28)' }}
                />
                <div className="flex gap-1.5">
                  <button onClick={() => handleRename(item.id)} disabled={savingEdit}
                    className="flex-1 flex items-center justify-center gap-1 py-1 rounded-[8px] text-[11px] font-bold transition-all disabled:opacity-60"
                    style={{ background:'linear-gradient(140deg,#3D6641,#2C4A2E)', color:'#fff' }}>
                    {savingEdit ? <Loader2 size={11} className="animate-spin"/> : <Check size={11} strokeWidth={3}/>}
                    {savingEdit ? 'Salvando...' : 'Salvar'}
                  </button>
                  <button onClick={() => setEditingId(null)} disabled={savingEdit}
                    className="px-2.5 py-1 rounded-[8px] text-[11px] font-bold transition-all disabled:opacity-60"
                    style={{ background:'rgba(26,43,28,0.06)', color:'rgba(26,43,28,0.55)', border:'1px solid rgba(61,102,65,0.16)' }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )
          }

          // Cada lembrete é um papelzinho preso no mural: leve inclinação
          // alternada e sombra projetada, para não parecer uma lista comum.
          const tilt = (idx % 3 === 0 ? -0.7 : idx % 3 === 1 ? 0.5 : -0.3)
          return (
            <div key={item.id} className="flex items-start gap-2.5 group p-2.5 relative transition-transform hover:!rotate-0 hover:-translate-y-[1px]"
              style={{ background:'linear-gradient(160deg,#FFFEF8 0%,#FFF8E3 100%)',
                border:'1px solid rgba(120,72,20,0.14)', borderRadius:'3px 10px 4px 9px',
                boxShadow:'0 2px 6px rgba(90,55,15,0.20), 0 1px 0 rgba(255,255,255,0.70) inset',
                transform:`rotate(${tilt}deg)` }}>
              {/* Alfinete */}
              <span aria-hidden className="absolute rounded-full"
                style={{ top:-3, left:'50%', width:7, height:7, transform:'translateX(-50%)',
                  background:'radial-gradient(circle at 30% 30%, #F87171, #B91C1C)',
                  boxShadow:'0 1px 2px rgba(0,0,0,0.35)' }}/>
              {/* Done button */}
              {canEdit && (
                <button onClick={() => handleDone(item.id)}
                  className="mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-none transition-all hover:scale-110 group-hover:border-[#3D6641]"
                  style={{ borderColor:'rgba(61,102,65,0.28)', background:'transparent' }}
                  title="Marcar como concluído">
                  <Check size={10} color="#3D6641" style={{ opacity:0 }} className="group-hover:opacity-100 transition-opacity"/>
                </button>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold leading-snug" style={{ color:'#1A2B1C' }}>
                  {cat.icon} {item.title}
                </p>
                {item.child && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white mt-1 inline-block"
                    style={{ background: item.child.avatar_color }}>
                    {item.child.name}
                  </span>
                )}
              </div>

              {/* Editar / excluir */}
              {canEdit && (
                <div className="flex-none flex gap-1 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                  <button onClick={() => startEdit(item)} title="Editar lembrete"
                    className="w-6 h-6 rounded-[7px] flex items-center justify-center transition-all"
                    style={{ background:'rgba(61,102,65,0.10)', border:'1px solid rgba(61,102,65,0.18)', color:'#3D6641' }}>
                    <Pencil size={11}/>
                  </button>
                  <button onClick={() => handleDone(item.id)} title="Excluir lembrete"
                    className="w-6 h-6 rounded-[7px] flex items-center justify-center transition-all"
                    style={{ background:'rgba(220,38,38,0.10)', border:'1px solid rgba(220,38,38,0.16)', color:'#DC2626' }}>
                    <Trash2 size={11}/>
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer hint */}
      <p className="text-[10px] italic text-center mt-3" style={{ color:'rgba(90,55,15,0.50)' }}>
        Atividades sem data ficam aqui automaticamente
      </p>
    </div>
  )
}

// ── Alertas Importantes ────────────────────────────────────────────────────
// Vencimentos do Cofre (documentos + doses de vacina) já vencidos ou a vencer.
// Substitui o antigo painel só de vacinas: contrato, boleto e carteirinha
// vencendo importam tanto quanto uma dose atrasada.
function ImportantAlertsPanel({ alerts }: { alerts: ImportantAlert[] }) {
  if (!alerts.length) return null
  const vencidos = alerts.filter(a => a.status === 'vencido').length

  return (
    <div>
      <SectionH>
        <AlertTriangle size={18} color="#DC2626"/> Alertas
        {vencidos > 0 && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
            style={{ background:'rgba(220,38,38,0.10)', color:'#B91C1C' }}>
            {vencidos} vencido{vencidos !== 1 ? 's' : ''}
          </span>
        )}
      </SectionH>
      {/* min-w-0 aqui e no Link: `truncate` implica white-space:nowrap, então
          a min-content do título é o texto INTEIRO ("Alteração e Consolidação
          do Contrato Social..." = 443px). Sem cortar essa propagação, o
          painel exigia 578px numa tela de 412px e o layout estourava. */}
      <div className="space-y-2 min-w-0">
        {alerts.map((a, i) => {
          const cat = getVaultCategory(a.category)
          const Icon = cat?.icon ?? FileWarning
          const isVencido = a.status === 'vencido'
          const accent = isVencido ? '#DC2626' : '#D97706'
          const badgeBg = isVencido ? 'rgba(220,38,38,0.10)' : 'rgba(245,158,11,0.10)'
          const badgeColor = isVencido ? '#B91C1C' : '#92400E'
          const dias = Math.abs(a.daysLeft)
          const dayLabel = isVencido
            ? `Venceu há ${dias} dia${dias !== 1 ? 's' : ''}`
            : a.daysLeft === 0 ? 'Vence hoje!'
            : a.daysLeft === 1 ? 'Vence amanhã'
            : `Em ${a.daysLeft} dias`
          return (
            <Link key={`${a.documentId}-${i}`} href={`/vault/${a.category}/${a.documentId}`} className="block min-w-0">
              <div className="flex items-center gap-3 p-3 rounded-xl transition-all hover:brightness-95"
                style={{ background: isVencido ? 'rgba(220,38,38,0.04)' : 'rgba(245,158,11,0.05)', border:`1px solid ${accent}30` }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: badgeBg }}>
                  <Icon size={13} color={accent} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold truncate" style={{ color:'#1A2B1C' }}>{a.title}</p>
                  <p className="text-[11px] truncate" style={{ color:'rgba(26,43,28,0.50)' }}>
                    {[a.childName, cat?.label].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: badgeBg, color: badgeColor }}>
                  {dayLabel}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function DashboardClient({ userName, children, todayClasses, todayActivities, upcomingActivities, monthActivities, reminders, importantAlerts }: Props) {
  const router = useRouter()
  const { canEdit } = useAccess()
  // As listas vêm do Server Component; após uma edição, router.refresh() traz
  // props frescas e a tela reflete a mudança (inclusive troca de dia).
  const onChanged = () => router.refresh()

  // Group month activities by date for mini-calendar
  const activitiesByDate = monthActivities.reduce<Record<string, ActWithChild[]>>((acc, a) => {
    if (!a.date) return acc
    if (!acc[a.date]) acc[a.date] = []
    acc[a.date].push(a)
    return acc
  }, {})

  // As aulas têm card próprio; os contadores de atividades e dos próximos 7
  // dias já recebem as listas sem a rotina de aulas (filtradas no servidor).
  const stats = [
    { n:todayClasses.length,       label:'Aulas hoje',      short:'Aulas',      icon:BookOpen,      icolor:'#2563EB', ibg:'linear-gradient(140deg,#DBEAFE,#BFDBFE)', corner:'#3B82F6' },
    { n:todayActivities.length,    label:'Atividades hoje', short:'Atividades', icon:CalendarCheck, icolor:'#2563EB', ibg:'linear-gradient(140deg,#DBEAFE,#BFDBFE)', corner:'#2563EB' },
    { n:upcomingActivities.length, label:'Próximos 7 dias', short:'7 dias',     icon:CalendarRange, icolor:'#B45309', ibg:'linear-gradient(140deg,#FEF3C7,#FDE68A)', corner:'#C49A6C' },
    { n:reminders.length,          label:'Lembretes',       short:'Lembretes',  icon:StickyNote,    icolor:'#92400E', ibg:'linear-gradient(140deg,#FEF3C7,#FDE68A)', corner:'#C49A6C' },
  ]

  return (
    <div className="px-4 md:px-9 py-5 md:py-[34px] relative z-10 animate-fade-in max-w-full overflow-x-hidden">

      {/* Topbar */}
      <div className="flex items-start justify-between mb-6 md:mb-8">
        <div className="min-w-0">
          <div className="flex items-center gap-[7px] mb-[5px]"
            style={{ fontSize:'11px', fontWeight:700, letterSpacing:'0.13em', textTransform:'uppercase', color:'#5A8C5E' }}>
            <SunMedium size={13}/>
            <span className="md:hidden">{format(new Date(),"EEEE, d 'de' MMMM",{locale:ptBR}).replace(/^\w/,c=>c.toUpperCase())}</span>
            <span className="hidden md:inline">{fmtDate()}</span>
          </div>
          <h1 style={{ fontFamily:'var(--font-lora)', fontWeight:700, color:'#1A2B1C', lineHeight:1.1, letterSpacing:'-0.02em' }}
            className="text-[26px] md:text-[40px]">
            {greet()},<br/>
            <em style={{ fontStyle:'italic', background:'linear-gradient(120deg,#3D6641 30%,#C49A6C 100%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
              {userName}
            </em>
          </h1>
          <p className="mt-[5px] italic" style={{ fontSize:'13px', color:'rgba(26,43,28,0.36)' }}>
            A família em ordem, o coração em paz.
          </p>
        </div>
        <div className="topbar-actions flex gap-[10px] pt-1 flex-shrink-0">
          <Link href="/ia" data-tour="nav-ia">
            <button className="flex items-center gap-2 px-5 py-[11px] rounded-full text-[14px] font-bold transition-all hover:-translate-y-[2px]"
              style={{ background:'linear-gradient(140deg,#FF8A6E 0%,#FF6B5C 100%)', color:'#fff', boxShadow:'0 6px 20px rgba(255,107,92,0.34)' }}>
              <Sparkles size={15}/> Captura com IA
            </button>
          </Link>
        </div>
      </div>

      {/* Stats — 4 cards em uma única linha (mobile e desktop). No mobile o
          espaço por card fica ~80px, então padding, ícone, número e rótulo
          encolhem e o rótulo usa a versão curta para não quebrar linha. */}
      <div className="grid grid-cols-4 gap-[6px] md:gap-[14px] mb-5 md:mb-7">
        {stats.map((s,i)=>(
          <div key={i} style={{ ...STAT, padding:'10px 8px' }}
            className="md:p-[22px_20px]"
            onMouseEnter={e=>{const el=e.currentTarget as HTMLElement;el.style.transform='translateY(-4px) rotate(-0.4deg)';el.style.boxShadow='0 12px 36px rgba(44,74,46,0.14),0 2px 8px rgba(44,74,46,0.09),0 -1px 0 rgba(255,255,255,0.85) inset,0 1px 0 rgba(0,0,0,0.04) inset'}}
            onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.transform='';el.style.boxShadow=''}}>

            <div aria-hidden className="absolute pointer-events-none"
              style={{ top:-24, right:-24, width:80, height:80, borderRadius:'50%', background:s.corner, opacity:0.10 }}/>

            <div className="w-7 h-7 md:w-10 md:h-10 rounded-[9px] md:rounded-[13px] flex items-center justify-center mb-1.5 md:mb-4"
              style={{ backgroundImage:s.ibg, border:'1px solid rgba(0,0,0,0.06)', boxShadow:'0 1px 3px rgba(0,0,0,0.10),0 -1px 0 rgba(255,255,255,0.60) inset' }}>
              <s.icon size={13} color={s.icolor} strokeWidth={2}/>
            </div>
            <div style={{ fontFamily:'var(--font-lora)', lineHeight:1, color:'#1A2B1C' }} className="text-[21px] md:text-[40px] font-bold">{s.n}</div>
            <div style={{ color:'rgba(26,43,28,0.36)', fontWeight:500 }} className="text-[9px] md:text-[12.5px] mt-1 leading-tight">
              <span className="md:hidden">{s.short}</span>
              <span className="hidden md:inline">{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Two-column layout.
          min-w-0 no grid E nas duas colunas: sem isso o mínimo automático do
          grid (minmax(auto,1fr)) deixa o conteúdo empurrar a largura além da
          tela, e o overflow-x-hidden do container apenas corta o excesso —
          é a causa da "tela cortada à direita" no mobile. */}
      <div className="layout-cols grid gap-[18px] md:gap-[22px] min-w-0" style={{ gridTemplateColumns:'1fr 308px' }}>

        {/* Left */}
        <div className="min-w-0">
          <SectionH>Aulas de Hoje</SectionH>
          {todayClasses.length===0 ? (
            <div className="text-center py-6" style={{ ...STAT, display:'block', padding:20 }}>
              <p className="italic" style={{ fontSize:13.5, color:'rgba(26,43,28,0.45)' }}>Nenhuma aula hoje 🎒</p>
            </div>
          ) : (
            mergeActivities(todayClasses).map(g=><ActivityRow key={g[0].id} activities={g} canEdit={canEdit} onChanged={onChanged}/>)
          )}

          <div className="mt-5 md:mt-6">
            <SectionH>Atividades de Hoje</SectionH>
          </div>
          {todayActivities.length===0 ? (
            <div className="text-center py-8" style={{ ...STAT, display:'block', padding:28 }}>
              <div className="text-3xl mb-2">🎉</div>
              <p className="italic" style={{ fontSize:14, color:'rgba(26,43,28,0.50)' }}>Nenhuma atividade para hoje — aproveite!</p>
            </div>
          ) : (
            mergeActivities(todayActivities).map((g,i)=><ActivityRow key={g[0].id} activities={g} canEdit={canEdit} onChanged={onChanged}/>)
          )}

          {upcomingActivities.length>0&&(
            <div className="mt-5 md:mt-6">
              <SectionH>Próximos 7 dias</SectionH>
              {mergeActivities(upcomingActivities).map((g,i)=><ActivityRow key={g[0].id} activities={g} canEdit={canEdit} onChanged={onChanged}/>)}
            </div>
          )}
        </div>

        {/* Right */}
        <div className="space-y-[18px] md:space-y-[22px] min-w-0">
          <div>
            <SectionH>Calendário</SectionH>
            <MiniCalendar activitiesByDate={activitiesByDate} canEdit={canEdit} onChanged={onChanged}/>
          </div>
          <div>
            <SectionH>Mural de Lembretes</SectionH>
            <RemindersPanel initial={reminders} allChildren={children}/>
          </div>
          <ImportantAlertsPanel alerts={importantAlerts}/>
        </div>
      </div>

      <div className="md:hidden h-20"/>
    </div>
  )
}
