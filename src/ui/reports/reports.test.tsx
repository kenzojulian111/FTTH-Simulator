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
    expect(view.textContent).toContain("splitters 8 dB");
    expect(view.textContent).toContain("Customer One");
    expect(view.textContent).toContain("customer-offline");
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
});
