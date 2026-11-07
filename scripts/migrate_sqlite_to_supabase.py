import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.persistence.models import ProjectORM


SQLITE_PATH = ROOT / "ftth_simulator.db"

source_engine = create_engine(
    f"sqlite:///{SQLITE_PATH}",
    connect_args={"check_same_thread": True},
)

from backend.app.persistence.database import engine as target_engine

if target_engine.dialect.name != "postgresql":
    raise RuntimeError("Target database bukan PostgreSQL. Migrasi dibatalkan.")

with Session(source_engine) as source, Session(target_engine) as target:
    projects = source.scalars(select(ProjectORM)).all()

    if not projects:
        raise RuntimeError("Tidak ada proyek di SQLite.")

    existing_ids = set(
        target.scalars(select(ProjectORM.id)).all()
    )

    conflicts = [
        project.id for project in projects
        if project.id in existing_ids
    ]

    if conflicts:
        raise RuntimeError(
            f"Ada ID yang sudah digunakan di Supabase: {conflicts}"
        )

    try:
        for project in projects:
            target.add(
                ProjectORM(
                    id=project.id,
                    name=project.name,
                    description=project.description,
                    currency=project.currency,
                    nodes_data=project.nodes_data,
                    customers_data=project.customers_data,
                    cable_segments_data=project.cable_segments_data,
                    connections_data=project.connections_data,
                    settings_data=project.settings_data,
                    pole_spans_data=project.pole_spans_data,
                    optical_components_data=project.optical_components_data,
                    areas_data=project.areas_data,
                    created_at=project.created_at,
                    updated_at=project.updated_at,
                )
            )

        target.flush()
        target_count = target.query(ProjectORM).count()
        expected_count = len(existing_ids) + len(projects)

        if target_count != expected_count:
            raise RuntimeError(
                f"Jumlah tidak cocok: {target_count} != {expected_count}"
            )

        target.commit()

        print(f"Berhasil memigrasikan {len(projects)} proyek.")

    except Exception:
        target.rollback()
        raise

source_engine.dispose()
target_engine.dispose()
