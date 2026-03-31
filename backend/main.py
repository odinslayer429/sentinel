import os
import asyncio
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt

from routers.tactical import router as tactical_router
from services.ws_manager import manager
from services.redis_pubsub import redis_subscriber
from services.news_ingester import fetch_crime_news

from routers.auth import router as auth_router
from routers.ml_engine import router as ml_router
from routers.stats import router as stats_router
from routers.predictive import router as predictive_router
from routers.copilot import router as copilot_router
from routers.gang_networks import router as gang_router
from routers.cyber_fraud import router as cyber_fraud_router
from routers.briefing import router as briefing_router
from routers.cybercrime import router as cybercrime_router
from routers.dispatch import router as dispatch_router
from routers.events import router as events_router
from routers.heatmap import router as heatmap_router
from routers.investigation import router as investigation_router
from routers.operations import router as operations_router
from routers.public_api import router as public_api_router
from routers.velocity import router as velocity_router
from routers.zones import router as zones_router
from routers.predict import router as predict_api_router
from routers.fir import router as fir_router
from routers.social import router as social_router

# ── Auth config (mirrors routers/auth.py) ─────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "sentinel-secret-key-change-in-production-2026")
ALGORITHM  = "HS256"

# Routes that do NOT require a JWT token
OPEN_PREFIXES = [
    "/api/public", "/api/events", "/api/alerts",
    "/api/fir",    "/api/velocity", "/api/zones",
    "/api/heatmap", "/api/gang-networks", "/api/dispatch",
    "/api/investigation", "/api/briefing", "/api/predict",
    "/api/social",  "/api/news",   "/api/debug",  "/api/status",
    "/api/auth",
    "/docs", "/openapi.json", "/ws", "/redoc", "/",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    subscribe_task = asyncio.create_task(redis_subscriber.start())
    print("[STARTUP] Sentinel backend & Redis subscriber online")
    yield
    subscribe_task.cancel()
    try:
        await subscribe_task
    except asyncio.CancelledError:
        print("[SHUTDOWN] Redis subscriber cancelled")


app = FastAPI(title="Sentinel Full Backend", lifespan=lifespan)

# ── CORS ─────────────────────────────────────────────────────────────────────
# Read allowed origins from env; fallback to localhost for local dev only.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,       # explicit origins, never wildcard with credentials
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── JWT Auth Enforcement Middleware ──────────────────────────────────────────
@app.middleware("http")
async def enforce_jwt_auth(request: Request, call_next):
    """
    Validates Bearer JWT on every request EXCEPT open prefixes.
    Returns 401 immediately for missing / invalid tokens on protected routes.
    """
    path = request.url.path

    # Skip auth for open routes
    if any(path.startswith(p) for p in OPEN_PREFIXES):
        return await call_next(request)

    # Require Authorization header
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return _unauthorized("Missing or malformed Authorization header")

    token = auth_header.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            return _unauthorized("Token payload missing subject")
        request.state.username = username
        request.state.role     = payload.get("role", "officer")
    except JWTError as exc:
        return _unauthorized(f"Invalid token: {exc}")

    return await call_next(request)


from fastapi.responses import JSONResponse

def _unauthorized(detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={"detail": detail},
        headers={"WWW-Authenticate": "Bearer"},
    )


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(stats_router)
app.include_router(ml_router)
app.include_router(predictive_router)
app.include_router(copilot_router)
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
app.include_router(public_api_router)
app.include_router(velocity_router)
app.include_router(zones_router)
app.include_router(predict_api_router)
app.include_router(fir_router)
app.include_router(social_router)


# ── WebSocket ─────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ── Health endpoints ──────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"message": "Sentinel Full Backend is online", "port": 8000}


@app.get("/api/status")
def status_check():
    return {"status": "OK"}


@app.on_event("startup")
def startup_event():
    print("[STARTUP] Sentinel backend is online")


@app.get("/api/news/feed")
def get_news_feed():
    data = fetch_crime_news()
    return {"results": data}


@app.get("/api/debug/fetch")
def trigger_fetch():
    data = fetch_crime_news()
    return {"cache_size": len(data), "first": data[0] if data else None}
