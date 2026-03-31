"""
zone_graph.py
─────────────
Single source of truth for all Mumbai Police zone data.
Every other module imports ZONES and ZONE_GRAPH from here.
"""

import math
from typing import Dict, List, Optional, Tuple
import networkx as nx


ZONES: Dict[str, Dict] = {
    "Z01": {
        "name": "Colaba-Cuffe Parade", "short": "Colaba",
        "lat": 18.9067, "lon": 72.8147,
        "stations": ["Colaba", "Cuffe Parade", "Nariman Point"],
        "keywords": [
            "colaba", "cuffe parade", "nariman point", "churchgate",
            "fort", "cst", "victoria terminus", "ballard estate",
            "mantralaya", "gateway of india",
        ],
    },
    "Z02": {
        "name": "Azad Maidan-Byculla", "short": "Azad Maidan",
        "lat": 18.9638, "lon": 72.8395,
        "stations": ["Marine Lines", "Grant Road", "Byculla", "Nagpada", "Dongri"],
        "keywords": [
            "azad maidan", "marine lines", "grant road", "byculla",
            "dongri", "nagpada", "crawford market", "chor bazaar",
            "bhendi bazaar", "pydhonie",
        ],
    },
    "Z03": {
        "name": "Worli-Lower Parel", "short": "Worli",
        "lat": 19.0126, "lon": 72.8156,
        "stations": ["Worli", "Lower Parel", "Prabhadevi", "Sewri"],
        "keywords": [
            "worli", "lower parel", "prabhadevi", "sewri",
            "lalbaug", "currey road", "century mills", "atria",
        ],
    },
    "Z04": {
        "name": "Dadar-Matunga", "short": "Dadar",
        "lat": 19.0178, "lon": 72.8478,
        "stations": ["Dadar", "Matunga", "Shivaji Park"],
        "keywords": [
            "dadar", "matunga", "shivaji park", "dadar west",
            "dadar east", "naigaon", "hindmata",
        ],
    },
    "Z05": {
        "name": "Dharavi-Sion", "short": "Dharavi",
        "lat": 19.0396, "lon": 72.8528,
        "stations": ["Dharavi", "Sion", "Parel"],
        "keywords": [
            "dharavi", "sion", "parel", "deonar",
            "antop hill", "mahim",
        ],
    },
    "Z06": {
        "name": "Bandra-Khar", "short": "Bandra",
        "lat": 19.0596, "lon": 72.8395,
        "stations": ["Bandra", "Khar", "Santacruz West"],
        "keywords": [
            "bandra", "khar", "bandra west", "bandra east",
            "bandra kurla complex", "bkc", "kalina",
        ],
    },
    "Z07": {
        "name": "Santacruz-Vile Parle", "short": "Santacruz",
        "lat": 19.0835, "lon": 72.8496,
        "stations": ["Santacruz", "Vile Parle", "Juhu", "Versova"],
        "keywords": [
            "santacruz", "vile parle", "juhu", "versova",
            "vile parle west", "vile parle east", "vakola",
        ],
    },
    "Z08": {
        "name": "Andheri-Jogeshwari", "short": "Andheri",
        "lat": 19.1197, "lon": 72.8468,
        "stations": ["Andheri", "Jogeshwari", "DN Nagar", "Oshiwara"],
        "keywords": [
            "andheri", "jogeshwari", "dn nagar", "oshiwara",
            "andheri east", "andheri west", "lokhandwala", "seepz",
        ],
    },
    "Z09": {
        "name": "Malad-Goregaon", "short": "Malad",
        "lat": 19.1726, "lon": 72.8497,
        "stations": ["Malad", "Goregaon", "Mindspace"],
        "keywords": [
            "malad", "goregaon", "malad east", "malad west",
            "goregaon east", "goregaon west", "film city", "aarey",
            "mindspace", "inorbit", "marve",
        ],
    },
    "Z10": {
        "name": "Kandivali-Dahisar", "short": "Kandivali",
        "lat": 19.1390, "lon": 72.8490,
        "stations": ["Kandivali", "Dahisar", "Poisar"],
        "keywords": [
            "kandivali", "dahisar", "kandivali east", "kandivali west",
            "dahisar east", "dahisar west", "thakur village",
            "dahisar check naka", "poisar",
        ],
    },
    "Z11": {
        "name": "Borivali Zone", "short": "Borivali",
        "lat": 19.2294, "lon": 72.8567,
        "stations": ["Borivali", "Eksar"],
        "keywords": [
            "borivali", "borivali east", "borivali west",
            "eksar", "ic colony",
        ],
    },
    "Z12": {
        "name": "Mira Road-Bhayandar", "short": "Mira Road",
        "lat": 19.2871, "lon": 72.8688,
        "stations": ["Mira Road", "Bhayandar", "Kashimira"],
        "keywords": ["mira road", "bhayandar", "kashimira", "mira bhayandar"],
    },
    "Z13": {
        "name": "Vasai-Nalasopara", "short": "Vasai",
        "lat": 19.3767, "lon": 72.8261,
        "stations": ["Vasai", "Nalasopara"],
        "keywords": ["vasai", "vasai east", "vasai west", "nalasopara", "arnala"],
    },
    "Z14": {
        "name": "Virar Zone", "short": "Virar",
        "lat": 19.4623, "lon": 72.8063,
        "stations": ["Virar", "Vaitarna"],
        "keywords": ["virar", "virar east", "virar west", "vaitarna"],
    },
    "Z15": {
        "name": "Powai-Hiranandani", "short": "Powai",
        "lat": 19.1180, "lon": 72.9060,
        "stations": ["Powai", "Sakinaka", "Chandivali"],
        "keywords": [
            "powai", "sakinaka", "chandivali", "hiranandani",
            "iit bombay", "marol", "saki naka",
        ],
    },
    "Z16": {
        "name": "Kurla-Chembur", "short": "Kurla",
        "lat": 19.0724, "lon": 72.8796,
        "stations": ["Kurla", "Chembur", "Chunabhatti"],
        "keywords": [
            "kurla", "chembur", "chunabhatti", "tilaknagar",
            "kurla east", "kurla west", "vidyavihar",
        ],
    },
    "Z17": {
        "name": "Govandi-Mankhurd", "short": "Govandi",
        "lat": 19.0437, "lon": 72.9279,
        "stations": ["Govandi", "Mankhurd", "Trombay"],
        "keywords": [
            "govandi", "mankhurd", "trombay", "deonar",
            "shivaji nagar", "cheeta camp",
        ],
    },
    "Z18": {
        "name": "Ghatkopar-Vikhroli", "short": "Ghatkopar",
        "lat": 19.0867, "lon": 72.9081,
        "stations": ["Ghatkopar", "Vikhroli", "Asalpha"],
        "keywords": [
            "ghatkopar", "vikhroli", "asalpha", "godrej",
            "ghatkopar east", "ghatkopar west",
        ],
    },
    "Z19": {
        "name": "Bhandup-Kanjurmarg", "short": "Bhandup",
        "lat": 19.1580, "lon": 72.9340,
        "stations": ["Bhandup", "Kanjurmarg"],
        "keywords": ["bhandup", "kanjurmarg", "bhandup west", "bhandup east", "nahur"],
    },
    "Z20": {
        "name": "Mulund Zone", "short": "Mulund",
        "lat": 19.1726, "lon": 72.9563,
        "stations": ["Mulund", "Nahur"],
        "keywords": ["mulund", "nahur", "mulund east", "mulund west", "mulund colony"],
    },
    "Z21": {
        "name": "Thane City", "short": "Thane",
        "lat": 19.2183, "lon": 72.9781,
        "stations": ["Thane", "Kalwa", "Mumbra"],
        "keywords": ["thane", "kalwa", "mumbra", "kopri", "naupada", "thane west"],
    },
    "Z22": {
        "name": "Navi Mumbai-Vashi", "short": "Vashi",
        "lat": 19.0760, "lon": 72.9980,
        "stations": ["Vashi", "Nerul", "Belapur", "Airoli"],
        "keywords": [
            "navi mumbai", "vashi", "nerul", "belapur", "airoli",
            "ghansoli", "koparkhairane", "turbhe", "sanpada",
        ],
    },
    "Z23": {
        "name": "Kharghar-Panvel", "short": "Panvel",
        "lat": 18.9894, "lon": 73.1175,
        "stations": ["Kharghar", "Panvel", "Kamothe"],
        "keywords": [
            "kharghar", "panvel", "kamothe", "ulwe",
            "kalamboli", "new panvel",
        ],
    },
    "Z24": {
        "name": "Kalyan-Dombivli", "short": "Kalyan",
        "lat": 19.2403, "lon": 73.1305,
        "stations": ["Kalyan", "Dombivli", "Ambernath", "Badlapur"],
        "keywords": [
            "kalyan", "dombivli", "ambernath", "badlapur",
            "kalyan east", "kalyan west", "dombivli east", "dombivli west",
            "ulhasnagar",
        ],
    },
}


