import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

interface AIBriefing {
  zone_id: string;
  briefing: string;
  recommended_action: string;
}

// ── Risk helpers ──────────────────────────────────────────────────────────────

const RISK_MULTIPLIERS: Record<ScenarioKey, Record<string, number>> = {
  NORMAL:   { HIGH: 1.0, MEDIUM: 0.7, LOW: 0.4 },
  ELEVATED: { HIGH: 1.4, MEDIUM: 1.0, LOW: 0.6 },
  CRITICAL: { HIGH: 2.0, MEDIUM: 1.4, LOW: 0.8 },
};

function computeAllocations(zones: Zone[], scenario: ScenarioKey): Allocation[] {
  const mults = RISK_MULTIPLIERS[scenario];
  return zones.map((z) => {
    const risk = (z.risk_level || "LOW").toUpperCase();
    const m    = mults[risk] ?? 0.4;
    return {
      zone_id:   z.zone_id,
      zone_name: z.zone_name || z.zone_id,
      risk_level: risk,
      officers:  Math.round(4 * m),
      vehicles:  Math.round(2 * m),
      drones:    risk === "HIGH" ? Math.round(2 * m) : 0,
      priority:  risk === "HIGH" ? 1 : risk === "MEDIUM" ? 2 : 3,
    };
  }).sort((a, b) => a.priority - b.priority);
}

const RISK_COLORS: Record<string, string> = {
  HIGH:   "var(--color-notification, #a13544)",
  MEDIUM: "var(--color-warning, #964219)",
  LOW:    "var(--color-success, #437a22)",
};

// ── Component ─────────────────────────────────────────────────────────────────

const ForceAllocator: React.FC = () => {
  const [zones,       setZones]       = useState<Zone[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [scenario,    setScenario]    = useState<ScenarioKey>("NORMAL");
  const [briefings,   setBriefings]   = useState<AIBriefing[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [briefLoading,setBriefLoading] = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [activeZone,  setActiveZone]  = useState<string | null>(null);

  const token = sessionStorage.getItem("sentinel_token");
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // Load zone heatmap summary
  useEffect(() => {
    setLoading(true);
    axios.get("/api/heatmap/zones-summary", { headers })
      .then(res => {
        const data: Zone[] = Array.isArray(res.data) ? res.data : [];
        setZones(data);
        setAllocations(computeAllocations(data, scenario));
      })
      .catch(() => {
        // Fallback to basic zones endpoint
        axios.get("/api/zones", { headers })
          .then(r => {
            const data: Zone[] = Array.isArray(r.data) ? r.data : r.data?.zones || [];
            setZones(data);
            setAllocations(computeAllocations(data, scenario));
          })
          .catch(() => setError("Failed to load zone data"));
      })
      .finally(() => setLoading(false));
  }, []);

  // Recompute allocations when scenario changes
  useEffect(() => {
    if (zones.length > 0) {
      setAllocations(computeAllocations(zones, scenario));
    }
  }, [scenario, zones]);

  // Fetch AI briefings for current allocations
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
      const raw = res.data?.briefings ?? res.data; setBriefings(Array.isArray(raw) ? raw : []);
    } catch {
      // Briefings are non-critical; silently skip
    } finally {
      setBriefLoading(false);
    }
  }, []);

  // Auto-fetch briefings on load
  useEffect(() => {
    if (allocations.length > 0) {
      fetchAIBriefings(allocations, scenario);
    }
  }, [allocations.length > 0 ? scenario : null]);

  const handleScenarioChange = (sc: ScenarioKey) => {
    setScenario(sc);
    fetchAIBriefings(computeAllocations(zones, sc), sc);
  };

  const getBriefing = (zoneId: string) =>
    Array.isArray(briefings) ? briefings.find(b => b.zone_id === zoneId) : undefined;

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", opacity: 0.6 }}>
        Loading force allocation data...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "1rem", color: "var(--color-notification)" }}>
        {error}
      </div>
    );
  }

  return (
    <div className="force-allocator">
      {/* Header */}
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

      {/* Summary bar */}
      <div className="fa-summary">
        <span>Zones: <strong>{allocations.length}</strong></span>
        <span>Total Officers: <strong>{allocations.reduce((s,a) => s + a.officers, 0)}</strong></span>
        <span>Vehicles: <strong>{allocations.reduce((s,a) => s + a.vehicles, 0)}</strong></span>
        <span>Drones: <strong>{allocations.reduce((s,a) => s + a.drones, 0)}</strong></span>
        {briefLoading && <span className="brief-loading">🔄 Getting AI briefings...</span>}
      </div>

      {/* Zone cards */}
      <div className="fa-grid">
        {allocations.map(alloc => {
          const briefing = getBriefing(alloc.zone_id);
          const isActive = activeZone === alloc.zone_id;
          return (
            <div
              key={alloc.zone_id}
              className={`fa-card ${isActive ? "expanded" : ""}`}
              style={{ borderTop: `3px solid ${RISK_COLORS[alloc.risk_level]}` }}
              onClick={() => setActiveZone(isActive ? null : alloc.zone_id)}
            >
              <div className="fa-card-top">
                <div className="fa-zone-name">{alloc.zone_name}</div>
                <span
                  className="fa-risk-badge"
                  style={{ background: RISK_COLORS[alloc.risk_level] }}
                >
                  {alloc.risk_level}
                </span>
              </div>

              <div className="fa-resources">
                <div className="fa-resource">
                  <span className="fa-res-icon">👮</span>
                  <span>{alloc.officers}</span>
                </div>
                <div className="fa-resource">
                  <span className="fa-res-icon">🚔</span>
                  <span>{alloc.vehicles}</span>
                </div>
                {alloc.drones > 0 && (
                  <div className="fa-resource">
                    <span className="fa-res-icon">🚁</span>
                    <span>{alloc.drones}</span>
                  </div>
                )}
              </div>

              {isActive && briefing && (
                <div className="fa-briefing">
                  <p className="fa-briefing-text">{briefing.briefing}</p>
                  {briefing.recommended_action && (
                    <p className="fa-action">
                      <strong>Action:</strong> {briefing.recommended_action}
                    </p>
                  )}
                </div>
              )}

              {isActive && !briefing && !briefLoading && (
                <div className="fa-briefing">
                  <p className="fa-briefing-text" style={{ opacity: 0.5 }}>
                    No AI briefing available for this zone.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ForceAllocator;
