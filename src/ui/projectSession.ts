import type { Project } from "../domain/types";
import type { ProjectApi } from "../api/projectApi";

export const ACTIVE_PROJECT_SESSION_KEY = "ftth.activeProjectId";

export function readActiveProjectId(storage: Storage): string | null {
  try {
    const id = storage.getItem(ACTIVE_PROJECT_SESSION_KEY);
    return id?.trim() || null;
  } catch {
    return null;
  }
}

export function rememberActiveProjectId(storage: Storage, id: string): void {
  try { storage.setItem(ACTIVE_PROJECT_SESSION_KEY, id); } catch { /* Storage is a convenience pointer, never the project database. */ }
}

export function forgetActiveProjectId(storage: Storage): void {
  try { storage.removeItem(ACTIVE_PROJECT_SESSION_KEY); } catch { /* The backend remains authoritative. */ }
}

export async function restoreActiveProject(api: ProjectApi, storage: Storage): Promise<Project | null> {
  if (api.mode !== "http") return null;
  const id = readActiveProjectId(storage);
  return id ? api.getProject(id) : null;
}

export function mayReplaceUnsavedProject(dirty: boolean, confirm: () => boolean): boolean {
  return !dirty || confirm();
}

export function createNamedProjectCopy(project: Project, name: string, id: string, timestamp: string): Project {
  return { ...structuredClone(project), id, name: name.trim(), createdAt: timestamp, updatedAt: timestamp };
}
