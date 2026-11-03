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

  it("shows logical reachability separately from UNKNOWN optics and route diagnostics", () => {
    const project = createEmptyProject("Manual routes");
    const point = { type: "Point" as const, coordinates: [115, -8] as [number, number] };
    project.nodes = [{ id: "ont", type: "ont", name: "ONT Planned", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt }];
    const result: OpticalBudgetResult = {
      projectId: project.id, calculatedAt: project.updatedAt, links: [], disconnectedCustomerIds: [],
      paths: [{ ontNodeId: "ont", customerIds: ["customer"], nodeIds: ["olt", "ont"], connectionIds: ["link"], cableSegmentIds: ["drop"], lengthM: null, lossDb: null, txPowerDbm: 2.5, receivedPowerDbm: null, rxSensitivityDbm: -27, rxOverloadDbm: -8, sensitivityMarginDb: null, overloadMarginDb: null, marginDb: null, minMarginDb: 0, status: "unknown", statusReason: "missing_optical_parameter", connectivityStatus: "connected", opticalBudgetStatus: "unknown", diagnostics: [{ code: "MANUAL_ROUTE_REQUIRED", severity: "warning", category: "configuration", message: "Drop requires manual route planning; no cable length is verified.", affectedEntityType: "cable", affectedEntityId: "drop", dataSource: "manual_required" }] }],
    };
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root?.render(<Inspector project={project} selection={{ kind: "node", id: "ont" }} opticalResult={result}
      onRename={vi.fn()} onCustomerAddress={vi.fn()} onCustomerOnt={vi.fn()} onCustomerStatus={vi.fn()}
      onCableAttributes={vi.fn()} onRouterConfiguration={vi.fn()} onInvalidFiberCount={vi.fn()} onDelete={vi.fn()} />));
    expect(host.textContent).toContain("Topology reachability");
    expect(host.textContent).toContain("connected");
    expect(host.textContent).toContain("UNKNOWN");
    expect(host.textContent).toContain("missing optical parameter");
    expect(host.textContent).toContain("no cable length is verified");
  });

  it("explains that co-located equipment does not establish an internal jumper length", () => {
    const project = createEmptyProject("Internal jumper");
    const point = { type: "Point" as const, coordinates: [115, -8] as [number, number] };
    project.nodes = [
      { id: "odp", type: "odp", name: "ODP 1", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "splitter", type: "splitter", name: "ODP 1 Splitter", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
    ];
    project.cableSegments = [{
      id: "jumper", name: "Internal splitter jumper", cableType: "internal", fiberCount: null, deploymentMethod: "unspecified",
      geometry: { type: "LineString", coordinates: [] }, lengthM: null, startNodeId: "odp", endNodeId: "splitter",
      properties: { routeStatus: "manual_required", connectionKind: "internal_optical_jumper" }, createdAt: project.createdAt, updatedAt: project.updatedAt,
    }];
    project.connections = [{ id: "mount", fromNodeId: "odp", toNodeId: "splitter", cableSegmentId: "jumper" }];
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root?.render(<Inspector project={project} selection={{ kind: "cable", id: "jumper" }} opticalResult={null}
      onRename={vi.fn()} onCustomerAddress={vi.fn()} onCustomerOnt={vi.fn()} onCustomerStatus={vi.fn()}
      onCableAttributes={vi.fn()} onRouterConfiguration={vi.fn()} onInvalidFiberCount={vi.fn()} onDelete={vi.fn()} />));
    expect(host.textContent).toContain("Internal jumper length is not recorded.");
    expect(host.textContent).toContain("Coincident node coordinates do not establish physical fiber length.");
    expect(host.textContent).toContain("Not calculated");
  });

  it("renders cabinet-hosted splitters as internal components with logical port utilization", () => {
    const project = createEmptyProject("Cabinet splitters");
    const point = { type: "Point" as const, coordinates: [115, -8] as [number, number] };
    project.nodes = [
      { id: "odc", type: "odc", name: "ODC North", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "splitter", type: "splitter", name: "PON 1 splitter", location: point, properties: { mountedInNodeId: "odc", splitterRatio: "1:8", splitterLossDb: 10.4, capacity: 8, inputPortId: "IN-01", outputPortAssignments: [{ portId: "OUT-01", connectedNodeId: "odp" }], portRelationshipProvenance: "derived_from_saved_topology_connections" }, createdAt: project.createdAt, updatedAt: project.updatedAt },
    ];
    const onSelect = vi.fn();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root?.render(<Inspector project={project} selection={{ kind: "node", id: "odc" }} onSelect={onSelect}
      onRename={vi.fn()} onCustomerAddress={vi.fn()} onCustomerOnt={vi.fn()} onCustomerStatus={vi.fn()}
      onCableAttributes={vi.fn()} onRouterConfiguration={vi.fn()} onInvalidFiberCount={vi.fn()} onDelete={vi.fn()} />));
    expect(host.textContent).toContain("INSTALLED PASSIVE COMPONENTS");
    expect(host.textContent).toContain("1:8 · 10.4 dB · configured · 1/8 ports");
    expect(host.textContent).toContain("Splitters are internal cabinet components");
    const splitterRow = host.querySelector(".installed-splitter-row") as HTMLButtonElement;
    act(() => splitterRow.click());
    expect(onSelect).toHaveBeenCalledWith({ kind: "node", id: "splitter" });
  });

  it("displays clean device summaries for OLT, ODC, ODP, Splitter, and ONT and hides internal metadata keys", () => {
    const project = createEmptyProject("Summary Inspector");
    const point = { type: "Point" as const, coordinates: [115.2, -8.65] as [number, number] };
    project.nodes = [
      { id: "olt", type: "olt", name: "OLT 1", location: point, properties: { ponPortCapacity: 4, requiredPonPorts: 2, ponPortArchitectureStatus: "planning_default", portCapacityReviewRequired: true }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "odc", type: "odc", name: "ODC 1", location: point, properties: { distributionFanoutCapacity: 16, distributionFanoutCapacityStatus: "planning_default" }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "odp", type: "odp", name: "ODP 1", location: point, properties: { sourcePonPortId: "PON-1", portCapacity: 8 }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "spl", type: "splitter", name: "ODP 1 Splitter", location: point, properties: { mountedInNodeId: "odp", splitterRatio: "1:8", splitterLossDb: 10, capacity: 8, inputPortId: "IN-01", outputPortAssignments: [{ portId: "OUT-01", connectedNodeId: "ont" }] }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "ont", type: "ont", name: "ONT 1", location: point, properties: { customerId: "cust-1", opticalEquipmentStatus: "planning_default" }, createdAt: project.createdAt, updatedAt: project.updatedAt },
    ];
    project.customers = [{ id: "cust-1", name: "Pelanggan 1", address: "Jl. Raya", location: point, status: "connected", ontNodeId: "ont", properties: { plannedOdpNodeId: "odp" }, createdAt: project.createdAt, updatedAt: project.updatedAt }];
    project.cableSegments = [
      { id: "c-feed", name: "Feeder", cableType: "feeder", fiberCount: 12, geometry: { type: "LineString", coordinates: [point.coordinates, point.coordinates] }, lengthM: 500, startNodeId: "olt", endNodeId: "odc", properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "c-dist", name: "Dist", cableType: "distribution", fiberCount: 12, geometry: { type: "LineString", coordinates: [point.coordinates, point.coordinates] }, lengthM: 200, startNodeId: "odc", endNodeId: "odp", properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "c-drop", name: "Drop", cableType: "drop", fiberCount: 1, geometry: { type: "LineString", coordinates: [point.coordinates, point.coordinates] }, lengthM: 45.5, startNodeId: "odp", endNodeId: "ont", properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
    ];
    project.connections = [
      { id: "conn-1", fromNodeId: "olt", toNodeId: "odc", cableSegmentId: "c-feed" },
      { id: "conn-2", fromNodeId: "odc", toNodeId: "odp", cableSegmentId: "c-dist" },
      { id: "conn-3", fromNodeId: "odp", toNodeId: "ont", cableSegmentId: "c-drop" },
    ];
    const result: OpticalBudgetResult = {
      projectId: project.id, calculatedAt: project.updatedAt, links: [], disconnectedCustomerIds: [],
      paths: [{ ontNodeId: "ont", customerIds: ["cust-1"], nodeIds: ["olt", "odc", "odp", "ont"], connectionIds: ["conn-1", "conn-2", "conn-3"], lengthM: 745.5, lossDb: 22.1, receivedPowerDbm: -19.6, marginDb: 4.4, status: "pass", physicalRouteStatus: "unverified" }],
    };

    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const noop = vi.fn();

    act(() => root?.render(<Inspector project={project} selection={{ kind: "node", id: "olt" }} opticalResult={result}
      onRename={noop} onCustomerAddress={noop} onCustomerOnt={noop} onCustomerStatus={noop}
      onCableAttributes={noop} onRouterConfiguration={noop} onInvalidFiberCount={noop} onDelete={noop} />));
    expect(host.textContent).toContain("OLT SUMMARY");
    expect(host.textContent).toContain("4 ports (Planning Default)");
    expect(host.textContent).not.toContain("ponPortArchitectureStatus");
    expect(host.textContent).not.toContain("portCapacityReviewRequired");

    act(() => root?.render(<Inspector project={project} selection={{ kind: "node", id: "odp" }} opticalResult={result}
      onRename={noop} onCustomerAddress={noop} onCustomerOnt={noop} onCustomerStatus={noop}
      onCableAttributes={noop} onRouterConfiguration={noop} onInvalidFiberCount={noop} onDelete={noop} />));
    expect(host.textContent).toContain("ODP SUMMARY");
    expect(host.textContent).toContain("ODC 1");
    expect(host.textContent).toContain("1:8 (8 ports)");

    act(() => root?.render(<Inspector project={project} selection={{ kind: "node", id: "ont" }} opticalResult={result}
      onRename={noop} onCustomerAddress={noop} onCustomerOnt={noop} onCustomerStatus={noop}
      onCableAttributes={noop} onRouterConfiguration={noop} onInvalidFiberCount={noop} onDelete={noop} />));
    expect(host.textContent).toContain("ONT SUMMARY");
    expect(host.textContent).toContain("Pelanggan 1");
    expect(host.textContent).toContain("45.50 m");
    expect(host.textContent).toContain("-19.60 dBm");
    expect(host.textContent).toContain("UNVERIFIED");
  });
});
