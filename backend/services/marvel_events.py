from datetime import datetime, date
from typing import List, Dict, Optional, Any

# Major Marathi Festivals & Public Events in Mumbai
MARATHI_EVENTS = [
    {"name": "Ganesh Chaturthi", "start_date": "2025-08-27", "end_date": "2025-09-06", "risk_weight": 1.4},
    {"name": "Diwali", "start_date": "2025-10-20", "end_date": "2025-10-25", "risk_weight": 1.3},
    {"name": "Holi", "start_date": "2025-03-14", "end_date": "2025-03-15", "risk_weight": 1.25},
    {"name": "Gudi Padwa", "start_date": "2025-03-30", "end_date": "2025-03-30", "risk_weight": 1.15},
    {"name": "Maharashtra Day", "start_date": "2025-05-01", "end_date": "2025-05-01", "risk_weight": 1.2},
    {"name": "Ganesh Chaturthi (2024)", "start_date": "2024-09-07", "end_date": "2024-09-17", "risk_weight": 1.4}, # Historical
]

def is_event_active(check_date: Optional[date] = None) -> Dict[str, Any]:
    """
    Checks if a major event is active for a given date.
    Returns the event metadata and its risk weight.
    """
    if check_date is None:
        check_date = datetime.now().date()
        
    for event in MARATHI_EVENTS:
        start = datetime.strptime(event["start_date"], "%Y-%m-%d").date()
        end = datetime.strptime(event["end_date"], "%Y-%m-%d").date()
        if start <= check_date <= end:
            return {"active": True, "name": event["name"], "weight": event["risk_weight"]}
            
    return {"active": False, "name": None, "weight": 1.0}

def get_event_flags(check_date: Optional[date] = None) -> Dict[str, int]:
    """
    Returns binary flags for feature engineering.
    """
    event = is_event_active(check_date)
    return {
        "is_festival": 1 if event["active"] else 0,
        "is_election": 0, # Placeholder for election week
    }

