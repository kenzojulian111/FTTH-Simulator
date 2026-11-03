import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../domain/project";
import { editorReducer, type EditorState } from "../state/editorReducer";
import { Inspector } from "./Inspector";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

describe("pole planning inspector", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; });

  it("edits pole properties and creates explicit cable-to-pole spans", () => {
    const project = createEmptyProject();
    project.nodes = [
      { id: "p1", type: "pole", name: "Pole 1", location: { type: "Point", coordinates: [0, 0] }, properties: {}, createdAt: "", updatedAt: "" },
      { id: "p2", type: "pole", name: "Pole 2", location: { type: "Point", coordinates: [0.001, 0] }, properties: {}, createdAt: "", updatedAt: "" },
    ];
    project.cableSegments = [{ id: "c1", name: "Route 1", cableType: "distribution", fiberCount: null, geometry: { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, lengthM: 111.2, properties: {}, createdAt: "", updatedAt: "" }];
    const onPoleProperties = vi.fn(); const onAddPoleSpan = vi.fn();
    const onDelete = vi.fn();
    const props = { project, selection: { kind: "node" as const, id: "p1" }, onRename: vi.fn(), onCustomerAddress: vi.fn(), onCustomerOnt: vi.fn(), onCustomerStatus: vi.fn(), onCableAttributes: vi.fn(), onRouterConfiguration: vi.fn(), onPoleProperties, onAddPoleSpan, onDeletePoleSpan: vi.fn(), onInvalidFiberCount: vi.fn(), onDelete };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root?.render(<Inspector {...props} />));
    const material = container.querySelector('[aria-label="Pole material"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(material, "Concrete"); material.dispatchEvent(new Event("input", { bubbles: true })); material.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onPoleProperties).toHaveBeenCalledWith("p1", { material: "Concrete" });
    act(() => root?.render(<Inspector {...props} selection={{ kind: "cable", id: "c1" }} />));
    const setSelect = (label: string, value: string) => { const select = container?.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement; act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); }); };
    setSelect("Span start pole", "p1"); setSelect("Span end pole", "p2");
    act(() => (Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Link poles to this route") as HTMLButtonElement).click());
    expect(onAddPoleSpan).toHaveBeenCalledWith(expect.objectContaining({ cableSegmentId: "c1", fromPoleId: "p1", toPoleId: "p2", coversEntireCableRoute: true }));
  });

  it("computes sub-span lengths for vertex-aligned intermediate poles and reports Unknown when sub-span geometry is unavailable", () => {
    const project = createEmptyProject();
    project.nodes = [
      { id: "p1", type: "pole", name: "Pole 1", location: { type: "Point", coordinates: [0, 0] }, properties: {}, createdAt: "", updatedAt: "" },
      { id: "p2", type: "pole", name: "Pole 2 Mid", location: { type: "Point", coordinates: [0.001, 0] }, properties: {}, createdAt: "", updatedAt: "" },
      { id: "p3", type: "pole", name: "Pole 3 End", location: { type: "Point", coordinates: [0.0025, 0] }, properties: {}, createdAt: "", updatedAt: "" },
    ];
    // Cable 1 has intermediate vertex at p2
    project.cableSegments = [
      { id: "c-segmented", name: "Segmented Cable", cableType: "distribution", fiberCount: 12, geometry: { type: "LineString", coordinates: [[0, 0], [0.001, 0], [0.0025, 0]] }, lengthM: 277.99, properties: {}, createdAt: "", updatedAt: "" },
      { id: "c-unsegmented", name: "Unsegmented Cable", cableType: "distribution", fiberCount: 12, geometry: { type: "LineString", coordinates: [[0, 0], [0.0025, 0]] }, lengthM: 277.99, properties: {}, createdAt: "", updatedAt: "" },
    ];

    let state: EditorState = { project, selection: { kind: "cable", id: "c-segmented" }, dirty: false };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);

    const renderState = () => {
      act(() => root?.render(
        <Inspector
          project={state.project}
          selection={state.selection}
          onRename={() => undefined}
          onCustomerAddress={() => undefined}
          onCustomerOnt={() => undefined}
          onCustomerStatus={() => undefined}
          onCableAttributes={() => undefined}
          onRouterConfiguration={() => undefined}
          onAddPoleSpan={(span) => { state = editorReducer(state, { type: "add-pole-span", span }); }}
          onInvalidFiberCount={() => undefined}
          onDelete={() => undefined}
        />,
      ));
    };

    const setSelect = (label: string, value: string) => {
      const select = container?.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    // Add first sub-span p1 -> p2 on c-segmented
    renderState();
    setSelect("Span start pole", "p1");
    setSelect("Span end pole", "p2");
    act(() => (Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Link poles to this route") as HTMLButtonElement).click());

    // Add second sub-span p2 -> p3 on c-segmented
    renderState();
    setSelect("Span start pole", "p2");
    setSelect("Span end pole", "p3");
    act(() => (Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Link poles to this route") as HTMLButtonElement).click());
    renderState();

    const segmentedSpans = (state.project.poleSpans ?? []).filter((s) => s.cableSegmentId === "c-segmented");
    expect(segmentedSpans).toHaveLength(2);
    expect(segmentedSpans[0].lengthM).toBeCloseTo(111.2, 1);
    expect(segmentedSpans[1].lengthM).toBeCloseTo(166.79, 1);
    expect(segmentedSpans[0].coversEntireCableRoute).toBe(false);
    expect(segmentedSpans[1].coversEntireCableRoute).toBe(false);

    // Now test c-unsegmented where p2 is NOT a vertex on the cable polyline
    state = { ...state, selection: { kind: "cable", id: "c-unsegmented" } };
    renderState();
    setSelect("Span start pole", "p1");
    setSelect("Span end pole", "p2");
    act(() => (Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Link poles to this route") as HTMLButtonElement).click());
    renderState();
    setSelect("Span start pole", "p2");
    setSelect("Span end pole", "p3");
    act(() => (Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "Link poles to this route") as HTMLButtonElement).click());
    renderState();

    const unsegmentedSpans = (state.project.poleSpans ?? []).filter((s) => s.cableSegmentId === "c-unsegmented");
    expect(unsegmentedSpans).toHaveLength(2);
    expect(unsegmentedSpans[0].lengthM).toBeNull();
    expect(unsegmentedSpans[1].lengthM).toBeNull();
    expect(container.textContent).toContain("Unknown");
  });

  it("cleans up or marks affected PoleSpan and OpticalComponent references on node or cable delete without touching unrelated records", () => {
    const project = createEmptyProject();
    project.nodes = [
      { id: "p1", type: "pole", name: "P1", location: { type: "Point", coordinates: [0, 0] }, properties: { status: "existing" }, createdAt: "", updatedAt: "" },
      { id: "p2", type: "pole", name: "P2", location: { type: "Point", coordinates: [0.001, 0] }, properties: { status: "existing" }, createdAt: "", updatedAt: "" },
      { id: "odp-1", type: "odp", name: "ODP 1", location: { type: "Point", coordinates: [0.001, 0] }, properties: {}, createdAt: "", updatedAt: "" },
      { id: "ont-1", type: "ont", name: "ONT 1", location: { type: "Point", coordinates: [0.002, 0] }, properties: {}, createdAt: "", updatedAt: "" },
      { id: "odp-keep", type: "odp", name: "ODP Keep", location: { type: "Point", coordinates: [0.003, 0] }, properties: {}, createdAt: "", updatedAt: "" },
    ];
    project.cableSegments = [
      { id: "c-del", name: "Cable Delete", cableType: "drop", fiberCount: 2, geometry: { type: "LineString", coordinates: [[0.001, 0], [0.002, 0]] }, lengthM: 111.2, properties: {}, createdAt: "", updatedAt: "" },
      { id: "c-keep", name: "Cable Keep", cableType: "feeder", fiberCount: 12, geometry: { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, lengthM: 111.2, properties: {}, createdAt: "", updatedAt: "" },
    ];
    project.connections = [
      { id: "conn-del", fromNodeId: "odp-1", toNodeId: "ont-1", cableSegmentId: "c-del" },
    ];
    project.poleSpans = [
      { id: "span-on-c-del", cableSegmentId: "c-del", fromPoleId: "p1", toPoleId: "p2", coversEntireCableRoute: true, status: "existing", notes: "", lengthM: 111.2 },
      { id: "span-on-c-keep", cableSegmentId: "c-keep", fromPoleId: "p1", toPoleId: "p2", coversEntireCableRoute: true, status: "existing", notes: "", lengthM: 111.2 },
    ];
    project.opticalComponents = [
      { id: "comp-on-conn-del", kind: "connector", connectionId: "conn-del", configuredLossDb: 0.25, configuredSource: "configured" },
      { id: "comp-on-odp-1", kind: "splice", nodeId: "odp-1", configuredLossDb: 0.1, configuredSource: "configured" },
      { id: "comp-on-odp-keep", kind: "attenuator", nodeId: "odp-keep", configuredLossDb: 0.5, configuredSource: "configured" },
    ];

    // 1. Delete cable c-del -> removes span-on-c-del and comp-on-conn-del, preserves span-on-c-keep and node components
    const afterCableDelete = editorReducer({ project, selection: { kind: "cable", id: "c-del" }, dirty: false }, { type: "delete", ref: { kind: "cable", id: "c-del" } });
    expect(afterCableDelete.project.poleSpans?.map((s) => s.id)).toEqual(["span-on-c-keep"]);
    expect(afterCableDelete.project.opticalComponents?.map((c) => c.id)).toEqual(["comp-on-odp-1", "comp-on-odp-keep"]);

    // 2. Delete node odp-1 -> removes comp-on-odp-1, preserves comp-on-odp-keep
    const afterNodeDelete = editorReducer(afterCableDelete, { type: "delete", ref: { kind: "node", id: "odp-1" } });
    expect(afterNodeDelete.project.opticalComponents?.map((c) => c.id)).toEqual(["comp-on-odp-keep"]);

    // 3. Delete pole p1 -> marks span-on-c-keep as unverified
    const afterPoleDelete = editorReducer(afterNodeDelete, { type: "delete", ref: { kind: "node", id: "p1" } });
    expect(afterPoleDelete.project.poleSpans?.[0].status).toBe("unverified");
  });

  it("keeps configured, datasheet, and field component values separately editable", () => {
    const project = createEmptyProject();
    project.nodes = [{ id: "odp", type: "odp", name: "ODP", location: { type: "Point", coordinates: [0, 0] }, properties: {}, createdAt: "", updatedAt: "" }];
    project.opticalComponents = [{ id: "sp-1", kind: "splice", nodeId: "odp", location: "ODP", configuredLossDb: null, configuredSource: "unknown", datasheetLossDb: 0.1, datasheetReference: "doc:1", measuredLossDb: 0.12, measuredAt: "2026-10-01T00:00:00Z", measurementMethod: "meter" }];
    const onOpticalComponentsChange = vi.fn();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root?.render(<Inspector project={project} selection={{ kind: "node", id: "odp" }} onRename={() => undefined} onCustomerAddress={() => undefined} onCustomerOnt={() => undefined} onCustomerStatus={() => undefined} onCableAttributes={() => undefined} onRouterConfiguration={() => undefined} onOpticalComponentsChange={onOpticalComponentsChange} onInvalidFiberCount={() => undefined} onDelete={() => undefined} />));
    const configuredLoss = container.querySelector('[aria-label="sp-1 configured loss"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(configuredLoss, "0.2"); configuredLoss.dispatchEvent(new Event("input", { bubbles: true })); configuredLoss.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onOpticalComponentsChange).toHaveBeenCalledWith([expect.objectContaining({ configuredLossDb: 0.2, configuredSource: "configured", datasheetLossDb: 0.1, measuredLossDb: 0.12 })]);
  });

  it("updates explicit cable category and pigtail splices in the inspector", () => {
    const project = createEmptyProject();
    project.cableSegments = [{ id: "c1", name: "Route 1", cableType: "", fiberCount: 12, geometry: { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, lengthM: 100, properties: {}, createdAt: "", updatedAt: "" }];
    const onCableAttributes = vi.fn();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root?.render(<Inspector project={project} selection={{ kind: "cable", id: "c1" }} onRename={() => undefined} onCustomerAddress={() => undefined} onCustomerOnt={() => undefined} onCustomerStatus={() => undefined} onCableAttributes={onCableAttributes} onRouterConfiguration={() => undefined} onInvalidFiberCount={() => undefined} onDelete={() => undefined} />));
    const catSelect = container.querySelector('[aria-label="Cable category"]') as HTMLSelectElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(catSelect, "feeder"); catSelect.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onCableAttributes).toHaveBeenCalledWith("c1", "feeder", 12, { cableCategory: "feeder", cableCategorySource: "manual" });
  });

  it("updates cable deployment method without erasing geometry or topology, hides pole-span creation for non-aerial cables, and preserves existing linked spans", () => {
    const project = createEmptyProject();
    project.nodes = [
      { id: "olt", type: "olt", name: "OLT", location: { type: "Point", coordinates: [0, 0] }, properties: {}, createdAt: "", updatedAt: "" },
      { id: "odp", type: "odp", name: "ODP", location: { type: "Point", coordinates: [0.001, 0] }, properties: {}, createdAt: "", updatedAt: "" },
      { id: "p1", type: "pole", name: "Pole 1", location: { type: "Point", coordinates: [0, 0] }, properties: {}, createdAt: "", updatedAt: "" },
      { id: "p2", type: "pole", name: "Pole 2", location: { type: "Point", coordinates: [0.001, 0] }, properties: {}, createdAt: "", updatedAt: "" },
    ];
    project.cableSegments = [{
      id: "c1", name: "Feeder 1", cableType: "feeder", fiberCount: 24, deploymentMethod: "aerial",
      geometry: { type: "LineString", coordinates: [[0, 0], [0.001, 0]] }, lengthM: 111.2,
      startNodeId: "olt", endNodeId: "odp", properties: { cableCategory: "feeder" }, createdAt: "", updatedAt: "",
    }];
    project.connections = [{ id: "conn-1", fromNodeId: "olt", toNodeId: "odp", cableSegmentId: "c1" }];
    project.poleSpans = [{ id: "span-existing", cableSegmentId: "c1", fromPoleId: "p1", toPoleId: "p2", coversEntireCableRoute: true, status: "existing", notes: "", lengthM: 111.2 }];

    let state: EditorState = { project, selection: { kind: "cable", id: "c1" }, dirty: false };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);

    const renderInspector = () => {
      act(() => root?.render(
        <Inspector
          project={state.project}
          selection={state.selection}
          onRename={() => undefined}
          onCustomerAddress={() => undefined}
          onCustomerOnt={() => undefined}
          onCustomerStatus={() => undefined}
          onCableAttributes={(id, cableType, fiberCount, properties) => {
            state = editorReducer(state, { type: "cable-attributes", id, cableType, fiberCount, properties });
          }}
          onRouterConfiguration={() => undefined}
          onAddPoleSpan={(span) => { state = editorReducer(state, { type: "add-pole-span", span }); }}
          onDeletePoleSpan={(id) => { state = editorReducer(state, { type: "delete-pole-span", id }); }}
          onInvalidFiberCount={() => undefined}
          onDelete={() => undefined}
        />,
      ));
    };

    renderInspector();
    // Initially aerial -> "Link poles to this route" button is visible
    expect(container.querySelector('[aria-label="Span start pole"]')).not.toBeNull();

    // Change deployment method to underground
    const depSelect = container.querySelector('[aria-label="Deployment method"]') as HTMLSelectElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(depSelect, "underground");
      depSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    renderInspector();

    // Verify cable geometry, length, and topology connection are untouched
    const updatedCable = state.project.cableSegments[0];
    expect(updatedCable.deploymentMethod).toBe("underground");
    expect(updatedCable.properties.deploymentMethod).toBe("underground");
    expect(updatedCable.geometry.coordinates).toEqual([[0, 0], [0.001, 0]]);
    expect(updatedCable.lengthM).toBe(111.2);
    expect(state.project.connections).toHaveLength(1);

    // Pole-span creation controls are hidden for underground deployment, but existing linked span remains visible
    expect(container.querySelector('[aria-label="Span start pole"]')).toBeNull();
    expect(container.textContent).toContain("Poles and pole-span constraints are not required for this cable");
    expect(container.textContent).toContain("Pole 1 → Pole 2");
  });
});
