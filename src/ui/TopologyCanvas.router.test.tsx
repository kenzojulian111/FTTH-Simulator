import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../domain/project";
import { TopologyCanvas } from "./TopologyCanvas";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

describe("Router logical topology node", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; });

  it("accepts Router palette drops and renders/selects the Router node", () => {
    const project = createEmptyProject("Router canvas");
    project.nodes.push({ id: "router-1", type: "router", name: "Home Router", location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt });
    const onAddDevice = vi.fn();
    const onSelect = vi.fn();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root?.render(<TopologyCanvas project={project} selection={null} onSelect={onSelect} onAddDevice={onAddDevice} onMove={() => undefined} onConnect={() => undefined} onInvalidConnect={() => undefined} />));
    const canvas = container.querySelector<SVGSVGElement>("svg.topology-canvas");
    expect(container.textContent).toContain("Home Router");
    expect(container.textContent).toContain("Router");
    expect(canvas).not.toBeNull();
    if (!canvas) return;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON: () => ({}) });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(drop, { clientX: { value: 420 }, clientY: { value: 250 }, dataTransfer: { value: { getData: () => "router" } } });
    act(() => canvas.dispatchEvent(drop));
    expect(onAddDevice).toHaveBeenCalledWith("router", { x: 420, y: 250 });
    act(() => container?.querySelector<SVGGElement>('[data-feature-id="router-1"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith({ kind: "node", id: "router-1" });
  });
});
