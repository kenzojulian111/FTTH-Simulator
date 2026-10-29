import type { CableSegment, Coordinate } from "./types";
import { approximateLengthMeters } from "./project";

export interface CableDrawingSession {
  phase: "route" | "endpoints";
  coordinates: Coordinate[];
  editingCableId?: string;
  /** Set once route geometry has been committed as an independent cable segment. */
  committedCableId?: string;
  startNodeId: string | null;
  startLocation: Coordinate | null;
  endNodeId: string | null;
  endLocation: Coordinate | null;
}

export type CableDrawingTransition = { session: CableDrawingSession; message?: string };

export function beginCableDrawing(): CableDrawingSession {
  return { phase: "route", coordinates: [], startNodeId: null, startLocation: null, endNodeId: null, endLocation: null };
}

export function beginCableRouteEdit(cable: CableSegment, startLocation: Coordinate, endLocation: Coordinate): CableDrawingSession {
  const routeCoordinates = cable.geometry.coordinates.slice(1, -1).map(([longitude, latitude]) => [longitude, latitude] as Coordinate);
  return {
    phase: "route",
    coordinates: routeCoordinates,
    editingCableId: cable.id,
    startNodeId: cable.startNodeId ?? null,
    startLocation: [startLocation[0], startLocation[1]],
    endNodeId: cable.endNodeId ?? null,
    endLocation: [endLocation[0], endLocation[1]],
  };
}

export function hasUncommittedCableDraft(session: CableDrawingSession | null): boolean {
  if (!session) return false;
  if (session.committedCableId && session.phase === "endpoints") return false;
  return Boolean(session.phase === "route" && (session.coordinates.length > 0 || session.editingCableId)
    || session.phase === "endpoints" && !session.committedCableId);
}

export function cableDraftSaveBlockReason(session: CableDrawingSession | null): string | null {
  return hasUncommittedCableDraft(session)
    ? "This cable route is still a draft. Finish or cancel it before saving the project."
    : null;
}

export function cablePreviewCoordinates(session: CableDrawingSession | null, cursor: Coordinate | null): Coordinate[] {
  if (!session) return [];
  if (session.phase === "endpoints") return [
    ...(session.startLocation ? [session.startLocation] : []),
    ...session.coordinates,
    ...(session.endLocation ? [session.endLocation] : []),
  ];
  const cursorPoint = cursor ? [cursor[0], cursor[1]] as Coordinate : null;
  return [
    ...(session.startLocation ? [session.startLocation] : []),
    ...session.coordinates,
    ...(cursorPoint ? [cursorPoint] : []),
  ];
}

export interface CableDraftMeasurement {
  segmentLengthM: number;
  cumulativeLengthM: number;
}

/** Measure the cursor segment and total draft with the shared project geometry utility. */
export function measureCableDraft(
  committedCoordinates: Coordinate[],
  cursor: Coordinate | null,
  committedLengthM = approximateLengthMeters(committedCoordinates),
): CableDraftMeasurement | null {
  if (!cursor || committedCoordinates.length === 0) return null;
  const lastCommitted = committedCoordinates[committedCoordinates.length - 1];
  const segmentLengthM = approximateLengthMeters([lastCommitted, cursor]);
  return { segmentLengthM, cumulativeLengthM: committedLengthM + segmentLengthM };
}

export function formatCableDistance(distanceM: number): string {
  if (!Number.isFinite(distanceM) || distanceM < 0) return "—";
  if (distanceM >= 1000) return `${(distanceM / 1000).toFixed(2)} km`;
  if (distanceM < 10) return `${distanceM.toFixed(1)} m`;
  return `${Math.round(distanceM).toLocaleString("en-US")} m`;
}

export function handleCableDrawingEscape(key: string, cancel: () => void): boolean {
  if (key !== "Escape") return false;
  cancel();
  return true;
}

