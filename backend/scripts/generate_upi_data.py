import pandas as pd
import random
from datetime import datetime, timedelta

def generate_upi_fraud_data():
    banks = ["HDFC", "SBI", "ICICI", "Axis", "Kotak"]
    platforms = ["PhonePe", "GooglePay", "Paytm", "AmazonPay"]
    fraud_types = ["Phishing Link", "QR Code Scam", "Fake Customer Care", "OTP SMS", "SIM Swap"]
    
    data = []
    start_date = datetime(2024, 1, 1)
    end_date = datetime(2025, 3, 24)
    
    current_date = start_date
    while current_date <= end_date:
        # 10 frauds per day on average
        for _ in range(random.randint(5, 15)):
            data.append({
                "timestamp": current_date.strftime("%Y-%m-%d %H:%M:%S"),
                "amount": random.randint(500, 50000),
                "bank": random.choice(banks),
                "platform": random.choice(platforms),
                "fraud_type": random.choice(fraud_types),
                "upi_id": f"scammer{random.randint(100, 999)}@okicici",
                "phishing_url": f"http://verify-kyc-{random.randint(1000, 9999)}.com/login"
            })
        current_date += timedelta(days=1)
        
    df = pd.DataFrame(data)
    df.to_csv("d:/Sentinel/data/upi_fraud_historical_2024_2025.csv", index=False)
    print(f"Generated {len(df)} UPI fraud records.")

if __name__ == "__main__":
    generate_upi_fraud_data()

