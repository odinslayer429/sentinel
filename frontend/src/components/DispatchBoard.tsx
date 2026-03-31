/**
 * DispatchBoard.tsx
 * Wired to:
 *   GET  /api/dispatch/summary        — header counts
 *   GET  /api/dispatch/tasks          — full task list
 *   PATCH /api/dispatch/tasks/{id}    — move task PENDING → ACKNOWLEDGED → RESOLVED
 */
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

interface DispatchAlert {
  title: string;
  severity: string;
  zone_id: string | null;
  zone: string | null;
}

interface Task {
  id: number;
  alert_id: number | null;
  user_id: number;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';
  notes: string;
  created_at: string | null;
  updated_at: string | null;
  alert: DispatchAlert | null;
}

interface Summary {
  counts: { PENDING: number; ACKNOWLEDGED: number; RESOLVED: number };
  total: number;
}

const sevColor = (s?: string) => {
  const v = (s || '').toUpperCase();
  if (v === 'CRITICAL') return '#FF2D55';
  if (v === 'HIGH')     return '#FF3B30';
  if (v === 'WARNING' || v === 'MEDIUM') return '#FF9500';
  return '#5AC8FA';
};

const statusColor = (s: string) => {
  if (s === 'PENDING')      return '#FF3B30';
  if (s === 'ACKNOWLEDGED') return '#FF9500';
  if (s === 'RESOLVED')     return '#34C759';
  return '#5AC8FA';
};

const NEXT_STATUS: Record<string, string> = {
  PENDING:      'ACKNOWLEDGED',
  ACKNOWLEDGED: 'RESOLVED',
  RESOLVED:     'RESOLVED',
};

const ACTION_LABEL: Record<string, string> = {
  PENDING:      'ACKNOWLEDGE',
  ACKNOWLEDGED: 'MARK RESOLVED',
  RESOLVED:     '✓ DONE',
};

