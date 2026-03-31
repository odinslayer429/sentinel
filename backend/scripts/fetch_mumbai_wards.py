import requests
import json
import os

def fetch_mumbai_wards():
    overpass_url = "http://overpass-api.de/api/interpreter"
    # Query for Mumbai administrative boundaries (level 9 or 10 usually for wards)
    overpass_query = """
    [out:json];
    area["name"="Mumbai"]["admin_level"="4"]->.a;
    (
      relation["admin_level"="9"]["type"="boundary"](area.a);
      relation["admin_level"="10"]["type"="boundary"](area.a);
    );
    out body;
    >;
    out skel qt;
    """
    
    # Actually, a simpler one for MCGM wards
    overpass_query_bmc = """
    [out:json];
    area["name"="Mumbai"]->.searchArea;
    (
      relation["admin_level"="9"]["name"~"Ward"](area.searchArea);
    );
    out body;
    >;
    out skel qt;
    """

    response = requests.get(overpass_url, params={'data': overpass_query_bmc})
    data = response.json()
    
    # Convert OSM JSON to GeoJSON
    # Using a simple conversion or just saving the JSON for now
    # OpenStreetMap data needs to be converted to GeoJSON properly
    # I'll use a pre-existing GeoJSON from a reliable source if I can find it, 
    # but since they all 404, I'll try to find a direct URL one more time 
    # from a known successful project.
    
    print(f"OSM data fetched: {len(data.get('elements', []))} elements")
    
    # Path to save
    output_path = r"d:\Sentinel\frontend\public\mumbai_wards.json"
    with open(output_path, 'w') as f:
        json.dump(data, f)
    print(f"Saved to {output_path}")

if __name__ == "__main__":
    fetch_mumbai_wards()

