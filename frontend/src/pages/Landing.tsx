import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Landing.css'

// ─── Module data ───────────────────────────────────────────────────────────────
const MODULES = [
  {
    id: '01', label: 'ANOMALY INDEX', title: 'Anomaly Index',
    color: '#D2FF00', icon: '⚠',
    desc: 'Real-time statistical deviation detector scanning all 20+ Maharashtra zones for abnormal incident velocity. Z-score outliers are surfaced instantly, giving command the first signal before a pattern solidifies.',
    stats: ['Z-SCORE ENGINE', '20+ ZONES', 'REAL-TIME'],
    visual: 'anomaly',
  },
  {
    id: '02', label: 'SPATIAL INTELLIGENCE', title: 'Crime Heat Map',
    color: '#FF6B35', icon: '🗺',
    desc: 'A live Leaflet map overlaid with AI-generated danger scores across every zone of Maharashtra. Velocity-weighted heatmap clusters update every 60 seconds using predictive output.',
    stats: ['LEAFLET MAP', 'VELOCITY WEIGHTED', '60s REFRESH'],
    visual: 'heatmap',
  },
  {
    id: '03', label: 'PREDICTIVE ENGINE', title: 'Neural Risk Nodes',
    color: '#5AC8FA', icon: '🧠',
    desc: 'A multi-factor LSTM model scoring each zone 0–100 for predicted incident probability in the next 6 hours. Trained on Maharashtra Police records, temporal patterns, and environmental factors.',
    stats: ['LSTM MODEL', '6-HOUR WINDOW', 'MULTI-FACTOR'],
    visual: 'neural',
  },
  {
    id: '04', label: 'LP OPTIMIZER', title: 'Force Allocator',
    color: '#BF5AF2', icon: '⚡',
    desc: 'Linear programming meets AI briefing. The force allocator solves a constrained optimisation problem across available personnel and threat zones, then uses Gemini to generate a plain-language tactical briefing.',
    stats: ['LINEAR PROG.', 'GEMINI AI', 'LIVE BRIEFING'],
    visual: 'allocator',
  },
  {
    id: '05', label: 'OPERATIONS CONTROL', title: 'Dispatch Board',
    color: '#FF9500', icon: '📡',
    desc: 'A Kanban-style command board wired to the backend task queue. Pending alerts auto-create dispatch tasks. Officers acknowledge, escalate, and resolve in one click. Auto-refreshes every 15 seconds.',
    stats: ['KANBAN FLOW', '15s REFRESH', 'ONE-CLICK ACK'],
    visual: 'dispatch',
  },
  {
    id: '06', label: 'LIVE FEED ANALYSIS', title: 'Intel Stream',
    color: '#FF2D55', icon: '📶',
    desc: 'A real-time scrolling feed of all crime events, alerts, and system notifications. Filterable by severity, zone, and time range. Supports delta polling — only new events are streamed, keeping bandwidth minimal.',
    stats: ['DELTA POLLING', 'SEVERITY FILTER', 'ZONE FILTER'],
    visual: 'stream',
  },
  {
    id: '07', label: 'AI ASSISTANT', title: 'MahaCrime Copilot',
    color: '#34C759', icon: '🤖',
    desc: 'Conversational AI powered by Gemini 1.5 Pro with full context of the current city crime state. Ask anything — "What zones are critical right now?" — and get a data-backed response in natural language.',
    stats: ['GEMINI 1.5 PRO', 'CONTEXT-AWARE', 'NATURAL LANG.'],
    visual: 'copilot',
  },
  {
    id: '08', label: 'OFFENDER REGISTRY', title: 'OSINT Scanner',
    color: '#FF3B30', icon: '🔍',
    desc: 'Search and profile known offenders across the Maharashtra database. Cross-references arrest records, recidivism scores, and zone activity clusters. OSINT-enriched profiles surface social pattern data.',
    stats: ['PROFILE SEARCH', 'RECIDIVISM SCORE', 'ZONE ACTIVITY'],
    visual: 'osint',
  },
  {
    id: '09', label: 'COMMAND ANALYTICS', title: 'Stats Dashboard',
    color: '#D2FF00', icon: '📊',
    desc: 'Executive view of system performance, alert resolution rates, zone response times, and AI prediction accuracy. Historical trend lines let commanders measure: is crime going up or down? Are we deploying faster?',
    stats: ['TREND LINES', 'RESOLUTION RATE', 'AI ACCURACY'],
    visual: 'stats',
  },
] as const

