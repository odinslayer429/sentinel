import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import './MahaCrimeCopilot.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sections?: any[];
  steps?: string[];
  laws?: any[];
  judgments?: string[];
  defence?: string[];
  counter?: string[];
  caveats?: string;
  mode?: 'fir' | 'chat';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Render a plain string, stripping any JSON artefacts the LLM may leak */
const CleanText: React.FC<{ text: string }> = ({ text }) => {
  // If the whole content looks like raw JSON, just show a fallback message
  const trimmed = (text || '').trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      // Extract the most useful text field from the JSON
      const display =
        parsed.answer ||
        parsed.summary ||
        parsed.executive_summary ||
        parsed.profile_summary ||
        Object.values(parsed).find((v) => typeof v === 'string') ||
        'Response received — see details below.';
      return <span style={{ whiteSpace: 'pre-wrap' }}>{display as string}</span>;
    } catch {
      // Malformed JSON — strip braces and show raw
    }
  }
  return <span style={{ whiteSpace: 'pre-wrap' }}>{trimmed}</span>;
};

/** Badge coloured by urgency */
const UrgencyBadge: React.FC<{ urgency?: string }> = ({ urgency }) => {
  if (!urgency) return null;
  const colors: Record<string, string> = {
    CRITICAL: '#ff2d55',
    HIGH:     '#ff9f0a',
    MEDIUM:   '#ffd60a',
    LOW:      '#30d158',
  };
  const bg = colors[urgency.toUpperCase()] || '#888';
  return (
    <span style={{
      display: 'inline-block', marginLeft: 8, padding: '1px 8px',
      borderRadius: 4, fontSize: 10, fontWeight: 700,
      background: bg, color: '#000', letterSpacing: 1,
    }}>
      {urgency}
    </span>
  );
};

/** Collapsible section card */
const Section: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({
  title, children, defaultOpen = false
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 10, border: '1px solid #222', borderRadius: 6, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', padding: '6px 10px',
          background: '#111', color: '#00ff9d', fontFamily: 'monospace',
          fontSize: 11, fontWeight: 700, letterSpacing: 1,
          border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between'
        }}
      >
        <span>{title}</span>
        <span style={{ opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '8px 10px', background: '#0a0a0a', color: '#ccc', fontSize: 12 }}>
          {children}
        </div>
      )}
    </div>
  );
};