_EDGES: List[Tuple[str, str]] = [
    ("Z01", "Z02"), ("Z02", "Z03"), ("Z03", "Z04"), ("Z03", "Z05"),
    ("Z04", "Z05"), ("Z04", "Z06"), ("Z05", "Z06"), ("Z06", "Z07"),
    ("Z07", "Z08"), ("Z07", "Z15"), ("Z08", "Z09"), ("Z08", "Z10"),
    ("Z09", "Z10"), ("Z09", "Z11"), ("Z10", "Z11"), ("Z11", "Z12"),
    ("Z12", "Z13"), ("Z13", "Z14"), ("Z15", "Z16"), ("Z15", "Z18"),
    ("Z16", "Z17"), ("Z16", "Z18"), ("Z17", "Z22"), ("Z18", "Z19"),
    ("Z18", "Z20"), ("Z19", "Z20"), ("Z20", "Z21"), ("Z21", "Z24"),
    ("Z22", "Z23"), ("Z23", "Z24"),
]


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def build_zone_graph() -> nx.Graph:
    G = nx.Graph()
    for zid, zdata in ZONES.items():
        G.add_node(zid, **{k: v for k, v in zdata.items() if k != "keywords"})
    for a, b in _EDGES:
        dist = _haversine(
            ZONES[a]["lat"], ZONES[a]["lon"],
            ZONES[b]["lat"], ZONES[b]["lon"],
        )
        G.add_edge(a, b, weight=round(1.0 / max(dist, 0.1), 4), distance_km=round(dist, 2))
    return G


ZONE_GRAPH: nx.Graph = build_zone_graph()


def get_neighbors(zone_id: str) -> List[str]:
    return list(ZONE_GRAPH.neighbors(zone_id))


def get_edge_weight(zone_a: str, zone_b: str) -> float:
    if ZONE_GRAPH.has_edge(zone_a, zone_b):
        return ZONE_GRAPH[zone_a][zone_b]["weight"]
    return 0.0


def get_zone_by_keyword(text: str) -> Optional[str]:
    """Longest keyword match wins. Returns zone_id or None."""
    text_lower = text.lower()
    best_zone: Optional[str] = None
    best_len = 0
    for zid, zdata in ZONES.items():
        for kw in zdata["keywords"]:
            if kw in text_lower and len(kw) > best_len:
                best_zone = zid
                best_len = len(kw)
    return best_zone


def zone_ids() -> List[str]:
    return sorted(ZONES.keys())


def zone_summary() -> List[Dict]:
    return [
        {"id": zid, "name": z["name"], "short": z["short"],
         "lat": z["lat"], "lon": z["lon"]}
        for zid, z in ZONES.items()
    ]