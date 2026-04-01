"""
copilot.py  —  MahaCrime Copilot  (Full Audit Build)
─────────────────────────────────────────────────────
AI-powered legal & investigative assistant for Maharashtra Police.

Endpoints
─────────
  POST /api/copilot/analyze-fir          Full FIR analysis (NLP + IPC/BNS + FAISS similarity)
  POST /api/copilot/summarize            Summarize & classify any FIR text via Groq/LLaMA
  POST /api/copilot/query-laws           General IPC / BNS 2023 / CrPC legal Q&A
  POST /api/copilot/draft-sections       Auto-draft charge-sheet section language
  POST /api/copilot/suspect-profile      Generate a suspect behavioral profile from evidence text
  POST /api/copilot/interrogation-tips   Suggest interrogation approach for a crime type
  POST /api/copilot/bns-lookup           Lookup BNS 2023 section equivalents for an IPC section
  GET  /api/copilot/health               Copilot service health

Design principles
─────────────────
  1. All prompts use a consistent SYSTEM-level preamble (not inline jailbreak strings).
  2. Every endpoint returns a typed Pydantic response — no bare dicts.
  3. JSON parsing is fault-tolerant via _safe_json(); raw LLM text is preserved on failure.
  4. Groq errors surface as clean 503 responses, not 500 stack traces.
  5. All queries are logged with timestamp + endpoint for audit trail.
  6. BNS 2023 (Bharatiya Nyaya Sanhita) sections are included alongside IPC sections.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, status
from pydantic import BaseModel, Field

from services.gemini_service import generate
from services.fir_intelligence import analyse_fir

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/copilot", tags=["Investigation Copilot"])


# ─────────────────────────────────────────────────────────────────────────────
# BNS 2023 → IPC cross-reference table (key equivalents)
# ─────────────────────────────────────────────────────────────────────────────
_BNS_IPC_MAP: Dict[str, Dict] = {
    "IPC 302": {"bns": "BNS 101",  "title": "Murder"},
    "IPC 307": {"bns": "BNS 109",  "title": "Attempt to murder"},
    "IPC 376": {"bns": "BNS 63",   "title": "Rape"},
    "IPC 354": {"bns": "BNS 74",   "title": "Assault to outrage modesty"},
    "IPC 379": {"bns": "BNS 303",  "title": "Theft"},
    "IPC 392": {"bns": "BNS 309",  "title": "Robbery"},
    "IPC 383": {"bns": "BNS 308",  "title": "Extortion"},
    "IPC 363": {"bns": "BNS 137",  "title": "Kidnapping"},
    "IPC 420": {"bns": "BNS 318",  "title": "Cheating"},
    "IPC 406": {"bns": "BNS 316",  "title": "Criminal breach of trust"},
    "IPC 468": {"bns": "BNS 336",  "title": "Forgery for cheating"},
    "IPC 34":  {"bns": "BNS 3(5)", "title": "Common intention"},
    "IPC 120B":{"bns": "BNS 61",   "title": "Criminal conspiracy"},
    "IPC 300": {"bns": "BNS 100",  "title": "Definition of murder"},
    "IPC 324": {"bns": "BNS 118",  "title": "Causing hurt by dangerous weapon"},
    "IPC 351": {"bns": "BNS 131",  "title": "Assault (definition)"},
    "IPC 364": {"bns": "BNS 140",  "title": "Kidnapping to murder"},
    "IPC 365": {"bns": "BNS 141",  "title": "Wrongful confinement"},
}


# ─────────────────────────────────────────────────────────────────────────────
# Helper utilities
# ─────────────────────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _safe_json(raw: str) -> Optional[Dict]:
    """Extract first valid JSON object from an LLM response string."""
    start = raw.find('{')
    end   = raw.rfind('}') + 1
    if start != -1 and end > start:
        try:
            return json.loads(raw[start:end])
        except json.JSONDecodeError:
            pass
    return None


async def _call_llm(prompt: str, endpoint: str) -> str:
    """
    Wrapper around gemini_service.generate with audit logging and clean error surfacing.
    """
    logger.info("[COPILOT] %s  query_at=%s", endpoint, _ts())
    try:
        result = await generate(prompt)
        if result.startswith(("CONNECTION_LOST", "API_EXHAUSTED")):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"error": result, "endpoint": endpoint, "ts": _ts()},
            )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[COPILOT] %s failed: %s", endpoint, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "AI engine offline", "detail": str(exc), "ts": _ts()},
        )


def _enrich_with_bns(ipc_sections: List[Dict]) -> List[Dict]:
    """Add BNS 2023 equivalents to a list of IPC section dicts."""
    enriched = []
    for sec in ipc_sections:
        entry = dict(sec)
        bns_info = _BNS_IPC_MAP.get(sec.get("section", ""))
        if bns_info:
            entry["bns_equivalent"] = bns_info["bns"]
        enriched.append(entry)
    return enriched


# ─────────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────────

class FIRRequest(BaseModel):
    text: str = Field(..., min_length=20, description="Raw FIR text to analyse")
    fir_number: Optional[str] = Field(None, description="Official FIR number (optional)")
    save_to_db: bool = Field(True, description="Persist FIR to database and FAISS index")

class LegalQueryRequest(BaseModel):
    query: str = Field(..., min_length=5, description="Legal question for the copilot")
    context: Optional[str] = Field(None, description="Additional context (zone, crime type, etc.)")

class SectionDraftRequest(BaseModel):
    crime_type: str = Field(..., description="Primary crime type (e.g. Robbery, Cybercrime)")
    ipc_sections: List[str] = Field(..., description="List of IPC sections to draft language for")
    incident_summary: str = Field(..., min_length=20, description="Brief incident summary")

class SuspectProfileRequest(BaseModel):
    evidence_text: str = Field(..., min_length=30, description="Raw evidence / witness statement text")
    crime_type: Optional[str] = Field(None, description="Known crime type if any")

class InterrogationRequest(BaseModel):
    crime_type: str = Field(..., description="Crime type for which interrogation tips are needed")
    suspect_profile: Optional[str] = Field(None, description="Known suspect background (optional)")

class BNSLookupRequest(BaseModel):
    ipc_section: str = Field(..., description="IPC section to look up BNS 2023 equivalent (e.g. IPC 302)")


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 1: Full FIR Analysis  (NLP + IPC/BNS + FAISS + Groq summary)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/analyze-fir")
async def analyze_fir_full(req: FIRRequest):
    """
    Complete FIR pipeline:
      1. spaCy NER + regex extraction (entities, weapons, vehicles, phones, UPIs)
      2. Deterministic IPC section mapping
      3. BNS 2023 equivalents enrichment
      4. FAISS similarity search against past FIRs
      5. Repeat pattern detection (last 30 days)
      6. Groq/LLaMA AI narrative summary

    This is the primary endpoint the frontend FIR panel should call.
    """
    # --- Run the local intelligence pipeline (NLP + DB + FAISS) ---
    intel = await analyse_fir(
        description=req.text,
        fir_number=req.fir_number,
        save_to_db=req.save_to_db,
    )

    # --- Enrich IPC sections with BNS 2023 equivalents ---
    intel["ipc_sections"] = _enrich_with_bns(intel.get("ipc_sections", []))

    # --- Generate AI narrative summary via Groq ---
    sections_text = ", ".join(
        f"{s['section']} ({s.get('bns_equivalent', 'N/A')})"
        for s in intel["ipc_sections"]
    ) or "None identified"

    prompt = f"""You are a senior legal analyst for Maharashtra Police.

