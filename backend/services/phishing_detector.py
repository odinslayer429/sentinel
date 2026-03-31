import math
import re
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

class PhishingDetector:
    """
    Lexical Phishing URL Scanner.
    Uses features like entropy, dot counts, and keywords to identify anomalies.
    """
    
    @staticmethod
    def calculate_entropy(url: str) -> float:
        """Measure of randomness in the URL string."""
        if not url: return 0.0
        prob = [float(url.count(c)) / len(url) for c in dict.fromkeys(list(url))]
        entropy = - sum([p * math.log(p) / math.log(2.0) for p in prob])
        return entropy

    @staticmethod
    def scan_url(url: str) -> Dict[str, Any]:
        """
        Scans URL for phishing signals.
        """
        reasons = []
        score = 0
        
        # 1. Lexical features
        if len(url) > 75:
            score += 20
            reasons.append("Abnormally long URL string.")
            
        dots = url.count(".")
        if dots > 3:
            score += 25
            reasons.append(f"Excessive subdomains detected ({dots} dots).")
            
        if "-" in url:
            score += 10
            reasons.append("Hyphenated domain often used in phishing.")
            
        # 2. Keywords
        suspicious_keywords = ["login", "verify", "secure", "update", "bank", "portal", "account", "upi"]
        for kw in suspicious_keywords:
            if kw in url.lower():
                score += 15
                reasons.append(f"Suspicious keyword found: '{kw}'.")
                
        # 3. Anomaly detection (Character manipulation)
        if any(char.isdigit() for char in url.split('.')[0]):
            score += 15
            reasons.append("Numeric digits in the SLD (Second Level Domain).")
            
        entropy = PhishingDetector.calculate_entropy(url)
        if entropy > 4.5:
            score += 20
            reasons.append("High URL entropy (possible random generation).")
            
        # Final Score Normalization
        final_score = min(100, score)
        status = "PHISHING" if final_score > 70 else "SUSPICIOUS" if final_score > 40 else "SAFE"
        
        return {
            "url": url,
            "risk_score": final_score,
            "status": status,
            "anomalies": reasons,
            "entropy": round(entropy, 2)
        }

