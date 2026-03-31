import requests
import os
from datetime import datetime, timezone

NEWSDATA_URL = "https://newsdata.io/api/1/latest"

def fetch_crime_news():
    api_key = os.getenv("NEWSDATA_API_KEY")
    if not api_key:
        print("[NEWS] Error: NEWSDATA_API_KEY not found in environment variables.")
        return []

    params = {
        "apikey": api_key,
        "country": "in",
        "category": "crime",
        "language": "en",
        "q": "Mumbai OR मुंबई",
        
    }

    try:
        r = requests.get(NEWSDATA_URL, params=params, timeout=10)
        print(f"[NEWS] Status code: {r.status_code}")
        articles = r.json().get("results", [])
        print(f"[NEWS] Got {len(articles)} articles")
        return [
            {
                "headline": a.get("title"),
                "source_url": a.get("link"),
                "published_at": a.get("pubDate"),
                "description": a.get("description", ""),
                "fetched_at": datetime.now(timezone.utc).isoformat()
            }
            for a in articles
        ]
    except Exception as e:
        print(f"[NEWS] Exception: {e}")
        return []

