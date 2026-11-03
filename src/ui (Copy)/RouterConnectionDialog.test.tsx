import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpProjectApi } from "../api/projectApi";
import { createEmptyProject } from "../domain/project";
import { ConnectionDialog } from "./ConnectionDialog";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

describe("ONT to Router backend validation", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; vi.unstubAllGlobals(); });

  async function mount(allowRouter: boolean) {
    const project = createEmptyProject("Router link");
    const point = { type: "Point" as const, coordinates: [115, -8] as [number, number] };
    project.nodes = [
      { id: "ont-1", type: "ont", name: "ONT 1", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "router-1", type: "router", name: "Router 1", location: point, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
    ];
    project.cableSegments = [{ id: "ethernet-link", name: "Customer Ethernet", cableType: "Ethernet", fiberCount: null, geometry: { type: "LineString", coordinates: [[115, -8], [115.0001, -8]] }, lengthM: null, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt }];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { fromNodeId: string; toNodeId: string };
      const valid = allowRouter && request.fromNodeId === "ont-1" && request.toNodeId === "router-1";
      return { ok: true, status: 200, json: async () => ({ valid, errors: valid ? [] : [{ code: "invalid_connection_direction", policyCode: "incompatible-types", message: "Backend policy does not allow this link", severity: "error" }], warnings: [], summary: { fromNodeType: "ont", toNodeType: "router", allowedTransition: valid } }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const connect = vi.fn();
    const validateWithBackend = createHttpProjectApi("http://localhost:8000/api/v1").validateConnection;
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root?.render(<ConnectionDialog project={project} initialSourceId="ont-1" initialDestinationId="router-1" initialCableId="ethernet-link" validateWithBackend={validateWithBackend} onClose={() => undefined} onConnect={connect} />));
    await act(async () => { await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled()); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await vi.waitFor(() => expect(container?.textContent).toContain(allowRouter ? "Backend approved this connection." : "Backend policy does not allow this link"));
    return { view: container, connect };
  }

  it("allows creation only when the backend validation contract approves ONT-to-Router", async () => {
    const { view, connect } = await mount(true);
    const button = Array.from(view.querySelectorAll("button")).find((item) => item.textContent?.includes("Connect"));
    expect(button?.disabled).toBe(false);
    act(() => button?.click());
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ fromNodeId: "ont-1", toNodeId: "router-1", cableSegmentId: "ethernet-link" }));
  });

  it("blocks creation when the backend rejects ONT-to-Router", async () => {
    const { view, connect } = await mount(false);
    const button = Array.from(view.querySelectorAll("button")).find((item) => item.textContent?.includes("Connect"));
    expect(button?.disabled).toBe(true);
    act(() => button?.click());
    expect(connect).not.toHaveBeenCalled();
  });
});
