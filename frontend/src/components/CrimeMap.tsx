import { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, useMap } from 'react-leaflet';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';
import { usePredictions, ZonePrediction } from '../hooks/usePredictions';

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
  if (score >= 1.5) return '#FF3B30';
  if (score >= 1.0) return '#FF9500';
  if (score >= 0.5) return '#FFD60A';
  return '#D2FF00';
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
  if (level === 'HIGH')   return '#FF3B30';
  if (level === 'MEDIUM') return '#FF9500';
  return '#D2FF00';
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
      background: 'rgba(0,0,0,0.85)', border: '1px solid #333',
      padding: '10px 14px', fontFamily: 'Space Mono, monospace', fontSize: '10px',
    }}>
      {[
        { color: '#FF3B30', label: 'CRITICAL  ≥1.5' },
        { color: '#FF9500', label: 'HIGH      ≥1.0' },
        { color: '#FFD60A', label: 'ELEVATED  ≥0.5' },
        { color: '#D2FF00', label: 'NOMINAL   <0.5' },
      ].map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <div style={{ width: 10, height: 10, background: color, borderRadius: '50%' }} />
          <span style={{ color: '#aaa' }}>{label}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #333', marginTop: '6px', paddingTop: '6px', color: '#555' }}>
        ◯ PULSING = ML HOTSPOT
      </div>
      <div style={{ color: '#555', marginTop: '4px' }}>CLICK ZONE = ML PREDICTIONS</div>
    </div>
  );
}

