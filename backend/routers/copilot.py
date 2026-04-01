"""
copilot.py  —  MahaCrime Copilot  (AI-Lawyer Build)
─────────────────────────────────────────────────────
AI-powered legal & investigative assistant for Maharashtra Police.
All AI responses are at Senior Advocate / Bombay High Court level — detailed,
precise, with section citations, legislative intent, and landmark judgments.

Endpoints
─────────
  POST /api/copilot/analyze-fir          Full FIR analysis (NLP + IPC/BNS + FAISS + AI brief)
  POST /api/copilot/summarize            Deep FIR triage — IPC/BNS + workflow
  POST /api/copilot/query-laws           Expert legal Q&A (Senior Advocate level)
  POST /api/copilot/draft-sections       Court-admissible charge-sheet section language
  POST /api/copilot/suspect-profile      Forensic behavioral offender profile
  POST /api/copilot/interrogation-tips   NHRC-compliant interrogation strategy
  POST /api/copilot/bns-lookup           IPC → BNS 2023 section lookup
  POST /api/copilot/voice-brief          Voice-optimized spoken brief (no JSON, plain dictation text)
  GET  /api/copilot/health               Copilot service health
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Request, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from services.gemini_service import generate
from services.fir_intelligence import analyse_fir

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/copilot", tags=["Investigation Copilot"])


# ─────────────────────────────────────────────────────────────────────────────
# BNS 2023 → IPC cross-reference table
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
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _safe_json(raw: str) -> Optional[Dict]:
    start = raw.find('{')
    end   = raw.rfind('}') + 1
    if start != -1 and end > start:
        try:
            return json.loads(raw[start:end])
        except json.JSONDecodeError:
            pass
    return None


async def _call_llm(prompt: str, endpoint: str) -> str:
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
    enriched = []
    for sec in ipc_sections:
        entry = dict(sec)
        bns_info = _BNS_IPC_MAP.get(sec.get("section", ""))
        if bns_info:
            entry["bns_equivalent"] = bns_info["bns"]
        enriched.append(entry)
    return enriched


# ─────────────────────────────────────────────────────────────────────────────
# Request models
# ─────────────────────────────────────────────────────────────────────────────

class FIRRequest(BaseModel):
    text: str = Field(..., min_length=20)
    fir_number: Optional[str] = None
    save_to_db: bool = True

class SectionDraftRequest(BaseModel):
    crime_type: str
    ipc_sections: List[str]
    incident_summary: str = Field(..., min_length=20)

class SuspectProfileRequest(BaseModel):
    evidence_text: str = Field(..., min_length=30)
    crime_type: Optional[str] = None

class InterrogationRequest(BaseModel):
    crime_type: str
    suspect_profile: Optional[str] = None

class BNSLookupRequest(BaseModel):
    ipc_section: str

class VoiceBriefRequest(BaseModel):
    topic: str = Field(..., min_length=5, description="Legal topic or FIR text to brief on")
    format: str = Field("dictation", description="'dictation' (slow, clear) or 'briefing' (officer-to-officer)")


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 1: Full FIR Analysis
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/analyze-fir")
async def analyze_fir_full(req: FIRRequest):
    intel = await analyse_fir(
        description=req.text,
        fir_number=req.fir_number,
        save_to_db=req.save_to_db,
    )
    intel["ipc_sections"] = _enrich_with_bns(intel.get("ipc_sections", []))

    sections_text = ", ".join(
        f"{s['section']} (BNS: {s.get('bns_equivalent', 'N/A')}) — {s.get('title', '')}"
        for s in intel["ipc_sections"]
    ) or "None identified"

    prompt = f"""You are presenting a legal intelligence brief to the Commissioner of Police, Maharashtra.

This brief must be court-admissible in its precision. Every section cited must include the full section 
title, cognizability, and bail status. Reference applicable landmark judgments.

FIR Text:
{req.text}

Pre-mapped IPC/BNS sections: {sections_text}
Extracted structured entities: {json.dumps(intel['structured_fields'], default=str)}

