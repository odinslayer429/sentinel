import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';
import { AlertTriangle, Send, CheckCircle } from 'lucide-react';
import axios from 'axios';
import './Landing.css';

/* ── Magnetic element wrapper ─────────────────────────────────────── */
function Magnetic({ children, strength = 0.35 }: { children: React.ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 180, damping: 18 });
  const sy = useSpring(y, { stiffness: 180, damping: 18 });

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current!;
    const r  = el.getBoundingClientRect();
    const cx = r.left + r.width  / 2;
    const cy = r.top  + r.height / 2;
    x.set((e.clientX - cx) * strength);
    y.set((e.clientY - cy) * strength);
  };
  const reset = () => { x.set(0); y.set(0); };

  return (
    <motion.div ref={ref} style={{ x: sx, y: sy }}
      onMouseMove={handleMove} onMouseLeave={reset}>
      {children}
    </motion.div>
  );
}

/* ── Custom cursor ────────────────────────────────────────────────── */
function Cursor() {
  const ox = useMotionValue(-100);
  const oy = useMotionValue(-100);
  const dx = useMotionValue(-100);
  const dy = useMotionValue(-100);
  const sox = useSpring(ox, { stiffness: 90,  damping: 16 });
  const soy = useSpring(oy, { stiffness: 90,  damping: 16 });
  const sdx = useSpring(dx, { stiffness: 200, damping: 20 });
  const sdy = useSpring(dy, { stiffness: 200, damping: 20 });

  useEffect(() => {
    const move = (e: MouseEvent) => { ox.set(e.clientX); oy.set(e.clientY); dx.set(e.clientX); dy.set(e.clientY); };
    const over = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('button,a,[data-magnetic]')) {
        document.body.classList.add('cursor-hovering-btn');
        document.body.classList.add('cursor-hover');
      } else if (t.closest('.brutal-card,.stat-pill,.hub-tile')) {
        document.body.classList.add('cursor-hover');
        document.body.classList.remove('cursor-hovering-btn');
      } else {
        document.body.classList.remove('cursor-hover');
        document.body.classList.remove('cursor-hovering-btn');
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseover', over);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseover', over); };
  }, []);

  return (
    <>
      <motion.div className="cursor-outer" style={{ left: sox, top: soy }} />
      <motion.div className="cursor-dot"   style={{ left: sdx, top: sdy }} />
    </>
  );
}

/* ── Counter animation ────────────────────────────────────────────── */
function CountUp({ to, duration = 1600 }: { to: number; duration?: number }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 4);
      setVal(Math.round(ease * to));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [to, duration]);
  return <>{val.toLocaleString()}</>;
}

/* ── Page variants ────────────────────────────────────────────────── */
const pageVars = {
  hidden:  { opacity: 0, filter: 'blur(12px)', scale: 1.03 },
  visible: { opacity: 1, filter: 'blur(0px)',  scale: 1, transition: { duration: 0.85, ease: [0.16,1,0.3,1] } },
  exit:    { opacity: 0, filter: 'blur(8px)',  scale: 0.98, transition: { duration: 0.4,  ease: [0.16,1,0.3,1] } },
};
const leftVars = {
  hidden:  { opacity:0, x:-60 },
  visible: { opacity:1, x:0, transition:{ duration:0.95, ease:[0.16,1,0.3,1] } },
};
const rightVars = {
  hidden:  { opacity:0, y:50, scale:0.96 },
  visible: { opacity:1, y:0, scale:1, transition:{ duration:0.9, delay:0.15, ease:[0.16,1,0.3,1] } },
};
const statVars = {
  hidden:  { opacity:0, x:-20 },
  visible: (i:number) => ({ opacity:1, x:0, transition:{ duration:0.6, delay:0.5+i*0.12, ease:[0.16,1,0.3,1] } }),
};

