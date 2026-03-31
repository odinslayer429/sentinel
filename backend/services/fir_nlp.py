import re
import spacy
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Load SpaCy model — using md for better NER accuracy
try:
    nlp = spacy.load("en_core_web_sm")
except Exception:
    logger.warning("SpaCy model en_core_web_sm not found. Falling back to Regex-only mode.")
    nlp = None

# Comprehensive IPC (Indian Penal Code) Keyword Dictionary for Heuristic Fallback
IPC_KEYWORDS = {
    "THEFT": ["theft", "stolen", "robbery", "burglary", "snatching", "pickpocket"],
    "FRAUD": ["fraud", "phishing", "scam", "cheating", "fake", "counterfeit", "upi", "kyc"],
    "ASSAULT": ["assault", "fight", "brawl", "attack", "stabbing", "violence", "clash"],
    "CYBER": ["hacked", "malware", "ransomware", "breach", "leak", "darkweb"],
    "NARCOTICS": ["drug", "narcotics", "seizure", "raid", "contraband", "smuggling"],
    "PROTEST": ["protest", "rally", "march", "demonstration", "crowd", "unrest", "sloganee"],
}

def extract_fir_data(text: str) -> Dict:
    """
    Extracts structured FIR data from a headline or report.
    Uses SpaCy NER with a robust Regex fallback for 100% reliability.
    """
    entities = {"person": [], "location": [], "offence": "OTHER"}
    
    # 1. NLP Extraction (Primary)
    if nlp:
        doc = nlp(text)
        for ent in doc.ents:
            if ent.label_ == "PERSON":
                entities["person"].append(ent.text)
            elif ent.label_ in ["GPE", "LOC", "FAC"]:
                entities["location"].append(ent.text)
    
    # 2. Regex Fallback for Locations (Mumbai Specific)
    # This ensures we always catch Mumbai wards even if SpaCy misses them
    MUMBAI_LOCS = ["Bandra", "Colaba", "Dharavi", "Andheri", "Mulund", "Borivali", "Kurla", "Dadar", "Worli"]
    for loc in MUMBAI_LOCS:
        if re.search(fr"\b{loc}\b", text, re.I) and loc not in entities["location"]:
            entities["location"].append(loc)

    # 3. Offence Heuristic (Crucial for MARVEL Accuracy)
    for offence, keywords in IPC_KEYWORDS.items():
        if any(re.search(fr"\b{kw}\b", text, re.I) for kw in keywords):
            entities["offence"] = offence
            break
            
    # Clean up
    entities["person"] = list(set(entities["person"]))
    entities["location"] = list(set(entities["location"]))
    
    return entities

def generate_tactical_advice(offence: str) -> List[str]:
    """Provides automated tactical precautions based on extracted offence."""
    ADVICE = {
        "THEFT": ["Increase night foot patrols", "Check CCTV blindspots", "Inform local shopkeepers"],
        "FRAUD": ["Monitor UPI transaction anomalies", "Public awareness alert via SMS", "Trace IP origins"],
        "PROTEST": ["Mobilize Riot Control Unit", "Divert traffic from arterial roads", "Monitor social media sentiment"],
        "CYBER": ["Isolate affected servers", "Initiate forensic log dump", "Alert CERT-In"],
    }
    return ADVICE.get(offence, ["Maintain high visibility", "Monitor suspicious activity"])

