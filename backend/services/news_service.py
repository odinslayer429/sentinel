import logging
import random
from datetime import datetime
from db.database import SessionLocal
from db.models import CrimeEvent
from .news_ingester import fetch_crime_news

logger = logging.getLogger(__name__)

def get_hyperlocal_mumbai_news():
    db = SessionLocal()
    try:
        events = db.query(CrimeEvent).order_by(CrimeEvent.ingested_at.desc()).limit(20).all()

        if not events:
            # DB is empty — fall back to live NewsData API
            return fetch_crime_news()

        sample_size = min(len(events), 8)
        selected_events = random.sample(events, sample_size)

        return [{
            "id": f"real_{ev.id}",
            "title": ev.title or "Incident reported in " + (ev.zone_id or "Mumbai"),
            "timestamp": ev.ingested_at.isoformat() if ev.ingested_at else datetime.now().isoformat(),
            "location": ev.zone_id or "Mumbai",
            "category": ev.severity or "ALERT"
        } for ev in selected_events]

    except Exception as e:
        logger.error(f"Failed to fetch live news: {e}")
        return fetch_crime_news()  # fallback on any error too
    finally:
        db.close()

def get_city_sentiment() -> float:
    news = get_hyperlocal_mumbai_news()
    PANIC_KW = ["phishing", "fraud", "raid", "pursuit", "neutralized", "seizure", "unrest", "threat"]
    hits = sum(1 for n in news if any(kw in n.get("title", n.get("headline", "")).lower() for kw in PANIC_KW))
    multiplier = 1.0 + (hits * 0.05)
    return round(max(0.9, min(multiplier, 1.3)), 2)

