import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Landing.css'

// ─── Module data ─────────────────────────────────────────────────────────────
const MODULES = [
  {
    id: '01', label: 'ANOMALY INDEX', title: 'Anomaly Index',
    color: '#D2FF00',
    desc: 'Real-time statistical deviation detector scanning all 20+ Maharashtra zones for abnormal incident velocity. Z-score outliers are surfaced instantly — the first signal before a pattern solidifies.',
    stats: ['Z-SCORE ENGINE', '20+ ZONES', 'REAL-TIME'],
    visual: 'anomaly',
  },
  {
    id: '02', label: 'SPATIAL INTELLIGENCE', title: 'Crime Heat Map',
    color: '#FF6B35',
    desc: 'A live Leaflet map overlaid with AI-generated danger scores across every zone of Maharashtra. Velocity-weighted heatmap clusters update every 60 seconds using predictive output.',
    stats: ['LEAFLET MAP', 'VELOCITY WEIGHTED', '60s REFRESH'],
    visual: 'heatmap',
  },
  {
    id: '03', label: 'PREDICTIVE ENGINE', title: 'Neural Risk Nodes',
    color: '#5AC8FA',
    desc: 'A multi-factor LSTM model scoring each zone 0–100 for predicted incident probability in the next 6 hours. Trained on Maharashtra Police records, temporal patterns, and environmental factors.',
    stats: ['LSTM MODEL', '6-HOUR WINDOW', 'MULTI-FACTOR'],
    visual: 'neural',
  },
  {
    id: '04', label: 'LP OPTIMIZER', title: 'Force Allocator',
    color: '#BF5AF2',
    desc: 'Linear programming meets AI briefing. Solves a constrained optimisation problem across available personnel and threat zones, then uses Gemini to generate a plain-language tactical briefing.',
    stats: ['LINEAR PROG.', 'GEMINI AI', 'LIVE BRIEFING'],
    visual: 'allocator',
  },
  {
    id: '05', label: 'OPERATIONS CONTROL', title: 'Dispatch Board',
    color: '#FF9500',
    desc: 'A Kanban-style command board wired to the backend task queue. Pending alerts auto-create dispatch tasks. Officers acknowledge, escalate, and resolve in one click. Auto-refreshes every 15 seconds.',
    stats: ['KANBAN FLOW', '15s REFRESH', 'ONE-CLICK ACK'],
    visual: 'dispatch',
  },
  {
    id: '06', label: 'LIVE FEED ANALYSIS', title: 'Intel Stream',
    color: '#FF2D55',
    desc: 'A real-time scrolling feed of all crime events, alerts, and system notifications. Filterable by severity, zone, and time range. Delta polling means only new events are transferred — minimal bandwidth.',
    stats: ['DELTA POLLING', 'SEVERITY FILTER', 'ZONE FILTER'],
    visual: 'stream',
  },
  {
    id: '07', label: 'AI ASSISTANT', title: 'MahaCrime Copilot',
    color: '#34C759',
    desc: 'Conversational AI powered by Gemini 1.5 Pro with full context of the current city crime state. Ask anything — "What zones are critical right now?" — and get a data-backed response in natural language.',
    stats: ['GEMINI 1.5 PRO', 'CONTEXT-AWARE', 'NATURAL LANG.'],
    visual: 'copilot',
  },
  {
    id: '08', label: 'OFFENDER REGISTRY', title: 'OSINT Scanner',
    color: '#FF3B30',
    desc: 'Search and profile known offenders across the Maharashtra database. Cross-references arrest records, recidivism scores, and zone activity clusters. OSINT-enriched profiles surface social pattern data.',
    stats: ['PROFILE SEARCH', 'RECIDIVISM SCORE', 'ZONE ACTIVITY'],
    visual: 'osint',
  },
  {
    id: '09', label: 'COMMAND ANALYTICS', title: 'Stats Dashboard',
    color: '#D2FF00',
    desc: 'Executive view of system performance, alert resolution rates, zone response times, and AI prediction accuracy. Historical trend lines show whether crime is rising or falling and if response is improving.',
    stats: ['TREND LINES', 'RESOLUTION RATE', 'AI ACCURACY'],
    visual: 'stats',
  },
] as const

