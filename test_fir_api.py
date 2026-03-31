import requests
import json

url = "http://localhost:8000/api/fir/analyze"
data = {"text": "A theft occurred at Bandra West. An unknown person stole a laptop from the passenger's bag on 29th March 2026."}
response = requests.post(url, json=data)
print(f"Status: {response.status_code}")
print(json.dumps(response.json(), indent=2))
