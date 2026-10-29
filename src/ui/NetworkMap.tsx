import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { CableSegment, Coordinate, Customer, FeatureRef, NetworkNode, PlacementTool, PoleSpan, Project } from "../domain/types";
import { CABLE_CATEGORY_COLORS, resolveCableCategory } from "../domain/types";
import { cablePreviewCoordinates, formatCableDistance, measureCableDraft } from "../domain/cableDrawing";
import type { CableDrawingSession } from "../domain/cableDrawing";
import { approximateLengthMeters } from "../domain/project";
import { resolveBasemapConfig, type BasemapEnvConfig, type BasemapMode } from "../domain/basemap";
import { isValidGeographicCoordinate, type GeocodingResult } from "../api/geocodingApi";

const DEFAULT_CENTER: [number, number] = [-8.65, 115.22];
const toLatLng = ([longitude, latitude]: Coordinate): [number, number] => [latitude, longitude];
const toCoordinate = (latlng: L.LatLng): Coordinate => [latlng.lng, latlng.lat];

function SearchNavigation({ result }: { result: GeocodingResult | null }) {
  const map = useMap();
  useEffect(() => {
    if (!result || !isValidGeographicCoordinate(result.coordinate)) return;
    map.flyTo(toLatLng(result.coordinate), Math.max(map.getZoom(), 15), { animate: true, duration: 0.65 });
  }, [map, result]);
  return null;
}

