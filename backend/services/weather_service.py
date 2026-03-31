"""
weather_service.py
──────────────────
Async OpenWeatherMap wrapper for Mumbai weather.
Returns a WeatherFeatures dataclass with crime-risk multipliers
that feed directly into the Hawkes engine background rate.

Requires env var: OWM_API_KEY
If not set, returns Mumbai seasonal averages as a safe fallback.
Cached for 10 minutes to stay within the free tier (1000 calls/day).
"""

import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

_MUMBAI_LAT = 19.0760
_MUMBAI_LON = 72.8777
_OWM_URL    = "https://api.openweathermap.org/data/2.5/weather"
_TIMEOUT    = 8.0
_CACHE_TTL  = 600  # 10 minutes

_cache: "WeatherFeatures | None" = None
_cache_ts: float = 0.0


@dataclass
class WeatherFeatures:
    temp_c:        float = 29.0
    feels_like_c:  float = 32.0
    humidity_pct:  float = 75.0
    wind_kmh:      float = 14.0
    rain_1h_mm:    float = 0.0
    visibility_km: float = 8.0
    condition:     str   = "Haze"
    icon:          str   = "50d"
    is_fallback:   bool  = True
    fetched_at:    str   = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    # ── Crime-risk multipliers ────────────────────────────────────────────────
    # Each modifies the Hawkes background rate μ for the current cycle.
    # Derived from peer-reviewed weather-crime correlation literature.

    @property
    def heat_multiplier(self) -> float:
        """
        Aggression crimes (assault, robbery) rise with heat.
        Baseline 28°C. +15% at feels_like >= 38°C.
        """
        if self.feels_like_c >= 38:
            return 1.15
        if self.feels_like_c >= 33:
            return 1.07
        if self.feels_like_c <= 20:
            return 0.92
        return 1.0

    @property
    def rain_multiplier(self) -> float:
        """
        Heavy rain suppresses street crime (deserted roads).
        Light rain has negligible effect.
        """
        if self.rain_1h_mm >= 15:
            return 0.72
        if self.rain_1h_mm >= 5:
            return 0.88
        if self.rain_1h_mm >= 0.5:
            return 0.95
        return 1.0

    @property
    def visibility_multiplier(self) -> float:
        """
        Low visibility favours theft and chain snatching.
        """
        if self.visibility_km < 1.0:
            return 1.18
        if self.visibility_km < 3.0:
            return 1.10
        if self.visibility_km < 5.0:
            return 1.04
        return 1.0

    @property
    def composite_risk_multiplier(self) -> float:
        """Combined multiplier, capped at [0.60, 1.40]."""
        raw = self.heat_multiplier * self.rain_multiplier * self.visibility_multiplier
        return round(max(0.60, min(1.40, raw)), 4)

    def to_dict(self) -> dict:
        return {
            "temp_c":              self.temp_c,
            "feels_like_c":        self.feels_like_c,
            "humidity_pct":        self.humidity_pct,
            "wind_kmh":            self.wind_kmh,
            "rain_1h_mm":          self.rain_1h_mm,
            "visibility_km":       self.visibility_km,
            "condition":           self.condition,
            "icon":                self.icon,
            "is_fallback":         self.is_fallback,
            "fetched_at":          self.fetched_at,
            "heat_multiplier":     self.heat_multiplier,
            "rain_multiplier":     self.rain_multiplier,
            "visibility_multiplier": self.visibility_multiplier,
            "composite_risk_mult": self.composite_risk_multiplier,
        }


async def get_weather_features() -> WeatherFeatures:
    """
    Returns current Mumbai WeatherFeatures.
    Cached 10 min. Graceful fallback if key missing or request fails.
    """
    global _cache, _cache_ts

    if _cache is not None and (time.monotonic() - _cache_ts) < _CACHE_TTL:
        return _cache

    api_key = os.getenv("OWM_API_KEY", "").strip()
    if not api_key:
        logger.warning("OWM_API_KEY not set — using seasonal fallback.")
        return _fallback()

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_OWM_URL, params={
                "lat": _MUMBAI_LAT, "lon": _MUMBAI_LON,
                "appid": api_key, "units": "metric",
            })
            resp.raise_for_status()
            d = resp.json()

        rain_1h = d.get("rain", {}).get("1h", 0.0)

        features = WeatherFeatures(
            temp_c        = round(d["main"]["temp"], 1),
            feels_like_c  = round(d["main"]["feels_like"], 1),
            humidity_pct  = d["main"]["humidity"],
            wind_kmh      = round(d["wind"]["speed"] * 3.6, 1),
            rain_1h_mm    = round(rain_1h, 2),
            visibility_km = round(d.get("visibility", 10000) / 1000, 1),
            condition     = d["weather"][0]["main"],
            icon          = d["weather"][0]["icon"],
            is_fallback   = False,
        )
        _cache    = features
        _cache_ts = time.monotonic()
        logger.info(
            "Weather: %.1f°C feels %.1f°C rain %.1fmm vis %.1fkm → mult %.3f",
            features.temp_c, features.feels_like_c,
            features.rain_1h_mm, features.visibility_km,
            features.composite_risk_multiplier,
        )
        return features

    except Exception as exc:
        logger.warning("Weather fetch failed (%s) — fallback.", exc)
        return _fallback()


def _fallback() -> WeatherFeatures:
    """Mumbai annual average — safe neutral baseline."""
    return WeatherFeatures(
        temp_c=29.0, feels_like_c=32.0, humidity_pct=75.0,
        wind_kmh=14.0, rain_1h_mm=0.0, visibility_km=8.0,
        condition="Haze", icon="50d", is_fallback=True,
    )

