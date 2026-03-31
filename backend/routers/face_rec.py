from fastapi import APIRouter, UploadFile, File, Depends
import cv2
import numpy as np
import faiss
from services.ml_models import ml_service
from services.auth import get_current_user

router = APIRouter(prefix="/api/face", tags=["Facial Recognition"])

# Mock FAISS index
d = 512 # ArcFace embedding dimension
index = faiss.IndexFlatIP(d)
dummy_embeddings = np.random.random((10, d)).astype('float32')
faiss.normalize_L2(dummy_embeddings)
index.add(dummy_embeddings)
names = ["Criminal_001", "Suspect_Alpha", "Unknown", "Person_B", "Target_X"] * 2

@router.post("/match")
async def match_face(file: UploadFile = File(...), user=Depends(get_current_user)):
    contents = await file.read()
    # In production: detect_face → encode → search
    detections = ml_service.detect_face(contents)
    
    results = []
    for det in detections:
        # Mock search
        query_vec = np.random.random((1, d)).astype('float32')
        faiss.normalize_L2(query_vec)
        D, I = index.search(query_vec, 1)
        
        confidence = float(D[0][0])
        name = names[I[0][0]] if confidence > 0.75 else "Unknown"
        
        results.append({
            "bbox": det["bbox"],
            "identity": name,
            "confidence": confidence,
            "alert": confidence > 0.75
        })
        
    return {"matches": results}

