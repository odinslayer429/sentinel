import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: `${BASE}/api`,
  timeout: 15000,
});

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('sentinel_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on 401
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      sessionStorage.removeItem('sentinel_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default {
  // ── Auth ──────────────────────────────────────────
  login: (username: string, password: string) => {
    const fd = new URLSearchParams();
    fd.append('username', username);
    fd.append('password', password);
    fd.append('grant_type', 'password');
    return api.post('/auth/token', fd, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },
  me: () => api.get('/auth/me'),

  // ── Core data ─────────────────────────────────────
  stats:     () => api.get('/stats'),
  alerts:    () => api.get('/alerts'),
  velocity:  () => api.get('/velocity'),
  zones:     () => api.get('/zones'),
  events:    (params?: object) => api.get('/events', { params }),
  eventSummary: () => api.get('/events/summary'),
  recentEvents: (limit = 10) => api.get(`/events/recent?limit=${limit}`),

  // ── Heatmap ───────────────────────────────────────
  heatmap:         (params?: object) => api.get('/heatmap', { params }),
  heatmapZones:    () => api.get('/heatmap/zones-summary'),

  // ── FIR / Cases ───────────────────────────────────
  fir:             () => api.get('/fir/cases'),
  analyzeFirText:  (text: string) => api.post('/fir/analyze', { text }),
  analyzeFirPdf:   (formData: FormData) => api.post('/fir/analyze-pdf', formData),

  // ── Investigation ─────────────────────────────────
  offenders:       () => api.get('/investigation/offenders'),
  criminalNetwork: (params?: object) => api.get('/investigation/network', { params }),

  // ── Ops / Dispatch ────────────────────────────────
  tasks:           () => api.get('/ops/tasks'),
  myTasks:         () => api.get('/ops/my-tasks'),
  updateTaskStatus:(id: number, status: string) =>
    api.post(`/ops/tasks/${id}/status`, { status }),
  dispatch:        () => api.get('/dispatch/tasks'),

  // ── Tactical ──────────────────────────────────────
  tacticalBriefing:(payload: object) => api.post('/tactical/briefing', payload),

  // ── Predictive / ML ───────────────────────────────
  riskScore: (lat: number, lon: number, timestamp: string) =>
    api.post('/predictive/risk-score', { lat, lon, timestamp }),

  // ── OSINT ─────────────────────────────────────────
  osintScan:       (target: string) => api.post('/osint/scan', { target }),

  // ── Copilot ───────────────────────────────────────
  copilotQuery:    (query: object) => api.post('/copilot/query-laws', query),
  copilotSummarize:(text: string)  => api.post('/copilot/summarize', { text }),

  // ── Public ────────────────────────────────────────
  news:            () => api.get('/public/news'),
  telemetry:       () => api.get('/public/telemetry'),
  submitTip: (tip: object) => api.post('/public/tip', tip),

  // ── Face / ANPR / Missing ─────────────────────────
  faceMatch:       (fd: FormData) => api.post('/face/match', fd),
  anprRecognize:   (fd: FormData) => api.post('/anpr/recognize', fd),
  missingSearch:   (fd: FormData) => api.post('/missing/search', fd),

  // ── Gang Networks ─────────────────────────────────
  gangGraph:       () => api.get('/gang-networks/graph'),
  gangAnomalies:   () => api.get('/gang-networks/anomalies'),

  // ── Cyber ─────────────────────────────────────────
  cyberCheckTx:    (tx: object) => api.post('/cyber/check-transaction', tx),

  // ── ML Engine ─────────────────────────────────────────────────
  hawkesForecast:  (topN = 10) => api.get(`/ml/hawkes-forecast?top_n=${topN}`),
  mlAnomalies:     () => api.get('/ml/anomalies'),
  hotspotZones:    (hoursAhead = 3) => api.get(`/ml/hotspot-zones?hours_ahead=${hoursAhead}`),
  mlModelInfo:     () => api.get('/ml/model-info'),
};



export { api };
