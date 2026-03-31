"""
database.py
───────────
SQLAlchemy engine + session factory.

Uses SQLite for zero-infrastructure local development.
To switch to PostgreSQL in production, replace DATABASE_URL with:
    postgresql+asyncpg://user:pass@host:5432/sentinel
and install asyncpg.  No other code needs to change.
"""

import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

# Allow override via environment variable for production deployment
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sentinel_v2.db")

# SQLite-specific: enable WAL mode for better concurrent read performance
# This matters because APScheduler writes while FastAPI reads simultaneously
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=True,   # drop stale connections automatically
)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency — yields a DB session, always closes on exit."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

