from fastapi import APIRouter, Depends
from db.database import get_db
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/gang-networks", tags=["Gang Detection"])

@router.get("/graph")
async def get_network_graph(db: Session = Depends(get_db)):
    nodes = [
        {"id": 1, "label": "Kingpin_A", "role": "Central Node", "anomaly": 0.95},
        {"id": 2, "label": "Associate_1", "role": "Member", "anomaly": 0.45},
        {"id": 3, "label": "Associate_2", "role": "Member", "anomaly": 0.3},
        {"id": 4, "label": "Carrier_X", "role": "Outer Node", "anomaly": 0.6}
    ]
    edges = [
        {"source": 1, "target": 2, "weight": 0.9},
        {"source": 1, "target": 3, "weight": 0.85},
        {"source": 1, "target": 4, "weight": 0.7},
        {"source": 2, "target": 3, "weight": 0.4}
    ]
    return {
        "nodes": nodes,
        "edges": edges,
        "communities": [{"id": 0, "name": "Bandra Syndicate", "members": [1, 2, 3]}]
    }

@router.get("/anomalies")
async def get_net_anomalies(db: Session = Depends(get_db)):
    return {"anomalies": ["Heavy encrypted traffic spike between Node 1 and Node 4 at 03:00 AM"]}