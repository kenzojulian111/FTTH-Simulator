import { describe, expect, it } from "vitest";
import { createEmptyProject } from "./project";
import { createValidatedConnection, getDestinationChoices, validateConnection } from "./connectionValidation";

function projectFixture() {
  const project = createEmptyProject("Connection rules");
  const now = project.createdAt;
  const point = { type: "Point" as const, coordinates: [115, -8] as [number, number] };
  return {
    ...project,
    nodes: [
      { id: "olt", type: "olt" as const, name: "OLT", location: point, properties: {}, createdAt: now, updatedAt: now },
      { id: "odc", type: "odc" as const, name: "ODC", location: point, properties: {}, createdAt: now, updatedAt: now },
      { id: "odp", type: "odp" as const, name: "ODP", location: point, properties: {}, createdAt: now, updatedAt: now },
    ],
    cableSegments: [{ id: "cable-1", name: "Feeder", cableType: "", fiberCount: null, geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.001, -8]] as [number, number][] }, lengthM: null, properties: {}, createdAt: now, updatedAt: now }],
  };
}

describe("guided connection validation", () => {
  it("explains missing selections, cable and invalid references", () => {
    const project = projectFixture();
    expect(validateConnection(project, { fromNodeId: "", toNodeId: "", cableSegmentId: "" }).message).toBe("Choose a source device.");
    expect(validateConnection(project, { fromNodeId: "olt", toNodeId: "", cableSegmentId: "" }).message).toBe("Choose a destination device.");
    expect(validateConnection(project, { fromNodeId: "olt", toNodeId: "odc", cableSegmentId: "" }).message).toBe("Choose a cable segment for this connection.");
    expect(validateConnection(project, { fromNodeId: "deleted", toNodeId: "odc", cableSegmentId: "cable-1" }).code).toBe("invalid-reference");
    expect(validateConnection(project, { fromNodeId: "olt", toNodeId: "odc", cableSegmentId: "deleted" }).code).toBe("invalid-reference");
  });

  it("rejects self-links and duplicate directed links on a cable", () => {
    const project = projectFixture();
    const draft = { fromNodeId: "olt", toNodeId: "odc", cableSegmentId: "cable-1" };
    expect(validateConnection(project, { ...draft, toNodeId: "olt" }).message).toBe("A connection must join two different devices.");
    project.connections = [{ id: "existing", ...draft }];
    expect(validateConnection(project, draft).code).toBe("duplicate-link");
  });

  it("filters self and duplicate destinations without inventing device-type rules", () => {
    const project = projectFixture();
    project.connections = [{ id: "existing", fromNodeId: "olt", toNodeId: "odc", cableSegmentId: "cable-1" }];
    expect(getDestinationChoices(project, "olt", "cable-1").map((node) => node.id)).toEqual(["odp"]);
    expect(getDestinationChoices(project, "unknown", "cable-1")).toEqual([]);
  });

  it("creates only validated connections", () => {
    const project = projectFixture();
    const draft = { fromNodeId: "olt", toNodeId: "odc", cableSegmentId: "cable-1" };
    expect(createValidatedConnection(project, draft, "connection-1")).toEqual({ ok: true, connection: { id: "connection-1", ...draft } });
    expect(createValidatedConnection(project, { ...draft, toNodeId: "missing" }, "connection-2").ok).toBe(false);
  });
});
