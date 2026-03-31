import asyncio
import random
import time
from .ws_manager import manager

MUMBAI_BOUNDS = {
    "lat_min": 18.9, 
    "lat_max": 19.2,
    "lon_min": 72.8, 
    "lon_max": 73.0
}

PLATES = [
    "MH-01-AB-1234", "MH-02-CD-5678", "MH-04-EF-9012", "MH-03-GH-3456",
    "MH-01-ZZ-9999", "MH-02-RX-7777", "MH-47-XY-1000", "MH-05-AB-5555"
]

TARGET_PLATE = "MH-02-CD-5678" # The one from the Robbery FIR

async def run_cctv_simulation():
    print("[CCTV ENGINE] Online. Simulating ANPR grid hits...")
    while True:
        # Generate 2-5 hits every interval
        for _ in range(random.randint(2, 5)):
            is_target = random.random() < 0.2
            plate = TARGET_PLATE if is_target else random.choice(PLATES)
            
            lat = random.uniform(MUMBAI_BOUNDS["lat_min"], MUMBAI_BOUNDS["lat_max"])
            lon = random.uniform(MUMBAI_BOUNDS["lon_min"], MUMBAI_BOUNDS["lon_max"])
            
            hit = {
                "type": "cctv_hit",
                "plate": plate,
                "lat": lat,
                "lon": lon,
                "is_flagged": is_target,
                "timestamp": time.time(),
                "alert_marathi": "सावधान: संशयित वाहन आढळले!" if is_target else None
            }
            
            # Broadcast to all connected command centers
            await manager.push(hit)
            
        await asyncio.sleep(random.uniform(1.0, 3.0))

if __name__ == "__main__":
    asyncio.run(run_cctv_simulation())

