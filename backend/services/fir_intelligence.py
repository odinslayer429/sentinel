"""
fir_intelligence.py
───────────────────
FIR (First Information Report) Intelligence module.

Given raw FIR text from an officer, this module produces:

  1. Structured extraction
     ─────────────────────
     Custom spaCy EntityRuler on top of en_core_web_md extracts
     FIR-specific fields that generic NER misses:
       - accused_count, victim_count
       - weapons mentioned
       - time of occurrence
       - items stolen / lost
       - location (mapped to zone via zone_graph)
       - crime types (from ner_pipeline keyword match)

  2. IPC Section Recommendations
     ────────────────────────────
     Deterministic rule-based mapping from crime types → IPC sections.
     IPC sections are law — we do not use ML to predict them.
     Each recommendation includes the section number, title, and
     whether it is a bailable / cognizable offence.

  3. Semantic Similarity Search
     ───────────────────────────
     all-MiniLM-L6-v2 (local, CPU, 80MB) embeds the FIR description
     into a 384-dim vector. FAISS IndexFlatIP (cosine similarity via
     L2 normalisation) retrieves top-K most similar past FIR cases
     from the fir_cases DB table.

     Index type auto-upgrades to IndexIVFFlat at 1000+ entries.
     Index is persisted to ml/fir_index.faiss and reloaded on startup.

  4. Repeat Pattern Detection
     ─────────────────────────
     Checks DB for similar crime_type + zone combinations in the
     last 30 days and flags if a pattern exists. Pure DB query — no ML.

No synthetic data. The FAISS index starts empty on a fresh install
and grows as officers submit real FIRs. Similarity search gracefully
returns empty results when the index has fewer than 3 entries.
"""

import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from sqlalchemy.orm import Session

from db.database import SessionLocal
from db.models import FIRCase, Entity, FIREntityLink
from .ner_pipeline import extract_crime_types, extract_entities
from .zone_graph import ZONES, get_zone_by_keyword

logger = logging.getLogger(__name__)

INDEX_PATH     = Path(__file__).parent.parent.parent / "ml" / "fir_index.faiss"
INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)

_EMBEDDING_DIM = 384
_TOP_K_DEFAULT = 5
_IVF_THRESHOLD = 1000   # switch from Flat to IVFFlat at this many entries

# Lazy-loaded globals
_embedder  = None
_faiss_idx = None
_index_ids: List[int] = []   # maps FAISS position → FIRCase.id in DB


# ─────────────────────────────────────────────────────────────────────────────
# IPC Section mapping — deterministic, not ML
# Source: The Indian Penal Code, 1860 (as amended)
# ─────────────────────────────────────────────────────────────────────────────

