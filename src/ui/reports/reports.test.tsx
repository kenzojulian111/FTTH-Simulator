import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConstructionCostResult, OpticalBudgetResult } from "../../domain/types";
import { createEmptyProject } from "../../domain/project";
import { OpticalEngineeringReport } from "./OpticalEngineeringReport";
import { RabReport } from "./RabReport";
import { PoleSpanReport } from "./PoleSpanReport";
import { EngineeringReportLinks, ReportToolbar } from "./ReportNavigation";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

const costResult: ConstructionCostResult = {
  projectId: "project-1", calculatedAt: "2026-10-17T00:00:00.000Z", currency: "IDR", totalAmount: 300.75, totalCapex: 300.75,
  connectedCustomerCount: 2, costPerConnectedCustomer: 150.375, materialSubtotal: 200.625, installationSubtotal: 100.125, grandTotal: 300.75,
  items: [
    { code: "CABLE-SUPPLY", description: "Fiber cable", quantity: 2.5, unit: "m", unitCost: 80.25, amount: 200.625, category: "material", unitCostSource: "configured", unitCostReference: "supplier quote #Q17" },
    { code: "CABLE-INSTALL", description: "Cable installation", quantity: 2.5, unit: "m", unitCost: 40.05, amount: 100.125, category: "installation" },
  ],
  summary: { cableQuantityAudit: [{ category: "feeder", cableSegmentIds: ["c1"], physicalLengthM: 2.2, slackPercent: 10, billedLengthM: 2.42 }], poleStatusCounts: { existing: 2, proposed: 1, shared: 1, unverified: 0 } },
};

