import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

try:
    r = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role":"user","content":"Say OK"}],
        max_tokens=5
    )
    print("SUCCESS:", r.choices[0].message.content)
except Exception as e:
    print("ERROR:", e)