/** Render applicable_laws table */
const LawsTable: React.FC<{ laws: any[] }> = ({ laws }) => (
  <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr style={{ background: '#1a1a1a', color: '#00ff9d' }}>
          {['Section', 'Title', 'Cognizable', 'Bailable', 'Punishment'].map(h => (
            <th key={h} style={{ padding: '4px 6px', textAlign: 'left', border: '1px solid #222' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {laws.map((l, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? '#0d0d0d' : '#111' }}>
            <td style={{ padding: '3px 6px', border: '1px solid #1a1a1a', color: '#fff', whiteSpace: 'nowrap' }}>
              {l.section || l.bns_equivalent || '—'}
            </td>
            <td style={{ padding: '3px 6px', border: '1px solid #1a1a1a' }}>{l.title || l.offense || '—'}</td>
            <td style={{ padding: '3px 6px', border: '1px solid #1a1a1a', textAlign: 'center', color: l.cognizable ? '#30d158' : '#ff453a' }}>
              {l.cognizable === true ? 'Yes' : l.cognizable === false ? 'No' : '—'}
            </td>
            <td style={{ padding: '3px 6px', border: '1px solid #1a1a1a', textAlign: 'center', color: l.bailable ? '#30d158' : '#ff453a' }}>
              {l.bailable === true ? 'Yes' : l.bailable === false ? 'No' : '—'}
            </td>
            <td style={{ padding: '3px 6px', border: '1px solid #1a1a1a' }}>{l.punishment || l.max_punishment || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Render a string array as a numbered list */
const BulletList: React.FC<{ items: string[] }> = ({ items }) => (
  <ol style={{ paddingLeft: 16, margin: 0 }}>
    {items.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
  </ol>
);

// ─── Types ───────────────────────────────────────────────────────────────────

interface FIRResult {
  ipc_sections?: any[];
  similar_cases?: any[];
  entities?: { locations?: string[]; persons?: string[]; orgs?: string[]; crime_types?: string[] };
  pattern_warning?: string;
  answer?: string;
  urgency?: string;
}

// ─── Main Component ──────────────────────────────────────────────────────────

const MahaCrimeCopilot: React.FC = () => {
  const [isOpen, setIsOpen]     = useState(false);
  const [mode, setMode]         = useState<'fir' | 'chat'>('chat');
  const [input, setInput]       = useState('');
  const [firText, setFirText]   = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'MahaCrimeOS Copilot online. Select mode:\n\n• LEGAL Q&A → Ask any investigative or legal question.\n• FIR ANALYSIS → Paste an FIR for IPC/BNS analysis.',
      mode: 'chat'
    }
  ]);
  const [loading, setLoading]     = useState(false);
  const [firResult, setFirResult] = useState<FIRResult | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const token   = localStorage.getItem('sentinel_token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, firResult, isOpen]);

  // ── Voice brief ────────────────────────────────────────────────────────────
  const speakBrief = async (topic: string) => {
    if (!topic.trim()) return;
    try {
      const res = await axios.post(
        '/api/copilot/voice-brief',
        { topic, format: 'briefing' },
        { headers, responseType: 'text' }
      );
      const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      const utt  = new SpeechSynthesisUtterance(text);
      utt.rate = 0.88;
      utt.lang = 'en-IN';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utt);
    } catch (e) {
      console.error('[Voice brief error]', e);
    }
  };

  // ── Legal Q&A ──────────────────────────────────────────────────────────────
  const sendChat = async () => {
    if (!input.trim()) return;
    const q = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: q, mode: 'chat' }]);
    setInput('');
    setLoading(true);
    try {
      const res = await axios.post(
        '/api/copilot/query-laws',
        { query: q },
        { headers, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
      const d = res.data;
      setMessages(prev => [...prev, {
        role:      'assistant',
        content:   d.answer || 'No response from AI engine.',
        laws:      d.applicable_laws,
        judgments: d.landmark_judgments,
        steps:     d.investigation_steps,
        defence:   d.defence_arguments,
        counter:   d.prosecution_counter,
        caveats:   d.important_caveats,
        mode:      'chat'
      }]);
    } catch (e: any) {
      const msg = e.response?.data?.detail || e.message || 'Unknown network error.';
      setMessages(prev => [...prev, { role: 'assistant', content: `CRIT_INTEL_OFFLINE: ${msg}`, mode: 'chat' }]);
    } finally {
      setLoading(false);
    }
  };

  // ── FIR Analysis ───────────────────────────────────────────────────────────
  const analyzeFIR = async () => {
    if (!firText.trim()) return;
    setLoading(true);
    setFirResult(null);
    try {
      const res = await axios.post('/api/copilot/summarize', { text: firText }, { headers });
      const d   = res.data;
      setMessages(prev => [...prev, {
        role:     'assistant',
        content:  d.summary || d.answer || 'Analysis complete.',
        sections: d.suggested_sections,
        steps:    d.workflow,
        mode:     'chat'
      }]);
      setMode('chat');
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role:    'assistant',
        content: `Analysis failed: ${e?.response?.data?.detail || e.message}`,
        mode:    'chat'
      }]);
      setMode('chat');
    } finally {
      setLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="copilot-wrapper">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="copilot-panel"
          >
            {/* Header */}
            <div className="copilot-header">
              <span>MAHACRIME AI COPILOT</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  title="Voice brief last answer"
                  onClick={() => {
                    const last = [...messages].reverse().find(m => m.role === 'assistant');
                    if (last) speakBrief(last.content);
                  }}
                  style={{
                    background: 'none', border: '1px solid #00ff9d', color: '#00ff9d',
                    borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 12
                  }}
                >
                  🔊
                </button>
                <button
                  onClick={() => window.speechSynthesis.cancel()}
                  style={{
                    background: 'none', border: '1px solid #ff453a', color: '#ff453a',
                    borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 12
                  }}
                >
                  ⏹
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 16 }}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="copilot-content-scroll">
              {/* Mode tabs */}
              <div className="opt-shift-grid" style={{ marginBottom: '1.5rem' }}>
                <button className={`shift-btn ${mode === 'chat' ? 'active' : ''}`} onClick={() => setMode('chat')}>
                  LEGAL Q&A
                </button>
                <button className={`shift-btn ${mode === 'fir' ? 'active' : ''}`} onClick={() => setMode('fir')}>
                  FIR ANALYSIS
                </button>
              </div>

              {/* ── CHAT MODE ─────────────────────────────────────────── */}
              {mode === 'chat' ? (
                <>
                  <div className="messages-container">
                    {messages.map((m, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div className={`message-bubble ${m.role}`}>

                          {/* Main answer text — never raw JSON */}
                          <CleanText text={m.content} />

                          {/* Applicable laws table */}
                          {m.laws && m.laws.length > 0 && (
                            <Section title="⚖ APPLICABLE LAWS" defaultOpen>
                              <LawsTable laws={m.laws} />
                            </Section>
                          )}

                          {/* Suggested sections from FIR analysis */}
                          {m.sections && m.sections.length > 0 && (
                            <Section title="📋 SECTION RECOMMENDATIONS" defaultOpen>
                              <LawsTable laws={m.sections} />
                            </Section>
                          )}

                          {/* Investigation steps */}
                          {m.steps && m.steps.length > 0 && (
                            <Section title="🔍 INVESTIGATION STEPS" defaultOpen>
                              <BulletList items={m.steps} />
                            </Section>
                          )}

                          {/* Landmark judgments */}
                          {m.judgments && m.judgments.length > 0 && (
                            <Section title="🏛 LANDMARK JUDGMENTS">
                              <BulletList items={m.judgments} />
                            </Section>
                          )}

                          {/* Defence arguments */}
                          {m.defence && m.defence.length > 0 && (
                            <Section title="🛡 ANTICIPATED DEFENCE">
                              <BulletList items={m.defence} />
                            </Section>
                          )}

                          {/* Prosecution counter */}
                          {m.counter && m.counter.length > 0 && (
                            <Section title="⚔ PROSECUTION COUNTER">
                              <BulletList items={m.counter} />
                            </Section>
                          )}

                          {/* Caveats */}
                          {m.caveats && (
                            <div style={{
                              marginTop: 8, padding: '6px 8px', borderRadius: 4,
                              background: '#1a0a00', border: '1px solid #ff9f0a',
                              color: '#ff9f0a', fontSize: 11
                            }}>
                              ⚠ {m.caveats}
                            </div>
                          )}

                          {/* Voice button per message */}
                          {m.role === 'assistant' && (
                            <button
                              onClick={() => speakBrief(m.content)}
                              style={{
                                marginTop: 8, background: 'none',
                                border: '1px solid #333', color: '#888',
                                borderRadius: 4, padding: '2px 8px',
                                cursor: 'pointer', fontSize: 10
                              }}
                            >
                              🔊 READ ALOUD
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {loading && <div className="loading-intel">▶ QUERYING LEGAL RAG...</div>}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="input-group">
                    <input
                      className="opt-input"
                      placeholder="ASK LEGAL QUESTION..."
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                    />
                    <button className="opt-run-btn" onClick={sendChat} disabled={loading}>
                      SEND
                    </button>
                  </div>
                </>
              ) : (

              /* ── FIR MODE ──────────────────────────────────────────── */
                <>
                  <div className="stat-label" style={{ marginBottom: '0.5rem', color: '#000' }}>PASTE FIR TEXT</div>
                  <textarea
                    className="fir-textarea"
                    placeholder="Paste the raw FIR text here..."
                    value={firText}
                    onChange={e => setFirText(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
                    <button
                      className="opt-run-btn"
                      style={{ flex: 1 }}
                      onClick={analyzeFIR}
                      disabled={loading || !firText.trim()}
                    >
                      {loading ? '⟳ ANALYZING...' : '▶ RUN ANALYTICS'}
                    </button>
                    <button
                      style={{
                        background: '#0a1f10', border: '1px solid #00ff9d',
                        color: '#00ff9d', borderRadius: 4, padding: '0 12px',
                        cursor: 'pointer', fontSize: 12
                      }}
                      onClick={() => speakBrief(firText)}
                      disabled={!firText.trim()}
                      title="Voice brief this FIR"
                    >
                      🔊
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        className="copilot-fab"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? '✕' : 'AI'}
      </motion.button>
    </div>
  );
};

export default MahaCrimeCopilot;
