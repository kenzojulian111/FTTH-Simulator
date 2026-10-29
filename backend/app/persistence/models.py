"""SQLAlchemy ORM models for project persistence."""

from sqlalchemy import Column, String, JSON
from backend.app.persistence.database import Base
from backend.app.domain.models import Project, current_utc_timestamp


class ProjectORM(Base):
    """SQLAlchemy model representing a saved FTTH project."""
    __tablename__ = "projects"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    currency = Column(String, default="IDR")
    nodes_data = Column(JSON, nullable=False, default=list)
    customers_data = Column(JSON, nullable=False, default=list)
    cable_segments_data = Column(JSON, nullable=False, default=list)
    connections_data = Column(JSON, nullable=False, default=list)
    pole_spans_data = Column(JSON, nullable=False, default=list)
    optical_components_data = Column(JSON, nullable=False, default=list)
    areas_data = Column(JSON, nullable=False, default=list)
    settings_data = Column(JSON, nullable=False, default=dict)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)

    def to_domain(self) -> Project:
        """Convert ORM record into domain aggregate."""
        raw_dict = {
            "id": self.id,
            "name": self.name,
            "description": self.description or "",
            "currency": self.currency or "IDR",
            "nodes": self.nodes_data or [],
            "customers": self.customers_data or [],
            "cableSegments": self.cable_segments_data or [],
            "connections": self.connections_data or [],
            "poleSpans": self.pole_spans_data or [],
            "opticalComponents": self.optical_components_data or [],
            "areas": self.areas_data or [],
            "settings": self.settings_data or {},
            "createdAt": self.created_at or self.updated_at or current_utc_timestamp(),
            "updatedAt": self.updated_at or current_utc_timestamp(),
        }
        return Project.model_validate(raw_dict)

    @classmethod
    def from_domain(cls, project: Project) -> "ProjectORM":
        """Build ORM record from domain aggregate."""
        # Dump using aliases to keep JSON serialization camelCase
        data = project.model_dump(by_alias=True)
        return cls(
            id=project.id,
            name=project.name,
            description=project.description or "",
            currency=project.currency or "IDR",
            nodes_data=data.get("nodes", []),
            customers_data=data.get("customers", []),
            cable_segments_data=data.get("cableSegments", []),
            connections_data=data.get("connections", []),
            pole_spans_data=data.get("poleSpans", []),
            optical_components_data=data.get("opticalComponents", []),
            areas_data=data.get("areas", []),
            settings_data=data.get("settings", {}),
            created_at=project.created_at or current_utc_timestamp(),
            updated_at=project.updated_at or current_utc_timestamp(),
        )
