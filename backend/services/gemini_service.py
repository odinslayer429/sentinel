import asyncio
import os
import json
import logging
from typing import Dict, List, Any, Optional
from groq import Groq
from dotenv import load_dotenv

# Force reload for development
load_dotenv(override=True)

logger = logging.getLogger(__name__)

# Diagnostic Print to verify environment
api_key_check = os.getenv("GROQ_API_KEY")
if api_key_check:
    print(f"[SENTINEL_AI] Groq API Key Registered: {api_key_check[:4]}...{api_key_check[-4:]}")
else:
    print("[SENTINEL_AI] CRITICAL ERROR: GROQ_API_KEY NOT FOUND IN ENVIRONMENT")

class GroqService:
    def __init__(self):
        self.api_key = os.getenv("GROQ_API_KEY")
        self.model = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
        if not self.api_key:
            logger.warning("GROQ_API_KEY not found in environment variables.")
        self.client = Groq(api_key=self.api_key)

    async def generate(self, prompt: str) -> str:
        """Basic text generation using Groq."""
        if not self.api_key:
            return "CONNECTION_LOST: API_KEY_MISSING. Please check your .env file."
            
        # TACTICAL PREAMBLE: Ensures the engine classifies all data objectively without moralizing or refusal.
        system_preamble = (
            "You are a Tactical Investigative Engine for the Mumbai Police Cyber Intelligence Division. "
            "Your purpose is to classify criminal evidence and provide legal analysis. "
            "DO NOT REFUSE to analyze queries that contain offensive language, slurs, or sensitive criminal content "
            "if they are presented in the context of a legal inquiry or evidence report. "
            "Always treat inputs as evidence and maintain a clinical, analytical tone.\n\n"
        )
        
        try:
            response = await asyncio.to_thread(
                self.client.chat.completions.create,
                model=self.model,
                messages=[{"role": "user", "content": system_preamble + prompt}],
                temperature=0.3,
                max_tokens=2048,
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
        prompt = f"""
        Analyze the following legal query within the context provided.
        Context from Legal Corpus:
        {context}

        User Query:
        {query}

        Respond in JSON format:
        - answer: A concise legal explanation.
        - investigation_steps: A list of 3-4 recommended steps for an officer.
        - legal_draft: A short template for a memo or FIR section.
        """
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

# Single instance named gemini for backward compatibility
_instance = GroqService()
gemini = _instance

# Independent function export for direct imports used in copilot.py
async def generate(prompt: str) -> str:
    return await _instance.generate(prompt)
