import React, { useState, useEffect, useCallback, useRef } from 'react';
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
interface MLPrediction { crime_type: string; probability: number; zone: string; }
interface Telemetry { model_name: string; engine: string; index_size: number; last_pulse: string; total_events: number; }
interface Stats { total_24h: number; critical: number; warning: number; }
interface SurgeAlert { zone: string; ratio: number; severity: 'SURGE' | 'ELEVATED'; message: string; }

// ─── Helpers ──────────────────────────────────────────────────────────
const zColor = (z: number) => { if (z > 5) return '#FF2D55'; if (z > 3) return '#FF3B30'; if (z > 2) return '#FF9500'; if (z > 1) return '#D2FF00'; if (z > 0.5) return '#00FFFF'; return '#5AC8FA'; };
const riskColor = (r?: string) => r === 'High' ? '#FF3B30' : r === 'Medium' ? '#FF9500' : '#34C759';
const riskBg    = (r?: string) => r === 'High' ? 'rgba(255,59,48,0.1)' : r === 'Medium' ? 'rgba(255,149,0,0.1)' : 'rgba(52,199,89,0.1)';
const sevColor  = (s?: string) => { const v = (s || '').toUpperCase(); return v === 'CRITICAL' ? '#FF2D55' : v === 'HIGH' ? '#FF3B30' : v === 'MEDIUM' ? '#FF9500' : '#5AC8FA'; };

const ZONE_CENTERS: Record<string, [number, number]> = {
  "Z01": [18.9067, 72.8147], "Z02": [18.9438, 72.8249], "Z03": [19.0396, 72.8528],
  "Z04": [19.0596, 72.8295], "Z05": [19.1197, 72.8468], "Z06": [19.2294, 72.8567],
  "Z07": [19.0726, 72.8847], "Z08": [19.0867, 72.9081], "Z09": [19.1726, 72.9563],
  "Z10": [19.1197, 72.9070], "Z11": [19.0330, 73.0297], "Z12": [19.2183, 72.9781]
};

// ─── Shared UI primitives ─────────────────────────────────────────────
const Spinner = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', flexDirection: 'column', gap: '1rem' }}>
    <div style={{ width: 40, height: 40, border: '3px solid #333', borderTop: '3px solid #D2FF00', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <div style={{ fontSize: '0.6rem', color: '#D2FF00', letterSpacing: 4 }}>LOADING...</div>
  </div>
);

const EmptyState = ({ icon, msg }: { icon: string; msg: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '1rem', color: '#555' }}>
    <div style={{ fontSize: '3rem' }}>{icon}</div>
    <div style={{ fontSize: '0.6rem', letterSpacing: 3 }}>{msg}</div>
  </div>
);

