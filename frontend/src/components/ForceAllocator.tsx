import React, { useState, useCallback } from 'react';
import axios from 'axios';

type ScenarioKey = 'NORMAL' | 'ELEVATED' | 'CRITICAL';
type ShiftKey    = 'MORNING' | 'AFTERNOON' | 'NIGHT';

// Matches backend ZoneAllocation shape from patrol_optimizer
interface ZoneAllocation {
  zone_id:           string;
  zone:              string;        // zone name
  officers_assigned: number;
  risk_score:        number;        // 0-100
  patrol_type: {
    type:      string;              // RAPID_RESPONSE | MOBILE_PATROL | BEAT_PATROL | MONITORING
    formation: string;              // e.g. "QRV + Fixed Picket"
  };
  dispatch: {
    unit_name: string;
    eta_mins:  number;
  };
}

interface ZoneBriefing {
  strategic_rollout: string;
  shift_advice:      string;
  priority_action:   string;
}

interface TacticalResult {
  shift:             string;
  total_officers:    number;
  allocation:        ZoneAllocation[];
  briefing?: {
    deployment_order: string;
    briefings:        Record<string, ZoneBriefing>;
  };
  dispatch_tasks_created?: number[];
  committed_at?:           string;
}

const riskColor = (score: number) =>
  score >= 75 ? '#FF3B30' : score >= 50 ? '#FF9500' : score >= 25 ? '#D2FF00' : '#34C759';

const riskLabel = (score: number) =>
  score >= 75 ? '🔴 CRITICAL' : score >= 50 ? '🟠 HIGH' : score >= 25 ? '🟡 MEDIUM' : '🟢 LOW';

const patrolColor: Record<string, string> = {
  RAPID_RESPONSE: '#FF3B30',
  MOBILE_PATROL:  '#FF9500',
  BEAT_PATROL:    '#D2FF00',
  MONITORING:     '#5AC8FA',
};

const DAYS = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];

