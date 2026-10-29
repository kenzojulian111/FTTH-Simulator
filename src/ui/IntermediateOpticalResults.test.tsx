import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { OpticalBudgetResult } from "../domain/types";
import { IntermediateOpticalResults } from "./IntermediateOpticalResults";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

type IntermediateNode = NonNullable<OpticalBudgetResult["intermediateNodes"]>[number];

describe("Engineering Results intermediate optical entries", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  function render(intermediateNodes: IntermediateNode[]) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<IntermediateOpticalResults intermediateNodes={intermediateNodes} />));
    return host;
  }

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
  });

  it("shows ODC and ODP power, connectivity, accumulated metrics, and returned loss contributions", () => {
    const entries: IntermediateNode[] = [
      {
        nodeId: "odc", nodeName: "ODC North", nodeType: "odc", status: "estimated",
        nodeIds: ["olt", "odc"], sourceOltName: "OLT West", lengthM: 1200,
        accumulatedLossDb: 9.2, estimatedPowerDbm: -6.2,
        lossBreakdown: [
          { componentId: "fiber-1", component: "Feeder fiber", category: "fiber", position: "OLT West → ODC North", quantity: 1200, quantityUnit: "m", unitLossDb: 0.35, unitLossUnit: "dB/km", totalLossDb: 0.42, cumulativeLossDb: 0.42, source: "configured", pathPosition: 0 },
          { componentId: "connector-1", component: "Connector pair", category: "connector", position: "OLT West → ODC North", quantity: 2, quantityUnit: "connector", unitLossDb: 0.2, unitLossUnit: "dB/connector", totalLossDb: 0.4, cumulativeLossDb: 0.82, source: "configured", pathPosition: 1 },
          { componentId: "splice-1", component: "Field splice", category: "splice", position: "OLT West → ODC North", quantity: 1, quantityUnit: "splice", unitLossDb: 0.1, unitLossUnit: "dB/splice", totalLossDb: 0.1, cumulativeLossDb: 0.92, source: "configured", pathPosition: 2 },
          { componentId: "splitter-1", component: "PLC 1:8", category: "splitter", position: "At ODC North", quantity: 1, quantityUnit: "device", unitLossDb: 8, unitLossUnit: "dB/device", totalLossDb: 8, cumulativeLossDb: 8.92, source: "configured", pathPosition: 3 },
          { componentId: "passive-1", component: "Splice tray adapter", category: "passive_component", position: "At ODC North", quantity: 1, quantityUnit: "device", unitLossDb: 0.28, unitLossUnit: "dB/device", totalLossDb: 0.28, cumulativeLossDb: 9.2, source: "configured", pathPosition: 4 },
        ],
        categoryLossesDb: { fiber: 0.42, connector: 0.4, splice: 0.1, splitter: 8, passive_component: 0.28 },
      },
      {
        nodeId: "odp", nodeName: "ODP Block 4", nodeType: "odp", status: "unknown",
        nodeIds: ["olt", "odc", "odp"], sourceOltName: "OLT West", lengthM: 1800,
        accumulatedLossDb: null, estimatedPowerDbm: null,
        parameterSources: { "drop.fiberAttenuationDbPerKm": "legacy_fallback", "odp.splitterLossDb": "unknown" },
        diagnostics: ["Drop fiber attenuation uses legacy fallback.", "ODP insertion loss is unknown."],
      },
    ];
    const view = render(entries);

    expect(view.textContent).toContain("ODC North");
    expect(view.textContent).toContain("ODP Block 4");
    expect(view.textContent).toContain("Directed path found");
    expect(view.textContent).toContain("Estimated optical power");
    expect(view.textContent).toContain("-6.20 dBm");
    expect(view.textContent).toContain("9.20 dB");
    expect(view.textContent).toContain("1200.00 m");
    const lossDetails = view.querySelector<HTMLDetailsElement>(".intermediate-result-details");
    act(() => lossDetails?.querySelector("summary")?.click());
    expect(lossDetails?.open).toBe(true);
    expect(view.textContent).toContain("Fiber · Feeder fiber");
    expect(view.textContent).toContain("Connector · Connector pair");
    expect(view.textContent).toContain("Splice · Field splice");
    expect(view.textContent).toContain("Splitter insertion loss · PLC 1:8");
    expect(view.textContent).toContain("Other passive component · Splice tray adapter");
    expect(view.textContent).toContain("Per segment / component");
    expect(view.textContent).toContain("Cumulative path loss");
    expect(view.textContent).toContain("legacy fallback");
    expect(view.textContent).toContain("unknown");
    expect(view.textContent).toContain("ODP insertion loss is unknown.");
    expect(view.textContent).not.toContain("PASS");
    expect(view.textContent).not.toContain("Sensitivity headroom");
    expect(view.textContent).not.toContain("Overload headroom");
  });

  it("labels ambiguous and unreachable intermediate paths without presenting estimates as passing", () => {
    const view = render([
      { nodeId: "odc-amb", nodeName: "ODC Ambiguous", nodeType: "odc", status: "ambiguous", lengthM: null, accumulatedLossDb: null, estimatedPowerDbm: null, diagnostics: ["Multiple directed paths reach this passive node."] },
      { nodeId: "odp-away", nodeName: "ODP Unreachable", nodeType: "odp", status: "unreachable", lengthM: null, accumulatedLossDb: null, estimatedPowerDbm: null, diagnostics: ["No evaluated directed OLT path reaches this node."] },
    ]);

    expect(view.textContent).toContain("Ambiguous path");
    expect(view.textContent).toContain("Multiple candidate paths");
    expect(view.textContent).toContain("Unreachable");
    expect(view.textContent).toContain("Unknown");
    expect(view.textContent).toContain("Multiple directed paths reach this passive node.");
    expect(view.textContent).toContain("No evaluated directed OLT path reaches this node.");
    expect(view.textContent).not.toContain("PASS");
  });
});
