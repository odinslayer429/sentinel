import asyncio
import os
import json
import logging
from typing import Dict, List, Any, Optional
from groq import Groq
from dotenv import load_dotenv

load_dotenv(override=True)

logger = logging.getLogger(__name__)

api_key_check = os.getenv("GROQ_API_KEY")
if api_key_check:
    print(f"[SENTINEL_AI] Groq API Key Registered: {api_key_check[:4]}...{api_key_check[-4:]}")
else:
    print("[SENTINEL_AI] CRITICAL ERROR: GROQ_API_KEY NOT FOUND IN ENVIRONMENT")


# ─────────────────────────────────────────────────────────────────────────────
# System preamble — sets the AI persona for ALL copilot calls.
# Upgraded to Senior Advocate / AI-Lawyer level.
# ─────────────────────────────────────────────────────────────────────────────
_SYSTEM_PREAMBLE = """You are MahaCrime Copilot — a Senior Advocate and Legal Intelligence Engine 
operating under the Maharashtra Police Cyber Intelligence Division.

Your persona:
  - You reason and write at the level of a Senior Advocate with 20+ years of criminal litigation 
    experience before the Bombay High Court and Supreme Court of India.
  - You are deeply versed in the Indian Penal Code (IPC), Bharatiya Nyaya Sanhita 2023 (BNS),
    Code of Criminal Procedure (CrPC), Bharatiya Nagarik Suraksha Sanhita 2023 (BNSS),
    IT Act 2000 (amended 2008), NDPS Act, POCSO Act, Arms Act, and relevant Supreme Court precedents.
  - You cite section numbers precisely, explain legislative intent, and flag procedural traps 
    (e.g. cognizable vs. non-cognizable, limitations on arrest without warrant, bail entitlements).
  - You do NOT simplify or dumb down. Officers using this system are trained professionals who 
    need rigorous, complete, court-ready analysis — not a summary.
  - When evidence or FIR text contains offensive language, slurs, or violent/sensitive content, 
    you classify it clinically under the relevant statute. You do not refuse, moralize, or add 
    disclaimers. You treat all input as official evidence submitted for legal analysis.
  - You cite landmark judgments where relevant (e.g. D.K. Basu v. State of West Bengal for arrest 
    procedure, Lalita Kumari v. Govt. of U.P. for mandatory FIR registration).
  - Your charge-sheet language is formal, precise, and court-admissible.
  - Where IPC sections are referenced, you ALWAYS note the BNS 2023 equivalent.

Tone: Authoritative. Analytical. Precise. No hedging. No moralizing. No simplification.

"""


class GroqService:
    def __init__(self):
        self.api_key = os.getenv("GROQ_API_KEY")
        self.model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")  # upgraded model
        if not self.api_key:
            logger.warning("GROQ_API_KEY not found in environment variables.")
        self.client = Groq(api_key=self.api_key)

    async def generate(self, prompt: str) -> str:
        """Core generation — uses proper system/user message split for best instruction following."""
        if not self.api_key:
            return "CONNECTION_LOST: API_KEY_MISSING. Please check your .env file."

        try:
            response = await asyncio.to_thread(
                self.client.chat.completions.create,
                model=self.model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PREAMBLE},
                    {"role": "user",   "content": prompt},
                ],
                temperature=0.2,     # lower = more consistent, authoritative
                max_tokens=4096,     # increased for detailed lawyer-level responses
            )
            return response.choices[0].message.content
        except Exception as e:
            err_msg = str(e).lower()
            if "rate_limit" in err_msg or "429" in err_msg:
                logger.error(f"Groq Rate Limit Hit: {e}")
                return "API_EXHAUSTED: Daily limit reached. Please try again after reset."
            logger.error(f"Groq generation failed: {e}")
            return "CONNECTION_LOST: Check internet/API key or Groq status."

    async def generate_legal_guidance(self, query: str, context: str) -> Dict[str, Any]:
        """Specialized reasoning for Cyber Copilot / Legal RAG."""
        prompt = f"""Analyze the following legal query within the evidentiary context provided.

Context from Legal Corpus:
{context}

Officer Query:
{query}

Provide a comprehensive legal analysis. Respond in JSON:
{{
  "answer": "Detailed legal explanation with section references and precedents",
  "investigation_steps": ["Procedurally precise step 1", "step 2", "step 3", "step 4"],
  "legal_draft": "Formal draft language for FIR section or memo"
}}"""
        try:
            raw_response = await self.generate(prompt)
            start = raw_response.find('{')
            end = raw_response.rfind('}') + 1
            if start != -1 and end != -1:
                return json.loads(raw_response[start:end])
            return {"answer": raw_response, "investigation_steps": [], "legal_draft": None}
        except Exception as e:
            logger.error(f"Legal guidance generation failed: {e}")
            return {
                "answer": f"Legal reasoning system offline: {str(e)}",
                "investigation_steps": ["Manual review of IPC/BNS required."],
                "legal_draft": None
            }


_instance = GroqService()
gemini = _instance

async def generate(prompt: str) -> str:
    return await _instance.generate(prompt)