function projectFixture() {
  const project = createEmptyProject("Optical test project");
  const point = { type: "Point" as const, coordinates: [115, -8] as [number, number] };
  project.nodes = [
    { id: "olt", type: "olt", name: "OLT A", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
    { id: "odc", type: "odc", name: "ODC A", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
    { id: "ont", type: "ont", name: "ONT A", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
  ];
  project.cableSegments = [{ id: "cable", name: "Feeder 01", cableType: "single-mode", fiberCount: 12, geometry: { type: "LineString", coordinates: [[115, -8], [115.001, -8]] }, lengthM: 200, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt }];
  project.connections = [{ id: "link", fromNodeId: "olt", toNodeId: "ont", cableSegmentId: "cable" }];
  project.customers = [{ id: "customer", name: "Customer One", address: "", location: point, status: "connected", ontNodeId: "ont", properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt }];
  return project;
}

function ReportReturnHarness({ project }: { project: ReturnType<typeof projectFixture> }) {
  const [showReport, setShowReport] = useState(true);
  return showReport
    ? <OpticalEngineeringReport project={project} result={null} loading={false} error={null} onBack={() => setShowReport(false)} />
    : <div aria-label="Editor">Editor · {project.name}</div>;
}

const opticalResult: OpticalBudgetResult = {
  projectId: "project-1", calculatedAt: "2026-10-17T00:00:00.000Z", disconnectedCustomerIds: ["customer-offline"],
  links: [{ connectionId: "link", lengthM: 200, lossDb: 0.8, receivedPowerDbm: -8.8, status: "pass", details: { fiberAttenuationDbPerKm: 0.4, fiberLossDb: 0.08, connectorLossDb: 0.5, spliceLossDb: 0.22 } }],
  paths: [{ ontNodeId: "ont", customerIds: ["customer"], nodeIds: ["olt", "ont"], connectionIds: ["link"], cableSegmentIds: ["cable"], lengthM: 200, lossDb: 8.8, txPowerDbm: 0, receivedPowerDbm: -8.8, rxSensitivityDbm: -21, rxOverloadDbm: -3, marginDb: 12.2, status: "pass", statusReason: "optical_budget_within_limits", segments: [{ connectionId: "link", cableSegmentId: "cable", cableName: "Feeder 01", fromNodeId: "olt", fromNodeName: "OLT A", fromNodeType: "olt", toNodeId: "ont", toNodeName: "ONT A", toNodeType: "ont", lengthM: 200, attenuationDbPerKm: 0.4, fiberLossDb: 0.08, connectorsCount: 2, connectorLossDb: 0.5, splicesCount: 1, spliceLossDb: 0.22, totalSegmentLossDb: 0.8 }], splitters: [{ nodeId: "splitter", nodeName: "Splitter A", nodeType: "splitter", splitterRatio: "1:8", lossDb: 8, idealLossDb: 9.03 }], details: { txPowerDbm: 0, rxSensitivityDbm: -21, rxOverloadDbm: -3, fiberLossDb: 0.08, connectorLossDb: 0.5, spliceLossDb: 0.22, splitterLossDb: 8, safetyMarginDb: 2 } }],
};

describe("engineering reports", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  function render(element: React.ReactNode) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(element));
    return container;
  }

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  it("renders backend RAB line values, subtotals, grand total, customer metrics, and estimate note", () => {
    const view = render(<RabReport projectName="Fiber Plan" result={costResult} loading={false} error={null} onBack={() => undefined} />);
    expect(view.textContent).toContain("Fiber Plan");
    expect(view.textContent).toContain("Fiber cable");
    expect(view.textContent).toContain("Materials subtotal");
    expect(view.textContent).toContain("Installation subtotal");
    expect(view.textContent).toContain("Grand total · backend CAPEX");
    expect(view.textContent).toContain("300.75");
    expect(view.textContent).toContain("150.375");
    expect(view.textContent).toContain("not verified market quotations");
    expect(view.textContent).toContain("supplier quote #Q17");
    expect(view.textContent).toContain("cable IDs c1");
    expect(view.textContent).toContain("proposed 1");
  });

  it("shows RAB empty and calculation error states without fabricating rows", () => {
    const view = render(<RabReport projectName="Fiber Plan" result={null} loading={false} error="Project not found" onBack={() => undefined} />);
    expect(view.textContent).toContain("Project not found");
    expect(view.textContent).toContain("No valid construction-cost result is available");
    expect(view.querySelector("table")).toBeNull();
  });

  it("shows unknown rates as incomplete and does not fabricate a priced line", () => {
    const result: ConstructionCostResult = { ...costResult, items: [], complete: false, incompleteItems: [{ code: "POLE-SUPPLY", reason: "unit_rate_unknown", quantity: 1, unit: "piece" }], totalAmount: 0, totalCapex: 0, grandTotal: 0 };
    const view = render(<RabReport projectName="Fiber Plan" result={result} loading={false} error={null} onBack={() => undefined} />);
    expect(view.textContent).toContain("Incomplete estimate");
    expect(view.textContent).toContain("POLE-SUPPLY: unit_rate_unknown");
    expect(view.textContent).not.toContain("850,000");
  });

  it("renders configured Router rows when returned by the backend cost result", () => {
    const routerCost = { ...costResult, totalAmount: 430.75, totalCapex: 430.75, grandTotal: 430.75, materialSubtotal: 330.625, installationSubtotal: 100.125, items: [...costResult.items, { code: "RTR-SUPPLY", description: "Configured Router equipment", quantity: 1, unit: "unit", unitCost: 130, amount: 130, category: "material" as const }] };
    const view = render(<RabReport projectName="Router RAB" result={routerCost} loading={false} error={null} routerCount={1} onBack={() => undefined} />);
    expect(view.textContent).toContain("Configured Router equipment");
    expect(view.textContent).toContain("RTR-SUPPLY");
  });

  it("clearly reports when configured Router nodes have no backend RAB line", () => {
    const view = render(<RabReport projectName="Router RAB" result={costResult} loading={false} error={null} routerCount={1} onBack={() => undefined} />);
    expect(view.textContent).toContain("backend returned no separately priced Router RAB lines");
    expect(view.textContent).toContain("no Router cost has been added");
  });

  it("renders each returned optical path with ordered devices, reported component values, units, and disconnected customers", () => {
    const view = render(<OpticalEngineeringReport project={projectFixture()} result={opticalResult} loading={false} error={null} onBack={() => undefined} />);
    expect(view.textContent).toContain("OLT A (OLT)  →  ONT A (ONT)");
    expect(view.textContent).toContain("Feeder 01");
    expect(view.textContent).toContain("Attenuation (dB/km)");
    expect(view.textContent).toContain("2 / 0.5");
    expect(view.textContent).toContain("1:8");
    expect(view.textContent).toContain("Received power");
    expect(view.textContent).toContain("dBm");
    expect(view.textContent).toContain("12.2 dB");
    expect(view.textContent).toContain("Physical attenuation subtotal (margin excluded)");
    expect(view.textContent).toContain("Total design attenuation allowance");
    expect(view.textContent).toContain("Customer One");
    expect(view.textContent).toContain("customer-offline");
  });

  it("renders the same backend calculation rows and passive prefixes in report output", () => {
    const path = {
      ...opticalResult.paths[0],
      lossBreakdown: [{ componentId: "cable:fiber:link", component: "Fiber attenuation · Feeder 01 (cable) · feeder", category: "fiber" as const, position: "OLT A → ONT A (hop 1)", quantity: 200, quantityUnit: "m", calculationQuantity: 200, calculationQuantityUnit: "m", unitLossDb: 0.4, unitLossUnit: "dB/km", totalLossDb: 0.08, cumulativeLossDb: 0.08, source: "configured", cableName: "Feeder 01", cableCategory: "feeder", pathPosition: 0 }],
      categoryLossesDb: { fiber: 0.08, connector: 0.5, splice: 0.22, splitter: 8, passive_component: 0 },
      designMarginDb: 2, totalDesignAllowanceDb: 11.6,
    };
    const view = render(<OpticalEngineeringReport project={projectFixture()} result={{ ...opticalResult, paths: [path], intermediateNodes: [{ nodeId: "odc", nodeName: "ODC A", nodeType: "odc", status: "unknown", nodeIds: ["olt", "odc"], connectionIds: ["link"], lengthM: 200, accumulatedLossDb: 8.58, estimatedPowerDbm: -8.58, transmitterPowerDbm: 0, designMarginDb: 2, totalDesignAllowanceDb: 10.58, lossBreakdown: path.lossBreakdown, categoryLossesDb: path.categoryLossesDb, diagnostics: ["Legacy fallback input"] }] }} loading={false} error={null} onBack={() => undefined} />);
    expect(view.textContent).toContain("Detailed Optical Link Budget Calculation");
    expect(view.textContent).toContain("0.2 km × 0.4 dB/km = 0.08 dB");
    expect(view.textContent).toContain("ODC A (odc)");
    expect(view.textContent).toContain("Legacy fallback input");
    expect(view.textContent).toContain("not a receiver measurement");
  });

  it("renders independent route lengths and optical values for each ONT", () => {
    const project = projectFixture();
    const point = project.nodes[0].location;
    project.nodes.push({ id: "ont-b", type: "ont", name: "ONT B", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt });
    project.cableSegments.push({ ...project.cableSegments[0], id: "cable-b", name: "Drop B", lengthM: 650, geometry: { type: "LineString", coordinates: [[115, -8], [115.006, -8]] } });
    project.connections.push({ id: "link-b", fromNodeId: "odc", toNodeId: "ont-b", cableSegmentId: "cable-b" });
    const secondPath: OpticalBudgetResult["paths"][number] = {
      ...opticalResult.paths[0], ontNodeId: "ont-b", customerIds: [], nodeIds: ["olt", "odc", "ont-b"],
      connectionIds: ["link-b"], cableSegmentIds: ["cable-b"], lengthM: 850, lossDb: 14.25,
      receivedPowerDbm: -11.5, marginDb: 9.5, status: "fail", statusReason: "rx_power_below_sensitivity",
      segments: [{ ...opticalResult.paths[0].segments![0], connectionId: "link-b", cableSegmentId: "cable-b", cableName: "Drop B", fromNodeId: "odc", fromNodeName: "ODC A", toNodeId: "ont-b", toNodeName: "ONT B", lengthM: 650, fiberLossDb: 0.91, totalSegmentLossDb: 1.4 }],
    };
    const result = { ...opticalResult, paths: [opticalResult.paths[0], secondPath] };
    const view = render(<OpticalEngineeringReport project={project} result={result} loading={false} error={null} onBack={() => undefined} />);
    const cards = [...(view.querySelectorAll(".optical-path-card") as NodeListOf<HTMLElement>)];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("200 m");
    expect(cards[0].textContent).toContain("8.8 dB");
    expect(cards[0].textContent).toContain("-8.8 dBm");
    expect(cards[0].textContent).toContain("12.2 dB");
    expect(cards[1].textContent).toContain("ONT B");
    expect(cards[1].textContent).toContain("850 m");
    expect(cards[1].textContent).toContain("14.25 dB");
    expect(cards[1].textContent).toContain("-11.5 dBm");
    expect(cards[1].textContent).toContain("9.5 dB");
    expect(cards[1].textContent).toContain("Drop B");
    expect(cards[1].textContent).toContain("fail");
    expect(cards[1].textContent).toContain("ODC A → ONT B");
  });

  it("does not present an incomplete backend PASS as a valid optical result", () => {
    const path = { ...opticalResult.paths[0], lengthM: null };
    const view = render(<OpticalEngineeringReport project={projectFixture()} result={{ ...opticalResult, paths: [path] }} loading={false} error={null} onBack={() => undefined} />);
    expect(view.querySelector(".report-status")?.textContent).toBe("unknown");
    expect(view.textContent).toContain("Backend marked this path PASS but omitted required values: route length.");
  });

  it("renders standard variance, datasheet, field measurement, and location subsets separately", () => {
    const project = projectFixture();
    const path = { ...opticalResult.paths[0], standardLossDb: 15, standardVarianceDb: -6.2,
      componentLosses: [{ componentId: "c1", kind: "attenuator", location: "ODP", lossDb: 0.2, source: "configured" }],
      datasheetReferences: [{ componentId: "c1", model: "AT-1", lossDb: 0.25, reference: "ds:1" }],
      fieldMeasurements: [{ componentId: "c1", lossDb: 0.22, measuredAt: "2026-10-01", method: "meter" }],
      locationLossSummary: { ODP: 0.2 } };
    const view = render(<OpticalEngineeringReport project={project} result={{ ...opticalResult, paths: [path] }} loading={false} error={null} onBack={() => undefined} />);
    expect(view.textContent).toContain("actual − standard");
    expect(view.textContent).toContain("-6.2 dB");
    expect(view.textContent).toContain("ds:1");
    expect(view.textContent).toContain("2026-10-01");
    expect(view.textContent).toContain("Location subsets");
  });

  it("renders orphan optical component references as diagnostics", () => {
    const view = render(<OpticalEngineeringReport project={projectFixture()} result={{ ...opticalResult, diagnostics: [{ code: "missing_optical_component_node", componentId: "orphan", nodeId: "deleted-node" }] }} loading={false} error={null} onBack={() => undefined} />);
    expect(view.textContent).toContain("Project component reference diagnostics");
    expect(view.textContent).toContain("deleted-node");
  });

  it("shows explicit span lengths, estimate assumptions, and unknowns", () => {
    const project = projectFixture();
    const onSelect = vi.fn();
    const view = render(<PoleSpanReport project={project} result={{ projectId: project.id, calculatedAt: project.updatedAt, spans: [{ id: "s", cableSegmentId: "cable", cableCategory: "distribution", fromPoleId: "p1", toPoleId: "p2", lengthM: 222.39, geometrySource: "span_geometry", maximumSpanM: 50, estimatedAdditionalPoles: 4, status: "existing", diagnostics: [] }], diagnostics: [{ code: "odp_to_house_exceeds_300m", odpId: "odp-1", distanceM: 345 }], estimatedAdditionalPoles: 4, estimationMethod: "sum", assumptions: ["Endpoints included"], maxSpanLimitM: 300, maxOdpToHouseLimitM: 300, odpHouseDistances: [{ odpId: "odp-1", odpName: "ODP 01", maxAllowedDistanceM: 300, connectedHouseCount: 2, farthestDistanceM: 345, farthestTargetId: "customer", farthestTargetName: "House Far", farthestTargetKind: "customer", status: "fail", houses: [{ targetId: "customer", distanceMethod: "drop_route", routeDistanceM: 345, geodesicDistanceM: 320 }] }] }} loading={false} error={null} onBack={() => undefined} onSelect={onSelect} />);
    expect(view.textContent).toContain("Pole & Span Plan");
    expect(view.textContent).toContain("222.39 m");
    expect(view.textContent).toContain("distribution");
    expect(view.textContent).toContain("Endpoints included");
    expect(view.textContent).toContain("ODP to Farthest House Distance Validation (Max 300 m)");
    expect(view.textContent).toContain("House Far");
    expect(view.textContent).toContain("345 m");
    expect(view.textContent).toContain("Drop route 345 m");
    expect(view.textContent).toContain("FAIL");
    act(() => Array.from(view.querySelectorAll("button")).find((button) => button.textContent === "House Far")?.click());
    expect(onSelect).toHaveBeenCalledWith("customer", "customer");
  });

  it("renders actionable missing-splitter diagnostics and keeps the affected device selectable", () => {
    const project = projectFixture();
    project.nodes.push({ id: "splitter", type: "splitter", name: "ODP Splitter", location: project.nodes[0].location, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt });
    const path = { ...opticalResult.paths[0], nodeIds: ["olt", "splitter", "ont"], status: "unknown" as const, statusReason: "unknown_splitter_ratio", parameterSources: { "splitter.splitterRatio": "unknown" as const, "splitter.splitterLossDb": "unknown" as const } };
    const onSelectNode = vi.fn();
    const view = render(<OpticalEngineeringReport project={project} result={{ ...opticalResult, paths: [path] }} loading={false} error={null} onBack={() => undefined} onSelectNode={onSelectNode} />);
    expect(view.textContent).toContain("optical configuration: A splitter on this path has no usable configured ratio and insertion loss.");
    expect(view.textContent).toContain("Splitter ratio · 1:N");
    expect(view.textContent).toContain("Actual splitter insertion loss · dB");
    act(() => (Array.from(view.querySelectorAll("button")).find((button) => button.textContent?.includes("ODP Splitter")) as HTMLButtonElement).click());
    expect(onSelectNode).toHaveBeenCalledWith("splitter");
  });

  it("keeps optical reporting terminated at the backend ONT path when a Router follows the ONT", () => {
    const project = projectFixture();
    project.nodes.push({ id: "router", type: "router", name: "Customer Router", location: project.nodes[0].location, properties: { routerConfiguration: { wanMode: "dhcp-client", lanIpv4Address: "192.168.1.1", lanPrefix: 24 } }, createdAt: project.createdAt, updatedAt: project.updatedAt });
    const view = render(<OpticalEngineeringReport project={project} result={opticalResult} loading={false} error={null} onBack={() => undefined} />);
    expect(view.textContent).toContain("OLT A (OLT)  →  ONT A (ONT)");
    expect(view.textContent).not.toContain("Customer Router");
    expect(view.textContent).toContain("8.8 dB");
    expect(view.textContent).toContain("theoretical split 9.03 dB");
  });

  it("shows missing optical result and backend ambiguity reason", () => {
    const project = projectFixture();
    const view = render(<OpticalEngineeringReport project={project} result={null} loading={false} error={null} onBack={() => undefined} />);
    expect(view.textContent).toContain("No valid optical-budget result is available");
    act(() => root?.render(<OpticalEngineeringReport project={project} result={{ ...opticalResult, paths: [{ ...opticalResult.paths[0], status: "unknown", statusReason: null, details: { reason: "multiple_directed_paths_from_olt" } }] }} loading={false} error={null} onBack={() => undefined} />));
    expect(container?.textContent).toContain("Ambiguous path: the backend found multiple directed OLT-to-ONT routes.");
  });

  it("wires report navigation and browser print/back actions", () => {
    const onRab = vi.fn();
    const onOptical = vi.fn();
    const onBack = vi.fn();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const view = render(<><EngineeringReportLinks onOpenRab={onRab} onOpenOptical={onOptical} /><ReportToolbar onBack={onBack} /></>);
    const buttons = Array.from(view.querySelectorAll("button"));
    act(() => buttons.find((button) => button.textContent === "Open RAB report")?.click());
    act(() => buttons.find((button) => button.textContent === "Open optical report")?.click());
    act(() => buttons.find((button) => button.textContent?.includes("Back to Editor"))?.click());
    act(() => view.querySelector<HTMLButtonElement>('[aria-label="Close report"]')?.click());
    act(() => buttons.find((button) => button.textContent?.includes("Print / Save as PDF"))?.click());
    expect(onRab).toHaveBeenCalledOnce();
    expect(onOptical).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(print).toHaveBeenCalledOnce();
    expect(view.querySelector(".report-toolbar")?.contains(view.querySelector('[aria-label="Close report"]'))).toBe(true);
  });

  it("returns to the editor from the close control without replacing the current project", () => {
    const project = projectFixture();
    const view = render(<ReportReturnHarness project={project} />);
    expect(view.querySelector(".report-project")?.textContent).toBe(project.name);
    act(() => view.querySelector<HTMLButtonElement>('[aria-label="Close report"]')?.click());
    expect(view.querySelector('[aria-label="Editor"]')?.textContent).toContain(project.name);
  });

  it("renders explainable structured diagnostics with severity, code, thresholds, provenance, corrective action, and calculation limitations", () => {
    const project = projectFixture();
    const onSelectEntity = vi.fn();
    const pathWithDiagnostics: OpticalBudgetResult["paths"][number] = {
      ...opticalResult.paths[0],
      status: "fail",
      connectivityStatus: "connected",
      opticalBudgetStatus: "fail",
      statusReason: "rx_power_below_sensitivity",
      receivedPowerDbm: -29.4,
      rxSensitivityDbm: -27.0,
      marginDb: -5.4,
      diagnostics: [
        {
          code: "RX_BELOW_SENSITIVITY",
          severity: "error",
          category: "optical_budget",
          message: "Physical received power (-29.40 dBm) is below ONT 'ONT A' receiver sensitivity threshold (-27.00 dBm) by 2.40 dB.",
          affectedEntityType: "ont",
          affectedEntityId: "ont",
          affectedEntityName: "ONT A",
          actualValue: -29.4,
          expectedValue: -27.0,
          unit: "dBm",
          correctiveAction: "Reduce total path attenuation or increase OLT launch power.",
          dataSource: "configured",
        },
        {
          code: "OPTICAL_MARGIN_INSUFFICIENT",
          severity: "error",
          category: "optical_budget",
          message: "Optical design margin (-5.40 dB) is below required minimum (0.00 dB).",
          affectedEntityType: "ont",
          affectedEntityId: "ont",
          affectedEntityName: "ONT A",
          actualValue: -5.4,
          expectedValue: 0.0,
          unit: "dB",
          correctiveAction: "Reduce path loss to meet the minimum design margin.",
          dataSource: "profile_default",
        },
      ],
      calculationLimitations: ["Splitter insertion loss on backup branch was not evaluated."],
    };
    const view = render(
      <OpticalEngineeringReport
        project={project}
        result={{ ...opticalResult, paths: [pathWithDiagnostics] }}
        loading={false}
        error={null}
        onBack={() => undefined}
        onSelectEntity={onSelectEntity}
      />,
    );
    expect(view.textContent).toContain("Connectivity: connected");
    expect(view.textContent).toContain("Optical budget: fail");
    expect(view.textContent).toContain("Structured Optical Diagnostics (2)");
    expect(view.textContent).toContain("RX_BELOW_SENSITIVITY");
    expect(view.textContent).toContain("OPTICAL_MARGIN_INSUFFICIENT");
    expect(view.textContent).toContain("Actual: -29.4 dBm · Threshold / Expected: -27 dBm");
    expect(view.textContent).toContain("Reduce total path attenuation or increase OLT launch power.");
    expect(view.textContent).toContain("Source: configured");
    expect(view.textContent).toContain("Calculation limitations:");
    expect(view.textContent).toContain("Splitter insertion loss on backup branch was not evaluated.");

    const inspectBtn = Array.from(view.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Inspect ONT A (ont)"),
    );
    expect(inspectBtn).toBeDefined();
    act(() => inspectBtn?.click());
    expect(onSelectEntity).toHaveBeenCalledWith({ kind: "node", id: "ont" });
  });

  it("renders all 8 engineering report sections with multi-branch ODC/ODP statistics, all ONTs, cable analysis, and PASS assessment", () => {
    const project = createEmptyProject("Multi-Branch FTTH Project");
    const point = { type: "Point" as const, coordinates: [115.2, -8.6] as [number, number] };
    project.nodes = [
      { id: "olt-1", type: "olt", name: "OLT Central", location: point, properties: { txPowerDbm: 3, ponPortCapacity: 4 }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "odc-1", type: "odc", name: "ODC Main", location: point, properties: { feederPortCapacity: 2, distributionPortCapacity: 8 }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "odp-1", type: "odp", name: "ODP North", location: point, properties: { splitterRatio: "1:8", splitterLossDb: 10.5 }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "odp-2", type: "odp", name: "ODP South", location: point, properties: { splitterRatio: "1:16", splitterLossDb: 13.8 }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "ont-1", type: "ont", name: "ONT Alpha", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "ont-2", type: "ont", name: "ONT Beta", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "ont-3", type: "ont", name: "ONT Gamma", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
    ];
    project.cableSegments = [
      { id: "c-feeder", name: "Feeder Core 01", cableType: "feeder", fiberCount: 48, geometry: { type: "LineString", coordinates: [[115.2, -8.6], [115.21, -8.6]] }, lengthM: 1200, properties: { cableCategory: "feeder", attenuationDbPerKm: 0.35 }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "c-dist-1", name: "Dist North 01", cableType: "distribution", fiberCount: 24, geometry: { type: "LineString", coordinates: [[115.21, -8.6], [115.215, -8.6]] }, lengthM: 500, properties: { cableCategory: "distribution", attenuationDbPerKm: 0.35 }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "c-dist-2", name: "Dist South 02", cableType: "distribution", fiberCount: 24, geometry: { type: "LineString", coordinates: [[115.21, -8.6], [115.22, -8.6]] }, lengthM: 800, properties: { cableCategory: "distribution", attenuationDbPerKm: 0.35 }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "c-drop-1", name: "Drop Alpha", cableType: "drop", fiberCount: 2, geometry: { type: "LineString", coordinates: [[115.215, -8.6], [115.216, -8.6]] }, lengthM: 100, properties: { cableCategory: "drop", attenuationDbPerKm: 0.4 }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "c-drop-2", name: "Drop Beta", cableType: "drop", fiberCount: 2, geometry: { type: "LineString", coordinates: [[115.215, -8.6], [115.217, -8.6]] }, lengthM: 150, properties: { cableCategory: "drop", attenuationDbPerKm: 0.4 }, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "c-drop-3", name: "Drop Gamma", cableType: "drop", fiberCount: 2, geometry: { type: "LineString", coordinates: [[115.22, -8.6], [115.222, -8.6]] }, lengthM: 200, properties: { cableCategory: "drop", attenuationDbPerKm: 0.4 }, createdAt: project.createdAt, updatedAt: project.updatedAt },
    ];
    project.connections = [
      { id: "conn-f1", fromNodeId: "olt-1", toNodeId: "odc-1", cableSegmentId: "c-feeder", fromPortId: "PON-1", toPortId: "IN-01" },
      { id: "conn-d1", fromNodeId: "odc-1", toNodeId: "odp-1", cableSegmentId: "c-dist-1", fromPortId: "OUT-01", toPortId: "IN" },
      { id: "conn-d2", fromNodeId: "odc-1", toNodeId: "odp-2", cableSegmentId: "c-dist-2", fromPortId: "OUT-02", toPortId: "IN" },
      { id: "conn-dr1", fromNodeId: "odp-1", toNodeId: "ont-1", cableSegmentId: "c-drop-1", fromPortId: "OUT-1", toPortId: "PON-IN" },
      { id: "conn-dr2", fromNodeId: "odp-1", toNodeId: "ont-2", cableSegmentId: "c-drop-2", fromPortId: "OUT-2", toPortId: "PON-IN" },
      { id: "conn-dr3", fromNodeId: "odp-2", toNodeId: "ont-3", cableSegmentId: "c-drop-3", fromPortId: "OUT-1", toPortId: "PON-IN" },
    ];
    project.customers = [
      { id: "cust-1", name: "Subscriber Alpha", address: "Blok A1", location: point, status: "connected", ontNodeId: "ont-1", properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "cust-2", name: "Subscriber Beta", address: "Blok A2", location: point, status: "connected", ontNodeId: "ont-2", properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "cust-3", name: "Subscriber Gamma", address: "Blok B1", location: point, status: "connected", ontNodeId: "ont-3", properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
    ];

    const multiResult: OpticalBudgetResult = {
      projectId: project.id,
      calculatedAt: "2026-10-17T08:00:00.000Z",
      disconnectedCustomerIds: [],
      links: [
        { connectionId: "conn-f1", lengthM: 1200, lossDb: 0.92, receivedPowerDbm: 2.08, status: "pass" },
        { connectionId: "conn-d1", lengthM: 500, lossDb: 0.68, receivedPowerDbm: 1.4, status: "pass" },
        { connectionId: "conn-d2", lengthM: 800, lossDb: 0.78, receivedPowerDbm: 1.3, status: "pass" },
        { connectionId: "conn-dr1", lengthM: 100, lossDb: 0.54, receivedPowerDbm: -9.64, status: "pass" },
        { connectionId: "conn-dr2", lengthM: 150, lossDb: 0.56, receivedPowerDbm: -9.66, status: "pass" },
        { connectionId: "conn-dr3", lengthM: 200, lossDb: 0.58, receivedPowerDbm: -13.08, status: "pass" },
      ],
      intermediateNodes: [
        { nodeId: "odc-1", nodeName: "ODC Main", nodeType: "odc", status: "estimated", lengthM: 1200, accumulatedLossDb: 0.92, estimatedPowerDbm: 2.08, transmitterPowerDbm: 3 },
        { nodeId: "odp-1", nodeName: "ODP North", nodeType: "odp", status: "estimated", lengthM: 1700, accumulatedLossDb: 12.1, estimatedPowerDbm: -9.1, transmitterPowerDbm: 3 },
        { nodeId: "odp-2", nodeName: "ODP South", nodeType: "odp", status: "estimated", lengthM: 2000, accumulatedLossDb: 15.5, estimatedPowerDbm: -12.5, transmitterPowerDbm: 3 },
      ],
      paths: [
        {
          ontNodeId: "ont-1", customerIds: ["cust-1"], nodeIds: ["olt-1", "odc-1", "odp-1", "ont-1"], connectionIds: ["conn-f1", "conn-d1", "conn-dr1"],
          lengthM: 1800, lossDb: 12.64, txPowerDbm: 3, receivedPowerDbm: -9.64, rxSensitivityDbm: -27, rxOverloadDbm: -8, sensitivityMarginDb: 17.36, overloadMarginDb: 1.64, marginDb: 15.36, status: "pass", statusReason: "optical_budget_within_limits",
          categoryLossesDb: { fiber: 0.635, connector: 1.5, splice: 0.005, splitter: 10.5 },
        },
        {
          ontNodeId: "ont-2", customerIds: ["cust-2"], nodeIds: ["olt-1", "odc-1", "odp-1", "ont-2"], connectionIds: ["conn-f1", "conn-d1", "conn-dr2"],
          lengthM: 1850, lossDb: 12.66, txPowerDbm: 3, receivedPowerDbm: -9.66, rxSensitivityDbm: -27, rxOverloadDbm: -8, sensitivityMarginDb: 17.34, overloadMarginDb: 1.66, marginDb: 15.34, status: "pass", statusReason: "optical_budget_within_limits",
          categoryLossesDb: { fiber: 0.655, connector: 1.5, splice: 0.005, splitter: 10.5 },
        },
        {
          ontNodeId: "ont-3", customerIds: ["cust-3"], nodeIds: ["olt-1", "odc-1", "odp-2", "ont-3"], connectionIds: ["conn-f1", "conn-d2", "conn-dr3"],
          lengthM: 2200, lossDb: 16.08, txPowerDbm: 3, receivedPowerDbm: -13.08, rxSensitivityDbm: -27, rxOverloadDbm: -8, sensitivityMarginDb: 13.92, overloadMarginDb: 5.08, marginDb: 11.92, status: "pass", statusReason: "optical_budget_within_limits",
          categoryLossesDb: { fiber: 0.78, connector: 1.5, splice: 0, splitter: 13.8 },
        },
      ],
    };

    const view = render(<OpticalEngineeringReport project={project} result={multiResult} loading={false} error={null} onBack={() => undefined} />);

    // Verify all 8 section headers exist
    expect(view.querySelector("#section-1-executive-summary")?.textContent).toContain("Executive Summary");
    expect(view.querySelector("#section-2-network-infrastructure")?.textContent).toContain("Network Infrastructure Summary");
    expect(view.querySelector("#section-3-optical-power")?.textContent).toContain("Optical Power Summary");
    expect(view.querySelector("#section-4-detailed-link-budget")?.textContent).toContain("Detailed Optical Link Budget");
    expect(view.querySelector("#section-5-cable-infrastructure")?.textContent).toContain("Cable Infrastructure Analysis");
    expect(view.querySelector("#section-6-port-splitter")?.textContent).toContain("Port and Splitter Configuration");
    expect(view.querySelector("#section-7-engineering-conclusion")?.textContent).toContain("Engineering Conclusion");
    expect(view.querySelector("#section-8-recommendations")?.textContent).toContain("Engineering Recommendations");

    // Verify all 3 ONTs appear in the Optical Power Summary ONT table
    const sec3Text = view.querySelector("#section-3-optical-power")?.textContent ?? "";
    expect(sec3Text).toContain("ONT Alpha");
    expect(sec3Text).toContain("ONT Beta");
    expect(sec3Text).toContain("ONT Gamma");
    expect(sec3Text).toContain("ODP North");
    expect(sec3Text).toContain("ODP South");

    // Verify Section 7 Conclusion highlights highest/lowest Rx ONTs and PASS assessment
    const sec7Text = view.querySelector("#section-7-engineering-conclusion")?.textContent ?? "";
    expect(sec7Text).toContain("3 PASS · 0 FAIL · 0 UNKNOWN");
    expect(sec7Text).toContain("ONT Alpha (-9.64 dBm)");
    expect(sec7Text).toContain("ONT Gamma (-13.08 dBm)");
    expect(sec7Text).toContain("Feeder Core 01 (1,200 m · Feeder)");
    expect(sec7Text).toContain("PASS");
  });

  it("withholds PASS (reports INCOMPLETE) and generates evidence-based recommendations when data is missing or unconfigured", () => {
    const project = projectFixture();
    // Add an unconnected ONT and a cable with null length
    const point = project.nodes[0].location;
    project.nodes.push({ id: "ont-unconnected", type: "ont", name: "ONT Unconnected", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt });
    project.cableSegments.push({ id: "cable-missing-len", name: "Drop Missing Length", cableType: "drop", fiberCount: 2, geometry: { type: "LineString", coordinates: [] }, lengthM: null, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt });

    const view = render(<OpticalEngineeringReport project={project} result={opticalResult} loading={false} error={null} onBack={() => undefined} />);
    const sec1Text = view.querySelector("#section-1-executive-summary")?.textContent ?? "";
    const sec7Text = view.querySelector("#section-7-engineering-conclusion")?.textContent ?? "";
    const sec8Text = view.querySelector("#section-8-recommendations")?.textContent ?? "";

    expect(sec1Text).toContain("INCOMPLETE");
    expect(sec7Text).toContain("INCOMPLETE");
    expect(sec7Text).toContain("Drop Missing Length");
    expect(sec8Text).toContain("Drop Missing Length");
    expect(sec8Text).toContain("ONT Unconnected");
  });

  it("renders Cover Page metadata, Optical Power Budget formulas, suppresses raw route_field_verification_required warning logs, and strips UUID clutter", () => {
    const project = projectFixture();
    const pathWithRawWarning: OpticalBudgetResult["paths"][number] = {
      ...opticalResult.paths[0],
      diagnostics: [
        {
          code: "ROUTE_FIELD_VERIFICATION_REQUIRED",
          severity: "warning",
          category: "physical_deployment",
          message: "Cable 'Feeder 01 [5e69eae6]' (2e3281c9-3662-4959-817f-2272e2dc2e6f) has unverified geometry.",
          affectedEntityType: "cable",
          affectedEntityId: "2e3281c9-3662-4959-817f-2272e2dc2e6f",
          affectedEntityName: "Feeder 01 [5e69eae6]",
        },
      ],
    };

    const view = render(
      <OpticalEngineeringReport
        project={project}
        result={{ ...opticalResult, paths: [pathWithRawWarning] }}
        loading={false}
        error={null}
        onBack={() => undefined}
      />,
    );

    const coverText = view.querySelector("#section-1-cover-page")?.textContent ?? "";
    expect(coverText).toContain("FTTH Network Engineering Report");
    expect(coverText).toContain("FIBERPLAN");
    expect(coverText).toContain("GPON / FTTH");

    const formulaText = view.querySelector("#section-3-optical-power")?.textContent ?? "";
    expect(formulaText).toContain("L_fiber = Σ (L_i × α_i)");
    expect(formulaText).toContain("P_rx = P_tx − L_total");
    expect(formulaText).toContain("M_sensitivity = P_rx − P_min");
    expect(formulaText).toContain("M_overload = P_max − P_rx");

    // Raw ROUTE_FIELD_VERIFICATION_REQUIRED warning logs and UUIDs must not appear in visible report text
    const fullText = view.textContent ?? "";
    expect(fullText).not.toContain("ROUTE_FIELD_VERIFICATION_REQUIRED");
    expect(fullText).not.toContain("2e3281c9-3662-4959-817f-2272e2dc2e6f");
  });

  it("renders 16-section RAB report with customer metrics, splitter reconciliation, and document control", () => {
    const detailedRabResult: ConstructionCostResult = {
      projectId: "test-proj-calc-physical-20261031",
      calculatedAt: "2026-11-07T00:00:00.000Z",
      currency: "IDR",
      totalAmount: 250810250,
      totalCapex: 250810250,
      materialSubtotal: 132856100,
      installationSubtotal: 117954150,
      grandTotal: 250810250,
      plannedCustomerCount: 110,
      assignedOntCount: 110,
      connectedCustomerCount: 0,
      costPerPlannedCustomer: 2280093.18,
      costPerConnectedCustomer: null,
      complete: true,
      items: [
        { code: "CABLE-FEEDER-MAT", description: "Feeder cable 24-core", quantity: 1232.09, unit: "m", unitCost: 12500, amount: 15401125, category: "material", rateStatus: "Verified Quotation" },
        { code: "CABLE-FEEDER-INST", description: "Feeder cable aerial installation", quantity: 1232.09, unit: "m", unitCost: 8500, amount: 10472765, category: "installation", rateStatus: "Historical Rate" },
      ],
      summary: {
        activeSplitterCount: 16,
        feederSplitterCount: 2,
        distributionSplitterCount: 14,
        splitterCount: 16,
        cableQuantityAudit: [
          { category: "feeder", cableSegmentIds: ["feeder-1"], physicalLengthM: 1120.08, slackPercent: 10, billedLengthM: 1232.09 }
        ],
        poleStatusCounts: { proposed: 4, existing: 1, shared: 3, unverified: 1 }
      }
    };

    const view = render(
      <RabReport
        projectName="kenjo punya"
        result={detailedRabResult}
        loading={false}
        error={null}
        onBack={() => undefined}
      />
    );

    const text = view.textContent ?? "";
    expect(text).toContain("RAB-FTTH-2026-001");
    expect(text).toContain("Revised Preliminary Cost Estimate (Rev 1.1)");
    expect(text).toContain("Planned Customers (Pelanggan Direncanakan)");
    expect(text).toContain("Assigned ONTs (ONT Ditugaskan)");
    expect(text).toContain("Connected Customers (Pelanggan Aktif Terhubung)");
    expect(text).toContain("Pelanggan dengan status aktif operasional (0 pada fase pra-konstruksi/perencanaan)");
    expect(text).toContain("Estimated CAPEX per Planned Customer");
    expect(text).toContain("2,280,093.18");
    expect(text).toContain("N/A · Proyek berada pada tahap pra-konstruksi");
    expect(text).toContain("Rekonsiliasi Pengadaan Terverifikasi");
    expect(text).toContain("16");
    expect(text).toContain("Proposed (Tiang Baru)");
    expect(text).toContain("Existing (Tiang Eksisting)");
    expect(text).toContain("Shared (Tiang Bersama / PLN)");
    expect(text).toContain("Unverified (Belum Terverifikasi)");
  });
});
