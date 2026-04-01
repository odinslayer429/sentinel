import { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, useMap } from 'react-leaflet';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';
import { usePredictions } from '../hooks/usePredictions';
import type { ZonePrediction } from '../hooks/usePredictions';

/* ─── Types ──────────────────────────────────────────────────── */
interface Zone {
  zone_id: string;
  zone_name: string;
  lat: number;
  lon: number;
  risk_score: number;
  hawkes_intensity: number;
  trend: string;
  dominant_crime: string;
  event_count_1h: number;
  event_count_6h: number;
  event_count_24h: number;
  population?: number;
  area_sqkm?: number;
}

/* ─── Helpers ────────────────────────────────────────────────── */
function riskColor(score: number) {
  if (score >= 1.5) return '#c0392b';
  if (score >= 1.0) return '#c87000';
  if (score >= 0.5) return '#b8860b';
  return '#1a7a00';
}
function riskLabel(score: number) {
  if (score >= 1.5) return 'CRITICAL';
  if (score >= 1.0) return 'HIGH';
  if (score >= 0.5) return 'ELEVATED';
  return 'NOMINAL';
}
function trendIcon(trend: string) {
  if (trend === 'RISING')  return '↑';
  if (trend === 'FALLING') return '↓';
  return '→';
}
function makePolygon(zone: Zone): GeoJSON.Feature {
  const sides = 32;
  const r = 0.025 + (zone.area_sqkm || 10) * 0.0003;
  const coords = Array.from({ length: sides + 1 }, (_, i) => {
    const a = (i / sides) * 2 * Math.PI;
    return [zone.lon + r * Math.cos(a), zone.lat + r * Math.sin(a)];
  });
  return {
    type: 'Feature',
    properties: { ...zone },
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}
function mlRiskColor(level: string) {
  if (level === 'HIGH')   return '#c0392b';
  if (level === 'MEDIUM') return '#c87000';
  return '#1a7a00';
}

/* ─── invalidateSize fixer ───────────────────────────────────── */
function MapResizeFixer() {
  const map = useMap();
  useEffect(() => {
    const raf = requestAnimationFrame(() => map.invalidateSize());
    const t1  = setTimeout(() => map.invalidateSize(), 250);
    const t2  = setTimeout(() => map.invalidateSize(), 600);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(map.getContainer());
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      ro?.disconnect();
    };
  }, [map]);
  return null;
}

/* ─── Pulse Rings ────────────────────────────────────────────── */
function MLPulseRings({ zones }: { zones: Zone[] }) {
  const map = useMap();
  const layersRef = useRef<any[]>([]);
  const frameRef  = useRef<number>(0);
  useEffect(() => {
    const L = (window as any).L;
    layersRef.current.forEach(l => map.removeLayer(l));
    layersRef.current = [];
    zones.forEach(zone => {
      const intensity = zone.hawkes_intensity ?? 0;
      if (intensity <= 0) return;
      const color = riskColor(zone.risk_score);
      const norm  = Math.min(intensity / 3, 1);
      const ring  = L.circleMarker([zone.lat, zone.lon], {
        radius: 14 + norm * 18, color, fillColor: color,
        fillOpacity: 0, weight: 2.5, opacity: 0.8,
      }).addTo(map);
      layersRef.current.push(ring);
    });
    const start = performance.now();
    function animate(ts: number) {
      const t = (ts - start) / 1000;
      layersRef.current.forEach((ring, i) => {
        const pulse = 0.15 + 0.65 * Math.abs(Math.sin(t * 1.4 + i * 0.9));
        ring.setStyle({ opacity: pulse });
      });
      frameRef.current = requestAnimationFrame(animate);
    }
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frameRef.current);
      layersRef.current.forEach(l => map.removeLayer(l));
    };
  }, [zones, map]);
  return null;
}

