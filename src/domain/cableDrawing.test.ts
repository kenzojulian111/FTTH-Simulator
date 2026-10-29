import { describe, expect, it, vi } from "vitest";
import { approximateLengthMeters, createEmptyProject } from "./project";
import { addCableWaypoint, beginCableDrawing, beginCableRouteEdit, cableDraftSaveBlockReason, cablePreviewCoordinates, createCableSegmentFromDrawing, finishCableRoute, formatCableDistance, handleCableDrawingEscape, hasUncommittedCableDraft, measureCableDraft, selectCableEndpoint, undoCableDrawingPoint } from "./cableDrawing";
import { editorReducer } from "../state/editorReducer";
import { createMemoryProjectApi } from "../api/projectApi";
import { DebouncedSaveQueue, makeAutosaveSnapshot } from "../api/debouncedSave";
import type { NetworkNode } from "./types";

const node = (id: string, type: NetworkNode["type"], point: [number, number]): NetworkNode => ({ id, type, name: id, location: { type: "Point", coordinates: point }, properties: { geographicPositionSet: true }, createdAt: "now", updatedAt: "now" });

describe("map-first geographic cable drawing", () => {
  it("activates route collection with no selected device and uses the first click as the first route point", () => {
    const active = beginCableDrawing();
    expect(active).toMatchObject({ phase: "route", coordinates: [], startNodeId: null, endNodeId: null });
    const firstClick = addCableWaypoint(active, [115, -8]);
    expect(firstClick.session.coordinates).toEqual([[115, -8]]);
    expect(hasUncommittedCableDraft(firstClick.session)).toBe(true);
    expect(cableDraftSaveBlockReason(firstClick.session)).toContain("Finish or cancel");
    expect(hasUncommittedCableDraft(active)).toBe(false);
    expect(cableDraftSaveBlockReason(active)).toBeNull();
  });

  it("adds manual road waypoints and previews the live cursor without committing it", () => {
    const first = addCableWaypoint(beginCableDrawing(), [115, -8]).session;
    const second = addCableWaypoint(first, [115.001, -8.002]).session;
    const preview = cablePreviewCoordinates(second, [115.002, -8.001]);
    expect(preview).toEqual([[115, -8], [115.001, -8.002], [115.002, -8.001]]);
    expect(second.coordinates).toHaveLength(2);
  });

  it("measures current and cumulative lengths as the cursor moves and a vertex is added", () => {
    const first = addCableWaypoint(beginCableDrawing(), [115.002, -8]).session;
    const cursorOne: [number, number] = [115.001, -8.001];
    const firstMeasurement = measureCableDraft(cablePreviewCoordinates(first, null), cursorOne);
    expect(firstMeasurement?.segmentLengthM).toBeCloseTo(approximateLengthMeters([[115.002, -8], cursorOne]), 6);
    expect(firstMeasurement?.cumulativeLengthM).toBeCloseTo(approximateLengthMeters([[115.002, -8], cursorOne]), 6);

    const afterVertex = addCableWaypoint(first, cursorOne).session;
    const cursorTwo: [number, number] = [115, -8.0015];
    const secondMeasurement = measureCableDraft(cablePreviewCoordinates(afterVertex, null), cursorTwo);
    expect(secondMeasurement?.segmentLengthM).toBeCloseTo(approximateLengthMeters([cursorOne, cursorTwo]), 6);
    expect(secondMeasurement?.cumulativeLengthM).toBeCloseTo(approximateLengthMeters([[115.002, -8], cursorOne, cursorTwo]), 6);
    expect(secondMeasurement?.cumulativeLengthM).toBeGreaterThan(firstMeasurement?.cumulativeLengthM ?? 0);
  });

  it("handles reversed routes, empty inputs, duplicate vertices, and readable units", () => {
    const reversed: [number, number][] = [[115.002, -8], [115.001, -8], [115, -8]];
    const forward = [...reversed].reverse();
    expect(approximateLengthMeters(reversed)).toBeCloseTo(approximateLengthMeters(forward), 6);
    expect(measureCableDraft(reversed, [114.999, -8])?.segmentLengthM).toBeCloseTo(approximateLengthMeters([[115, -8], [114.999, -8]]), 6);
    expect(measureCableDraft([], [115, -8])).toBeNull();
    expect(measureCableDraft([[115, -8]], [115, -8])).toEqual({ segmentLengthM: 0, cumulativeLengthM: 0 });
    expect(formatCableDistance(0)).toBe("0.0 m");
    expect(formatCableDistance(23.6)).toBe("24 m");
    expect(formatCableDistance(1250)).toBe("1.25 km");
  });

  it("commits a multi-vertex cable without endpoint IDs when route geometry is finished", () => {
    const route = addCableWaypoint(addCableWaypoint(beginCableDrawing(), [115.001, -8.002]).session, [115.002, -8.001]).session;
    const finished = finishCableRoute(route);
    expect(finished.session.phase).toBe("endpoints");
    expect(finished.message).toContain("geometry confirmed");
    const cable = createCableSegmentFromDrawing(finished.session, "cable-id", "Route", "now");
    expect(cable?.geometry.coordinates).toEqual([[115.001, -8.002], [115.002, -8.001]]);
    expect(cable?.startNodeId).toBeNull();
    expect(cable?.endNodeId).toBeNull();
    expect(cable?.lengthM).toBe(Number(approximateLengthMeters(cable?.geometry.coordinates ?? []).toFixed(2)));
    expect(approximateLengthMeters(cable?.geometry.coordinates ?? [])).toBeGreaterThan(0);
    expect(hasUncommittedCableDraft({ ...finished.session, committedCableId: cable?.id })).toBe(false);
    expect(makeAutosaveSnapshot({ value: { id: "saved", route: cable }, projectId: "saved", activeProjectId: "saved", revision: 1, generation: 1, dirty: true, hasIncompleteDraft: hasUncommittedCableDraft({ ...finished.session, committedCableId: cable?.id }), switchingProject: false, blocked: false })).not.toBeNull();
  });

  it("undoes waypoints and endpoint selections, and Escape cancels without producing a segment", () => {
    const route = addCableWaypoint(addCableWaypoint(beginCableDrawing(), [115.001, -8.002]).session, [115.002, -8.001]).session;
    const finished = finishCableRoute(route).session;
    const withStart = selectCableEndpoint(finished, "a", [115, -8]).session;
    const withEnd = selectCableEndpoint(withStart, "b", [115.003, -8]).session;
    expect(undoCableDrawingPoint(withEnd)?.endNodeId).toBeNull();
    expect(undoCableDrawingPoint(undoCableDrawingPoint(withEnd))?.startNodeId).toBeNull();
    expect(undoCableDrawingPoint(route)?.coordinates).toEqual([[115.001, -8.002]]);
    expect(undoCableDrawingPoint(undoCableDrawingPoint(route))?.coordinates).toEqual([]);
    const cancel = vi.fn();
    expect(handleCableDrawingEscape("Escape", cancel)).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(handleCableDrawingEscape("Enter", cancel)).toBe(false);
    expect(createCableSegmentFromDrawing(null, "ignored", "Cable", "now")).toBeNull();
    expect(createCableSegmentFromDrawing(addCableWaypoint(addCableWaypoint(beginCableDrawing(), [115, -8]).session, [115.001, -8]).session, "unfinished", "Cable", "now")).toBeNull();
  });

  it("persists the unconnected route, preserves it on rejected validation, and connects it later", async () => {
    const project = createEmptyProject("Route persistence");
    project.nodes = [node("olt", "olt", [115, -8]), node("ont", "ont", [115.003, -8])];
    const route = addCableWaypoint(addCableWaypoint(beginCableDrawing(), [115.001, -8.002]).session, [115.002, -8.001]).session;
    const cable = createCableSegmentFromDrawing(finishCableRoute(route).session, "cable-id", "Route", "now");
    if (!cable) throw new Error("Expected completed route to produce a cable segment.");
    const initial = { project, selection: null, dirty: false };
    const committed = editorReducer(initial, { type: "add-cable", cable });
    expect(committed.project.cableSegments).toHaveLength(1);
    expect(committed.project.connections).toHaveLength(0);
    expect(committed.project.cableSegments[0].startNodeId).toBeNull();
    expect(committed.dirty).toBe(true);

    const rejected = editorReducer(committed, { type: "add-connection", connection: { id: "bad", fromNodeId: "missing", toNodeId: "ont", cableSegmentId: cable.id } });
    expect(rejected).toBe(committed);
    expect(rejected.project.cableSegments).toHaveLength(1);
    expect(rejected.project.connections).toHaveLength(0);

    const accepted = editorReducer(committed, { type: "add-connection", connection: { id: "good", fromNodeId: "olt", toNodeId: "ont", cableSegmentId: cable.id } });
    expect(accepted.project.cableSegments).toHaveLength(1);
    expect(accepted.project.connections).toHaveLength(1);
    expect(accepted.project.cableSegments[0]).toMatchObject({ startNodeId: "olt", endNodeId: "ont" });
    expect(accepted.dirty).toBe(true);
    expect(editorReducer(accepted, { type: "add-connection", connection: accepted.project.connections[0] })).toBe(accepted);

    const api = createMemoryProjectApi();
    await api.saveProject(committed.project);
    const reloaded = await api.getProject(project.id);
    expect(reloaded.cableSegments[0].geometry.coordinates).toEqual(cable.geometry.coordinates);
    expect(reloaded.cableSegments[0].lengthM).toBe(cable.lengthM);
    expect(reloaded.connections).toHaveLength(0);
    expect(reloaded.cableSegments).toHaveLength(1); // RAB receives the full cable list; no optical edge is implied.
  });

  it("autosaves finished route geometry after commit, but not while the route is a draft", async () => {
    vi.useFakeTimers();
    try {
      const project = createEmptyProject("Autosaved route");
      const api = createMemoryProjectApi(project);
      const route = addCableWaypoint(addCableWaypoint(beginCableDrawing(), [115, -8]).session, [115.002, -8.001]).session;
      const draftReason = cableDraftSaveBlockReason(route);
      expect(makeAutosaveSnapshot({ value: project, projectId: project.id, activeProjectId: project.id, revision: 0, generation: 1, dirty: true, hasIncompleteDraft: Boolean(draftReason), switchingProject: false, blocked: false })).toBeNull();

      const finished = finishCableRoute(route).session;
      const cable = createCableSegmentFromDrawing(finished, "autosave-cable", "Route", "now");
      if (!cable) throw new Error("Expected a finished geographic route.");
      const committed = editorReducer({ project, selection: null, dirty: false }, { type: "add-cable", cable });
      const committedSession = { ...finished, committedCableId: cable.id };
      const snapshot = makeAutosaveSnapshot({ value: committed.project, projectId: project.id, activeProjectId: project.id, revision: committed.revision ?? 1, generation: 1, dirty: committed.dirty, hasIncompleteDraft: Boolean(cableDraftSaveBlockReason(committedSession)), switchingProject: false, blocked: false });
      expect(snapshot).not.toBeNull();
      const save = vi.fn((value: typeof committed.project) => api.saveProject(value));
      const queue = new DebouncedSaveQueue<typeof committed.project, typeof committed.project>({
        delayMs: 2000,
        save: (item) => save(item.value),
        isCurrentProject: () => true,
        isCurrentRevision: () => true,
        canSave: () => true,
        onSaving: vi.fn(), onSaved: vi.fn(), onFailed: vi.fn(),
      });
      if (!snapshot) throw new Error("Expected a committed project snapshot.");
      queue.schedule({ ...snapshot, value: committed.project });
      await vi.advanceTimersByTimeAsync(2000);
      await queue.waitForIdle();
      const restored = await api.getProject(project.id);
      expect(save).toHaveBeenCalledOnce();
      expect(restored.cableSegments[0].geometry.coordinates).toEqual(cable.geometry.coordinates);
      expect(restored.connections).toHaveLength(0);
      queue.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an existing committed route until an edited draft validates, and cancellation leaves it untouched", async () => {
    const project = createEmptyProject("Edit route");
    project.nodes = [node("olt", "olt", [115, -8]), node("odc", "odc", [115.003, -8])];
    const original = {
      id: "existing-cable", name: "Existing feeder", cableType: "SM", fiberCount: 24,
      geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.001, -8.001], [115.003, -8]] as [number, number][] },
      lengthM: 400, startNodeId: "olt", endNodeId: "odc", properties: { reserve: 0.1 }, createdAt: "created", updatedAt: "updated",
    };
    project.cableSegments = [original];
    project.connections = [{ id: "connection-1", fromNodeId: "olt", toNodeId: "odc", cableSegmentId: original.id }];
    const initial = { project, selection: { kind: "cable" as const, id: original.id }, dirty: false };
    const draft = beginCableRouteEdit(original, [115, -8], [115.003, -8]);
    const changedDraft = addCableWaypoint(undoCableDrawingPoint(draft), [115.002, -8.002]).session;
    expect(project.cableSegments[0].geometry.coordinates).toEqual(original.geometry.coordinates);
    expect(initial.dirty).toBe(false);
    expect(hasUncommittedCableDraft(changedDraft)).toBe(true);

    // Cancelling discards only the local draft; the existing project remains the source of truth.
    let cancelledSession: typeof draft | null = draft;
    handleCableDrawingEscape("Escape", () => { cancelledSession = null; });
    expect(cancelledSession).toBeNull();
    expect(project.cableSegments[0]).toEqual(original);
    expect(initial.dirty).toBe(false);

    const finished = finishCableRoute(changedDraft).session;
    const edited = createCableSegmentFromDrawing(finished, original.id, original.name, "edited");
    if (!edited) throw new Error("Expected edit draft to produce a cable segment.");
    const confirmedCable = { ...original, ...edited, properties: original.properties, createdAt: original.createdAt };
    expect(confirmedCable.lengthM).toBe(Number(approximateLengthMeters(confirmedCable.geometry.coordinates).toFixed(2)));
    const committed = editorReducer(initial, {
      type: "replace-cable-connection",
      cable: confirmedCable,
      connection: { id: "connection-1", fromNodeId: "olt", toNodeId: "odc", cableSegmentId: original.id },
      previousConnectionId: "connection-1",
    });
    expect(committed.dirty).toBe(true);
    expect(committed.project.cableSegments[0].geometry.coordinates).toEqual([[115, -8], [115.002, -8.002], [115.003, -8]]);
    expect(committed.project.connections[0].id).toBe("connection-1");

    const api = createMemoryProjectApi();
    await api.saveProject(committed.project);
    const reloaded = await api.getProject(project.id);
    expect(reloaded.cableSegments[0].geometry.coordinates).toEqual(committed.project.cableSegments[0].geometry.coordinates);
    expect(reloaded.cableSegments[0].lengthM).toBe(confirmedCable.lengthM);
  });

  it("cancels editing an unconnected cable without changing its committed geometry", () => {
    const project = createEmptyProject("Unconnected edit");
    const cable = { id: "open-route", name: "Open route", cableType: "SM", fiberCount: 12, geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.001, -8.001], [115.002, -8]] as [number, number][] }, lengthM: 240, properties: {}, createdAt: "now", updatedAt: "now" };
    project.cableSegments = [cable];
    const originalGeometry = structuredClone(cable.geometry);
    const session = { ...beginCableRouteEdit(cable, [115, -8], [115.002, -8]), committedCableId: cable.id };
    const changed = addCableWaypoint(session, [115.0015, -8.002]).session;
    expect(hasUncommittedCableDraft(changed)).toBe(true);
    let draft: typeof changed | null = changed;
    handleCableDrawingEscape("Escape", () => { draft = null; });
    expect(draft).toBeNull();
    expect(project.cableSegments[0].geometry).toEqual(originalGeometry);
    expect(project.cableSegments[0].lengthM).toBe(240);
  });
});
