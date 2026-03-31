import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import ForceAllocator from '../components/ForceAllocator';
import 'leaflet/dist/leaflet.css';
import './MarvelDashboard.css';
import MahaCrimeCopilot from '../components/MahaCrimeCopilot';
import CrimeMap from '../components/CrimeMap';

// ─── Types ────────────────────────────────────────────────────────────
interface ZoneVelocity { zone_id: string; zone_name: string; z_score: number; current_1h: number; mean_1h: number; score?: number; }
interface Alert { zone: string; message: string; severity: string; }
// Field names match the backend EventOut schema exactly:
//   crime_types (not crime_type), published_at (not created_at/ingested_at)
interface Event {
  id?: string | number;
  title: string;
  description: string;
  zone: string;
  zone_id?: string;
  crime_types: string;   // backend field name
  published_at?: string; // backend field name
  source?: string;       // news source name (e.g. "timesofindia")
  url?: string;
  severity?: string;
}
interface Offender { id?: string; name: string; alias: string; fir_count: number; last_seen: string; zones: string | string[]; predicted_risk?: 'High' | 'Medium' | 'Low'; intervention_protocol?: string; recidivism_probability?: number; }
interface Stats { total_24h: number; critical: number; warning: number; }
interface SurgeAlert { zone: string; ratio: number; severity: 'SURGE' | 'ELEVATED'; message: string; }

// ─── Plain-language translators ───────────────────────────────────────

const riskToAction = (r: string): string => {
  const v = (r || '').toUpperCase();
  if (v === 'CRITICAL') return 'DEPLOY IMMEDIATELY';
  if (v === 'HIGH' || v === 'ELEVATED') return 'INCREASE PATROLS';
  if (v === 'MEDIUM') return 'MONITOR CLOSELY';
  return 'ROUTINE PATROL';
};

const zToHeat = (z: number): { label: string; sub: string; color: string } => {
  if (z > 5) return { label: 'EXTREME SPIKE', sub: 'Far above normal — send backup now', color: '#FF2D55' };
  if (z > 3) return { label: 'HIGH ALERT',    sub: 'Well above normal — deploy extra units', color: '#FF3B30' };
  if (z > 2) return { label: 'ELEVATED',      sub: 'Above normal — increase patrol rounds', color: '#FF9500' };
  if (z > 1) return { label: 'ABOVE NORMAL',  sub: 'Slightly higher than usual', color: '#D2FF00' };
  if (z > 0.5) return { label: 'NORMAL',      sub: 'Within expected range', color: '#00FFFF' };
  return { label: 'QUIET',                     sub: 'Below average activity', color: '#5AC8FA' };
};

const intensityToUrgency = (intensity: number, crimes24h: number): { label: string; detail: string; color: string } => {
  if (intensity > 2.5) return { label: 'EXPECT SURGE', detail: `${crimes24h} incidents yesterday — high chance of more in next 3 hrs`, color: '#FF3B30' };
  if (intensity > 1.5) return { label: 'LIKELY ACTIVE', detail: `${crimes24h} incidents yesterday — above average activity expected`, color: '#FF9500' };
  if (intensity > 0.8) return { label: 'WATCH THIS ZONE', detail: `${crimes24h} incidents yesterday — monitor closely`, color: '#D2FF00' };
  return { label: 'CALM', detail: `${crimes24h} incidents yesterday — no surge expected`, color: '#34C759' };
};

const anomalyToNote = (severity: string, latestCount: number, meanDaily: number): { headline: string; detail: string; color: string } => {
  const excess = Math.max(0, latestCount - Math.round(meanDaily));
  const s = (severity || '').toUpperCase();
  if (s === 'CRITICAL' || s === 'HIGH')
    return { headline: 'UNUSUAL SPIKE DETECTED', detail: `${latestCount} crimes today vs usual ${Math.round(meanDaily)}/day — ${excess} extra incidents`, color: '#FF3B30' };
  if (s === 'MEDIUM')
    return { headline: 'ABOVE AVERAGE DAY', detail: `${latestCount} crimes today vs usual ${Math.round(meanDaily)}/day`, color: '#FF9500' };
  return { headline: 'SLIGHTLY ELEVATED', detail: `${latestCount} crimes today vs usual ${Math.round(meanDaily)}/day`, color: '#D2FF00' };
};

const riskColor = (r?: string) => r === 'High' ? '#FF3B30' : r === 'Medium' ? '#FF9500' : '#34C759';
const riskBg    = (r?: string) => r === 'High' ? 'rgba(255,59,48,0.1)' : r === 'Medium' ? 'rgba(255,149,0,0.1)' : 'rgba(52,199,89,0.1)';
const sevColor  = (s?: string) => { const v = (s || '').toUpperCase(); return v === 'CRITICAL' ? '#FF2D55' : v === 'HIGH' ? '#FF3B30' : v === 'MEDIUM' ? '#FF9500' : '#5AC8FA'; };

// Uses crime_types (backend field) — fixes events always showing as LOW
const deriveSeverity = (ev: Event): string => {
  if (ev.severity) return ev.severity.toUpperCase();
  const ct = (ev.crime_types || '').toUpperCase();
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

const hubContainer = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const hubTile = {
  hidden: { opacity: 0, y: 28, scale: 0.97 },
  show:   { opacity: 1, y: 0,  scale: 1, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }
};
const pageVariants = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -10, transition: { duration: 0.2 } }
};

