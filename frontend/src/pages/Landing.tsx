import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Landing.css'

const MODULES = [
  { index:'01', label:'SPATIAL INTELLIGENCE', title:'Crime Heat Map', icon:'🗺', side:'left' as const, color:'#D2FF00',
    desc:'A real-time Leaflet map overlaid with AI-generated danger scores across all 20+ zones of Maharashtra. Velocity-weighted heatmap clusters update every 60 seconds using predictive output, giving command staff a live spatial picture of where incidents are concentrating before they escalate.',
    stats:['20+ ZONES','LIVE HEATMAP','VELOCITY WEIGHTED'] },
  { index:'02', label:'LP OPTIMIZER', title:'Force Allocator', icon:'⚡', side:'right' as const, color:'#5AC8FA',
    desc:'Linear programming meets AI briefing. The force allocator solves a constrained optimisation problem across available personnel and active threat zones, then uses Gemini to generate a plain-language tactical briefing in real time. Commanders get numbers and the reasoning behind them.',
    stats:['LINEAR PROG.','GEMINI AI','LIVE BRIEFING'] },
  { index:'03', label:'OPERATIONS CONTROL', title:'Dispatch Board', icon:'📡', side:'left' as const, color:'#FF9500',
    desc:'A Kanban-style command board wired directly to the backend task queue. Pending alerts auto-create dispatch tasks. Officers can acknowledge, escalate, and resolve assignments in one click. Auto-refreshes every 15 seconds — zero manual reload required.',
    stats:['KANBAN FLOW','15s REFRESH','ONE-CLICK ACK'] },
  { index:'04', label:'LIVE FEED ANALYSIS', title:'Intel Stream', icon:'📶', side:'right' as const, color:'#FF2D55',
    desc:'A real-time scrolling feed of all crime events, alerts, and system notifications ingested by Sentinel. Filterable by severity, zone, and time range. Supports delta polling — only new events since the last fetch are streamed, keeping bandwidth minimal even under high event volume.',
    stats:['DELTA POLLING','SEVERITY FILTER','ZONE FILTER'] },
  { index:'05', label:'AI ASSISTANT', title:'MahaCrime Copilot', icon:'🤖', side:'left' as const, color:'#BF5AF2',
    desc:'A conversational AI powered by Gemini 1.5 Pro with full context of the current city crime state. Ask it anything — "What zones are critical right now?" or "Should I deploy more units to Thane?" — and get a grounded, data-backed response in natural language.',
    stats:['GEMINI 1.5 PRO','CONTEXT-AWARE','NATURAL LANG.'] },
  { index:'06', label:'ACOUSTIC PATTERN ANALYSIS', title:'Sonic Pulse Map', icon:'🔊', side:'right' as const, color:'#34C759',
    desc:'Experimental module that cross-references reported incident density with simulated acoustic footprint data to identify areas of abnormal sound activity. Useful for crowded venues, festivals, and border zones where visual surveillance has blind spots.',
    stats:['ACOUSTIC','CROWD ANALYSIS','BLIND SPOT COVER'] },
  { index:'07', label:'PREDICTIVE ENGINE', title:'Risk Score Engine', icon:'🧠', side:'left' as const, color:'#FF6B35',
    desc:'The statistical backbone of Sentinel. A multi-factor ML model scoring each zone 0–100 for predicted incident probability in the next 6 hours. Trained on historical Maharashtra Police records, time-of-day, day-of-week, and environmental factors. Powers the heatmap, force allocator, and AI copilot.',
    stats:['ML SCORING','6-HOUR WINDOW','MULTI-FACTOR'] },
  { index:'08', label:'OFFENDER REGISTRY', title:'OSINT Scanner', icon:'🔍', side:'right' as const, color:'#FF3B30',
    desc:'Search and profile known offenders across Maharashtra database. Cross-references arrest records, recidivism scores, and zone activity clusters. OSINT-enriched profiles surface social pattern data to help investigators build connections between events, locations, and individuals.',
    stats:['PROFILE SEARCH','RECIDIVISM SCORE','ZONE ACTIVITY'] },
  { index:'09', label:'COMMAND ANALYTICS', title:'Stats Dashboard', icon:'📊', side:'left' as const, color:'#D2FF00',
    desc:'A high-level executive view of system performance, alert resolution rates, zone response times, and AI prediction accuracy. Historical trend lines let commanders measure what matters: is crime going up or down? Are we deploying faster? Sentinel closes the feedback loop.',
    stats:['TREND LINES','RESOLUTION RATE','AI ACCURACY'] },
]