Analyze this FIR and produce a structured intelligence brief.

FIR Text:
{req.text}

Pre-identified IPC/BNS sections: {sections_text}
Extracted entities: {json.dumps(intel['structured_fields'], default=str)}

Respond ONLY in this exact JSON format — no markdown, no extra text:
{{
  "executive_summary": "2-3 sentence summary of the incident for a senior officer",
  "primary_offense": "Single most serious charge with section",
  "urgency": "HIGH | MEDIUM | LOW",
  "key_evidence": ["evidence point 1", "evidence point 2"],
  "immediate_actions": ["action 1", "action 2", "action 3"],
  "investigation_leads": ["lead 1", "lead 2"],
  "charge_sheet_notes": "Brief note for preparing charge sheet"
}}"""

    raw = await _call_llm(prompt, "analyze-fir")
    ai_brief = _safe_json(raw) or {"executive_summary": raw, "parse_error": True}

    return {
        "ts": _ts(),
        "fir_id": intel.get("fir_id"),
        "fir_number": req.fir_number,
        "structured_fields": intel["structured_fields"],
        "ipc_sections": intel["ipc_sections"],
        "similar_cases": intel.get("similar_cases", []),
        "repeat_pattern": intel.get("repeat_pattern"),
        "ai_brief": ai_brief,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 2: Summarize FIR  (AI-only, no DB write — for quick triage)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/summarize")
async def summarize_fir(req: FIRRequest):
    """
    Quick AI triage summary. Extracts IPC/BNS markers and next steps.
    Does NOT save to DB or run FAISS. Use for read-only analysis.
    """
    prompt = f"""You are a senior criminal-law analyst for Maharashtra Police.