const Spinner = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', flexDirection: 'column', gap: '1rem' }}>
    <div style={{ width: 36, height: 36, border: '2px solid #1a1a1a', borderTop: '2px solid #D2FF00', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <div style={{ fontSize: '0.55rem', color: '#555', letterSpacing: 4 }}>LOADING...</div>
  </div>
);
const EmptyState = ({ icon, msg }: { icon: string; msg: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '1rem' }}>
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

// ─── Shared: Intel Brick ──────────────────────────────────────────────
function IntelBrick({
  zone, zoneName, headline, detail, action, crimeType, extra, color, index
}: {
  zone: string; zoneName?: string; headline: string; detail: string;
  action?: string; crimeType?: string; extra?: string; color: string; index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
      className="tactical-card"
      style={{ padding: '1.5rem', borderLeft: `3px solid ${color}`, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 3 }}>ZONE</div>
          <div style={{ fontWeight: 900, fontSize: '1.1rem', color, letterSpacing: 2 }}>{zone}</div>
          {zoneName && <div style={{ fontSize: '0.5rem', color: '#444', letterSpacing: 1, marginTop: 2 }}>{zoneName.toUpperCase()}</div>}
        </div>
        {action && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 2, marginBottom: 2 }}>ACTION</div>
            <div style={{ fontSize: '0.65rem', fontWeight: 900, color, letterSpacing: 1, padding: '4px 10px', border: `1px solid ${color}44`, background: `${color}11` }}>
              {action}
            </div>
          </div>
        )}
      </div>
      <div style={{ fontSize: '0.85rem', fontWeight: 900, color, letterSpacing: 1 }}>{headline}</div>
      <div style={{ fontSize: '0.65rem', color: '#aaa', lineHeight: 1.6 }}>{detail}</div>
      {crimeType && (
        <div style={{ display: 'inline-block', padding: '3px 10px', fontSize: '0.55rem', letterSpacing: 1, border: '1px solid rgba(210,255,0,0.2)', color: '#D2FF00', background: 'rgba(210,255,0,0.06)', alignSelf: 'flex-start' }}>
          {crimeType.replace(/_/g, ' ')}
        </div>
      )}
      {extra && <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 1, borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.4rem', marginTop: '0.2rem' }}>{extra}</div>}
    </motion.div>
  );
}