// ─── SVG mock-visuals ─────────────────────────────────────────────────────────
function ModuleVisual({ type, color }: { type: string; color: string }) {
  const c = color
  switch (type) {
    case 'anomaly': return (
      <svg viewBox="0 0 360 260" fill="none" className="mod-svg">
        <defs><filter id="g-a"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {[0,1,2,3,4].map(i=><line key={i} x1={i*90} y1="0" x2={i*90} y2="260" stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>)}
        {[0,1,2,3].map(i=><line key={i} x1="0" y1={i*86} x2="360" y2={i*86} stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>)}
        <polyline points="0,180 45,178 90,182 135,179 185,178 195,72 205,178 240,177 285,183 330,180 360,179" stroke={c} strokeWidth="2.5" fill="none" filter="url(#g-a)"/>
        <polygon points="185,178 195,72 205,178" fill={c} opacity="0.12"/>
        <circle cx="195" cy="72" r="6" fill={c} filter="url(#g-a)"/>
        <circle cx="195" cy="72" r="16" stroke={c} strokeWidth="1" fill="none" opacity="0.25"/>
        <text x="214" y="68" fill={c} fontSize="10" fontFamily="monospace" letterSpacing="2">ANOMALY DETECTED</text>
        <line x1="0" y1="130" x2="360" y2="130" stroke={c} strokeWidth="0.5" strokeDasharray="6 4" opacity="0.25"/>
        <text x="4" y="127" fill={c} fontSize="8" fontFamily="monospace" opacity="0.4">THRESHOLD</text>
        {['THANE','PUNE','MUMBAI','NAGPUR'].map((z,i)=>(
          <text key={z} x={i*90+6} y="254" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="monospace">{z}</text>
        ))}
      </svg>
    )
    case 'heatmap': return (
      <svg viewBox="0 0 360 260" fill="none" className="mod-svg">
        {[
          {x:60,y:40,w:55,h:44,v:0.9},{x:115,y:28,w:65,h:52,v:0.7},{x:180,y:18,w:60,h:48,v:0.4},
          {x:40,y:84,w:60,h:44,v:0.5},{x:100,y:82,w:70,h:48,v:1.0},{x:170,y:66,w:65,h:52,v:0.6},{x:235,y:55,w:54,h:50,v:0.3},
          {x:30,y:128,w:55,h:44,v:0.3},{x:85,y:130,w:65,h:44,v:0.7},{x:150,y:118,w:70,h:48,v:0.5},{x:220,y:105,w:60,h:52,v:0.8},
          {x:50,y:172,w:60,h:44,v:0.2},{x:110,y:175,w:65,h:40,v:0.4},{x:175,y:170,w:65,h:44,v:0.6},{x:240,y:158,w:55,h:48,v:0.9},
        ].map((cell,i)=>(
          <rect key={i} x={cell.x} y={cell.y} width={cell.w} height={cell.h} fill={c} opacity={cell.v*0.65} rx="2"/>
        ))}
        {[0,1,2,3].map(i=><line key={i} x1="0" y1={i*65+18} x2="360" y2={i*65+18} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>)}
        <circle cx="135" cy="106" r="24" stroke={c} strokeWidth="1.5" fill="none" opacity="0.9"/>
        <circle cx="135" cy="106" r="36" stroke={c} strokeWidth="0.5" fill="none" opacity="0.3"/>
        <circle cx="135" cy="106" r="5" fill={c}/>
        <text x="144" y="102" fill={c} fontSize="9" fontFamily="monospace" letterSpacing="1">CRITICAL</text>
        <text x="144" y="113" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="monospace">RISK 94</text>
      </svg>
    )
    case 'neural': return (
      <svg viewBox="0 0 360 260" fill="none" className="mod-svg">
        <defs><filter id="g-n"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {[50,100,150,200,210].map((y,i)=>(
          <g key={i}>
            <circle cx="50" cy={y} r="8" fill={c} opacity="0.7" filter="url(#g-n)"/>
            {[70,115,160,200].map((hy,j)=>(
              <line key={j} x1="58" y1={y} x2="172" y2={hy} stroke={c} strokeWidth="0.5" opacity="0.12"/>
            ))}
          </g>
        ))}
        {[70,115,160,200].map((y,i)=>(
          <g key={i}>
            <circle cx="180" cy={y} r="10" fill={c} opacity={i===1?1:0.5} filter={i===1?"url(#g-n)":undefined}/>
            {i===1 && <circle cx="180" cy={y} r="20" stroke={c} strokeWidth="0.5" fill="none" opacity="0.4"/>}
            {[90,145,200].map((oy,j)=>(
              <line key={j} x1="190" y1={y} x2="292" y2={oy} stroke={c} strokeWidth="0.5" opacity="0.12"/>
            ))}
          </g>
        ))}
        {[90,145,200].map((y,i)=>(
          <circle key={i} cx="300" cy={y} r="9" fill={c} opacity={[0.9,1,0.6][i]} filter="url(#g-n)"/>
        ))}
        <rect x="50" y="234" width="260" height="7" rx="3" fill="rgba(255,255,255,0.06)"/>
        <rect x="50" y="234" width="208" height="7" rx="3" fill={c} opacity="0.8"/>
        <text x="50" y="252" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="monospace">RISK SCORE</text>
        <text x="276" y="252" fill={c} fontSize="10" fontFamily="monospace" fontWeight="bold">80/100</text>
      </svg>
    )
    case 'allocator': return (
      <svg viewBox="0 0 360 260" fill="none" className="mod-svg">
        {[
          {zone:'MUMBAI',alloc:90,x:20},{zone:'THANE',alloc:65,x:75},{zone:'PUNE',alloc:45,x:130},
          {zone:'NAGPUR',alloc:78,x:185},{zone:'NASHIK',alloc:30,x:240},{zone:'AURD.',alloc:55,x:295},
        ].map(b=>(
          <g key={b.zone}>
            <rect x={b.x} y={220-b.alloc*1.9} width="40" height={b.alloc*1.9} fill={c} opacity="0.75" rx="2"/>
            <rect x={b.x} y={220-b.alloc*1.9} width="40" height="2" fill={c} rx="1"/>
            <text x={b.x+20} y="238" fill="rgba(255,255,255,0.3)" fontSize="6.5" fontFamily="monospace" textAnchor="middle">{b.zone.slice(0,3)}</text>
            <text x={b.x+20} y={220-b.alloc*1.9-6} fill={c} fontSize="9" fontFamily="monospace" textAnchor="middle">{b.alloc}</text>
          </g>
        ))}
        <line x1="15" y1="220" x2="345" y2="220" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
        <text x="15" y="16" fill="rgba(255,255,255,0.25)" fontSize="8" fontFamily="monospace">OPTIMAL FORCE ALLOCATION</text>
      </svg>
    )
    case 'dispatch': return (
      <svg viewBox="0 0 360 260" fill="none" className="mod-svg">
        {['PENDING','ACK','RESOLVED'].map((col,ci)=>(
          <g key={col}>
            <rect x={ci*120+8} y="16" width="108" height="14" fill="rgba(255,255,255,0.04)" rx="2"/>
            <text x={ci*120+62} y="27" fill="rgba(255,255,255,0.35)" fontSize="7" fontFamily="monospace" textAnchor="middle" letterSpacing="1">{col}</text>
            {[0,1,2].map(ri=>(
              <g key={ri}>
                <rect x={ci*120+8} y={38+ri*68} width="108" height="60" fill="rgba(255,255,255,0.03)" rx="3"
                  stroke={ci===0&&ri===0?c:'rgba(255,255,255,0.06)'} strokeWidth={ci===0&&ri===0?1:0.5}/>
                <rect x={ci*120+8} y={38+ri*68} width="4" height="60" fill={['#FF2D55','#FF9500','#34C759'][ci]} rx="1" opacity="0.8"/>
                <text x={ci*120+20} y={54+ri*68} fill="rgba(255,255,255,0.6)" fontSize="7" fontFamily="monospace">
                  {['THANE','PUNE','MUMBAI','NAGPUR','NASHIK','AURANG','KOLHAP','SANGLI','LATUR'][ci*3+ri]}
                </text>
                <text x={ci*120+20} y={65+ri*68} fill="rgba(255,255,255,0.25)" fontSize="6.5" fontFamily="monospace">MOBILE_PATROL</text>
                <rect x={ci*120+20} y={72+ri*68} width="34" height="10" fill={['#FF2D55','#FF9500','#34C759'][ci]} rx="1" opacity="0.7"/>
                <text x={ci*120+37} y={80+ri*68} fill="#000" fontSize="5.5" fontFamily="monospace" textAnchor="middle" fontWeight="bold">{['HIGH','CRIT','LOW'][ci]}</text>
              </g>
            ))}
          </g>
        ))}
      </svg>
    )
    case 'stream': return (
      <svg viewBox="0 0 360 260" fill="none" className="mod-svg">
        {[
          {t:'02:18:44',z:'THANE',s:'CRITICAL',msg:'Armed robbery — sector 4'},
          {t:'02:17:31',z:'MUMBAI',s:'HIGH',msg:'Vehicle pursuit — NH48'},
          {t:'02:16:22',z:'PUNE',s:'MEDIUM',msg:'Vandalism cluster — Camp'},
          {t:'02:15:09',z:'NAGPUR',s:'HIGH',msg:'Assault — Dharampeth'},
          {t:'02:14:55',z:'NASHIK',s:'LOW',msg:'Suspicious — depot area'},
        ].map((ev,i)=>(
          <g key={i}>
            <rect x="8" y={10+i*48} width="344" height="42" fill="rgba(255,255,255,0.02)" rx="3"
              stroke={i===0?c:'rgba(255,255,255,0.05)'} strokeWidth={i===0?0.8:0.5}/>
            <text x="20" y={28+i*48} fill="rgba(255,255,255,0.25)" fontSize="8" fontFamily="monospace">{ev.t}</text>
            <text x="84" y={28+i*48} fill="rgba(255,255,255,0.55)" fontSize="8" fontFamily="monospace">{ev.z}</text>
            <rect x="148" y={17+i*48} width="46" height="13" rx="2"
              fill={ev.s==='CRITICAL'?'#FF2D55':ev.s==='HIGH'?'#FF9500':ev.s==='MEDIUM'?c:'#34C759'} opacity="0.15"/>
            <text x="171" y={28+i*48} fontSize="7" fontFamily="monospace" textAnchor="middle" fontWeight="bold"
              fill={ev.s==='CRITICAL'?'#FF2D55':ev.s==='HIGH'?'#FF9500':ev.s==='MEDIUM'?c:'#34C759'}>{ev.s}</text>
            <text x="204" y={28+i*48} fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="monospace">{ev.msg}</text>
          </g>
        ))}
      </svg>
    )
    case 'copilot': return (
      <svg viewBox="0 0 360 260" fill="none" className="mod-svg">
        <rect x="70" y="10" width="220" height="44" rx="4" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5"/>
        <text x="88" y="28" fill="rgba(255,255,255,0.6)" fontSize="8" fontFamily="monospace">What zones are critical right now?</text>
        <text x="88" y="42" fill="rgba(255,255,255,0.3)" fontSize="7" fontFamily="monospace">— Commander Patil, 02:14</text>
        <rect x="20" y="68" width="270" height="76" rx="4" fill={c} fillOpacity="0.07" stroke={c} strokeWidth="0.5" strokeOpacity="0.4"/>
        <text x="36" y="86" fill={c} fontSize="8" fontFamily="monospace">SENTINEL COPILOT  ·  02:14:03</text>
        <text x="36" y="102" fill="rgba(255,255,255,0.65)" fontSize="8" fontFamily="monospace">3 zones flagged CRITICAL: Thane Sector 4,</text>
        <text x="36" y="116" fill="rgba(255,255,255,0.65)" fontSize="8" fontFamily="monospace">Mumbai Central, Nagpur East. Recommend</text>
        <text x="36" y="130" fill="rgba(255,255,255,0.65)" fontSize="8" fontFamily="monospace">immediate deployment to Thane first.</text>
        <rect x="90" y="160" width="200" height="32" rx="4" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>
        <text x="108" y="180" fill="rgba(255,255,255,0.5)" fontSize="8" fontFamily="monospace">Deploy 4 units to Thane Sector 4.</text>
        <rect x="20" y="208" width="68" height="28" rx="4" fill={c} fillOpacity="0.07" stroke={c} strokeWidth="0.4"/>
        {[0,1,2].map(i=><circle key={i} cx={36+i*16} cy="222" r="4" fill={c} opacity={0.4+i*0.2}/>)}
      </svg>
    )
    case 'osint': return (
      <svg viewBox="0 0 360 260" fill="none" className="mod-svg">
        <rect x="20" y="10" width="140" height="210" rx="4" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>
        <circle cx="90" cy="58" r="28" fill={c} fillOpacity="0.12" stroke={c} strokeWidth="0.8"/>
        <text x="90" y="66" fill={c} fontSize="22" textAnchor="middle">👤</text>
        <rect x="36" y="100" width="108" height="7" rx="2" fill="rgba(255,255,255,0.2)"/>
        <rect x="48" y="113" width="84" height="4" rx="2" fill="rgba(255,255,255,0.1)"/>
        {['RECIDIVISM: HIGH','ZONE: THANE','ARRESTS: 7','STATUS: ACTIVE'].map((l,i)=>(
          <g key={i}>
            <text x="36" y={132+i*19} fill="rgba(255,255,255,0.3)" fontSize="7.5" fontFamily="monospace">{l}</text>
            <line x1="36" y1={135+i*19} x2="148" y2={135+i*19} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>
          </g>
        ))}
        <circle cx="260" cy="90" r="12" fill={c} opacity="0.8"/>
        {[[210,56],[310,56],[210,136],[310,136],[260,172]].map(([cx,cy],i)=>(
          <g key={i}>
            <line x1="260" y1="90" x2={cx} y2={cy} stroke={c} strokeWidth="1" opacity="0.3"/>
            <circle cx={cx} cy={cy} r="7" fill={c} opacity="0.4"/>
          </g>
        ))}
        <text x="234" y="198" fill="rgba(255,255,255,0.2)" fontSize="8" fontFamily="monospace">NETWORK MAP</text>
      </svg>
    )
    case 'stats': return (
      <svg viewBox="0 0 360 260" fill="none" className="mod-svg">
        {[
          {label:'ALERTS RESOLVED',val:'94%'},{label:'AVG RESPONSE',val:'4.2m'},{label:'PRED. ACCURACY',val:'87%'}
        ].map((kpi,i)=>(
          <g key={i}>
            <rect x={i*122+8} y="8" width="110" height="52" rx="3" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>
            <text x={i*122+63} y="32" fill={c} fontSize="16" fontFamily="monospace" textAnchor="middle" fontWeight="bold">{kpi.val}</text>
            <text x={i*122+63} y="48" fill="rgba(255,255,255,0.3)" fontSize="6.5" fontFamily="monospace" textAnchor="middle" letterSpacing="0.5">{kpi.label}</text>
          </g>
        ))}
        <text x="8" y="88" fill="rgba(255,255,255,0.2)" fontSize="7.5" fontFamily="monospace" letterSpacing="1">7-DAY INCIDENT TREND</text>
        <polyline points="8,196 60,188 112,202 164,172 216,180 268,162 320,148 360,138" stroke={c} strokeWidth="2.5" fill="none"/>
        <polygon points="8,196 60,188 112,202 164,172 216,180 268,162 320,148 360,138 360,240 8,240" fill={c} opacity="0.06"/>
        <line x1="8" y1="240" x2="352" y2="240" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5"/>
        {['MON','TUE','WED','THU','FRI','SAT','SUN'].map((d,i)=>(
          <text key={d} x={8+i*51} y="253" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="monospace">{d}</text>
        ))}
      </svg>
    )
    default: return null
  }
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate()
  const [bootDone, setBootDone] = useState(false)
  const [loadPct, setLoadPct] = useState(0)
  const [typedTitle, setTypedTitle] = useState('')
  const [titleDone, setTitleDone] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const cursorDotRef = useRef<HTMLDivElement>(null)
  const cursorRingRef = useRef<HTMLDivElement>(null)

  // Boot sequence
  useEffect(() => {
    const word = 'SENTINEL'
    let i = 0
    const type = () => {
      setTypedTitle(word.slice(0, i + 1))
      i++
      if (i < word.length) setTimeout(type, 100)
      else {
        setTitleDone(true)
        let pct = 0
        const fill = () => {
          pct += Math.random() * 12 + 4
          if (pct >= 100) { setLoadPct(100); setTimeout(() => setBootDone(true), 500) }
          else { setLoadPct(pct); setTimeout(fill, 60 + Math.random() * 80) }
        }
        setTimeout(fill, 300)
      }
    }
    const t = setTimeout(type, 400)
    return () => clearTimeout(t)
  }, [])

  // Magnetic cursor
  useEffect(() => {
    const dot = cursorDotRef.current
    const ring = cursorRingRef.current
    if (!dot || !ring) return
    let mx = 0, my = 0, rx = 0, ry = 0
    let raf: number
    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      dot.style.transform = `translate(${mx}px,${my}px) translate(-50%,-50%)`
    }
    const tick = () => {
      rx += (mx - rx) * 0.12; ry += (my - ry) * 0.12
      ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`
      raf = requestAnimationFrame(tick)
    }
    const onEnter = () => ring.classList.add('cursor-mag')
    const onLeave = () => ring.classList.remove('cursor-mag')
    document.addEventListener('mousemove', onMove)
    document.querySelectorAll('button,a,[data-mag]').forEach(el => {
      el.addEventListener('mouseenter', onEnter)
      el.addEventListener('mouseleave', onLeave)
    })
    raf = requestAnimationFrame(tick)
    return () => { document.removeEventListener('mousemove', onMove); cancelAnimationFrame(raf) }
  }, [bootDone])

  // GSAP scroll reveals + active tracker
  useEffect(() => {
    if (!bootDone) return
    let cleanup: (() => void) | undefined
    const init = async () => {
      const gsap = (await import('gsap')).default
      const { ScrollTrigger } = await import('gsap/ScrollTrigger')
      gsap.registerPlugin(ScrollTrigger)

      document.querySelectorAll('.mod-section').forEach((section, i) => {
        const visual = section.querySelector('.mod-visual-half')
        const info   = section.querySelector('.mod-info-half')
        gsap.fromTo(visual, { opacity: 0, x: -40 }, {
          opacity: 1, x: 0, duration: 1, ease: 'expo.out',
          scrollTrigger: { trigger: section, start: 'top 80%', toggleActions: 'play none none none' }
        })
        gsap.fromTo(info, { opacity: 0, x: 40 }, {
          opacity: 1, x: 0, duration: 1, ease: 'expo.out',
          scrollTrigger: { trigger: section, start: 'top 80%', toggleActions: 'play none none none' }
        })
        ScrollTrigger.create({
          trigger: section, start: 'top 55%', end: 'bottom 55%',
          onEnter: () => setActiveIdx(i), onEnterBack: () => setActiveIdx(i),
        })
      })

      const hero = document.querySelector('.sl-hero')
      if (hero) gsap.to(hero, { opacity: 0, y: -60, scrollTrigger: { trigger: hero, start: 'top top', end: '60% top', scrub: true } })

      cleanup = () => ScrollTrigger.getAll().forEach(st => st.kill())
    }
    init()
    return () => cleanup?.()
  }, [bootDone])

  const enterDash = () => navigate('/dashboard')
  const activeColor = MODULES[activeIdx]?.color ?? '#D2FF00'

  return (
    <div className="sl-root">
      <div ref={cursorDotRef} className="sl-cursor-dot" aria-hidden="true" />
      <div ref={cursorRingRef} className="sl-cursor-ring" aria-hidden="true" />
      <div className="sl-grain" aria-hidden="true" />
      <div className="sl-ambient" style={{ '--ambient': activeColor } as React.CSSProperties} aria-hidden="true" />

      {/* ── BOOT SCREEN ── */}
      <div className={`sl-boot${bootDone ? ' sl-boot-done' : ''}`} aria-hidden={bootDone}>
        <div className="sl-boot-inner">
          <div className="sl-boot-eyebrow">MAHARASHTRA POLICE · AI OPERATIONS</div>
          <div className="sl-boot-wordmark">
            {typedTitle}
            {!titleDone && <span className="sl-boot-caret" />}
          </div>
          <div className="sl-boot-bar-wrap">
            <div className="sl-boot-bar-track">
              <div className="sl-boot-bar-fill" style={{ width: `${loadPct}%` }} />
            </div>
            <div className="sl-boot-bar-label">
              {loadPct < 100 ? `LOADING SYSTEM... ${Math.floor(loadPct)}%` : 'SYSTEM ONLINE'}
            </div>
          </div>
        </div>
      </div>

      {/* ── HERO ── */}
      <section className="sl-hero">
        <div className="sl-hero-grid" aria-hidden="true" />
        <div className="sl-hero-inner">
          <div className="sl-hero-eyebrow">MAHARASHTRA POLICE · AI OPERATIONS PLATFORM</div>
          <h1 className="sl-hero-wordmark">SENTINEL</h1>
          <p className="sl-hero-tagline">PREDICTIVE CRIME INTELLIGENCE &amp; TACTICAL FORCE ALLOCATION</p>
          <div className="sl-hero-meta">
            {([['9','MODULES'],['20+','ZONES'],['RT','REAL-TIME']] as [string,string][]).map(([n,l],i)=>(
              <React.Fragment key={l}>
                {i > 0 && <div className="sl-hero-meta-div" />}
                <div className="sl-hero-meta-item">
                  <span className="sl-hero-meta-num">{n}</span>
                  <span className="sl-hero-meta-lbl">{l}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
          <div className="sl-hero-actions">
            <button className="sl-btn-primary" onClick={enterDash} data-mag>ENTER OPERATIONS CENTER <span>→</span></button>
            <button className="sl-btn-ghost" onClick={()=>document.querySelector('.mod-section')?.scrollIntoView({behavior:'smooth'})} data-mag>EXPLORE SYSTEM</button>
          </div>
        </div>
        <div className="sl-hero-scroll-cue">
          <span>SCROLL</span>
          <div className="sl-hero-scroll-line" />
        </div>
      </section>

      {/* ── MODULE SECTIONS ── */}
      {MODULES.map((mod, i) => (
        <section
          key={mod.id}
          className={`mod-section${i % 2 === 1 ? ' mod-section-flip' : ''}`}
          style={{ '--mod-color': mod.color } as React.CSSProperties}
        >
          {/* LEFT (or RIGHT when flipped): the visual */}
          <div className="mod-visual-half">
            <div className="mod-card">
              <div className="mod-card-id">{mod.id} · {mod.label}</div>
              <ModuleVisual type={mod.visual} color={mod.color} />
              <div className="mod-card-stats">
                {mod.stats.map(s=>(
                  <span key={s} className="mod-card-stat" style={{borderColor:`${mod.color}55`, color:mod.color}}>{s}</span>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT (or LEFT when flipped): the info */}
          <div className="mod-info-half">
            <div className="mod-info-inner">
              <div className="mod-info-eyebrow">{mod.label}</div>
              <h2 className="mod-info-title">{mod.title}</h2>
              <p className="mod-info-desc">{mod.desc}</p>
              <div className="mod-info-tags">
                {mod.stats.map(s=>(
                  <span key={s} className="mod-info-tag">{s}</span>
                ))}
              </div>
              <div className="mod-info-cta">
                <button className="sl-btn-primary" onClick={enterDash} data-mag>
                  OPEN MODULE <span>→</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      ))}

      {/* ── CTA ── */}
      <section className="sl-cta">
        <div className="sl-cta-inner">
          <div className="sl-cta-eyebrow">AUTHORIZED PERSONNEL ONLY</div>
          <h2 className="sl-cta-title">Ready to enter the operations center?</h2>
          <p className="sl-cta-body">Sentinel is a live system. Real data. Real decisions.</p>
          <button className="sl-btn-primary" onClick={enterDash} data-mag>ENTER SENTINEL <span>→</span></button>
        </div>
        <footer className="sl-footer">
          <span>SENTINEL · MAHARASHTRA POLICE AI OPERATIONS</span>
          <span>CLASSIFICATION: RESTRICTED</span>
          <span>© 2026 SENTINEL SYSTEMS</span>
        </footer>
      </section>

      {/* ── Side dots ── */}
      <nav className="sl-dots" aria-label="Module navigation">
        {MODULES.map((m,i)=>(
          <button
            key={m.id}
            className={`sl-dot${i===activeIdx?' sl-dot-active':''}`}
            style={{'--dot-color':m.color} as React.CSSProperties}
            onClick={()=>document.querySelectorAll('.mod-section')[i]?.scrollIntoView({behavior:'smooth'})}
            aria-label={m.title} title={m.title}
          />
        ))}
      </nav>
    </div>
  )
}
