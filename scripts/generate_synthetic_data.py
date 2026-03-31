import random
import time
import json
import numpy as np

def generate_mumbai_data():
    data = []
    # Mumbai bounding box
    lat_range = (18.89, 19.30)
    lon_range = (72.77, 72.98)
    crime_types = ["Theft", "Assault", "Harassment", "Drugs", "Gamble"]
    
    for _ in range(100):
        lat = random.uniform(*lat_range)
        lon = random.uniform(*lon_range)
        crime = random.choice(crime_types)
        data.append({
            "lat": lat,
            "lon": lon,
            "type": crime,
            "timestamp": time.time(),
            "ward": f"Ward_{random.randint(1, 24)}"
        })
    return data

def generate_faces():
    return [
        {"id": "CRIM-01", "embedding": np.random.random(512).tolist(), "name": "Chhota Rajan (Mock)"},
        {"id": "CRIM-02", "embedding": np.random.random(512).tolist(), "name": "Dawood Ibrahim (Mock)"}
    ]

if __name__ == "__main__":
    mumbai_crimes = generate_mumbai_data()
    with open("data/mock_crimes.json", "w") as f:
        json.dump(mumbai_crimes, f, indent=2)
    print(f"Generated {len(mumbai_crimes)} mock crimes.")
    
    faces = generate_faces()
    with open("data/mock_faces.json", "w") as f:
        json.dump(faces, f, indent=2)
    print(f"Generated {len(faces)} mock face embeddings.")
