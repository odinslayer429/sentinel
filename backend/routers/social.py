from fastapi import APIRouter
from typing import List, Dict

router = APIRouter(prefix="/api/social", tags=["social"])

@router.get("/monitors")
async def get_social_monitors():
    # In a real app, this would query a social media ingestion worker (Kafka/Redis)
    return {
        "overall_tension": 72,
        "sentiment_profile": {
            "positive": 12,
            "neutral": 28,
            "negative": 60
        },
        "zone_breakdown": [
            {"zone": "DHARAVI", "tension": 88, "status": "CRITICAL"},
            {"zone": "BANDRA", "tension": 45, "status": "STABLE"},
            {"zone": "KURLA", "tension": 78, "status": "ELEVATED"},
            {"zone": "COLABA", "tension": 22, "status": "STABLE"}
        ],
        "viral_alerts": [
            {
                "id": "V-901",
                "platform": "TWITTER/X",
                "content": "Traffic disruption report near Bandra-Worli Sea Link. Potential gathering detected.",
                "tension": 82,
                "time": "4 mins ago",
                "reached_count": "14.2K"
            },
            {
                "id": "V-902",
                "platform": "TELEGRAM",
                "content": "Encrypted group coordination for protest at Gateway. Sentiment is hostile.",
                "tension": 94,
                "time": "12 mins ago",
                "reached_count": "2.1K"
            },
            {
                "id": "V-903",
                "platform": "WHATSAPP",
                "content": "Viral audio clip regarding religious tension circulating in Kurla West.",
                "tension": 89,
                "time": "30 mins ago",
                "reached_count": "50K+"
            }
        ]
    }

