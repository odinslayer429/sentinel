"""
sentinel / services / news_ingester.py

Fetches real Mumbai crime news from NewsData.io, persists each article
as a CrimeEvent row, then broadcasts it over WebSocket to all connected
dashboard clients.
"""
import os
import hashlib
import logging
import asyncio
from datetime import datetime, timezone

import requests

log = logging.getLogger("news_ingester")

NEWSDATA_URL = "https://newsdata.io/api/1/latest"

_CRIME_KEYWORDS = [
    ("MURDER",    ["murder", "killed", "dead body", "homicide", "shot dead"]),
    ("RAPE",      ["rape", "sexual assault", "molestation", "gangrape"]),
    ("KIDNAP",    ["kidnap", "abduct", "missing child"]),
    ("ROBBERY",   ["robbery", "robbed", "snatch", "loot", "dacoit"]),
    ("THEFT",     ["theft", "steal", "stolen", "burglary", "pickpocket"]),
    ("FRAUD",     ["fraud", "scam", "cheated", "fake", "forgery"]),
    ("CYBER",     ["cyber", "hacked", "phishing", "online fraud", "deepfake"]),
    ("ASSAULT",   ["assault", "attack", "beaten", "stabbed", "knife"]),
    ("RIOT",      ["riot", "mob", "clash", "violence", "protest turned violent"]),
    ("ARSON",     ["arson", "fire", "set ablaze", "burnt"]),
    ("DRUG",      ["drug", "narcotics", "cocaine", "ganja", "mdma", "heroin"]),
    ("EXTORTION", ["extortion", "ransom", "threat", "extort"]),
]

_ZONE_MAP = [
    ("Z01", ["fort", "csmt", "churchgate", "colaba", "cuffe parade"],     18.9067, 72.8147),
    ("Z02", ["byculla", "mazgaon", "dongri", "bhendi bazar"],              18.9438, 72.8249),
    ("Z03", ["dadar", "parel", "worli", "lower parel"],                    19.0396, 72.8528),
    ("Z04", ["bandra", "khar", "santacruz"],                               19.0596, 72.8295),
    ("Z05", ["andheri", "jogeshwari", "versova"],                          19.1197, 72.8468),
    ("Z06", ["borivali", "kandivali", "malad"],                            19.2294, 72.8567),
    ("Z07", ["kurla", "ghatkopar", "vidyavihar"],                          19.0726, 72.8847),
    ("Z08", ["mulund", "nahur", "bhandup"],                                19.0867, 72.9081),
    ("Z09", ["thane", "kalwa", "mumbra"],                                  19.1726, 72.9563),
    ("Z10", ["powai", "vikhroli", "kanjurmarg"],                           19.1197, 72.9070),
    ("Z11", ["navi mumbai", "vashi", "nerul", "panvel", "kharghar"],       19.0330, 73.0297),
    ("Z12", ["mira road", "bhayander", "vasai", "virar"],                  19.2183, 72.9781),
]


def _detect_crime_type(text: str) -> str:
    t = text.lower()
    for label, kws in _CRIME_KEYWORDS:
        if any(k in t for k in kws):
            return label
    return "NEWS"


def _detect_zone(text: str):
    t = text.lower()
    for zone_id, kws, lat, lon in _ZONE_MAP:
        if any(k in t for k in kws):
            return zone_id, kws[0].title(), lat, lon
    return "Z03", "Mumbai", 19.0760, 72.8777


def _severity(crime_type: str) -> str:
    if crime_type in ("MURDER", "RAPE", "KIDNAP"):             return "CRITICAL"
    if crime_type in ("ROBBERY", "ASSAULT", "RIOT", "ARSON"): return "HIGH"
    if crime_type in ("THEFT", "FRAUD", "CYBER", "DRUG"):     return "MEDIUM"
    return "LOW"


