import React, { useEffect, useState, useRef } from 'react';
import {
  ShieldAlert,
  MapPin,
  Activity,
  Camera,
  ShieldCheck,
  Search,
  AlertCircle,
  Bot
} from 'lucide-react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, Circle, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import ForceGraph2D from 'react-force-graph-2d';
import './CommandCenter.css';
import MahaCrimeCopilot from '../components/MahaCrimeCopilot';
import '../components/MahaCrimeCopilot.css';

const CommandCenter = () => {
  const [lang] = React.useState(localStorage.getItem('marvel_lang') || 'en');

  const translations: any = {
    en: {
      title: "MARVEL COMMAND & CONTROL",
      uplink: "SECURE SATELLITE UPLINK ACTIVE",
      predictive: "PREDICTIVE HOTSPOT MAPPING",
      analysis: "CCTNS DEEP LINK ANALYSIS",
      analytics: "SECTOR RISK ANALYTICS (24H)",
      vahan: "VAHAN / ANPR LIVE FEED",
      firs: "CCTNS ACTIVE FIRs"
    },
    mr: {
      title: "मार्बल कमांड आणि नियंत्रण",
      uplink: "सुरक्षित उपग्रह अपलिंक सक्रिय",
      predictive: "अंदाजित हॉटस्पॉट मॅपिंग",
      analysis: "CCTNS सखोल लिंक विश्लेषण",
      analytics: "क्षेत्र जोखीम विश्लेषण (२४ तास)",
      vahan: "वाहन / ANPR थेट फीड",
      firs: "CCTNS सक्रिय एफआयआर"
    }
  };

  const t = translations[lang] || translations.en;
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [tasks, setTasks] = useState<any[]>([]);
  const [cctvHits, setCctvHits] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const graphRef = useRef<any>(null);

  useEffect(() => {
    const fetchBoardData = async () => {
      const token = localStorage.getItem('sentinel_token');
      if (!token) {
        navigate('/login');
        return;
      }

      try {
        // Fetch Criminal Network graph
        const graphRes = await axios.get('/api/investigation/network', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (graphRes.data && graphRes.data.nodes) {
          setGraphData(graphRes.data);
        }

        // Fetch CCTNS Logs (Active FIR Data)
        const taskRes = await axios.get('/api/ops/tasks', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setTasks(taskRes.data || []);

        // Fetch Hawkes ML Prediction Zones
        const zoneRes = await axios.get('/api/zones', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setZones(zoneRes.data || []);

        // Connect WebSocket for Live VAHAN/ANPR
        const ws = new WebSocket('ws://localhost:8000/ws');
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'cctv_hit') {
            setCctvHits(prev => [data, ...prev].slice(0, 50));
          }
        };
      } catch (err: any) {
        if (err.response && err.response.status === 401) {
          localStorage.removeItem('sentinel_token');
          navigate('/login');
        } else {
          console.error("Data fetch failed", err);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchBoardData();
    const interval = setInterval(fetchBoardData, 15000);
    return () => clearInterval(interval);
  }, []);

  const getNodeColor = (node: any) => {
    if (node.class_type === 'suspect') return '#ef4444'; // red-500
    if (node.class_type === 'vehicle') return '#22c55e'; // green-500
    return '#3b82f6'; // blue-500
  };

  if (loading) return <div style={{padding: '3rem', textAlign: 'center'}}>INITIALIZING MARVEL UPLINK...</div>;

  return (
    <div className="command-dashboard">
      <div className="command-header">
        <h2>
          <ShieldAlert color="var(--color-primary)" size={28} />
          {t.title}
        </h2>
        <div className="badge badge-success badge-pulse">{t.uplink}</div>
      </div>

      <div className="command-grid">

        {/* LEFT COLUMN: Map & Graph */}
        <div className="left-stack">
          {/* Smart Bandobast Map */}
          <div className="enterprise-card">
            <div className="enterprise-header">
              <MapPin color="var(--color-primary)" size={20} />
              <h3>{t.predictive}</h3>
            </div>

            <div className="map-wrapper">
              <MapContainer center={[19.0760, 72.8777]} zoom={11} style={{ height: '400px', width: '100%', backgroundColor: '#f0f2f5' }}>
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap'
                />

                {/* 1. HAWKES PREDICTION ZONES */}
                {zones.map((zone, idx) => (
                  <Circle
                    key={`zone-${idx}`}
                    center={[zone.lat, zone.lon]}
                    pathOptions={{ color: 'var(--color-danger)', fillColor: 'var(--color-warning)' }}
                    radius={Math.max(zone.hawkes_intensity * 1000, 500)}
                    stroke={true}
                    weight={1}
                    fillOpacity={Math.min((zone.hawkes_intensity * 0.2) + 0.1, 0.4)}
                  >
                    <Popup className="enterprise-popup">
                      <strong>AI HOTSPOT PREDICTION</strong><br/>
                      ZONE: {zone.zone_name}<br/>
                      SCORE: {zone.risk_score.toFixed(2)} ({zone.trend.toUpperCase()})<br/>
                      DOMINANT: {zone.dominant_crime || 'N/A'}<br/>
                      <hr style={{margin: '0.5rem 0', borderColor: '#eee'}} />
                      <strong>INCIDENTS (24H): {zone.event_count_24h}</strong><br/>
                      <strong>INTENSITY: {zone.hawkes_intensity.toFixed(4)}</strong><br/>
                      <br/>
                      <a href={`/zone/${zone.zone_id}`} target="_blank" style={{color: 'var(--color-primary)', fontWeight: 600}}>Full Vector Analysis</a>
                    </Popup>
                  </Circle>
                ))}

                {/* 2. ACTIVE CCTNS FIRs */}
                {tasks.map((task, idx) => {
                  if (task.lat && task.lon) {
                    return (
                      <CircleMarker
                        key={`task-${idx}`}
                        center={[task.lat, task.lon]}
                        radius={6}
                        color="var(--color-danger)"
                        fillColor="var(--color-danger)"
                        fillOpacity={1}
                        weight={2}
                      >
                        <Popup className="enterprise-popup">
                          <strong>CCTNS ACTIVE RECORD</strong><br/>
                          TITLE: {task.alert_title}<br/>
                          STATUS: {task.status}<br/>
                          ASSIGNED: {task.assigned_to || 'PENDING'}
                        </Popup>
                      </CircleMarker>
                    );
                  }
                  return null;
                })}

                {/* 3. LIVE ANPR OUTSOURCED HITS */}
                {cctvHits.map((hit, idx) => (
                  <CircleMarker
                    key={`cctv-${idx}`}
                    center={[hit.lat, hit.lon]}
                    radius={hit.is_flagged ? 8 : 4}
                    color={hit.is_flagged ? 'var(--color-danger)' : 'var(--color-primary)'}
                    fillColor={hit.is_flagged ? 'var(--color-danger)' : 'var(--bg-secondary)'}
                    fillOpacity={0.9}
                    weight={2}
                  >
                    <Popup className="enterprise-popup">
                      <strong>VAHAN ANPR HIT</strong><br/>
                      PLATE: {hit.plate}<br/>
                      {hit.is_flagged ? <span style={{color: 'red', fontWeight: 'bold'}}>SUSPECT MATCHED</span> : 'CLEARED'}
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          </div>

          {/* Deep Link Execution Graph */}
          <div className="enterprise-card">
            <div className="enterprise-header">
              <Activity color="var(--color-primary)" size={20} />
              <h3>{t.analysis}</h3>
            </div>
            <div className="graph-container" style={{ height: '350px' }}>
              {graphData.nodes?.length > 0 ? (
                <ForceGraph2D
                  ref={graphRef}
                  width={800}
                  height={350}
                  graphData={graphData}
                  nodeLabel="name"
                  nodeColor={getNodeColor}
                  backgroundColor="#ffffff"
                  linkColor={() => '#cbd5e1'}
                  nodeRelSize={6}
                  linkWidth={(link: any) => link.weight ? link.weight * 1.5 : 1}
                  cooldownTicks={100}
                  onEngineStop={() => {
                    if (graphRef.current) {
                      graphRef.current.zoomToFit(400);
                    }
                  }}
                />
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Awaiting CCTNS Link Calibration...
                </div>
              )}
            </div>
            <div className="legend">
              <span><span className="dot red"></span> Suspects</span>
              <span><span className="dot green"></span> Vehicles</span>
              <span><span className="dot blue"></span> Comms</span>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: VAHAN & CCTNS Data Tables */}
        <div className="right-stack">
          {/* Sector Risk Analytics */}
          <div className="enterprise-card">
            <div className="enterprise-header">
              <Activity color="var(--color-primary)" size={20} />
              <h3>{t.analytics}</h3>
            </div>
            <div className="stats-summary-grid">
              {zones.slice(0, 3).map((z, i) => (
                <div key={i} className="stat-mini-card">
                  <span className="stat-label">{z.zone_name}</span>
                  <div className="stat-value" style={{ color: z.risk_score > 0.7 ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                    {z.risk_score.toFixed(1)}
                  </div>
                  <span className="stat-trend">{z.trend.toUpperCase()}</span>
                  <div style={{fontSize: '0.6rem', marginTop: '0.4rem', color: '#64748b'}}>
                    {lang === 'en' ? 'MISSING PERSONS TRACKED:' : 'पत्ता लागलेली बेपत्ता मुले:'} {Math.floor(z.risk_score * 5)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* VAHAN ANPR Table */}
          <div className="enterprise-card vahan-feed">
            <div className="enterprise-header">
              <Camera color="var(--color-primary)" size={20} />
              <h3>{t.vahan}</h3>
            </div>
            <div className="enterprise-table-wrapper" style={{ maxHeight: '300px' }}>
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Plate Reg</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cctvHits.length === 0 ? (
                    <tr><td colSpan={3} style={{textAlign: 'center'}}>Awaiting ANPR Network...</td></tr>
                  ) : (
                    cctvHits.map((hit, i) => (
                      <tr key={i} style={{ backgroundColor: hit.is_flagged ? '#fef2f2' : 'transparent' }}>
                        <td style={{fontSize: '0.75rem'}}>{new Date(hit.timestamp * 1000).toLocaleTimeString()}</td>
                        <td style={{fontWeight: 600, fontFamily: 'monospace'}}>{hit.plate}</td>
                        <td>
                          {hit.is_flagged ?
                            <span className="badge badge-danger">FLAGGED</span> :
                            <span className="badge badge-success">CLEAR</span>
                          }
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* CCTNS FIR Queue below it */}
            <div className="enterprise-header" style={{marginTop: '2rem'}}>
              <ShieldCheck color="var(--color-primary)" size={20} />
              <h3>{t.firs}</h3>
            </div>
            <div className="enterprise-table-wrapper cctns-grid" style={{ maxHeight: '300px' }}>
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>FIR Subject</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.slice(0, 10).map((t) => (
                    <tr key={t.id}>
                      <td style={{fontWeight: 600}}>{t.assigned_to || 'N/A'}</td>
                      <td>{t.alert_title}</td>
                      <td>
                        <span className={`badge badge-${t.status === 'RESOLVED' ? 'success' : (t.status === 'ACKNOWLEDGED' ? 'warning' : 'danger')}`}>
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>

        {/* MAHACRIME-OS COPILOT Integration */}
        <MahaCrimeCopilot />
      </div>
    </div>
  );
};

export default CommandCenter;
