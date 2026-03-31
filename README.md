# 🛡️ Sentinel — Crime Intelligence Platform

Sentinel is a real-time crime intelligence and predictive analytics platform for Mumbai, India. It combines a FastAPI backend, ML-powered crime forecasting (Hawkes Process + RandomForest), FIR document parsing, gang network analysis, and a React frontend — all containerised with Docker.

---

## Architecture

```
sentinel/
├── backend/          # FastAPI app
│   ├── main.py       # App entrypoint, JWT middleware, CORS
│   ├── routers/      # 20+ domain routers (fir, predict, heatmap, ...)
│   ├── ml/           # ML models (Hawkes, RandomForest)
│   │   ├── hawkes.py          # Hawkes process with MLE fitting
│   │   ├── train_from_db.py   # Temporal train/test split training
│   │   └── predict.py         # Inference
│   ├── services/     # Redis pub/sub, WebSocket manager, news ingester
│   ├── db/           # SQLAlchemy models & session
│   └── sentinel_pipeline.py  # CSV → SQLite data pipeline
├── frontend/         # React dashboard
├── ml/               # Standalone ML notebooks/scripts
├── data/             # CSV datasets (gitignored)
├── docker-compose.yml
├── .env.example      # ← copy to .env and configure
└── README.md
```

---

## Quick Start

### 1. Configure environment
```bash
cp .env.example .env
# Edit .env — set SECRET_KEY, ALLOWED_ORIGINS, paths
```

### 2. Run with Docker
```bash
docker-compose up --build
```

### 3. Or run locally
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API docs available at `http://localhost:8000/docs`

---

## ML Pipeline

### Train the crime classifier
```bash
cd backend
python ml/train_from_db.py
```
- Uses **temporal train/test split** (train < 2023, test ≥ 2023) — no data leakage
- Only real timestamps used for temporal features — no synthetic injection
- Outputs `crime_model.pkl`, `label_encoder.pkl`, `feature_info.json`

### Run data pipeline
```bash
python sentinel_pipeline.py
```
Ingest all CSV sources into the SQLite database.

---

## Security

- JWT Bearer tokens required for all protected routes
- CORS restricted to origins listed in `ALLOWED_ORIGINS` env var
- Open routes (heatmap, zones, public API) are explicitly whitelisted
- Secrets managed via `.env` — never hardcoded

---

## Key Features

| Module | Description |
|--------|-------------|
| **Hawkes Process** | Self-exciting point process for crime hotspot forecasting with MLE-fitted parameters |
| **Crime Classifier** | RandomForest trained on 3 real Indian crime datasets |
| **FIR Parser** | PDF/text FIR ingestion with NER entity extraction |
| **Gang Networks** | Graph-based gang relationship analysis |
| **Cyber Fraud** | UPI fraud detection and alerting |
| **Real-time WS** | Redis pub/sub → WebSocket live event streaming |
| **Heatmap** | Zone-level crime density visualisation |

---

## Data Sources

- Mumbai Police Ward Crime Data 2020–2024
- India Multi-City Crime Dataset
- NCRB IPC Crimes 2022–23
- NCRB Cyber Crimes 2023
- UPI Fraud Transactions Dataset
- Ride Safety Dataset (Mumbai)

---

## License

MIT License — for educational and research purposes only.  
Do not use with real PII or deploy in production without proper security audit.
