import { useEffect } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const ZONE_CENTERS: Record<string, [number, number]> = {
  "Z01": [18.9067, 72.8147], "Z02": [18.9438, 72.8249], "Z03": [19.0396, 72.8528],
  "Z04": [19.0596, 72.8295], "Z05": [19.1197, 72.8468], "Z06": [19.2294, 72.8567],
  "Z07": [19.0726, 72.8847], "Z08": [19.0867, 72.9081], "Z09": [19.1726, 72.9563],
  "Z10": [19.1197, 72.9070], "Z11": [19.0330, 73.0297], "Z12": [19.2183, 72.9781],
  "Z13": [19.1435, 72.9415], "Z14": [19.1580, 72.9340], "Z15": [19.0596, 72.8295],
  "Z16": [19.0822, 72.8396], "Z17": [19.0990, 72.8490], "Z18": [19.1197, 72.8466],
  "Z19": [19.1390, 72.8490], "Z20": [19.1663, 72.8489], "Z21": [19.1871, 72.8488],
  "Z22": [19.2067, 72.8561], "Z23": [19.2307, 72.8567], "Z24": [19.2523, 72.8563],
};

const ZONE_NAMES: Record<string, string> = {
  "Z01":"Colaba","Z02":"Azad Maidan","Z03":"Dharavi","Z04":"Bandra",
  "Z05":"Andheri","Z06":"Borivali","Z07":"Kurla","Z08":"Ghatkopar",
  "Z09":"Mulund","Z10":"Powai","Z11":"Navi Mumbai","Z12":"Thane",
  "Z13":"Vikhroli","Z14":"Bhandup","Z15":"Dadar","Z16":"Worli",
  "Z17":"Goregaon","Z18":"Malad","Z19":"Kandivali","Z20":"Dahisar",
  "Z21":"Mira Road","Z22":"Vasai","Z23":"Nalasopara","Z24":"Virar",
};

