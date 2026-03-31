import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, useMap } from 'react-leaflet';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';
import { useRef } from 'react';

/* ─── Types ─────────────────────────────────────────────────── */
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

/* ─── Helpers ───────────────────────────────────────────────── */
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
  if (trend === 'RISING') return '↑';
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

/* ─── Pulsing ML rings (only on zones with hawkes_intensity > 0) */
function MLPulseRings({ zones }: { zones: Zone[] }) {
  const map = useMap();
  const layersRef = useRef<any[]>([]);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const L = (window as any).L;
    layersRef.current.forEach(l => map.removeLayer(l));
    layersRef.current = [];

    zones.forEach(zone => {
      const intensity = zone.hawkes_intensity ?? 0;
      if (intensity <= 0) return;
      const color = riskColor(zone.risk_score);
      const normalised = Math.min(intensity / 3, 1); // normalise to 0–1

      const ring = L.circleMarker([zone.lat, zone.lon], {
        radius: 14 + normalised * 18,
        color, fillColor: color,
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

/* ─── Legend ────────────────────────────────────────────────── */
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
    </div>
  );
}

/* ─── Main Component ────────────────────────────────────────── */
export default function CrimeMap() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/zones')
      .then(r => {
        const data = Array.isArray(r.data) ? r.data : r.data.zones || [];
        setZones(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#D2FF00', fontFamily: 'Space Mono, monospace', letterSpacing: '4px' }}>
      LOADING SPATIAL INTEL...
    </div>
  );

  const geoData: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: zones.map(makePolygon),
  };

  const hotspotCount = zones.filter(z => z.hawkes_intensity > 0).length;

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>

      {/* ── Status bar ── */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 1000,
        display: 'flex', gap: '8px', alignItems: 'center',
      }}>
        <div style={{ background: '#000', border: '1px solid #D2FF00', padding: '4px 10px', fontFamily: 'Space Mono, monospace', fontSize: '10px', color: '#D2FF00', letterSpacing: '3px' }}>
          ● LIVE // {zones.length} ZONES
        </div>
        {hotspotCount > 0 && (
          <div style={{ background: '#000', border: '1px solid #FF3B30', padding: '4px 10px', fontFamily: 'Space Mono, monospace', fontSize: '10px', color: '#FF3B30', letterSpacing: '3px' }}>
            ⚡ {hotspotCount} ML HOTSPOT{hotspotCount > 1 ? 'S' : ''}
          </div>
        )}
      </div>

      <MapContainer center={[19.1, 72.877]} zoom={11} style={{ height: '100%', width: '100%', background: '#000' }} zoomControl>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />

        {/* ── Choropleth: current risk ── */}
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
                <div>EVENTS 1H: <span style="color:#fff">${z.event_count_1h}</span></div>
                <div>EVENTS 6H: <span style="color:#fff">${z.event_count_6h}</span></div>
                <div>EVENTS 24H: <span style="color:#fff">${z.event_count_24h}</span></div>
                ${hasML ? `
                  <div style="border-top:1px solid #333;margin:6px 0"></div>
                  <div style="color:#FF3B30;font-weight:900;letter-spacing:2px">⚡ ML HOTSPOT DETECTED</div>
                  <div>HAWKES INDEX: <span style="color:#FF3B30">${z.hawkes_intensity?.toFixed(3)}</span></div>
                ` : ''}
              </div>
            `, { className: 'sentinel-tooltip', sticky: true });
          }}
        />

        {/* ── Center dots ── */}
        {zones.map(zone => (
          <CircleMarker key={zone.zone_id} center={[zone.lat, zone.lon]} radius={3}
            pathOptions={{ color: '#fff', fillColor: '#fff', fillOpacity: 0.9, weight: 1 }}
          />
        ))}

        {/* ── ML pulse rings on hawkes hotspots ── */}
        <MLPulseRings zones={zones} />

        {/* ── Legend ── */}
        <Legend />
      </MapContainer>
    </div>
  );
}