import { describe, expect, it } from "vitest";
import { createEmptyProject } from "./project";
import { cableCategoryWarning, recommendCableCategory, validateProjectArea } from "./cableClassification";

describe("cable classification and project areas", () => {
  it("recommends topology categories regardless of endpoint order and preserves manual mismatches", () => {
    const project = createEmptyProject();
    const now = project.createdAt;
    project.nodes = (["odc", "olt"] as const).map((type) => ({ id: type, type, name: type, location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: now, updatedAt: now }));
    const cable = { id: "c", name: "Cable", cableType: "", fiberCount: 12, geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.1, -8.1]] as [number, number][] }, lengthM: 10, startNodeId: "odc", endNodeId: "olt", properties: { cableCategory: "custom" }, createdAt: now, updatedAt: now };
    project.cableSegments = [cable];
    expect(recommendCableCategory(project, cable)).toMatchObject({ category: "feeder" });
    expect(cableCategoryWarning(project, cable)).toContain("preserved");
  });
  it("explains unsupported links and validates closed polygon rings", () => {
    const project = createEmptyProject();
    const now = project.createdAt;
    project.nodes = (["pole", "router"] as const).map((type) => ({ id: type, type, name: type, location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: now, updatedAt: now }));
    const cable = { id: "c", name: "Cable", cableType: "", fiberCount: null, geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.1, -8.1]] as [number, number][] }, lengthM: null, startNodeId: "pole", endNodeId: "router", properties: {}, createdAt: now, updatedAt: now };
    expect(recommendCableCategory(project, cable).explanation).toContain("no standard category");
    expect(validateProjectArea({ geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] } })).toContain("three vertices");
    expect(validateProjectArea({ geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] } })).toBeNull();
  });

  it("does not warn about a shared cable solely because multiple connections reference it", () => {
    const project = createEmptyProject();
    const now = project.createdAt;
    project.nodes = (["olt", "odc", "olt", "odc"] as const).map((type, index) => ({ id: `${type}-${index}`, type, name: `${type}-${index}`, location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: now, updatedAt: now }));
    const cable = { id: "shared", name: "Shared feeder", cableType: "feeder", fiberCount: 12, geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.1, -8.1]] as [number, number][] }, lengthM: 10, properties: { cableCategory: "feeder", cableCategorySource: "manual" }, createdAt: now, updatedAt: now };
    project.cableSegments = [cable];
    project.connections = [
      { id: "link-1", fromNodeId: "olt-0", toNodeId: "odc-1", cableSegmentId: "shared" },
      { id: "link-2", fromNodeId: "olt-2", toNodeId: "odc-3", cableSegmentId: "shared" },
    ];

    expect(recommendCableCategory(project, cable)).toMatchObject({ category: "custom", explanation: expect.stringContaining("Multiple topology connections") });
    expect(cableCategoryWarning(project, cable)).toBeNull();
    expect(cable.properties.cableCategory).toBe("feeder");
  });

  it("warns when shared cable connections imply genuinely conflicting categories", () => {
    const project = createEmptyProject();
    const now = project.createdAt;
    project.nodes = (["olt", "odc", "odp"] as const).map((type) => ({ id: type, type, name: type, location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: now, updatedAt: now }));
    const cable = { id: "shared", name: "Shared", cableType: "feeder", fiberCount: 12, geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.1, -8.1]] as [number, number][] }, lengthM: 10, properties: { cableCategory: "feeder", cableCategorySource: "manual" }, createdAt: now, updatedAt: now };
    project.cableSegments = [cable];
    project.connections = [
      { id: "link-1", fromNodeId: "olt", toNodeId: "odc", cableSegmentId: "shared" },
      { id: "link-2", fromNodeId: "odc", toNodeId: "odp", cableSegmentId: "shared" },
    ];

    expect(cableCategoryWarning(project, cable)).toContain("conflicting cable categories (feeder, distribution)");
    expect(cable.properties.cableCategory).toBe("feeder");
  });
});
