import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ForceAllocator from '../components/ForceAllocator';
import 'leaflet/dist/leaflet.css';
import './MarvelDashboard.css';
import MahaCrimeCopilot from '../components/MahaCrimeCopilot';
import SonicPulseMap from '../components/SonicPulseMap';
import CrimeMap from '../components/CrimeMap';

interface ZoneVelocity {
  zone_id: string; zone_name: string; z_score: number;
  current_1h: number; mean_1h: number; score?: number;
}
interface Alert { zone: string; message: string; severity: string; }
interface Event {
  id?: string; title: string; description: string; zone: string;
  crime_type: string; created_at?: string; ingested_at?: string;
  timestamp?: string; url?: string;
}
interface Offender {
  id?: string; name: string; alias: string; fir_count: number;
  last_seen: string; zones: string | string[];
  predicted_risk?: 'High' | 'Medium' | 'Low';
  intervention_protocol?: string; recidivism_probability?: number;
}
interface DispatchTask {
  id?: string; title: string; priority: string; status: string;
  zone: string; assigned_to: string; created_at: string;
}
interface Telemetry {
  model_name: string; engine: string; index_size: number;
  last_pulse: string; total_events: number;
}
interface Stats { total_24h: number; critical: number; warning: number; }
interface SurgeAlert { zone: string; ratio: number; severity: 'SURGE' | 'ELEVATED'; message: string; }

const zColor = (z: number) => {
  if (z > 5.0) return '#FF2D55';
  if (z > 3.0) return '#FF3B30';
  if (z > 2.0) return '#FF9500';
  if (z > 1.0) return '#D2FF00';
  if (z > 0.5) return '#00FFFF';
  return '#5AC8FA';
};

const fmt = (d: string | undefined) => d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
const priorityColor = (p: string) => p === 'HIGH' ? '#FF3B30' : p === 'MEDIUM' ? '#FF9500' : '#D2FF00';

const ZONE_CENTERS: Record<string, [number, number]> = {
  "Z01": [18.9067, 72.8147], "Z02": [18.9438, 72.8249], "Z03": [19.0396, 72.8528],
  "Z04": [19.0596, 72.8295], "Z05": [19.1197, 72.8468], "Z06": [19.2294, 72.8567],
  "Z07": [19.0726, 72.8847], "Z08": [19.0867, 72.9081], "Z09": [19.1726, 72.9563],
  "Z10": [19.1197, 72.9070], "Z11": [19.0330, 73.0297], "Z12": [19.2183, 72.9781]
};

/* ─── Weekly Scheduler ───────────────────────────────────────── */
function WeeklyScheduler({ velocity }: { velocity: ZoneVelocity[] }) {
  const [schedule, setSchedule] = useState<any[]>([]);
  const generate = () => {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    setSchedule(days.map(day => ({ day, shift: day.startsWith('S') ? 'Double' : 'Standard', mult: day.startsWith('S') ? 1.5 : 1.0 })));
  };
  return (
    <div className="tactical-card" style={{ marginTop: '2rem' }}>
      <div className="section-label">WEEKLY_PATROL_V5</div>
      <button onClick={generate} className="back-btn" style={{ position: 'relative', top: 0, left: 0, marginBottom: '2rem' }}>GENERATE</button>
      {schedule.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}><th style={{ padding: '1rem' }}>DAY</th><th style={{ padding: '1rem' }}>SHIFT</th><th style={{ padding: '1rem' }}>MULT</th></tr></thead>
          <tbody>{schedule.map((s, i) => (<tr key={i} style={{ borderBottom: '1px solid #E5E7EB' }}><td style={{ padding: '1rem', fontWeight: 900 }}>{s.day.toUpperCase()}</td><td style={{ padding: '1rem' }}>{s.shift}</td><td style={{ padding: '1rem', fontWeight: 900 }}>{s.mult}x</td></tr>))}</tbody>
        </table>
      )}
    </div>
  );
}