IPC_MAP: Dict[str, List[Dict]] = {
    "Murder": [
        {"section": "IPC 302", "title": "Punishment for murder",
         "cognizable": True, "bailable": False},
        {"section": "IPC 300", "title": "Murder (definition)",
         "cognizable": True, "bailable": False},
    ],
    "Robbery": [
        {"section": "IPC 392", "title": "Punishment for robbery",
         "cognizable": True, "bailable": False},
        {"section": "IPC 394", "title": "Voluntarily causing hurt in committing robbery",
         "cognizable": True, "bailable": False},
    ],
    "Theft": [
        {"section": "IPC 379", "title": "Punishment for theft",
         "cognizable": True, "bailable": False},
        {"section": "IPC 380", "title": "Theft in dwelling house",
         "cognizable": True, "bailable": False},
        {"section": "IPC 381", "title": "Theft by clerk or servant",
         "cognizable": True, "bailable": False},
    ],
    "Assault": [
        {"section": "IPC 351", "title": "Assault",
         "cognizable": False, "bailable": True},
        {"section": "IPC 352", "title": "Punishment for assault",
         "cognizable": False, "bailable": True},
        {"section": "IPC 324", "title": "Voluntarily causing hurt by dangerous weapons",
         "cognizable": True, "bailable": False},
    ],
    "Kidnapping": [
        {"section": "IPC 363", "title": "Punishment for kidnapping",
         "cognizable": True, "bailable": False},
        {"section": "IPC 364", "title": "Kidnapping in order to murder",
         "cognizable": True, "bailable": False},
        {"section": "IPC 365", "title": "Kidnapping with intent to secretly confine",
         "cognizable": True, "bailable": False},
    ],
    "Rape": [
        {"section": "IPC 376", "title": "Punishment for rape",
         "cognizable": True, "bailable": False},
        {"section": "IPC 354", "title": "Assault with intent to outrage modesty",
         "cognizable": True, "bailable": False},
        {"section": "POCSO 4", "title": "Penetrative sexual assault (minor)",
         "cognizable": True, "bailable": False},
    ],
    "Fraud": [
        {"section": "IPC 420", "title": "Cheating and dishonestly inducing delivery",
         "cognizable": True, "bailable": False},
        {"section": "IPC 406", "title": "Punishment for criminal breach of trust",
         "cognizable": True, "bailable": False},
        {"section": "IPC 468", "title": "Forgery for purpose of cheating",
         "cognizable": True, "bailable": False},
    ],
    "Cybercrime": [
        {"section": "IT Act 66", "title": "Computer related offences",
         "cognizable": True, "bailable": False},
        {"section": "IT Act 66C", "title": "Identity theft",
         "cognizable": True, "bailable": False},
        {"section": "IT Act 66D", "title": "Cheating by personation using computer",
         "cognizable": True, "bailable": False},
        {"section": "IPC 420", "title": "Cheating",
         "cognizable": True, "bailable": False},
    ],
    "Drug": [
        {"section": "NDPS 20", "title": "Punishment for contravention re: cannabis",
         "cognizable": True, "bailable": False},
        {"section": "NDPS 21", "title": "Punishment for contravention re: manufactured drugs",
         "cognizable": True, "bailable": False},
        {"section": "NDPS 29", "title": "Abetment and criminal conspiracy",
         "cognizable": True, "bailable": False},
    ],
    "Shooting": [
        {"section": "IPC 307", "title": "Attempt to murder",
         "cognizable": True, "bailable": False},
        {"section": "Arms Act 25", "title": "Punishment for contravention of Arms Act",
         "cognizable": True, "bailable": False},
        {"section": "IPC 302", "title": "Punishment for murder (if fatal)",
         "cognizable": True, "bailable": False},
    ],
    "Extortion": [
        {"section": "IPC 383", "title": "Extortion",
         "cognizable": True, "bailable": False},
        {"section": "IPC 384", "title": "Punishment for extortion",
         "cognizable": True, "bailable": False},
        {"section": "IPC 385", "title": "Putting person in fear to commit extortion",
         "cognizable": True, "bailable": False},
    ],
}

# Always applicable sections (added for any FIR)
_COMMON_SECTIONS = [
    {"section": "IPC 34",  "title": "Acts done by several persons in furtherance of common intention",
     "cognizable": True, "bailable": False},
    {"section": "IPC 120B", "title": "Criminal conspiracy",
     "cognizable": True, "bailable": False},
]


def get_ipc_sections(crime_types: List[str]) -> List[Dict]:
    """
    Return applicable IPC sections for the given crime types.
    Deterministic rule lookup — no ML involved.
    """
    seen     = set()
    sections = []
    for ct in crime_types:
        for sec in IPC_MAP.get(ct, []):
            if sec["section"] not in seen:
                seen.add(sec["section"])
                sections.append({**sec, "crime_type": ct})
    return sections


# ─────────────────────────────────────────────────────────────────────────────
# Custom spaCy patterns for FIR-specific extraction
# ─────────────────────────────────────────────────────────────────────────────