const INTRO_BLOCKS = [
  { eyebrow:'THE PROBLEM', heading:'Crime does not wait for morning briefings.',
    body:'Traditional policing reacts. Sentinel predicts. By the time an officer reads yesterday's report, the threat topology has shifted. Sentinel ingests live data and returns actionable intelligence in seconds, not hours.' },
  { eyebrow:'THE SYSTEM', heading:'Nine modules. One unified command layer.',
    body:'From spatial heatmaps to AI-generated tactical briefings, every Sentinel module shares the same real-time data backbone. Information flows in, intelligence flows out. No silos, no lag, no guesswork.' },
  { eyebrow:'THE TECHNOLOGY', heading:'Gemini AI + Linear Programming + LSTM.',
    body:'Sentinel pairs Google Gemini 1.5 Pro with classical operations research methods. AI handles language and context. Math handles optimisation. Together, they close the gap between raw data and field-ready decisions.' },
]

export default function Landing() {
  const navigate = useNavigate()
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set())
  const [glitch, setGlitch] = useState(false)
  const [titleDone, setTitleDone] = useState(false)
  const [typedTitle, setTypedTitle] = useState('')
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    const word = 'SENTINEL'
    let i = 0
    const tick = () => {
      setTypedTitle(word.slice(0, i + 1))
      i++
      if (i < word.length) setTimeout(tick, 90)
      else setTimeout(() => setTitleDone(true), 400)
    }
    const t = setTimeout(tick, 600)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!titleDone) return
    const loop = () => { setGlitch(true); setTimeout(() => setGlitch(false), 180); setTimeout(loop, 2800 + Math.random() * 3000) }
    const t = setTimeout(loop, 1200)
    return () => clearTimeout(t)
  }, [titleDone])

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => { entries.forEach(e => { if (e.isIntersecting) setVisibleSections(prev => new Set([...prev, e.target.id])) }) },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
    )
    document.querySelectorAll('[data-reveal]').forEach(el => observerRef.current!.observe(el))
    return () => observerRef.current?.disconnect()
  }, [])

  const vis = (id: string) => visibleSections.has(id)

  return (
    <div className="lp-root">
      <div className="lp-grain" aria-hidden="true" />
      <div className="lp-spine" aria-hidden="true" />

      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-hero-grid" aria-hidden="true" />
        <div className="lp-bracket lp-bracket-tl" aria-hidden="true" />
        <div className="lp-bracket lp-bracket-tr" aria-hidden="true" />
        <div className="lp-bracket lp-bracket-bl" aria-hidden="true" />
        <div className="lp-bracket lp-bracket-br" aria-hidden="true" />
        <div className="lp-hero-inner">
          <div className="lp-hero-eyebrow">MAHARASHTRA POLICE · AI OPERATIONS PLATFORM</div>
          <div className={`lp-hero-wordmark ${glitch ? 'lp-glitch' : ''}`} data-text={typedTitle}>
            {typedTitle}
            {!titleDone && <span className="lp-cursor">|</span>}
          </div>
          <div className="lp-hero-tagline">PREDICTIVE CRIME INTELLIGENCE &amp; TACTICAL FORCE ALLOCATION</div>
          <div className="lp-hero-meta">
            <div className="lp-hero-meta-item"><span className="lp-hero-meta-num">9</span><span className="lp-hero-meta-label">OPERATIONAL MODULES</span></div>
            <div className="lp-hero-meta-divider" />
            <div className="lp-hero-meta-item"><span className="lp-hero-meta-num">20+</span><span className="lp-hero-meta-label">ZONES MONITORED</span></div>
            <div className="lp-hero-meta-divider" />
            <div className="lp-hero-meta-item"><span className="lp-hero-meta-num">RT</span><span className="lp-hero-meta-label">REAL-TIME INTEL</span></div>
          </div>
          <div className="lp-hero-actions">
            <button className="lp-btn-primary" onClick={() => navigate('/dashboard')}>
              ENTER OPERATIONS CENTER <span className="lp-btn-arrow">→</span>
            </button>
            <button className="lp-btn-ghost" onClick={() => document.getElementById('intro-0')?.scrollIntoView({behavior:'smooth'})}>
              LEARN MORE
            </button>
          </div>
        </div>
        <div className="lp-scroll-cue" onClick={() => document.getElementById('intro-0')?.scrollIntoView({behavior:'smooth'})}>
          <span>SCROLL</span>
          <div className="lp-scroll-arrow" />
        </div>
      </section>

      {/* INTRO BLOCKS */}
      {INTRO_BLOCKS.map((block, i) => (
        <section key={i} id={`intro-${i}`} data-reveal
          className={`lp-intro-block lp-intro-${i%2===0?'left':'right'} ${vis(`intro-${i}`)?'lp-in':''}`}>
          <div className="lp-intro-eyebrow">{block.eyebrow}</div>
          <h2 className="lp-intro-heading">{block.heading}</h2>
          <p className="lp-intro-body">{block.body}</p>
          <div className="lp-intro-rule" aria-hidden="true" />
        </section>
      ))}

      {/* MODULES HEADER */}
      <section id="modules-header" data-reveal className={`lp-modules-header ${vis('modules-header')?'lp-in':''}`}>
        <div className="lp-modules-header-label">THE SYSTEM</div>
        <h2 className="lp-modules-header-title">9 MODULES · LIVE</h2>
        <div className="lp-modules-header-sub">Every capability Sentinel offers, explained below. Scroll through to see the full suite.</div>
      </section>

      {/* MODULE ROWS */}
      {MODULES.map((mod) => {
        const id = `mod-${mod.index}`
        return (
          <section key={mod.index} id={id} data-reveal
            className={`lp-module lp-module-${mod.side} ${vis(id)?'lp-in':''}`}>
            <div className="lp-module-visual">
              <div className="lp-module-card" style={{'--mod-color':mod.color} as React.CSSProperties}>
                <div className="lp-module-card-shimmer" />
                <div className="lp-module-card-index">{mod.index}</div>
                <div className="lp-module-card-icon">{mod.icon}</div>
                <div className="lp-module-card-title" style={{color:mod.color}}>{mod.title}</div>
                <div className="lp-module-card-label">{mod.label}</div>
                <div className="lp-module-card-stats">
                  {mod.stats.map(s => (<span key={s} className="lp-module-card-stat" style={{borderColor:`${mod.color}44`,color:mod.color}}>{s}</span>))}
                </div>
                <div className="lp-module-card-lines" aria-hidden="true">
                  <div className="lp-module-card-line" style={{background:mod.color}} />
                  <div className="lp-module-card-line lp-module-card-line-2" style={{background:mod.color}} />
                </div>
              </div>
            </div>
            <div className="lp-module-text">
              <div className="lp-module-text-num" style={{color:mod.color}}>{mod.index}</div>
              <div className="lp-module-text-label">{mod.label}</div>
              <h3 className="lp-module-text-title">{mod.title}</h3>
              <p className="lp-module-text-desc">{mod.desc}</p>
              <div className="lp-module-text-tags">
                {mod.stats.map(s => (<span key={s} className="lp-module-text-tag" style={{'--tag-color':mod.color} as React.CSSProperties}>{s}</span>))}
              </div>
            </div>
          </section>
        )
      })}

      {/* CTA */}
      <section id="lp-cta" data-reveal className={`lp-cta ${vis('lp-cta')?'lp-in':''}`}>
        <div className="lp-cta-inner">
          <div className="lp-cta-eyebrow">AUTHORIZED PERSONNEL ONLY</div>
          <h2 className="lp-cta-title">Ready to enter the operations center?</h2>
          <p className="lp-cta-body">Sentinel is a live system. Real data. Real decisions. Access requires valid credentials.</p>
          <button className="lp-btn-primary lp-cta-btn" onClick={() => navigate('/dashboard')}>
            ENTER SENTINEL <span className="lp-btn-arrow">→</span>
          </button>
        </div>
        <footer className="lp-footer">
          <span>SENTINEL · MAHARASHTRA POLICE AI OPERATIONS</span>
          <span>CLASSIFICATION: RESTRICTED</span>
          <span>© 2026 SENTINEL SYSTEMS</span>
        </footer>
      </section>
    </div>
  )
}
