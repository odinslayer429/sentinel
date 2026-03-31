from fastapi import APIRouter, File, UploadFile, HTTPException, Body
from pydantic import BaseModel
from typing import List, Optional
import json
import io
import pdfplumber
from services.gemini_service import gemini

router = APIRouter(prefix="/api/fir", tags=["fir"])

class FIRExtraction(BaseModel):
    id: Optional[str] = "FIR-2026-X01"
    accused_name: str
    location: str
    crime_type: str
    date_time: str
    description_summary: str
    suggested_ipc_sections: List[str]

@router.post("/analyze", response_model=FIRExtraction)
async def analyze_fir(text: str = Body(..., embed=True)):
    return await _perform_analysis(text)

@router.post("/analyze-pdf", response_model=FIRExtraction)
async def analyze_pdf(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    try:
        content = await file.read()
        extracted_text = ""
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    extracted_text += text + "\n"
        
        if not extracted_text.strip():
            raise HTTPException(status_code=400, detail="Could not extract text from PDF. Scanned images are not supported.")
            
        result = await _perform_analysis(extracted_text)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF processing failed: {str(e)}")

async def _perform_analysis(text: str):
    if not text:
        raise HTTPException(status_code=400, detail="Text input required for analysis.")
    
    prompt = f"""
    Analyze the following police complaint / FIR text and extract structured information for a Digital Police Station system (MahaCrimeOS).
    
    Complaint Text:
    {text}
    
    Return a strictly valid JSON object with the following keys and NO other text:
    - accused_name (use "UNKNOWN" if not mentioned)
    - location (closest Mumbai zone/area)
    - crime_type (standard category like THEFT, ASSAULT, FRAUD, etc.)
    - date_time (extracted or estimated)
    - description_summary (max 2 sentences)
    - suggested_ipc_sections (list of relevant IPC/BNS sections based on the crime)
    """
    
    try:
        raw_response = await gemini.generate(prompt)
        start = raw_response.find('{')
        end = raw_response.rfind('}') + 1
        return json.loads(raw_response[start:end])
    except Exception as e:
        # Fallback to a mock extraction if AI fails
        return {
            "accused_name": "MANUAL_REVIEW_REQUIRED",
            "location": "MUMBAI_METRO",
            "crime_type": "GENERAL_INCIDENT",
            "date_time": "RECENT",
            "description_summary": "Extraction failed. Manual entry required.",
            "suggested_ipc_sections": ["MANUAL"]
        }

@router.post("/chargesheet")
async def generate_chargesheet(case_data: dict = Body(...)):
    prompt = f"""
    You are a legal expert for MahaCrimeOS. Generate a formal charge sheet draft based on this case data:
    {json.dumps(case_data)}
    
    Include:
    1. Case Summary
    2. List of Accused
    3. Detailed IPC/BNS Sections
    4. Evidence Summary
    5. Investigation Conclusion
    
    Return the draft in professional legal formatting.
    """
    try:
        response = await gemini.generate(prompt)
        return {"draft": response}
    except Exception as e:
        return {"draft": "Error generating legal draft."}

