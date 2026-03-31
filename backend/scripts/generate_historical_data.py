import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import random

def generate_historical_mumbai_crime(years=5):
    wards = {
        "A": "Colaba/Fort",
        "D": "Malabar Hill",
        "E": "Byculla",
        "F/N": "Matunga",
        "G/N": "Dharavi",
        "H/E": "Bandra East",
        "K/W": "Andheri West",
        "L": "Kurla",
        "M/E": "Govandi",
        "N": "Ghatkopar",
        "R/C": "Borivali"
    }
    
    crime_types = ["Theft", "Cyber Fraud", "Assault", "Burglary", "Chain Snatching", "Extortion"]
    
    data = []
    start_date = datetime(2020, 1, 1)
    end_date = datetime(2024, 12, 31)
    
    current_date = start_date
    while current_date <= end_date:
        # Number of crimes per day (seasonal/random)
        num_crimes = random.randint(5, 20)
        
        # Boost crimes on weekends or festivals (mocking festival boost)
        if current_date.weekday() >= 5: num_crimes += 5
        
        for _ in range(num_crimes):
            ward_code = random.choice(list(wards.keys()))
            crime = random.choice(crime_types)
            
            # Hotspot bias: Kurla (L) and Dharavi (G/N) have higher density
            if ward_code in ["L", "G/N", "M/E"]:
                if random.random() < 0.4: # 40% chance to repeat choose hotspot
                    ward_code = random.choice(["L", "G/N", "M/E"])
            
            data.append({
                "date": current_date.strftime("%Y-%m-%d"),
                "ward_code": ward_code,
                "ward_name": wards[ward_code],
                "crime_type": crime,
                "severity": random.choice(["Low", "Medium", "High"]),
                "ipc_section": f"IPC {random.randint(300, 500)}"
            })
            
        current_date += timedelta(days=1)
        
    df = pd.DataFrame(data)
    df.to_csv("d:/Sentinel/data/mumbai_crime_historical_2020_2024.csv", index=False)
    print(f"Generated {len(df)} historical records.")

if __name__ == "__main__":
    import os
    if not os.path.exists("d:/Sentinel/data"):
        os.makedirs("d:/Sentinel/data")
    generate_historical_mumbai_crime()

