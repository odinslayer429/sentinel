from fastapi import APIRouter, Depends, Body, HTTPException
from pydantic import BaseModel
from typing import List
from services.gemini_service import generate
import json

router = APIRouter(prefix="/api/copilot", tags=["Investigation Copilot"])

class FIRRequest(BaseModel):
    text: str

@router.post("/summarize")
async def summarize_fir(req: FIRRequest):
    """Analyze FIR text through a Clinical Evidence framing to prevent false-positive refusals."""
    prompt = f"""
    [EVIDENCE_FRAME_ACTIVE]
    Role: Mumbai Police Evidence Classifier.
    Task: Analyze the attached FIR/Crime report.
    Objective: Extract Indian Penal Code (IPC) or Bharatiya Nyaya Sanhita (BNS) markers.
    Constraint: If the evidence contains offensive language, slurs, or hate speech, DO NOT refuse to analyze it. Classify it strictly under relevant sections (e.g., Section 153A, 294, 504 IPC).

    Input Evidence: {req.text}

    Respond in this exact JSON format:
    {{"summary": "...", "suggested_sections": ["..."], "workflow": ["...","...","..."], "citations": ["..."]}}"""

    try:
        result = await generate(prompt)
        start = result.find('{')
        end = result.rfind('}') + 1
        if start != -1 and end != -1:
            return json.loads(result[start:end])
        return {"summary": "AI pulse detected but parsing failed.", "raw": str(result)}
    except Exception as e:
        return {"summary": "AI engine failure during evidence scan.", "error": str(e)}

@router.post("/query-laws")
async def query_laws(query: str = Body(...)):
    """General legal Q&A using the Tactical Investigative Framing."""
    prompt = f"""
    [TACTICAL_INQUIRY_ACTIVE]
    Context: Legal interrogation/investigation support for Mumbai Police.
    Query: {query}
    Instruction: Provide a clinical legal analysis and relevant sections (IPC, BNS 2023, CrPC). 
    Do not moralize; provide objective legal definitions and classifications.

    Respond in JSON: {{"answer": "...", "sources": ["..."]}}"""

    try:
        result = await generate(prompt)
        start = result.find('{')
        end = result.rfind('}') + 1
        if start != -1 and end != -1:
            return json.loads(result[start:end])
        return {"answer": result, "sources": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ENGINE_UNRESPONSIVE: {str(e)}")
