"""
ner_pipeline.py
───────────────
spaCy NER pipeline for English crime news.
Marathi articles skip NER and rely on keyword matching only
(spaCy has no production Marathi model as of 2026).

Outputs per article:
  - locations, persons, orgs  (spaCy entities)
  - crime_types               (rule-based keyword match — more reliable than NER)
  - severity                  (CRITICAL / WARNING / INFO)
  - zone_id, zone, lat, lon   (mapped via zone_graph)
"""

import logging
import subprocess
import sys
from typing import Dict, List, Optional

from .zone_graph import get_zone_by_keyword, ZONES

logger = logging.getLogger(__name__)

# ── Crime type keyword map ────────────────────────────────────────────────────
CRIME_TYPE_KEYWORDS: Dict[str, List[str]] = {
    "Murder":     ["murder", "killed", "homicide", "body found",
                   "shot dead", "stabbed to death", "dead body", "fatal"],
    "Robbery":    ["robbery", "robbed", "dacoity", "armed robbery",
                   "loot", "looted"],
    "Theft":      ["theft", "stolen", "thief", "pickpocket",
                   "chain snatching", "vehicle theft", "bike theft", "snatching"],
    "Cybercrime": ["cybercrime", "cyber fraud", "online fraud", "digital arrest",
                   "phishing", "hacking", "otp fraud", "vishing"],
    "Drug":       ["drug", "narcotic", "mdma", "cocaine", "heroin",
                   "ganja", "drug trafficking", "mephedrone", "contraband"],
    "Assault":    ["assault", "attack", "beat", "violence",
                   "molestation", "harassment", "acid attack"],
    "Kidnapping": ["kidnap", "abduct", "abduction", "missing person",
                   "trafficking", "ransom"],
    "Fraud":      ["fraud", "cheated", "cheating", "swindled",
                   "forgery", "fake documents", "ponzi", "extortion"],
    "Rape":       ["rape", "sexual assault", "pocso", "sexual abuse"],
    "Shooting":   ["shooting", "gunshot", "opened fire",
                   "gun", "pistol", "firearm", "encounter"],
    "Arrest":     ["arrested", "detained", "nabbed",
                   "caught", "apprehended", "remand", "custody"],
}

_CRITICAL_KW = frozenset([
    "murder", "killed", "rape", "bomb", "blast", "shooting", "terrorist",
    "riot", "dead body", "fatal", "shot dead", "stabbed to death",
    "explosion", "encounter", "massacre",
])
_WARNING_KW = frozenset([
    "robbery", "assault", "kidnap", "drug trafficking", "gang", "dacoity",
    "arrested", "fraud", "cybercrime", "attack", "loot", "abduct",
    "molestation", "acid attack", "trafficking",
])

_nlp = None


def _load_model():
    global _nlp
    if _nlp is not None:
        return _nlp
    try:
        import spacy
        _nlp = spacy.load("en_core_web_md")
        logger.info("spaCy en_core_web_md loaded.")
    except OSError:
        logger.warning("en_core_web_md not found — downloading now...")
        subprocess.run(
            [sys.executable, "-m", "spacy", "download", "en_core_web_md"],
            check=True,
        )
        import spacy
        _nlp = spacy.load("en_core_web_md")
    return _nlp


# ── Public API ────────────────────────────────────────────────────────────────

def extract_crime_types(text: str) -> List[str]:
    t = text.lower()
    return [ct for ct, kws in CRIME_TYPE_KEYWORDS.items()
            if any(kw in t for kw in kws)]


def classify_severity(title: str, description: str = "") -> str:
    text = f"{title} {description}".lower()
    if any(kw in text for kw in _CRITICAL_KW):
        return "CRITICAL"
    if any(kw in text for kw in _WARNING_KW):
        return "WARNING"
    return "INFO"


def extract_entities(text: str) -> Dict:
    """
    Run spaCy NER on text (capped at 5000 chars).
    Returns locations, persons, orgs, crime_types, zone_id, zone, lat, lon.
    """
    nlp = _load_model()
    doc = nlp(text[:5000])

    locations = list(dict.fromkeys(
        e.text for e in doc.ents if e.label_ in ("GPE", "LOC", "FAC")
    ))
    persons = list(dict.fromkeys(
        e.text for e in doc.ents if e.label_ == "PERSON"
    ))
    orgs = list(dict.fromkeys(
        e.text for e in doc.ents if e.label_ == "ORG"
    ))

    # Zone resolution — try each extracted location first
    zone_id: Optional[str] = None
    zone_name: Optional[str] = None
    zone_lat: Optional[float] = None
    zone_lon: Optional[float] = None

    for loc in locations:
        zid = get_zone_by_keyword(loc)
        if zid:
            zone_id   = zid
            zone_name = ZONES[zid]["name"]
            zone_lat  = ZONES[zid]["lat"]
            zone_lon  = ZONES[zid]["lon"]
            break

    # Fallback — scan the raw text directly
    if not zone_id:
        zid = get_zone_by_keyword(text[:500])
        if zid:
            zone_id   = zid
            zone_name = ZONES[zid]["name"]
            zone_lat  = ZONES[zid]["lat"]
            zone_lon  = ZONES[zid]["lon"]

    return {
        "locations":   locations,
        "persons":     persons,
        "orgs":        orgs,
        "crime_types": extract_crime_types(text),
        "zone_id":     zone_id,
        "zone":        zone_name,
        "zone_lat":    zone_lat,
        "zone_lon":    zone_lon,
    }

