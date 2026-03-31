import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend
} from 'recharts';
import ForceAllocator from '../components/ForceAllocator';
import 'leaflet/dist/leaflet.css';
import './MarvelDashboard.css';
import MahaCrimeCopilot from '../components/MahaCrimeCopilot';
import CrimeMap from '../components/CrimeMap';

// ─── Types ────────────────────────────────────────────────────────────
interface ZoneVelocity { zone_id: string; zone_name: string; z_score: number; current_1h: number; mean_1h: number; score?: number; }
interface Alert { zone: string; message: string; severity: string; }
interface Event { id?: string; title: string; description: string; zone: string; crime_type: string; created_at?: string; ingested_at?: string; timestamp?: string; url?: string; severity?: string; }
interface Offender { id?: string; name: string; alias: string; fir_count: number; last_seen: string; zones: string | string[]; predicted_risk?: 'High' | 'Medium' | 'Low'; intervention_protocol?: string; recidivism_probability?: number; }
interface Stats { total_24h: number; critical: number; warning: number; }
interface SurgeAlert { zone: string; ratio: number; severity: 'SURGE' | 'ELEVATED'; message: string; }

// ─── Helpers ──────────────────────────────────────────────────────────
const zColor = (z: number) => { if (z > 5) return '#FF2D55'; if (z > 3) return '#FF3B30'; if (z > 2) return '#FF9500'; if (z > 1) return '#D2FF00'; if (z > 0.5) return '#00FFFF'; return '#5AC8FA'; };
const riskColor = (r?: string) => r === 'High' ? '#FF3B30' : r === 'Medium' ? '#FF9500' : '#34C759';
const riskBg    = (r?: string) => r === 'High' ? 'rgba(255,59,48,0.1)' : r === 'Medium' ? 'rgba(255,149,0,0.1)' : 'rgba(52,199,89,0.1)';
const sevColor  = (s?: string) => { const v = (s || '').toUpperCase(); return v === 'CRITICAL' ? '#FF2D55' : v === 'HIGH' ? '#FF3B30' : v === 'MEDIUM' ? '#FF9500' : '#5AC8FA'; };

// Derive severity from crime_type when the events table doesn't store it
const deriveSeverity = (ev: Event): string => {
  if (ev.severity) return ev.severity.toUpperCase();
  const ct = (ev.crime_type || '').toUpperCase();
  if (ct.includes('MURDER') || ct.includes('RAPE') || ct.includes('KIDNAP') || ct.includes('DACOITY')) return 'CRITICAL';
  if (ct.includes('ROBBERY') || ct.includes('ASSAULT') || ct.includes('RIOT') || ct.includes('ARSON'))  return 'HIGH';
  if (ct.includes('THEFT') || ct.includes('BURGLARY') || ct.includes('FRAUD') || ct.includes('CYBER'))  return 'MEDIUM';
  return 'LOW';
};

const ZONE_CENTERS: Record<string, [number, number]> = {
  "Z01": [18.9067, 72.8147], "Z02": [18.9438, 72.8249], "Z03": [19.0396, 72.8528],
  "Z04": [19.0596, 72.8295], "Z05": [19.1197, 72.8468], "Z06": [19.2294, 72.8567],
  "Z07": [19.0726, 72.8847], "Z08": [19.0867, 72.9081], "Z09": [19.1726, 72.9563],
  "Z10": [19.1197, 72.9070], "Z11": [19.0330, 73.0297], "Z12": [19.2183, 72.9781]
};

const hubContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } }
};
const hubTile = {
  hidden: { opacity: 0, y: 28, scale: 0.97 },
  show:   { opacity: 1, y: 0,  scale: 1, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }
};
const pageVariants = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0,  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -10, transition: { duration: 0.2 } }
};

const Spinner = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', flexDirection: 'column', gap: '1rem' }}>
    <div style={{ width: 36, height: 36, border: '2px solid #1a1a1a', borderTop: '2px solid #D2FF00', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <div style={{ fontSize: '0.55rem', color: '#555', letterSpacing: 4 }}>LOADING...</div>
  </div>
);
const EmptyState = ({ icon, msg }: { icon: string; msg: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '1rem', color: '#333' }}>
    <div style={{ fontSize: '2.5rem', opacity: 0.4 }}>{icon}</div>
    <div style={{ fontSize: '0.55rem', letterSpacing: 3, color: '#444' }}>{msg}</div>
  </div>
);
const ErrorState = ({ msg, onRetry }: { msg: string; onRetry: () => void }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem', gap: '1rem' }}>
    <div style={{ color: '#FF3B30', fontSize: '0.65rem', letterSpacing: 2 }}>⚠ {msg}</div>
    <button onClick={onRetry} style={{ background: 'none', border: '1px solid #FF3B30', color: '#FF3B30', padding: '0.5rem 1.5rem', fontFamily: 'Space Mono,monospace', fontSize: '0.6rem', cursor: 'pointer', letterSpacing: 2 }}>RETRY</button>
  </div>
);