function makeIcon(type: string, selected: boolean, geographicallyPlaced: boolean, endpoint: "start" | "end" | "candidate" | null) {
  const endpointClass = endpoint ? ` cable-endpoint-${endpoint}` : "";
  return L.divIcon({ className: `map-pin-wrap ${geographicallyPlaced ? "" : "map-pin-unplaced"}${endpoint ? " cable-endpoint-wrap" : ""}`, html: `<span class="map-pin pin-${type} ${selected ? "selected" : ""}${endpointClass}">${type === "customer" ? "⌂" : type === "pole" ? "P" : type === "router" ? "R" : type.toUpperCase()}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] });
}

function MapEvents({ onMapClick, onMapMove, cableDrawing, drawing }: {
  onMapClick: (point: Coordinate) => void;
  onMapMove: (point: Coordinate | null) => void;
  cableDrawing: CableDrawingSession | null;
  drawing: boolean;
}) {
  const map = useMap();
  const labelRef = useRef<HTMLDivElement | null>(null);
  const committedCoordinates = useMemo(() => cablePreviewCoordinates(cableDrawing, null), [cableDrawing]);
  const committedLengthM = useMemo(() => approximateLengthMeters(committedCoordinates), [committedCoordinates]);
  const onMapMoveRef = useRef(onMapMove);
  const onMapClickRef = useRef(onMapClick);
  const lastCursorLatLngRef = useRef<L.LatLng | null>(null);
  const pendingMoveRef = useRef<Coordinate | null>(null);
  const moveTimerRef = useRef<number | null>(null);
  const lastMoveAtRef = useRef(Number.NEGATIVE_INFINITY);
  const lastLabelTextAtRef = useRef(Number.NEGATIVE_INFINITY);
  const measurementStateRef = useRef({ drawing, cableDrawing, committedCoordinates, committedLengthM });
  const updateMeasurementRef = useRef<(cursor: Coordinate, latlng: L.LatLng, segmentLengthOverride?: number, totalLengthOverride?: number, forceText?: boolean) => void>(() => undefined);
  onMapMoveRef.current = onMapMove;
  onMapClickRef.current = onMapClick;
  measurementStateRef.current = { drawing, cableDrawing, committedCoordinates, committedLengthM };

  useEffect(() => {
    const label = document.createElement("div");
    label.className = "cable-measurement-preview";
    label.setAttribute("role", "status");
    label.setAttribute("aria-live", "polite");
    label.setAttribute("aria-atomic", "true");
    label.style.pointerEvents = "none";
    label.hidden = true;
    label.innerHTML = '<span class="cable-measurement-segment"></span><span class="cable-measurement-total"></span>';
    map.getContainer().appendChild(label);
    labelRef.current = label;
    return () => {
      if (moveTimerRef.current !== null) window.clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
      pendingMoveRef.current = null;
      label.remove();
      labelRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!drawing || cableDrawing?.phase !== "route") {
      if (labelRef.current) labelRef.current.hidden = true;
    }
  }, [drawing, cableDrawing?.phase]);

  useEffect(() => {
    const lastCursor = lastCursorLatLngRef.current;
    if (drawing && cableDrawing?.phase === "route" && lastCursor && committedCoordinates.length > 0) {
      updateMeasurementRef.current(toCoordinate(lastCursor), lastCursor, undefined, undefined, true);
    }
  }, [committedCoordinates, drawing, cableDrawing?.phase]);

  const updateMeasurement = (cursor: Coordinate, latlng: L.LatLng, segmentLengthOverride?: number, totalLengthOverride?: number, forceText = false) => {
    const { drawing: isDrawing, cableDrawing: session, committedCoordinates: routeCoordinates, committedLengthM: routeLengthM } = measurementStateRef.current;
    const label = labelRef.current;
    if (!label || !isDrawing || session?.phase !== "route" || routeCoordinates.length === 0) {
      if (label) label.hidden = true;
      return;
    }
    const measurement = measureCableDraft(routeCoordinates, cursor, routeLengthM);
    if (!measurement) { label.hidden = true; return; }
    const segmentLength = segmentLengthOverride ?? measurement.segmentLengthM;
    const totalLength = totalLengthOverride ?? measurement.cumulativeLengthM;
    const segmentText = `Segment ${formatCableDistance(segmentLength)}`;
    const totalText = `Total ${formatCableDistance(totalLength)}`;
    const now = performance.now();
    if (forceText || now - lastLabelTextAtRef.current >= 100) {
      const segment = label.querySelector<HTMLElement>(".cable-measurement-segment");
      const total = label.querySelector<HTMLElement>(".cable-measurement-total");
      if (segment) segment.textContent = segmentText;
      if (total) total.textContent = totalText;
      label.setAttribute("aria-label", `${segmentText}; ${totalText}`);
      lastLabelTextAtRef.current = now;
    }
    const point = map.latLngToContainerPoint(latlng);
    const container = map.getContainer();
    const left = Math.max(8, Math.min(point.x + 14, container.clientWidth - label.offsetWidth - 8));
    const top = Math.max(8, Math.min(point.y + 14, container.clientHeight - label.offsetHeight - 8));
    label.style.transform = `translate(${left}px, ${top}px)`;
    label.hidden = false;
  };
  updateMeasurementRef.current = updateMeasurement;

  const mapEventHandlers = useMemo(() => ({
    click: (event: L.LeafletMouseEvent) => {
      const point = toCoordinate(event.latlng);
      const { drawing: isDrawing, cableDrawing: session, committedCoordinates: routeCoordinates } = measurementStateRef.current;
      if (isDrawing && session?.phase === "route") {
        lastCursorLatLngRef.current = event.latlng;
        if (moveTimerRef.current !== null) window.clearTimeout(moveTimerRef.current);
        moveTimerRef.current = null;
        pendingMoveRef.current = null;
        const nextCoordinates = [...routeCoordinates, point];
        if (nextCoordinates.length > 1) {
          updateMeasurementRef.current(point, event.latlng, 0, approximateLengthMeters(nextCoordinates), true);
        } else if (labelRef.current) labelRef.current.hidden = true;
      }
      onMapClickRef.current(point);
    },
    mousemove: (event: L.LeafletMouseEvent) => {
      lastCursorLatLngRef.current = event.latlng;
      const point = toCoordinate(event.latlng);
      updateMeasurementRef.current(point, event.latlng);
      pendingMoveRef.current = point;
      const now = performance.now();
      const emitMove = () => {
        moveTimerRef.current = null;
        const pending = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (pending) {
          lastMoveAtRef.current = performance.now();
          onMapMoveRef.current(pending);
        }
      };
      const remaining = 33 - (now - lastMoveAtRef.current);
      if (remaining <= 0) emitMove();
      else if (moveTimerRef.current === null) moveTimerRef.current = window.setTimeout(emitMove, remaining);
    },
    mouseout: (_event: L.LeafletMouseEvent) => {
      lastCursorLatLngRef.current = null;
      if (labelRef.current) labelRef.current.hidden = true;
      if (moveTimerRef.current !== null) window.clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
      pendingMoveRef.current = null;
      onMapMoveRef.current(null);
    },
  }), [map]);
  useMapEvents(mapEventHandlers);
  return null;
}

function DrawingMapInteraction({ active, drawing }: { active: boolean; drawing: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!active || !drawing) return;
    const hadDragging = map.dragging.enabled();
    if (hadDragging) map.dragging.disable();
    return () => {
      if (hadDragging && !map.dragging.enabled()) map.dragging.enable();
    };
  }, [active, drawing, map]);
  useEffect(() => {
    const container = map.getContainer();
    container.classList.toggle("cable-drawing", active && drawing);
    container.classList.toggle("cable-endpoint-selection", active && !drawing);
    return () => {
      container.classList.remove("cable-drawing", "cable-endpoint-selection");
    };
  }, [active, drawing, map]);
  return null;
}

interface Props {
  project: Project; tool: PlacementTool | null; selection: FeatureRef | null;
  onMapClick: (point: Coordinate) => void; onMapMove: (point: Coordinate | null) => void; onSelect: (ref: FeatureRef) => void;
  onMove: (ref: FeatureRef, point: Coordinate) => void; onMoveVertex: (id: string, index: number, point: Coordinate) => void;
  onMoveAreaVertex?: (id: string, index: number, point: Coordinate) => void;
  cableDrawing: CableDrawingSession | null; previewPoint: Coordinate | null; onCableNodeClick: (node: NetworkNode) => void;
  failedCableIds?: string[];
  areaDrawingPreview?: Coordinate[];
  searchResult?: GeocodingResult | null;
  onDismissSearchResult?: () => void;
  basemapMode?: BasemapMode;
  basemapEnv?: BasemapEnvConfig;
  onTileError?: (message: string) => void;
}

export function NetworkMap({ project, tool, selection, onMapClick, onMapMove, onSelect, onMove, onMoveVertex, onMoveAreaVertex, areaDrawingPreview = [], searchResult = null, onDismissSearchResult, cableDrawing, previewPoint, onCableNodeClick, failedCableIds = [], basemapMode = "normal", basemapEnv, onTileError }: Props) {
  const basemap = useMemo(() => resolveBasemapConfig(basemapMode, basemapEnv), [basemapMode, basemapEnv]);
  const selectedCable = selection?.kind === "cable" ? project.cableSegments.find((x) => x.id === selection.id) : undefined;
  const center = useMemo<[number, number]>(() => {
    const first = project.nodes[0]?.location.coordinates ?? project.customers[0]?.location.coordinates;
    return first ? toLatLng(first) : DEFAULT_CENTER;
  }, [project.nodes, project.customers]);
  const cableMode = tool === "cable";
  const drawing = cableMode && cableDrawing?.phase === "route";
  const endpointFor = (node: NetworkNode | undefined): "start" | "end" | "candidate" | null => {
    if (!node) return null;
    if (!cableMode || cableDrawing?.phase !== "endpoints") return null;
    if (cableDrawing?.startNodeId === node.id) return "start";
    if (cableDrawing?.endNodeId === node.id) return "end";
    return node.properties.geographicPositionSet !== false ? "candidate" : null;
  };
  const featureMarker = (item: NetworkNode | Customer, kind: "node" | "customer", type: string) => {
    const ref: FeatureRef = { kind, id: item.id };
    const node = kind === "node" ? project.nodes.find((candidate) => candidate.id === item.id) : undefined;
    const endpoint = endpointFor(node);
    const geographicallyPlaced = item.properties.geographicPositionSet !== false;
    return <Marker key={item.id} position={toLatLng(item.location.coordinates)} icon={makeIcon(type, selection?.kind === kind && selection.id === item.id, geographicallyPlaced, endpoint)} opacity={!geographicallyPlaced ? 0.55 : 1} draggable={!cableMode} eventHandlers={{
      click: (event) => {
        L.DomEvent.stopPropagation(event.originalEvent);
        if (cableMode) {
          if (!node) return;
          if (drawing && geographicallyPlaced) onMapClick(item.location.coordinates);
          else onCableNodeClick(node);
          return;
        }
        onSelect(ref);
      },
      dragend: (event) => { if (!cableMode) onMove(ref, toCoordinate(event.target.getLatLng())); },
    }} />;
  };
  const cableLine = (cable: CableSegment) => {
    const connected = project.connections.some((connection) => connection.cableSegmentId === cable.id);
    const failed = failedCableIds.includes(cable.id) && !connected;
    const selected = selection?.kind === "cable" && selection.id === cable.id;
    const category = resolveCableCategory(cable);
    const categoryColor = category ? CABLE_CATEGORY_COLORS[category] : null;
    const baseColor = categoryColor ?? (connected ? "#38bdf8" : "#d99b38");
    return <Polyline key={cable.id} positions={cable.geometry.coordinates.map(toLatLng)} pathOptions={{ color: failed ? "#ef4444" : selected ? "#ffbb55" : baseColor, weight: selected ? 6 : 5, opacity: 0.95, dashArray: connected ? undefined : "10 7" }} interactive={!cableMode} eventHandlers={{ click: (event) => { L.DomEvent.stopPropagation(event.originalEvent); if (!cableMode) onSelect({ kind: "cable", id: cable.id }); } }} />;
  };
  const spanLine = (span: PoleSpan) => {
    const cable = project.cableSegments.find((item) => item.id === span.cableSegmentId);
    const route = span.geometry?.coordinates ?? (span.coversEntireCableRoute ? cable?.geometry.coordinates : undefined);
    if (!route || route.length < 2) return null;
    const color = span.status === "existing" ? "#22c55e" : span.status === "proposed" ? "#f59e0b" : span.status === "shared" ? "#a78bfa" : "#94a3b8";
    return <Polyline key={span.id} positions={route.map(toLatLng)} pathOptions={{ color, weight: 3, opacity: 0.95, dashArray: span.status === "existing" ? "5 5" : "2 7", lineCap: "round" }} eventHandlers={{ click: (event) => { L.DomEvent.stopPropagation(event.originalEvent); onSelect({ kind: "cable", id: span.cableSegmentId }); } }} />;
  };
  const previewCoordinates = cableDrawing?.committedCableId ? [] : cablePreviewCoordinates(cableDrawing, previewPoint);

  return <MapContainer center={center} zoom={13} className={`network-map basemap-${basemap.effectiveMode} ${tool ? "map-active" : ""} ${drawing ? "cable-drawing" : cableMode ? "cable-endpoint-selection" : ""}`} scrollWheelZoom>
    <TileLayer
      key={basemap.baseLayer.id}
      attribution={basemap.baseLayer.attribution}
      url={basemap.baseLayer.url}
      maxZoom={basemap.baseLayer.maxZoom}
      eventHandlers={onTileError ? {
        tileerror: () => {
          onTileError(
            basemap.effectiveMode === "earth"
              ? "Some satellite imagery tiles could not be loaded. Check your network connection or switch back to Normal Map."
              : "Some map tiles could not be loaded. Check your network connection.",
          );
        },
      } : undefined}
    />
    {basemap.labelOverlayLayer && (
      <TileLayer
        key={basemap.labelOverlayLayer.id}
        attribution={basemap.labelOverlayLayer.attribution}
        url={basemap.labelOverlayLayer.url}
        maxZoom={basemap.labelOverlayLayer.maxZoom}
        opacity={basemap.labelOverlayLayer.opacity ?? 0.92}
        zIndex={basemap.labelOverlayLayer.zIndex ?? 2}
      />
    )}
    <MapEvents onMapClick={onMapClick} onMapMove={onMapMove} cableDrawing={cableDrawing} drawing={drawing} />
    <SearchNavigation result={searchResult} />
    {searchResult && isValidGeographicCoordinate(searchResult.coordinate) && <Marker position={toLatLng(searchResult.coordinate)} icon={L.divIcon({ className: "search-result-wrap", html: '<span class="search-result-pin">⌖</span>', iconSize: [32, 40], iconAnchor: [16, 36] })}><Popup><strong>{searchResult.displayName}</strong><br />{searchResult.address}<br /><button type="button" onClick={onDismissSearchResult}>Dismiss search marker</button></Popup></Marker>}
    <DrawingMapInteraction active={cableMode} drawing={drawing} />
    {(project.areas ?? []).map((area) => <Polygon key={area.id} positions={area.geometry.coordinates[0].map(toLatLng)} pathOptions={{ color: area.borderColor ?? area.fillColor, fillColor: area.fillColor, fillOpacity: area.fillOpacity, weight: 2 }} eventHandlers={{ click: (event) => { L.DomEvent.stopPropagation(event.originalEvent); onSelect({ kind: "area", id: area.id }); } }} />)}
    {selection?.kind === "area" && !tool && (project.areas ?? []).find((area) => area.id === selection.id)?.geometry.coordinates[0].slice(0, -1).map((point, index) => <Marker key={`area-${selection.id}-${index}`} position={toLatLng(point)} draggable icon={L.divIcon({ className: "vertex-wrap", html: '<span class="vertex-dot"></span>', iconSize: [14, 14], iconAnchor: [7, 7] })} eventHandlers={{ dragend: (event) => onMoveAreaVertex?.(selection.id, index, toCoordinate(event.target.getLatLng())) }} />)}
    {areaDrawingPreview && areaDrawingPreview.length > 0 && <Polyline positions={areaDrawingPreview.map(toLatLng)} pathOptions={{ color: "#22c55e", weight: 2, dashArray: "6 6" }} interactive={false} />}
    {project.cableSegments.map(cableLine)}
    {(project.poleSpans ?? []).map(spanLine)}
    {project.nodes.map((node) => featureMarker(node, "node", node.type))}
    {project.customers.map((customer) => featureMarker(customer, "customer", "customer"))}
    {previewCoordinates.length > 1 && <Polyline positions={previewCoordinates.map(toLatLng)} pathOptions={{ className: "cable-route-preview", color: "#f59e42", weight: 4, opacity: 0.95, dashArray: "8 8", lineCap: "round" }} interactive={false} />}
    {!cableMode && selectedCable?.geometry.coordinates.map((point, index) => <Marker key={`${selectedCable.id}-${index}`} position={toLatLng(point)} icon={L.divIcon({ className: "vertex-wrap", html: '<span class="vertex-dot"></span>', iconSize: [14, 14], iconAnchor: [7, 7] })} draggable eventHandlers={{ dragend: (event) => onMoveVertex(selectedCable.id, index, toCoordinate(event.target.getLatLng())) }} />)}
  </MapContainer>;
}