/* ─── Legend ─────────────────────────────────────────────────── */
function Legend() {
  return (
    <div style={{
      position: 'absolute', bottom: 24, left: 12, zIndex: 1000,
      background: 'rgba(255,255,255,0.95)',
      border: '1px solid rgba(0,0,0,0.12)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      padding: '10px 14px',
      fontFamily: 'Space Mono, monospace', fontSize: '10px',
    }}>
      {[
        { color: '#c0392b', label: 'CRITICAL  ≥1.5' },
        { color: '#c87000', label: 'HIGH      ≥1.0' },
        { color: '#b8860b', label: 'ELEVATED  ≥0.5' },
        { color: '#1a7a00', label: 'NOMINAL   <0.5' },
      ].map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <div style={{ width: 10, height: 10, background: color, borderRadius: '50%' }} />
          <span style={{ color: '#555' }}>{label}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #ddd', marginTop: '6px', paddingTop: '6px', color: '#999' }}>
        ◯ PULSING = ML HOTSPOT
      </div>
      <div style={{ color: '#999', marginTop: '4px' }}>CLICK ZONE = ML FORECAST</div>
    </div>
  );
}

/* ─── Prediction Panel ───────────────────────────────────────── */
interface PanelProps {
  zone: Zone;
  pred: ZonePrediction | null;
  loading: boolean;
  onClose: () => void;
}
function PredictionPanel({ zone, pred, loading, onClose }: PanelProps) {
  const color = riskColor(zone.risk_score);
  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: '300px', zIndex: 2000,
      background: 'rgba(255,255,255,0.98)',
      border: `1px solid ${color}`,
      borderRight: 'none',
      fontFamily: 'Space Mono, monospace', fontSize: '11px',
      color: '#222',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
      boxShadow: `-4px 0 24px rgba(0,0,0,0.08)`,
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${color}44`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color, fontWeight: 900, fontSize: '13px', letterSpacing: '2px' }}>
            {zone.zone_id} // {zone.zone_name.toUpperCase()}
          </div>
          <div style={{ color: '#999', marginTop: '4px', fontSize: '10px', letterSpacing: '1px' }}>ML CRIME FORECAST</div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: '1px solid #ddd', color: '#999',
          cursor: 'pointer', padding: '2px 8px',
          fontFamily: 'Space Mono, monospace', fontSize: '12px',
        }}>✕</button>
      </div>

      {/* Zone stats */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
        {[
          { label: 'RISK STATUS', val: riskLabel(zone.risk_score), c: color },
          { label: 'RISK SCORE',  val: zone.risk_score?.toFixed(2), c: color },
          { label: 'TREND',       val: `${trendIcon(zone.trend)} ${zone.trend}`, c: '#1a7a00' },
          { label: 'DOMINANT',    val: zone.dominant_crime, c: '#c87000' },
        ].map((row, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ color: '#999' }}>{row.label}</span>
            <span style={{ color: row.c, fontWeight: 900 }}>{row.val}</span>
          </div>
        ))}
      </div>

      {/* ML Predictions */}
      <div style={{ padding: '12px 16px', flex: 1 }}>
        <div style={{ color: '#1a7a00', letterSpacing: '2px', fontSize: '10px', marginBottom: '12px' }}>⚡ ML PREDICTIONS</div>
        {loading && <div style={{ color: '#ccc', textAlign: 'center', paddingTop: '20px' }}>COMPUTING...</div>}
        {!loading && !pred && <div style={{ color: '#ccc', fontSize: '10px', textAlign: 'center', paddingTop: '20px' }}>NO PREDICTION DATA</div>}
        {!loading && pred && (
          <>
            <div style={{ display: 'inline-block', background: '#f5f5f0', border: '1px solid #ddd',
              padding: '2px 8px', marginBottom: '14px', fontSize: '10px', color: '#888', letterSpacing: '1px' }}>
              {pred.timeband.toUpperCase()} // {pred.hour}:00
            </div>
            {pred.predictions.map((p, i) => {
              const bc = mlRiskColor(p.risk_level);
              const pct = Math.round(p.probability * 100);
              return (
                <div key={i} style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '10px' }}>
                    <span style={{ color: '#111', letterSpacing: '1px' }}>#{i + 1} {p.crime_type}</span>
                    <span style={{ color: bc, fontWeight: 900 }}>{pct}%</span>
                  </div>
                  <div style={{ height: '4px', background: '#eee', borderRadius: '2px' }}>
                    <div style={{ height: '100%', width: `${Math.min(pct * 3.5, 100)}%`,
                      background: bc, borderRadius: '2px', transition: 'width 0.5s ease' }} />
                  </div>
                  <div style={{ color: '#aaa', fontSize: '9px', marginTop: '2px', letterSpacing: '1px' }}>{p.risk_level} RISK</div>
                </div>
              );
            })}
            <div style={{ borderTop: '1px solid #eee', paddingTop: '10px', marginTop: '4px', fontSize: '9px', color: '#aaa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span>MODEL ACCURACY</span><span>{(pred.model_accuracy * 100).toFixed(1)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>TOP-3 ACCURACY</span>
                <span style={{ color: '#1a7a00' }}>{(pred.top3_accuracy * 100).toFixed(1)}%</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── ML Badge ────────────────────────────────────────────────── */
function MLBadge({ zone, topRisk }: { zone: Zone; topRisk: string | null }) {
  if (!topRisk) return null;
  const badgeColor = mlRiskColor(topRisk);
  return (
    <CircleMarker center={[zone.lat, zone.lon]} radius={7}
      pathOptions={{ color: badgeColor, fillColor: badgeColor, fillOpacity: 0.25, weight: 2, opacity: 0.9 }} />
  );
}

/* ─── Main Component ─────────────────────────────────────────── */
export default function CrimeMap() {
  const [zones,        setZones]        = useState<Zone[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [selected,     setSelected]     = useState<Zone | null>(null);
  const [panelPred,    setPanelPred]    = useState<ZonePrediction | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const { predMap, lastUpdated, fetchZone } = usePredictions(60_000);

  useEffect(() => {
    axios.get('/api/zones')
      .then(r => { const d = Array.isArray(r.data) ? r.data : r.data.zones || []; setZones(d); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleZoneClick = useCallback(async (zone: Zone) => {
    setSelected(zone); setPanelPred(null); setPanelLoading(true);
    const now = new Date();
    const pred = await fetchZone(zone.zone_id, now.getHours(), now.getDay(), now.getMonth() + 1);
    setPanelPred(pred); setPanelLoading(false);
  }, [fetchZone]);

  if (loading) return (
    <div style={{ height: '520px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f5f5f0', color: '#1a7a00', fontFamily: 'Space Mono, monospace', letterSpacing: '4px', fontSize: '0.75rem' }}>
      LOADING SPATIAL INTEL...
    </div>
  );

  const geoData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: zones.map(makePolygon) };
  const hotspotCount = zones.filter(z => z.hawkes_intensity > 0).length;

  return (
    <div style={{ height: '520px', width: '100%', position: 'relative', display: 'flex', overflow: 'hidden', maxWidth: '100vw' }}>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>

        {/* Status bar */}
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #1a7a00', padding: '4px 10px',
            fontFamily: 'Space Mono, monospace', fontSize: '10px', color: '#1a7a00', letterSpacing: '3px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            ● LIVE // {zones.length} ZONES
          </div>
          {hotspotCount > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #c0392b', padding: '4px 10px',
              fontFamily: 'Space Mono, monospace', fontSize: '10px', color: '#c0392b', letterSpacing: '3px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              ⚡ {hotspotCount} ML HOTSPOT{hotspotCount > 1 ? 'S' : ''}
            </div>
          )}
          {lastUpdated && (
            <div style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #ddd', padding: '4px 10px',
              fontFamily: 'Space Mono, monospace', fontSize: '9px', color: '#aaa', letterSpacing: '1px' }}>
              ML SYNCED {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>

        <MapContainer center={[19.1, 72.877]} zoom={11}
          style={{ height: '100%', width: '100%', background: '#f5f5f0' }} zoomControl>

          {/* Light tile — no dark inversion needed */}
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />

          {/* Resize fixer */}
          <MapResizeFixer />

          <GeoJSON
            key={`zones-${zones.length}`}
            data={geoData}
            style={(f) => {
              const color = riskColor(f?.properties?.risk_score || 0);
              return { fillColor: color, fillOpacity: 0.22, color, weight: 1.5, opacity: 0.85 };
            }}
            onEachFeature={(feature, layer) => {
              const z = feature.properties as Zone;
              const color = riskColor(z.risk_score);
              const hasML = z.hawkes_intensity > 0;
              layer.bindTooltip(`
                <div style="background:#fff;border:1px solid ${color};padding:10px 14px;font-family:'Space Mono',monospace;font-size:11px;color:#111;min-width:200px;line-height:1.8;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
                  <div style="color:${color};font-weight:900;letter-spacing:2px;margin-bottom:8px;font-size:12px">${z.zone_id} // ${z.zone_name.toUpperCase()}</div>
                  <div>STATUS: <span style="color:${color};font-weight:900">${riskLabel(z.risk_score)}</span></div>
                  <div>RISK SCORE: <span style="color:${color}">${z.risk_score?.toFixed(2)}</span></div>
                  <div>TREND: <span style="color:#1a7a00">${trendIcon(z.trend)} ${z.trend}</span></div>
                  <div>DOMINANT: <span style="color:#c87000">${z.dominant_crime}</span></div>
                  <div style="border-top:1px solid #eee;margin:6px 0"></div>
                  <div>EVENTS 1H: ${z.event_count_1h}</div>
                  <div>EVENTS 6H: ${z.event_count_6h}</div>
                  <div>EVENTS 24H: ${z.event_count_24h}</div>
                  ${hasML ? `<div style="border-top:1px solid #eee;margin:6px 0"></div><div style="color:#c0392b;font-weight:900">⚡ HAWKES: ${z.hawkes_intensity?.toFixed(3)}</div>` : ''}
                  <div style="color:#aaa;font-size:9px;margin-top:6px;letter-spacing:1px">CLICK FOR ML FORECAST →</div>
                </div>
              `, { className: 'sentinel-tooltip', sticky: true });
              layer.on('click', () => handleZoneClick(z));
            }}
          />

          {zones.map(zone => (
            <CircleMarker key={zone.zone_id} center={[zone.lat, zone.lon]} radius={3}
              pathOptions={{ color: '#333', fillColor: '#333', fillOpacity: 0.8, weight: 1 }} />
          ))}
          {zones.map(zone => {
            const p = predMap[zone.zone_id];
            const topRisk = p?.predictions?.[0]?.risk_level ?? null;
            return <MLBadge key={`badge-${zone.zone_id}`} zone={zone} topRisk={topRisk} />;
          })}
          <MLPulseRings zones={zones} />
          <Legend />
        </MapContainer>
      </div>

      {selected && (
        <div style={{ width: '300px', position: 'relative', flexShrink: 0 }}>
          <PredictionPanel zone={selected} pred={panelPred} loading={panelLoading}
            onClose={() => { setSelected(null); setPanelPred(null); }} />
        </div>
      )}
    </div>
  );
}