# Time patterns found in FIRs: "at 2am", "at 14:30", "around midnight"
_TIME_RE = re.compile(
    r'\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)|midnight|noon|dawn|dusk)\b',
    re.IGNORECASE,
)
# Weapon patterns
_WEAPON_KW = [
    "knife", "gun", "pistol", "revolver", "sword", "rod", "stick",
    "axe", "acid", "firearm", "sharp object", "blunt object",
]
# Stolen items
_STOLEN_KW = [
    "gold", "cash", "mobile", "phone", "laptop", "jewelry", "jewellery",
    "wallet", "bag", "car", "bike", "vehicle", "watch",
]
# Accused / victim count
_ACCUSED_RE = re.compile(
    r'(\d+)\s+(?:accused|persons?|individuals?|men|women|suspects?)',
    re.IGNORECASE,
)
_VICTIM_RE = re.compile(
    r'(\d+)\s+(?:victim|complainant|injured)',
    re.IGNORECASE,
)
_PHONE_RE = re.compile(r'\b\d{10}\b')
_VEHICLE_RE = re.compile(r'\b[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{1,2}[ -]?\d{4}\b', re.IGNORECASE)
_UPI_RE = re.compile(r'\b[a-zA-Z0-9.\-_]+@[a-zA-Z]+\b')