/* ── Landing ─────────────────────────────────────────────────────── */
const Landing = () => {
  const [tipDetails, setTipDetails] = useState('');
  const [zoneId, setZoneId]         = useState('');
  const [success, setSuccess]       = useState(false);
  const [loading, setLoading]       = useState(false);
  const [mounted, setMounted]       = useState(false);
  useEffect(() => setMounted(true), []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post('/api/public/tip', {
        details: tipDetails, severity: 'CRITICAL', zone_id: zoneId || 'Z_S_1',
      });
      setSuccess(true); setTipDetails(''); setZoneId('');
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) { console.error('Tip submission failed', err); }
    finally { setLoading(false); }
  };

  const stats = [
    { num: 20,   suffix: '',  label: 'ACTIVE ZONES' },
    { num: 1975, suffix: '',  label: 'EVENTS TRACKED' },
    { num: 97,   suffix: '%', label: 'MODEL ACCURACY' },
  ];

  return (
    <>
      {/* Grain + Cursor */}
      <div className="grain-layer" aria-hidden />
      <Cursor />

      <AnimatePresence mode="wait">
        <motion.div
          key="landing"
          className="landing-container"
          variants={pageVars}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {/* Header */}
          <header className="lnd-header">
            <motion.div className="lnd-wordmark"
              initial={{ opacity:0, y:-12 }} animate={{ opacity:1, y:0 }}
              transition={{ duration:0.6, ease:[0.16,1,0.3,1] }}>
              SENT<em>I</em>NEL
            </motion.div>
            <motion.div className="lnd-status"
              initial={{ opacity:0 }} animate={{ opacity:1 }}
              transition={{ delay:0.4, duration:0.5 }}>
              <span className="lnd-pulse" />
              SYSTEM LIVE — MUMBAI
            </motion.div>
          </header>

          {/* Left: Hero */}
          <motion.div className="splash-zone"
            variants={leftVars} initial="hidden" animate="visible">

            <h1 className="giant-text">
              ZERO <span className="neon-highlight">GAPS.</span><br />
              REAL-TIME <span className="neon-highlight">INTEL.</span>
            </h1>

            <motion.p className="sub-text"
              initial={{ opacity:0 }} animate={{ opacity:1 }}
              transition={{ delay:0.7, duration:0.7, ease:[0.16,1,0.3,1] }}>
              THE APEX PREDICTIVE POLICING ENGINE.<br />
              BUILT FOR MUMBAI. DESIGNED FOR VELOCITY.
            </motion.p>

            <div className="splash-stats">
              {stats.map((s, i) => (
                <motion.div key={s.label} className="stat-pill"
                  variants={statVars} custom={i} initial="hidden" animate="visible">
                  <span className="stat-num">
                    {mounted ? <CountUp to={s.num} duration={1400 + i * 200} /> : '0'}{s.suffix}
                  </span>
                  <span className="stat-label">{s.label}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Right: Glass form */}
          <motion.div className="form-zone"
            variants={rightVars} initial="hidden" animate="visible">
            <Magnetic strength={0.15}>
              <div className="brutal-card tip-card">
                <div className="card-header">
                  <AlertTriangle className="alert-icon" size={28} />
                  <h2>ANONYMOUS TIP INTAKE</h2>
                </div>

                <AnimatePresence mode="wait">
                  {success ? (
                    <motion.div key="success" className="success-state"
                      initial={{ opacity:0, scale:0.92, y:10 }}
                      animate={{ opacity:1, scale:1,    y:0  }}
                      exit   ={{ opacity:0, scale:0.95       }}
                      transition={{ duration:0.45, ease:[0.16,1,0.3,1] }}>
                      <motion.div
                        initial={{ scale:0, rotate:-30 }}
                        animate={{ scale:1, rotate:0   }}
                        transition={{ type:'spring', stiffness:300, damping:20, delay:0.1 }}>
                        <CheckCircle size={56} className="success-icon" />
                      </motion.div>
                      <h3>INTEL RECEIVED.</h3>
                      <p>SIGNAL SECURED AND ROUTED TO COMMAND CENTER.</p>
                    </motion.div>
                  ) : (
                    <motion.form key="form" className="tip-form"
                      onSubmit={handleSubmit}
                      initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
                      exit   ={{ opacity:0, y:-8 }}
                      transition={{ duration:0.35, ease:[0.16,1,0.3,1] }}>

                      <div className="input-group">
                        <label htmlFor="tip-details">INCIDENT DETAILS (ANONYMOUS)</label>
                        <textarea id="tip-details" className="brutal-input brutal-textarea"
                          placeholder="Describe the incident..."
                          value={tipDetails}
                          onChange={e => setTipDetails(e.target.value)}
                          required rows={4} />
                      </div>

                      <div className="input-group">
                        <label htmlFor="zone-select">LOCATION / ZONE</label>
                        <select id="zone-select" className="brutal-input"
                          value={zoneId} onChange={e => setZoneId(e.target.value)} required>
                          <option value="" disabled>SELECT A ZONE...</option>
                          <option value="Z_S_1">Z_S_1 — Colaba / Nariman Point</option>
                          <option value="Z_S_2">Z_S_2 — Byculla / Parel</option>
                          <option value="Z_W_1">Z_W_1 — Bandra / Khar</option>
                          <option value="Z_W_2">Z_W_2 — Andheri / Juhu</option>
                          <option value="Z_E_1">Z_E_1 — Kurla / Chembur</option>
                        </select>
                      </div>

                      <Magnetic strength={0.2}>
                        <button type="submit" className="brutal-btn submit-btn" disabled={loading}>
                          <Send size={16} />
                          {loading ? 'TRANSMITTING...' : 'TRANSMIT INTEL'}
                        </button>
                      </Magnetic>
                    </motion.form>
                  )}
                </AnimatePresence>
              </div>
            </Magnetic>
          </motion.div>

          {/* Footer */}
          <footer className="lnd-footer">
            <span>SENTINEL © 2026 — PREDICTIVE CRIME ANALYTICS</span>
            <span>MUMBAI METRO REGION // v3.0</span>
          </footer>
        </motion.div>
      </AnimatePresence>
    </>
  );
};

export default Landing;
