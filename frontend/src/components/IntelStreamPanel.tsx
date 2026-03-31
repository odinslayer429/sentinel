import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

// ── Types ──────────────────────────────────────────────────────────────────
interface IntelEvent {
  id: number;
  title: string;
  description?: string;
  crime_types?: string;
  zone?: string;
  zone_id?: string;
  severity?: string;
  published_at?: string;
  ingested_at?: string;
  source?: string;
  url?: string;
  _isNew?: boolean; // flash marker
}

// ── Helpers ────────────────────────────────────────────────────────────────
const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#FF2D55',
  HIGH:     '#FF3B30',
  MEDIUM:   '#FF9500',
  LOW:      '#5AC8FA',
};

function deriveSeverity(ev: IntelEvent): string {
  if (ev.severity) return ev.severity.toUpperCase();
  const ct = (ev.crime_types || '').toUpperCase();
  if (ct.match(/MURDER|RAPE|KIDNAP|DACOITY/))     return 'CRITICAL';
  if (ct.match(/ROBBERY|ASSAULT|RIOT|ARSON/))      return 'HIGH';
  if (ct.match(/THEFT|BURGLARY|FRAUD|CYBER/))      return 'MEDIUM';
  return 'LOW';
}

function fmtTime(iso?: string) {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── IntelStreamPanel ───────────────────────────────────────────────────────
export default function IntelStreamPanel() {
  const [events,      setEvents]      = useState<IntelEvent[]>([]);
  const [filter,      setFilter]      = useState('ALL');
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [newCount,    setNewCount]    = useState(0);
  const [lastSeen,    setLastSeen]    = useState<number>(0); // highest id seen
  const [autoScroll,  setAutoScroll]  = useState(true);
  const feedRef   = useRef<HTMLDivElement>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Initial load: last 3 hours (falls back to latest if DB is sparse) ──
  const initialLoad = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await axios.get<IntelEvent[]>('/api/events/recent?hours=3&limit=200');
      const data = Array.isArray(res.data) ? res.data : [];
      const enriched = data.map(e => ({ ...e, severity: deriveSeverity(e), _isNew: false }));
      setEvents(enriched);
      const maxId = enriched.reduce((m, e) => Math.max(m, e.id), 0);
      setLastSeen(maxId);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load intel stream.');
    } finally { setLoading(false); }
  }, []);

  // ── Poll for new entries every 20 s ──────────────────────────────────────
  const pollNew = useCallback(async () => {
    try {
      // Fetch last 5 min to catch any burst
      const res = await axios.get<IntelEvent[]>('/api/events/recent?hours=0&since=' +
        new Date(Date.now() - 5 * 60 * 1000).toISOString() + '&limit=50');
      const fresh = (Array.isArray(res.data) ? res.data : [])
        .filter(e => e.id > lastSeen);
      if (fresh.length === 0) return;

      const enriched = fresh.map(e => ({ ...e, severity: deriveSeverity(e), _isNew: true }));
      setEvents(prev => {
        // prepend new entries, deduplicate by id
        const merged = [...enriched, ...prev];
        const seen = new Set<number>();
        return merged.filter(e => seen.has(e.id) ? false : (seen.add(e.id), true));
      });
      const maxNew = fresh.reduce((m, e) => Math.max(m, e.id), lastSeen);
      setLastSeen(maxNew);
      setNewCount(c => c + fresh.length);

      // Clear flash flag after 4 s
      setTimeout(() => {
        setEvents(prev => prev.map(e => ({ ...e, _isNew: false })));
      }, 4000);

      // Auto-scroll feed to top if user hasn't scrolled away
      if (autoScroll && feedRef.current) feedRef.current.scrollTop = 0;
    } catch { /* silent — don't disturb existing feed on poll error */ }
  }, [lastSeen, autoScroll]);

  useEffect(() => { initialLoad(); }, [initialLoad]);

  useEffect(() => {
    if (loading) return;
    pollRef.current = setInterval(pollNew, 20_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pollNew, loading]);

  // Detect manual scroll to pause auto-scroll
  const handleScroll = () => {
    if (!feedRef.current) return;
    setAutoScroll(feedRef.current.scrollTop < 60);
  };

  // ── Derived data ─────────────────────────────────────────────────────────
  const enriched  = events;
  const filtered  = filter === 'ALL' ? enriched : enriched.filter(e => e.severity === filter);
  const counts    = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<string, number>;
  enriched.forEach(e => { const s = e.severity!; if (s in counts) counts[s]++; });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section>
      {/* Inline flash keyframe */}
      <style>{`
        @keyframes intelFlash {
          0%   { background: rgba(210,255,0,0.18); }
          60%  { background: rgba(210,255,0,0.08); }
          100% { background: rgba(255,255,255,0.02); }
        }
        .intel-new { animation: intelFlash 4s ease-out forwards; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div className="section-label" style={{ margin: 0, border: 'none', padding: 0 }}>LIVE INCIDENT FEED — LAST 3 HOURS</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {newCount > 0 && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
              style={{ padding: '3px 10px', fontSize: '0.5rem', letterSpacing: 2, background: 'rgba(210,255,0,0.12)', border: '1px solid rgba(210,255,0,0.4)', color: '#D2FF00', cursor: 'pointer' }}
              onClick={() => { setNewCount(0); if (feedRef.current) feedRef.current.scrollTop = 0; }}>
              +{newCount} NEW — SCROLL TO TOP
            </motion.div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#34C759', boxShadow: '0 0 8px #34C759', animation: 'pulse 1.5s infinite' }} />
            <span style={{ fontSize: '0.5rem', color: '#34C759', letterSpacing: 2 }}>LIVE · {enriched.length} LOADED</span>
          </div>
          <button onClick={initialLoad} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.08)', color: '#555', padding: '4px 10px', fontSize: '0.5rem', fontFamily: 'Space Mono,monospace', letterSpacing: 2, cursor: 'pointer' }}>↺ REFRESH</button>
        </div>
      </div>

      {/* Severity tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '1.5rem' }}>
        {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map(s => (
          <div key={s} onClick={() => setFilter(filter === s ? 'ALL' : s)}
            style={{ textAlign: 'center', padding: '1.25rem', cursor: 'pointer', background: 'rgba(0,0,0,0.4)',
              borderTop: `3px solid ${SEV_COLOR[s]}`,
              opacity: filter === s || filter === 'ALL' ? 1 : 0.3, transition: 'opacity 0.2s' }}>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: SEV_COLOR[s] }}>{counts[s]}</div>
            <div style={{ fontSize: '0.6rem', fontWeight: 900, color: SEV_COLOR[s], marginTop: 4, letterSpacing: 1 }}>{s}</div>
            <div style={{ fontSize: '0.5rem', color: '#444', marginTop: 2 }}>
              {s === 'CRITICAL' ? 'Respond now' : s === 'HIGH' ? 'Respond soon' : s === 'MEDIUM' ? 'Monitor' : 'Routine'}
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {['ALL','CRITICAL','HIGH','MEDIUM','LOW'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: '0.4rem 0.9rem', fontSize: '0.55rem', letterSpacing: 2, cursor: 'pointer',
            fontFamily: 'Space Mono,monospace',
            border: '1px solid ' + (filter === s ? SEV_COLOR[s] || '#D2FF00' : 'rgba(255,255,255,0.08)'),
            background: filter === s ? (SEV_COLOR[s] || '#D2FF00') : 'transparent',
            color: filter === s ? '#000' : '#555', transition: 'all 0.2s'
          }}>{s}</button>
        ))}
      </div>

      {/* States */}
      {loading && (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'4rem', gap:'1rem' }}>
          <div style={{ width:32, height:32, border:'2px solid #1a1a1a', borderTop:'2px solid #D2FF00', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
          <div style={{ fontSize:'0.55rem', color:'#555', letterSpacing:4 }}>LOADING INTEL STREAM...</div>
        </div>
      )}

      {!loading && error && (
        <div style={{ textAlign:'center', padding:'3rem' }}>
          <div style={{ color:'#FF3B30', fontSize:'0.65rem', letterSpacing:2 }}>⚠ {error}</div>
          <button onClick={initialLoad} style={{ marginTop:'1rem', background:'none', border:'1px solid #FF3B30', color:'#FF3B30', padding:'0.5rem 1.5rem', fontFamily:'Space Mono,monospace', fontSize:'0.6rem', cursor:'pointer', letterSpacing:2 }}>RETRY</button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'4rem', gap:'1rem' }}>
          <div style={{ fontSize:'2.5rem', opacity:0.4 }}>📡</div>
          <div style={{ fontSize:'0.55rem', letterSpacing:3, color:'#444' }}>NO INCIDENTS IN THIS WINDOW</div>
        </div>
      )}

      {/* Feed */}
      {!loading && !error && filtered.length > 0 && (
        <div ref={feedRef} onScroll={handleScroll}
          style={{ height: '65vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1,
            scrollbarWidth: 'thin', scrollbarColor: '#1a1a1a transparent' }}>
          <AnimatePresence initial={false}>
            {filtered.map((ev, i) => (
              <motion.div
                key={ev.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, delay: ev._isNew ? 0 : Math.min(i * 0.008, 0.4) }}
                className={ev._isNew ? 'intel-new' : ''}
                style={{
                  padding: '1rem 1.5rem',
                  background: 'rgba(255,255,255,0.02)',
                  borderLeft: `3px solid ${SEV_COLOR[ev.severity!] || '#555'}`,
                  display: 'flex', alignItems: 'flex-start', gap: '1.5rem',
                }}
              >
                {/* Timestamp column */}
                <div style={{ minWidth: 70, flexShrink: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: SEV_COLOR[ev.severity!], fontWeight: 900, letterSpacing: 1, marginBottom: 4 }}>
                    {ev.severity === 'CRITICAL' ? '🔴' : ev.severity === 'HIGH' ? '🟠' : ev.severity === 'MEDIUM' ? '🟡' : '🔵'}
                    {' '}{ev.severity}
                  </div>
                  <div style={{ fontSize: '0.5rem', color: '#555' }}>{fmtTime(ev.published_at)}</div>
                  <div style={{ fontSize: '0.45rem', color: '#333' }}>{fmtDate(ev.published_at)}</div>
                  <div style={{ fontSize: '0.45rem', color: '#2a2a2a', marginTop: 2 }}>{relativeTime(ev.published_at)}</div>
                </div>

                {/* Title + description */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: '0.75rem', marginBottom: 4, lineHeight: 1.4,
                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {ev.url ? (
                      <a href={ev.url} target="_blank" rel="noreferrer"
                        style={{ color: 'inherit', textDecoration: 'none' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#D2FF00')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'inherit')}>
                        {ev.title}
                      </a>
                    ) : ev.title}
                  </div>
                  {ev.description && (
                    <div style={{ fontSize: '0.6rem', color: '#555', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.5 }}>
                      {ev.description}
                    </div>
                  )}
                </div>

                {/* Meta column */}
                <div style={{ minWidth: 100, textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#888', fontWeight: 700, letterSpacing: 1 }}>
                    {ev.zone || ev.zone_id || '—'}
                  </div>
                  {ev.crime_types && (
                    <div style={{ fontSize: '0.5rem', color: '#D2FF00', marginTop: 3 }}>
                      {ev.crime_types.replace(/_/g,' ').substring(0, 20)}
                    </div>
                  )}
                  {ev.source && (
                    <div style={{ fontSize: '0.45rem', color: '#444', marginTop: 3, letterSpacing: 1 }}>
                      {ev.source.toUpperCase()}
                    </div>
                  )}
                  {ev.url && (
                    <a href={ev.url} target="_blank" rel="noreferrer"
                      style={{ fontSize: '0.45rem', color: '#00FFFF', marginTop: 4, display: 'inline-block',
                        padding: '2px 6px', border: '1px solid rgba(0,255,255,0.2)', letterSpacing: 1,
                        textDecoration: 'none', transition: 'background 0.2s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,255,255,0.08)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      SOURCE ↗
                    </a>
                  )}
                  {ev._isNew && (
                    <div style={{ fontSize: '0.45rem', color: '#D2FF00', marginTop: 4, letterSpacing: 2, fontWeight: 900 }}>● NEW</div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Auto-scroll indicator */}
      {!autoScroll && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          onClick={() => { if (feedRef.current) feedRef.current.scrollTop = 0; setAutoScroll(true); }}
          style={{ position: 'sticky', bottom: 0, textAlign: 'center', padding: '0.6rem',
            background: 'rgba(210,255,0,0.08)', border: '1px solid rgba(210,255,0,0.2)',
            color: '#D2FF00', fontSize: '0.5rem', letterSpacing: 2, cursor: 'pointer' }}>
          ↑ SCROLL TO TOP FOR LIVE UPDATES
        </motion.div>
      )}
    </section>
  );
}