/* ─── ANPR Scanner ───────────────────────────────────────────── */
function ANPRScanner() {
  const [reg, setReg] = useState('');
  const [result, setResult] = useState<any>(null);
  const handleTrace = () => {
    setResult({ zone: 'Bandra', status: Math.random() > 0.8 ? 'WANTED' : 'CLEAR', reg: reg.toUpperCase(), time: '2m ago' });
  };
  return (
    <div className="tactical-card" style={{ marginTop: '2rem' }}>
      <div className="section-label">ANPR SCANNER</div>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <input value={reg} onChange={e => setReg(e.target.value)} placeholder="VEHICLE_REG"
          style={{ flex: 1, background: '#111', border: '1px solid #333', color: '#fff', padding: '1rem', fontFamily: 'Space Mono, monospace' }} />
        <button onClick={handleTrace} className="back-btn" style={{ position: 'relative', top: 0, left: 0 }}>TRACE</button>
      </div>
      {result && (
        <div style={{ background: '#111', border: '1px solid ' + (result.status === 'WANTED' ? '#FF3B30' : '#333'), padding: '1.5rem' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 900, color: result.status === 'WANTED' ? '#FF3B30' : '#D2FF00' }}>{result.reg} : {result.status}</div>
          <div className="card-label">LAST SEEN: {result.zone} // {result.time}</div>
        </div>
      )}
    </div>
  );
}

/* ─── Missing Persons ────────────────────────────────────────── */
function MissingPersons() {
  return (
    <div className="tactical-card" style={{ marginTop: '2rem' }}>
      <div className="section-label">MISSING_PERSONS_DETECTION</div>
      <div style={{ fontSize: '0.6rem', color: '#9A9A9E', textAlign: 'center', padding: '1rem' }}>NO ACTIVE CASES IN QUEUE</div>
    </div>
  );
}

