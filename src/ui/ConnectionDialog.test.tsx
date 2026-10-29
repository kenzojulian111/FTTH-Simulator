import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../domain/project";
import { createHttpProjectApi } from "../api/projectApi";
import { ConnectionDialog } from "./ConnectionDialog";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

function projectFixture() {
  const project = createEmptyProject("Modal test");
  const now = project.createdAt;
  const point = { type: "Point" as const, coordinates: [115, -8] as [number, number] };
  project.nodes = [
    { id: "olt", type: "olt", name: "OLT 1", location: point, properties: {}, createdAt: now, updatedAt: now },
    { id: "odc", type: "odc", name: "ODC 1", location: point, properties: {}, createdAt: now, updatedAt: now },
    { id: "odp", type: "odp", name: "ODP 1", location: point, properties: {}, createdAt: now, updatedAt: now },
  ];
  project.cableSegments = [{ id: "cable-1", name: "Feeder", cableType: "", fiberCount: null, geometry: { type: "LineString", coordinates: [[115, -8], [115.001, -8]] }, lengthM: null, properties: {}, createdAt: now, updatedAt: now }];
  return project;
}

describe("Create Connection dialog", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  it("validates an unsaved draft through the documented endpoint before creating a connection", async () => {
    const project = projectFixture();
    const resolveValidations: Array<(response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void> = [];
    const requestCalls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      requestCalls.push({ url, init });
      return new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) => { resolveValidations.push(resolve); });
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1");
    const onConnect = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<ConnectionDialog project={project} validateWithBackend={api.validateConnection} onClose={() => undefined} onConnect={onConnect} />));

    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("Create Connection");
    expect(container.textContent).toContain("Choose a source device.");
    const selects = container.querySelectorAll("select");
    const connect = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Connect"));
    expect(connect?.disabled).toBe(true);

    act(() => {
      selects[0].value = "olt";
      selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      selects[2].value = "cable-1";
      selects[2].dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveValidations.forEach((resolve) => resolve({ ok: true, status: 200, json: async () => ({ valid: true, errors: [], warnings: [], summary: { fromNodeType: "olt", toNodeType: "odc", allowedTransition: true } }) }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(selects[1].querySelector<HTMLOptionElement>('option[value="odc"]')?.disabled).toBe(false));
    act(() => {
      selects[1].value = "odc";
      selects[1].dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(connect?.disabled).toBe(false);
    act(() => connect?.click());
    expect(onConnect).toHaveBeenCalledWith({ id: expect.any(String), fromNodeId: "olt", toNodeId: "odc", cableSegmentId: "cable-1" });
    expect(requestCalls[0].url).toBe(`http://localhost:8000/api/v1/projects/${project.id}/validate-connection`);
    expect(requestCalls[0].init?.method).toBe("POST");
    const requestBody = requestCalls[0].init?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody === "string") expect(JSON.parse(requestBody)).toEqual({ fromNodeId: "olt", toNodeId: "odc", cableSegmentId: "cable-1", project });
  });

  it("disables backend-rejected destinations and prevents connection creation", async () => {
    const project = projectFixture();
    const resolveValidations: Array<(response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void> = [];
    const fetchMock = vi.fn(() => new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) => { resolveValidations.push(resolve); }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1");
    const onConnect = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<ConnectionDialog project={project} initialSourceId="odp" initialDestinationId="odc" initialCableId="cable-1" validateWithBackend={api.validateConnection} onClose={() => undefined} onConnect={onConnect} />));

    const destinationOptions = Array.from(container.querySelectorAll("select")[1].options).map((option) => option.value);
    expect(destinationOptions).not.toContain("odp");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveValidations.forEach((resolve) => resolve({ ok: true, status: 200, json: async () => ({ valid: false, errors: [{ code: "invalid_connection_direction", policyCode: "incompatible-types", message: "Invalid GPON optical flow: cannot connect ODP to ODC", severity: "error" }], warnings: [], summary: { allowedTransition: false } }) }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(container?.textContent).toContain("Invalid GPON optical flow: cannot connect ODP to ODC"));
    const connect = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Connect"));
    expect(connect?.disabled).toBe(true);
    act(() => connect?.click());
    expect(onConnect).not.toHaveBeenCalled();
  });
});
