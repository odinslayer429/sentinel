from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class Zone(Base):
    __tablename__ = "zones"
    id          = Column(Integer, primary_key=True, index=True)
    zone_id     = Column(String(10), unique=True, nullable=False, index=True)
    name        = Column(String(100), nullable=False)
    latitude    = Column(Float, nullable=False)
    longitude   = Column(Float, nullable=False)
    density     = Column(String(10), default="medium")
    crimes      = relationship("Crime", back_populates="zone_ref")

class Crime(Base):
    __tablename__ = "crimes"
    id          = Column(Integer, primary_key=True, index=True)
    zone_id     = Column(String(10), ForeignKey("zones.zone_id"), nullable=False, index=True)
    crime_type  = Column(String(100), nullable=False, index=True)
    ipc_section = Column(String(20), nullable=False)
    severity    = Column(Integer, default=5)
    latitude    = Column(Float)
    longitude   = Column(Float)
    timestamp   = Column(DateTime, default=datetime.utcnow, index=True)
    hour        = Column(Integer)
    day_of_week = Column(Integer)
    month       = Column(Integer)
    timeband    = Column(String(20))
    status      = Column(String(30), default="OPEN")
    description = Column(Text)
    source      = Column(String(30), default="MANUAL")
    zone_ref    = relationship("Zone", back_populates="crimes")

class Officer(Base):
    __tablename__ = "officers"
    id          = Column(Integer, primary_key=True, index=True)
    badge_no    = Column(String(20), unique=True, nullable=False)
    name        = Column(String(100), nullable=False)
    rank        = Column(String(50))
    zone_id     = Column(String(10), ForeignKey("zones.zone_id"))
    is_active   = Column(Boolean, default=True)
    latitude    = Column(Float)
    longitude   = Column(Float)

class Offender(Base):
    __tablename__ = "offenders"
    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(100), nullable=False)
    alias       = Column(String(100))
    age         = Column(Integer)
    gender      = Column(String(10))
    nationality = Column(String(50), default="Indian")
    risk_level  = Column(String(10), default="LOW")
    known_zones = Column(String(200))
    arrest_count= Column(Integer, default=0)
    is_wanted   = Column(Boolean, default=False)
    description = Column(Text)

class User(Base):
    __tablename__ = "users"
    id              = Column(Integer, primary_key=True, index=True)
    username        = Column(String(50), unique=True, nullable=False, index=True)
    hashed_password = Column(String(200), nullable=False)
    full_name       = Column(String(100))
    role            = Column(String(20), default="officer")
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
