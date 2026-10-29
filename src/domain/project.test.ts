import { describe, expect, it } from "vitest";
import { approximateLengthMeters, createEmptyProject } from "./project";
import { editorReducer } from "../state/editorReducer";
import { createMemoryProjectApi } from "../api/projectApi";

describe("project domain", () => {
  it("creates a project with stable id and explicit currency", () => {
    const project = createEmptyProject("Test");
    expect(project.name).toBe("Test");
    expect(project.currency).toBe("IDR");
    expect(project.nodes).toEqual([]);
    expect(project.id).toBeTruthy();
    expect(project.settings.opticalBudget.profileId).toBe("illustrative_gpon_planning_v1");
    expect(Object.values(project.settings.opticalBudget.parameterSources ?? {}).every((source) => source === "profile_default")).toBe(true);
  });

  it("measures a route in metres without writing an authoritative length", () => {
    const estimate = approximateLengthMeters([[115, -8], [115.001, -8]]);
    expect(estimate).toBeGreaterThan(100);
    expect(estimate).toBeLessThan(120);
  });

  it("removes topology references when a connected node is deleted", () => {
    const project = createEmptyProject();
    const node = { id: "n1", type: "olt" as const, name: "OLT 1", location: { type: "Point" as const, coordinates: [115, -8] as [number, number] }, properties: {}, createdAt: "now", updatedAt: "now" };
    const customer = { id: "u1", name: "Customer", address: "", location: { type: "Point" as const, coordinates: [115, -8] as [number, number] }, status: "connected" as const, ontNodeId: "n1", properties: {}, createdAt: "now", updatedAt: "now" };
    const state = { project: { ...project, nodes: [node], customers: [customer], connections: [{ id: "c1", fromNodeId: "n1", toNodeId: "n2", cableSegmentId: "s1" }] }, selection: { kind: "node" as const, id: "n1" }, dirty: false };
    const next = editorReducer(state, { type: "delete", ref: { kind: "node", id: "n1" } });
    expect(next.project.nodes).toHaveLength(0);
    expect(next.project.connections).toHaveLength(0);
    expect(next.project.customers[0].ontNodeId).toBeNull();
    expect(next.selection).toBeNull();
  });

  it("invalidates server cable length when a route vertex moves", () => {
    const project = createEmptyProject();
    const cable = { id: "s1", name: "Cable", cableType: "", fiberCount: null, geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.001, -8]] as [number, number][] }, lengthM: 110, properties: {}, createdAt: "now", updatedAt: "now" };
    const state = { project: { ...project, cableSegments: [cable] }, selection: { kind: "cable" as const, id: "s1" }, dirty: false };
    const next = editorReducer(state, { type: "move-vertex", id: "s1", index: 1, location: [115.002, -8] });
    expect(next.project.cableSegments[0].lengthM).toBeNull();
    expect(next.dirty).toBe(true);
  });

  it("keeps logical layout movement separate from geographic coordinates", () => {
    const project = createEmptyProject();
    const node = { id: "olt-1", type: "olt" as const, name: "OLT", location: { type: "Point" as const, coordinates: [115, -8] as [number, number] }, properties: {}, createdAt: "now", updatedAt: "now" };
    const state = { project: { ...project, nodes: [node] }, selection: { kind: "node" as const, id: node.id }, dirty: false };

    const arranged = editorReducer(state, { type: "move-logical", ref: { kind: "node", id: node.id }, position: { x: 420, y: 180 } });
    expect(arranged.project.nodes[0].location.coordinates).toEqual([115, -8]);
    expect(arranged.project.nodes[0].properties.logicalPosition).toEqual({ x: 420, y: 180 });

    const geographicallyPlaced = editorReducer(arranged, { type: "move", ref: { kind: "node", id: node.id }, location: [115.01, -8.01] });
    expect(geographicallyPlaced.project.nodes[0].location.coordinates).toEqual([115.01, -8.01]);
    expect(geographicallyPlaced.project.nodes[0].properties.logicalPosition).toEqual({ x: 420, y: 180 });
  });

  it("tracks committed revisions and ignores save acknowledgements for stale edits or projects", () => {
    const project = createEmptyProject("Revision safety");
    const initial = { project, selection: null, dirty: false, revision: 0, generation: 4 };
    const edited = editorReducer(initial, { type: "project-name", name: "Latest revision" });
    expect(edited.revision).toBe(1);
    expect(edited.dirty).toBe(true);
    const staleAcknowledgement = editorReducer(edited, { type: "saved", project: { ...project, name: "Old snapshot" }, expectedRevision: 0, expectedGeneration: 4 });
    expect(staleAcknowledgement).toBe(edited);
    expect(staleAcknowledgement.project.name).toBe("Latest revision");
    expect(staleAcknowledgement.dirty).toBe(true);

    const anotherProject = createEmptyProject("Opened project");
    const loaded = editorReducer(edited, { type: "load", project: anotherProject });
    expect(loaded.generation).toBe(5);
    const oldProjectAcknowledgement = editorReducer(loaded, { type: "saved", project, expectedRevision: 1, expectedGeneration: 4 });
    expect(oldProjectAcknowledgement).toBe(loaded);
    expect(oldProjectAcknowledgement.project.id).toBe(anotherProject.id);
  });

  it("places and selects a router, preserves its separate layout, and carries configuration through save/load", async () => {
    const project = createEmptyProject("Router persistence");
    const router = { id: "router-1", type: "router" as const, name: "Home Router", location: { type: "Point" as const, coordinates: [115, -8] as [number, number] }, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt };
    const initial = { project, selection: null, dirty: false };
    const placed = editorReducer(initial, { type: "add-node", node: router });
    expect(placed.selection).toEqual({ kind: "node", id: "router-1" });
    const configured = editorReducer(placed, { type: "router-configuration", id: router.id, configuration: { hostname: "home-router", wanMode: "dhcp-client", lanIpv4Address: "192.168.1.1", lanPrefix: 24, dhcpServerEnabled: true } });
    const arranged = editorReducer(configured, { type: "move-logical", ref: { kind: "node", id: router.id }, position: { x: 300, y: 180 } });
    expect(arranged.project.nodes[0].location.coordinates).toEqual([115, -8]);
    expect(arranged.project.nodes[0].properties.logicalPosition).toEqual({ x: 300, y: 180 });
    const api = createMemoryProjectApi();
    await api.saveProject(arranged.project);
    const reloaded = await api.getProject(project.id);
    expect(reloaded.nodes[0].properties.routerConfiguration).toEqual({ hostname: "home-router", wanMode: "dhcp-client", lanIpv4Address: "192.168.1.1", lanPrefix: 24, dhcpServerEnabled: true });
    expect(reloaded.nodes[0].properties.logicalPosition).toEqual({ x: 300, y: 180 });
  });
});
