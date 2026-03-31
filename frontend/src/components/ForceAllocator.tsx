import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";

type ScenarioKey = "NORMAL" | "ELEVATED" | "CRITICAL";

interface Zone {
  zone_id: string;
  zone_name?: string;
  risk_level?: string;
  crime_count?: number;
  avg_severity?: number;
}

interface Allocation {
  zone_id: string;
  zone_name: string;
  risk_level: string;
  officers: number;
  vehicles: number;
  drones: number;
  priority: number;
  patrol_type: string;
  eta: string;
}

interface AIBriefing {
  zone_id: string;
  briefing: string;
  recommended_action: string;
}

// ── Fallback mock zones shown when API returns nothing ────────────────────────
const MOCK_ZONES: Zone[] = [
  { zone_id: "Z01", zone_name: "Colaba",        risk_level: "HIGH" },
  { zone_id: "Z02", zone_name: "Bandra",         risk_level: "HIGH" },
  { zone_id: "Z03", zone_name: "Andheri",        risk_level: "MEDIUM" },
  { zone_id: "Z04", zone_name: "Dadar",          risk_level: "MEDIUM" },
  { zone_id: "Z05", zone_name: "Kurla",          risk_level: "LOW" },
  { zone_id: "Z06", zone_name: "Thane",          risk_level: "LOW" },
  { zone_id: "Z07", zone_name: "Dharavi",        risk_level: "HIGH" },
  { zone_id: "Z08", zone_name: "Chembur",        risk_level: "MEDIUM" },
];

const RISK_MULTIPLIERS: Record<ScenarioKey, Record<string, number>> = {
  NORMAL:   { HIGH: 1.0, MEDIUM: 0.7, LOW: 0.4 },
  ELEVATED: { HIGH: 1.4, MEDIUM: 1.0, LOW: 0.6 },
  CRITICAL: { HIGH: 2.0, MEDIUM: 1.4, LOW: 0.8 },
};

const PATROL_TYPES: Record<string, string> = {
  HIGH:   "RAPID RESPONSE",
  MEDIUM: "STANDARD PATROL",
  LOW:    "ROUTINE SWEEP",
};

function computeAllocations(zones: Zone[], scenario: ScenarioKey): Allocation[] {
  const mults = RISK_MULTIPLIERS[scenario];
  return zones.map((z) => {
    const risk = (z.risk_level || "LOW").toUpperCase();
    const m    = mults[risk] ?? 0.4;
    return {
      zone_id:    z.zone_id,
      zone_name:  z.zone_name || z.zone_id,
      risk_level: risk,
      officers:   Math.max(1, Math.round(4 * m)),
      vehicles:   Math.max(1, Math.round(2 * m)),
      drones:     risk === "HIGH" ? Math.round(2 * m) : 0,
      priority:   risk === "HIGH" ? 1 : risk === "MEDIUM" ? 2 : 3,
      patrol_type: PATROL_TYPES[risk] || "ROUTINE SWEEP",
      eta:        risk === "HIGH" ? "ETA 8 MIN" : risk === "MEDIUM" ? "ETA 15 MIN" : "ETA 25 MIN",
    };
  }).sort((a, b) => a.priority - b.priority);
}

// ── Risk colour palette — proper hex, NOT CSS vars ─────────────────────────
const RISK_COLOR: Record<string, string> = {
  HIGH:   "#FF3B30",
  MEDIUM: "#FF9500",
  LOW:    "#34C759",
};

const RISK_BG: Record<string, string> = {
  HIGH:   "rgba(255,59,48,0.12)",
  MEDIUM: "rgba(255,149,0,0.12)",
  LOW:    "rgba(52,199,89,0.12)",
};

