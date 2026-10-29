import type { ConnectionValidationRequest, ConstructionCostResult, OpticalBudgetResult, PoleSpanResult, Project, TopologyValidationResult } from "../domain/types";

export interface ProjectApi {
  readonly mode: "http" | "memory";
  getProject(id: string): Promise<Project>;
  saveProject(project: Project): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  listProjects(): Promise<ProjectSummary[]>;
  calculateOpticalBudget(projectId: string): Promise<OpticalBudgetResult>;
  calculateConstructionCost(projectId: string): Promise<ConstructionCostResult>;
  calculatePoleSpans(projectId: string): Promise<PoleSpanResult>;
  validateTopology(projectId: string, project?: Project): Promise<TopologyValidationResult>;
  validateConnection(projectId: string, request: ConnectionValidationRequest): Promise<TopologyValidationResult>;
}
export type ProjectSummary = Pick<Project, "id" | "name" | "description" | "currency" | "updatedAt">;

export async function saveThenCalculate<T>(
  api: ProjectApi,
  project: Project,
  onSaved: (savedProject: Project) => boolean,
  calculate: (projectId: string) => Promise<T>,
): Promise<{ project: Project; result: T } | null> {
  const savedProject = await api.saveProject(project);
  if (!onSaved(savedProject)) return null;
  return { project: savedProject, result: await calculate(savedProject.id) };
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly details?: string[]) { super(message); this.name = "ApiError"; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
    && typeof value.description === "string" && typeof value.currency === "string"
    && typeof value.updatedAt === "string" && !Number.isNaN(Date.parse(value.updatedAt));
}

function parseProjectSummaryList(value: unknown): ProjectSummary[] {
  if (!isRecord(value) || !Array.isArray(value.projects) || !value.projects.every(isProjectSummary)) {
    throw new ApiError("The server returned an invalid project list. Refresh the list or contact support.");
  }
  return value.projects;
}

export function createHttpProjectApi(baseUrl = "/api/v1"): ProjectApi {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try { response = await fetch(`${normalizedBaseUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } }); }
    catch { throw new ApiError("Could not reach the project server. Check your connection and try again."); }
    if (!response.ok) {
      let message = `Request failed (${response.status}).`;
      let details: string[] | undefined;
      try {
        const body = await response.json();
        if (typeof body.error?.message === "string") message = body.error.message;
        else if (typeof body.detail === "string") message = body.detail;
        details = Array.isArray(body.error?.details) ? body.error.details.map((detail: { field?: string; message: string }) => `${detail.field ? `${detail.field}: ` : ""}${detail.message}`) : undefined;
      } catch { /* response had no JSON body */ }
      throw new ApiError(details?.length ? `${message} ${details.join("; ")}` : message, response.status, details);
    }
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; }
    catch { throw new ApiError("The server returned invalid JSON. Refresh the page or contact support.", response.status); }
  }
  return {
    mode: "http",
    getProject: (id) => request<Project>(`/projects/${encodeURIComponent(id)}`),
    saveProject: (project) => request<Project>(`/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify(project) }),
    deleteProject: (id) => request<void>(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
    async listProjects() { return parseProjectSummaryList(await request<unknown>(`/projects`)); },
    calculateOpticalBudget: (id) => request(`/projects/${encodeURIComponent(id)}/calculations/optical-budget`, { method: "POST" }),
    calculateConstructionCost: (id) => request(`/projects/${encodeURIComponent(id)}/calculations/construction-cost`, { method: "POST" }),
    calculatePoleSpans: (id) => request(`/projects/${encodeURIComponent(id)}/calculations/pole-spans`, { method: "POST" }),
    validateTopology: (id, project) => request(`/projects/${encodeURIComponent(id)}/validate-topology`, { method: "POST", ...(project ? { body: JSON.stringify(project) } : {}) }),
    validateConnection: (id, validation) => request(`/projects/${encodeURIComponent(id)}/validate-connection`, { method: "POST", body: JSON.stringify(validation) }),
  };
}

/** Non-persistent development adapter. It deliberately provides no fabricated calculations. */
export function createMemoryProjectApi(initial?: Project): ProjectApi {
  const projects = new Map<string, Project>();
  if (initial) projects.set(initial.id, structuredClone(initial));
  const unavailable = () => Promise.reject(new ApiError("Calculations are unavailable until the backend is connected."));
  return {
    mode: "memory",
    async getProject(id) { const project = projects.get(id); if (!project) throw new ApiError("Project not found.", 404); return structuredClone(project); },
    async saveProject(project) { const saved = { ...structuredClone(project), updatedAt: new Date().toISOString() }; projects.set(saved.id, saved); return structuredClone(saved); },
    async deleteProject(id) { if (!projects.delete(id)) throw new ApiError("Project not found.", 404); },
    async listProjects() { return Array.from(projects.values(), ({ id, name, description, currency, updatedAt }) => ({ id, name, description, currency, updatedAt })); },
    calculateOpticalBudget: unavailable,
    calculateConstructionCost: unavailable,
    calculatePoleSpans: unavailable,
    validateTopology: () => Promise.reject(new ApiError("Project topology validation requires the backend; local-session validation cannot apply authoritative FTTH rules.")),
    validateConnection: () => Promise.reject(new ApiError("Topology validation requires the backend; local-session validation cannot apply authoritative FTTH rules.")),
  };
}

export function createProjectApi(): ProjectApi {
  const baseUrl = import.meta.env.VITE_API_BASE_URL;
  return baseUrl ? createHttpProjectApi(baseUrl) : createMemoryProjectApi();
}
