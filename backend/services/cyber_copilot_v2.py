import logging
import os
import json
from typing import Dict, List, Any, Optional
from .gemini_service import gemini

logger = logging.getLogger(__name__)

# --- Legal Corpus Loading ---
CORPUS_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "legal_corpus.json")

def _load_corpus():
    try:
        if os.path.exists(CORPUS_PATH):
            with open(CORPUS_PATH, 'r') as f:
                return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load legal corpus: {e}")
    return []

LEGAL_DATA = _load_corpus()

_vectorstore = None
_rag_available = False

def init_rag_engine():
    """Initializes the FAISS vector store with legal docs."""
    global _vectorstore, _rag_available
    
    try:
        from langchain_community.vectorstores import FAISS
        from langchain_huggingface import HuggingFaceEmbeddings
        from langchain_core.documents import Document
        
        logger.info("MahaCrimeOS: Loading sentence-transformers embeddings...")
        embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
        documents = [Document(page_content=d["text"], metadata=d["metadata"]) for d in LEGAL_DATA]
        _vectorstore = FAISS.from_documents(documents, embeddings)
        _rag_available = True
        logger.info(f"MahaCrimeOS: Legal RAG Engine initialized with {len(LEGAL_DATA)} sections.")
    except Exception as e:
        logger.warning(f"MahaCrimeOS: RAG engine unavailable ({e}). Using keyword fallback.")
        _rag_available = False

def _keyword_search(query: str, k: int = 3) -> List[Dict]:
    """Keyword fallback when RAG is not available."""
    query_lower = query.lower()
    scored = []
    for d in LEGAL_DATA:
        score = sum(1 for w in query_lower.split() if w in d["text"].lower())
        if score > 0:
            scored.append((score, d))
    scored.sort(reverse=True, key=lambda x: x[0])
    return [item[1] for item in scored[:k]]

from db.database import SessionLocal
from db.models import Entity

def _get_fraud_intelligence(query: str) -> List[Dict[str, str]]:
    """Queries the MARVEL Entity index for known fraud patterns."""
    db = SessionLocal()
    try:
        query_lower = query.lower()
        entities = db.query(Entity).all()
        matches = []
        for e in entities:
            if e.value.lower() in query_lower and len(e.value) > 4:
                matches.append({
                    "type": e.type,
                    "value": e.value,
                    "risk": "High (Verified Fraudulent)"
                })
        return matches[:5]
    finally:
        db.close()

async def query_legal_rag(query: str) -> Dict[str, Any]:
    """
    Performs semantic search over the legal index + Gemini Pro reasoning.
    """
    global _vectorstore, _rag_available
    
    # 1. Legal RAG Search (Context retrieval)
    context_str = ""
    sections = []
    if _rag_available and _vectorstore is not None:
        try:
            results = _vectorstore.similarity_search(query, k=3)
            sections = [
                {"id": r.metadata.get("section"), "title": r.metadata.get("category"), "content": r.page_content, "relevance": "High"}
                for r in results
            ]
            context_str = "\n".join([f"BNS {r.metadata.get('section')}: {r.page_content}" for r in results])
        except Exception:
            results = _keyword_search(query)
            context_str = "\n".join([f"Legal Ref: {d['text']}" for d in results])
    else:
        results = _keyword_search(query)
        context_str = "\n".join([f"Legal Ref: {d['text']}" for d in results])

    # 2. Fraud Intelligence Match
    fraud_matches = _get_fraud_intelligence(query)
    if fraud_matches:
        context_str += f"\n\nKNOWN FRAUD MARKERS: {json.dumps(fraud_matches)}"

    # 3. Gemini Pro Reasoning
    ai_guidance = await gemini.generate_legal_guidance(query, context_str)

    return {
        "answer": ai_guidance.get("answer", "No automated guidance available."),
        "sections": sections,
        "fraud_intelligence": fraud_matches,
        "investigation_steps": ai_guidance.get("investigation_steps", [
            "1. Secure the crime scene and establish a chain of custody for all physical/digital evidence.",
            "2. Identify and record statements of key witnesses under Sec 161 CrPC / Section 180 BNSS."
        ]),
        "legal_draft": ai_guidance.get("legal_draft", None)
    }

async def auto_suggest_sections(fir_text: str) -> List[Dict[str, str]]:
    results = _keyword_search(fir_text, k=2)
    return [
        {"section": d["metadata"]["section"], "reason": f"Matches crime patterns: {d['metadata']['category']}"}
        for d in results
    ]

