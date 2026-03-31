import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import './MahaCrimeCopilot.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sections?: any[];
  steps?: string[];
  similar_cases?: any[];
  entities?: any;
  mode?: 'fir' | 'chat';
}

interface FIRResult {
  ipc_sections?: any[];
  similar_cases?: any[];
  entities?: { locations?: string[]; persons?: string[]; orgs?: string[]; crime_types?: string[] };
  pattern_warning?: string;
  answer?: string;
}

const MahaCrimeCopilot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'fir' | 'chat'>('chat');
  const [input, setInput] = useState('');
  const [firText, setFirText] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'MahaCrimeOS AI Copilot online. Select mode:\n\n• FIR ANALYSIS → Paste an FIR for IPC section recommendations.\n\n• LEGAL Q&A → Ask any investigative or legal question.',
      mode: 'chat'
    }
  ]);
  const [loading, setLoading] = useState(false);
  const [firResult, setFirResult] = useState<FIRResult | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const token = localStorage.getItem('sentinel_token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, firResult, isOpen]);

  const sendChat = async () => {
    if (!input.trim()) return;
    const q = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: q, mode: 'chat' }]);
    setInput('');
    setLoading(true);
    try {
      const res = await axios.post('/api/copilot/query-laws', q, { 
        headers: { ...headers, 'Content-Type': 'application/json' } 
      });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.data.answer || 'No response from AI engine.',
        sections: res.data.sources,
        mode: 'chat'
      }]);
    } catch (e: any) {
      const errMsg = e.response?.data?.detail || e.message || 'Unknown network error.';
      setMessages(prev => [...prev, { role: 'assistant', content: `CRIT_INTEL_OFFLINE: ${errMsg}`, mode: 'chat' }]);
    } finally {
      setLoading(false);
    }
  };

  const analyzeFIR = async () => {
    if (!firText.trim()) return;
    setLoading(true);
    setFirResult(null);
    try {
      const res = await axios.post('/api/copilot/summarize', { text: firText }, { headers });
      const data = res.data;
      setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.summary,
          sections: data.suggested_sections,
          steps: data.workflow,
          mode: 'chat'
      }]);
      setMode('chat'); // Switch to chat to show results
    } catch (e: any) {
      setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `Analysis failed: ${e?.response?.data?.detail || e.message}`,
          mode: 'chat'
      }]);
      setMode('chat');
    } finally {
      setLoading(false);
    }
  };

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
            <div className="copilot-header">
                <span>AI SUPREMACY COPILOT</span>
                <button onClick={() => setIsOpen(false)} style={{background:'none', border:'none', color:'#000', cursor:'pointer', fontWeight:900}}>✕</button>
            </div>
            
            <div className="copilot-content-scroll">
                <div className="opt-shift-grid" style={{ marginBottom: '1.5rem' }}>
                    <button className={`shift-btn ${mode === 'chat' ? 'active' : ''}`} onClick={() => setMode('chat')}>
                        LEGAL Q&A
                    </button>
                    <button className={`shift-btn ${mode === 'fir' ? 'active' : ''}`} onClick={() => setMode('fir')}>
                        FIR ANALYSIS
                    </button>
                </div>

                {mode === 'chat' ? (
                <>
                    <div className="messages-container">
                    {messages.map((m, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div className={`message-bubble ${m.role}`}>
                            {m.content}
                            {m.steps && m.steps.length > 0 && (
                            <div className="steps-container">
                                <div className="steps-label">INVESTIGATION STEPS</div>
                                {m.steps.map((s, j) => (
                                <div key={j} className="step-item">
                                    <span className="step-num">{j + 1}.</span>
                                    <span>{s}</span>
                                </div>
                                ))}
                            </div>
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
                <>
                    <div className="stat-label" style={{ marginBottom: '0.5rem', color:'#000' }}>PASTE FIR TEXT</div>
                    <textarea
                    className="fir-textarea"
                    placeholder="Paste the raw FIR text here..."
                    value={firText}
                    onChange={e => setFirText(e.target.value)}
                    />
                    <button className="opt-run-btn" style={{width:'100%', marginTop:'1rem'}} onClick={analyzeFIR} disabled={loading || !firText.trim()}>
                    {loading ? '⟳ ANALYZING...' : '▶ RUN ANALYTICS'}
                    </button>
                    
                    {firResult && (
                        <div className="fir-results">
                            {firResult.pattern_warning && <div className="alert-box">⚠ {firResult.pattern_warning}</div>}
                            <div className="stat-label" style={{marginTop:'1rem', color:'#000'}}>NER EXTRACTIONS</div>
                            <pre style={{fontSize:'10px', whiteSpace:'pre-wrap', background:'#f0f0f0', padding:'10px'}}>
                                {JSON.stringify(firResult.entities, null, 2)}
                            </pre>
                        </div>
                    )}
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