const ZONE_INTEL: Record<string, { facts: string[]; countermeasures: string[] }> = {
  "Z01": { facts: ["Financial district, high footfall", "Major tourist zone"], countermeasures: ["Increase CCTV patrols", "Deploy plain-clothes units near Gateway"] },
  "Z02": { facts: ["Dense commercial market area", "High pickpocket risk zones"], countermeasures: ["Market surveillance boost", "Night patrol frequency increase"] },
  "Z03": { facts: ["Largest urban slum globally", "High population density"], countermeasures: ["Community liaison officers", "Rapid response unit stationed"] },
  "Z04": { facts: ["High-value residential & nightlife", "Coastal vulnerability"], countermeasures: ["Bar & club checks post-midnight", "Coastal watch patrols"] },
  "Z05": { facts: ["Airport proximity, transit hub", "High vehicle theft rate"], countermeasures: ["Airport perimeter patrols", "Auto-theft task force active"] },
  "Z06": { facts: ["Northern suburb, border zone", "Forest fringe areas"], countermeasures: ["Border checkpoints reinforced", "Forest patrol at night"] },
  "Z07": { facts: ["Eastern corridor, industrial belt", "High goods theft incidents"], countermeasures: ["Warehouse surveillance", "Industrial night patrols"] },
  "Z08": { facts: ["IT corridor, mixed residential", "Moderate crime profile"], countermeasures: ["Tech park perimeter checks", "Resident watch program"] },
  "Z09": { facts: ["Residential suburb, lower density", "Occasional chain snatching"], countermeasures: ["Senior citizen patrol zones", "Beat constable reinforcement"] },
  "Z10": { facts: ["IIT Bombay campus nearby", "Lake region, isolated pockets"], countermeasures: ["Campus liaison active", "Lake perimeter monitoring"] },
  "Z11": { facts: ["Satellite city, rapid growth", "Cross-jurisdiction coordination needed"], countermeasures: ["Joint NMMC-Mumbai patrol", "Highway watch active"] },
  "Z12": { facts: ["Thane border zone", "Major rail corridor"], countermeasures: ["Railway GRP coordination", "Station surveillance boost"] },
  "Z13": { facts: ["Industrial zone, Godrej belt", "Low residential density"], countermeasures: ["Factory perimeter patrol", "CCTV at entry points"] },
  "Z14": { facts: ["Residential, low incident rate", "River boundary zone"], countermeasures: ["River patrol unit", "Resident alert network"] },
  "Z15": { facts: ["Cultural hub, Shivaji Park", "Mass gathering events frequent"], countermeasures: ["Event crowd management", "Pre-event security audit"] },
  "Z16": { facts: ["Sea-facing, high real estate", "Isolated late-night stretches"], countermeasures: ["Sea face patrol post-midnight", "CCTV gap analysis"] },
  "Z17": { facts: ["Film City zone, controlled access", "Gated communities dominant"], countermeasures: ["Entry point checks", "Society liaison officers"] },
  "Z18": { facts: ["Mall-heavy commercial strip", "High vehicle & retail theft"], countermeasures: ["Mall security coordination", "Parking lot surveillance"] },
  "Z19": { facts: ["Dense suburban residential", "Metro construction zone"], countermeasures: ["Construction site monitoring", "Night patrol increase"] },
  "Z20": { facts: ["Northernmost suburb", "Border with Mira Road"], countermeasures: ["Cross-border patrol coordination", "Check naka reinforcement"] },
  "Z21": { facts: ["Rapid urbanisation zone", "Mira-Bhayandar boundary"], countermeasures: ["Joint patrol with MBMC", "Traffic crime monitoring"] },
  "Z22": { facts: ["Coastal zone, fishing villages", "Vasai fort heritage area"], countermeasures: ["Coastal surveillance", "Heritage site security"] },
  "Z23": { facts: ["High migrant population", "Dense low-income housing"], countermeasures: ["Community policing boost", "Migrant registration drive"] },
  "Z24": { facts: ["Northernmost tip, Virar", "Rail terminus crime hotspot"], countermeasures: ["Railway terminus patrol", "Last-mile surveillance"] },
};

function riskColor(z: number): string {
  if (z > 2) return '#FF3B30';
  if (z > 1) return '#D2FF00';
  return '#00FFFF';
}

function riskLabel(z: number): string {
  if (z > 2) return 'CRITICAL';
  if (z > 1) return 'HIGH';
  return 'NOMINAL';
}