const ForceAllocator: React.FC = () => {
  const [zones,        setZones]        = useState<Zone[]>([]);
  const [allocations,  setAllocations]  = useState<Allocation[]>([]);
  const [scenario,     setScenario]     = useState<ScenarioKey>("NORMAL");
  const [briefings,    setBriefings]    = useState<AIBriefing[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [briefLoading, setBriefLoading] = useState(false);
  const [activeZone,   setActiveZone]   = useState<string | null>(null);
  const [deployed,     setDeployed]     = useState(false);
  const [deploying,    setDeploying]    = useState(false);

  const token   = sessionStorage.getItem("sentinel_token");
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // ── Load zones (with mock fallback) ────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const applyZones = (data: Zone[]) => {
      const z = data.length > 0 ? data : MOCK_ZONES;
      setZones(z);
      setAllocations(computeAllocations(z, scenario));
    };

    axios.get("/api/heatmap/zones-summary", { headers })
      .then(res => applyZones(Array.isArray(res.data) ? res.data : []))
      .catch(() =>
        axios.get("/api/zones", { headers })
          .then(r => applyZones(Array.isArray(r.data) ? r.data : r.data?.zones || []))
          .catch(() => applyZones([]))
      )
      .finally(() => setLoading(false));
  }, []);

  // ── Recompute on scenario change ───────────────────────────────────────────
  useEffect(() => {
    if (zones.length > 0) setAllocations(computeAllocations(zones, scenario));
  }, [scenario, zones]);

  // ── Fetch AI briefings ─────────────────────────────────────────────────────
  const fetchAIBriefings = useCallback(async (allocs: Allocation[], sc: ScenarioKey) => {
    if (allocs.length === 0) return;
    setBriefLoading(true);
    try {
      const res = await axios.post("/api/tactical/briefing", {
        scenario: sc,
        allocations: allocs.slice(0, 5).map(a => ({
          zone_id:    a.zone_id,
          risk_level: a.risk_level,
          officers:   a.officers,
        })),
      }, { headers });
      const raw = res.data?.briefings ?? res.data;
      setBriefings(Array.isArray(raw) ? raw : []);
    } catch { /* non-critical */ }
    finally { setBriefLoading(false); }
  }, []);

  const handleScenarioChange = (sc: ScenarioKey) => {
    setScenario(sc);
    setDeployed(false);
    const allocs = computeAllocations(zones, sc);
    fetchAIBriefings(allocs, sc);
  };

  const handleDeploy = async () => {
    setDeploying(true);
    await new Promise(r => setTimeout(r, 1500));
    setDeployed(true);
    setDeploying(false);
  };

  const getBriefing = (zoneId: string) =>
    Array.isArray(briefings) ? briefings.find(b => b.zone_id === zoneId) : undefined;

  const totalOfficers = allocations.reduce((s, a) => s + a.officers, 0);
  const totalVehicles = allocations.reduce((s, a) => s + a.vehicles, 0);
  const totalDrones   = allocations.reduce((s, a) => s + a.drones,   0);

  if (loading) return (
    <div style={{ padding: "3rem", textAlign: "center", color: "#444", fontSize: "0.6rem", letterSpacing: 3 }}>
      LOADING ALLOCATION DATA...
    </div>
  );

  return (
    <div className="force-allocator">

      {/* ── Header ── */}
      <div className="fa-header">
        <h3 className="fa-title">⚡ Force Allocator</h3>
        <div className="fa-scenario-tabs">
          {(["NORMAL", "ELEVATED", "CRITICAL"] as ScenarioKey[]).map(sc => (
            <button
              key={sc}
              className={`fa-tab ${scenario === sc ? "active" : ""} tab-${sc.toLowerCase()}`}
              onClick={() => handleScenarioChange(sc)}
            >
              {sc}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary bar ── */}
      <div className="fa-summary">
        <span>Zones: <strong>{allocations.length}</strong></span>
        <span>Officers: <strong>{totalOfficers}</strong></span>
        <span>Vehicles: <strong>{totalVehicles}</strong></span>
        <span>Drones: <strong>{totalDrones}</strong></span>
        <span style={{ marginLeft: "auto", color: "#555", fontSize: "0.55rem", letterSpacing: 2 }}>
          {scenario} SCENARIO ACTIVE
        </span>
        {briefLoading && <span className="brief-loading">🔄 Getting AI briefings...</span>}
      </div>

      {/* ── Zone cards ── */}
      <div className="fa-grid">
        {allocations.map(alloc => {
          const briefing = getBriefing(alloc.zone_id);
          const isActive = activeZone === alloc.zone_id;
          return (
            <div
              key={alloc.zone_id}
              className={`fa-card ${isActive ? "expanded" : ""}`}
              style={{
                borderTop: `2px solid ${RISK_COLOR[alloc.risk_level]}`,
                cursor: "pointer",
              }}
              onClick={() => setActiveZone(isActive ? null : alloc.zone_id)}
            >
              <div className="fa-card-top">
                <div className="fa-zone-name">{alloc.zone_name}</div>
                <span
                  className="fa-risk-badge"
                  style={{
                    background: RISK_COLOR[alloc.risk_level],
                    color: "#000",
                    fontWeight: 900,
                    padding: "3px 10px",
                    fontSize: "0.5rem",
                    letterSpacing: 2,
                  }}
                >
                  {alloc.risk_level}
                </span>
              </div>

              {/* Patrol type */}
              <div className="fa-patrol-type">{alloc.patrol_type}</div>

              {/* Resources */}
              <div className="fa-resources">
                <div className="fa-resource" style={{ color: "#D2FF00" }}>
                  <span className="fa-res-icon">👮</span>
                  <span style={{ fontWeight: 900, fontSize: "1.1rem" }}>{alloc.officers}</span>
                </div>
                <div className="fa-resource" style={{ color: "#00FFFF" }}>
                  <span className="fa-res-icon">🚔</span>
                  <span style={{ fontWeight: 900, fontSize: "1.1rem" }}>{alloc.vehicles}</span>
                </div>
                {alloc.drones > 0 && (
                  <div className="fa-resource" style={{ color: "#FF9500" }}>
                    <span className="fa-res-icon">🚁</span>
                    <span style={{ fontWeight: 900, fontSize: "1.1rem" }}>{alloc.drones}</span>
                  </div>
                )}
              </div>

              {/* ETA */}
              <div className="fa-eta" style={{ color: RISK_COLOR[alloc.risk_level], fontWeight: 700 }}>
                {alloc.eta}
              </div>

              {/* AI briefing (expanded) */}
              {isActive && (
                <div className="fa-briefing">
                  {briefLoading ? (
                    <div className="brief-loading">🔄 Fetching tactical briefing...</div>
                  ) : briefing ? (
                    <>
                      <p className="fa-briefing-text">{briefing.briefing}</p>
                      {briefing.recommended_action && (
                        <p className="fa-action">
                          <strong>ACTION:</strong> {briefing.recommended_action}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="fa-briefing-text" style={{ color: "#444" }}>
                      No AI briefing available for this zone. Click "COMMIT DEPLOYMENT" to generate.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Deploy button ── */}
      {allocations.length > 0 && (
        <button
          className="fa-deploy-btn"
          onClick={handleDeploy}
          disabled={deploying || deployed}
          style={{
            opacity: deployed ? 0.5 : 1,
            background: deployed
              ? "rgba(52,199,89,0.1)"
              : deploying
              ? "rgba(210,255,0,0.06)"
              : "rgba(210,255,0,0.08)",
            borderColor: deployed ? "#34C759" : "rgba(210,255,0,0.4)",
            color: deployed ? "#34C759" : "#D2FF00",
          }}
        >
          {deploying
            ? "DISPATCHING UNITS..."
            : deployed
            ? "✓ DEPLOYMENT COMMITTED"
            : `COMMIT DEPLOYMENT → CREATE ALERTS • DISPATCH ${totalOfficers} UNITS`}
        </button>
      )}

    </div>
  );
};

export default ForceAllocator;
