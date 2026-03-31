from fastapi import APIRouter, HTTPException, Body, Depends
from typing import Dict, List, Optional
from pydantic import BaseModel

from services import case_manager, suspect_db, fir_intelligence
from services.auth import get_current_user

router = APIRouter(prefix="/api/investigation", tags=["Investigation"])

class FIRSubmit(BaseModel):
    description: str
    fir_number: Optional[str] = None
    save_to_db: bool = True

class CaseUpdateSubmit(BaseModel):
    update_type: str
    notes: str
    officer_id: str

class SuspectSubmit(BaseModel):
    name: str
    aliases: str = "[]"
    age: Optional[int] = None
    contact_info: Optional[str] = None
    last_known_zone: Optional[str] = None
    crime_types: str = "[]"

@router.post("/fir", dependencies=[Depends(get_current_user)])
async def ingest_fir(payload: FIRSubmit):
    return await fir_intelligence.analyse_fir(
        description=payload.description,
        fir_number=payload.fir_number,
        save_to_db=payload.save_to_db
    )

@router.get("/cases")
def get_all_cases():
    return case_manager.get_all_cases()

@router.get("/cases/{fir_id}")
def get_case_timeline(fir_id: int):
    return case_manager.get_case_timeline(fir_id)

@router.post("/cases/{fir_id}/updates", dependencies=[Depends(get_current_user)])
def add_case_update(fir_id: int, payload: CaseUpdateSubmit):
    success = case_manager.add_case_update(
        fir_id=fir_id,
        update_type=payload.update_type,
        notes=payload.notes,
        officer_id=payload.officer_id
    )
    if not success:
        raise HTTPException(status_code=400, detail="Failed to add update")
    return {"status": "success"}

@router.post("/cases/{fir_id}/status", dependencies=[Depends(get_current_user)])
def update_case_status(fir_id: int, status: str = Body(embed=True), officer_id: str = Body(embed=True), notes: str = Body(default="", embed=True)):
    success = case_manager.update_case_status(fir_id, status, officer_id, notes)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to update status")
    return {"status": "success"}

@router.post("/cases/{fir_id}/assign", dependencies=[Depends(get_current_user)])
def assign_officer(fir_id: int, officer_id: str = Body(embed=True)):
    success = case_manager.assign_officer(fir_id, officer_id)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to assign officer")
    return {"status": "success"}

@router.post("/suspects", dependencies=[Depends(get_current_user)])
def create_suspect(payload: SuspectSubmit):
    s_id = suspect_db.add_suspect(
        name=payload.name, aliases=payload.aliases, age=payload.age,
        contact_info=payload.contact_info, last_known_zone=payload.last_known_zone,
        crime_types=payload.crime_types
    )
    return {"suspect_id": s_id}

@router.post("/cases/{fir_id}/suspects/{suspect_id}", dependencies=[Depends(get_current_user)])
def link_suspect_to_case(fir_id: int, suspect_id: int, role: str = Body(default="Accused", embed=True)):
    success = suspect_db.link_suspect_to_fir(fir_id, suspect_id, role)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to link suspect")
    return {"status": "success"}

@router.get("/suspects/search")
def search_suspects(query: str, zone: Optional[str] = None, crime_type: Optional[str] = None):
    return suspect_db.search_suspects(query, zone, crime_type)

@router.get("/network/{suspect_id}")
def get_suspect_network(suspect_id: int):
    return suspect_db.generate_network_graph(suspect_id)

@router.get("/network")
def get_global_network():
    return suspect_db.generate_network_graph(None)

@router.get("/offenders")
def get_top_offenders(limit: int = 10):
    """Returns top suspects with FIR and Entity counts for the dashboard."""
    return suspect_db.get_top_offenders(limit)

