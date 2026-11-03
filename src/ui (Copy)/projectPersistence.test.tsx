import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpProjectApi } from "../api/projectApi";
import type { ProjectSummary } from "../api/projectApi";
import { createEmptyProject } from "../domain/project";
import { createNamedProjectCopy, forgetActiveProjectId, mayReplaceUnsavedProject, readActiveProjectId, rememberActiveProjectId, restoreActiveProject } from "./projectSession";
import { ProjectLibrary } from "./ProjectLibrary";
import { SaveAsDialog } from "./SaveAsDialog";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

describe("project persistence workflow", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; vi.unstubAllGlobals(); });

  function render(element: ReactNode) {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container); act(() => root?.render(element)); return container;
  }

  const summary: ProjectSummary = { id: "saved-uuid", name: "Rural FTTH", description: "Phase one", currency: "IDR", updatedAt: "2026-10-17T00:00:00Z" };

  it("shows server projects and loads a row using its internal ID", () => {
    const onLoad = vi.fn();
    const view = render(<ProjectLibrary projects={[summary]} loading={false} loadingProjectId={null} error={null} sessionOnly={false} onRefresh={() => undefined} onLoad={onLoad} onClose={() => undefined} />);
    expect(view.textContent).toContain("Rural FTTH");
    expect(view.textContent).toContain("IDR");
    act(() => Array.from(view.querySelectorAll("button")).find((button) => button.textContent === "Load")?.click());
    expect(onLoad).toHaveBeenCalledWith(summary);
  });

  it("shows empty and unavailable project-list states", () => {
    const empty = render(<ProjectLibrary projects={[]} loading={false} loadingProjectId={null} error={null} sessionOnly={false} onRefresh={() => undefined} onLoad={() => undefined} onClose={() => undefined} />);
    expect(empty.textContent).toContain("No saved projects yet");
    act(() => root?.unmount()); root = null; empty.remove(); container = null;
    const failed = render(<ProjectLibrary projects={[]} loading={false} loadingProjectId={null} error="Could not reach the project server." sessionOnly={false} onRefresh={() => undefined} onLoad={() => undefined} onClose={() => undefined} />);
    expect(failed.querySelector('[role="alert"]')?.textContent).toContain("Could not reach the project server");
  });

  it("accepts a Save As name and calls the create action", () => {
    const onSave = vi.fn();
    const view = render(<SaveAsDialog initialName="Original copy" saving={false} error={null} onSave={onSave} onClose={() => undefined} />);
    const input = view.querySelector("input");
    expect(input).not.toBeNull();
    act(() => { if (input) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "New Design"); input.dispatchEvent(new Event("input", { bubbles: true })); } });
    const form = view.querySelector("form");
    expect(form).not.toBeNull();
    act(() => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSave).toHaveBeenCalledWith("New Design");
  });

  it("restores the active project by refetching its session ID from the backend", async () => {
    const storage = window.sessionStorage;
    forgetActiveProjectId(storage);
    expect(readActiveProjectId(storage)).toBeNull();
    rememberActiveProjectId(storage, summary.id);
    expect(readActiveProjectId(storage)).toBe(summary.id);
    const project = createEmptyProject("Restored from API");
    project.id = summary.id;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => project });
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1");
    await expect(restoreActiveProject(api, storage)).resolves.toEqual(project);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:8000/api/v1/projects/${summary.id}`);
    forgetActiveProjectId(storage);
    expect(readActiveProjectId(storage)).toBeNull();
  });

  it("requires confirmation before replacing dirty project edits", () => {
    const confirm = vi.fn(() => false);
    expect(mayReplaceUnsavedProject(true, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(mayReplaceUnsavedProject(false, confirm)).toBe(true);
  });

  it("Save As creates a new project ID while retaining design data", () => {
    const project = createEmptyProject("Original");
    project.description = "Keep this";
    project.nodes.push({ id: "olt", type: "olt", name: "OLT", location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt });
    const copy = createNamedProjectCopy(project, "  Copy  ", "new-uuid", "2026-10-17T01:00:00Z");
    expect(copy).toMatchObject({ id: "new-uuid", name: "Copy", description: "Keep this", createdAt: "2026-10-17T01:00:00Z" });
    expect(copy.nodes).toEqual(project.nodes);
    expect(copy.id).not.toBe(project.id);
  });

  it("saves and reloads a project with lecture optical profile, cable categories, pole spans, and 300m rules", async () => {
    const { LECTURE_OPTICAL_CONFIG } = await import("../domain/opticalProfiles");
    const project = createEmptyProject("Lecture FTTH Save Load");
    project.settings.opticalBudget = { ...LECTURE_OPTICAL_CONFIG };
    project.settings.poleSpanPlanning = {
      defaultMaxSpanM: 300,
      maxOdpToHouseDistanceM: 300,
      rules: [{ cableCategory: "feeder", maxSpanM: 300, placementPolicy: "uniform_maximum_spacing" }],
    };
    project.cableSegments = [{
      id: "c-feeder",
      name: "Feeder 01",
      cableType: "feeder",
      fiberCount: 24,
      geometry: { type: "LineString", coordinates: [[115, -8], [115.002, -8]] },
      lengthM: 222.4,
      properties: { cableCategory: "feeder", pigtailSplicesCount: 2 },
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }];
    project.poleSpans = [{
      id: "span-1",
      cableSegmentId: "c-feeder",
      fromPoleId: "p1",
      toPoleId: "p2",
      geometry: null,
      coversEntireCableRoute: true,
      status: "existing",
      notes: "Verified span",
      lengthM: 222.4,
    }];

    let storedPayload: unknown = null;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        storedPayload = JSON.parse(String(init.body));
        return { ok: true, status: 200, json: async () => storedPayload };
      }
      return { ok: true, status: 200, json: async () => storedPayload };
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = createHttpProjectApi("http://localhost:8000/api/v1");
    const saved = await api.saveProject(project);
    const loaded = await api.getProject(project.id);
    expect(saved.settings.opticalBudget.profileId).toBe("lecture_material_gpon_v1");
    expect(loaded.settings.opticalBudget.connectorLossDb).toBe(0.25);
    expect(loaded.settings.opticalBudget.splitterLossTable["1:4"]).toBe(7.25);
    expect(loaded.settings.opticalBudget.splitterLossTable["1:8"]).toBe(10.38);
    expect(loaded.cableSegments[0].properties.cableCategory).toBe("feeder");
    expect(loaded.poleSpans?.[0].lengthM).toBe(222.4);
  });
});
