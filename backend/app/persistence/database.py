"""Database configuration using SQLite and SQLAlchemy."""

import os
from typing import AsyncGenerator
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

DEFAULT_DB_URL = os.environ.get("FTTH_DATABASE_URL", "sqlite:///./ftth_simulator.db")

engine = create_engine(
    DEFAULT_DB_URL,
    connect_args={"check_same_thread": False} if DEFAULT_DB_URL.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


async def get_db() -> AsyncGenerator[Session, None]:
    """FastAPI dependency for obtaining a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db(target_engine=None) -> None:
    """Create tables and apply additive SQLite columns for older project stores."""
    eng = target_engine or engine
    Base.metadata.create_all(bind=eng)
    if eng.dialect.name == "sqlite":
        columns = {column["name"] for column in inspect(eng).get_columns("projects")}
        with eng.begin() as connection:
            for name in ("pole_spans_data", "optical_components_data", "areas_data"):
                if name not in columns:
                    connection.execute(text(f"ALTER TABLE projects ADD COLUMN {name} JSON NOT NULL DEFAULT '[]'"))