def extract_fir_fields(text: str) -> Dict:
    """
    Extract structured fields from raw FIR text.
    Combines spaCy NER with regex patterns specific to Indian FIR language.
    """
    # Base NER
    entities = extract_entities(text)

    # Time of occurrence
    times_found = _TIME_RE.findall(text)
    time_of_occurrence = times_found[0] if times_found else None

    # Weapons
    text_lower = text.lower()
    weapons = [w for w in _WEAPON_KW if w in text_lower]

    # Stolen items
    stolen_items = [s for s in _STOLEN_KW if s in text_lower]

    # Accused / victim counts
    accused_match = _ACCUSED_RE.search(text)
    victim_match  = _VICTIM_RE.search(text)
    accused_count = int(accused_match.group(1)) if accused_match else None
    victim_count  = int(victim_match.group(1))  if victim_match  else None
    
    # Deep Link Entities
    phones   = list(set(_PHONE_RE.findall(text)))
    vehicles = list(set(_VEHICLE_RE.findall(text)))
    upis     = list(set(_UPI_RE.findall(text)))

    return {
        "crime_types":       entities["crime_types"],
        "zone_id":           entities["zone_id"],
        "zone":              entities["zone"],
        "zone_lat":          entities["zone_lat"],
        "zone_lon":          entities["zone_lon"],
        "locations":         entities["locations"],
        "persons":           entities["persons"],
        "orgs":              entities["orgs"],
        "time_of_occurrence": time_of_occurrence,
        "weapons":           weapons,
        "stolen_items":      stolen_items,
        "accused_count":     accused_count,
        "victim_count":      victim_count,
        "phones":            phones,
        "vehicles":          vehicles,
        "upis":              upis,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Embedding model (lazy load)
# ─────────────────────────────────────────────────────────────────────────────

def _get_embedder():
    global _embedder
    if _embedder is not None:
        return _embedder
    from sentence_transformers import SentenceTransformer
    logger.info("Loading all-MiniLM-L6-v2 (~80MB, first load only)...")
    _embedder = SentenceTransformer("all-MiniLM-L6-v2")
    logger.info("Embedding model ready.")
    return _embedder


def _embed(text: str) -> np.ndarray:
    """Returns L2-normalised 384-dim embedding vector."""
    model  = _get_embedder()
    vec    = model.encode([text], convert_to_numpy=True, normalize_embeddings=True)
    return vec.astype("float32")


# ─────────────────────────────────────────────────────────────────────────────
# FAISS index management
# ─────────────────────────────────────────────────────────────────────────────

def _build_flat_index() -> "faiss.IndexFlatIP":
    import faiss
    return faiss.IndexFlatIP(_EMBEDDING_DIM)


def load_index():
    """
    Load persisted FAISS index from disk on startup.
    If file doesn't exist, initialises a fresh empty index.
    """
    global _faiss_idx, _index_ids
    import faiss

    if INDEX_PATH.exists():
        try:
            _faiss_idx = faiss.read_index(str(INDEX_PATH))
            # Load accompanying ID map
            id_map_path = INDEX_PATH.with_suffix(".ids.json")
            if id_map_path.exists():
                with open(id_map_path) as f:
                    _index_ids = json.load(f)
            logger.info("FAISS index loaded — %d vectors.", _faiss_idx.ntotal)
            return
        except Exception as exc:
            logger.warning("Could not load FAISS index (%s) — starting fresh.", exc)

    _faiss_idx = _build_flat_index()
    _index_ids = []
    logger.info("Fresh FAISS index initialised.")


def _save_index():
    global _faiss_idx, _index_ids
    if _faiss_idx is None:
        return
    try:
        import faiss
        faiss.write_index(_faiss_idx, str(INDEX_PATH))
        id_map_path = INDEX_PATH.with_suffix(".ids.json")
        with open(id_map_path, "w") as f:
            json.dump(_index_ids, f)
        logger.debug("FAISS index saved — %d vectors.", _faiss_idx.ntotal)
    except Exception as exc:
        logger.warning("Could not save FAISS index: %s", exc)


def _maybe_upgrade_index():
    """
    Once ntotal >= _IVF_THRESHOLD, rebuild as IndexIVFFlat for faster search.
    This is a one-time upgrade — flat index is exact but O(n) at scale.
    """
    global _faiss_idx
    if _faiss_idx is None or _faiss_idx.ntotal < _IVF_THRESHOLD:
        return
    if hasattr(_faiss_idx, "nlist"):
        return  # already IVF

    import faiss
    logger.info("Upgrading FAISS index to IVFFlat (%d vectors)...", _faiss_idx.ntotal)
    nlist    = min(int(np.sqrt(_faiss_idx.ntotal)), 256)
    quantiser = faiss.IndexFlatIP(_EMBEDDING_DIM)
    ivf       = faiss.IndexIVFFlat(quantiser, _EMBEDDING_DIM, nlist, faiss.METRIC_INNER_PRODUCT)

    # Extract all existing vectors and re-add
    old_vectors = np.zeros((_faiss_idx.ntotal, _EMBEDDING_DIM), dtype="float32")
    for i in range(_faiss_idx.ntotal):
        old_vectors[i] = faiss.rev_swig_ptr(_faiss_idx.get_xb(), _faiss_idx.ntotal * _EMBEDDING_DIM)[
            i * _EMBEDDING_DIM: (i+1) * _EMBEDDING_DIM
        ]

    ivf.train(old_vectors)
    ivf.add(old_vectors)
    ivf.nprobe = 10
    _faiss_idx = ivf
    _save_index()
    logger.info("FAISS index upgraded to IVFFlat.")


def add_to_index(fir_id: int, text: str):
    """Embed text and add to FAISS index. Call after inserting a FIRCase row."""
    global _faiss_idx, _index_ids
    if _faiss_idx is None:
        load_index()
    vec = _embed(text)
    _faiss_idx.add(vec)
    _index_ids.append(fir_id)
    _maybe_upgrade_index()
    _save_index()


# ─────────────────────────────────────────────────────────────────────────────
# Similarity search
# ─────────────────────────────────────────────────────────────────────────────

def search_similar(
    query_text: str,
    db: Session,
    top_k: int = _TOP_K_DEFAULT,
) -> List[Dict]:
    """
    Find top-K most similar FIR cases to the query text.
    Returns list of dicts with case details and cosine similarity score.
    Returns empty list if index has fewer than 3 entries.
    """
    global _faiss_idx, _index_ids
    if _faiss_idx is None:
        load_index()

    if _faiss_idx.ntotal < 3:
        logger.info("FAISS index has %d entries — need at least 3 for similarity search.",
                    _faiss_idx.ntotal)
        return []

    k   = min(top_k, _faiss_idx.ntotal)
    vec = _embed(query_text)

    distances, indices = _faiss_idx.search(vec, k)

    results = []
    for rank, (dist, idx) in enumerate(zip(distances[0], indices[0])):
        if idx < 0 or idx >= len(_index_ids):
            continue
        fir_id = _index_ids[idx]
        case   = db.query(FIRCase).filter_by(id=fir_id).first()
        if case is None:
            continue
        results.append({
            "rank":            rank + 1,
            "fir_id":          case.id,
            "fir_number":      case.fir_number,
            "description":     case.description[:300],
            "crime_type":      case.crime_type,
            "zone":            case.zone,
            "ipc_sections":    json.loads(case.ipc_sections or "[]"),
            "similarity":      round(float(dist), 4),   # cosine sim ∈ [0,1]
            "created_at":      case.created_at.isoformat() if case.created_at else None,
        })

    return results


# ─────────────────────────────────────────────────────────────────────────────
# Repeat pattern detection
# ─────────────────────────────────────────────────────────────────────────────

def detect_repeat_pattern(
    zone_id: Optional[str],
    crime_types: List[str],
    db: Session,
    days: int = 30,
) -> Optional[Dict]:
    """
    Check if the same crime type(s) have been occurring repeatedly
    in this zone over the last N days. Pure DB query — no ML.
    Returns a pattern dict if found, else None.
    """
    if not zone_id or not crime_types:
        return None

    since   = datetime.utcnow() - timedelta(days=days)
    similar = (
        db.query(FIRCase)
        .filter(FIRCase.zone_id == zone_id)
        .filter(FIRCase.created_at >= since)
        .all()
    )

    if len(similar) < 3:
        return None

    # Count overlap in crime types
    matches = []
    for case in similar:
        if case.crime_type and case.crime_type in crime_types:
            matches.append(case)

    if len(matches) < 3:
        return None

    return {
        "pattern_detected": True,
        "zone_id":          zone_id,
        "zone":             ZONES[zone_id]["name"] if zone_id in ZONES else zone_id,
        "matching_cases":   len(matches),
        "total_cases_zone": len(similar),
        "period_days":      days,
        "crime_types":      crime_types,
        "message": (
            f"Pattern detected: {len(matches)} similar FIRs in "
            f"{ZONES.get(zone_id, {}).get('short', zone_id)} in last {days} days."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public API — main entry point
# ─────────────────────────────────────────────────────────────────────────────

async def analyse_fir(
    description: str,
    fir_number:  Optional[str] = None,
    save_to_db:  bool = True,
) -> Dict:
    """
    Full FIR analysis pipeline.

    Args:
        description : Raw FIR text submitted by officer
        fir_number  : Optional official FIR number
        save_to_db  : If True, saves FIR to DB and adds to FAISS index

    Returns dict with keys:
        structured_fields, ipc_sections, similar_cases,
        repeat_pattern, fir_id (if saved)
    """
    db = SessionLocal()
    try:
        # 1. Structured extraction
        fields = extract_fir_fields(description)

        # 2. IPC sections
        ipc = get_ipc_sections(fields["crime_types"])

        # 3. Similarity search
        similar = search_similar(description, db)

        # 4. Repeat pattern
        pattern = detect_repeat_pattern(
            fields["zone_id"], fields["crime_types"], db
        )

        # 5. Persist
        fir_id = None
        if save_to_db:
            primary_crime = fields["crime_types"][0] if fields["crime_types"] else None
            case = FIRCase(
                fir_number   = fir_number,
                description  = description[:5000],
                crime_type   = primary_crime,
                zone_id      = fields["zone_id"],
                zone         = fields["zone"],
                ipc_sections = json.dumps([s["section"] for s in ipc]),
            )
            db.add(case)
            db.commit()
            db.refresh(case)
            fir_id = case.id
            add_to_index(fir_id, description)
            
            def _save_entity(val, e_type):
                ent = db.query(Entity).filter(Entity.value == val).first()
                if not ent:
                    ent = Entity(type=e_type, value=val)
                    db.add(ent)
                    db.commit()
                    db.refresh(ent)
                link = FIREntityLink(fir_id=fir_id, entity_id=ent.id)
                db.add(link)
                
            for p in fields.get("phones", []): _save_entity(p, "PHONE")
            for v in fields.get("vehicles", []): _save_entity(v.upper(), "VEHICLE")
            for u in fields.get("upis", []): _save_entity(u.lower(), "UPI")
            db.commit()

        return {
            "fir_id":           fir_id,
            "structured_fields": fields,
            "ipc_sections":     ipc,
            "similar_cases":    similar,
            "repeat_pattern":   pattern,
        }

    except Exception as exc:
        logger.exception("FIR analysis failed: %s", exc)
        raise
    finally:
        db.close()