const ForceAllocator: React.FC = () => {
  const today = DAYS[new Date().getDay()];

  const [scenario,    setScenario]    = useState<ScenarioKey>('NORMAL');
  const [shift,       setShift]       = useState<ShiftKey>('MORNING');
  const [officers,    setOfficers]    = useState(60);
  const [result,      setResult]      = useState<TacticalResult | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [committing,  setCommitting]  = useState(false);
  const [committed,   setCommitted]   = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);

  // ── Call /api/tactical/deploy/full — LP optimizer + AI briefings ────────────
  const runDeploy = useCallback(async () => {
    setLoading(true); setError(null); setResult(null); setCommitted(false);
    try {
      const res = await axios.post<TacticalResult>(
        `/api/tactical/deploy/full?total_officers=${officers}&shift=${shift}&scenario=${scenario}&day=${today}`
      );
      setResult(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Tactical deployment failed — check backend.');
    } finally {
      setLoading(false);
    }
  }, [officers, shift, scenario, today]);

  // ── Call /api/tactical/deploy/commit — writes Alerts + DispatchTasks to DB ──
  const commitDeploy = useCallback(async () => {
    setCommitting(true); setError(null);
    try {
      const res = await axios.post<TacticalResult>(
        `/api/tactical/deploy/commit?total_officers=${officers}&shift=${shift}&scenario=${scenario}&day=${today}`
      );
      setResult(res.data);
      setCommitted(true);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Commit failed.');
    } finally {
      setCommitting(false);
    }
  }, [officers, shift, scenario, today]);

  // ── Summary numbers ─────────────────────────────────────────────────────────
  const totalOfficers = result?.allocation.reduce((s, z) => s + z.officers_assigned, 0) ?? 0;
  const criticalZones = result?.allocation.filter(z => z.risk_score >= 75).length ?? 0;
  const highZones     = result?.allocation.filter(z => z.risk_score >= 50 && z.risk_score < 75).length ?? 0;

  return (
    <div className="force-allocator">

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1px' }}>

        {/* Scenario */}
        <div className="tactical-card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 3, marginBottom: '0.75rem' }}>SCENARIO</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['NORMAL','ELEVATED','CRITICAL'] as ScenarioKey[]).map(sc => (
              <button key={sc} onClick={() => setScenario(sc)} style={{
                flex: 1, padding: '0.5rem', fontFamily: 'Space Mono,monospace', fontSize: '0.5rem',
                letterSpacing: 1, cursor: 'pointer', border: '1px solid',
                borderColor: scenario === sc
                  ? (sc === 'CRITICAL' ? '#FF3B30' : sc === 'ELEVATED' ? '#FF9500' : '#34C759')
                  : 'rgba(255,255,255,0.08)',
                background: scenario === sc ? 'rgba(255,255,255,0.05)' : 'transparent',
                color: scenario === sc
                  ? (sc === 'CRITICAL' ? '#FF3B30' : sc === 'ELEVATED' ? '#FF9500' : '#34C759')
                  : '#444',
                fontWeight: scenario === sc ? 900 : 400,
              }}>{sc}</button>
            ))}
          </div>
        </div>

        {/* Shift */}
        <div className="tactical-card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 3, marginBottom: '0.75rem' }}>SHIFT</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['MORNING','AFTERNOON','NIGHT'] as ShiftKey[]).map(sh => (
              <button key={sh} onClick={() => setShift(sh)} style={{
                flex: 1, padding: '0.5rem', fontFamily: 'Space Mono,monospace', fontSize: '0.5rem',
                letterSpacing: 1, cursor: 'pointer', border: '1px solid',
                borderColor: shift === sh ? '#D2FF00' : 'rgba(255,255,255,0.08)',
                background: shift === sh ? 'rgba(210,255,0,0.06)' : 'transparent',
                color: shift === sh ? '#D2FF00' : '#444',
                fontWeight: shift === sh ? 900 : 400,
              }}>{sh}</button>
            ))}
          </div>
        </div>

        {/* Officer count */}
        <div className="tactical-card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 3, marginBottom: '0.75rem' }}>OFFICERS AVAILABLE</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={() => setOfficers(o => Math.max(10, o - 10))} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#888', padding: '4px 10px', cursor: 'pointer', fontFamily: 'Space Mono,monospace', fontSize: '0.8rem' }}>−</button>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: '#D2FF00', flex: 1, textAlign: 'center' }}>{officers}</div>
            <button onClick={() => setOfficers(o => Math.min(200, o + 10))} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#888', padding: '4px 10px', cursor: 'pointer', fontFamily: 'Space Mono,monospace', fontSize: '0.8rem' }}>+</button>
          </div>
        </div>

        {/* Run button */}
        <div className="tactical-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.5rem' }}>
          <button onClick={runDeploy} disabled={loading} style={{
            padding: '0.9rem', fontFamily: 'Space Mono,monospace', fontSize: '0.6rem',
            letterSpacing: 2, cursor: loading ? 'not-allowed' : 'pointer',
            border: '1px solid rgba(210,255,0,0.4)',
            background: loading ? 'rgba(210,255,0,0.03)' : 'rgba(210,255,0,0.08)',
            color: loading ? '#555' : '#D2FF00', fontWeight: 900,
          }}>
            {loading ? 'RUNNING OPTIMIZER...' : '⚡ RUN DEPLOYMENT PLAN'}
          </button>
          <div style={{ fontSize: '0.45rem', color: '#333', textAlign: 'center', letterSpacing: 1 }}>LP optimizer + AI briefings · {today}</div>
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '1rem 1.5rem', background: 'rgba(255,59,48,0.06)', border: '1px solid rgba(255,59,48,0.2)', color: '#FF3B30', fontSize: '0.65rem', marginBottom: '1px' }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Loading state ─────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ padding: '4rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 32, height: 32, border: '2px solid #1a1a1a', borderTop: '2px solid #D2FF00', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <div style={{ fontSize: '0.55rem', color: '#555', letterSpacing: 4 }}>RUNNING LP OPTIMIZER + FETCHING AI BRIEFINGS...</div>
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {!loading && result && (
        <>
          {/* Summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1px' }}>
            {[
              { label: 'TOTAL OFFICERS DEPLOYED', val: totalOfficers,                   color: '#D2FF00' },
              { label: 'CRITICAL ZONES',           val: criticalZones,                  color: '#FF3B30', note: 'Risk ≥ 75' },
              { label: 'HIGH RISK ZONES',           val: highZones,                     color: '#FF9500', note: 'Risk 50–74' },
              { label: 'SHIFT',                     val: result.shift?.toUpperCase(),   color: '#00FFFF' },
            ].map((s, i) => (
              <div key={i} className="tactical-card" style={{ textAlign: 'center', padding: '1.25rem' }}>
                <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 2 }}>{s.label}</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: s.color, margin: '0.5rem 0 0.25rem' }}>{s.val}</div>
                {s.note && <div style={{ fontSize: '0.45rem', color: '#333' }}>{s.note}</div>}
              </div>
            ))}
          </div>

          {/* AI Deployment Order */}
          {result.briefing?.deployment_order && (
            <div className="tactical-card" style={{ marginBottom: '1px', padding: '1.5rem', borderLeft: '3px solid #D2FF00' }}>
              <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 3, marginBottom: '0.75rem' }}>📋 SHIFT COMMANDER DEPLOYMENT ORDER</div>
              <div style={{ fontSize: '0.75rem', lineHeight: 1.8, color: '#ccc' }}>{result.briefing.deployment_order}</div>
            </div>
          )}

          {/* Zone allocation cards */}
          <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 3, padding: '1.25rem 0 0.75rem' }}>ZONE-BY-ZONE ALLOCATION</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1px' }}>
            {[...result.allocation].sort((a, b) => b.risk_score - a.risk_score).map((z, i) => {
              const brief    = result.briefing?.briefings?.[z.zone_id];
              const isOpen   = expandedZone === z.zone_id;
              const pColor   = patrolColor[z.patrol_type?.type] || '#D2FF00';
              const rc       = riskColor(z.risk_score);

              return (
                <div key={z.zone_id}
                  onClick={() => setExpandedZone(isOpen ? null : z.zone_id)}
                  style={{
                    padding: '1.5rem', borderLeft: `3px solid ${rc}`,
                    background: 'rgba(255,255,255,0.01)', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: '0.6rem',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.01)')}
                >
                  {/* Zone name + risk badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 2 }}>ZONE {z.zone_id}</div>
                      <div style={{ fontWeight: 900, fontSize: '0.9rem', letterSpacing: 2, color: '#eee', marginTop: 2 }}>{z.zone}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.6rem', fontWeight: 900, color: rc }}>{riskLabel(z.risk_score)}</div>
                      <div style={{ fontSize: '0.5rem', color: '#444', marginTop: 2 }}>RISK SCORE {Math.round(z.risk_score)}</div>
                    </div>
                  </div>

                  {/* Officers + patrol type */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.4rem' }}>👮</span>
                      <div>
                        <div style={{ fontWeight: 900, fontSize: '1.6rem', color: '#D2FF00', lineHeight: 1 }}>{z.officers_assigned}</div>
                        <div style={{ fontSize: '0.45rem', color: '#555' }}>OFFICERS</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.6rem', fontWeight: 900, color: pColor, letterSpacing: 1 }}>{z.patrol_type?.type?.replace(/_/g, ' ')}</div>
                      <div style={{ fontSize: '0.5rem', color: '#444', marginTop: 2 }}>{z.patrol_type?.formation}</div>
                    </div>
                  </div>

                  {/* Dispatch ETA */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: 'rgba(255,255,255,0.02)', marginTop: '0.25rem' }}>
                    <div style={{ fontSize: '0.55rem', color: '#888' }}>🚔 NEAREST UNIT</div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.6rem', fontWeight: 900, color: '#00FFFF' }}>{z.dispatch?.unit_name}</div>
                      <div style={{ fontSize: '0.5rem', color: '#555', marginTop: 1 }}>ETA {z.dispatch?.eta_mins} MIN</div>
                    </div>
                  </div>

                  {/* Expand indicator */}
                  <div style={{ fontSize: '0.45rem', color: '#333', textAlign: 'center', letterSpacing: 2 }}>
                    {isOpen ? '▲ HIDE BRIEFING' : '▼ SHOW AI BRIEFING'}
                  </div>

                  {/* AI briefing — expanded */}
                  {isOpen && brief && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div>
                        <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 2, marginBottom: '0.4rem' }}>DEPLOYMENT PLAN</div>
                        <div style={{ fontSize: '0.65rem', color: '#aaa', lineHeight: 1.7 }}>{brief.strategic_rollout}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 2, marginBottom: '0.4rem' }}>SHIFT ADVICE</div>
                        <div style={{ fontSize: '0.65rem', color: '#aaa', lineHeight: 1.7 }}>{brief.shift_advice}</div>
                      </div>
                      <div style={{ padding: '0.75rem', background: `${rc}11`, border: `1px solid ${rc}33` }}>
                        <div style={{ fontSize: '0.5rem', color: rc, letterSpacing: 2, marginBottom: '0.4rem', fontWeight: 900 }}>PRIORITY ACTION</div>
                        <div style={{ fontSize: '0.7rem', color: rc, fontWeight: 700 }}>{brief.priority_action}</div>
                      </div>
                    </div>
                  )}
                  {isOpen && !brief && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem', fontSize: '0.6rem', color: '#444', textAlign: 'center' }}>
                      AI briefing available for top 5 risk zones only
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Committed tasks banner */}
          {committed && result.dispatch_tasks_created && (
            <div style={{ padding: '1rem 1.5rem', background: 'rgba(52,199,89,0.06)', border: '1px solid rgba(52,199,89,0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1px' }}>
              <div>
                <div style={{ fontSize: '0.65rem', fontWeight: 900, color: '#34C759', letterSpacing: 2 }}>✓ DEPLOYMENT COMMITTED TO DATABASE</div>
                <div style={{ fontSize: '0.55rem', color: '#555', marginTop: 4 }}>
                  {result.dispatch_tasks_created.length} dispatch tasks created · Alerts raised for high-risk zones · {new Date(result.committed_at!).toLocaleTimeString()}
                </div>
              </div>
              <div style={{ fontSize: '2rem' }}>✅</div>
            </div>
          )}

          {/* Commit button */}
          {!committed && (
            <button onClick={commitDeploy} disabled={committing} style={{
              width: '100%', padding: '1.25rem', marginTop: '1px',
              fontFamily: 'Space Mono,monospace', fontSize: '0.65rem', letterSpacing: 2,
              cursor: committing ? 'not-allowed' : 'pointer', fontWeight: 900,
              border: '1px solid rgba(255,59,48,0.4)',
              background: committing ? 'rgba(255,59,48,0.03)' : 'rgba(255,59,48,0.08)',
              color: committing ? '#555' : '#FF3B30',
            }}>
              {committing
                ? '⏳ COMMITTING DEPLOYMENT...'
                : `🚨 COMMIT DEPLOYMENT — RAISE ALERTS & DISPATCH ${totalOfficers} OFFICERS`}
            </button>
          )}
        </>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!loading && !result && !error && (
        <div style={{ padding: '4rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div style={{ fontSize: '3rem', opacity: 0.3 }}>⚡</div>
          <div style={{ fontSize: '0.55rem', color: '#444', letterSpacing: 3 }}>SET SCENARIO, SHIFT & OFFICER COUNT — THEN HIT RUN</div>
          <div style={{ fontSize: '0.5rem', color: '#333', letterSpacing: 2, marginTop: '0.5rem' }}>LP OPTIMIZER WILL ALLOCATE OFFICERS ACROSS ALL ZONES BY RISK SCORE</div>
        </div>
      )}

    </div>
  );
};

export default ForceAllocator;