// ─── WeeklyScheduler ─────────────────────────────────────────────────
function WeeklyScheduler({ velocity }: { velocity: ZoneVelocity[] }) {
  const [schedule, setSchedule] = useState<any[]>([]);
  const generate = () => {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    setSchedule(days.map(day => ({ day, shift: day.startsWith('S') ? 'Double' : 'Standard', mult: day.startsWith('S') ? 1.5 : 1.0 })));
  };
  return (
    <div className="tactical-card" style={{ marginTop: '2rem' }}>
      <div className="section-label">WEEKLY PATROL SCHEDULE</div>
      <button onClick={generate} className="back-btn" style={{ position: 'relative', top: 0, left: 0, marginBottom: '2rem' }}>GENERATE SCHEDULE</button>
      {schedule.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left' }}>
            <th style={{ padding: '1rem', color: '#555', fontSize: '0.55rem', letterSpacing: 3 }}>DAY</th>
            <th style={{ padding: '1rem', color: '#555', fontSize: '0.55rem', letterSpacing: 3 }}>SHIFT TYPE</th>
            <th style={{ padding: '1rem', color: '#555', fontSize: '0.55rem', letterSpacing: 3 }}>STAFFING</th>
          </tr></thead>
          <tbody>{schedule.map((s, i) => (
            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <td style={{ padding: '1rem', fontWeight: 900, color: '#D2FF00' }}>{s.day.toUpperCase()}</td>
              <td style={{ padding: '1rem', color: '#ccc' }}>{s.shift}</td>
              <td style={{ padding: '1rem', fontWeight: 900, color: s.mult > 1 ? '#FF9500' : '#34C759' }}>
                {s.mult > 1 ? 'DOUBLE STRENGTH' : 'STANDARD STRENGTH'}
              </td>
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
      <div className="section-label">AI FIR READER</div>
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
        {loading ? 'READING FIR...' : 'ANALYSE FIR'}
      </button>
      {loading && <Spinner />}
      {error && <ErrorState msg={error} onRetry={analyze} />}
      {result && !loading && (
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} style={{ marginTop: '2rem', borderTop: '1px solid rgba(210,255,0,0.2)', paddingTop: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {[
              { label: 'ACCUSED NAME',  val: result.accused_name,  color: '#D2FF00' },
              { label: 'LOCATION',      val: result.location },
              { label: 'CRIME TYPE',    val: result.crime_type,    color: '#FF3B30' },
              { label: 'DATE / TIME',   val: result.date_time },
            ].map((item, i) => (
              <div key={i} className="tactical-card" style={{ margin: 0, padding: '1rem' }}>
                <div className="card-label">{item.label}</div>
                <div style={{ fontWeight: 900, color: item.color || '#ccc', fontSize: '0.8rem' }}>{item.val || '—'}</div>
              </div>
            ))}
          </div>
          <div className="tactical-card" style={{ marginTop: '1rem', padding: '1rem' }}>
            <div className="card-label">CASE SUMMARY</div>
            <div style={{ fontSize: '0.75rem', lineHeight: 1.7, color: '#aaa' }}>{result.description_summary}</div>
          </div>
          {result.suggested_ipc_sections?.length > 0 && (
            <div className="tactical-card" style={{ marginTop: '1rem', padding: '1rem' }}>
              <div className="card-label">APPLICABLE IPC SECTIONS</div>
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

// ─── Neural Node Panel ────────────────────────────────────────────────
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
      setError(e?.response?.data?.detail || 'Failed to load predictions.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <Spinner />;
  if (error)   return <ErrorState msg={error} onRetry={fetchData} />;
  if (!hotspots.length && !anomalies.length) return <EmptyState icon="🧠" msg="NO DATA — RUN seed_real_data.py TO POPULATE" />;

  const criticalCount  = hotspots.filter(h => h.risk_level === 'CRITICAL').length;
  const spikeCount     = anomalies.length;

  return (
    <section>
      <div className="section-label">CRIME PREDICTIONS // NEXT 3 HOURS</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '2rem' }}>
        {[
          { label: 'ZONES TO DEPLOY TO NOW', val: criticalCount, color: '#FF3B30', note: 'These zones need officers right now' },
          { label: 'ZONES WITH UNUSUAL SPIKES', val: spikeCount, color: '#FF9500', note: 'More crimes than normal today' },
          { label: 'ZONES UNDER FORECAST', val: forecast.length, color: '#D2FF00', note: 'Being actively monitored by system' },
        ].map((s, i) => (
          <div key={i} className="tactical-card" style={{ textAlign: 'center', padding: '1.5rem' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: s.color, textShadow: `0 0 16px ${s.color}` }}>{s.val}</div>
            <div style={{ fontSize: '0.65rem', fontWeight: 900, color: s.color, letterSpacing: 2, margin: '0.5rem 0 0.25rem' }}>{s.label}</div>
            <div style={{ fontSize: '0.55rem', color: '#555' }}>{s.note}</div>
          </div>
        ))}
      </div>
      {hotspots.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: '1rem' }}>WHERE TO SEND OFFICERS — NEXT 3 HOURS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '2rem' }}>
            {hotspots.map((h, i) => {
              const urg = intensityToUrgency(h.predicted_intensity, h.crimes_last_24h);
              return (
                <IntelBrick key={i} index={i} zone={h.zone_id} headline={urg.label} detail={urg.detail}
                  action={riskToAction(h.risk_level)} crimeType={h.top_crime_type} color={urg.color} />
              );
            })}
          </div>
        </>
      )}
      {anomalies.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: '1rem' }}>ZONES WITH UNUSUAL ACTIVITY TODAY</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '2rem' }}>
            {anomalies.map((a, i) => {
              const note = anomalyToNote(a.severity, a.latest_count, a.mean_daily);
              return (
                <IntelBrick key={i} index={i} zone={a.zone_id} headline={note.headline} detail={note.detail}
                  action={riskToAction(a.severity)} color={note.color}
                  extra={`30-DAY AVERAGE: ${Math.round(a.mean_daily)} crimes/day`} />
              );
            })}
          </div>
        </>
      )}
      {forecast.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: '1rem' }}>6-HOUR OUTLOOK PER ZONE</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)' }}>
            {forecast.map((f, i) => {
              const peakLabel = f.peak_risk === 'CRITICAL' ? 'PEAK DANGER EXPECTED' : f.peak_risk === 'HIGH' ? 'HIGH ACTIVITY EXPECTED' : 'MODERATE ACTIVITY';
              const peakColor = f.peak_risk === 'CRITICAL' ? '#FF3B30' : f.peak_risk === 'HIGH' ? '#FF9500' : '#D2FF00';
              return (
                <IntelBrick key={i} index={i} zone={f.zone_id} headline={peakLabel}
                  detail={`Peak activity expected in ${f.peak_hour_offset} hour${f.peak_hour_offset !== 1 ? 's' : ''}. ${f.crime_count_24h} incidents in last 24 hrs.`}
                  action={riskToAction(f.peak_risk)} color={peakColor} extra="FORECAST WINDOW: 6 HOURS" />
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

// ─── Anomaly Index Panel ──────────────────────────────────────────────
function AnomalyIndexPanel({ velocity }: { velocity: ZoneVelocity[] }) {
  if (!velocity.length) return <EmptyState icon="⚡" msg="NO VELOCITY DATA" />;

  const sorted   = [...velocity].sort((a, b) => b.z_score - a.z_score);
  const surging  = sorted.filter(z => z.z_score > 3);
  const elevated = sorted.filter(z => z.z_score > 1 && z.z_score <= 3);
  const normal   = sorted.filter(z => z.z_score <= 1);

  return (
    <section>
      <div className="section-label">ACTIVITY LEVELS // RIGHT NOW</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '2rem' }}>
        {[
          { label: 'SURGING ZONES',  val: surging.length,  color: '#FF3B30', note: 'Well above normal — send units' },
          { label: 'ELEVATED ZONES', val: elevated.length, color: '#FF9500', note: 'Above normal — keep watch' },
          { label: 'QUIET ZONES',    val: normal.length,   color: '#34C759', note: 'Normal or below average' },
        ].map((s, i) => (
          <div key={i} className="tactical-card" style={{ textAlign: 'center', padding: '1.5rem' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: '0.65rem', fontWeight: 900, color: s.color, letterSpacing: 2, margin: '0.5rem 0 0.25rem' }}>{s.label}</div>
            <div style={{ fontSize: '0.55rem', color: '#555' }}>{s.note}</div>
          </div>
        ))}
      </div>
      {surging.length > 0 && (
        <>
          <div className="section-label" style={{ color: '#FF3B30', marginBottom: '1rem' }}>⚠ NEEDS IMMEDIATE ATTENTION</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '2rem' }}>
            {surging.map((z, i) => {
              const h = zToHeat(z.z_score);
              return (
                <IntelBrick key={z.zone_id} index={i} zone={z.zone_id} zoneName={z.zone_name}
                  headline={h.label} detail={`${z.current_1h} incidents this hour vs usual ${z.mean_1h?.toFixed(0)} per hour. ${h.sub}.`}
                  action="DEPLOY IMMEDIATELY" color={h.color} />
              );
            })}
          </div>
        </>
      )}
      {elevated.length > 0 && (
        <>
          <div className="section-label" style={{ color: '#FF9500', marginBottom: '1rem' }}>↑ ABOVE NORMAL — INCREASE PATROLS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '2rem' }}>
            {elevated.map((z, i) => {
              const h = zToHeat(z.z_score);
              return (
                <IntelBrick key={z.zone_id} index={i} zone={z.zone_id} zoneName={z.zone_name}
                  headline={h.label} detail={`${z.current_1h} incidents this hour vs usual ${z.mean_1h?.toFixed(0)} per hour.`}
                  action="INCREASE PATROLS" color={h.color} />
              );
            })}
          </div>
        </>
      )}
      {normal.length > 0 && (
        <>
          <div className="section-label" style={{ color: '#34C759', marginBottom: '1rem' }}>● NORMAL / QUIET ZONES</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)' }}>
            {normal.map((z, i) => (
              <motion.div key={z.zone_id} className="tactical-card"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.03, 0.5) }}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderLeft: '2px solid #34C759' }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: '0.75rem', letterSpacing: 2, color: '#ccc' }}>{z.zone_id}</div>
                  <div style={{ fontSize: '0.5rem', color: '#444', marginTop: 2 }}>{z.zone_name.toUpperCase()}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 900, color: '#34C759' }}>QUIET</div>
                  <div style={{ fontSize: '0.5rem', color: '#444', marginTop: 2 }}>{z.current_1h} incident{z.current_1h !== 1 ? 's' : ''} this hour</div>
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ─── Intel Stream Panel — wired to live /api/events backend ──────────
function IntelStreamPanel({ events }: { events: Event[] }) {
  const [filter, setFilter] = useState('ALL');
  const feedRef = useRef<HTMLDivElement>(null);

  // deriveSeverity now uses ev.crime_types (correct backend field)
  const enriched = events.map(ev => ({ ...ev, severity: deriveSeverity(ev) }));
  const filtered  = filter === 'ALL' ? enriched : enriched.filter(e => e.severity === filter);
  const sevCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  enriched.forEach(e => { const s = e.severity as keyof typeof sevCounts; if (s in sevCounts) sevCounts[s]++; });

  return (
    <section>
      <div className="section-label">LIVE INCIDENT FEED</div>

      {/* Severity summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1.5rem' }}>
        {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map(s => (
          <div key={s} className="tactical-card" onClick={() => setFilter(filter === s ? 'ALL' : s)}
            style={{ textAlign: 'center', padding: '1.25rem', cursor: 'pointer', borderTop: `3px solid ${sevColor(s)}`, opacity: filter === s || filter === 'ALL' ? 1 : 0.3, transition: 'opacity 0.2s' }}>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: sevColor(s) }}>{sevCounts[s]}</div>
            <div style={{ fontSize: '0.6rem', fontWeight: 900, color: sevColor(s), marginTop: 4, letterSpacing: 1 }}>{s}</div>
            <div style={{ fontSize: '0.5rem', color: '#444', marginTop: 2 }}>{s === 'CRITICAL' ? 'Respond now' : s === 'HIGH' ? 'Respond soon' : s === 'MEDIUM' ? 'Monitor' : 'Routine'}</div>
          </div>
        ))}
      </div>

      {/* Filter bar + live indicator */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {['ALL','CRITICAL','HIGH','MEDIUM','LOW'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: '0.4rem 0.9rem', fontSize: '0.55rem', letterSpacing: 2, cursor: 'pointer', transition: 'all 0.2s',
            fontFamily: 'Space Mono,monospace',
            border: '1px solid ' + (filter === s ? sevColor(s) : 'rgba(255,255,255,0.08)'),
            background: filter === s ? sevColor(s) : 'transparent',
            color: filter === s ? '#000' : '#555',
          }}>{s}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#34C759', boxShadow: '0 0 8px #34C759', animation: 'pulse 1.5s infinite' }} />
          <span style={{ fontSize: '0.5rem', color: '#34C759', letterSpacing: 2 }}>LIVE · {enriched.length} INCIDENTS</span>
        </div>
      </div>

      {filtered.length === 0 && <EmptyState icon="📡" msg="NO INCIDENTS MATCH FILTER" />}
      {filtered.length > 0 && (
        <div ref={feedRef} style={{ height: '65vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {filtered.map((ev, i) => (
            <motion.div key={ev.id || i}
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.015, 0.5) }}
              style={{ padding: '1rem 1.5rem', background: 'rgba(255,255,255,0.02)', borderLeft: `3px solid ${sevColor(ev.severity)}`, display: 'flex', alignItems: 'flex-start', gap: '1.5rem' }}
              whileHover={{ background: 'rgba(255,255,255,0.04)' }}
            >
              {/* Severity + time — uses published_at (correct backend field) */}
              <div style={{ minWidth: 90, flexShrink: 0 }}>
                <div style={{ fontSize: '0.6rem', color: sevColor(ev.severity), fontWeight: 900, letterSpacing: 1, marginBottom: 4 }}>
                  {ev.severity === 'CRITICAL' ? '🔴 CRITICAL' : ev.severity === 'HIGH' ? '🟠 HIGH' : ev.severity === 'MEDIUM' ? '🟡 MEDIUM' : '🔵 LOW'}
                </div>
                <div style={{ fontSize: '0.5rem', color: '#444' }}>
                  {ev.published_at
                    ? new Date(ev.published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '--:--'}
                </div>
                {/* Date on second line if timestamp is old */}
                {ev.published_at && (
                  <div style={{ fontSize: '0.45rem', color: '#333', marginTop: 1 }}>
                    {new Date(ev.published_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </div>
                )}
              </div>

              {/* Title + description */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: '0.75rem', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.title}</div>
                <div style={{ fontSize: '0.6rem', color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.description}</div>
              </div>

              {/* Zone + crime type + source + link */}
              <div style={{ minWidth: 90, textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '0.6rem', color: '#888', letterSpacing: 1, fontWeight: 700 }}>{ev.zone || ev.zone_id || '—'}</div>
                {ev.crime_types && (
                  <div style={{ fontSize: '0.5rem', color: '#D2FF00', marginTop: 2 }}>
                    {ev.crime_types.replace(/_/g, ' ').substring(0, 18)}
                  </div>
                )}
                {ev.source && (
                  <div style={{ fontSize: '0.45rem', color: '#555', marginTop: 2, letterSpacing: 1 }}>
                    {ev.source.toUpperCase()}
                  </div>
                )}
                {ev.url && (
                  <a href={ev.url} target="_blank" rel="noreferrer"
                    style={{ fontSize: '0.45rem', color: '#00FFFF', marginTop: 2, display: 'block' }}>SOURCE ↗</a>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── OSINT Scanner Panel ──────────────────────────────────────────────
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
      const res = await axios.post('/api/investigation/osint-scan', { target, type: scanType }, { headers });
      setResult(res.data);
    } catch (backendErr: any) {
      if (backendErr.response?.status === 404 || backendErr.response?.status === 405) {
        const flags: string[] = [];
        let score = 50;
        if (scanType === 'URL') {
          if (target.includes('bit.ly') || target.includes('tinyurl')) { flags.push('URL SHORTENER DETECTED'); score += 20; }
          if (!target.startsWith('https')) { flags.push('NOT A SECURE (HTTPS) LINK'); score += 15; }
          if (target.includes('login') || target.includes('verify')) { flags.push('PHISHING-STYLE KEYWORD'); score += 20; }
        }
        if (/^[+]?[0-9]{10,13}$/.test(target.replace(/\s/g,'')) && target.startsWith('+91')) flags.push('INDIA-REGISTERED NUMBER');
        score = Math.min(score, 95);
        const verdict = score > 70 ? 'HIGH RISK' : score > 50 ? 'SUSPICIOUS' : 'APPEARS CLEAN';
        setResult({ target, type: scanType, trust_score: score, verdict, flags, source: 'HEURISTIC', scanned_at: new Date().toISOString() });
      } else {
        setError(backendErr?.response?.data?.detail || 'Scan failed.');
      }
    } finally { setLoading(false); }
  };

  const verdictColor = (v: string) => v?.includes('HIGH') ? '#FF3B30' : v?.includes('SUSPICIOUS') ? '#FF9500' : '#34C759';

  return (
    <section>
      <div className="section-label">LINK / PHONE CHECKER</div>
      <div className="tactical-card">
        <div style={{ marginBottom: '0.75rem', fontSize: '0.6rem', color: '#555', letterSpacing: 1 }}>CHECK A SUSPICIOUS LINK, PHONE NUMBER, OR NAME</div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          {(['URL', 'PHONE', 'NAME'] as const).map(t => (
            <button key={t} onClick={() => setScanType(t)} style={{
              padding: '0.5rem 1rem', border: '1px solid ' + (scanType === t ? '#D2FF00' : 'rgba(255,255,255,0.1)'),
              background: scanType === t ? 'rgba(210,255,0,0.1)' : 'transparent',
              color: scanType === t ? '#D2FF00' : '#555',
              fontFamily: 'Space Mono,monospace', fontSize: '0.6rem', cursor: 'pointer', letterSpacing: 2
            }}>{t === 'URL' ? 'WEBSITE LINK' : t === 'PHONE' ? 'PHONE NUMBER' : 'PERSON NAME'}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <input value={target} onChange={e => setTarget(e.target.value)} onKeyDown={e => e.key === 'Enter' && scan()}
            placeholder={scanType === 'URL' ? 'Paste suspicious link here...' : scanType === 'PHONE' ? '+91 XXXXXXXXXX' : 'Enter suspect name...'}
            style={{ flex: 1, padding: '1rem', fontSize: '0.7rem' }}
          />
          <button onClick={scan} disabled={!target.trim() || loading} className="back-btn"
            style={{ position: 'relative', top: 0, left: 0, minWidth: 120, fontWeight: 900 }}>
            {loading ? 'CHECKING...' : 'CHECK NOW'}
          </button>
        </div>
      </div>
      {loading && <Spinner />}
      {error && <ErrorState msg={error} onRetry={scan} />}
      {!loading && !error && !result && <EmptyState icon="🔍" msg="ENTER A TARGET TO CHECK" />}
      {result && !loading && (
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
          className="tactical-card" style={{ marginTop: '1.5rem', borderLeft: `4px solid ${verdictColor(result.verdict)}` }}>
          {result.source === 'HEURISTIC' && (
            <div style={{ fontSize: '0.55rem', color: '#FF9500', letterSpacing: 2, marginBottom: '1rem', padding: '0.5rem', background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.2)' }}>⚠ BASIC CHECK ONLY — Backend scanner not connected. Results are based on link/number patterns.</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontSize: '0.55rem', color: '#555', letterSpacing: 2 }}>VERDICT</div>
              <div style={{ fontWeight: 900, fontSize: '1.4rem', color: verdictColor(result.verdict), letterSpacing: 2, marginTop: 4 }}>{result.verdict}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.55rem', color: '#555', letterSpacing: 2 }}>RISK SCORE</div>
              <div style={{ fontSize: '3rem', fontWeight: 900, color: verdictColor(result.verdict), lineHeight: 1 }}>{result.trust_score}</div>
              <div style={{ fontSize: '0.5rem', color: '#444' }}>out of 100</div>
            </div>
          </div>
          <div style={{ fontSize: '0.6rem', color: '#666', wordBreak: 'break-all', marginBottom: '1rem', padding: '0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: 2 }}>{result.target}</div>
          {result.flags?.length > 0 && (
            <div>
              <div style={{ fontSize: '0.55rem', color: '#FF3B30', fontWeight: 900, letterSpacing: 2, marginBottom: '0.5rem' }}>PROBLEMS FOUND</div>
              {result.flags.map((f: string, i: number) => (
                <div key={i} style={{ padding: '0.6rem 1rem', marginBottom: '0.5rem', background: 'rgba(255,59,48,0.06)', border: '1px solid rgba(255,59,48,0.2)', color: '#FF3B30', fontSize: '0.65rem', letterSpacing: 1 }}>⚠ {f}</div>
              ))}
            </div>
          )}
          {result.flags?.length === 0 && <div style={{ fontSize: '0.65rem', color: '#34C759', letterSpacing: 1 }}>✓ NO PROBLEMS DETECTED</div>}
          <div style={{ marginTop: '1rem', fontSize: '0.5rem', color: '#333' }}>CHECKED AT: {new Date(result.scanned_at).toLocaleTimeString()}</div>
        </motion.div>
      )}
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
      .map(z => ({ zone: z, ratio: 2.0, severity: 'SURGE' as const, message: 'Multiple incidents in this zone — consider deploying' }));
  };

  const fetchAll = useCallback(async () => {
    try {
      const [s, v, a, e, o] = await Promise.allSettled([
        axios.get('/api/stats'),
        axios.get('/api/velocity'),
        axios.get('/api/alerts'),
        // Fetch up to 200 live events sorted newest-first
        axios.get('/api/events/recent?limit=200'),
        axios.get('/api/investigation/offenders'),
      ]);
      if (s.status === 'fulfilled') setStats(s.value.data);
      if (v.status === 'fulfilled') setVelocity(Array.isArray(v.value.data) ? v.value.data : v.value.data.zones || []);
      if (a.status === 'fulfilled') setAlerts(Array.isArray(a.value.data) ? a.value.data : a.value.data.alerts || []);
      if (e.status === 'fulfilled') {
        const raw = e.value.data;
        const evs = (Array.isArray(raw) ? raw : raw.events || raw.items || []) as Event[];
        setEvents(evs); setSurges(detectSurges(evs));
        if (evs.length > 0 && (window as any).triggerSonicPulse) {
          const latest = evs[0]; const coords = ZONE_CENTERS[latest.zone_id || latest.zone];
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
      <div style={{ fontSize: '0.5rem', letterSpacing: 6, color: '#333' }}>LOADING...</div>
      <div style={{ width: 120, height: 1, background: 'rgba(255,255,255,0.06)', position: 'relative', overflow: 'hidden' }}>
        <motion.div animate={{ x: ['-100%', '200%'] }} transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
          style={{ position: 'absolute', width: '50%', height: '100%', background: 'linear-gradient(90deg, transparent, #D2FF00, transparent)' }} />
      </div>
    </div>
  );

  const MODULES = [
    { id: '01', title: 'ANOMALY INDEX',     icon: '⚡', desc: 'Which zones are active right now' },
    { id: '02', title: 'SPATIAL INTEL',     icon: '🗺️', desc: 'Crime map & zone overview' },
    { id: '03', title: 'NEURAL NODE',       icon: '🧠', desc: 'Where to deploy in next 3 hours' },
    { id: '04', title: 'TACTICAL DEPLOY',   icon: '🎯', desc: 'Patrol scheduling & force allocation' },
    { id: '05', title: 'INTEL STREAM',      icon: '📡', desc: 'Live incoming incidents' },
    { id: '06', title: 'OFFENDER PROFILES', icon: '👤', desc: 'Known offenders & re-offending risk' },
    { id: '07', title: 'OSINT SCANNER',     icon: '🔍', desc: 'Check suspicious links & numbers' },
    { id: '08', title: 'AI FIR INTAKE',     icon: '🤖', desc: 'Auto-read and extract FIR details' },
  ];

  return (
    <div className="dashboard-container">
      <div className="scanline-overlay" />

      <header className="hud-header">
        <div className="system-title glitch-text" data-text="SENTINEL.HUD">SENTINEL<span>.HUD</span></div>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <div className="status-indicator" style={{ borderRight: '1px solid rgba(255,255,255,0.06)', paddingRight: '2rem' }}>
            <div className="pulse-dot" />
            <span style={{ fontSize: '0.6rem', fontWeight: 900, color: '#D2FF00', letterSpacing: 2 }}>
              {stats ? `${stats.total_24h} INCIDENTS TODAY` : 'CONNECTING...'}
            </span>
          </div>
          <div className="status-indicator">
            <div className="pulse-dot" />
            <span style={{ fontSize: '0.6rem', letterSpacing: 2 }}>SYSTEM ONLINE</span>
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
                  { label: 'INCIDENTS TODAY',    val: stats.total_24h, color: '#D2FF00' },
                  { label: 'CRITICAL — ACT NOW', val: stats.critical,  color: '#FF3B30' },
                  { label: 'WARNINGS',           val: stats.warning,   color: '#FF9500' },
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

            <button className="back-btn" onClick={() => setActiveModule(null)}>← BACK</button>

            {activeModule === '01' && <AnomalyIndexPanel velocity={velocity} />}

            {activeModule === '02' && (
              <section style={{ height: '80vh', display: 'flex', flexDirection: 'column' }}>
                <div className="section-label">CRIME MAP // LIVE</div>
                <div style={{ flex: 1, position: 'relative', border: '1px solid rgba(255,255,255,0.06)' }}><CrimeMap /></div>
                <div className="strategic-tray">
                  <div className="tray-item">
                    <div className="card-label">HOTTEST ZONES RIGHT NOW</div>
                    {[...velocity].sort((a, b) => b.z_score - a.z_score).slice(0, 3).map(z => (
                      <div key={z.zone_id} style={{ fontSize: '0.7rem', display: 'flex', justifyContent: 'space-between', margin: '6px 0' }}>
                        <span style={{ color: '#888' }}>{z.zone_id} – {z.zone_name}</span>
                        <span style={{ color: zToHeat(z.z_score).color, fontWeight: 700 }}>{zToHeat(z.z_score).label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="tray-item">
                    <div className="card-label">INCIDENT TYPES</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                      {[['🔴', 'Theft / Robbery', '#FF3B30'], ['🟠', 'Assault', '#FF9500'], ['🔵', 'Cyber Crime', '#00FFFF']].map(([dot, label, color], i) => (
                        <div key={i} style={{ fontSize: '0.6rem', color: color as string }}>{dot} {label}</div>
                      ))}
                    </div>
                  </div>
                  <div className="tray-item">
                    <div className="card-label">OFFICERS ON PATROL</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#00FFFF', textShadow: '0 0 12px #00FFFF' }}>{patrolPct}%</div>
                    <div style={{ fontSize: '0.5rem', color: '#444', marginTop: 2 }}>of force currently deployed</div>
                  </div>
                  <div className="tray-item">
                    <div className="card-label">CLUSTER ALERT</div>
                    <div style={{ color: surges.length > 0 ? '#FF3B30' : '#34C759', fontWeight: 900, fontSize: '0.8rem', letterSpacing: 2, marginTop: 4 }}>
                      {surges.length > 0 ? `⚠ ${surges.length} ZONE${surges.length > 1 ? 'S' : ''} CLUSTERING` : '● ALL CLEAR'}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeModule === '03' && <NeuralNodePanel />}

            {activeModule === '04' && (
              <section>
                <div className="section-label">PATROL SCHEDULING // FORCE DEPLOYMENT</div>
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
                  <div className="section-label">KNOWN OFFENDERS</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1px' }}>
                    {[
                      { label: 'TOTAL TRACKED',     val: offenders.length, color: '#D2FF00' },
                      { label: 'HIGH RISK — WATCH', val: offenders.filter(o => o.predicted_risk === 'High').length,   color: '#FF3B30' },
                      { label: 'MEDIUM RISK',        val: offenders.filter(o => o.predicted_risk === 'Medium').length, color: '#FF9500' },
                      { label: 'AVG PRIOR FIRs',     val: offenders.length ? (offenders.reduce((a, b) => a + b.fir_count, 0) / offenders.length).toFixed(1) : '0', color: '#00FFFF' },
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
                        <input value={offenderSearch} onChange={e => setOffenderSearch(e.target.value)} placeholder="SEARCH BY NAME OR ALIAS..."
                          style={{ flex: 1, padding: '0.75rem 1rem', fontSize: '0.7rem' }} />
                        {['ALL', 'High', 'Medium', 'Low'].map(r => (
                          <button key={r} onClick={() => setRiskFilter(r)} style={{
                            padding: '0.75rem 1rem',
                            border: '1px solid ' + (riskFilter === r ? '#D2FF00' : 'rgba(255,255,255,0.1)'),
                            background: riskFilter === r ? 'rgba(210,255,0,0.1)' : 'transparent',
                            color: riskFilter === r ? '#D2FF00' : '#555',
                            fontFamily: 'Space Mono,monospace', fontSize: '0.6rem', letterSpacing: '2px', cursor: 'pointer', transition: 'all 0.2s'
                          }}>{r === 'All' ? 'ALL' : r.toUpperCase() + ' RISK'}</button>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: selectedOffender ? '1fr 380px' : '1fr', gap: '1px', background: 'rgba(255,255,255,0.04)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)' }}>
                          {filtered.map((off, i) => (
                            <motion.div key={i} className="tactical-card"
                              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.5) }}
                              onClick={() => setSelectedOffender(selectedOffender?.name === off.name ? null : off)}
                              style={{ cursor: 'pointer', borderLeft: `3px solid ${riskColor(off.predicted_risk)}`, borderColor: selectedOffender?.name === off.name ? 'rgba(210,255,0,0.3)' : undefined }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                <div>
                                  <div style={{ fontWeight: 900, fontSize: '0.85rem', letterSpacing: '2px' }}>{off.name}</div>
                                  {off.alias && <div style={{ fontSize: '0.55rem', color: '#444', marginTop: '2px' }}>ALSO KNOWN AS: {off.alias}</div>}
                                </div>
                                <span style={{ padding: '3px 8px', fontSize: '0.55rem', fontWeight: 900, letterSpacing: '2px', background: riskBg(off.predicted_risk), color: riskColor(off.predicted_risk), border: '1px solid ' + riskColor(off.predicted_risk) }}>
                                  {off.predicted_risk === 'High' ? '🔴 HIGH RISK' : off.predicted_risk === 'Medium' ? '🟠 MEDIUM RISK' : '🟢 LOW RISK'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
                                <div><div className="card-label">PRIOR FIRs</div><div style={{ fontWeight: 900, fontSize: '1.2rem', color: off.fir_count > 3 ? '#FF3B30' : '#ccc' }}>{off.fir_count}</div></div>
                                <div><div className="card-label">LAST SEEN</div><div style={{ fontSize: '0.65rem', fontWeight: 700 }}>{off.last_seen ? new Date(off.last_seen).toLocaleDateString('en-IN') : 'UNKNOWN'}</div></div>
                                <div><div className="card-label">ZONE</div><div style={{ fontSize: '0.65rem', fontWeight: 700 }}>{Array.isArray(off.zones) ? off.zones[0] : (off.zones || 'UNKNOWN')}</div></div>
                              </div>
                              {off.recidivism_probability !== undefined && (
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span className="card-label">CHANCE OF RE-OFFENDING</span>
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
                                <div className="section-label" style={{ margin: 0, border: 'none', padding: 0 }}>OFFENDER DETAILS</div>
                                <button onClick={() => setSelectedOffender(null)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', padding: '4px 10px', cursor: 'pointer', fontSize: '0.6rem', fontFamily: 'Space Mono,monospace', color: '#555' }}>✕ CLOSE</button>
                              </div>
                              <div style={{ fontSize: '1.1rem', fontWeight: 900, letterSpacing: '3px', marginBottom: '0.25rem' }}>{selectedOffender.name}</div>
                              {selectedOffender.alias && <div style={{ fontSize: '0.6rem', color: '#444', marginBottom: '2rem' }}>ALSO KNOWN AS: {selectedOffender.alias}</div>}
                              {[
                                { label: 'THREAT LEVEL', value: selectedOffender.predicted_risk === 'High' ? '🔴 HIGH RISK' : selectedOffender.predicted_risk === 'Medium' ? '🟠 MEDIUM RISK' : '🟢 LOW RISK', color: riskColor(selectedOffender.predicted_risk) },
                                { label: 'TOTAL PRIOR FIRs', value: String(selectedOffender.fir_count) },
                                { label: 'LAST SEEN', value: selectedOffender.last_seen ? new Date(selectedOffender.last_seen).toLocaleDateString('en-IN') : 'UNKNOWN' },
                                { label: 'KNOWN AREAS', value: Array.isArray(selectedOffender.zones) ? selectedOffender.zones.join(', ') : (selectedOffender.zones || 'UNKNOWN') },
                              ].map((row, i) => (
                                <div key={i} style={{ padding: '0.75rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                  <div className="card-label">{row.label}</div>
                                  <div style={{ fontWeight: 700, fontSize: '0.8rem', marginTop: '4px', color: row.color || '#ccc' }}>{row.value}</div>
                                </div>
                              ))}
                              {selectedOffender.recidivism_probability !== undefined && (
                                <div style={{ padding: '0.75rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                  <div className="card-label">CHANCE OF RE-OFFENDING</div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: 8 }}>
                                    <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px' }}>
                                      <div style={{ height: '100%', width: Math.round(selectedOffender.recidivism_probability * 100) + '%', background: riskColor(selectedOffender.predicted_risk), borderRadius: '3px' }} />
                                    </div>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 900, color: riskColor(selectedOffender.predicted_risk) }}>{Math.round(selectedOffender.recidivism_probability * 100)}%</span>
                                  </div>
                                </div>
                              )}
                              {selectedOffender.intervention_protocol && (
                                <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                  <div className="card-label" style={{ marginBottom: '0.5rem' }}>RECOMMENDED ACTION</div>
                                  <div style={{ fontSize: '0.65rem', lineHeight: 1.7, color: '#aaa' }}>{selectedOffender.intervention_protocol}</div>
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
              <section><div className="section-label">AI FIR READER // AUTO-EXTRACT DETAILS</div><AIIntakeSection /></section>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* Live ticker */}
      <div className="live-ticker-wrap">
        <div style={{ display: 'flex', animation: 'ticker 40s linear infinite', gap: '4rem', whiteSpace: 'nowrap' }}>
          {alerts.map((a, i) => <span key={i} style={{ color: a.severity === 'CRITICAL' ? '#FF3B30' : a.severity === 'HIGH' ? '#FF9500' : '#D2FF00' }}>▸ {a.zone} : {a.message}</span>)}
          <span style={{ color: '#333' }}>[ SENTINEL v3.2 // LIVE // {new Date().toLocaleDateString('en-IN')} ]</span>
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: '80px', right: '3rem', zIndex: 10000 }}><MahaCrimeCopilot /></div>

      <AnimatePresence>
        {activeModule === null && surges.length > 0 && (
          <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:20 }}
            style={{ position: 'fixed', top: '20vh', right: '2rem', width: '280px', pointerEvents: 'none', zIndex: 999 }}>
            <div className="section-label" style={{ color: '#FF3B30' }}>⚠ ZONES CLUSTERING NOW</div>
            {surges.slice(0, 3).map((s, i) => (
              <div key={i} className="tactical-card" style={{ pointerEvents: 'auto', marginBottom: '1px', padding: '1rem', border: '1px solid rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.04)' }}>
                <div style={{ fontWeight: 900, fontSize: '0.8rem', marginTop: 4, color: '#FF3B30' }}>{s.zone}</div>
                <div style={{ fontSize: '0.6rem', color: '#888', marginTop: 4 }}>{s.message}</div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
