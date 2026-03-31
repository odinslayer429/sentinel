import requests
import json

url = "http://localhost:8000/api/fir/analyze-pdf"
files = {'file': ('mock_fir.pdf', open('mock_fir.pdf', 'rb'), 'application/pdf')}
response = requests.post(url, files=files)
print(f"Status: {response.status_code}")
print(json.dumps(response.json(), indent=2))