// ─── SVG mock-visuals per module ───────────────────────────────────────────────
function ModuleVisual({ type, color }: { type: string; color: string }) {
  const c = color
  switch (type) {
    case 'anomaly': return (
      <svg viewBox="0 0 320 220" fill="none" className="mod-svg">
        <defs><filter id="glow-a"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {/* grid */}
        {[0,1,2,3,4].map(i => <line key={i} x1={i*80} y1="0" x2={i*80} y2="220" stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>)}
        {[0,1,2,3].map(i => <line key={i} x1="0" y1={i*73} x2="320" y2={i*73} stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>)}
        {/* baseline */}
        <polyline points="0,150 40,148 80,152 120,149 160,151 200,147 240,153 280,150 320,149" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" fill="none"/>
        {/* anomaly spike */}
        <polyline points="0,150 40,148 80,152 120,149 155,148 165,60 175,148 200,147 240,153 280,150 320,149" stroke={c} strokeWidth="2" fill="none" filter="url(#glow-a)"/>
        {/* spike fill */}
        <polygon points="155,148 165,60 175,148" fill={c} opacity="0.15"/>
        {/* dot at peak */}
        <circle cx="165" cy="60" r="5" fill={c} filter="url(#glow-a)"/>
        <circle cx="165" cy="60" r="12" stroke={c} strokeWidth="1" fill="none" opacity="0.3"/>
        {/* label */}
        <text x="180" y="56" fill={c} fontSize="9" fontFamily="monospace" letterSpacing="2">ANOMALY DETECTED</text>
        {/* threshold band */}
        <rect x="0" y="110" width="320" height="20" fill={c} opacity="0.03"/>
        <line x1="0" y1="110" x2="320" y2="110" stroke={c} strokeWidth="0.5" strokeDasharray="6 4" opacity="0.3"/>
        <text x="4" y="107" fill={c} fontSize="8" fontFamily="monospace" opacity="0.5">THRESHOLD</text>
        {/* zone labels */}
        {['THANE','PUNE','MUMBAI','NAGPUR'].map((z,i) => (
          <text key={z} x={i*80+8} y="215" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="monospace">{z}</text>
        ))}
      </svg>
    )
    case 'heatmap': return (
      <svg viewBox="0 0 320 220" fill="none" className="mod-svg">
        {/* rough Maharashtra outline cells */}
        {[
          {x:60,y:40,w:50,h:40,v:0.9},{x:110,y:30,w:60,h:50,v:0.7},{x:170,y:20,w:55,h:45,v:0.4},
          {x:40,y:80,w:55,h:40,v:0.5},{x:95,y:80,w:65,h:45,v:1.0},{x:160,y:65,w:60,h:50,v:0.6},{x:220,y:55,w:50,h:45,v:0.3},
          {x:30,y:120,w:50,h:40,v:0.3},{x:80,y:125,w:60,h:40,v:0.7},{x:140,y:115,w:65,h:45,v:0.5},{x:205,y:100,w:55,h:50,v:0.8},{x:260,y:90,w:45,h:45,v:0.2},
          {x:50,y:160,w:55,h:40,v:0.2},{x:105,y:165,w:60,h:38,v:0.4},{x:165,y:160,w:60,h:40,v:0.6},{x:225,y:148,w:50,h:45,v:0.9},
        ].map((cell,i) => (
          <rect key={i} x={cell.x} y={cell.y} width={cell.w} height={cell.h}
            fill={c} opacity={cell.v * 0.6}
            rx="2"
          />
        ))}
        {/* grid overlay */}
        {[0,1,2,3].map(i => <line key={i} x1="0" y1={i*55+20} x2="320" y2={i*55+20} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>)}
        {[0,1,2,3,4].map(i => <line key={i} x1={i*80} y1="0" x2={i*80} y2="220" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>)}
        {/* hotspot ring */}
        <circle cx="127" cy="102" r="22" stroke={c} strokeWidth="1.5" fill="none" opacity="0.8"/>
        <circle cx="127" cy="102" r="32" stroke={c} strokeWidth="0.5" fill="none" opacity="0.3"/>
        <circle cx="127" cy="102" r="4" fill={c}/>
        <text x="135" y="98" fill={c} fontSize="8" fontFamily="monospace" letterSpacing="1">CRITICAL</text>
        <text x="135" y="108" fill="rgba(255,255,255,0.4)" fontSize="7" fontFamily="monospace">RISK 94</text>
      </svg>
    )
    case 'neural': return (
      <svg viewBox="0 0 320 220" fill="none" className="mod-svg">
        <defs><filter id="glow-n"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {/* input layer */}
        {[40,80,120,160,180].map((y,i) => (
          <g key={i}>
            <circle cx="40" cy={y} r="7" fill={c} opacity="0.7" filter="url(#glow-n)"/>
            {/* connections to hidden */}
            {[60,100,140,175].map((hy,j) => (
              <line key={j} x1="47" y1={y} x2="153" y2={hy} stroke={c} strokeWidth="0.4" opacity="0.15"/>
            ))}
          </g>
        ))}
        {/* hidden layer */}
        {[60,100,140,175].map((y,i) => (
          <g key={i}>
            <circle cx="160" cy={y} r="9" fill={c} opacity={i===1?1:0.5} filter={i===1?"url(#glow-n)":undefined}/>
            {i===1 && <circle cx="160" cy={y} r="18" stroke={c} strokeWidth="0.5" fill="none" opacity="0.4"/>}
            {/* connections to output */}
            {[80,120,160].map((oy,j) => (
              <line key={j} x1="169" y1={y} x2="263" y2={oy} stroke={c} strokeWidth="0.4" opacity="0.15"/>
            ))}
          </g>
        ))}
        {/* output layer */}
        {[80,120,160].map((y,i) => (
          <circle key={i} cx="270" cy={y} r="8" fill={c} opacity={[0.9,1,0.6][i]} filter="url(#glow-n)"/>
        ))}
        {/* score bar */}
        <rect x="40" y="195" width="240" height="6" rx="3" fill="rgba(255,255,255,0.06)"/>
        <rect x="40" y="195" width="192" height="6" rx="3" fill={c} opacity="0.8"/>
        <text x="40" y="212" fill="rgba(255,255,255,0.4)" fontSize="7" fontFamily="monospace">RISK SCORE</text>
        <text x="254" y="212" fill={c} fontSize="9" fontFamily="monospace" fontWeight="bold">80/100</text>
      </svg>
    )
    case 'allocator': return (
      <svg viewBox="0 0 320 220" fill="none" className="mod-svg">
        {/* LP optimal bars */}
        {[
          {zone:'MUMBAI', alloc:90, x:20},{zone:'THANE', alloc:65, x:70},{zone:'PUNE', alloc:45, x:120},
          {zone:'NAGPUR', alloc:78, x:170},{zone:'NASHIK', alloc:30, x:220},{zone:'AURANGABAD', alloc:55, x:270},
        ].map((b) => (
          <g key={b.zone}>
            <rect x={b.x} y={190-b.alloc*1.6} width="36" height={b.alloc*1.6} fill={c} opacity="0.75" rx="2"/>
            <rect x={b.x} y={190-b.alloc*1.6} width="36" height="2" fill={c} rx="1"/>
            <text x={b.x+18} y="205" fill="rgba(255,255,255,0.3)" fontSize="6" fontFamily="monospace" textAnchor="middle">{b.zone.slice(0,3)}</text>
            <text x={b.x+18} y={190-b.alloc*1.6-5} fill={c} fontSize="8" fontFamily="monospace" textAnchor="middle">{b.alloc}</text>
          </g>
        ))}
        {/* axis */}
        <line x1="15" y1="190" x2="315" y2="190" stroke="rgba(255,255,255,0.15)" strokeWidth="1"/>
        <text x="15" y="14" fill="rgba(255,255,255,0.3)" fontSize="7" fontFamily="monospace">OPTIMAL FORCE ALLOCATION</text>
      </svg>
    )
    case 'dispatch': return (
      <svg viewBox="0 0 320 220" fill="none" className="mod-svg">
        {/* kanban columns */}
        {['PENDING','ACK','RESOLVED'].map((col, ci) => (
          <g key={col}>
            <rect x={ci*107+8} y="18" width="96" height="12" fill="rgba(255,255,255,0.04)" rx="2"/>
            <text x={ci*107+56} y="28" fill="rgba(255,255,255,0.35)" fontSize="7" fontFamily="monospace" textAnchor="middle" letterSpacing="1">{col}</text>
            {/* cards */}
            {[0,1,2].map(ri => (
              <g key={ri}>
                <rect x={ci*107+8} y={38+ri*58} width="96" height="50" fill="rgba(255,255,255,0.03)" rx="3" stroke={ci===0&&ri===0?c:'rgba(255,255,255,0.06)'} strokeWidth={ci===0&&ri===0?1:0.5}/>
                <rect x={ci*107+8} y={38+ri*58} width="4" height="50" fill={['#FF2D55','#FF9500','#34C759'][ci]} rx="1" opacity="0.8"/>
                <text x={ci*107+18} y={54+ri*58} fill="rgba(255,255,255,0.6)" fontSize="6.5" fontFamily="monospace">ZONE {['THANE','PUNE','MUM','NGP','NAS','AUR','KOL','SAN','LAT'][ci*3+ri]}</text>
                <text x={ci*107+18} y={64+ri*58} fill="rgba(255,255,255,0.25)" fontSize="6" fontFamily="monospace">MOBILE_PATROL</text>
                <rect x={ci*107+18} y={71+ri*58} width="30" height="8" fill={['#FF2D55','#FF9500','#34C759'][ci]} rx="1" opacity="0.7"/>
                <text x={ci*107+33} y={77+ri*58} fill="#000" fontSize="5.5" fontFamily="monospace" textAnchor="middle" fontWeight="bold">{['HIGH','CRIT','LOW'][ci]}</text>
              </g>
            ))}
          </g>
        ))}
      </svg>
    )
    case 'stream': return (
      <svg viewBox="0 0 320 220" fill="none" className="mod-svg">
        {[
          {t:'02:18:44',z:'THANE',s:'CRITICAL',msg:'Armed robbery reported — sector 4'},
          {t:'02:17:31',z:'MUMBAI',s:'HIGH',msg:'Vehicle pursuit ongoing — NH48'},
          {t:'02:16:22',z:'PUNE',s:'MEDIUM',msg:'Vandalism cluster — Camp area'},
          {t:'02:15:09',z:'NAGPUR',s:'HIGH',msg:'Assault — Dharampeth'},
          {t:'02:14:55',z:'NASHIK',s:'LOW',msg:'Suspicious activity near depot'},
        ].map((ev, i) => (
          <g key={i}>
            <rect x="8" y={10+i*41} width="304" height="36" fill="rgba(255,255,255,0.02)" rx="3"
              stroke={i===0?c:'rgba(255,255,255,0.05)'} strokeWidth={i===0?0.8:0.5}/>
            <text x="18" y={24+i*41} fill="rgba(255,255,255,0.25)" fontSize="7" fontFamily="monospace">{ev.t}</text>
            <text x="75" y={24+i*41} fill="rgba(255,255,255,0.5)" fontSize="7" fontFamily="monospace">{ev.z}</text>
            <rect x="130" y={15+i*41} width="40" height="11" rx="2"
              fill={ev.s==='CRITICAL'?'#FF2D55':ev.s==='HIGH'?'#FF9500':ev.s==='MEDIUM'?c:'#34C759'} opacity="0.15"/>
            <text x="150" y={24+i*41} fontSize="6" fontFamily="monospace" textAnchor="middle" fontWeight="bold"
              fill={ev.s==='CRITICAL'?'#FF2D55':ev.s==='HIGH'?'#FF9500':ev.s==='MEDIUM'?c:'#34C759'}>{ev.s}</text>
            <text x="180" y={24+i*41} fill="rgba(255,255,255,0.4)" fontSize="7" fontFamily="monospace">{ev.msg.slice(0,28)}</text>
            <line x1="18" y1={38+i*41} x2="300" y2={38+i*41} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"/>
          </g>
        ))}
      </svg>
    )
    case 'copilot': return (
      <svg viewBox="0 0 320 220" fill="none" className="mod-svg">
        {/* chat bubbles */}
        <rect x="60" y="12" width="200" height="38" rx="4" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5"/>
        <text x="75" y="27" fill="rgba(255,255,255,0.6)" fontSize="7.5" fontFamily="monospace">What zones are critical right now?</text>
        <text x="75" y="40" fill="rgba(255,255,255,0.3)" fontSize="6" fontFamily="monospace">— Commander Patil, 02:14</text>

        <rect x="20" y="62" width="240" height="60" rx="4" fill={c} opacity="0.08" stroke={c} strokeWidth="0.5" opacity2="0.3"/>
        <text x="35" y="78" fill={c} fontSize="7" fontFamily="monospace">SENTINEL COPILOT  ·  02:14:03</text>
        <text x="35" y="93" fill="rgba(255,255,255,0.65)" fontSize="7" fontFamily="monospace">3 zones flagged CRITICAL: Thane Sector 4,</text>
        <text x="35" y="105" fill="rgba(255,255,255,0.65)" fontSize="7" fontFamily="monospace">Mumbai Central, Nagpur East. Recommend</text>
        <text x="35" y="117" fill="rgba(255,255,255,0.65)" fontSize="7" fontFamily="monospace">immediate deployment to Thane first.</text>

        <rect x="80" y="138" width="180" height="28" rx="4" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>
        <text x="95" y="154" fill="rgba(255,255,255,0.5)" fontSize="7" fontFamily="monospace">Deploy 4 units to Thane Sector 4.</text>

        {/* typing indicator */}
        <rect x="20" y="178" width="60" height="24" rx="4" fill={c} opacity="0.07" stroke={c} strokeWidth="0.4"/>
        {[0,1,2].map(i => <circle key={i} cx={34+i*14} cy="190" r="3" fill={c} opacity={0.4+i*0.2}/>)}
      </svg>
    )
    case 'osint': return (
      <svg viewBox="0 0 320 220" fill="none" className="mod-svg">
        {/* profile card */}
        <rect x="20" y="10" width="130" height="180" rx="4" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>
        <circle cx="85" cy="50" r="24" fill={c} opacity="0.15" stroke={c} strokeWidth="0.8"/>
        <text x="85" y="55" fill={c} fontSize="18" textAnchor="middle">👤</text>
        <rect x="35" y="85" width="90" height="6" rx="2" fill="rgba(255,255,255,0.2)"/>
        <rect x="45" y="96" width="70" height="4" rx="2" fill="rgba(255,255,255,0.1)"/>
        {['RECIDIVISM: HIGH','ZONE: THANE','ARRESTS: 7','STATUS: ACTIVE'].map((l,i) => (
          <g key={i}>
            <text x="35" y={115+i*16} fill="rgba(255,255,255,0.3)" fontSize="6.5" fontFamily="monospace">{l}</text>
            <line x1="35" y1={118+i*16} x2="135" y2={118+i*16} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>
          </g>
        ))}
        {/* connection graph */}
        <circle cx="220" cy="80" r="10" fill={c} opacity="0.8"/>
        {[[180,50],[260,50],[180,120],[260,120],[220,150]].map(([cx,cy],i) => (
          <g key={i}>
            <line x1="220" y1="80" x2={cx} y2={cy} stroke={c} strokeWidth="0.8" opacity="0.3"/>
            <circle cx={cx} cy={cy} r="6" fill={c} opacity="0.4"/>
          </g>
        ))}
        <text x="200" y="175" fill="rgba(255,255,255,0.25)" fontSize="7" fontFamily="monospace">NETWORK MAP</text>
      </svg>
    )
    case 'stats': return (
      <svg viewBox="0 0 320 220" fill="none" className="mod-svg">
        {/* KPI row */}
        {[
          {label:'ALERTS RESOLVED',val:'94%'},{label:'AVG RESPONSE',val:'4.2m'},{label:'PREDICTION ACC.',val:'87%'}
        ].map((kpi,i) => (
          <g key={i}>
            <rect x={i*108+8} y="8" width="96" height="44" rx="3" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5"/>
            <text x={i*108+56} y="28" fill={c} fontSize="14" fontFamily="monospace" textAnchor="middle" fontWeight="bold">{kpi.val}</text>
            <text x={i*108+56} y="42" fill="rgba(255,255,255,0.3)" fontSize="6" fontFamily="monospace" textAnchor="middle" letterSpacing="0.5">{kpi.label}</text>
          </g>
        ))}
        {/* trend line */}
        <text x="8" y="75" fill="rgba(255,255,255,0.2)" fontSize="6.5" fontFamily="monospace" letterSpacing="1">7-DAY INCIDENT TREND</text>
        <polyline
          points="8,165 52,158 96,170 140,145 184,152 228,138 272,128 316,120"
          stroke={c} strokeWidth="2" fill="none"/>
        <polygon
          points="8,165 52,158 96,170 140,145 184,152 228,138 272,128 316,120 316,200 8,200"
          fill={c} opacity="0.06"/>
        {/* axis */}
        <line x1="8" y1="200" x2="316" y2="200" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5"/>
        {['MON','TUE','WED','THU','FRI','SAT','SUN'].map((d,i) => (
          <text key={d} x={8+i*51} y="212" fill="rgba(255,255,255,0.2)" fontSize="6.5" fontFamily="monospace">{d}</text>
        ))}
      </svg>
    )
    default: return (
      <svg viewBox="0 0 320 220" fill="none" className="mod-svg">
        <text x="160" y="110" fill={color} fontSize="40" textAnchor="middle">{type}</text>
      </svg>
    )
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

  // ── Boot sequence ──────────────────────────────────────────────────────────
  useEffect(() => {
    const word = 'SENTINEL'
    let i = 0
    const type = () => {
      setTypedTitle(word.slice(0, i + 1))
      i++
      if (i < word.length) setTimeout(type, 100)
      else {
        setTitleDone(true)
        // animate loading bar
        let pct = 0
        const fill = () => {
          pct += Math.random() * 12 + 4
          if (pct >= 100) {
            setLoadPct(100)
            setTimeout(() => setBootDone(true), 500)
          } else {
            setLoadPct(pct)
            setTimeout(fill, 60 + Math.random() * 80)
          }
        }
        setTimeout(fill, 300)
      }
    }
    const t = setTimeout(type, 400)
    return () => clearTimeout(t)
  }, [])

  // ── Magnetic cursor ────────────────────────────────────────────────────────
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
      rx += (mx - rx) * 0.12
      ry += (my - ry) * 0.12
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

  // ── GSAP scroll-pinned sections ───────────────────────────────────────────
  useEffect(() => {
    if (!bootDone) return
    let cleanup: (() => void) | undefined
    const init = async () => {
      const gsap = (await import('gsap')).default
      const { ScrollTrigger } = await import('gsap/ScrollTrigger')
      gsap.registerPlugin(ScrollTrigger)

      // Each .mod-section is pinned for the height of its scroll-space sibling
      document.querySelectorAll('.mod-section').forEach((section, i) => {
        const panel = section.querySelector('.mod-panel')
        const visual = section.querySelector('.mod-visual-wrap')
        const text = section.querySelector('.mod-text-wrap')

        // reveal on enter
        gsap.fromTo([visual, text],
          { opacity: 0, y: 40 },
          {
            opacity: 1, y: 0, duration: 1, ease: 'expo.out', stagger: 0.15,
            scrollTrigger: { trigger: section, start: 'top 80%', toggleActions: 'play none none none' }
          }
        )

        // track active
        ScrollTrigger.create({
          trigger: section,
          start: 'top 55%',
          end: 'bottom 55%',
          onEnter: () => setActiveIdx(i),
          onEnterBack: () => setActiveIdx(i),
        })
      })

      // hero fade on scroll
      const hero = document.querySelector('.sl-hero')
      if (hero) {
        gsap.to(hero, {
          opacity: 0, y: -60,
          scrollTrigger: { trigger: hero, start: 'top top', end: '60% top', scrub: true }
        })
      }

      cleanup = () => ScrollTrigger.getAll().forEach(st => st.kill())
    }
    init()
    return () => cleanup?.()
  }, [bootDone])

  const enterDash = () => navigate('/dashboard')
  const activeColor = MODULES[activeIdx]?.color ?? '#D2FF00'

  return (
    <div className="sl-root">
      {/* ── Custom cursor ── */}
      <div ref={cursorDotRef} className="sl-cursor-dot" aria-hidden="true" />
      <div ref={cursorRingRef} className="sl-cursor-ring" aria-hidden="true" />

      {/* ── Grain ── */}
      <div className="sl-grain" aria-hidden="true" />

      {/* ── Ambient glow ── */}
      <div className="sl-ambient" style={{ '--ambient': activeColor } as React.CSSProperties} aria-hidden="true" />

      {/* ─────────────────────────────────────────
          BOOT SCREEN
      ───────────────────────────────────────── */}
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

      {/* ─────────────────────────────────────────
          HERO (after boot)
      ───────────────────────────────────────── */}
      <section className="sl-hero">
        <div className="sl-hero-grid" aria-hidden="true" />
        <div className="sl-hero-inner">
          <div className="sl-hero-eyebrow">MAHARASHTRA POLICE · AI OPERATIONS PLATFORM</div>
          <h1 className="sl-hero-wordmark">SENTINEL</h1>
          <p className="sl-hero-tagline">PREDICTIVE CRIME INTELLIGENCE &amp; TACTICAL FORCE ALLOCATION</p>
          <div className="sl-hero-meta">
            {([['9','MODULES'],['20+','ZONES'],['RT','REAL-TIME']] as [string,string][]).map(([n,l], i, arr) => (
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
            <button className="sl-btn-primary" onClick={enterDash} data-mag>
              ENTER OPERATIONS CENTER <span>→</span>
            </button>
            <button className="sl-btn-ghost" onClick={() => document.querySelector('.mod-section')?.scrollIntoView({behavior:'smooth'})} data-mag>
              EXPLORE SYSTEM
            </button>
          </div>
        </div>
        <div className="sl-hero-scroll-cue">
          <span>SCROLL</span>
          <div className="sl-hero-scroll-line" />
        </div>
      </section>

      {/* ─────────────────────────────────────────
          MODULE SECTIONS
      ───────────────────────────────────────── */}
      {MODULES.map((mod, i) => {
        const isRight = i % 2 === 0 // visual on right for even idx, left for odd
        return (
          <section
            key={mod.id}
            className={`mod-section mod-section-${isRight ? 'right' : 'left'}`}
            style={{ '--mod-color': mod.color } as React.CSSProperties}
          >
            <div className="mod-panel">
              {/* Visual side */}
              <div className={`mod-visual-wrap ${isRight ? 'mod-visual-right' : 'mod-visual-left'}`}>
                <div className="mod-card">
                  <div className="mod-card-glow" style={{ background: mod.color }} />
                  <div className="mod-card-id">{mod.id}</div>
                  <ModuleVisual type={mod.visual} color={mod.color} />
                  <div className="mod-card-stats">
                    {mod.stats.map(s => (
                      <span key={s} className="mod-card-stat" style={{ borderColor: `${mod.color}55`, color: mod.color }}>{s}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Text side */}
              <div className={`mod-text-wrap ${isRight ? 'mod-text-left' : 'mod-text-right'}`}>
                <div className="mod-text-id" style={{ color: mod.color }}>{mod.id}</div>
                <div className="mod-text-label">{mod.label}</div>
                <h2 className="mod-text-title">{mod.title}</h2>
                <p className="mod-text-desc">{mod.desc}</p>
                <div className="mod-text-tags">
                  {mod.stats.map(s => (
                    <span key={s} className="mod-text-tag">{s}</span>
                  ))}
                </div>
                <div className="mod-text-line" style={{ background: mod.color }} />
              </div>
            </div>
          </section>
        )
      })}

      {/* ─────────────────────────────────────────
          CTA
      ───────────────────────────────────────── */}
      <section className="sl-cta">
        <div className="sl-cta-inner">
          <div className="sl-cta-eyebrow">AUTHORIZED PERSONNEL ONLY</div>
          <h2 className="sl-cta-title">Ready to enter the operations center?</h2>
          <p className="sl-cta-body">Sentinel is a live system. Real data. Real decisions.</p>
          <button className="sl-btn-primary" onClick={enterDash} data-mag>
            ENTER SENTINEL <span>→</span>
          </button>
        </div>
        <footer className="sl-footer">
          <span>SENTINEL · MAHARASHTRA POLICE AI OPERATIONS</span>
          <span>CLASSIFICATION: RESTRICTED</span>
          <span>© 2026 SENTINEL SYSTEMS</span>
        </footer>
      </section>

      {/* ─────────────────────────────────────────
          Side module index dots
      ───────────────────────────────────────── */}
      <nav className="sl-dots" aria-label="Module navigation">
        {MODULES.map((m, i) => (
          <button
            key={m.id}
            className={`sl-dot${i === activeIdx ? ' sl-dot-active' : ''}`}
            style={{ '--dot-color': m.color } as React.CSSProperties}
            onClick={() => document.querySelectorAll('.mod-section')[i]?.scrollIntoView({ behavior: 'smooth' })}
            aria-label={m.title}
            title={m.title}
          />
        ))}
      </nav>
    </div>
  )
}
