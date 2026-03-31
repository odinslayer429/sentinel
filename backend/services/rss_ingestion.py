"""
rss_ingestion.py
────────────────
Polls 12 RSS feeds (6 English + 6 Marathi) every 5 minutes.
Pipeline per article:
  1. Pre-filter — is it crime-related? (keyword check, no ML)
  2. Deduplicate — MD5 hash of title against DB
  3. NER + zone mapping (English only)
  4. Severity classification
  5. Persist to CrimeEvent table
  6. Push to all WebSocket clients
  7. Escalate WARNING/CRITICAL to Alert table + push alert message
"""

import asyncio
import hashlib
import json
import logging
from datetime import datetime
from typing import List

import feedparser
import httpx
from sqlalchemy.orm import Session

from db.database import SessionLocal
from db.models import Alert, CrimeEvent, FIRCase, Suspect, FIRSuspectLink
from .ner_pipeline import classify_severity, extract_entities, extract_crime_types
from .fir_nlp import extract_fir_data, generate_tactical_advice
from .ws_manager import manager

logger = logging.getLogger(__name__)

# ── Feed registry ─────────────────────────────────────────────────────────────
RSS_FEEDS: dict = {
    # English
    "toi_mumbai":    "https://timesofindia.indiatimes.com/rssfeeds/7727608.cms",
    "toi_crime":     "https://timesofindia.indiatimes.com/rssfeeds/1221656.cms",
    "ht_mumbai":     "https://www.hindustantimes.com/feeds/rss/cities/mumbai/rssfeed.xml",
    "ie_mumbai":     "https://indianexpress.com/section/cities/mumbai/feed/",
    "ndtv_india":    "https://feeds.feedburner.com/ndtvnews-india-news",
    "toi_navi":      "https://timesofindia.indiatimes.com/rssfeeds/7503091.cms",
    # Marathi
    "tv9_marathi":   "https://tv9marathi.com/feed",
    "abp_majha":     "https://marathi.abplive.com/rss/news",
    "loksatta":      "https://www.loksatta.com/feed/",
    "esakal":        "https://www.esakal.com/feed",
    "tarun_bharat":  "https://tarunbharat.com/feed",
    "prahaar":       "https://prahaar.in/feed",
}

# ── Crime keyword filters ─────────────────────────────────────────────────────
_EN_KW = frozenset([
    "murder", "robbery", "theft", "assault", "arrest", "fir", "crime", "gang",
    "cybercrime", "fraud", "kidnap", "rape", "shooting", "stabbing", "dacoity",
    "extortion", "criminal", "suspect", "accused", "detained", "raid", "seized",
    "loot", "attack", "drug", "narcotic", "police", "molestation", "blast",
    "missing", "body found", "trafficking", "abduct", "chain snatching",
    "encounter", "acid", "ransom", "bust", "apprehended",
])
_MR_KW = frozenset([
    "गुन्हा", "अटक", "खून", "दरोडा", "चोरी", "बलात्कार", "पोलीस", "गँग",
    "फसवणूक", "अपहरण", "गोळीबार", "हल्ला", "ड्रग्ज", "नार्कोटिक",
    "गुन्हेगार", "आरोपी", "छापा", "जप्त", "लूट", "मृतदेह", "दंगा",
])

_HEADERS = {"User-Agent": "SentinelAI/1.0 NewsBot"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _story_hash(title: str) -> str:
    return hashlib.md5(title.lower().strip().encode()).hexdigest()[:16]


def _is_crime_related(title: str, summary: str = "") -> bool:
    text = f"{title} {summary}".lower()
    return any(kw in text for kw in _EN_KW) or any(kw in text for kw in _MR_KW)


def _detect_lang(text: str) -> str:
    try:
        from langdetect import detect
        return detect(text)
    except Exception:
        return "en"


def _parse_date(entry) -> datetime | None:
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        try:
            return datetime(*entry.published_parsed[:6])
        except Exception:
            pass
    return None


# ── Feed fetch ────────────────────────────────────────────────────────────────

async def _fetch_feed(source: str, url: str) -> List:
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=_HEADERS)
            resp.raise_for_status()
            return feedparser.parse(resp.text).entries or []
    except Exception as exc:
        logger.warning("Feed [%s] failed: %s", source, exc)
        return []


# ── Per-entry processing ──────────────────────────────────────────────────────