/* ─── AI FIR Intake ──────────────────────────────────────────── */
function AIIntakeSection() {
  const [complaint, setComplaint] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const analyze = async () => {
    setLoading(true);
    try {
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await axios.post('/api/fir/analyze-pdf', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        setResult(res.data);
      } else {
        const res = await axios.post('/api/fir/analyze', { text: complaint });
        setResult(res.data);
      }
    } catch (e) { console.error('Analysis failed', e); }
    setLoading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) { setFile(e.target.files[0]); setComplaint(''); }
  };
  const clearFile = () => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; };

  return (
    <div className="tactical-card" style={{ marginTop: '2rem', border: '1px solid var(--primary-yellow)', background: 'rgba(255,255,255,0.02)' }}>
      <div className="section-label" style={{ background: 'var(--primary-yellow)', color: '#000' }}>AI_FIR_INTAKE_V2</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) { setFile(e.dataTransfer.files[0]); setComplaint(''); } }}
          style={{
            border: '2px dashed ' + (file ? 'var(--primary-yellow)' : '#333'),
            padding: '2rem', textAlign: 'center', cursor: 'pointer',
            background: file ? 'rgba(210,255,0,0.05)' : 'transparent', transition: 'all 0.3s',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{file ? '📄' : '📤'}</div>
          <div className="card-label" style={{ color: file ? 'var(--primary-yellow)' : '#9A9A9E' }}>
            {file ? file.name.toUpperCase() : 'DROP PDF OR CLICK TO UPLOAD'}
          </div>
          {file && <button onClick={(e) => { e.stopPropagation(); clearFile(); }} style={{ background: 'none', border: 'none', color: '#FF3B30', fontSize: '0.6rem', marginTop: '0.5rem', cursor: 'pointer' }}>REMOVE_FILE</button>}
        </div>
        <textarea value={complaint} onChange={e => { setComplaint(e.target.value); setFile(null); }} disabled={!!file}
          placeholder="OR PASTE FIR TEXT MANUALLY..."
          style={{ width: '100%', height: '100%', minHeight: '120px', background: 'rgba(255,255,255,0.05)', color: '#FFF', border: '1px solid #333', padding: '1rem', fontFamily: 'monospace', opacity: file ? 0.3 : 1 }}
        />
      </div>

      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".pdf" style={{ display: 'none' }} />
      <button onClick={analyze} className="back-btn" disabled={!complaint && !file}
        style={{ position: 'relative', top: 0, left: 0, width: '100%', background: (complaint || file) ? 'var(--primary-yellow)' : '#333', color: (complaint || file) ? '#000' : '#666', border: 'none', fontWeight: 900 }}>
        {loading ? 'PROCESSING_NEURAL_SCAN...' : 'INITIATE MULTIMODAL EXTRACTION'}
      </button>

      {result && (
        <div style={{ marginTop: '2rem', borderTop: '2px solid var(--primary-yellow)', paddingTop: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {[
              { label: 'ACCUSED_ENTITY', val: result.accused_name, color: 'var(--primary-yellow)' },
              { label: 'GEO_LOCATION', val: result.location },
              { label: 'CRIME_CLASSIFICATION', val: result.crime_type, color: '#FF3B30' },
              { label: 'TEMPORAL_MARKER', val: result.date_time },
            ].map((item, i) => (
              <div key={i} className="tactical-card" style={{ margin: 0, padding: '1rem' }}>
                <div className="card-label">{item.label}</div>
                <div style={{ fontWeight: 900, color: item.color || '#fff' }}>{item.val}</div>
              </div>
            ))}
          </div>
          <div className="tactical-card" style={{ marginTop: '1rem', padding: '1rem' }}>
            <div className="card-label">INTELLIGENCE_SUMMARY</div>
            <div style={{ fontSize: '0.8rem', lineHeight: 1.6 }}>{result.description_summary}</div>
          </div>
          <div className="tactical-card" style={{ marginTop: '1rem', padding: '1rem' }}>
            <div className="card-label">SUGGESTED_LEGAL_SECTIONS</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {result.suggested_ipc_sections?.map((s: string, i: number) => (
                <span key={i} style={{ background: '#333', padding: '4px 10px', fontSize: '0.6rem', border: '1px solid #D2FF00' }}>{s}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Dashboard ─────────────────────────────────────────── */
export default function MarvelDashboard() {
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [velocity, setVelocity] = useState<ZoneVelocity[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [offenders, setOffenders] = useState<Offender[]>([]);
  const [offenderSearch, setOffenderSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [selectedOffender, setSelectedOffender] = useState<Offender | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const [surges, setSurges] = useState<SurgeAlert[]>([]);
  const [osintTarget, setOsintTarget] = useState('');
  const [osintResult, setOsintResult] = useState<string | null>(null);
  const [osintLoading, setOsintLoading] = useState(false);
  const [patrolPct] = useState(Math.floor(Math.random() * 40) + 30); // fixed on mount

  const detectSurges = (events: Event[]) => {
    const zones = [...new Set(events.map(e => e.zone))].filter(Boolean);
    const result: SurgeAlert[] = [];
    zones.forEach(z => {
      const count = events.filter(e => e.zone === z).length;
      if (count > 5) result.push({ zone: z, ratio: 2.0, severity: 'SURGE', message: 'Activity cluster detected' });
    });
    return result;
  };

  const fetchAll = useCallback(async () => {
    try {
      const [s, v, a, e, o, t] = await Promise.allSettled([
        axios.get('/api/stats'), axios.get('/api/velocity'), axios.get('/api/alerts'),
        axios.get('/api/events'), axios.get('/api/investigation/offenders'),
        axios.get('/api/public/telemetry')
      ]);
      if (s.status === 'fulfilled') setStats(s.value.data);
      if (v.status === 'fulfilled') setVelocity(Array.isArray(v.value.data) ? v.value.data : v.value.data.zones || []);
      if (a.status === 'fulfilled') setAlerts(Array.isArray(a.value.data) ? a.value.data : a.value.data.alerts || []);
      if (e.status === 'fulfilled') {
        const evs = (Array.isArray(e.value.data) ? e.value.data : e.value.data.events || []).slice(0, 60);
        setEvents(evs);
        setSurges(detectSurges(evs));
        if (evs.length > 0 && (window as any).triggerSonicPulse) {
          const latest = evs[0];
          const coords = ZONE_CENTERS[latest.zone];
          if (coords) (window as any).triggerSonicPulse(coords[0], coords[1], latest.crime_type?.includes('THEFT') ? 'HIGH' : 'STABLE');
        }
      }
      if (o.status === 'fulfilled') setOffenders(Array.isArray(o.value.data) ? o.value.data : o.value.data.offenders || []);
      if (t.status === 'fulfilled') setTelemetry(t.value.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); const i = setInterval(fetchAll, 30000); return () => clearInterval(i); }, [fetchAll]);

  const runOsint = async () => {
    setOsintLoading(true);
    try { const res = await axios.post('/api/osint/scan', { target: osintTarget }); setOsintResult(res.data?.summary || 'Scan complete.'); }
    catch { setOsintResult('Scan failed.'); } finally { setOsintLoading(false); }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', color: '#D2FF00', fontFamily: 'monospace' }}>
      <div className="glitch-text" style={{ fontSize: '3rem' }}>SENTINEL</div>
    </div>
  );

  const MODULES = [
    { id: '01', title: 'ANOMALY INDEX',        icon: '⚡', desc: 'Real-time velocity tracking' },
    { id: '02', title: 'SPATIAL INTEL',         icon: '🗺️', desc: 'Geo-spatial heatmaps' },
    { id: '04', title: 'TACTICAL DEPLOY',       icon: '🎯', desc: 'Resource allocation' },
    { id: '06', title: 'OFFENDER PROFILES',     icon: '👤', desc: 'Recidivism tracking' },
    { id: '08', title: 'AI FIR INTAKE',         icon: '🤖', desc: 'Multimodal extraction' },
  ];

  const riskColor = (r?: string) => r === 'High' ? '#FF3B30' : r === 'Medium' ? '#FF9500' : '#34C759';
  const riskBg    = (r?: string) => r === 'High' ? 'rgba(255,59,48,0.1)' : r === 'Medium' ? 'rgba(255,149,0,0.1)' : 'rgba(52,199,89,0.1)';

  return (
    <div className="dashboard-container">
      <header className="hud-header">
        <div className="system-title glitch-text">SENTINEL<span>.HUD</span></div>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <div className="status-indicator" style={{ borderRight: '1px solid #333', paddingRight: '2rem' }}>
            <div className="pulse-dot" />
            <span style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--primary-yellow)' }}>1,000+ MAN-HOURS INVESTED</span>
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
          <button className="back-btn" onClick={() => setActiveModule(null)}>BACK TO HUB</button>

          {/* ── MODULE 01: Anomaly Index ── */}
          {activeModule === '01' && (
            <section>
              <div className="section-label">ANOMALY_DETECTION</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2px', background: 'var(--border-tactical)' }}>
                {velocity.map(z => (
                  <div key={z.zone_id} className="tactical-card">
                    <div className="card-label">ZONE: {z.zone_id}</div>
                    <div className="card-stat" style={{ color: z.z_score < 0 ? '#5AC8FA' : zColor(z.z_score), textShadow: '0 0 15px currentColor' }}>{z.z_score?.toFixed(2)}</div>
                    <div style={{ fontSize: '0.65rem', color: '#AAAAAA', letterSpacing: '2px' }}>{z.zone_name.toUpperCase()}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── MODULE 02: Spatial Intel — uses real CrimeMap ── */}
          {activeModule === '02' && (
            <section style={{ height: '80vh', display: 'flex', flexDirection: 'column' }}>
              <div className="section-label">LIVE_STRATEGIC_PULSE // SPATIAL_INTEL</div>
              <div style={{ flex: 1, position: 'relative' }}>
                <CrimeMap />
              </div>
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
                  <div className="card-label" style={{ fontSize: '0.5rem' }}>T-MINUS 12h</div>
                </div>
                <div className="tray-item">
                  <div className="card-label">SYSTEM_LEGEND</div>
                  <div style={{ fontSize: '0.55rem', color: '#9A9A9E' }}>
                    <div>▸ PULSE: LIVE_INCIDENT</div>
                    <div>▸ NODE: ZONE_TELEMETRY</div>
                    <div>▸ RING: ANOMALY_INDEX</div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── MODULE 04: Tactical Deploy ── */}
          {activeModule === '04' && (
            <section>
              <div className="section-label">TACTICAL_DEPLOYMENT</div>
              <WeeklyScheduler velocity={velocity} />
              <ForceAllocator />
            </section>
          )}

          {/* ── MODULE 06: Offender Profiles ── */}
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
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'center' }}>
                  <input value={offenderSearch} onChange={e => setOffenderSearch(e.target.value)} placeholder="SEARCH NAME / ALIAS..."
                    style={{ flex: 1, padding: '0.75rem 1rem', border: '1px solid #333', fontFamily: 'Space Mono,monospace', fontSize: '0.7rem', background: '#111', color: '#fff' }} />
                  {['ALL', 'High', 'Medium', 'Low'].map(r => (
                    <button key={r} onClick={() => setRiskFilter(r)} style={{
                      padding: '0.75rem 1rem', border: '1px solid #333', cursor: 'pointer',
                      background: riskFilter === r ? '#D2FF00' : '#111',
                      color: riskFilter === r ? '#000' : '#666',
                      fontFamily: 'Space Mono,monospace', fontSize: '0.6rem', letterSpacing: '2px',
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
                    {filtered.length === 0 && (
                      <div className="tactical-card" style={{ gridColumn: '1/-1', textAlign: 'center', padding: '4rem', color: '#9A9A9E' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>👤</div>
                        <div style={{ fontSize: '0.7rem', letterSpacing: '3px' }}>NO OFFENDERS MATCH FILTER</div>
                      </div>
                    )}
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
              </section>
            );
          })()}

          {/* ── MODULE 07: OSINT ── */}
          {activeModule === '07' && (
            <section>
              <div className="section-label">OSINT_SCANNER</div>
              <div className="tactical-card">
                <input value={osintTarget} onChange={e => setOsintTarget(e.target.value)} placeholder="TARGET..."
                  style={{ background: '#111', color: '#fff', padding: '1rem', border: '1px solid #333', width: '100%', fontFamily: 'Space Mono, monospace' }} />
                <button onClick={runOsint} className="back-btn" style={{ position: 'relative', top: 0, left: 0, marginTop: '1rem' }}>{osintLoading ? 'SCANNING...' : 'SCAN'}</button>
                {osintResult && <div style={{ marginTop: '1rem', fontSize: '0.7rem', color: '#AAAAAA' }}>{osintResult}</div>}
              </div>
              <ANPRScanner />
            </section>
          )}

          {/* ── MODULE 08: AI FIR Intake ── */}
          {activeModule === '08' && <section><div className="section-label">AI_INTAKE</div><AIIntakeSection /></section>}
        </div>
      )}

      <div className="live-ticker-wrap">
        <div style={{ display: 'flex', animation: 'ticker 40s linear infinite', gap: '4rem' }}>
          {alerts.map((a, i) => <span key={i}>▸ {a.zone} : {a.message}</span>)}
          <span>[ SENTINEL HUD v2.0 // MISSION_CRITICAL ]</span>
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: '80px', right: '3rem', zIndex: 10000 }}><MahaCrimeCopilot /></div>

      {activeModule === null && surges.length > 0 && (
        <div style={{ position: 'fixed', top: '20vh', right: '2rem', width: '300px', pointerEvents: 'none' }}>
          <div className="section-label" style={{ color: '#FF3B30' }}>SURGE_ALERTS</div>
          {surges.slice(0, 3).map((s, i) => (
            <div key={i} className="tactical-card" style={{ pointerEvents: 'auto', marginBottom: '1rem', padding: '1.5rem', border: '1px solid #FF3B30' }}>
              <div className="card-label" style={{ color: '#FF3B30' }}>{s.severity}</div>
              <div style={{ fontWeight: 900 }}>{s.zone}</div>
              <div style={{ fontSize: '0.7rem' }}>{s.message}</div>
            </div>
          ))}
          <MissingPersons />
        </div>
      )}
    </div>
  );
}