function makePolygon(zoneId: string, coords: [number, number], zScore: number): GeoJSON.Feature {
  const sides = 4;
  const radius = 0.004;
  const [lat, lon] = coords;
  const ring = Array.from({ length: sides + 1 }, (_, i) => {
    const angle = (i / sides) * 2 * Math.PI;
    return [lon + radius * Math.cos(angle), lat + radius * Math.sin(angle)];
  });
  return {
    type: 'Feature',
    properties: { zoneId, zScore, zoneName: ZONE_NAMES[zoneId] || zoneId },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

function buildTooltip(zoneId: string, zScore: number): string {
  const color = riskColor(zScore);
  const name = ZONE_NAMES[zoneId] || zoneId;
  const intel = ZONE_INTEL[zoneId] || { facts: ['No data'], countermeasures: ['Standard patrol'] };
  return `
    <div style="background:#0a0a0a;border:1px solid ${color};padding:10px 14px;font-family:'Space Mono',monospace;font-size:11px;color:#fff;min-width:200px;max-width:240px">
      <div style="color:${color};font-weight:900;letter-spacing:2px;margin-bottom:4px;font-size:12px">${zoneId} — ${name}</div>
      <div style="color:${color};font-weight:700;letter-spacing:1px;margin-bottom:6px;font-size:11px">${riskLabel(zScore)}</div>
      <div style="color:${color};opacity:0.8;margin-bottom:2px">Z-SCORE: ${zScore.toFixed(2)}</div>
      <hr style="border-color:#333;margin:6px 0"/>
      <div style="color:#aaa;letter-spacing:1px;margin-bottom:4px;font-size:10px">▸ INTEL</div>
      ${intel.facts.map(f => `<div style="opacity:0.75;margin-bottom:2px">• ${f}</div>`).join('')}
      <hr style="border-color:#333;margin:6px 0"/>
      <div style="color:#aaa;letter-spacing:1px;margin-bottom:4px;font-size:10px">▸ COUNTERMEASURES</div>
      ${intel.countermeasures.map(c => `<div style="color:${color};opacity:0.85;margin-bottom:2px">⟶ ${c}</div>`).join('')}
    </div>
  `;
}

export default function SonicPulseMap({ velocity }: { velocity: any[] }) {
  useEffect(() => {
    (window as any).triggerSonicPulse = (lat: number, lng: number, severity: string) => {
      console.log('[SonicPulse] pulse triggered', lat, lng, severity);
    };
  }, []);

  const zones = velocity || [];

  const geoData: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: zones
      .filter(z => ZONE_CENTERS[z.zone_id])
      .map(z => makePolygon(z.zone_id, ZONE_CENTERS[z.zone_id], z.z_score || 0)),
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {!velocity && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: '#00FFFF', fontSize: '0.8rem', zIndex: 10 }}>
          WAITING_FOR_SPATIAL_SYNC...
        </div>
      )}

      <MapContainer
        center={[19.076, 72.877]}
        zoom={11}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />

        <GeoJSON
          key={JSON.stringify(geoData)}
          data={geoData}
          style={(feature) => {
            const z = feature?.properties?.zScore || 0;
            const color = riskColor(z);
            return { fillColor: color, fillOpacity: 0.25, color: color, weight: 1.5, opacity: 0.8 };
          }}
          onEachFeature={(feature, layer) => {
            const { zoneId, zScore } = feature.properties;
            layer.bindTooltip(buildTooltip(zoneId, zScore), { className: 'sentinel-tooltip', sticky: true });
            layer.on('mouseover', () => (layer as any).setStyle({ fillOpacity: 0.55, weight: 2.5 }));
            layer.on('mouseout', () => (layer as any).setStyle({ fillOpacity: 0.25, weight: 1.5 }));
          }}
        />

        {zones
          .filter(z => ZONE_CENTERS[z.zone_id])
          .map(z => {
            const [lat, lon] = ZONE_CENTERS[z.zone_id];
            const color = riskColor(z.z_score || 0);
            return (
              <CircleMarker
                key={z.zone_id}
                center={[lat, lon]}
                radius={4}
                pathOptions={{ color: '#fff', fillColor: color, fillOpacity: 1, weight: 1 }}
                eventHandlers={{
                  mouseover: (e) => e.target.setRadius(7),
                  mouseout: (e) => e.target.setRadius(4),
                }}
              >
                <Tooltip direction="top" sticky className="sentinel-tooltip">
                  <div dangerouslySetInnerHTML={{ __html: buildTooltip(z.zone_id, z.z_score || 0) }} />
                </Tooltip>
              </CircleMarker>
            );
          })}
      </MapContainer>

      <div style={{ position: 'absolute', top: '1rem', right: '1rem', textAlign: 'right', pointerEvents: 'none', zIndex: 999 }}>
        <div style={{ color: '#00FFFF', fontSize: '0.75rem', fontFamily: 'Space Mono, monospace', letterSpacing: '2px' }}>SPATIAL_SYNC_OPERATIONAL</div>
        <div style={{ color: '#666', fontSize: '0.6rem', marginTop: '0.4rem', fontFamily: 'Space Mono, monospace' }}>LAT_LON Grid: 0.1° // SCALE: 1:50000</div>
      </div>
    </div>
  );
}