import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../domain/project";
import type { OpticalBudgetResult } from "../domain/types";
import { Inspector } from "./Inspector";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

describe("intermediate optical Inspector", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => { if (root) act(() => root?.unmount()); root = null; host?.remove(); host = null; });

  it("shows the estimated ODC power and clearly distinguishes it from measured receiver power", () => {
    const project = createEmptyProject("Optical Inspector");
    const point = { type: "Point" as const, coordinates: [115, -8] as [number, number] };
    project.nodes = [{ id: "odc", type: "odc", name: "ODC North", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt }];
    const result: OpticalBudgetResult = {
      projectId: project.id, calculatedAt: project.updatedAt, links: [], paths: [], disconnectedCustomerIds: [],
      intermediateNodes: [{
        nodeId: "odc", nodeName: "ODC North", nodeType: "odc", status: "unknown", lengthM: 1000,
        accumulatedLossDb: 8.1, estimatedPowerDbm: -5.1, transmitterPowerDbm: 3, sourceOltName: "OLT West", designMarginDb: 2, totalDesignAllowanceDb: 10.1,
        lossBreakdown: [
          { componentId: "fiber-c1", component: "Fiber attenuation · Feeder A (c1) · feeder", category: "fiber", position: "OLT West → ODC North (hop 1)", quantity: 1000, quantityUnit: "m", calculationQuantity: 1000, calculationQuantityUnit: "m", unitLossDb: 0.4, unitLossUnit: "dB/km", totalLossDb: 0.4, cumulativeLossDb: 0.4, source: "configured", cableSegmentId: "c1", cableName: "Feeder A", cableCategory: "feeder", pathPosition: 0 },
          { componentId: "splitter-odc", component: "Splitter · ODC North (odc) · 1:4", category: "splitter", position: "At ODC North (topology node 2)", quantity: 1, quantityUnit: "device", unitLossDb: 7.2, unitLossUnit: "dB/device", totalLossDb: 7.2, cumulativeLossDb: 8.1, source: "profile_default", nodeId: "odc", pathPosition: 1 },
        ],
        categoryLossesDb: { fiber: 0.4, connector: 0.4, splice: 0.1, splitter: 7.2, passive_component: 0 },
        parameterSources: { "c1.fiberAttenuationDbPerKm": "legacy_fallback" },
        diagnostics: ["Unverified optical input provenance: c1.fiberAttenuationDbPerKm", "Connector loss is unknown."],
      }],
    };
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root?.render(<Inspector project={project} selection={{ kind: "node", id: "odc" }} opticalResult={result}
      onRename={vi.fn()} onCustomerAddress={vi.fn()} onCustomerOnt={vi.fn()} onCustomerStatus={vi.fn()}
      onCableAttributes={vi.fn()} onRouterConfiguration={vi.fn()} onInvalidFiberCount={vi.fn()} onDelete={vi.fn()} />));
    expect(host.textContent).toContain("ESTIMATED PASSIVE-NODE POWER");
    expect(host.textContent).toContain("Estimated optical power at passive ODC · not measured receiver power.");
    expect(host.textContent).toContain("OLT West");
    expect(host.textContent).toContain("Fiber attenuation · Feeder A (c1) · feeder");
    expect(host.textContent).toContain("dB/km");
    expect(host.textContent).toContain("1 km × 0.4 dB/km = 0.4 dB");
    expect(host.textContent).toContain("Total design attenuation allowance");
    expect(host.textContent).toContain("Splitter · ODC North (odc) · 1:4");
    expect(host.textContent).toContain("8.10 dB");
    expect(host.textContent).toContain("Unverified optical input provenance");
    expect(host.textContent).toContain("Connector loss is unknown.");
    expect(host.textContent).toContain("-5.10 dBm");
  });

  it("shows the same detailed physical path calculation for a selected ONT", () => {
    const project = createEmptyProject("ONT Calculation");
    const point = { type: "Point" as const, coordinates: [115, -8] as [number, number] };
    project.nodes = [{ id: "ont", type: "ont", name: "ONT East", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt }];
    const result: OpticalBudgetResult = {
      projectId: project.id, calculatedAt: project.updatedAt, links: [], disconnectedCustomerIds: [],
      paths: [{ ontNodeId: "ont", customerIds: [], nodeIds: ["olt", "ont"], connectionIds: ["link"], cableSegmentIds: ["c1"], lengthM: 1000, lossDb: 0.9, txPowerDbm: 3, receivedPowerDbm: 2.1, rxSensitivityDbm: -27, rxOverloadDbm: -8, sensitivityMarginDb: 29.1, overloadMarginDb: 10.1, marginDb: 10.1, status: "pass", lossBreakdown: [{ componentId: "fiber-c1", component: "Fiber attenuation · Feeder A", category: "fiber", position: "OLT → ONT (hop 1)", quantity: 1000, quantityUnit: "m", calculationQuantity: 1000, calculationQuantityUnit: "m", unitLossDb: 0.4, unitLossUnit: "dB/km", totalLossDb: 0.4, cumulativeLossDb: 0.4, source: "configured", pathPosition: 0 }], categoryLossesDb: { fiber: 0.4, connector: 0.4, splice: 0.1, splitter: 0, passive_component: 0 }, designMarginDb: 2, totalDesignAllowanceDb: 2.9 }],
    };
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root?.render(<Inspector project={project} selection={{ kind: "node", id: "ont" }} opticalResult={result}
      onRename={vi.fn()} onCustomerAddress={vi.fn()} onCustomerOnt={vi.fn()} onCustomerStatus={vi.fn()}
      onCableAttributes={vi.fn()} onRouterConfiguration={vi.fn()} onInvalidFiberCount={vi.fn()} onDelete={vi.fn()} />));
    expect(host.textContent).toContain("0.4 dB/km");
    expect(host.textContent).toContain("Received optical power");
    expect(host.textContent).toContain("Physical attenuation subtotal (margin excluded)");
    expect(host.textContent).toContain("2.1 dBm");
  });
});
