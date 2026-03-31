import { useEffect, useRef, useState } from 'react'
import CrimeMap          from './CrimeMap'
import ForceAllocator    from './ForceAllocator'
import DispatchBoard     from './DispatchBoard'
import IntelStreamPanel  from './IntelStreamPanel'
import MahaCrimeCopilot  from './MahaCrimeCopilot'
import SonicPulseMap     from './SonicPulseMap'
import './ScrollLayout.css'

const SECTIONS = [
  { id: 'hero',       label: 'SENTINEL' },
  { id: 'crimemap',   label: 'CRIME MAP' },
  { id: 'force',      label: 'FORCE' },
  { id: 'dispatch',   label: 'DISPATCH' },
  { id: 'intel',      label: 'INTEL' },
  { id: 'copilot',    label: 'COPILOT' },
  { id: 'sonic',      label: 'PULSE' },
]

export default function ScrollLayout() {
  const [activeSection, setActiveSection] = useState('hero')
  const [scrollY, setScrollY]             = useState(0)
  const [time, setTime]                   = useState('')
  const [glitch, setGlitch]               = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(
        now.toLocaleTimeString('en-IN', { hour12: false }) +
        ' IST · ' +
        now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // Glitch loop on hero wordmark
  useEffect(() => {
    const glitchLoop = () => {
      setGlitch(true)
      setTimeout(() => setGlitch(false), 200)
      setTimeout(glitchLoop, 3000 + Math.random() * 4000)
    }
    const t = setTimeout(glitchLoop, 1500)
    return () => clearTimeout(t)
  }, [])

  // Parallax scrollY
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Intersection Observer — section reveal + active nav
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
            entry.target.classList.add('sl-visible')
          }
        })
      },
      { threshold: 0.15 }
    )
    document.querySelectorAll('.sl-section').forEach((el) =>
      observerRef.current!.observe(el)
    )
    return () => observerRef.current?.disconnect()
  }, [])

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="sl-root">

      {/* ── Scanline overlay ─────────────────────────────────────── */}
      <div className="sl-scanlines" aria-hidden="true" />

      {/* ── Sticky nav pill ──────────────────────────────────────── */}
      <nav className="sl-nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`sl-nav-btn ${activeSection === s.id ? 'sl-nav-active' : ''}`}
            onClick={() => scrollTo(s.id)}
          >
            {s.label}
          </button>
        ))}
        <span className="sl-clock">{time}</span>
      </nav>

      {/* ══════════════════════════════════════════════════════════
          HERO
      ══════════════════════════════════════════════════════════ */}
      <section id="hero" className="sl-section sl-hero sl-visible">

        {/* Parallax grid */}
        <div
          className="sl-hero-grid"
          style={{ transform: `translateY(${scrollY * 0.3}px)` }}
          aria-hidden="true"
        />

        {/* Animated corner brackets */}
        <div className="sl-bracket sl-bracket-tl" />
        <div className="sl-bracket sl-bracket-tr" />
        <div className="sl-bracket sl-bracket-bl" />
        <div className="sl-bracket sl-bracket-br" />

        <div className="sl-hero-content">
          <div className="sl-hero-eyebrow">MAHARASHTRA POLICE · AI OPERATIONS SYSTEM</div>

          <h1 className={`sl-hero-title ${glitch ? 'sl-glitch' : ''}`} data-text="SENTINEL">
            SENTINEL
          </h1>

          <div className="sl-hero-subtitle">
            PREDICTIVE CRIME INTELLIGENCE &amp; TACTICAL FORCE ALLOCATION
          </div>

          <div className="sl-hero-stats">
            {[
              { val: '24', unit: 'ZONES',          label: 'UNDER SURVEILLANCE' },
              { val: 'AI',  unit: 'POWERED',        label: 'GEMINI + LP OPTIMIZER' },
              { val: 'RT',  unit: 'REAL-TIME',      label: 'THREAT ASSESSMENT' },
            ].map((s) => (
              <div key={s.label} className="sl-hero-stat">
                <span className="sl-hero-stat-val">{s.val}</span>
                <span className="sl-hero-stat-unit">{s.unit}</span>
                <span className="sl-hero-stat-label">{s.label}</span>
              </div>
            ))}
          </div>

          <button className="sl-hero-cta" onClick={() => scrollTo('crimemap')}>
            ENTER OPERATIONS CENTER
            <span className="sl-hero-cta-arrow">↓</span>
          </button>
        </div>

        <div className="sl-scroll-hint" onClick={() => scrollTo('crimemap')}>SCROLL</div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          CRIME MAP
      ══════════════════════════════════════════════════════════ */}
      <section id="crimemap" className="sl-section sl-panel sl-from-left">
        <div className="sl-panel-header">
          <div className="sl-panel-index">01</div>
          <div>
            <div className="sl-panel-label">SPATIAL INTELLIGENCE</div>
            <div className="sl-panel-title">CRIME HEAT MAP</div>
          </div>
          <div className="sl-panel-status sl-pulse">● LIVE</div>
        </div>
        <div className="sl-panel-body">
          <CrimeMap />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          FORCE ALLOCATOR
      ══════════════════════════════════════════════════════════ */}
      <section id="force" className="sl-section sl-panel sl-from-right">
        <div className="sl-panel-header">
          <div className="sl-panel-index">02</div>
          <div>
            <div className="sl-panel-label">LP OPTIMIZER · GEMINI AI</div>
            <div className="sl-panel-title">TACTICAL FORCE ALLOCATION</div>
          </div>
          <div className="sl-panel-status">⚡ DYNAMIC</div>
        </div>
        <div className="sl-panel-body">
          <ForceAllocator />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          DISPATCH
      ══════════════════════════════════════════════════════════ */}
      <section id="dispatch" className="sl-section sl-panel sl-from-left">
        <div className="sl-panel-header">
          <div className="sl-panel-index">03</div>
          <div>
            <div className="sl-panel-label">OPERATIONS CONTROL</div>
            <div className="sl-panel-title">DISPATCH BOARD</div>
          </div>
          <div className="sl-panel-status sl-pulse-orange">● ACTIVE</div>
        </div>
        <div className="sl-panel-body">
          <DispatchBoard />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          INTEL STREAM
      ══════════════════════════════════════════════════════════ */}
      <section id="intel" className="sl-section sl-panel sl-from-bottom">
        <div className="sl-panel-header">
          <div className="sl-panel-index">04</div>
          <div>
            <div className="sl-panel-label">LIVE FEED ANALYSIS</div>
            <div className="sl-panel-title">INTEL STREAM</div>
          </div>
          <div className="sl-panel-status sl-pulse">● STREAMING</div>
        </div>
        <div className="sl-panel-body">
          <IntelStreamPanel />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          COPILOT
      ══════════════════════════════════════════════════════════ */}
      <section id="copilot" className="sl-section sl-panel sl-from-right">
        <div className="sl-panel-header">
          <div className="sl-panel-index">05</div>
          <div>
            <div className="sl-panel-label">AI ASSISTANT</div>
            <div className="sl-panel-title">MAHA CRIME COPILOT</div>
          </div>
          <div className="sl-panel-status">🤖 GEMINI</div>
        </div>
        <div className="sl-panel-body">
          <MahaCrimeCopilot />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          SONIC PULSE
      ══════════════════════════════════════════════════════════ */}
      <section id="sonic" className="sl-section sl-panel sl-from-left">
        <div className="sl-panel-header">
          <div className="sl-panel-index">06</div>
          <div>
            <div className="sl-panel-label">ACOUSTIC PATTERN ANALYSIS</div>
            <div className="sl-panel-title">SONIC PULSE MAP</div>
          </div>
          <div className="sl-panel-status sl-pulse">● MONITORING</div>
        </div>
        <div className="sl-panel-body">
          <SonicPulseMap />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════════════════════ */}
      <footer className="sl-footer">
        <div className="sl-footer-line" />
        <div className="sl-footer-content">
          <span>SENTINEL · MAHARASHTRA POLICE AI OPERATIONS</span>
          <span>CLASSIFICATION: RESTRICTED · FOR AUTHORIZED PERSONNEL ONLY</span>
          <span>© 2026 SENTINEL SYSTEMS</span>
        </div>
      </footer>

    </div>
  )
}