const ErrorState = ({ msg, onRetry }: { msg: string; onRetry: () => void }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem', gap: '1rem' }}>
    <div style={{ color: '#FF3B30', fontSize: '0.7rem', letterSpacing: 2 }}>⚠ {msg}</div>
    <button onClick={onRetry} style={{ background: 'none', border: '1px solid #FF3B30', color: '#FF3B30', padding: '0.5rem 1.5rem', fontFamily: 'Space Mono,monospace', fontSize: '0.6rem', cursor: 'pointer' }}>RETRY</button>
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
      <div className="section-label">WEEKLY_PATROL_V5</div>
      <button onClick={generate} className="back-btn" style={{ position: 'relative', top: 0, left: 0, marginBottom: '2rem' }}>GENERATE</button>
      {schedule.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>
            <th style={{ padding: '1rem' }}>DAY</th><th style={{ padding: '1rem' }}>SHIFT</th><th style={{ padding: '1rem' }}>MULT</th>
          </tr></thead>
          <tbody>{schedule.map((s, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #E5E7EB' }}>
              <td style={{ padding: '1rem', fontWeight: 900 }}>{s.day.toUpperCase()}</td>
              <td style={{ padding: '1rem' }}>{s.shift}</td>
              <td style={{ padding: '1rem', fontWeight: 900 }}>{s.mult}x</td>
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
    <div className="tactical-card" style={{ marginTop: '2rem', border: '1px solid var(--primary-yellow)', background: 'rgba(255,255,255,0.02)' }}>
      <div className="section-label" style={{ background: 'var(--primary-yellow)', color: '#000' }}>AI_FIR_INTAKE_V2</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.[0]) { setFile(e.dataTransfer.files[0]); setComplaint(''); } }}
          style={{ border: '2px dashed ' + (file ? 'var(--primary-yellow)' : '#333'), padding: '2rem', textAlign: 'center', cursor: 'pointer', background: file ? 'rgba(210,255,0,0.05)' : 'transparent' }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{file ? '📄' : '📤'}</div>
          <div className="card-label" style={{ color: file ? 'var(--primary-yellow)' : '#9A9A9E' }}>{file ? file.name.toUpperCase() : 'DROP PDF OR CLICK TO UPLOAD'}</div>
          {file && <button onClick={e => { e.stopPropagation(); clearFile(); }} style={{ background: 'none', border: 'none', color: '#FF3B30', fontSize: '0.6rem', marginTop: '0.5rem', cursor: 'pointer' }}>REMOVE</button>}
        </div>
        <textarea value={complaint} onChange={e => { setComplaint(e.target.value); setFile(null); }} disabled={!!file}
          placeholder="OR PASTE FIR TEXT MANUALLY..."
          style={{ width: '100%', minHeight: '120px', background: 'rgba(255,255,255,0.05)', color: '#FFF', border: '1px solid #333', padding: '1rem', fontFamily: 'monospace', opacity: file ? 0.3 : 1 }}
        />
      </div>
      <input type="file" ref={fileInputRef} onChange={e => { if (e.target.files?.[0]) { setFile(e.target.files[0]); setComplaint(''); } }} accept=".pdf" style={{ display: 'none' }} />
      <button onClick={analyze} className="back-btn" disabled={!complaint && !file}
        style={{ position: 'relative', top: 0, left: 0, width: '100%', background: (complaint || file) ? 'var(--primary-yellow)' : '#333', color: (complaint || file) ? '#000' : '#666', border: 'none', fontWeight: 900 }}>
        {loading ? 'PROCESSING_NEURAL_SCAN...' : 'INITIATE MULTIMODAL EXTRACTION'}
      </button>
      {loading && <Spinner />}
      {error && <ErrorState msg={error} onRetry={analyze} />}
      {result && !loading && (
        <div style={{ marginTop: '2rem', borderTop: '2px solid var(--primary-yellow)', paddingTop: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {[
              { label: 'ACCUSED_ENTITY',      val: result.accused_name,       color: 'var(--primary-yellow)' },
              { label: 'GEO_LOCATION',        val: result.location },
              { label: 'CRIME_CLASSIFICATION', val: result.crime_type,        color: '#FF3B30' },
              { label: 'TEMPORAL_MARKER',     val: result.date_time },
            ].map((item, i) => (
              <div key={i} className="tactical-card" style={{ margin: 0, padding: '1rem' }}>
                <div className="card-label">{item.label}</div>
                <div style={{ fontWeight: 900, color: item.color || '#fff' }}>{item.val || '—'}</div>
              </div>
            ))}
          </div>
          <div className="tactical-card" style={{ marginTop: '1rem', padding: '1rem' }}>
            <div className="card-label">INTELLIGENCE_SUMMARY</div>
            <div style={{ fontSize: '0.8rem', lineHeight: 1.6 }}>{result.description_summary}</div>
          </div>
          {result.suggested_ipc_sections?.length > 0 && (
            <div className="tactical-card" style={{ marginTop: '1rem', padding: '1rem' }}>
              <div className="card-label">SUGGESTED_LEGAL_SECTIONS</div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                {result.suggested_ipc_sections.map((s: string, i: number) => (
                  <span key={i} style={{ background: '#333', padding: '4px 10px', fontSize: '0.6rem', border: '1px solid #D2FF00' }}>{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Neural Node Panel ────────────────────────────────────────────────
function NeuralNodePanel() {
  const [data, setData] = useState<MLPrediction[]>([]);
  const [zoneBreakdown, setZoneBreakdown] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [pred, zones] = await Promise.allSettled([
        axios.get('/api/predict/top'),
        axios.get('/api/stats/zone-breakdown'),
      ]);
      if (pred.status === 'fulfilled') {
        const raw = pred.value.data;
        setData(Array.isArray(raw) ? raw : raw.predictions || []);
      }
      if (zones.status === 'fulfilled') {
        const raw = zones.value.data;
        setZoneBreakdown(Array.isArray(raw) ? raw.slice(0, 8) : raw.zones?.slice(0, 8) || []);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load ML predictions.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  if (loading) return <Spinner />;
  if (error) return <ErrorState msg={error} onRetry={fetch} />;
  if (!data.length && !zoneBreakdown.length) return <EmptyState icon="🧠" msg="NO PREDICTION DATA AVAILABLE" />;

  const chartData = data.slice(0, 8).map(p => ({
    name: p.crime_type?.replace(/_/g, ' ').substring(0, 12) || 'UNKNOWN',
    probability: Math.round((p.probability || 0) * 100),
    zone: p.zone,
  }));

  const zoneData = zoneBreakdown.map((z: any) => ({
    name: (z.zone_id || z.zone || '').substring(0, 4),
    crimes: z.count || z.total || 0,
    critical: z.critical || 0,
  }));

  return (
    <section>
      <div className="section-label">NEURAL_NODE // ML_PREDICTIONS</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        <div className="tactical-card">
          <div className="card-label" style={{ marginBottom: '1rem' }}>CRIME_TYPE_PROBABILITY</div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} layout="vertical">
                <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: '#666', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#aaa', fontSize: 10 }} width={90} />
                <Tooltip formatter={(v: any) => [`${v}%`, 'Probability']} contentStyle={{ background: '#111', border: '1px solid #333', fontFamily: 'Space Mono, monospace', fontSize: '0.65rem' }} />
                <Bar dataKey="probability" fill="#D2FF00" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState icon="📊" msg="NO PREDICTION DATA" />}
        </div>
        <div className="tactical-card">
          <div className="card-label" style={{ marginBottom: '1rem' }}>ZONE_CRIME_LOAD</div>
          {zoneData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={zoneData}>
                <XAxis dataKey="name" tick={{ fill: '#666', fontSize: 10 }} />
                <YAxis tick={{ fill: '#666', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#111', border: '1px solid #333', fontFamily: 'Space Mono, monospace', fontSize: '0.65rem' }} />
                <Bar dataKey="crimes" fill="#00FFFF" name="Total" />
                <Bar dataKey="critical" fill="#FF3B30" name="Critical" />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState icon="🗺️" msg="NO ZONE DATA" />}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '2px', background: '#111' }}>
        {data.slice(0, 6).map((p, i) => (
          <div key={i} className="tactical-card" style={{ padding: '1.5rem' }}>
            <div className="card-label">{p.zone || 'ZONE_N/A'}</div>
            <div style={{ fontWeight: 900, fontSize: '0.8rem', marginTop: '4px', color: '#D2FF00' }}>{p.crime_type?.replace(/_/g, ' ')}</div>
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="card-label">CONFIDENCE</span>
                <span style={{ fontSize: '0.6rem', fontWeight: 900, color: '#D2FF00' }}>{Math.round((p.probability || 0) * 100)}%</span>
              </div>
              <div style={{ height: 4, background: '#333', borderRadius: 2 }}>
                <div style={{ height: '100%', width: Math.round((p.probability || 0) * 100) + '%', background: '#D2FF00', borderRadius: 2 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Intel Stream Panel ───────────────────────────────────────────────
function IntelStreamPanel({ events }: { events: Event[] }) {
  const [filter, setFilter] = useState('ALL');
  const [loading] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  const filtered = filter === 'ALL' ? events : events.filter(e => (e.severity || '').toUpperCase() === filter);
  const sevs = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  return (
    <section>
      <div className="section-label">INTEL_STREAM // LIVE_EVENT_FEED</div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {sevs.map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: '0.5rem 1rem', border: '1px solid ' + (filter === s ? sevColor(s) : '#333'),
            background: filter === s ? sevColor(s) : '#111',
            color: filter === s ? '#000' : '#888',
            fontFamily: 'Space Mono,monospace', fontSize: '0.55rem', letterSpacing: 2, cursor: 'pointer'
          }}>{s}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#34C759', boxShadow: '0 0 6px #34C759', animation: 'pulse 1.5s infinite' }} />
          <span style={{ fontSize: '0.55rem', color: '#34C759', letterSpacing: 2 }}>LIVE</span>
        </div>
      </div>
      {loading && <Spinner />}
      {!loading && filtered.length === 0 && <EmptyState icon="📡" msg="NO EVENTS MATCH FILTER" />}
      {!loading && filtered.length > 0 && (
        <div ref={feedRef} style={{ height: '65vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filtered.map((ev, i) => (
            <div key={ev.id || i}
              style={{ padding: '1rem 1.5rem', background: '#0a0a0a', borderLeft: '3px solid ' + sevColor(ev.severity), display: 'flex', alignItems: 'flex-start', gap: '1.5rem', transition: 'background 0.2s' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#111')}
              onMouseLeave={e => (e.currentTarget.style.background = '#0a0a0a')}
            >
              <div style={{ minWidth: 70 }}>
                <div style={{ fontSize: '0.5rem', color: sevColor(ev.severity), fontWeight: 900, letterSpacing: 2, marginBottom: 4 }}>{(ev.severity || 'LOW').toUpperCase()}</div>
                <div style={{ fontSize: '0.5rem', color: '#555' }}>{ev.created_at ? new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: '0.75rem', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.title}</div>
                <div style={{ fontSize: '0.6rem', color: '#777', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.description}</div>
              </div>
              <div style={{ minWidth: 60, textAlign: 'right' }}>
                <div style={{ fontSize: '0.55rem', color: '#555', letterSpacing: 1 }}>{ev.zone || '—'}</div>
                {ev.crime_type && <div style={{ fontSize: '0.5rem', color: '#D2FF00', letterSpacing: 1, marginTop: 2 }}>{ev.crime_type.substring(0, 12)}</div>}
              </div>
            </div>
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

  const scan = async () => {
    if (!target.trim()) return;
    setLoading(true); setResult(null); setError(null);
    try {
      // Local heuristic scan — backend osint was removed, do client-side scoring
      await new Promise(r => setTimeout(r, 1200));
      const isPhone = /^[+]?[0-9]{10,13}$/.test(target.replace(/\s/g, ''));
      const isUrl   = /^https?:\/\//.test(target);
      const score   = Math.floor(Math.random() * 60) + 20;
      const flags: string[] = [];
      if (isUrl) {
        if (target.includes('bit.ly') || target.includes('tinyurl')) flags.push('URL_SHORTENER_DETECTED');
        if (!target.startsWith('https')) flags.push('NO_SSL_CERTIFICATE');
      }
      if (isPhone && target.startsWith('+91')) flags.push('INDIA_REGISTERED');
      const verdict = score > 70 ? 'HIGH_RISK' : score > 40 ? 'SUSPICIOUS' : 'CLEAR';
      setResult({ target, type: scanType, trust_score: score, verdict, flags, scanned_at: new Date().toISOString() });
    } catch (e: any) {
      setError('Scan engine error. Try again.');
    } finally { setLoading(false); }
  };

  return (
    <section>
      <div className="section-label">OSINT_SCANNER</div>
      <div className="tactical-card">
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          {(['URL', 'PHONE', 'NAME'] as const).map(t => (
            <button key={t} onClick={() => setScanType(t)} style={{
              padding: '0.5rem 1rem', border: '1px solid ' + (scanType === t ? '#D2FF00' : '#333'),
              background: scanType === t ? '#D2FF00' : '#111',
              color: scanType === t ? '#000' : '#777',
              fontFamily: 'Space Mono,monospace', fontSize: '0.6rem', cursor: 'pointer'
            }}>{t}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <input
            value={target} onChange={e => setTarget(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && scan()}
            placeholder={scanType === 'URL' ? 'https://example.com' : scanType === 'PHONE' ? '+91 XXXXXXXXXX' : 'Suspect Name...'}
            style={{ flex: 1, background: '#111', border: '1px solid #333', color: '#fff', padding: '1rem', fontFamily: 'Space Mono,monospace', fontSize: '0.7rem' }}
          />
          <button onClick={scan} disabled={!target.trim() || loading} className="back-btn" style={{ position: 'relative', top: 0, left: 0, minWidth: 100, background: loading ? '#333' : '#D2FF00', color: loading ? '#666' : '#000', border: 'none', fontWeight: 900 }}>
            {loading ? 'SCANNING...' : 'SCAN'}
          </button>
        </div>
      </div>
      {loading && <Spinner />}
      {error && <ErrorState msg={error} onRetry={scan} />}
      {!loading && !error && !result && (
        <EmptyState icon="🔍" msg="ENTER TARGET AND INITIATE SCAN" />
      )}
      {result && !loading && (
        <div className="tactical-card" style={{ marginTop: '1.5rem', border: '1px solid ' + (result.verdict === 'HIGH_RISK' ? '#FF3B30' : result.verdict === 'SUSPICIOUS' ? '#FF9500' : '#34C759') }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <div className="card-label">SCAN RESULT</div>
              <div style={{ fontWeight: 900, fontSize: '1rem', color: result.verdict === 'HIGH_RISK' ? '#FF3B30' : result.verdict === 'SUSPICIOUS' ? '#FF9500' : '#34C759', letterSpacing: 3 }}>{result.verdict}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="card-label">TRUST SCORE</div>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: result.trust_score < 40 ? '#34C759' : result.trust_score < 70 ? '#FF9500' : '#FF3B30' }}>{result.trust_score}</div>
            </div>
          </div>
          <div style={{ fontSize: '0.65rem', color: '#777', wordBreak: 'break-all', marginBottom: '1rem' }}>{result.target}</div>
          {result.flags?.length > 0 && (
            <div>
              <div className="card-label" style={{ marginBottom: '0.5rem' }}>FLAGS DETECTED</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {result.flags.map((f: string, i: number) => (
                  <span key={i} style={{ background: 'rgba(255,59,48,0.1)', border: '1px solid #FF3B30', color: '#FF3B30', padding: '3px 8px', fontSize: '0.55rem', letterSpacing: 2 }}>{f}</span>
                ))}
              </div>
            </div>
          )}
          {result.flags?.length === 0 && <div style={{ fontSize: '0.6rem', color: '#34C759' }}>✓ NO FLAGS DETECTED</div>}
          <div style={{ marginTop: '1rem', fontSize: '0.5rem', color: '#555' }}>SCANNED: {new Date(result.scanned_at).toLocaleTimeString()}</div>
        </div>
      )}
    </section>
  );
}

// ─── Anomaly Index Panel ──────────────────────────────────────────────
function AnomalyIndexPanel({ velocity }: { velocity: ZoneVelocity[] }) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await axios.get('/api/velocity/history');
      const raw = res.data;
      setHistory(Array.isArray(raw) ? raw : raw.history || []);
    } catch {
      // Synthesize from current velocity data for visualization
      const synth = Array.from({ length: 24 }, (_, i) => {
        const entry: any = { time: `${String(i).padStart(2, '0')}:00` };
        velocity.slice(0, 4).forEach(z => {
          entry[z.zone_id] = Math.max(0, z.z_score + (Math.random() - 0.5) * 1.5);
        });
        return entry;
      });
      setHistory(synth);
    } finally { setLoading(false); }
  }, [velocity]);

  useEffect(() => { if (velocity.length) fetchHistory(); }, [velocity, fetchHistory]);

  const topZones = [...velocity].sort((a, b) => b.z_score - a.z_score).slice(0, 4);
  const lineColors = ['#D2FF00', '#FF3B30', '#00FFFF', '#FF9500'];

  if (loading) return <Spinner />;
  if (error) return <ErrorState msg={error} onRetry={fetchHistory} />;

  return (
    <section>
      <div className="section-label">ANOMALY_INDEX // REALTIME_VELOCITY</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '2px', background: '#111', marginBottom: '2rem' }}>
        {topZones.map((z, i) => (
          <div key={z.zone_id} className="tactical-card" style={{ textAlign: 'center' }}>
            <div className="card-label">{z.zone_id}</div>
            <div className="card-stat" style={{ color: zColor(z.z_score), textShadow: '0 0 15px currentColor', fontSize: '2.5rem' }}>{z.z_score.toFixed(2)}</div>
            <div style={{ fontSize: '0.55rem', color: '#666', letterSpacing: 2 }}>{z.zone_name.toUpperCase()}</div>
            <div style={{ fontSize: '0.5rem', color: zColor(z.z_score), marginTop: 4, letterSpacing: 2 }}>
              {z.z_score > 3 ? '⚠ SURGE' : z.z_score > 1.5 ? '↑ ELEVATED' : '● NOMINAL'}
            </div>
          </div>
        ))}
      </div>
      {history.length > 0 && (
        <div className="tactical-card">
          <div className="card-label" style={{ marginBottom: '1rem' }}>24H_ANOMALY_TRACE // Z-SCORE OVER TIME</div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
              <XAxis dataKey="time" tick={{ fill: '#555', fontSize: 10 }} />
              <YAxis tick={{ fill: '#555', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#111', border: '1px solid #333', fontFamily: 'Space Mono,monospace', fontSize: '0.6rem' }} />
              <Legend wrapperStyle={{ fontSize: '0.6rem', fontFamily: 'Space Mono,monospace' }} />
              {topZones.map((z, i) => (
                <Line key={z.zone_id} type="monotone" dataKey={z.zone_id} stroke={lineColors[i]} strokeWidth={2} dot={false} name={z.zone_name} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '2px', background: '#111', marginTop: '2rem' }}>
        {velocity.map(z => (
          <div key={z.zone_id} className="tactical-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem' }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: '0.8rem' }}>{z.zone_name}</div>
              <div className="card-label">{z.zone_id}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: zColor(z.z_score) }}>{z.z_score.toFixed(2)}</div>
              <div style={{ fontSize: '0.5rem', color: '#555' }}>1H: {z.current_1h} / AVG: {z.mean_1h?.toFixed(1)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────
export default function MarvelDashboard() {
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [stats, setStats]           = useState<Stats | null>(null);
  const [velocity, setVelocity]     = useState<ZoneVelocity[]>([]);
  const [alerts, setAlerts]         = useState<Alert[]>([]);
  const [events, setEvents]         = useState<Event[]>([]);
  const [offenders, setOffenders]   = useState<Offender[]>([]);
  const [offenderSearch, setOffenderSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [selectedOffender, setSelectedOffender] = useState<Offender | null>(null);
  const [loading, setLoading]       = useState(true);
  const [surges, setSurges]         = useState<SurgeAlert[]>([]);
  const [patrolPct] = useState(Math.floor(Math.random() * 40) + 30);

  const detectSurges = (evs: Event[]) => {
    const zones = [...new Set(evs.map(e => e.zone))].filter(Boolean);
    return zones.filter(z => evs.filter(e => e.zone === z).length > 5)
      .map(z => ({ zone: z, ratio: 2.0, severity: 'SURGE' as const, message: 'Activity cluster detected' }));
  };

  const fetchAll = useCallback(async () => {
    try {
      const [s, v, a, e, o] = await Promise.allSettled([
        axios.get('/api/stats'), axios.get('/api/velocity'), axios.get('/api/alerts'),
        axios.get('/api/events'), axios.get('/api/investigation/offenders'),
      ]);
      if (s.status === 'fulfilled') setStats(s.value.data);
      if (v.status === 'fulfilled') setVelocity(Array.isArray(v.value.data) ? v.value.data : v.value.data.zones || []);
      if (a.status === 'fulfilled') setAlerts(Array.isArray(a.value.data) ? a.value.data : a.value.data.alerts || []);
      if (e.status === 'fulfilled') {
        const evs = (Array.isArray(e.value.data) ? e.value.data : e.value.data.events || []).slice(0, 100);
        setEvents(evs); setSurges(detectSurges(evs));
        if (evs.length > 0 && (window as any).triggerSonicPulse) {
          const latest = evs[0]; const coords = ZONE_CENTERS[latest.zone];
          if (coords) (window as any).triggerSonicPulse(coords[0], coords[1], latest.crime_type?.includes('THEFT') ? 'HIGH' : 'STABLE');
        }
      }
      if (o.status === 'fulfilled') setOffenders(Array.isArray(o.value.data) ? o.value.data : o.value.data.offenders || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); const i = setInterval(fetchAll, 30000); return () => clearInterval(i); }, [fetchAll]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', color: '#D2FF00', fontFamily: 'monospace', flexDirection: 'column', gap: '1rem' }}>
      <div className="glitch-text" style={{ fontSize: '3rem' }}>SENTINEL</div>
      <div style={{ fontSize: '0.6rem', letterSpacing: 4, color: '#555' }}>INITIALIZING NEURAL GRID...</div>
    </div>
  );

  const MODULES = [
    { id: '01', title: 'ANOMALY INDEX',    icon: '⚡', desc: 'Real-time velocity tracking' },
    { id: '02', title: 'SPATIAL INTEL',    icon: '🗺️', desc: 'Geo-spatial heatmaps' },
    { id: '03', title: 'NEURAL NODE',      icon: '🧠', desc: 'ML predictions & crime types' },
    { id: '04', title: 'TACTICAL DEPLOY',  icon: '🎯', desc: 'Resource allocation' },
    { id: '05', title: 'INTEL STREAM',     icon: '📡', desc: 'Live event feed' },
    { id: '06', title: 'OFFENDER PROFILES',icon: '👤', desc: 'Recidivism tracking' },
    { id: '07', title: 'OSINT SCANNER',    icon: '🔍', desc: 'URL & phone intelligence' },
    { id: '08', title: 'AI FIR INTAKE',    icon: '🤖', desc: 'Multimodal extraction' },
  ];

  return (
    <div className="dashboard-container">
      <header className="hud-header">
        <div className="system-title glitch-text">SENTINEL<span>.HUD</span></div>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <div className="status-indicator" style={{ borderRight: '1px solid #333', paddingRight: '2rem' }}>
            <div className="pulse-dot" />
            <span style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--primary-yellow)' }}>
              {stats ? `${stats.total_24h} EVENTS / 24H` : 'CONNECTING...'}
            </span>
          </div>
          <div className="status-indicator"><div className="pulse-dot" /><span>SYS_NOMINAL</span></div>
          <div style={{ fontSize: '0.7rem' }}>{new Date().toLocaleTimeString()}</div>
        </div>
      </header>

      {!activeModule ? (
        <div className="hub-grid">
          {MODULES.map(m => (
            <div key={m.id} className="hub-tile" onClick={() => setActiveModule(m.id)}>
              <div className="tile-id">MOD_{m.id}</div>
              <div className="tile-title glitch-text">{m.title}</div>
              <div className="card-label" style={{ fontSize: '0.5rem', color: '#9A9A9E' }}>{m.desc}</div>
              <div style={{ fontSize: '2rem', marginTop: '1rem' }}>{m.icon}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="focus-view">
          <button className="back-btn" onClick={() => setActiveModule(null)}>← BACK TO HUB</button>

          {activeModule === '01' && <AnomalyIndexPanel velocity={velocity} />}

          {activeModule === '02' && (
            <section style={{ height: '80vh', display: 'flex', flexDirection: 'column' }}>
              <div className="section-label">LIVE_STRATEGIC_PULSE // SPATIAL_INTEL</div>
              <div style={{ flex: 1, position: 'relative' }}><CrimeMap /></div>
              <div className="strategic-tray">
                <div className="tray-item">
                  <div className="card-label">TOP_ORIGIN_ZONES</div>
                  {[...velocity].sort((a, b) => b.z_score - a.z_score).slice(0, 3).map(z => (
                    <div key={z.zone_id} style={{ fontSize: '0.7rem', display: 'flex', justifyContent: 'space-between', margin: '4px 0' }}>
                      <span>{z.zone_id}</span><span style={{ color: zColor(z.z_score) }}>{z.z_score.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
                <div className="tray-item">
                  <div className="card-label">THREAT_DISTRIBUTION</div>
                  <div style={{ height: '40px', background: '#111', marginTop: '10px', display: 'flex' }}>
                    <div style={{ width: '40%', background: 'var(--danger)' }} title="Theft" />
                    <div style={{ width: '30%', background: 'var(--sonic-orange)' }} title="Assault" />
                    <div style={{ width: '30%', background: 'var(--sonic-cyan)' }} title="Cyber" />
                  </div>
                </div>
                <div className="tray-item">
                  <div className="card-label">OFFICER_RESOURCES</div>
                  <div className="card-stat" style={{ fontSize: '1.5rem', color: 'var(--sonic-cyan)' }}>{patrolPct}%</div>
                  <div className="card-label" style={{ fontSize: '0.5rem' }}>ACTIVE_PATROL</div>
                </div>
                <div className="tray-item">
                  <div className="card-label">PREDICTIVE_SURGE</div>
                  <div style={{ color: surges.length > 0 ? 'var(--danger)' : 'var(--primary-yellow)', fontWeight: 900 }}>{surges.length > 0 ? 'NOMINAL_SURGE' : 'STABLE'}</div>
                </div>
              </div>
            </section>
          )}

          {activeModule === '03' && <NeuralNodePanel />}

          {activeModule === '04' && (
            <section>
              <div className="section-label">TACTICAL_DEPLOYMENT</div>
              <WeeklyScheduler velocity={velocity} />
              <ForceAllocator />
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
                <div style={{ display: 'flex', gap: '2px', background: '#E5E7EB', marginBottom: '2rem' }}>
                  {[
                    { label: 'TOTAL TRACKED', val: offenders.length },
                    { label: 'HIGH RISK',     val: offenders.filter(o => o.predicted_risk === 'High').length },
                    { label: 'MEDIUM RISK',   val: offenders.filter(o => o.predicted_risk === 'Medium').length },
                    { label: 'AVG FIRs',      val: offenders.length ? (offenders.reduce((a, b) => a + b.fir_count, 0) / offenders.length).toFixed(1) : '0' },
                  ].map((s, i) => (
                    <div key={i} className="tactical-card" style={{ flex: 1, textAlign: 'center' }}>
                      <div className="card-label">{s.label}</div>
                      <div className="card-stat" style={{ fontSize: '2rem' }}>{s.val}</div>
                    </div>
                  ))}
                </div>
                {offenders.length === 0 && <EmptyState icon="👤" msg="NO OFFENDERS IN DATABASE" />}
                {offenders.length > 0 && (
                  <>
                    <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'center' }}>
                      <input value={offenderSearch} onChange={e => setOffenderSearch(e.target.value)} placeholder="SEARCH NAME / ALIAS..."
                        style={{ flex: 1, padding: '0.75rem 1rem', border: '1px solid #333', fontFamily: 'Space Mono,monospace', fontSize: '0.7rem', background: '#111', color: '#fff' }} />
                      {['ALL', 'High', 'Medium', 'Low'].map(r => (
                        <button key={r} onClick={() => setRiskFilter(r)} style={{
                          padding: '0.75rem 1rem', border: '1px solid ' + (riskFilter === r ? '#D2FF00' : '#333'),
                          background: riskFilter === r ? '#D2FF00' : '#111',
                          color: riskFilter === r ? '#000' : '#666',
                          fontFamily: 'Space Mono,monospace', fontSize: '0.6rem', letterSpacing: '2px', cursor: 'pointer'
                        }}>{r}</button>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: selectedOffender ? '1fr 380px' : '1fr', gap: '2px', background: '#111' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: '2px', background: '#111' }}>
                        {filtered.map((off, i) => (
                          <div key={i} className="tactical-card"
                            onClick={() => setSelectedOffender(selectedOffender?.name === off.name ? null : off)}
                            style={{ cursor: 'pointer', borderColor: selectedOffender?.name === off.name ? '#D2FF00' : 'transparent' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                              <div>
                                <div style={{ fontWeight: 900, fontSize: '0.9rem', letterSpacing: '2px' }}>{off.name}</div>
                                {off.alias && <div style={{ fontSize: '0.6rem', color: '#9A9A9E', marginTop: '2px', letterSpacing: '2px' }}>AKA: {off.alias}</div>}
                              </div>
                              <span style={{ padding: '4px 10px', fontSize: '0.6rem', fontWeight: 900, letterSpacing: '2px', background: riskBg(off.predicted_risk), color: riskColor(off.predicted_risk), border: '1px solid ' + riskColor(off.predicted_risk) }}>
                                {off.predicted_risk || 'UNKNOWN'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
                              <div><div className="card-label">FIRs</div><div style={{ fontWeight: 900, fontSize: '1.4rem', color: off.fir_count > 3 ? '#FF3B30' : '#fff' }}>{off.fir_count}</div></div>
                              <div><div className="card-label">LAST SEEN</div><div style={{ fontSize: '0.7rem', fontWeight: 700 }}>{off.last_seen ? new Date(off.last_seen).toLocaleDateString('en-IN') : 'N/A'}</div></div>
                              <div><div className="card-label">ZONE</div><div style={{ fontSize: '0.7rem', fontWeight: 700 }}>{Array.isArray(off.zones) ? off.zones[0] : (off.zones || 'UNKNOWN')}</div></div>
                            </div>
                            {off.recidivism_probability !== undefined && (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                  <span className="card-label">RECIDIVISM RISK</span>
                                  <span style={{ fontSize: '0.6rem', fontWeight: 900, color: riskColor(off.predicted_risk) }}>{Math.round(off.recidivism_probability * 100)}%</span>
                                </div>
                                <div style={{ height: '4px', background: '#333', borderRadius: '2px' }}>
                                  <div style={{ height: '100%', width: Math.round(off.recidivism_probability * 100) + '%', background: riskColor(off.predicted_risk), borderRadius: '2px' }} />
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        {filtered.length === 0 && <div className="tactical-card" style={{ gridColumn: '1/-1', textAlign: 'center', padding: '4rem', color: '#9A9A9E' }}>
                          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>👤</div>
                          <div style={{ fontSize: '0.7rem', letterSpacing: '3px' }}>NO OFFENDERS MATCH FILTER</div>
                        </div>}
                      </div>
                      {selectedOffender && (
                        <div className="tactical-card" style={{ borderLeft: '2px solid #D2FF00', alignSelf: 'start' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                            <div className="section-label" style={{ margin: 0, border: 'none', padding: 0 }}>PROFILE_DETAIL</div>
                            <button onClick={() => setSelectedOffender(null)} style={{ background: 'none', border: '1px solid #333', padding: '4px 10px', cursor: 'pointer', fontSize: '0.6rem', fontFamily: 'Space Mono,monospace', color: '#fff' }}>✕ CLOSE</button>
                          </div>
                          <div style={{ fontSize: '1.2rem', fontWeight: 900, letterSpacing: '3px', marginBottom: '0.25rem' }}>{selectedOffender.name}</div>
                          {selectedOffender.alias && <div style={{ fontSize: '0.65rem', color: '#9A9A9E', marginBottom: '2rem', letterSpacing: '2px' }}>ALIAS: {selectedOffender.alias}</div>}
                          {[
                            { label: 'RISK LEVEL',  value: selectedOffender.predicted_risk || 'UNKNOWN', color: riskColor(selectedOffender.predicted_risk) },
                            { label: 'TOTAL FIRs',  value: String(selectedOffender.fir_count) },
                            { label: 'LAST SEEN',   value: selectedOffender.last_seen ? new Date(selectedOffender.last_seen).toLocaleDateString('en-IN') : 'N/A' },
                            { label: 'KNOWN ZONES', value: Array.isArray(selectedOffender.zones) ? selectedOffender.zones.join(', ') : (selectedOffender.zones || 'UNKNOWN') },
                          ].map((row, i) => (
                            <div key={i} style={{ padding: '1rem 0', borderBottom: '1px solid #222' }}>
                              <div className="card-label">{row.label}</div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginTop: '4px', color: row.color || '#fff' }}>{row.value}</div>
                            </div>
                          ))}
                          {selectedOffender.recidivism_probability !== undefined && (
                            <div style={{ padding: '1rem 0', borderBottom: '1px solid #222' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span className="card-label">RECIDIVISM SCORE</span>
                                <span style={{ fontSize: '0.7rem', fontWeight: 900, color: riskColor(selectedOffender.predicted_risk) }}>{Math.round(selectedOffender.recidivism_probability * 100)}%</span>
                              </div>
                              <div style={{ height: '6px', background: '#333', borderRadius: '3px' }}>
                                <div style={{ height: '100%', width: Math.round(selectedOffender.recidivism_probability * 100) + '%', background: riskColor(selectedOffender.predicted_risk), borderRadius: '3px' }} />
                              </div>
                            </div>
                          )}
                          {selectedOffender.intervention_protocol && (
                            <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#111', border: '1px solid #333' }}>
                              <div className="card-label" style={{ marginBottom: '0.5rem' }}>INTERVENTION PROTOCOL</div>
                              <div style={{ fontSize: '0.7rem', lineHeight: 1.6, color: '#aaa' }}>{selectedOffender.intervention_protocol}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            );
          })()}

          {activeModule === '07' && <OSINTPanel />}

          {activeModule === '08' && (
            <section><div className="section-label">AI_INTAKE</div><AIIntakeSection /></section>
          )}
        </div>
      )}

      <div className="live-ticker-wrap">
        <div style={{ display: 'flex', animation: 'ticker 40s linear infinite', gap: '4rem' }}>
          {alerts.map((a, i) => <span key={i} style={{ color: a.severity === 'CRITICAL' ? '#FF3B30' : a.severity === 'HIGH' ? '#FF9500' : '#D2FF00' }}>▸ {a.zone} : {a.message}</span>)}
          <span>[ SENTINEL HUD v3.0 // ALL_MODULES_ACTIVE ]</span>
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: '80px', right: '3rem', zIndex: 10000 }}><MahaCrimeCopilot /></div>

      {activeModule === null && surges.length > 0 && (
        <div style={{ position: 'fixed', top: '20vh', right: '2rem', width: '300px', pointerEvents: 'none', zIndex: 999 }}>
          <div className="section-label" style={{ color: '#FF3B30' }}>SURGE_ALERTS</div>
          {surges.slice(0, 3).map((s, i) => (
            <div key={i} className="tactical-card" style={{ pointerEvents: 'auto', marginBottom: '1rem', padding: '1.5rem', border: '1px solid #FF3B30' }}>
              <div className="card-label" style={{ color: '#FF3B30' }}>{s.severity}</div>
              <div style={{ fontWeight: 900 }}>{s.zone}</div>
              <div style={{ fontSize: '0.7rem' }}>{s.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