def ingest_crime_news() -> int:
    """
    Fetch → parse → persist → broadcast.
    Returns number of new rows inserted.
    """
    from db.database import SessionLocal
    from db.models import CrimeEvent
    # Import manager lazily to avoid circular import at module load
    from services.ws_manager import manager

    api_key = os.getenv("NEWSDATA_API_KEY")
    if not api_key:
        log.warning("[NEWS] NEWSDATA_API_KEY not set — skipping ingest")
        return 0

    params = {
        "apikey":   api_key,
        "country":  "in",
        "category": "crime",
        "language": "en",
        "q":        "Mumbai crime",
    }

    try:
        r = requests.get(NEWSDATA_URL, params=params, timeout=15)
        r.raise_for_status()
        articles = r.json().get("results", [])
        log.info(f"[NEWS] Fetched {len(articles)} articles from NewsData.io")
    except Exception as exc:
        log.error(f"[NEWS] Fetch failed: {exc}")
        return 0

    db = SessionLocal()
    inserted = 0
    new_events = []

    try:
        for a in articles:
            title = (a.get("title") or "").strip()[:500]
            desc  = (a.get("description") or a.get("content") or "").strip()[:1000]
            url   = (a.get("link") or "").strip()[:500]
            src   = (a.get("source_id") or "").strip()[:100]

            if not title or not url:
                continue

            story_hash = hashlib.md5(url.encode()).hexdigest()[:20]
            if db.query(CrimeEvent).filter(CrimeEvent.story_hash == story_hash).first():
                continue

            pub_raw = a.get("pubDate") or ""
            try:
                published_at = datetime.fromisoformat(pub_raw.replace("Z", "+00:00"))
            except Exception:
                published_at = datetime.now(timezone.utc)

            combo      = f"{title} {desc}"
            crime_type = _detect_crime_type(combo)
            zone_id, zone_name, lat, lon = _detect_zone(combo)
            severity   = _severity(crime_type)

            event = CrimeEvent(
                title        = title,
                description  = desc,
                source       = src,
                url          = url,
                published_at = published_at,
                ingested_at  = datetime.now(timezone.utc),
                story_hash   = story_hash,
                language     = "en",
                locations    = zone_name,
                persons      = "",
                orgs         = "",
                crime_types  = crime_type,
                zone_id      = zone_id,
                zone         = zone_name,
                zone_lat     = lat,
                zone_lon     = lon,
                severity     = severity,
                is_processed = False,
            )
            db.add(event)
            new_events.append({
                "type":        "NEW_EVENT",
                "title":       title,
                "description": desc[:200],
                "url":         url,
                "source":      src,
                "crime_types": crime_type,
                "zone_id":     zone_id,
                "zone":        zone_name,
                "severity":    severity,
                "published_at": published_at.isoformat(),
            })
            inserted += 1

        db.commit()
        log.info(f"[NEWS] Inserted {inserted} new real articles into DB")
    except Exception as exc:
        db.rollback()
        log.error(f"[NEWS] DB write failed: {exc}")
        return 0
    finally:
        db.close()

    # ── Broadcast each new event over WebSocket ──────────────────────────
    if new_events:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                for payload in new_events:
                    asyncio.run_coroutine_threadsafe(manager.broadcast(payload), loop)
            log.info(f"[WS] Broadcasted {len(new_events)} new events to dashboard")
        except Exception as exc:
            log.warning(f"[WS] Broadcast failed (non-fatal): {exc}")

    return inserted


# Legacy shim — keeps /api/news/feed working
def fetch_crime_news():
    ingest_crime_news()
    api_key = os.getenv("NEWSDATA_API_KEY")
    if not api_key:
        return []
    try:
        r = requests.get(NEWSDATA_URL, params={
            "apikey": api_key, "country": "in",
            "category": "crime", "language": "en", "q": "Mumbai crime",
        }, timeout=15)
        return r.json().get("results", [])
    except Exception:
        return []
