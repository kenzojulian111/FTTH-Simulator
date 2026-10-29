import { describe, expect, it } from "vitest";
import { createEmptyProject } from "./project";
import { describeOpticalPath, opticalPathDisplayStatus } from "./opticalPathDisplay";
import type { OpticalBudgetResult } from "./types";

function path(overrides: Partial<OpticalBudgetResult["paths"][number]> = {}): OpticalBudgetResult["paths"][number] {
  return {
    ontNodeId: "ont-1", customerIds: [], nodeIds: ["olt-1", "ont-1"], connectionIds: ["link-1"], cableSegmentIds: ["cable-1"],
    lengthM: 250, lossDb: null, receivedPowerDbm: null, marginDb: null, status: "unknown", statusReason: "missing_optical_parameter",
    ...overrides,
  };
}

describe("optical path diagnostics", () => {
  it("separates topology gaps from parameter configuration and gives next steps", () => {
    const project = createEmptyProject();
    const noPath = describeOpticalPath(path({ statusReason: "no_directed_path_from_olt", nodeIds: [], connectionIds: [], cableSegmentIds: [], lengthM: null }), project);
    expect(noPath.category).toBe("topology");
    expect(noPath.resolution).toContain("standalone cable route does not create a topology connection");

    project.nodes.push({ id: "splitter-1", type: "splitter", name: "ODP splitter", location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: "now", updatedAt: "now" });
    const splitter = describeOpticalPath(path({
      statusReason: "unknown_splitter_ratio",
      parameterSources: { "splitter-1.splitterRatio": "unknown", "splitter-1.splitterLossDb": "unknown" },
    }), project);
    expect(splitter.category).toBe("optical configuration");
    expect(splitter.summary).toContain("splitter");
    expect(splitter.affectedNodeIds).toEqual(["splitter-1"]);
    expect(splitter.resolution).toContain("actual insertion loss");
  });

  it("lists legacy optical parameters with their engineering units", () => {
    const project = createEmptyProject();
    const diagnostic = describeOpticalPath(path({
      statusReason: "legacy_fallback_parameters",
      parameterSources: { txPowerDbm: "legacy_fallback", fiberAttenuationDbPerKm: "legacy_fallback", rxSensitivityDbm: "legacy_fallback" },
    }), project);
    expect(diagnostic.summary).toContain("no recorded source");
    expect(diagnostic.parameters).toEqual([
      { name: "OLT transmit power", unit: "dBm", source: "legacy_fallback" },
      { name: "Fiber attenuation", unit: "dB/km", source: "legacy_fallback" },
      { name: "ONT receiver sensitivity", unit: "dBm", source: "legacy_fallback" },
    ]);
  });

  it("shows exact invalid topology connection feedback and affected devices", () => {
    const project = createEmptyProject();
    project.nodes.push(
      { id: "olt-1", type: "olt", name: "OLT", location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: "now", updatedAt: "now" },
      { id: "ont-1", type: "ont", name: "ONT", location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: "now", updatedAt: "now" },
    );
    project.connections.push({ id: "bad-link", fromNodeId: "olt-1", toNodeId: "ont-1", cableSegmentId: "cable-1" });
    const diagnostic = describeOpticalPath(path({
      statusReason: "invalid_topology_connection",
      details: { invalidConnections: [{ connectionId: "bad-link", code: "cable_endpoint_mismatch", message: "Cable endpoints do not match the connection." }] },
    }), project);

    expect(diagnostic.category).toBe("topology");
    expect(diagnostic.summary).toContain("Cable endpoints do not match");
    expect(diagnostic.affectedNodeIds).toEqual(["olt-1", "ont-1"]);
  });

  it("supports warning status and never treats a missing result as pass", () => {
    expect(opticalPathDisplayStatus(path({ status: "warning" }))).toBe("warning");
    expect(opticalPathDisplayStatus(path({ status: "pass", receivedPowerDbm: null }))).toBe("unknown");
  });
});