Produce a comprehensive legal intelligence brief. Respond ONLY in this exact JSON — no markdown:
{{
  "executive_summary": "Precise 4-5 sentence summary covering: nature of offence, parties involved, prima facie evidence, and preliminary legal assessment",
  "primary_offense": "Most serious charge with full section title, cognizability, and bail status",
  "secondary_offenses": ["Secondary charge 1 with section and reasoning", "Secondary charge 2"],
  "urgency": "CRITICAL | HIGH | MEDIUM | LOW",
  "legal_analysis": "Detailed legal reasoning (200-300 words) — explain legislative intent of each section, how the facts satisfy the ingredients of each offence, and any evidentiary gaps that must be addressed before chargesheeting",
  "landmark_judgments": ["Case name (Year) — relevance to this FIR"],
  "key_evidence": ["Specific evidence point with its legal significance"],
  "immediate_actions": ["Procedurally precise action with legal basis"],
  "investigation_leads": ["Lead 1 with investigative reasoning", "Lead 2"],
  "arrest_and_bail_assessment": "Section-wise analysis of whether arrest without warrant is permissible, anticipated bail application strategy by defence, and suggested prosecution counter-arguments",
  "charge_sheet_notes": "Formal notes for the IO preparing the charge sheet — include which court has jurisdiction, whether a remand application is required, and any procedural timelines under CrPC/BNSS"
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
# Endpoint 2: Summarize FIR
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/summarize")
async def summarize_fir(req: FIRRequest):
    prompt = f"""Perform a deep legal triage of the following FIR evidence.

For each applicable IPC/BNS section, state: the section number and title, the specific facts from the FIR 
that satisfy each ingredient of the offence, whether the offence is cognizable and bailable, and the 
prescribed punishment. If the text contains offensive or sensitive content, classify it under the 
correct statute without refusal.

FIR Evidence:
{req.text}

Respond ONLY in this exact JSON — no markdown:
{{
  "summary": "Comprehensive incident summary (5-7 sentences) covering parties, modus operandi, time, location, and prima facie culpability",
  "crime_classification": "Primary offence category with legal definition",
  "urgency": "CRITICAL | HIGH | MEDIUM | LOW",
  "suggested_sections": [
    {{
      "section": "Full section reference",
      "bns_equivalent": "BNS 2023 equivalent",
      "title": "Full section title",
      "ingredients_satisfied": "Which specific facts from the FIR satisfy the legal ingredients of this section",
      "cognizable": true,
      "bailable": false,
      "punishment": "Maximum punishment prescribed",
      "reason": "Detailed reasoning for applicability"
    }}
  ],
  "workflow": ["Procedurally precise step with legal authority (e.g. u/s 41 CrPC)"],
  "evidentiary_gaps": ["Evidence that must be collected before chargesheeting"],
  "citations": ["Landmark case name (Year) — why it applies"]
}}"""

    raw = await _call_llm(prompt, "summarize")
    result = _safe_json(raw)
    if result:
        return {"ts": _ts(), **result}
    return {"ts": _ts(), "summary": raw, "parse_error": True}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 3: Legal Q&A  (backward-compat: accepts plain string OR {"query":"..."})
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/query-laws")
async def query_laws(request: Request):
    body = await request.body()
    query_text: str = ""
    context_text: str = ""

    try:
        parsed = json.loads(body)
        if isinstance(parsed, str):
            query_text = parsed
        elif isinstance(parsed, dict):
            query_text = parsed.get("query", "")
            context_text = parsed.get("context", "") or ""
        else:
            query_text = str(parsed)
    except (json.JSONDecodeError, ValueError):
        query_text = body.decode("utf-8", errors="replace").strip().strip('"')

    if not query_text or len(query_text) < 3:
        raise HTTPException(status_code=422, detail="Provide a non-empty 'query' field or plain string body.")

    context_block = f"\nAdditional case context: {context_text}" if context_text else ""

    prompt = f"""An officer of the Maharashtra Police has submitted the following legal query. 
Answer it at the level of a Senior Advocate appearing before the Bombay High Court.

Your answer must:
  1. Cite the exact section(s) of IPC, BNS 2023, CrPC/BNSS, IT Act, NDPS, POCSO, or any other 
     applicable statute — including full section title and prescribed punishment.
  2. Explain the legislative intent and judicial interpretation of each cited section.
  3. Reference at least one landmark Supreme Court or High Court judgment where applicable.
  4. Identify procedural obligations on the investigating officer (e.g. mandatory FIR u/s 154 CrPC 
     per Lalita Kumari, arrest memo requirements per D.K. Basu).
  5. Flag any defence arguments the accused’s counsel is likely to raise, and suggest how the 
     prosecution can preemptively address them.
  6. Note any inter-section conflicts or overlapping jurisdictions that could affect the charge sheet.
{context_block}

Query: {query_text}

Respond ONLY in this exact JSON:
{{
  "answer": "Comprehensive legal answer (300-500 words) covering all 6 points above",
  "applicable_laws": [
    {{"act": "Act name", "section": "Section number", "title": "Full title", "punishment": "Prescribed punishment", "cognizable": true, "bailable": false}}
  ],
  "landmark_judgments": ["Case name v. Case name (Year) — Court — relevance"],
  "investigation_steps": ["Step 1 with specific legal authority", "Step 2", "Step 3", "Step 4"],
  "defence_arguments": ["Likely defence argument 1", "Argument 2"],
  "prosecution_counter": ["How prosecution addresses argument 1", "Counter 2"],
  "important_caveats": "Critical procedural warnings the IO must not overlook",
  "sources": ["Statute name and edition", "Judgment citation"]
}}"""

    raw = await _call_llm(prompt, "query-laws")
    result = _safe_json(raw)
    if result:
        return {"ts": _ts(), **result}
    return {"ts": _ts(), "answer": raw, "sources": [], "parse_error": True}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 4: Draft Charge-Sheet Language
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/draft-sections")
async def draft_sections(req: SectionDraftRequest):
    bns_notes = []
    for sec in req.ipc_sections:
        bns = _BNS_IPC_MAP.get(sec)
        if bns:
            bns_notes.append(f"{sec} ↔ {bns['bns']} ({bns['title']})")
    bns_block = ("BNS 2023 equivalents:\n" + "\n".join(bns_notes)) if bns_notes else ""

    prompt = f"""You are a Senior Public Prosecutor in Maharashtra drafting a formal charge sheet 
for submission before the Sessions Court / Magistrate.

Crime Type: {req.crime_type}
IPC Sections: {', '.join(req.ipc_sections)}
{bns_block}

Incident Summary:
{req.incident_summary}

Draft requirements:
  - Use formal legal English as used in Indian criminal courts
  - Each charge must state: the section, its full title, the specific acts of the accused that 
    constitute the offence, the prescribed punishment, and whether it is triable by Sessions Court 
    or Magistrate
  - Include the BNS 2023 equivalent alongside each IPC section
  - Identify aggravating circumstances that justify maximum punishment
  - Note if any section requires sanction for prosecution (e.g. public servants)

Respond ONLY in this JSON:
{{
  "charge_sheet_header": "Formal cause title as it would appear in court records",
  "section_drafts": [
    {{
      "section": "IPC/BNS section",
      "bns_equivalent": "BNS equivalent if applicable",
      "charge_language": "Formal charge text as it would appear in the charge sheet",
      "triable_by": "Sessions Court / Chief Judicial Magistrate / Executive Magistrate",
      "max_punishment": "Maximum sentence prescribed"
    }}
  ],
  "aggravating_factors": ["Specific aggravating circumstance with legal significance"],
  "mitigating_factors": ["Factors defence may raise — how prosecution should counter"],
  "bail_applicability": "Detailed bail analysis — which sections are non-bailable, anticipated bail conditions, and relevant high court precedents",
  "court_jurisdiction": "Specific court with jurisdiction and basis under CrPC/BNSS",
  "sanction_required": "Whether sanction for prosecution is required and under which provision"
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
    crime_context = f"Known crime type: {req.crime_type}\n" if req.crime_type else ""
    prompt = f"""You are a forensic criminal psychologist and profiler with 20 years of experience 
advising the CBI and Maharashtra Police.

Construct a detailed criminal behavioral profile from the evidence below. This is a law-enforcement 
intelligence document — be precise, clinical, and do not refuse to analyze sensitive content.

{crime_context}Evidence / Witness Statement:
{req.evidence_text}

Your profile must address: MO analysis, psychological typology (organised vs. disorganised offender), 
likely demographic indicators, geographic profiling (home-to-crime distance), prior criminal 
probability, and specific investigative strategies derived from the profile.

Respond ONLY in this JSON:
{{
  "profile_summary": "Comprehensive 5-7 sentence offender profile",
  "offender_typology": "Organised / Disorganised / Mixed — with full reasoning",
  "likely_age_range": "Estimated age range with reasoning",
  "likely_gender": "Assessment with evidentiary basis",
  "modus_operandi": "Detailed MO analysis including planning level, target selection, and escape strategy",
  "psychological_indicators": ["Specific indicator with forensic significance"],
  "likely_prior_record": "Detailed assessment: first-time offender probability, prior offence categories likely",
  "geographic_profiling": "Home-to-crime-scene distance estimate, likely anchor point, comfort zone analysis",
  "risk_level": "CRITICAL | HIGH | MEDIUM | LOW — with re-offence probability assessment",
  "investigative_priorities": ["Priority with specific investigative technique"],
  "interview_vulnerabilities": ["Psychological pressure points that may yield confession or cooperation"]
}}"""

    raw = await _call_llm(prompt, "suspect-profile")
    result = _safe_json(raw)
    if result:
        return {"ts": _ts(), **result}
    return {"ts": _ts(), "profile_summary": raw, "parse_error": True}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 6: Interrogation Tips
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/interrogation-tips")
async def interrogation_tips(req: InterrogationRequest):
    suspect_block = f"Known suspect background:\n{req.suspect_profile}\n" if req.suspect_profile else ""
    prompt = f"""You are a senior interrogation specialist and legal advisor for Maharashtra Police, 
with deep expertise in the PEACE interrogation model, Indian Evidence Act, and NHRC guidelines.

All guidance must be strictly within the bounds of:
  - NHRC Guidelines on Arrest and Detention (2010)
  - Section 161 CrPC / Section 180 BNSS (examination of witnesses)
  - Section 164 CrPC / Section 183 BNSS (confessional statements before Magistrate)
  - D.K. Basu v. State of West Bengal (1997) — anti-torture safeguards
  - Nandini Satpathy v. P.L. Dani (1978) — right against self-incrimination

Crime Type: {req.crime_type}
{suspect_block}

Respond ONLY in this JSON:
{{
  "approach": "Recommended model (PEACE / Cognitive Interview / Motivational Interviewing) with full justification",
  "legal_framework": "Applicable provisions of CrPC/BNSS governing this interrogation, with section numbers",
  "opening_strategy": "Detailed opening approach — rapport building, baseline establishment, initial framing",
  "key_questions": [
    {{"question": "Full question text", "purpose": "What this question is designed to elicit and why"}}
  ],
  "psychological_tactics": ["Lawful tactic with psychological basis and permissibility under NHRC guidelines"],
  "evidence_strategy": [{{"evidence": "Type of evidence", "when_to_introduce": "Optimal point in interrogation", "expected_effect": "Anticipated psychological impact"}}],
  "red_flags_in_statement": ["Specific inconsistency pattern to watch for with its evidentiary significance"],
  "section_164_trigger": "Conditions under which a Section 164 CrPC confessional statement before a Magistrate should be sought",
  "legal_compliance_notes": "Comprehensive legal safeguards the IO must follow to ensure the statement is admissible and not excluded under Section 25/26 Indian Evidence Act"
}}"""

    raw = await _call_llm(prompt, "interrogation-tips")
    result = _safe_json(raw)
    if result:
        return {"ts": _ts(), "crime_type": req.crime_type, **result}
    return {"ts": _ts(), "crime_type": req.crime_type, "raw": raw, "parse_error": True}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 7: BNS Lookup
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/bns-lookup")
async def bns_lookup(req: BNSLookupRequest):
    local = _BNS_IPC_MAP.get(req.ipc_section)
    if local:
        return {
            "ts": _ts(),
            "ipc_section": req.ipc_section,
            "bns_section": local["bns"],
            "title": local["title"],
            "source": "local_map",
        }

    prompt = f"""Provide a precise, detailed mapping for this IPC to BNS 2023 transition:

{req.ipc_section}

Include: BNS section number, full title, any substantive changes in the definition or punishment, 
whether the BNS version expanded or restricted the scope of the offence, and the effective date.

Respond ONLY in JSON:
{{
  "ipc_section": "{req.ipc_section}",
  "bns_section": "BNS section number",
  "title": "Full section title",
  "key_differences": "Detailed comparison — what changed in definition, punishment, procedure",
  "scope_change": "Expanded / Restricted / Unchanged — with explanation",
  "effective_date": "1 July 2024",
  "transitional_note": "How pending cases under IPC are handled after BNS commencement"
}}"""

    raw = await _call_llm(prompt, "bns-lookup")
    result = _safe_json(raw)
    if result:
        return {"ts": _ts(), "source": "ai", **result}
    return {"ts": _ts(), "ipc_section": req.ipc_section, "raw": raw, "parse_error": True}


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 8: Voice Brief  —  plain text optimised for Text-to-Speech
#
# Returns plain text (not JSON) structured for natural spoken delivery.
# The frontend can pass this directly to Web Speech API / TTS engine.
#
# Two modes:
#   dictation  — slow, deliberate, with natural pauses. Designed for officers
#                writing while listening. Section numbers spelled out clearly.
#   briefing   — faster, officer-to-officer style. Confident, direct.
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/voice-brief", response_class=PlainTextResponse)
async def voice_brief(req: VoiceBriefRequest):
    """
    Returns plain spoken-language text optimised for TTS / Web Speech API.
    No JSON, no markdown, no asterisks — just clean prose for voice playback.

    Frontend usage:
        const res = await fetch('/api/copilot/voice-brief', { method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({topic: firText, format: 'briefing'}) });
        const text = await res.text();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.85;
        window.speechSynthesis.speak(utterance);
    """
    if req.format == "dictation":
        style_instruction = """Write in dictation style:
  - Speak slowly and deliberately, as if dictating to a clerk.
  - Spell out section numbers clearly: say 'Indian Penal Code Section Three Seven Nine' not 'IPC 379'.
  - Use natural pauses: insert a comma after each key phrase.
  - Do NOT use bullet points, asterisks, hyphens, or any symbols.
  - Structure: Introduction sentence. Offence classification. Each applicable section on its own sentence.
    Recommended actions. Closing summary."""
    else:
        style_instruction = """Write in officer briefing style:
  - Confident, direct, officer-to-officer tone. Like a senior IO briefing the SHO.
  - Use standard police abbreviations spoken aloud: 'eye pee cee', 'bee en ess', 'eff eye aar'.
  - Do NOT use bullet points, asterisks, hyphens, or any symbols.
  - Structure: Situation summary. Key charges. Immediate action required. Intel priorities."""

    prompt = f"""You are MahaCrime Copilot delivering a spoken legal brief to a Maharashtra Police officer.

The output will be read aloud by a text-to-speech engine. It must sound completely natural when spoken.

{style_instruction}

Topic / FIR Text:
{req.topic}

IMPORTANT:
  - Output ONLY the spoken text. No JSON, no markdown, no bullet points, no asterisks, no numbering.
  - Every sentence must end with a full stop.
  - Section references must be spelled phonetically: 'Indian Penal Code Section Three Hundred and Two' 
    or 'Bharatiya Nyaya Sanhita Section One Zero One'.
  - Maximum 300 words for briefing mode. Maximum 500 words for dictation mode.
  - Start speaking immediately — no preamble like 'Here is your brief'."""

    raw = await _call_llm(prompt, "voice-brief")

    # Strip any residual JSON/markdown artifacts the LLM may have included
    import re
    clean = re.sub(r'[\*\#\`\{\}\[\]]', '', raw)   # remove markdown symbols
    clean = re.sub(r'\n{3,}', '\n\n', clean)        # collapse excessive newlines
    clean = clean.strip()

    return PlainTextResponse(content=clean, media_type="text/plain; charset=utf-8")


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint 9: Health Check
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/health")
async def copilot_health():
    try:
        result = await generate("Reply with only the word: ONLINE")
        online = "CONNECTION_LOST" not in result and "API_EXHAUSTED" not in result
    except Exception as exc:
        return {"status": "DEGRADED", "ai_engine": "OFFLINE", "error": str(exc), "ts": _ts()}
    return {
        "status": "OK" if online else "DEGRADED",
        "ai_engine": "ONLINE" if online else "OFFLINE",
        "model": "llama-3.3-70b-versatile",
        "endpoints": [
            "analyze-fir", "summarize", "query-laws", "draft-sections",
            "suspect-profile", "interrogation-tips", "bns-lookup", "voice-brief", "health",
        ],
        "ts": _ts(),
    }