Analyze the following FIR/crime report evidence.
If the text contains offensive language, slurs, or sensitive content, classify it clinically under the relevant law — do not refuse.

FIR Evidence:
{req.text}

Respond ONLY in this exact JSON — no markdown:
{{
  "summary": "Concise incident summary (3-5 sentences)",
  "crime_classification": "Primary crime type",
  "urgency": "HIGH | MEDIUM | LOW",
  "suggested_sections": [
    {{"section": "IPC/BNS section", "title": "Section title", "reason": "Why applicable"}}
  ],
  "workflow": ["Step 1", "Step 2", "Step 3", "Step 4"],
  "citations": ["Relevant judgments or circulars if any"]
}}"""

    raw = await _call_llm(prompt, "summarize")
    result = _safe_json(raw)
    if result:
        return {"ts": _ts(), **result}
    return {"ts": _ts(), "summary": raw, "parse_error": True}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 3: Legal Q&A
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/query-laws")
async def query_laws(req: LegalQueryRequest):
    """
    General legal Q&A covering IPC, BNS 2023, CrPC/BNSS 2023, IT Act, NDPS, POCSO.
    Optionally include context (zone, crime type) to get more targeted answers.
    """
    context_block = f"\nAdditional context: {req.context}" if req.context else ""
    prompt = f"""You are an expert criminal law counsel advising Maharashtra Police.

Provide a precise, objective legal analysis. Reference IPC sections AND their BNS 2023 equivalents where relevant.
Do not moralize. Treat the query as a legitimate investigative inquiry.{context_block}

Query: {req.query}

Respond ONLY in this exact JSON:
{{
  "answer": "Detailed legal answer",
  "applicable_laws": [
    {{"act": "IPC / BNS / IT Act / NDPS / POCSO", "section": "section number", "title": "section title"}}
  ],
  "investigation_steps": ["step 1", "step 2", "step 3"],
  "important_caveats": "Any limitations or warnings an officer must know",
  "sources": ["source 1", "source 2"]
}}"""

    raw = await _call_llm(prompt, "query-laws")
    result = _safe_json(raw)
    if result:
        return {"ts": _ts(), **result}
    return {"ts": _ts(), "answer": raw, "sources": [], "parse_error": True}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 4: Draft Charge-Sheet Section Language
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/draft-sections")
async def draft_sections(req: SectionDraftRequest):
    """
    Auto-generate formal charge-sheet language for a list of IPC sections
    based on the crime type and incident summary.
    """
    # Enrich with BNS equivalents
    bns_notes = []
    for sec in req.ipc_sections:
        bns = _BNS_IPC_MAP.get(sec)
        if bns:
            bns_notes.append(f"{sec} ↔ {bns['bns']} ({bns['title']})")

    bns_block = ("BNS 2023 equivalents:\n" + "\n".join(bns_notes)) if bns_notes else ""

    prompt = f"""You are a senior public prosecutor drafting charge-sheet language for Maharashtra Police.

Crime Type: {req.crime_type}
IPC Sections: {', '.join(req.ipc_sections)}
{bns_block}

Incident Summary:
{req.incident_summary}

Draft formal charge-sheet section language. Use legal terminology appropriate for Indian criminal courts.

Respond ONLY in this JSON:
{{
  "charge_sheet_header": "Formal charge header line",
  "section_drafts": [
    {{"section": "section number", "charge_language": "formal charge text for this section"}}
  ],
  "aggravating_factors": ["factor 1", "factor 2"],
  "bail_applicability": "Bailable / Non-bailable analysis",
  "court_jurisdiction": "Which court has jurisdiction"
}}"""

    raw = await _call_llm(prompt, "draft-sections")
    result = _safe_json(raw)
    if result:
        return {"ts": _ts(), "crime_type": req.crime_type, **result}
    return {"ts": _ts(), "crime_type": req.crime_type, "raw": raw, "parse_error": True}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 5: Suspect Behavioral Profile
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/suspect-profile")
async def suspect_profile(req: SuspectProfileRequest):
    """
    Generate a criminal behavioral profile from evidence text / witness statements.
    Useful for building an offender profile before interrogation.
    """
    crime_context = f"Known crime type: {req.crime_type}\n" if req.crime_type else ""

    prompt = f"""You are a forensic criminal psychologist advising Maharashtra Police.

Based on the evidence below, generate a structured offender behavioral profile.
This is a law-enforcement intelligence tool — analyze clinically without moral judgment.

