import json
import os

def generate_wards():
    # Center coordinates for the 12 Mumbai zones we've been using
    # We'll create simple rectangular/hexagonal polygons around these to simulate wards
    zones = [
        {"id": "Z1", "name": "South Mumbai (Colaba/Fort)", "lat": 18.9218, "lon": 72.8347},
        {"id": "Z2", "name": "Malabar Hill / Tardeo", "lat": 18.9548, "lon": 72.8120},
        {"id": "Z3", "name": "Byculla / Mazgaon", "lat": 18.9750, "lon": 72.8333},
        {"id": "Z4", "name": "Dadar / Parel", "lat": 19.0178, "lon": 72.8478},
        {"id": "Z5", "name": "Worli / Lower Parel", "lat": 19.0000, "lon": 72.8150},
        {"id": "Z6", "name": "Bandra / Khar", "lat": 19.0596, "lon": 72.8295},
        {"id": "Z7", "name": "Andheri / Juhu", "lat": 19.1136, "lon": 72.8697},
        {"id": "Z8", "name": "Borivali / Kandivali", "lat": 19.2307, "lon": 72.8567},
        {"id": "Z9", "name": "Kurla / Ghatkopar", "lat": 19.0728, "lon": 72.9030},
        {"id": "Z10", "name": "Chembur / Govandi", "lat": 19.0622, "lon": 72.9272},
        {"id": "Z11", "name": "Powai / Mulund", "lat": 19.1760, "lon": 72.9520},
        {"id": "Z12", "name": "Dharavi / Matunga", "lat": 19.0380, "lon": 72.8538}
    ]

    features = []
    delta = 0.015 # size of the "ward" box

    for z in zones:
        poly = [
            [z["lon"] - delta, z["lat"] - delta],
            [z["lon"] + delta, z["lat"] - delta],
            [z["lon"] + delta, z["lat"] + delta],
            [z["lon"] - delta, z["lat"] + delta],
            [z["lon"] - delta, z["lat"] - delta]
        ]
        features.append({
            "type": "Feature",
            "id": z["id"],
            "properties": {
                "name": z["name"],
                "zone_id": z["id"]
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [poly]
            }
        })

    geojson = {
        "type": "FeatureCollection",
        "features": features
    }

    output_path = r"d:\Sentinel\frontend\public\mumbai_wards.geojson"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(geojson, f)
    print(f"Generated {output_path} with {len(zones)} wards.")

if __name__ == "__main__":
    generate_wards()

