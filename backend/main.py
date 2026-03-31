import os
import asyncio
from datetime import datetime
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from routers.tactical import router as tactical_router
from services.ws_manager import manager
from services.redis_pubsub import redis_subscriber
from services.news_ingester import fetch_crime_news

from routers.auth import router as auth_router
from routers.ml_engine import router as ml_router
from routers.stats import router as stats_router
from routers.predictive import router as predictive_router
from routers.face_rec import router as face_router
from routers.anpr import router as anpr_router
from routers.copilot import router as copilot_router
from routers.missing_persons import router as missing_router
from routers.gang_networks import router as gang_router
from routers.cyber_fraud import router as cyber_fraud_router
from routers.briefing import router as briefing_router
from routers.cybercrime import router as cybercrime_router
from routers.dispatch import router as dispatch_router
from routers.events import router as events_router
from routers.heatmap import router as heatmap_router
from routers.investigation import router as investigation_router
from routers.operations import router as operations_router
from routers.osint import router as osint_router
from routers.public_api import router as public_api_router
from routers.velocity import router as velocity_router
from routers.zones import router as zones_router
from routers.predict import router as predict_api_router
from routers.fir import router as fir_router
from routers.social import router as social_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start Redis subscriber in the background
    subscribe_task = asyncio.create_task(redis_subscriber.start())
    print("[STARTUP] Sentinel backend & Redis subscriber online")
    yield
    # Shutdown: Cancel the task
    subscribe_task.cancel()
    try:
        await subscribe_task
    except asyncio.CancelledError:
        print("[SHUTDOWN] Redis subscriber cancelled")

app = FastAPI(title="Sentinel Full Backend", lifespan=lifespan)

from fastapi import Request

@app.middleware("http")
async def open_dashboard_routes(request: Request, call_next):
    OPEN = [
        "/api/public", "/api/events", "/api/alerts",
        "/api/fir", "/api/velocity", "/api/zones",
        "/api/heatmap", "/api/gang-networks", "/api/dispatch",
        "/api/investigation", "/api/briefing", "/api/predict",
        "/api/social", "/api/news", "/api/debug", "/api/status",
        "/docs", "/openapi.json", "/ws", "/redoc", "/"
    ]
    if any(request.url.path.startswith(p) for p in OPEN):
        request.state.skip_auth = True
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(stats_router)
app.include_router(ml_router)
app.include_router(predictive_router)
app.include_router(face_router)
app.include_router(anpr_router)
app.include_router(copilot_router)
app.include_router(missing_router)
app.include_router(gang_router)
app.include_router(cyber_fraud_router)
app.include_router(briefing_router)
app.include_router(cybercrime_router)
app.include_router(dispatch_router)
app.include_router(events_router)
app.include_router(heatmap_router)
app.include_router(tactical_router)
app.include_router(investigation_router)
app.include_router(operations_router)
app.include_router(osint_router)
app.include_router(public_api_router)
app.include_router(velocity_router)
app.include_router(zones_router)
app.include_router(predict_api_router)
app.include_router(fir_router)
app.include_router(social_router)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Production-grade WebSocket endpoint. 
    Acceptance and broadcast lifecycle is managed by ws_manager and redis_pubsub.
    """
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection open, wait for client messages if any
            data = await websocket.receive_text()
            # Handle incoming if needed, or just pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.get("/")
def root():
    return {"message": "Sentinel Full Backend is online", "port": 8000}

@app.get("/api/status")
def status():
    return {"status": "OK"}

@app.on_event("startup")
def startup_event():
    print("[STARTUP] Sentinel backend is online")

@app.get("/api/news/feed")
def get_news_feed():
    data = fetch_crime_news()
    print(f"[ROUTE] data length = {len(data)}")  # â† ADD THIS
    return {"results": data}

@app.get("/api/debug/fetch")
def trigger_fetch():
    data = fetch_crime_news()
    return {"cache_size": len(data), "first": data[0] if data else None}
