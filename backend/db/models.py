from sqlalchemy import Column, String, Boolean, Float, DateTime, Text, Integer
from sqlalchemy.dialects.postgresql import UUID
from geoalchemy2 import Geometry
from .database import Base
import uuid
from datetime import datetime


from sqlalchemy import TypeDecorator, DateTime as _DateTime
from email.utils import parsedate_to_datetime as _parse_rfc2822
import datetime as _dt

class FlexibleDateTime(_DateTime):
    """Accepts ISO and RFC 2822 datetime strings from SQLite."""
    def result_processor(self, dialect, coltype):
        def process(value):
            if value is None:
                return None
            if isinstance(value, _dt.datetime):
                return value
            s = str(value)
            try:
                return _dt.datetime.fromisoformat(s.replace("Z", ""))
            except ValueError:
                pass
            try:
                return _parse_rfc2822(s).replace(tzinfo=None)
            except Exception:
                return None
        return process


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(100), nullable=False)
    hashed_password = Column(String(200), nullable=False)
    role = Column(String(50))
    badge_number = Column(String(50))
    assigned_zone = Column(String(4))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class CrimeRecord(Base):
    __tablename__ = "crimes"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_tag = Column(String)
    crime_type = Column(String)
    ward = Column(String)
    # Fallback for SQLite/Local environments without SpatiaLite
    lat = Column(Float)
    lon = Column(Float)
    # geom = Column(Geometry('POINT', srid=4326)) # Keeping for PostGIS compatibility but commenting out for local test
    registered_at = Column(DateTime, default=datetime.utcnow)
    detected = Column(Boolean, default=False)
    severity_score = Column(Float)
    raw_text = Column(Text)
    source_url = Column(Text)

class IngestionLog(Base):
    __tablename__ = "ingestion_log"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    run_at = Column(DateTime, default=datetime.utcnow)
    source = Column(String)
    rows_inserted = Column(Integer)
    dupes_skipped = Column(Integer)
    errors = Column(Integer)

class CrimeEvent(Base):
    __tablename__ = "crime_events"
    id = Column(Integer, primary_key=True)
    title = Column(String(500), nullable=False)
    description = Column(Text)
    source = Column(String(100))
    url = Column(String(500))
    published_at = Column(FlexibleDateTime)
    ingested_at = Column(FlexibleDateTime, default=datetime.utcnow)
    story_hash = Column(String(20), nullable=False)
    language = Column(String(10))
    locations = Column(Text)
    persons = Column(Text)
    orgs = Column(Text)
    crime_types = Column(Text)
    zone_id = Column(String(4))
    zone = Column(String(120))
    zone_lat = Column(Float)
    zone_lon = Column(Float)
    severity = Column(String(20))
    is_processed = Column(Boolean)

class Alert(Base):
    __tablename__ = "alerts"
    id = Column(Integer, primary_key=True)
    crime_event_id = Column(Integer)
    title = Column(String(500))
    message = Column(Text)
    severity = Column(String(20))
    zone_id = Column(String(4))
    zone = Column(String(120))
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean)

class ZoneRiskScore(Base):
    __tablename__ = "zone_risk_scores"
    id = Column(Integer, primary_key=True)
    zone_id = Column(String(4), nullable=False)
    zone_name = Column(String(120))
    hawkes_intensity = Column(Float)
    risk_score = Column(Float)
    trend = Column(String(10))
    dominant_crime_type = Column(String(50))
    event_count_1h = Column(Integer)
    event_count_6h = Column(Integer)
    event_count_24h = Column(Integer)
    weather_multiplier = Column(Float)
    computed_at = Column(DateTime, default=datetime.utcnow)
    explainability_json = Column(Text, default="[]")

class Entity(Base):
    __tablename__ = "entities"
    id = Column(Integer, primary_key=True)
    type = Column(String(50), nullable=False)
    value = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Suspect(Base):
    __tablename__ = "suspects"
    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    aliases = Column(Text)
    age = Column(Integer)
    contact_info = Column(String(200))
    last_known_zone = Column(String(120))
    crime_types = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

class FIRCase(Base):
    __tablename__ = "fir_cases"
    id = Column(Integer, primary_key=True)
    fir_number = Column(String(50))
    description = Column(Text, nullable=False)
    crime_type = Column(String(80))
    zone_id = Column(String(4))
    zone = Column(String(120))
    ipc_sections = Column(Text)
    faiss_index_id = Column(Integer)
    status = Column(String(20))
    assigned_officer = Column(String(100))
    resolution_notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class FIRSuspectLink(Base):
    __tablename__ = "fir_suspect_links"
    id = Column(Integer, primary_key=True)
    fir_id = Column(Integer, nullable=False)
    suspect_id = Column(Integer, nullable=False)
    role = Column(String(50))
    created_at = Column(DateTime, default=datetime.utcnow)

class PatrolDeployment(Base):
    __tablename__ = "patrol_deployments"
    id = Column(Integer, primary_key=True)
    zone_id = Column(String(4), nullable=False)
    zone = Column(String(120))
    officers_assigned = Column(Integer)
    risk_score = Column(Float)
    shift = Column(String(20))
    created_at = Column(DateTime, default=datetime.utcnow)

class CaseUpdate(Base):
    __tablename__ = "case_updates"
    id = Column(Integer, primary_key=True)
    fir_id = Column(Integer, nullable=False)
    update_type = Column(String(50))
    notes = Column(Text, nullable=False)
    created_by = Column(String(100))
    created_at = Column(DateTime, default=datetime.utcnow)

class DispatchTask(Base):
    __tablename__ = "dispatch_tasks"
    id = Column(Integer, primary_key=True)
    alert_id = Column(Integer)
    user_id = Column(Integer, nullable=False)
    status = Column(String(50))
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class PublicTip(Base):
    __tablename__ = "public_tips"
    id = Column(Integer, primary_key=True)
    zone_id = Column(String(4))
    details = Column(Text, nullable=False)
    severity = Column(String(20))
    contact = Column(String(100))
    created_at = Column(DateTime, default=datetime.utcnow)

class FIREntityLink(Base):
    __tablename__ = "fir_entity_links"
    id = Column(Integer, primary_key=True)
    fir_id = Column(Integer, nullable=False)
    entity_id = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