async def _process_entry(entry, source: str, db: Session) -> None:
    title   = (getattr(entry, "title",   "") or "").strip()
    summary = (getattr(entry, "summary", "") or "").strip()
    url     = (getattr(entry, "link",    "") or "").strip()

    if not title:
        return
    if not _is_crime_related(title, summary):
        return

    story_hash = _story_hash(title)
    if db.query(CrimeEvent).filter_by(story_hash=story_hash).first():
        return  # already seen

    lang         = _detect_lang(title)
    published_at = _parse_date(entry)
    entities: dict = {}

    # Only run heavy NER on English articles
    if lang == "en":
        entities = extract_entities(f"{title}. {summary}")
    else:
        # Marathi: zone via keyword only, crime types via keyword only
        from .zone_graph import get_zone_by_keyword, ZONES
        zid = get_zone_by_keyword(f"{title} {summary}")
        entities = {
            "locations":   [],
            "persons":     [],
            "orgs":        [],
            "crime_types": extract_crime_types(f"{title} {summary}"),
            "zone_id":     zid,
            "zone":        ZONES[zid]["name"]  if zid else None,
            "zone_lat":    ZONES[zid]["lat"]   if zid else None,
            "zone_lon":    ZONES[zid]["lon"]   if zid else None,
        }

    severity = classify_severity(title, summary)

    event = CrimeEvent(
        title        = title,
        description  = summary[:2000] or None,
        source       = source,
        url          = url,
        published_at = published_at,
        story_hash   = story_hash,
        language     = lang,
        locations    = json.dumps(entities.get("locations",   [])),
        persons      = json.dumps(entities.get("persons",     [])),
        orgs         = json.dumps(entities.get("orgs",        [])),
        crime_types  = json.dumps(entities.get("crime_types", [])),
        zone_id      = entities.get("zone_id"),
        zone         = entities.get("zone"),
        zone_lat     = entities.get("zone_lat"),
        zone_lon     = entities.get("zone_lon"),
        severity     = severity,
        is_processed = False,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    logger.info("[%s] %s → %s | %s", source, severity,
                entities.get("zone", "unzoned"), title[:80])

    # Push to WebSocket clients
    await manager.push({
        "type":         "new_event",
        "id":           event.id,
        "title":        title,
        "source":       source,
        "zone_id":      entities.get("zone_id"),
        "zone":         entities.get("zone"),
        "zone_lat":     entities.get("zone_lat"),
        "zone_lon":     entities.get("zone_lon"),
        "severity":     severity,
        "language":     lang,
        "crime_types":  entities.get("crime_types", []),
        "published_at": (published_at or datetime.utcnow()).isoformat(),
        "url":          url,
    })

    # Escalate to Alert table
    if severity in ("WARNING", "CRITICAL"):
        alert = Alert(
            crime_event_id = event.id,
            title          = f"[{severity}] {title[:200]}",
            message        = summary[:500] or title,
            severity       = severity,
            zone_id        = entities.get("zone_id"),
            zone           = entities.get("zone"),
        )
        db.add(alert)
        db.commit()
        await manager.push({
            "type":      "alert",
            "severity":  severity,
            "title":     f"[{severity}] {title[:120]}",
            "zone_id":   entities.get("zone_id"),
            "zone":      entities.get("zone"),
            "timestamp": datetime.utcnow().isoformat(),
        })

    # ── Phase 21: Real-Time FIR Intelligence ────────────────────────────────
    fir_details = extract_fir_data(f"{title} {summary}")
    if fir_details["offence"] != "OTHER" or len(fir_details["person"]) > 0:
        # Create an automated FIR Case
        fir_case = FIRCase(
            description      = f"{title}. {summary}",
            crime_type       = fir_details["offence"],
            zone_id          = entities.get("zone_id"),
            zone             = entities.get("zone"),
            status           = "Open",
            ipc_sections     = json.dumps([fir_details["offence"]]),
            resolution_notes = " | ".join(generate_tactical_advice(fir_details["offence"]))
        )
        db.add(fir_case)
        db.commit()
        db.refresh(fir_case)

        # Link detected Suspects
        for p_name in fir_details["person"]:
            # Check if suspect exists or create
            suspect = db.query(Suspect).filter(Suspect.name == p_name).first()
            if not suspect:
                suspect = Suspect(name=p_name, last_known_zone=entities.get("zone"))
                db.add(suspect)
                db.commit()
                db.refresh(suspect)
            
            # Link to case
            link = FIRSuspectLink(fir_id=fir_case.id, suspect_id=suspect.id, role="Accused")
            db.add(link)
            db.commit()

        logger.info("[FIR_INTEL] Automated Case #%d created for %s", fir_case.id, fir_details["offence"])


# ── Main cycle (called by APScheduler every 5 min) ───────────────────────────

async def run_ingestion_cycle() -> None:
    logger.info("⟳  Ingestion cycle started — %d feeds", len(RSS_FEEDS))
    db = SessionLocal()
    try:
        fetch_tasks = [
            _fetch_feed(name, url)
            for name, url in RSS_FEEDS.items()
        ]
        results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

        total_new = 0
        for (source_name, _), entries in zip(RSS_FEEDS.items(), results):
            if isinstance(entries, Exception):
                logger.warning("Skipping %s — exception during fetch", source_name)
                continue
            for entry in entries[:25]:  # cap per feed per cycle
                before = db.query(CrimeEvent).count()
                await _process_entry(entry, source_name, db)
                after  = db.query(CrimeEvent).count()
                total_new += (after - before)

        logger.info("✓  Ingestion done — %d new events", total_new)
    finally:
        db.close()