const Spinner = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', flexDirection: 'column', gap: '1rem' }}>
    <div style={{ width: 32, height: 32, border: '2px solid #1a1a1a', borderTop: '2px solid #D2FF00', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <div style={{ fontSize: '0.55rem', color: '#555', letterSpacing: 4 }}>LOADING...</div>
  </div>
);

export default function DispatchBoard() {
  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [summary,  setSummary]  = useState<Summary | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [filter,   setFilter]   = useState<string>('ALL');
  const [updating, setUpdating] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [t, s] = await Promise.all([
        axios.get('/api/dispatch/tasks?limit=100'),
        axios.get('/api/dispatch/summary'),
      ]);
      setTasks(Array.isArray(t.data) ? t.data : []);
      setSummary(s.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load dispatch board.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const advance = async (task: Task) => {
    if (task.status === 'RESOLVED') return;
    const next = NEXT_STATUS[task.status];
    setUpdating(task.id);
    try {
      await axios.patch(`/api/dispatch/tasks/${task.id}`, { status: next, user_id: 1 });
      setTasks(prev =>
        prev.map(t => t.id === task.id ? { ...t, status: next as Task['status'] } : t)
      );
      setSummary(prev => {
        if (!prev) return prev;
        const c = { ...prev.counts };
        c[task.status as keyof typeof c] = Math.max(0, c[task.status as keyof typeof c] - 1);
        c[next as keyof typeof c] = (c[next as keyof typeof c] || 0) + 1;
        return { ...prev, counts: c };
      });
    } catch (e: any) {
      alert('Update failed: ' + (e?.response?.data?.detail || (e as any).message));
    } finally {
      setUpdating(null);
    }
  };

  const filtered = filter === 'ALL' ? tasks : tasks.filter(t => t.status === filter);

  const columns: Array<{ key: Task['status']; label: string; color: string }> = [
    { key: 'PENDING',      label: 'PENDING',      color: '#FF3B30' },
    { key: 'ACKNOWLEDGED', label: 'ACKNOWLEDGED', color: '#FF9500' },
    { key: 'RESOLVED',     label: 'RESOLVED',     color: '#34C759' },
  ];

  if (loading) return <Spinner />;

  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem', gap: '1rem' }}>
      <div style={{ color: '#FF3B30', fontSize: '0.65rem', letterSpacing: 2 }}>⚠ {error}</div>
      <button onClick={fetchAll} style={{ background: 'none', border: '1px solid #FF3B30', color: '#FF3B30', padding: '0.5rem 1.5rem', fontFamily: 'Space Mono,monospace', fontSize: '0.6rem', cursor: 'pointer', letterSpacing: 2 }}>RETRY</button>
    </div>
  );

  return (
    <section>
      <div className="section-label">DISPATCH COMMAND BOARD</div>

      {/* Summary header */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '2rem' }}>
          {[
            { label: 'TOTAL TASKS',  val: summary.total,               color: '#D2FF00' },
            { label: 'PENDING',      val: summary.counts.PENDING,      color: '#FF3B30' },
            { label: 'ACKNOWLEDGED', val: summary.counts.ACKNOWLEDGED, color: '#FF9500' },
            { label: 'RESOLVED',     val: summary.counts.RESOLVED,     color: '#34C759' },
          ].map((s, i) => (
            <div key={i} className="tactical-card" style={{ textAlign: 'center', padding: '1.5rem' }}>
              <div style={{ fontSize: '0.5rem', color: '#555', letterSpacing: 3, marginBottom: '0.5rem' }}>{s.label}</div>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: s.color, textShadow: `0 0 12px ${s.color}` }}>{s.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        {['ALL', 'PENDING', 'ACKNOWLEDGED', 'RESOLVED'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '0.4rem 0.9rem', fontSize: '0.55rem', letterSpacing: 2, cursor: 'pointer',
            fontFamily: 'Space Mono,monospace',
            border: '1px solid ' + (filter === f ? statusColor(f) : 'rgba(255,255,255,0.08)'),
            background: filter === f ? `${statusColor(f)}22` : 'transparent',
            color: filter === f ? statusColor(f) : '#555',
            transition: 'all 0.2s',
          }}>{f}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#34C759', boxShadow: '0 0 8px #34C759', animation: 'pulse 1.5s infinite' }} />
          <span style={{ fontSize: '0.5rem', color: '#34C759', letterSpacing: 2 }}>LIVE · {tasks.length} TASKS</span>
          <button onClick={fetchAll} style={{ marginLeft: '1rem', background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: '#555', padding: '0.3rem 0.8rem', fontFamily: 'Space Mono,monospace', fontSize: '0.5rem', cursor: 'pointer', letterSpacing: 2 }}>↺ REFRESH</button>
        </div>
      </div>

      {filtered.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '5rem', gap: '1rem' }}>
          <div style={{ fontSize: '2.5rem', opacity: 0.3 }}>📋</div>
          <div style={{ fontSize: '0.55rem', letterSpacing: 3, color: '#444' }}>NO DISPATCH TASKS</div>
        </div>
      )}

      {/* Kanban columns when ALL, flat list when filtered */}
      {filter === 'ALL' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1px', background: 'rgba(255,255,255,0.04)', alignItems: 'start' }}>
          {columns.map(col => {
            const colTasks = tasks.filter(t => t.status === col.key);
            return (
              <div key={col.key} style={{ padding: '1.5rem', background: '#0a0a0f', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, boxShadow: `0 0 8px ${col.color}` }} />
                  <div style={{ fontSize: '0.6rem', fontWeight: 900, color: col.color, letterSpacing: 3 }}>{col.label}</div>
                  <div style={{ marginLeft: 'auto', fontSize: '0.55rem', color: '#444', border: `1px solid ${col.color}44`, padding: '2px 8px' }}>{colTasks.length}</div>
                </div>
                <AnimatePresence>
                  {colTasks.map(task => (
                    <TaskCard key={task.id} task={task} onAdvance={advance} updating={updating === task.id} />
                  ))}
                </AnimatePresence>
                {colTasks.length === 0 && (
                  <div style={{ fontSize: '0.5rem', color: '#333', letterSpacing: 2, textAlign: 'center', padding: '2rem 0' }}>EMPTY</div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <AnimatePresence>
            {filtered.map(task => (
              <TaskCard key={task.id} task={task} onAdvance={advance} updating={updating === task.id} flat />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function TaskCard({
  task, onAdvance, updating, flat,
}: {
  task: Task;
  onAdvance: (t: Task) => void;
  updating: boolean;
  flat?: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.25 }}
      className="tactical-card"
      style={{
        padding: flat ? '1rem 1.5rem' : '1.25rem',
        borderLeft: `3px solid ${statusColor(task.status)}`,
        display: 'flex',
        flexDirection: flat ? 'row' : 'column',
        alignItems: flat ? 'center' : 'flex-start',
        gap: flat ? '2rem' : '0.75rem',
      }}
    >
      {/* Alert title + zone */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 900, fontSize: '0.75rem', letterSpacing: 1,
          whiteSpace: flat ? 'nowrap' : undefined,
          overflow: flat ? 'hidden' : undefined,
          textOverflow: flat ? 'ellipsis' : undefined,
        }}>
          {task.alert?.title || `TASK #${task.id}`}
        </div>
        {task.alert?.zone && (
          <div style={{ fontSize: '0.55rem', color: '#555', marginTop: 3, letterSpacing: 1 }}>ZONE: {task.alert.zone}</div>
        )}
        {task.notes && (
          <div style={{ fontSize: '0.55rem', color: '#666', marginTop: 4, fontStyle: 'italic' }}>{task.notes}</div>
        )}
      </div>

      {/* Severity badge */}
      {task.alert?.severity && (
        <div style={{
          fontSize: '0.5rem', fontWeight: 900, letterSpacing: 2,
          color: sevColor(task.alert.severity),
          border: `1px solid ${sevColor(task.alert.severity)}44`,
          background: `${sevColor(task.alert.severity)}11`,
          padding: '3px 8px',
          flexShrink: 0,
        }}>
          {task.alert.severity}
        </div>
      )}

      {/* Timestamp (column view only) */}
      {!flat && task.created_at && (
        <div style={{ fontSize: '0.5rem', color: '#333', letterSpacing: 1 }}>
          {new Date(task.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {/* Advance button */}
      <button
        onClick={() => onAdvance(task)}
        disabled={task.status === 'RESOLVED' || updating}
        style={{
          background: task.status === 'RESOLVED' ? 'transparent' : `${statusColor(NEXT_STATUS[task.status])}18`,
          border: `1px solid ${task.status === 'RESOLVED' ? 'rgba(255,255,255,0.06)' : statusColor(NEXT_STATUS[task.status])}`,
          color: task.status === 'RESOLVED' ? '#333' : statusColor(NEXT_STATUS[task.status]),
          padding: '0.4rem 0.9rem',
          fontFamily: 'Space Mono,monospace',
          fontSize: '0.5rem',
          letterSpacing: 2,
          cursor: task.status === 'RESOLVED' ? 'default' : 'pointer',
          flexShrink: 0,
          transition: 'all 0.2s',
          opacity: updating ? 0.5 : 1,
          minWidth: flat ? 140 : undefined,
        }}
      >
        {updating ? 'UPDATING...' : ACTION_LABEL[task.status]}
      </button>
    </motion.div>
  );
}
