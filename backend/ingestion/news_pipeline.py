import logging
import os
import spacy
import httpx
import json
import asyncio
from services.celery_app import app
# from newsdataapi import NewsDataApiClient # Removed for now to avoid dependency issues if it fails
# import praw
from backend.services.ws_manager import manager
from backend.db.database import engine
from backend.db.models import CrimeRecord
from sqlalchemy.orm import sessionmaker
from transformers import pipeline

# Celery app is imported from services.celery_app

# NLP Models
logger = logging.getLogger("IngestionPipeline")
try:
    nlp = spacy.load("en_core_web_trf")
    classifier = pipeline("zero-shot-classification", model="cardiffnlp/twitter-roberta-base-topic-sentiment-latest")
except Exception as e:
    logger.warning(f"Failed to load real NLP models: {e}. Falling back to mocks.")
    nlp = None
    classifier = None

SessionLocal = sessionmaker(bind=engine)

CRIME_LABELS = ["Theft", "Assault", "Fraud", "Cybercrime", "Homicide", "Harassment"]

@app.task
def ingest_news():
    logger.info("Starting News Ingestion...")
    api_key = os.getenv("NEWSDATA_API_KEY")
    if not api_key:
        logger.error("No NEWSDATA_API_KEY found.")
        return
        
    client = NewsDataApiClient(apikey=api_key)
    try:
        response = client.news_api(country="in", category="crime", language="en")
        results = response.get('results', [])
        
        session = SessionLocal()
        for article in results:
            text = article.get('description', article.get('title', ''))
            
            # NLP Processing
            if nlp:
                doc = nlp(text)
                locations = [ent.text for ent in doc.ents if ent.label_ == "GPE"]
            else:
                locations = ["Mumbai"]
                
            if classifier:
                res = classifier(text, candidate_labels=CRIME_LABELS)
                crime_type = res['labels'][0]
                severity = res['scores'][0]
            else:
                crime_type = "Unclassified"
                severity = 0.5
                
            # Geocode Placeholder (Mumbai centroid)
            lat, lon = 19.076, 72.877
            
            new_crime = CrimeRecord(
                source_tag="newsdata",
                crime_type=crime_type,
                severity_score=severity,
                raw_text=text,
                source_url=article.get('link')
            )
            session.add(new_crime)
            
            # Push Alert
            asyncio.run(manager.broadcast(json.dumps({
                "type": "NEWS_ALERT",
                "title": article.get('title'),
                "crime_type": crime_type,
                "severity": "CRITICAL" if severity > 0.8 else "INFO"
            })))
            
        session.commit()
        session.close()
    except Exception as e:
        logger.error(f"News Ingestion Error: {e}")

@app.task
def ingest_social():
    logger.info("Starting Social Media Ingestion (Reddit)...")
    # PRAW logic here...
    pass

@app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    sender.add_periodic_task(300.0, ingest_news.s(), name="news-every-5-min")