/* ─── Prediction Side Panel ──────────────────────────────────── */
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
      background: 'rgba(0,4,0,0.97)',
      border: `1px solid ${color}`,
      borderRight: 'none',
      fontFamily: 'Space Mono, monospace',
      fontSize: '11px',
      color: '#ccc',
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
      boxShadow: `-8px 0 40px ${color}22`,
    }}>

      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: `1px solid ${color}44`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div>
          <div style={{ color, fontWeight: 900, fontSize: '13px', letterSpacing: '2px' }}>
            {zone.zone_id} // {zone.zone_name.toUpperCase()}
          </div>
          <div style={{ color: '#555', marginTop: '4px', fontSize: '10px', letterSpacing: '1px' }}>
            ML CRIME FORECAST
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: `1px solid #333`, color: '#666',
          cursor: 'pointer', padding: '2px 8px', fontFamily: 'Space Mono, monospace',
          fontSize: '12px',
        }}>✕</button>
      </div>

      {/* Zone stats */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #111' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ color: '#555' }}>RISK STATUS</span>
          <span style={{ color, fontWeight: 900 }}>{riskLabel(zone.risk_score)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ color: '#555' }}>RISK SCORE</span>
          <span style={{ color }}>{zone.risk_score?.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ color: '#555' }}>TREND</span>
          <span style={{ color: '#D2FF00' }}>{trendIcon(zone.trend)} {zone.trend}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#555' }}>DOMINANT</span>
          <span style={{ color: '#FF9500', fontSize: '10px' }}>{zone.dominant_crime}</span>
        </div>
      </div>

      {/* ML Predictions */}
      <div style={{ padding: '12px 16px', flex: 1 }}>
        <div style={{ color: '#D2FF00', letterSpacing: '2px', fontSize: '10px', marginBottom: '12px' }}>
          ⚡ ML PREDICTIONS
        </div>

        {loading && (
          <div style={{ color: '#333', letterSpacing: '2px', textAlign: 'center', paddingTop: '20px' }}>
            COMPUTING...
          </div>
        )}

        {!loading && !pred && (
          <div style={{ color: '#333', fontSize: '10px', textAlign: 'center', paddingTop: '20px' }}>
            NO PREDICTION DATA
          </div>
        )}

        {!loading && pred && (
          <>
            {/* Timeband badge */}
            <div style={{
              display: 'inline-block',
              background: '#111', border: '1px solid #333',
              padding: '2px 8px', marginBottom: '14px',
              fontSize: '10px', color: '#888', letterSpacing: '1px',
            }}>
              {pred.timeband.toUpperCase()} // {pred.hour}:00
            </div>

            {/* Top-3 bars */}
            {pred.predictions.map((p, i) => {
              const barColor = mlRiskColor(p.risk_level);
              const pct = Math.round(p.probability * 100);
              return (
                <div key={i} style={{ marginBottom: '14px' }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    marginBottom: '4px', fontSize: '10px',
                  }}>
                    <span style={{ color: '#fff', letterSpacing: '1px' }}>
                      #{i + 1} {p.crime_type}
                    </span>
                    <span style={{ color: barColor, fontWeight: 900 }}>
                      {pct}%
                    </span>
                  </div>
                  {/* probability bar */}
                  <div style={{ height: '4px', background: '#111', borderRadius: '2px' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(pct * 3.5, 100)}%`,  // scale up for visibility
                      background: barColor,
                      borderRadius: '2px',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ color: '#444', fontSize: '9px', marginTop: '2px', letterSpacing: '1px' }}>
                    {p.risk_level} RISK
                  </div>
                </div>
              );
            })}

            {/* Model accuracy footer */}
            <div style={{
              borderTop: '1px solid #111', paddingTop: '10px', marginTop: '4px',
              fontSize: '9px', color: '#444',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span>MODEL ACCURACY</span>
                <span>{(pred.model_accuracy * 100).toFixed(1)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>TOP-3 ACCURACY</span>
                <span style={{ color: '#D2FF00' }}>{(pred.top3_accuracy * 100).toFixed(1)}%</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── ML Badge overlay on CircleMarker ──────────────────────── */
// Shows a tiny coloured ring whose colour reflects the top ML risk level
function MLBadge({ zone, topRisk }: { zone: Zone; topRisk: string | null }) {
  if (!topRisk) return null;
  const badgeColor = mlRiskColor(topRisk);
  return (
    <CircleMarker
      center={[zone.lat, zone.lon]}
      radius={7}
      pathOptions={{
        color: badgeColor, fillColor: badgeColor,
        fillOpacity: 0.25, weight: 2, opacity: 0.9,
      }}
    />
  );
}

/* ─── Main Component ─────────────────────────────────────────── */
export default function CrimeMap() {
  const [zones,   setZones]   = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Zone | null>(null);
  const [panelPred, setPanelPred] = useState<ZonePrediction | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);

  const { predMap, lastUpdated, fetchZone } = usePredictions(60_000);

  // Load zones once
  useEffect(() => {
    axios.get('/api/zones')
      .then(r => {
        const data = Array.isArray(r.data) ? r.data : r.data.zones || [];
        setZones(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // When a zone is clicked, fetch its prediction
  const handleZoneClick = useCallback(async (zone: Zone) => {
    setSelected(zone);
    setPanelPred(null);
    setPanelLoading(true);
    const now   = new Date();
    const pred  = await fetchZone(
      zone.zone_id,
      now.getHours(),
      now.getDay(),
      now.getMonth() + 1,
    );
    setPanelPred(pred);
    setPanelLoading(false);
  }, [fetchZone]);

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#000', color: '#D2FF00', fontFamily: 'Space Mono, monospace', letterSpacing: '4px' }}>
      LOADING SPATIAL INTEL...
    </div>
  );

  const geoData: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: zones.map(makePolygon),
  };
  const hotspotCount = zones.filter(z => z.hawkes_intensity > 0).length;

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative', display: 'flex' }}>

      {/* ── Map area ── */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>

        {/* Status bar */}
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ background: '#000', border: '1px solid #D2FF00', padding: '4px 10px',
            fontFamily: 'Space Mono, monospace', fontSize: '10px', color: '#D2FF00', letterSpacing: '3px' }}>
            ● LIVE // {zones.length} ZONES
          </div>
          {hotspotCount > 0 && (
            <div style={{ background: '#000', border: '1px solid #FF3B30', padding: '4px 10px',
              fontFamily: 'Space Mono, monospace', fontSize: '10px', color: '#FF3B30', letterSpacing: '3px' }}>
              ⚡ {hotspotCount} ML HOTSPOT{hotspotCount > 1 ? 'S' : ''}
            </div>
          )}
          {lastUpdated && (
            <div style={{ background: '#000', border: '1px solid #333', padding: '4px 10px',
              fontFamily: 'Space Mono, monospace', fontSize: '9px', color: '#444', letterSpacing: '1px' }}>
              ML SYNCED {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>

        <MapContainer center={[19.1, 72.877]} zoom={11}
          style={{ height: '100%', width: '100%', background: '#000' }} zoomControl>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />

          {/* Choropleth */}
          <GeoJSON
            key={`zones-${zones.length}`}
            data={geoData}
            style={(f) => {
              const color = riskColor(f?.properties?.risk_score || 0);
              return { fillColor: color, fillOpacity: 0.30, color, weight: 1.5, opacity: 0.85 };
            }}
            onEachFeature={(feature, layer) => {
              const z = feature.properties as Zone;
              const color = riskColor(z.risk_score);
              const hasML = z.hawkes_intensity > 0;

              // Tooltip
              layer.bindTooltip(`
                <div style="background:#000;border:1px solid ${color};padding:10px 14px;font-family:'Space Mono',monospace;font-size:11px;color:#fff;min-width:200px;line-height:1.8">
                  <div style="color:${color};font-weight:900;letter-spacing:2px;margin-bottom:8px;font-size:12px">
                    ${z.zone_id} // ${z.zone_name.toUpperCase()}
                  </div>
                  <div>STATUS: <span style="color:${color};font-weight:900">${riskLabel(z.risk_score)}</span></div>
                  <div>RISK SCORE: <span style="color:${color}">${z.risk_score?.toFixed(2)}</span></div>
                  <div>TREND: <span style="color:#D2FF00">${trendIcon(z.trend)} ${z.trend}</span></div>
                  <div>DOMINANT: <span style="color:#FF9500">${z.dominant_crime}</span></div>
                  <div style="border-top:1px solid #222;margin:6px 0"></div>
                  <div>EVENTS 1H: ${z.event_count_1h}</div>
                  <div>EVENTS 6H: ${z.event_count_6h}</div>
                  <div>EVENTS 24H: ${z.event_count_24h}</div>
                  ${hasML ? `<div style="border-top:1px solid #333;margin:6px 0"></div><div style="color:#FF3B30;font-weight:900">⚡ HAWKES: ${z.hawkes_intensity?.toFixed(3)}</div>` : ''}
                  <div style="color:#555;font-size:9px;margin-top:6px;letter-spacing:1px">CLICK FOR ML FORECAST →</div>
                </div>
              `, { className: 'sentinel-tooltip', sticky: true });

              // Click → open panel
              layer.on('click', () => handleZoneClick(z));
            }}
          />

          {/* Center dots */}
          {zones.map(zone => (
            <CircleMarker key={zone.zone_id} center={[zone.lat, zone.lon]} radius={3}
              pathOptions={{ color: '#fff', fillColor: '#fff', fillOpacity: 0.9, weight: 1 }}
            />
          ))}

          {/* ML badge rings (auto-updated from 60s poll) */}
          {zones.map(zone => {
            const p = predMap[zone.zone_id];
            const topRisk = p?.predictions?.[0]?.risk_level ?? null;
            return <MLBadge key={`badge-${zone.zone_id}`} zone={zone} topRisk={topRisk} />;
          })}

          {/* Hawkes pulse rings */}
          <MLPulseRings zones={zones} />

          <Legend />
        </MapContainer>
      </div>

      {/* ── Side panel ── */}
      {selected && (
        <div style={{ width: '300px', position: 'relative', flexShrink: 0 }}>
          <PredictionPanel
            zone={selected}
            pred={panelPred}
            loading={panelLoading}
            onClose={() => { setSelected(null); setPanelPred(null); }}
          />
        </div>
      )}
    </div>
  );
}
