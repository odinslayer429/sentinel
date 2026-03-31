from dotenv import load_dotenv
from groq import Groq
import os

load_dotenv()
key = os.environ.get('GROQ_API_KEY')
print("Key loaded:", key[:15] if key else "NONE - .env not reading")

client = Groq(api_key=key)
try:
    r = client.chat.completions.create(
        model='llama-3.1-8b-instant',
        messages=[{'role':'user','content':'Say OK'}],
        max_tokens=5
    )
    print('SUCCESS:', r.choices[0].message.content)
except Exception as e:
    print('ERROR:', e)
