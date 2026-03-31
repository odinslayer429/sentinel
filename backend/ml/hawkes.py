"""
Hawkes Process for crime hotspot forecasting.
Intensity model: λ(t) = μ + Σ α·exp(-β·(t-tᵢ))

Parameters α and β are fitted per-zone via Maximum Likelihood Estimation
using scipy.optimize.  Heuristic fallbacks are used when data is sparse.
"""
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
from scipy.optimize import minimize

# ── Fallback heuristic parameters (used when MLE cannot converge) ────────────
_DEFAULT_ALPHA   = 0.3
_DEFAULT_BETA    = 1.5
_DEFAULT_MU_BASE = 0.05


# ── MLE fitting ───────────────────────────────────────────────────────────────
def _neg_log_likelihood(
    params: np.ndarray,
    event_times: np.ndarray,
    T: float
) -> float:
    """
    Negative log-likelihood of a univariate Hawkes process.
    params = [mu, alpha, beta]
    event_times: sorted array of event times (in hours)
    T: observation window end (hours)
    """
    mu, alpha, beta = params
    if mu <= 0 or alpha <= 0 or beta <= 0 or alpha >= beta:
        return 1e10  # enforce stability condition alpha < beta

    n = len(event_times)
    if n == 0:
        return 1e10

    # Log-likelihood: Σ log λ(tᵢ) - ∫₀ᵀ λ(t)dt
    # Recursive computation of Hawkes intensity
    log_sum   = 0.0
    R         = 0.0   # recursive excitation accumulator
    for i in range(n):
        if i > 0:
            R = np.exp(-beta * (event_times[i] - event_times[i-1])) * (1 + R)
        intensity = mu + alpha * R
        if intensity <= 0:
            return 1e10
        log_sum += np.log(intensity)

    # Integral term:  mu*T + alpha/beta * Σ (1 - exp(-beta*(T-tᵢ)))
    integral = mu * T + (alpha / beta) * np.sum(1.0 - np.exp(-beta * (T - event_times)))

    return -(log_sum - integral)


def fit_hawkes_params(
    event_timestamps: List[datetime],
    min_events: int = 10
) -> Tuple[float, float, float]:
    """
    Fit Hawkes (mu, alpha, beta) via MLE on a list of datetime events.
    Returns (mu, alpha, beta).  Falls back to heuristic defaults when
    there are fewer than min_events or when optimisation fails.
    """
    if len(event_timestamps) < min_events:
        return _DEFAULT_MU_BASE, _DEFAULT_ALPHA, _DEFAULT_BETA

    times = np.array(sorted([t.timestamp() / 3600.0 for t in event_timestamps]))
    times -= times[0]          # normalise to start at 0
    T     = times[-1] + 1e-6   # observation window end

    # Multiple restarts to avoid local minima
    best_nll    = np.inf
    best_params = (_DEFAULT_MU_BASE, _DEFAULT_ALPHA, _DEFAULT_BETA)

    for mu0, a0, b0 in [
        (0.05, 0.3, 1.5),
        (0.10, 0.5, 2.0),
        (0.02, 0.2, 1.0),
        (0.20, 0.8, 3.0),
    ]:
        res = minimize(
            _neg_log_likelihood,
            x0     = [mu0, a0, b0],
            args   = (times, T),
            method = "L-BFGS-B",
            bounds = [(1e-6, None), (1e-6, None), (1e-6, None)],
            options= {"maxiter": 500, "ftol": 1e-9},
        )
        if res.success and res.fun < best_nll:
            best_nll    = res.fun
            best_params = tuple(float(x) for x in res.x)

    mu, alpha, beta = best_params
    # Enforce stationarity:  alpha < beta
    if alpha >= beta:
        alpha = beta * 0.9
    return mu, alpha, beta


# ── Core intensity computation ────────────────────────────────────────────────
def compute_hawkes_intensity(
    event_times_hours: List[float],
    query_time_hour:   float,
    mu:    float = _DEFAULT_MU_BASE,
    alpha: float = _DEFAULT_ALPHA,
    beta:  float = _DEFAULT_BETA,
) -> float:
    """
    Compute Hawkes intensity at query_time given past events.
    event_times_hours: list of past event times (in hours from epoch)
    query_time_hour  : time to evaluate intensity at
    """
    excitation = sum(
        alpha * np.exp(-beta * (query_time_hour - t))
        for t in event_times_hours
        if t < query_time_hour
    )
    return mu + excitation


# ── Zone-level forecast ───────────────────────────────────────────────────────
def forecast_zone_intensity(
    event_timestamps: List[datetime],
    forecast_hours:   int = 6,
) -> List[Dict]:
    """
    Given a list of past crime timestamps for a zone, forecast intensity
    for the next `forecast_hours` hours.

    Fits MLE parameters when >= 10 events are available; uses heuristic
    defaults otherwise.

    Returns list of {hour_offset, timestamp, intensity, intensity_scaled, risk_level}.
    """
    mu, alpha, beta = fit_hawkes_params(event_timestamps)

    now    = datetime.utcnow()
    cutoff = now - timedelta(hours=48)
    recent = [t for t in event_timestamps if t >= cutoff]

    base_hour    = cutoff.timestamp() / 3600
    event_hours  = [(t.timestamp() / 3600) - base_hour for t in recent]
    current_hour = (now.timestamp() / 3600) - base_hour

    forecasts = []
    for h in range(forecast_hours + 1):
        future_hour = current_hour + h
        intensity   = compute_hawkes_intensity(event_hours, future_hour, mu, alpha, beta)

        scaled = min(intensity / 2.0, 1.0)
        if   scaled > 0.70: risk = "CRITICAL"
        elif scaled > 0.45: risk = "HIGH"
        elif scaled > 0.20: risk = "MEDIUM"
        else:               risk = "LOW"

        forecasts.append({
            "hour_offset":       h,
            "timestamp":         (now + timedelta(hours=h)).isoformat(),
            "intensity":         round(intensity, 4),
            "intensity_scaled":  round(scaled,    3),
            "risk_level":        risk,
            "fitted_params":     {"mu": round(mu, 5), "alpha": round(alpha, 5), "beta": round(beta, 5)},
        })

    return forecasts


# ── Anomaly detection (unchanged) ────────────────────────────────────────────
def anomaly_zscore(zone_counts: Dict[str, List[int]]) -> Dict[str, Dict]:
    """
    Z-score anomaly detection.
    zone_counts: {zone_id: [daily_crime_counts_last_30_days]}
    Returns zones with z-score > 2 as anomalies.
    """
    results = {}
    for zone_id, counts in zone_counts.items():
        if len(counts) < 3:
            continue
        arr    = np.array(counts, dtype=float)
        mean   = arr.mean()
        std    = arr.std()
        if std == 0:
            continue
        latest = arr[-1]
        z      = (latest - mean) / std
        results[zone_id] = {
            "z_score":    round(float(z), 2),
            "mean":       round(float(mean), 1),
            "std":        round(float(std),  1),
            "latest":     int(latest),
            "is_anomaly": bool(z > 2.0),
            "severity":   "CRITICAL" if z > 3 else "HIGH" if z > 2 else "NORMAL",
        }
    return results
