import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpProjectApi, createMemoryProjectApi, ApiError, saveThenCalculate } from "./projectApi";
import { createEmptyProject } from "../domain/project";
import { readRouterConfiguration } from "../domain/routerConfig";

describe("memory project API adapter", () => {
  it("saves and loads a project within the current adapter session", async () => {
    const api = createMemoryProjectApi();
    const project = createEmptyProject("Adapter test");
    project.nodes.push({ id: "router-1", type: "router", name: "Home Router", location: { type: "Point", coordinates: [115, -8] }, properties: { routerConfiguration: { hostname: "home-router", wanMode: "dhcp-client", lanIpv4Address: "192.168.1.1", lanPrefix: 24, dhcpServerEnabled: true, dhcpPoolStart: "192.168.1.20", dhcpPoolEnd: "192.168.1.200" } }, createdAt: project.createdAt, updatedAt: project.updatedAt });
    const saved = await api.saveProject(project);
    expect((await api.getProject(project.id)).name).toBe("Adapter test");
    expect(readRouterConfiguration((await api.getProject(project.id)).nodes[0].properties.routerConfiguration).hostname).toBe("home-router");
    expect(saved.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(await api.listProjects()).toHaveLength(1);
  });

  it("reports missing projects and unavailable real calculations explicitly", async () => {
    const api = createMemoryProjectApi();
    await expect(api.getProject("missing")).rejects.toBeInstanceOf(ApiError);
    await expect(api.calculateOpticalBudget("missing")).rejects.toThrow("unavailable");
    await expect(api.calculateConstructionCost("missing")).rejects.toThrow("unavailable");
    await expect(api.validateConnection("draft-id", { fromNodeId: "a", toNodeId: "b", cableSegmentId: "c" })).rejects.toThrow("requires the backend");
    await expect(api.validateTopology("draft-id")).rejects.toThrow("requires the backend");
  });
});

describe("HTTP project API adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the configured API base and backend camelCase project routes", async () => {
    const project = createEmptyProject("HTTP test");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => project })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => project })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1/");

    await api.getProject(project.id);
    await api.saveProject(project);
    await api.listProjects();

    expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:8000/api/v1/projects/${project.id}`);
    expect(fetchMock.mock.calls[1][0]).toBe(`http://localhost:8000/api/v1/projects/${project.id}`);
    expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).settings.opticalBudget.txPowerDbm).toBe(2.5);
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:8000/api/v1/projects");
  });

  it("reads saved project summaries and rejects malformed list responses", async () => {
    const project = createEmptyProject("Listed project");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ projects: [{ id: project.id, name: project.name, description: "A design", currency: "IDR", updatedAt: project.updatedAt }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ projects: [{ id: "missing-fields" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1");
    await expect(api.listProjects()).resolves.toEqual([{ id: project.id, name: project.name, description: "A design", currency: "IDR", updatedAt: project.updatedAt }]);
    await expect(api.listProjects()).rejects.toThrow("invalid project list");
  });

  it("includes Router configuration in the project save payload for a Router-capable backend", async () => {
    const project = createEmptyProject("Router HTTP contract");
    project.nodes.push({ id: "router-1", type: "router", name: "Router", location: { type: "Point", coordinates: [115, -8] }, properties: { routerConfiguration: { hostname: "customer-edge", wanMode: "pppoe", lanIpv4Address: "192.168.5.1", lanPrefix: 24, dhcpServerEnabled: false, natEnabled: true } }, createdAt: project.createdAt, updatedAt: project.updatedAt });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => project });
    vi.stubGlobal("fetch", fetchMock);
    await createHttpProjectApi("http://localhost:8000/api/v1").saveProject(project);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as typeof project;
    expect(body.nodes[0].type).toBe("router");
    expect(body.nodes[0].properties.routerConfiguration).toEqual(project.nodes[0].properties.routerConfiguration);
  });

  it("saves an unconnected multi-vertex cable without inventing endpoint IDs or a topology link", async () => {
    const project = createEmptyProject("Unconnected route contract");
    project.cableSegments.push({ id: "route-1", name: "Road route", cableType: "single-mode", fiberCount: 12, geometry: { type: "LineString", coordinates: [[115, -8], [115.001, -8.002], [115.003, -8]] }, lengthM: null, startNodeId: null, endNodeId: null, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => project });
    vi.stubGlobal("fetch", fetchMock);
    await createHttpProjectApi("http://localhost:8000/api/v1").saveProject(project);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as typeof project;
    expect(body.cableSegments[0].geometry.coordinates).toHaveLength(3);
    expect(body.cableSegments[0].startNodeId).toBeNull();
    expect(body.cableSegments[0].endNodeId).toBeNull();
    expect(body.connections).toEqual([]);
  });

  it("surfaces backend validation details from its error envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: { code: "validation_error", message: "Invalid project", details: [{ field: "nodes[0].name", message: "Must not be empty" }] } }) });
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1");

    await expect(api.saveProject(createEmptyProject())).rejects.toThrow("nodes[0].name: Must not be empty");
  });

  it("uses the registered calculation routes and returns backend results", async () => {
    const project = createEmptyProject("Calculation route test");
    const optical = { projectId: project.id, calculatedAt: project.updatedAt, links: [], paths: [], disconnectedCustomerIds: [] };
    const cost = { projectId: project.id, calculatedAt: project.updatedAt, currency: "IDR", totalAmount: 0, items: [], totalCapex: 0, costPerConnectedCustomer: null, connectedCustomerCount: 0 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => optical })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => cost });
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1");

    expect(await api.calculateOpticalBudget(project.id)).toEqual(optical);
    expect(await api.calculateConstructionCost(project.id)).toEqual(cost);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [`http://localhost:8000/api/v1/projects/${project.id}/calculations/optical-budget`, "POST"],
      [`http://localhost:8000/api/v1/projects/${project.id}/calculations/construction-cost`, "POST"],
    ]);
  });

  it("calls the explicit pole-span planning endpoint", async () => {
    const project = createEmptyProject("Pole calculation route");
    const poleResult = { projectId: project.id, calculatedAt: project.updatedAt, spans: [], diagnostics: [], estimatedAdditionalPoles: null, assumptions: ["No route coverage"] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => poleResult });
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1");
    await expect(api.calculatePoleSpans(project.id)).resolves.toEqual(poleResult);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:8000/api/v1/projects/${project.id}/calculations/pole-spans`);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("posts the current project draft to the authoritative full-topology validator", async () => {
    const project = createEmptyProject("Topology audit");
    const validation = { valid: false, errors: [{ code: "no_path", message: "No OLT path", severity: "error" as const }], warnings: [], summary: {} };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => validation });
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1");

    await expect(api.validateTopology(project.id, project)).resolves.toEqual(validation);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:8000/api/v1/projects/${project.id}/validate-topology`);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).id).toBe(project.id);
  });

  it("preserves the backend message for a missing project calculation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "not_found", message: "Project with ID 'missing' was not found.", details: null } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1");

    await expect(api.calculateConstructionCost("missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Project with ID 'missing' was not found.",
    });
  });

  it("preserves FastAPI detail text for a deleted project", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: "Project was deleted." }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(createHttpProjectApi("http://localhost:8000/api/v1").getProject("gone")).rejects.toMatchObject({ status: 404, message: "Project was deleted." });
  });

  it("persists the project before calculating with the canonical saved ID", async () => {
    const project = createEmptyProject("Save before calculation");
    const savedProject = { ...project, updatedAt: "2026-10-17T09:00:00Z" };
    const cost = { projectId: project.id, calculatedAt: savedProject.updatedAt, currency: "IDR", totalAmount: 0, items: [], totalCapex: 0, costPerConnectedCustomer: null, connectedCustomerCount: 0 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => savedProject })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => cost });
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1");
    const lifecycle: string[] = [];

    const outcome = await saveThenCalculate(api, project, () => { lifecycle.push("saved"); return true; }, async (id) => {
      lifecycle.push("calculation");
      return api.calculateConstructionCost(id);
    });

    expect(lifecycle).toEqual(["saved", "calculation"]);
    expect(outcome?.project.updatedAt).toBe(savedProject.updatedAt);
    expect(outcome?.result).toEqual(cost);
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(fetchMock.mock.calls[1][0]).toBe(`http://localhost:8000/api/v1/projects/${project.id}/calculations/construction-cost`);
  });
});