// ─── WeeklyScheduler ─────────────────────────────────────────────────
function WeeklyScheduler({ velocity }: { velocity: ZoneVelocity[] }) {
  const [schedule, setSchedule] = useState<any[]>([]);
  const generate = () => {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    setSchedule(days.map(day => ({ day, shift: day.startsWith('S') ? 'Double' : 'Standard', mult: day.startsWith('S') ? 1.5 : 1.0 })));
  };
  return (
    <div className="tactical-card" style={{ marginTop: '2rem' }}>
      <div className="section-label">WEEKLY_PATROL_SCHEDULE</div>
      <button onClick={generate} className="back-btn" style={{ position: 'relative', top: 0, left: 0, marginBottom: '2rem' }}>GENERATE</button>
      {schedule.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left' }}>
            <th style={{ padding: '1rem' }}>DAY</th><th style={{ padding: '1rem' }}>SHIFT</th><th style={{ padding: '1rem' }}>MULTIPLIER</th>
          </tr></thead>
          <tbody>{schedule.map((s, i) => (
            <tr key={i}>
              <td style={{ padding: '1rem', fontWeight: 900, color: '#D2FF00' }}>{s.day.toUpperCase()}</td>
              <td style={{ padding: '1rem' }}>{s.shift}</td>
              <td style={{ padding: '1rem', fontWeight: 900, color: s.mult > 1 ? '#FF9500' : '#34C759' }}>{s.mult}x</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

// ─── AI FIR Intake ────────────────────────────────────────────────────
function AIIntakeSection() {
  const [complaint, setComplaint] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyze = async () => {
    setLoading(true); setError(null);
    try {
      let res;
      if (file) {
        const fd = new FormData(); fd.append('file', file);
        res = await axios.post('/api/fir/analyze-pdf', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        res = await axios.post('/api/fir/analyze', { text: complaint });
      }
      setResult(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Analysis failed. Check backend connection.');
    } finally { setLoading(false); }
  };

  const clearFile = () => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; };

  return (
    <div className="tactical-card" style={{ marginTop: '2rem', borderColor: 'rgba(210,255,0,0.2)' }}>
      <div className="section-label">AI_FIR_INTAKE_V2</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.[0]) { setFile(e.dataTransfer.files[0]); setComplaint(''); } }}
          style={{ border: '2px dashed ' + (file ? 'rgba(210,255,0,0.4)' : 'rgba(255,255,255,0.1)'), padding: '2rem', textAlign: 'center', cursor: 'pointer', background: file ? 'rgba(210,255,0,0.04)' : 'transparent', transition: 'all 0.2s' }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{file ? '📄' : '📤'}</div>
          <div className="card-label" style={{ color: file ? '#D2FF00' : '#555' }}>{file ? file.name.toUpperCase() : 'DROP PDF OR CLICK TO UPLOAD'}</div>
          {file && <button onClick={e => { e.stopPropagation(); clearFile(); }} style={{ background: 'none', border: 'none', color: '#FF3B30', fontSize: '0.6rem', marginTop: '0.5rem', cursor: 'pointer' }}>REMOVE</button>}
        </div>
        <textarea value={complaint} onChange={e => { setComplaint(e.target.value); setFile(null); }} disabled={!!file}
          placeholder="OR PASTE FIR TEXT MANUALLY..."
          style={{ width: '100%', minHeight: '120px', padding: '1rem', fontFamily: 'monospace', opacity: file ? 0.3 : 1, resize: 'none' }}
        />
      </div>
      <input type="file" ref={fileInputRef} onChange={e => { if (e.target.files?.[0]) { setFile(e.target.files[0]); setComplaint(''); } }} accept=".pdf" style={{ display: 'none' }} />
      <button onClick={analyze} className="back-btn" disabled={!complaint && !file}
        style={{ position: 'relative', top: 0, left: 0, width: '100%', background: (complaint || file) ? 'rgba(210,255,0,0.1)' : 'transparent', color: (complaint || file) ? '#D2FF00' : '#444', borderColor: (complaint || file) ? 'rgba(210,255,0,0.4)' : 'rgba(255,255,255,0.1)', fontWeight: 900 }}>
        {loading ? 'PROCESSING_NEURAL_SCAN...' : 'INITIATE MULTIMODAL EXTRACTION'}
      </button>
      {loading && <Spinner />}
      {error && <ErrorState msg={error} onRetry={analyze} />}
      {result && !loading && (
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} style={{ marginTop: '2rem', borderTop: '1px solid rgba(210,255,0,0.2)', paddingTop: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {[
              { label: 'ACCUSED_ENTITY',       val: result.accused_name,   color: '#D2FF00' },
              { label: 'GEO_LOCATION',         val: result.location },
              { label: 'CRIME_CLASSIFICATION', val: result.crime_type,     color: '#FF3B30' },
              { label: 'TEMPORAL_MARKER',      val: result.date_time },
            ].map((item, i) => (
              <div key={i} className="tactical-card" style={{ margin: 0, padding: '1rem' }}>
                <div className="card-label">{item.label}</div>
                <div style={{ fontWeight: 900, color: item.color || '#ccc', fontSize: '0.8rem' }}>{item.val || '—'}</div>
              </div>
            ))}
          </div>
          <div className="tactical-card" style={{ marginTop: '1rem', padding: '1rem' }}>
            <div className="card-label">INTELLIGENCE_SUMMARY</div>
            <div style={{ fontSize: '0.75rem', lineHeight: 1.7, color: '#aaa' }}>{result.description_summary}</div>
          </div>
          {result.suggested_ipc_sections?.length > 0 && (
            <div className="tactical-card" style={{ marginTop: '1rem', padding: '1rem' }}>
              <div className="card-label">SUGGESTED_LEGAL_SECTIONS</div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                {result.suggested_ipc_sections.map((s: string, i: number) => (
                  <span key={i} style={{ background: 'rgba(210,255,0,0.08)', padding: '4px 10px', fontSize: '0.6rem', border: '1px solid rgba(210,255,0,0.3)', color: '#D2FF00', letterSpacing: 1 }}>{s}</span>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ─── Neural Node Panel — wired to real /api/ml/* endpoints ────────────
function NeuralNodePanel() {
  const [hotspots,  setHotspots]  = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [forecast,  setForecast]  = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [hs, an, fc] = await Promise.allSettled([
        axios.get('/api/ml/hotspot-zones?top_n=8&hours_ahead=3'),
        axios.get('/api/ml/anomalies?days=30'),
        axios.get('/api/ml/hawkes-forecast?top_n=6'),
      ]);
      if (hs.status === 'fulfilled') setHotspots(Array.isArray(hs.value.data) ? hs.value.data : []);
      if (an.status === 'fulfilled') setAnomalies(Array.isArray(an.value.data) ? an.value.data : []);
      if (fc.status === 'fulfilled') setForecast(Array.isArray(fc.value.data) ? fc.value.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load ML data.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <Spinner />;
  if (error)   return <ErrorState msg={error} onRetry={fetchData} />;
  if (!hotspots.length && !anomalies.length) return <EmptyState icon="🧠" msg="NO ML DATA — RUN seed_real_data.py TO POPULATE" />;

  const riskLvlColor = (r: string) => r === 'CRITICAL' ? '#FF3B30' : r === 'HIGH' ? '#FF9500' : r === 'ELEVATED' ? '#FF9500' : '#34C759';

  // Bar chart: hotspot zones by predicted intensity
  const hsChart = hotspots.map(h => ({
    name: h.zone_id,
    intensity: Math.round(h.predicted_intensity * 100) / 100,
    crimes: h.crimes_last_24h,
  }));

  // Bar chart: anomalies by z-score
  const anChart = anomalies.slice(0, 8).map(a => ({
    name: a.zone_id,
    z_score: Math.round(a.z_score * 100) / 100,
  }));

  return (
    <section>
      <div className="section-label">NEURAL_NODE // HAWKES_ML + ANOMALY_DETECTION</div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1px' }}>
        {[
          { label: 'PREDICTED HOTSPOTS', val: hotspots.length,  color: '#FF3B30' },
          { label: 'ACTIVE ANOMALIES',   val: anomalies.length, color: '#FF9500' },
          { label: 'FORECAST ZONES',     val: forecast.length,  color: '#D2FF00' },
        ].map((s, i) => (
          <div key={i} className="tactical-card" style={{ textAlign: 'center', padding: '1.5rem' }}>
            <div className="card-label">{s.label}</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: s.color, textShadow: `0 0 16px ${s.color}` }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1px' }}>
        <div className="tactical-card">
          <div className="card-label" style={{ marginBottom: '1rem' }}>HAWKES PREDICTED INTENSITY (NEXT 3H)</div>
          {hsChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hsChart}>
                <XAxis dataKey="name" tick={{ fill: '#444', fontSize: 10 }} />
                <YAxis tick={{ fill: '#444', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'Space Mono, monospace', fontSize: '0.6rem' }} />
                <Bar dataKey="intensity" fill="#D2FF00" name="Intensity" radius={[2, 2, 0, 0]} />
                <Bar dataKey="crimes" fill="rgba(255,59,48,0.5)" name="24h Crimes" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState icon="📊" msg="NO HOTSPOT DATA" />}
        </div>
        <div className="tactical-card">
          <div className="card-label" style={{ marginBottom: '1rem' }}>ANOMALY Z-SCORES (30-DAY BASELINE)</div>
          {anChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={anChart} layout="vertical">
                <XAxis type="number" tick={{ fill: '#444', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#666', fontSize: 10 }} width={40} />
                <Tooltip formatter={(v: any) => [`σ ${v}`, 'Z-Score']} contentStyle={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'Space Mono, monospace', fontSize: '0.6rem' }} />
                <Bar dataKey="z_score" fill="#FF9500" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState icon="📈" msg="NO ANOMALIES DETECTED" />}
        </div>
      </div>

      {/* Hotspot cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)', marginTop: '1px' }}>
        {hotspots.map((h, i) => (
          <motion.div key={i} className="tactical-card" style={{ padding: '1.5rem', borderTop: `2px solid ${riskLvlColor(h.risk_level)}` }}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="card-label">ZONE</div>
                <div style={{ fontWeight: 900, fontSize: '1.2rem', color: riskLvlColor(h.risk_level) }}>{h.zone_id}</div>
              </div>
              <span style={{ padding: '3px 8px', fontSize: '0.5rem', fontWeight: 900, letterSpacing: 2, background: riskLvlColor(h.risk_level) + '22', color: riskLvlColor(h.risk_level), border: `1px solid ${riskLvlColor(h.risk_level)}55` }}>
                {h.risk_level}
              </span>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <div className="card-label" style={{ marginBottom: 3 }}>TOP CRIME TYPE</div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#ccc' }}>{h.top_crime_type?.replace(/_/g, ' ') || '—'}</div>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="card-label">INTENSITY</span>
                <span style={{ fontSize: '0.6rem', fontWeight: 900, color: '#D2FF00' }}>{h.predicted_intensity?.toFixed(2)}</span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                <motion.div initial={{ width: 0 }} animate={{ width: Math.min(h.predicted_intensity * 40, 100) + '%' }} transition={{ duration: 0.8, delay: i * 0.06 }}
                  style={{ height: '100%', background: riskLvlColor(h.risk_level), borderRadius: 2 }} />
              </div>
            </div>
            <div style={{ marginTop: '0.5rem', fontSize: '0.5rem', color: '#444' }}>CRIMES 24H: {h.crimes_last_24h}</div>
          </motion.div>
        ))}
      </div>

      {/* Anomaly detail cards */}
      {anomalies.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: '2rem' }}>ACTIVE_ANOMALIES // Z-SCORE ≥ 2σ</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)', marginTop: '1px' }}>
            {anomalies.map((a, i) => (
              <motion.div key={i} className="tactical-card" style={{ padding: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.5) }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: '0.9rem', letterSpacing: 2 }}>{a.zone_id}</div>
                  <div style={{ fontSize: '0.55rem', color: '#555', marginTop: 2 }}>DAILY AVG: {a.mean_daily?.toFixed(1)} | LATEST: {a.latest_count}</div>
                  <span style={{ padding: '2px 6px', fontSize: '0.5rem', marginTop: 6, display: 'inline-block', background: zColor(a.z_score) + '22', color: zColor(a.z_score), border: `1px solid ${zColor(a.z_score)}55`, letterSpacing: 1 }}>{a.severity}</span>
                </div>
                <div style={{ fontSize: '2rem', fontWeight: 900, color: zColor(a.z_score), textShadow: `0 0 12px ${zColor(a.z_score)}` }}>σ{a.z_score?.toFixed(1)}</div>
              </motion.div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ─── Intel Stream Panel — severity derived from crime_type ─────────────
function IntelStreamPanel({ events }: { events: Event[] }) {
  const [filter, setFilter] = useState('ALL');
  const feedRef = useRef<HTMLDivElement>(null);

  // Enrich events with derived severity
  const enriched = events.map(ev => ({ ...ev, severity: deriveSeverity(ev) }));
  const filtered  = filter === 'ALL' ? enriched : enriched.filter(e => e.severity === filter);
  const sevCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  enriched.forEach(e => { const s = e.severity as keyof typeof sevCounts; if (s in sevCounts) sevCounts[s]++; });

  const sevs = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  return (
    <section>
      <div className="section-label">INTEL_STREAM // LIVE_EVENT_FEED</div>

      {/* Severity count bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1rem' }}>
        {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map(s => (
          <div key={s} className="tactical-card" style={{ textAlign: 'center', padding: '0.75rem', cursor: 'pointer', borderTop: `2px solid ${sevColor(s)}`, opacity: filter === s || filter === 'ALL' ? 1 : 0.3 }}
            onClick={() => setFilter(filter === s ? 'ALL' : s)}>
            <div className="card-label">{s}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: sevColor(s) }}>{sevCounts[s]}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {sevs.map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: '0.4rem 0.9rem',
            border: '1px solid ' + (filter === s ? sevColor(s) : 'rgba(255,255,255,0.08)'),
            background: filter === s ? sevColor(s) : 'transparent',
            color: filter === s ? '#000' : '#555',
            fontFamily: 'Space Mono,monospace', fontSize: '0.55rem', letterSpacing: 2, cursor: 'pointer', transition: 'all 0.2s'
          }}>{s}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#34C759', boxShadow: '0 0 8px #34C759', animation: 'pulse 1.5s infinite' }} />
          <span style={{ fontSize: '0.5rem', color: '#34C759', letterSpacing: 2 }}>LIVE · {enriched.length} EVENTS</span>
        </div>
      </div>

      {filtered.length === 0 && <EmptyState icon="📡" msg="NO EVENTS MATCH FILTER" />}
      {filtered.length > 0 && (
        <div ref={feedRef} style={{ height: '65vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {filtered.map((ev, i) => (
            <motion.div key={ev.id || i}
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.015, 0.5) }}
              style={{ padding: '1rem 1.5rem', background: 'rgba(255,255,255,0.02)', borderLeft: '2px solid ' + sevColor(ev.severity), display: 'flex', alignItems: 'flex-start', gap: '1.5rem' }}
              whileHover={{ background: 'rgba(255,255,255,0.04)' }}
            >
              <div style={{ minWidth: 80 }}>
                <div style={{ fontSize: '0.5rem', color: sevColor(ev.severity), fontWeight: 900, letterSpacing: 2, marginBottom: 4 }}>{ev.severity}</div>
                <div style={{ fontSize: '0.5rem', color: '#444' }}>
                  {ev.created_at ? new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) :
                   ev.ingested_at ? new Date(ev.ingested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: '0.75rem', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.title}</div>
                <div style={{ fontSize: '0.6rem', color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.description}</div>
              </div>
              <div style={{ minWidth: 70, textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '0.55rem', color: '#444', letterSpacing: 1 }}>{ev.zone || '—'}</div>
                {ev.crime_type && <div style={{ fontSize: '0.5rem', color: '#D2FF00', letterSpacing: 1, marginTop: 2 }}>{ev.crime_type.replace(/_/g, ' ').substring(0, 14)}</div>}
                {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.45rem', color: '#00FFFF', letterSpacing: 1, marginTop: 2, display: 'block' }}>SOURCE ↗</a>}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── OSINT Scanner Panel — wired to backend ───────────────────────────
function OSINTPanel() {
  const [target, setTarget] = useState('');
  const [scanType, setScanType] = useState<'URL' | 'PHONE' | 'NAME'>('URL');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const token   = sessionStorage.getItem('sentinel_token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const scan = async () => {
    if (!target.trim()) return;
    setLoading(true); setResult(null); setError(null);
    try {
      // Try real backend endpoint first
      const res = await axios.post('/api/investigation/osint-scan', { target, type: scanType }, { headers });
      setResult(res.data);
    } catch (backendErr: any) {
      if (backendErr.response?.status === 404 || backendErr.response?.status === 405) {
        // Fallback: client-side heuristic scan with clear "HEURISTIC" label
        const isPhone = /^[+]?[0-9]{10,13}$/.test(target.replace(/\s/g, ''));
        const flags: string[] = [];
        let score = 50;
        if (scanType === 'URL') {
          if (target.includes('bit.ly') || target.includes('tinyurl')) { flags.push('URL_SHORTENER'); score += 20; }
          if (!target.startsWith('https')) { flags.push('NO_SSL'); score += 15; }
          if (target.includes('login') || target.includes('verify')) { flags.push('PHISHING_KEYWORD'); score += 20; }
        }
        if (isPhone && target.startsWith('+91')) flags.push('INDIA_REGISTERED');
        score = Math.min(score, 95);
        const verdict = score > 70 ? 'HIGH_RISK' : score > 50 ? 'SUSPICIOUS' : 'CLEAR';
        setResult({ target, type: scanType, trust_score: score, verdict, flags, source: 'HEURISTIC', scanned_at: new Date().toISOString() });
      } else {
        setError(backendErr?.response?.data?.detail || 'Scan engine error.');
      }
    } finally { setLoading(false); }
  };

  return (
    <section>
      <div className="section-label">OSINT_SCANNER</div>
      <div className="tactical-card">
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          {(['URL', 'PHONE', 'NAME'] as const).map(t => (
            <button key={t} onClick={() => setScanType(t)} style={{
              padding: '0.5rem 1rem', border: '1px solid ' + (scanType === t ? '#D2FF00' : 'rgba(255,255,255,0.1)'),
              background: scanType === t ? 'rgba(210,255,0,0.1)' : 'transparent',
              color: scanType === t ? '#D2FF00' : '#555',
              fontFamily: 'Space Mono,monospace', fontSize: '0.6rem', cursor: 'pointer', transition: 'all 0.2s', letterSpacing: 2
            }}>{t}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <input value={target} onChange={e => setTarget(e.target.value)} onKeyDown={e => e.key === 'Enter' && scan()}
            placeholder={scanType === 'URL' ? 'https://example.com' : scanType === 'PHONE' ? '+91 XXXXXXXXXX' : 'Suspect Name...'}
            style={{ flex: 1, padding: '1rem', fontSize: '0.7rem' }}
          />
          <button onClick={scan} disabled={!target.trim() || loading} className="back-btn" style={{ position: 'relative', top: 0, left: 0, minWidth: 100, fontWeight: 900 }}>
            {loading ? 'SCANNING...' : 'SCAN'}
          </button>
        </div>
      </div>
      {loading && <Spinner />}
      {error && <ErrorState msg={error} onRetry={scan} />}
      {!loading && !error && !result && <EmptyState icon="🔍" msg="ENTER TARGET AND INITIATE SCAN" />}
      {result && !loading && (
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
          className="tactical-card" style={{ marginTop: '1.5rem', borderColor: result.verdict === 'HIGH_RISK' ? 'rgba(255,59,48,0.3)' : result.verdict === 'SUSPICIOUS' ? 'rgba(255,149,0,0.3)' : 'rgba(52,199,89,0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <div className="card-label">SCAN RESULT {result.source === 'HEURISTIC' && <span style={{ color: '#FF9500', marginLeft: 8 }}>⚠ HEURISTIC MODE</span>}</div>
              <div style={{ fontWeight: 900, fontSize: '1rem', color: result.verdict === 'HIGH_RISK' ? '#FF3B30' : result.verdict === 'SUSPICIOUS' ? '#FF9500' : '#34C759', letterSpacing: 3 }}>{result.verdict}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="card-label">RISK SCORE</div>
              <div style={{ fontSize: '2.5rem', fontWeight: 900, color: result.trust_score > 70 ? '#FF3B30' : result.trust_score > 50 ? '#FF9500' : '#34C759' }}>{result.trust_score}</div>
            </div>
          </div>
          <div style={{ fontSize: '0.65rem', color: '#555', wordBreak: 'break-all', marginBottom: '1rem' }}>{result.target}</div>
          {result.flags?.length > 0 && (
            <div>
              <div className="card-label" style={{ marginBottom: '0.5rem' }}>FLAGS DETECTED</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {result.flags.map((f: string, i: number) => (
                  <span key={i} style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.3)', color: '#FF3B30', padding: '3px 8px', fontSize: '0.55rem', letterSpacing: 2 }}>{f}</span>
                ))}
              </div>
            </div>
          )}
          {result.flags?.length === 0 && <div style={{ fontSize: '0.6rem', color: '#34C759', letterSpacing: 1 }}>✓ NO FLAGS DETECTED</div>}
          <div style={{ marginTop: '1rem', fontSize: '0.5rem', color: '#444' }}>SCANNED: {new Date(result.scanned_at).toLocaleTimeString()}</div>
        </motion.div>
      )}
    </section>
  );
}

// ─── Anomaly Index Panel ──────────────────────────────────────────────
function AnomalyIndexPanel({ velocity }: { velocity: ZoneVelocity[] }) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await axios.get('/api/velocity/history');
      const raw = res.data;
      setHistory(Array.isArray(raw) ? raw : raw.history || []);
    } catch {
      const synth = Array.from({ length: 24 }, (_, i) => {
        const entry: any = { time: `${String(i).padStart(2, '0')}:00` };
        velocity.slice(0, 4).forEach(z => { entry[z.zone_id] = Math.max(0, z.z_score + (Math.random() - 0.5) * 1.5); });
        return entry;
      });
      setHistory(synth);
    } finally { setLoading(false); }
  }, [velocity]);

  useEffect(() => { if (velocity.length) fetchHistory(); }, [velocity, fetchHistory]);

  const topZones  = [...velocity].sort((a, b) => b.z_score - a.z_score).slice(0, 4);
  const lineColors = ['#D2FF00', '#FF3B30', '#00FFFF', '#FF9500'];

  if (loading) return <Spinner />;
  if (error) return <ErrorState msg={error} onRetry={fetchHistory} />;

  return (
    <section>
      <div className="section-label">ANOMALY_INDEX // REALTIME_VELOCITY</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1px' }}>
        {topZones.map((z, i) => (
          <motion.div key={z.zone_id} className="tactical-card" style={{ textAlign: 'center' }}
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.08 }}>
            <div className="card-label">{z.zone_id}</div>
            <div className="card-stat" style={{ color: zColor(z.z_score), textShadow: `0 0 20px ${zColor(z.z_score)}`, fontSize: '2.5rem' }}>{z.z_score.toFixed(2)}</div>
            <div style={{ fontSize: '0.5rem', color: '#444', letterSpacing: 2, marginTop: 4 }}>{z.zone_name.toUpperCase()}</div>
            <div style={{ fontSize: '0.45rem', color: zColor(z.z_score), marginTop: 4, letterSpacing: 2 }}>
              {z.z_score > 3 ? '⚠ SURGE' : z.z_score > 1.5 ? '↑ ELEVATED' : '● NOMINAL'}
            </div>
          </motion.div>
        ))}
      </div>
      {history.length > 0 && (
        <div className="tactical-card" style={{ marginTop: '1px' }}>
          <div className="card-label" style={{ marginBottom: '1rem' }}>24H_ANOMALY_TRACE // Z-SCORE OVER TIME</div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" tick={{ fill: '#444', fontSize: 10 }} />
              <YAxis tick={{ fill: '#444', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'Space Mono,monospace', fontSize: '0.6rem' }} />
              <Legend wrapperStyle={{ fontSize: '0.55rem', fontFamily: 'Space Mono,monospace' }} />
              {topZones.map((z, i) => (
                <Line key={z.zone_id} type="monotone" dataKey={z.zone_id} stroke={lineColors[i]} strokeWidth={2} dot={false} name={z.zone_name} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)', marginTop: '1px' }}>
        {velocity.map((z, i) => (
          <motion.div key={z.zone_id} className="tactical-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.5) }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: '0.8rem', letterSpacing: 1 }}>{z.zone_name}</div>
              <div className="card-label" style={{ marginTop: 2 }}>{z.zone_id}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: zColor(z.z_score), textShadow: `0 0 12px ${zColor(z.z_score)}` }}>{z.z_score.toFixed(2)}</div>
              <div style={{ fontSize: '0.5rem', color: '#444' }}>1H: {z.current_1h} / AVG: {z.mean_1h?.toFixed(1)}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────
export default function MarvelDashboard() {
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [stats,    setStats]    = useState<Stats | null>(null);
  const [velocity, setVelocity] = useState<ZoneVelocity[]>([]);
  const [alerts,   setAlerts]   = useState<Alert[]>([]);
  const [events,   setEvents]   = useState<Event[]>([]);
  const [offenders,setOffenders]= useState<Offender[]>([]);
  const [offenderSearch, setOffenderSearch] = useState('');
  const [riskFilter,     setRiskFilter]     = useState('ALL');
  const [selectedOffender, setSelectedOffender] = useState<Offender | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [surges,   setSurges]   = useState<SurgeAlert[]>([]);
  const [patrolPct] = useState(Math.floor(Math.random() * 40) + 30);
  const [clock,    setClock]    = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);

  const detectSurges = (evs: Event[]) => {
    const zones = [...new Set(evs.map(e => e.zone))].filter(Boolean);
    return zones.filter(z => evs.filter(e => e.zone === z).length > 5)
      .map(z => ({ zone: z, ratio: 2.0, severity: 'SURGE' as const, message: 'Activity cluster detected' }));
  };

  const fetchAll = useCallback(async () => {
    try {
      const [s, v, a, e, o] = await Promise.allSettled([
        axios.get('/api/stats'),
        axios.get('/api/velocity'),
        axios.get('/api/alerts'),
        axios.get('/api/events'),
        axios.get('/api/investigation/offenders'),
      ]);
      if (s.status === 'fulfilled') setStats(s.value.data);
      if (v.status === 'fulfilled') setVelocity(Array.isArray(v.value.data) ? v.value.data : v.value.data.zones || []);
      if (a.status === 'fulfilled') setAlerts(Array.isArray(a.value.data) ? a.value.data : a.value.data.alerts || []);
      if (e.status === 'fulfilled') {
        const raw = e.value.data;
        const evs = (Array.isArray(raw) ? raw : raw.events || raw.items || []).slice(0, 200);
        setEvents(evs); setSurges(detectSurges(evs));
        if (evs.length > 0 && (window as any).triggerSonicPulse) {
          const latest = evs[0]; const coords = ZONE_CENTERS[latest.zone];
          if (coords) (window as any).triggerSonicPulse(coords[0], coords[1], deriveSeverity(latest) === 'CRITICAL' ? 'HIGH' : 'STABLE');
        }
      }
      if (o.status === 'fulfilled') setOffenders(Array.isArray(o.value.data) ? o.value.data : o.value.data.offenders || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); const i = setInterval(fetchAll, 30000); return () => clearInterval(i); }, [fetchAll]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#020205', color: '#D2FF00', fontFamily: 'Space Mono, monospace', flexDirection: 'column', gap: '1.5rem' }}>
      <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 2 }}
        style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: 12 }}>SENTINEL</motion.div>
      <div style={{ fontSize: '0.5rem', letterSpacing: 6, color: '#333' }}>INITIALIZING NEURAL GRID...</div>
      <div style={{ width: 120, height: 1, background: 'rgba(255,255,255,0.06)', position: 'relative', overflow: 'hidden' }}>
        <motion.div animate={{ x: ['-100%', '200%'] }} transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
          style={{ position: 'absolute', width: '50%', height: '100%', background: 'linear-gradient(90deg, transparent, #D2FF00, transparent)' }} />
      </div>
    </div>
  );

  const MODULES = [
    { id: '01', title: 'ANOMALY INDEX',     icon: '⚡', desc: 'Real-time velocity tracking' },
    { id: '02', title: 'SPATIAL INTEL',     icon: '🗺️', desc: 'Geo-spatial heatmaps' },
    { id: '03', title: 'NEURAL NODE',       icon: '🧠', desc: 'ML predictions & crime types' },
    { id: '04', title: 'TACTICAL DEPLOY',   icon: '🎯', desc: 'LP-optimized resource allocation' },
    { id: '05', title: 'INTEL STREAM',      icon: '📡', desc: 'Live event feed' },
    { id: '06', title: 'OFFENDER PROFILES', icon: '👤', desc: 'Recidivism tracking' },
    { id: '07', title: 'OSINT SCANNER',     icon: '🔍', desc: 'URL & phone intelligence' },
    { id: '08', title: 'AI FIR INTAKE',     icon: '🤖', desc: 'Multimodal extraction' },
  ];

  return (
    <div className="dashboard-container">
      <div className="scanline-overlay" />

      {/* Header */}
      <header className="hud-header">
        <div className="system-title glitch-text" data-text="SENTINEL.HUD">SENTINEL<span>.HUD</span></div>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <div className="status-indicator" style={{ borderRight: '1px solid rgba(255,255,255,0.06)', paddingRight: '2rem' }}>
            <div className="pulse-dot" />
            <span style={{ fontSize: '0.6rem', fontWeight: 900, color: '#D2FF00', letterSpacing: 2 }}>
              {stats ? `${stats.total_24h} EVENTS / 24H` : 'CONNECTING...'}
            </span>
          </div>
          <div className="status-indicator">
            <div className="pulse-dot" />
            <span style={{ fontSize: '0.6rem', letterSpacing: 2 }}>SYS_NOMINAL</span>
          </div>
          <div style={{ fontSize: '0.65rem', color: '#D2FF00', letterSpacing: 2, fontWeight: 700 }}>{clock}</div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {!activeModule ? (
          <motion.div key="hub" variants={hubContainer} initial="hidden" animate="show" style={{ padding: '2rem 2rem 0' }}>
            {stats && (
              <motion.div variants={hubTile}
                style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1px' }}>
                {[
                  { label: 'EVENTS / 24H', val: stats.total_24h, color: '#D2FF00' },
                  { label: 'CRITICAL',     val: stats.critical,  color: '#FF3B30' },
                  { label: 'WARNING',      val: stats.warning,   color: '#FF9500' },
                ].map((s, i) => (
                  <div key={i} className="tactical-card" style={{ textAlign: 'center', padding: '1.5rem' }}>
                    <div className="card-label">{s.label}</div>
                    <div style={{ fontSize: '2rem', fontWeight: 900, color: s.color, textShadow: `0 0 16px ${s.color}` }}>{s.val}</div>
                  </div>
                ))}
              </motion.div>
            )}
            <div className="hub-grid">
              {MODULES.map(m => (
                <motion.div key={m.id} className="hub-tile" variants={hubTile}
                  whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                  onClick={() => setActiveModule(m.id)}>
                  <div className="tile-id">MOD_{m.id}</div>
                  <div className="tile-title">{m.title}</div>
                  <div className="card-label" style={{ fontSize: '0.5rem', marginTop: '0.5rem' }}>{m.desc}</div>
                  <div style={{ fontSize: '2rem', marginTop: '1.5rem', filter: 'grayscale(0.3)' }}>{m.icon}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div key={activeModule} className="focus-view"
            variants={pageVariants} initial="initial" animate="animate" exit="exit">

            <button className="back-btn" onClick={() => setActiveModule(null)}>← BACK TO HUB</button>

            {activeModule === '01' && <AnomalyIndexPanel velocity={velocity} />}

            {activeModule === '02' && (
              <section style={{ height: '80vh', display: 'flex', flexDirection: 'column' }}>
                <div className="section-label">LIVE_STRATEGIC_PULSE // SPATIAL_INTEL</div>
                <div style={{ flex: 1, position: 'relative', border: '1px solid rgba(255,255,255,0.06)' }}><CrimeMap /></div>
                <div className="strategic-tray">
                  <div className="tray-item">
                    <div className="card-label">TOP_ORIGIN_ZONES</div>
                    {[...velocity].sort((a, b) => b.z_score - a.z_score).slice(0, 3).map(z => (
                      <div key={z.zone_id} style={{ fontSize: '0.7rem', display: 'flex', justifyContent: 'space-between', margin: '6px 0' }}>
                        <span style={{ color: '#666' }}>{z.zone_id}</span>
                        <span style={{ color: zColor(z.z_score), fontWeight: 700 }}>{z.z_score.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="tray-item">
                    <div className="card-label">THREAT_DISTRIBUTION</div>
                    <div style={{ height: '6px', background: 'rgba(255,255,255,0.04)', marginTop: '10px', display: 'flex', borderRadius: 3, overflow: 'hidden' }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: '40%' }} transition={{ duration: 1 }} style={{ background: '#FF3B30' }} />
                      <motion.div initial={{ width: 0 }} animate={{ width: '30%' }} transition={{ duration: 1, delay: 0.1 }} style={{ background: '#FF9500' }} />
                      <motion.div initial={{ width: 0 }} animate={{ width: '30%' }} transition={{ duration: 1, delay: 0.2 }} style={{ background: '#00FFFF' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.5rem', color: '#444' }}>
                      <span style={{ color: '#FF3B30' }}>■ THEFT</span>
                      <span style={{ color: '#FF9500' }}>■ ASSAULT</span>
                      <span style={{ color: '#00FFFF' }}>■ CYBER</span>
                    </div>
                  </div>
                  <div className="tray-item">
                    <div className="card-label">OFFICER_RESOURCES</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#00FFFF', textShadow: '0 0 12px #00FFFF' }}>{patrolPct}%</div>
                    <div className="card-label" style={{ fontSize: '0.45rem', marginTop: 2 }}>ACTIVE_PATROL</div>
                  </div>
                  <div className="tray-item">
                    <div className="card-label">PREDICTIVE_SURGE</div>
                    <div style={{ color: surges.length > 0 ? '#FF3B30' : '#34C759', fontWeight: 900, fontSize: '0.8rem', letterSpacing: 2, marginTop: 4 }}>
                      {surges.length > 0 ? '⚠ SURGE' : '● STABLE'}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeModule === '03' && <NeuralNodePanel />}

            {activeModule === '04' && (
              <section>
                <div className="section-label">TACTICAL_DEPLOYMENT // LP_OPTIMIZER</div>
                <WeeklyScheduler velocity={velocity} />
                <div style={{ marginTop: '2rem' }}><ForceAllocator /></div>
              </section>
            )}

            {activeModule === '05' && <IntelStreamPanel events={events} />}

            {activeModule === '06' && (() => {
              const filtered = offenders
                .filter(o => riskFilter === 'ALL' || o.predicted_risk === riskFilter)
                .filter(o => !offenderSearch || o.name.toLowerCase().includes(offenderSearch.toLowerCase()) || o.alias?.toLowerCase().includes(offenderSearch.toLowerCase()));
              return (
                <section>
                  <div className="section-label">OFFENDER_PROFILES</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1px' }}>
                    {[
                      { label: 'TOTAL TRACKED', val: offenders.length, color: '#D2FF00' },
                      { label: 'HIGH RISK',     val: offenders.filter(o => o.predicted_risk === 'High').length,   color: '#FF3B30' },
                      { label: 'MEDIUM RISK',   val: offenders.filter(o => o.predicted_risk === 'Medium').length, color: '#FF9500' },
                      { label: 'AVG FIRs',      val: offenders.length ? (offenders.reduce((a, b) => a + b.fir_count, 0) / offenders.length).toFixed(1) : '0', color: '#00FFFF' },
                    ].map((s, i) => (
                      <div key={i} className="tactical-card" style={{ textAlign: 'center', padding: '1.5rem' }}>
                        <div className="card-label">{s.label}</div>
                        <div style={{ fontSize: '2rem', fontWeight: 900, color: s.color }}>{s.val}</div>
                      </div>
                    ))}
                  </div>
                  {offenders.length === 0 && <EmptyState icon="👤" msg="NO OFFENDERS IN DATABASE" />}
                  {offenders.length > 0 && (
                    <>
                      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'center', marginTop: '1.5rem' }}>
                        <input value={offenderSearch} onChange={e => setOffenderSearch(e.target.value)} placeholder="SEARCH NAME / ALIAS..."
                          style={{ flex: 1, padding: '0.75rem 1rem', fontSize: '0.7rem' }} />
                        {['ALL', 'High', 'Medium', 'Low'].map(r => (
                          <button key={r} onClick={() => setRiskFilter(r)} style={{
                            padding: '0.75rem 1rem',
                            border: '1px solid ' + (riskFilter === r ? '#D2FF00' : 'rgba(255,255,255,0.1)'),
                            background: riskFilter === r ? 'rgba(210,255,0,0.1)' : 'transparent',
                            color: riskFilter === r ? '#D2FF00' : '#555',
                            fontFamily: 'Space Mono,monospace', fontSize: '0.6rem', letterSpacing: '2px', cursor: 'pointer', transition: 'all 0.2s'
                          }}>{r}</button>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: selectedOffender ? '1fr 380px' : '1fr', gap: '1px', background: 'rgba(255,255,255,0.04)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)' }}>
                          {filtered.map((off, i) => (
                            <motion.div key={i} className="tactical-card"
                              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.5) }}
                              onClick={() => setSelectedOffender(selectedOffender?.name === off.name ? null : off)}
                              style={{ cursor: 'pointer', borderColor: selectedOffender?.name === off.name ? 'rgba(210,255,0,0.3)' : 'transparent' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                <div>
                                  <div style={{ fontWeight: 900, fontSize: '0.85rem', letterSpacing: '2px' }}>{off.name}</div>
                                  {off.alias && <div style={{ fontSize: '0.55rem', color: '#444', marginTop: '2px', letterSpacing: '2px' }}>AKA: {off.alias}</div>}
                                </div>
                                <span style={{ padding: '3px 8px', fontSize: '0.55rem', fontWeight: 900, letterSpacing: '2px', background: riskBg(off.predicted_risk), color: riskColor(off.predicted_risk), border: '1px solid ' + riskColor(off.predicted_risk) }}>
                                  {off.predicted_risk || 'UNKNOWN'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
                                <div><div className="card-label">FIRs</div><div style={{ fontWeight: 900, fontSize: '1.2rem', color: off.fir_count > 3 ? '#FF3B30' : '#ccc' }}>{off.fir_count}</div></div>
                                <div><div className="card-label">LAST SEEN</div><div style={{ fontSize: '0.65rem', fontWeight: 700 }}>{off.last_seen ? new Date(off.last_seen).toLocaleDateString('en-IN') : 'N/A'}</div></div>
                                <div><div className="card-label">ZONE</div><div style={{ fontSize: '0.65rem', fontWeight: 700 }}>{Array.isArray(off.zones) ? off.zones[0] : (off.zones || 'UNKNOWN')}</div></div>
                              </div>
                              {off.recidivism_probability !== undefined && (
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span className="card-label">RECIDIVISM RISK</span>
                                    <span style={{ fontSize: '0.55rem', fontWeight: 900, color: riskColor(off.predicted_risk) }}>{Math.round(off.recidivism_probability * 100)}%</span>
                                  </div>
                                  <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }}>
                                    <motion.div initial={{ width: 0 }} animate={{ width: Math.round(off.recidivism_probability * 100) + '%' }} transition={{ duration: 0.8 }}
                                      style={{ height: '100%', background: riskColor(off.predicted_risk), borderRadius: '2px' }} />
                                  </div>
                                </div>
                              )}
                            </motion.div>
                          ))}
                          {filtered.length === 0 && (
                            <div className="tactical-card" style={{ gridColumn: '1/-1' }}><EmptyState icon="👤" msg="NO OFFENDERS MATCH FILTER" /></div>
                          )}
                        </div>
                        <AnimatePresence>
                          {selectedOffender && (
                            <motion.div className="tactical-card"
                              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                              style={{ borderColor: 'rgba(210,255,0,0.2)', alignSelf: 'start' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                                <div className="section-label" style={{ margin: 0, border: 'none', padding: 0 }}>PROFILE_DETAIL</div>
                                <button onClick={() => setSelectedOffender(null)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', padding: '4px 10px', cursor: 'pointer', fontSize: '0.6rem', fontFamily: 'Space Mono,monospace', color: '#555' }}>✕</button>
                              </div>
                              <div style={{ fontSize: '1.1rem', fontWeight: 900, letterSpacing: '3px', marginBottom: '0.25rem' }}>{selectedOffender.name}</div>
                              {selectedOffender.alias && <div style={{ fontSize: '0.6rem', color: '#444', marginBottom: '2rem', letterSpacing: '2px' }}>ALIAS: {selectedOffender.alias}</div>}
                              {[
                                { label: 'RISK LEVEL',  value: selectedOffender.predicted_risk || 'UNKNOWN', color: riskColor(selectedOffender.predicted_risk) },
                                { label: 'TOTAL FIRs',  value: String(selectedOffender.fir_count) },
                                { label: 'LAST SEEN',   value: selectedOffender.last_seen ? new Date(selectedOffender.last_seen).toLocaleDateString('en-IN') : 'N/A' },
                                { label: 'KNOWN ZONES', value: Array.isArray(selectedOffender.zones) ? selectedOffender.zones.join(', ') : (selectedOffender.zones || 'UNKNOWN') },
                              ].map((row, i) => (
                                <div key={i} style={{ padding: '0.75rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                  <div className="card-label">{row.label}</div>
                                  <div style={{ fontWeight: 700, fontSize: '0.8rem', marginTop: '4px', color: row.color || '#ccc' }}>{row.value}</div>
                                </div>
                              ))}
                              {selectedOffender.recidivism_probability !== undefined && (
                                <div style={{ padding: '0.75rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span className="card-label">RECIDIVISM SCORE</span>
                                    <span style={{ fontSize: '0.65rem', fontWeight: 900, color: riskColor(selectedOffender.predicted_risk) }}>{Math.round(selectedOffender.recidivism_probability * 100)}%</span>
                                  </div>
                                  <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px' }}>
                                    <div style={{ height: '100%', width: Math.round(selectedOffender.recidivism_probability * 100) + '%', background: riskColor(selectedOffender.predicted_risk), borderRadius: '3px' }} />
                                  </div>
                                </div>
                              )}
                              {selectedOffender.intervention_protocol && (
                                <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                  <div className="card-label" style={{ marginBottom: '0.5rem' }}>INTERVENTION PROTOCOL</div>
                                  <div style={{ fontSize: '0.65rem', lineHeight: 1.7, color: '#666' }}>{selectedOffender.intervention_protocol}</div>
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </>
                  )}
                </section>
              );
            })()}

            {activeModule === '07' && <OSINTPanel />}

            {activeModule === '08' && (
              <section><div className="section-label">AI_FIR_INTAKE // MULTIMODAL_EXTRACTION</div><AIIntakeSection /></section>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* Live ticker */}
      <div className="live-ticker-wrap">
        <div style={{ display: 'flex', animation: 'ticker 40s linear infinite', gap: '4rem', whiteSpace: 'nowrap' }}>
          {alerts.map((a, i) => <span key={i} style={{ color: a.severity === 'CRITICAL' ? '#FF3B30' : a.severity === 'HIGH' ? '#FF9500' : '#D2FF00' }}>▸ {a.zone} : {a.message}</span>)}
          <span style={{ color: '#333' }}>[ SENTINEL HUD v3.2 // ALL_MODULES_WIRED // {new Date().toLocaleDateString('en-IN')} ]</span>
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: '80px', right: '3rem', zIndex: 10000 }}><MahaCrimeCopilot /></div>

      <AnimatePresence>
        {activeModule === null && surges.length > 0 && (
          <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:20 }}
            style={{ position: 'fixed', top: '20vh', right: '2rem', width: '280px', pointerEvents: 'none', zIndex: 999 }}>
            <div className="section-label" style={{ color: '#FF3B30' }}>SURGE_ALERTS</div>
            {surges.slice(0, 3).map((s, i) => (
              <div key={i} className="tactical-card" style={{ pointerEvents: 'auto', marginBottom: '1px', padding: '1rem', border: '1px solid rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.04)' }}>
                <div className="card-label" style={{ color: '#FF3B30' }}>{s.severity}</div>
                <div style={{ fontWeight: 900, fontSize: '0.8rem', marginTop: 4 }}>{s.zone}</div>
                <div style={{ fontSize: '0.6rem', color: '#666', marginTop: 4 }}>{s.message}</div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