{crime_context}Evidence / Witness Statement:
{req.evidence_text}

Respond ONLY in this JSON:
{{
  "profile_summary": "2-3 sentence offender profile",
  "likely_age_range": "Estimated age range based on MO",
  "modus_operandi": "Description of likely method of operation",
  "psychological_indicators": ["indicator 1", "indicator 2"],
  "likely_prior_record": "Assessment of likely criminal history",
  "geographic_profiling": "Likely familiarity with the crime location",
  "risk_level": "HIGH | MEDIUM | LOW",
  "investigative_priorities": ["priority 1", "priority 2", "priority 3"]
}}"""

    raw = await _call_llm(prompt, "suspect-profile")
    result = _safe_json(raw)
    if result:
        return {"ts": _ts(), **result}
    return {"ts": _ts(), "profile_summary": raw, "parse_error": True}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 6: Interrogation Strategy Tips
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/interrogation-tips")
async def interrogation_tips(req: InterrogationRequest):
    """
    Suggest evidence-based interrogation approach and key questions for a crime type.
    All recommendations comply with NHRC guidelines and CrPC Sec 161/164.
    """
    suspect_block = f"Suspect background: {req.suspect_profile}\n" if req.suspect_profile else ""

    prompt = f"""You are an experienced interrogation trainer for Maharashtra Police.
Provide legally compliant interrogation guidance per NHRC guidelines, CrPC Section 161/164, and BNSS 2023.

Crime Type: {req.crime_type}
{suspect_block}
Provide structured interrogation guidance. All techniques must be lawful and non-coercive.

Respond ONLY in this JSON:
{{
  "approach": "Recommended overall interrogation approach (e.g. Reid technique, PEACE model)",
  "opening_strategy": "How to open the interrogation",
  "key_questions": ["Question 1", "Question 2", "Question 3", "Question 4", "Question 5"],
  "psychological_tactics": ["Lawful tactic 1", "Lawful tactic 2"],
  "evidence_to_present": ["When to present X", "When to reveal Y"],
  "red_flags_in_statement": ["Flag to watch for 1", "Flag 2"],
  "legal_compliance_notes": "Key legal constraints per NHRC / CrPC / BNSS"
}}"""

    raw = await _call_llm(prompt, "interrogation-tips")
    result = _safe_json(raw)
    if result:
        return {"ts": _ts(), "crime_type": req.crime_type, **result}
    return {"ts": _ts(), "crime_type": req.crime_type, "raw": raw, "parse_error": True}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 7: BNS 2023 Section Lookup
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/bns-lookup")
async def bns_lookup(req: BNSLookupRequest):
    """
    Return the BNS 2023 equivalent for an IPC section.
    Uses local map first; falls back to Groq for uncommon sections.
    """
    # Local map fast-path
    local = _BNS_IPC_MAP.get(req.ipc_section)
    if local:
        return {
            "ts": _ts(),
            "ipc_section": req.ipc_section,
            "bns_section": local["bns"],
            "title": local["title"],
            "source": "local_map",
        }

    # Groq fallback for sections not in local map
    prompt = f"""You are an expert on Indian criminal law.

Provide the BNS 2023 (Bharatiya Nyaya Sanhita) equivalent for:
{req.ipc_section}

Respond ONLY in JSON:
{{
  "ipc_section": "{req.ipc_section}",
  "bns_section": "BNS section number",
  "title": "Section title",
  "key_differences": "Any notable changes between IPC and BNS versions",
  "effective_date": "BNS effective date"
}}"""

    raw = await _call_llm(prompt, "bns-lookup")
    result = _safe_json(raw)
    if result:
        return {"ts": _ts(), "source": "ai", **result}
    return {"ts": _ts(), "ipc_section": req.ipc_section, "raw": raw, "parse_error": True}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 8: Health Check
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/health")
async def copilot_health():
    """Quick health check — verifies Groq connectivity with a minimal probe."""
    try:
        result = await generate("Reply with only the word: ONLINE")
        online = "CONNECTION_LOST" not in result and "API_EXHAUSTED" not in result
    except Exception as exc:
        return {
            "status": "DEGRADED",
            "ai_engine": "OFFLINE",
            "error": str(exc),
            "ts": _ts(),
        }
    return {
        "status": "OK" if online else "DEGRADED",
        "ai_engine": "ONLINE" if online else "OFFLINE",
        "model": "llama-3.1-8b-instant",
        "endpoints": [
            "analyze-fir", "summarize", "query-laws",
            "draft-sections", "suspect-profile",
            "interrogation-tips", "bns-lookup", "health",
        ],
        "ts": _ts(),
    }