export function addCableWaypoint(session: CableDrawingSession | null, location: Coordinate): CableDrawingTransition {
  if (!session) return { session: { ...beginCableDrawing(), coordinates: [[location[0], location[1]]] }, message: "Route started. Click along the road to add waypoints, then finish the route." };
  if (session.phase !== "route") return { session, message: "Route drawing is finished. Select its start and destination nodes." };
  return { session: { ...session, coordinates: [...session.coordinates, [location[0], location[1]]] } };
}

export function finishCableRoute(session: CableDrawingSession | null): CableDrawingTransition {
  if (!session) return { session: beginCableDrawing(), message: "Add at least one map point before selecting cable endpoints." };
  if (session.phase === "endpoints") return { session };
  if (session.coordinates.length < (session.editingCableId ? 0 : 2)) return { session, message: session.editingCableId ? "Add route points before finishing the edit." : "Add at least two map points so the cable has a valid route." };
  return { session: { ...session, phase: "endpoints" }, message: "Route geometry confirmed. It can be assigned to devices now." };
}

export function selectCableEndpoint(session: CableDrawingSession | null, nodeId: string, location: Coordinate): CableDrawingTransition {
  if (!session) return { session: beginCableDrawing(), message: "Select a route point and finish drawing before assigning endpoints." };
  if (session.phase !== "endpoints") return { session, message: "Finish drawing the route before selecting its endpoints." };
  if (!session.startNodeId) return { session: { ...session, startNodeId: nodeId, startLocation: [location[0], location[1]] }, message: "Start node selected. Choose a different node as the destination." };
  if (session.startNodeId === nodeId) return { session, message: "Choose a different node for the cable destination." };
  if (session.endNodeId) return { session, message: "Both endpoints are selected. Clear the endpoint selections to choose again." };
  return { session: { ...session, endNodeId: nodeId, endLocation: [location[0], location[1]] }, message: "Destination selected. Validate the connection to add this route to the project." };
}

export function undoCableDrawingPoint(session: CableDrawingSession | null): CableDrawingSession | null {
  if (!session) return null;
  if (session.phase === "endpoints") {
    if (session.endNodeId) return { ...session, endNodeId: null, endLocation: null };
    if (session.startNodeId) return { ...session, startNodeId: null, startLocation: null };
    return session;
  }
  return { ...session, coordinates: session.coordinates.slice(0, -1) };
}

export function clearCableEndpoints(session: CableDrawingSession): CableDrawingSession {
  return { ...session, phase: "endpoints", startNodeId: null, startLocation: null, endNodeId: null, endLocation: null };
}

export function createCableSegmentFromDrawing(session: CableDrawingSession | null, id: string, name: string, timestamp: string): CableSegment | null {
  if (!session || session.phase !== "endpoints") return null;
  const hasStart = Boolean(session.startNodeId && session.startLocation);
  const hasEnd = Boolean(session.endNodeId && session.endLocation);
  if (hasStart !== hasEnd) return null;
  let coordinates: Coordinate[];
  if (hasStart && hasEnd && session.startLocation && session.endLocation) {
    coordinates = [
      [session.startLocation[0], session.startLocation[1]],
      ...session.coordinates.map(([longitude, latitude]) => [longitude, latitude] as Coordinate),
      [session.endLocation[0], session.endLocation[1]],
    ];
  } else if (session.editingCableId && session.startLocation && session.endLocation) {
    coordinates = [[session.startLocation[0], session.startLocation[1]], ...session.coordinates.map(([longitude, latitude]) => [longitude, latitude] as Coordinate), [session.endLocation[0], session.endLocation[1]]];
  } else {
    coordinates = session.coordinates.map(([longitude, latitude]) => [longitude, latitude] as Coordinate);
  }
  if (coordinates.length < 2) return null;
  return {
    id, name, cableType: "", fiberCount: null,
    geometry: { type: "LineString", coordinates },
    lengthM: Number(approximateLengthMeters(coordinates).toFixed(2)), startNodeId: hasStart && hasEnd ? session.startNodeId : null, endNodeId: hasStart && hasEnd ? session.endNodeId : null,
    properties: {}, createdAt: timestamp, updatedAt: timestamp,
  };
}
