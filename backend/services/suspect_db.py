import logging
from typing import Dict, List, Optional
import networkx as nx
from sqlalchemy.orm import Session
from db.database import SessionLocal
from db.models import Suspect, FIRSuspectLink, FIRCase, Entity, FIREntityLink

logger = logging.getLogger(__name__)

def add_suspect(name: str, aliases: str = "[]", age: Optional[int] = None, contact_info: Optional[str] = None, last_known_zone: Optional[str] = None, crime_types: str = "[]") -> int:
    """Register a new suspect profile into the DB."""
    db = SessionLocal()
    try:
        s = Suspect(
            name=name, aliases=aliases, age=age,
            contact_info=contact_info, last_known_zone=last_known_zone,
            crime_types=crime_types
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        return s.id
    finally:
        db.close()

def link_suspect_to_fir(fir_id: int, suspect_id: int, role: str = "Accused") -> bool:
    """Link an existing suspect profile to a case (makes co-accused graphs possible)."""
    db = SessionLocal()
    try:
        link = FIRSuspectLink(fir_id=fir_id, suspect_id=suspect_id, role=role)
        db.add(link)
        db.commit()
        return True
    except Exception as exc:
        logger.error("Failed to link suspect to FIR: %s", exc)
        return False
    finally:
        db.close()

def search_suspects(query: str, zone: Optional[str] = None, crime_type: Optional[str] = None) -> List[Dict]:
    """Search suspects heavily filtering."""
    db = SessionLocal()
    try:
        q = db.query(Suspect).filter(Suspect.name.ilike(f"%{query}%"))
        if zone:
            q = q.filter(Suspect.last_known_zone.ilike(f"%{zone}%"))
        if crime_type:
            q = q.filter(Suspect.crime_types.ilike(f"%{crime_type}%"))
            
        suspects = q.all()
        return [{
            "id": s.id, "name": s.name, "aliases": s.aliases,
            "age": s.age, "last_known_zone": s.last_known_zone,
            "crime_types": s.crime_types, "contact_info": s.contact_info
        } for s in suspects]
    finally:
        db.close()

def generate_network_graph(suspect_id: Optional[int] = None) -> Dict:
    """
    Builds the Criminal Network Graph.
    Uses NetworkX to build nodes (suspects) and edges (shared FIRs).
    If a specific suspect_id is requested, returns a subgraph around them. 
    Returns in D3 Node-Link JSON format.
    """
    db = SessionLocal()
    try:
        graph = nx.Graph()
        s_links = db.query(FIRSuspectLink).all()
        e_links = db.query(FIREntityLink).all()
        
        # Mapping FIR_ID -> List of globally unique node IDs
        fir_to_nodes = {}
        for link in s_links:
            if link.fir_id not in fir_to_nodes: fir_to_nodes[link.fir_id] = []
            fir_to_nodes[link.fir_id].append(f"S_{link.suspect_id}")
            
        for link in e_links:
            if link.fir_id not in fir_to_nodes: fir_to_nodes[link.fir_id] = []
            fir_to_nodes[link.fir_id].append(f"E_{link.entity_id}")
            
        # Add all suspects as nodes
        all_suspects = db.query(Suspect).all()
        for s in all_suspects:
            node_id = f"S_{s.id}"
            graph.add_node(node_id, id=s.id, name=s.name, zone=s.last_known_zone, crime_types=s.crime_types, class_type="suspect")
            
        # Add all entities as nodes
        all_entities = db.query(Entity).all()
        for e in all_entities:
            node_id = f"E_{e.id}"
            graph.add_node(node_id, id=e.id, name=e.value, class_type=e.type.lower())
            
        # Draw edges if they share an FIR
        for fir_id, n_list in fir_to_nodes.items():
            for i in range(len(n_list)):
                for j in range(i+1, len(n_list)):
                    u = n_list[i]
                    v = n_list[j]
                    if graph.has_edge(u, v):
                        graph[u][v]['weight'] += 1
                        if fir_id not in graph[u][v]['firs']:
                            graph[u][v]['firs'].append(fir_id)
                    else:
                        graph.add_edge(u, v, weight=1, firs=[fir_id])
                        
        if suspect_id:
            target_node = f"S_{suspect_id}"
            if graph.has_node(target_node):
                # Only keep 2-degree neighborhood around target
                nodes_to_keep = set([target_node])
                for n in graph.neighbors(target_node):
                    nodes_to_keep.add(n)
                    for nn in graph.neighbors(n): # Depth 2
                        nodes_to_keep.add(nn)
                graph = graph.subgraph(nodes_to_keep)
            
        return nx.node_link_data(graph)
    finally:
        db.close()
def get_top_offenders(limit: int = 10) -> List[Dict]:
    """Returns suspects with high linkage to FIRs and Entities, plus risk analytics."""
    db = SessionLocal()
    try:
        from sqlalchemy import func
        from datetime import datetime, timezone
        
        # Query: Suspects + FIR counts + Latest FIR link date (last_seen)
        results = (
            db.query(
                Suspect, 
                func.count(FIRSuspectLink.id).label('fir_count'),
                func.max(FIRSuspectLink.created_at).label('last_seen')
            )
            .outerjoin(FIRSuspectLink, Suspect.id == FIRSuspectLink.suspect_id)
            .group_by(Suspect.id)
            .order_by(func.count(FIRSuspectLink.id).desc())
            .limit(limit)
            .all()
        )
        
        now = datetime.utcnow()
        offenders = []
        
        for s, fir_count, last_seen in results:
            days_since = (now - last_seen).days if last_seen else 9999
            
            # 1. Predicted Risk
            if fir_count >= 4 or (fir_count >= 2 and days_since <= 90):
                risk = "High"
            elif (2 <= fir_count <= 3) and days_since <= 180:
                risk = "Medium"
            else:
                risk = "Low"
                
            # 2. Intervention Protocol
            protocol = {
                "High": "Intensive Supervision Program",
                "Medium": "Enhanced Monitoring",
                "Low": "Standard Check-in"
            }.get(risk)
            
            # 3. Recidivism Probability (0-1)
            # Base: 0.15 per FIR, capped at 0.7
            prob = min(fir_count * 0.15, 0.7)
            # Recency bonus
            if days_since <= 30: prob += 0.25
            elif days_since <= 90: prob += 0.15
            elif days_since <= 180: prob += 0.05
            # Decay for cold cases
            if days_since > 365: prob -= 0.2
            
            prob = max(0.05, min(0.98, prob)) # Clamp with small floor/ceiling
            
            offenders.append({
                "id": s.id,
                "name": s.name,
                "alias": s.aliases,
                "fir_count": fir_count,
                "zones": s.last_known_zone,
                "last_seen": last_seen.isoformat() if last_seen else "N/A",
                "predicted_risk": risk,
                "intervention_protocol": protocol,
                "recidivism_probability": round(prob, 2)
            })
            
        return offenders
    finally:
        db.close()

