"""Repository for FTTH Project persistence and aggregate operations."""

from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from backend.app.domain.models import Project, ProjectSummary, current_utc_timestamp
from backend.app.domain.validation import ensure_valid_project
from backend.app.engine.geo import update_cable_lengths
from backend.app.engine.geo import calculate_route_length
from backend.app.persistence.models import ProjectORM


class ProjectRepository:
    """Repository handling project persistence in SQLite."""

    def __init__(self, db: Session):
        self.db = db

    def list_all(self) -> List[ProjectSummary]:
        """List summaries of all stored projects with metadata and device counts."""
        records = (
            self.db.query(
                ProjectORM.id,
                ProjectORM.name,
                ProjectORM.description,
                ProjectORM.currency,
                ProjectORM.created_at,
                ProjectORM.updated_at,
                ProjectORM.nodes_data,
                ProjectORM.customers_data,
                ProjectORM.cable_segments_data,
                ProjectORM.connections_data,
            )
            .order_by(ProjectORM.updated_at.desc())
            .all()
        )
        summaries = []
        for rec in records:
            nodes = rec.nodes_data or []
            customers = rec.customers_data or []
            cables = rec.cable_segments_data or []
            connections = rec.connections_data or []

            device_counts: Dict[str, int] = {}
            for node in nodes:
                if isinstance(node, dict):
                    ntype = str(node.get("type", "unknown")).lower()
                    device_counts[ntype] = device_counts.get(ntype, 0) + 1
            if customers:
                device_counts["customer"] = len(customers)

            summaries.append(
                ProjectSummary(
                    id=rec.id,
                    name=rec.name,
                    description=rec.description or "",
                    currency=rec.currency or "IDR",
                    created_at=rec.created_at or rec.updated_at,
                    updated_at=rec.updated_at,
                    node_count=len(nodes),
                    customer_count=len(customers),
                    cable_segment_count=len(cables),
                    connection_count=len(connections),
                    device_counts=device_counts,
                )
            )
        return summaries

    def get(self, project_id: str) -> Optional[Project]:
        """Retrieve a full project aggregate by ID."""
        record = self.db.query(ProjectORM).filter(ProjectORM.id == project_id).first()
        if not record:
            return None
        return record.to_domain()

    def save(self, project: Project) -> Project:
        """Validate, compute route lengths, and upsert a project aggregate."""
        # 1. Update authoritative route lengths for all cables
        update_cable_lengths(project.cable_segments)
        from backend.app.engine.pole import resolve_span_geometry_and_length
        cables_by_id = {cable.id: cable for cable in project.cable_segments}
        nodes_by_id = {node.id: node for node in project.nodes}
        spans_per_cable: Dict[str, int] = {}
        seen_span_ids = set()
        for span in project.pole_spans:
            if span.id in seen_span_ids:
                continue
            seen_span_ids.add(span.id)
            spans_per_cable[span.cable_segment_id] = spans_per_cable.get(span.cable_segment_id, 0) + 1
        for span in project.pole_spans:
            cable = cables_by_id.get(span.cable_segment_id)
            cable_span_count = spans_per_cable.get(span.cable_segment_id, 1)
            geometry, geometry_source, length, _ = resolve_span_geometry_and_length(
                span, cable, nodes_by_id, cable_span_count
            )
            full_route_on_multiple_spans = cable_span_count > 1 and span.covers_entire_cable_route and span.geometry is None
            ambiguous_multi_route = full_route_on_multiple_spans and geometry is None
            if full_route_on_multiple_spans:
                span.covers_entire_cable_route = False
            if span.length_source == "measured":
                # Field measurements remain authoritative even when a route
                # polyline is available or changes later.
                continue
            if span.length_source in {"legacy", "unknown"} and span.length_m is not None:
                # Old projects do not record whether lengthM was measured or
                # inferred. Preserve the value without relabeling it as measured.
                if ambiguous_multi_route:
                    span.length_m = None
                    span.length_source = "unknown"
                elif full_route_on_multiple_spans and geometry:
                    span.length_m = round(calculate_route_length(geometry), 2)
                    span.length_source = "geometry"
                continue
            span.length_m = round(calculate_route_length(geometry), 2) if geometry else length
            span.length_source = "geometry" if span.length_m is not None else "unknown"

        # 2. Semantic and topology validation
        ensure_valid_project(project)

        # 3. Update modification timestamp
        project.updated_at = current_utc_timestamp()

        # 4. Upsert into database
        existing = self.db.query(ProjectORM).filter(ProjectORM.id == project.id).first()
        serialized = project.model_dump(by_alias=True)

        if existing:
            if existing.created_at:
                project.created_at = existing.created_at
            existing.name = project.name
            existing.description = project.description or ""
            existing.currency = project.currency or "IDR"
            existing.nodes_data = serialized.get("nodes", [])
            existing.customers_data = serialized.get("customers", [])
            existing.cable_segments_data = serialized.get("cableSegments", [])
            existing.connections_data = serialized.get("connections", [])
            existing.pole_spans_data = serialized.get("poleSpans", [])
            existing.optical_components_data = serialized.get("opticalComponents", [])
            existing.areas_data = serialized.get("areas", [])
            existing.settings_data = serialized.get("settings", {})
            existing.updated_at = project.updated_at
        else:
            new_record = ProjectORM.from_domain(project)
            self.db.add(new_record)

        self.db.commit()
        return project

    def delete(self, project_id: str) -> bool:
        """Delete a project by ID. Returns True if deleted, False if not found."""
        record = self.db.query(ProjectORM).filter(ProjectORM.id == project_id).first()
        if not record:
            return False
        self.db.delete(record)
        self.db.commit()
        return True
