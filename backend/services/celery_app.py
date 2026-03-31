import os
from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

app = Celery(
    "backend",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["backend.ingestion.news_pipeline"]
)

app.conf.update(
    result_expires=3600,
    timezone="Asia/Kolkata",
    enable_utc=True,
)

if __name__ == "__main__":
    app.start()

