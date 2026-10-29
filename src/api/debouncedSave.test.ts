import { afterEach, describe, expect, it, vi } from "vitest";
import { DebouncedSaveQueue, makeAutosaveSnapshot } from "./debouncedSave";
import type { SaveRevision, SaveTrigger } from "./debouncedSave";

interface Draft { name: string }

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("debounced project save queue", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("requires an active saved ID, dirty committed state, and no route draft before autosaving", () => {
    const base = { value: { name: "Design" }, projectId: "project-1", activeProjectId: "project-1", revision: 2, generation: 4, dirty: true, hasIncompleteDraft: false, switchingProject: false, blocked: false };
    expect(makeAutosaveSnapshot(base)).toMatchObject({ projectId: "project-1", revision: 2, generation: 4 });
    expect(makeAutosaveSnapshot({ ...base, activeProjectId: null })).toBeNull();
    expect(makeAutosaveSnapshot({ ...base, hasIncompleteDraft: true })).toBeNull();
    expect(makeAutosaveSnapshot({ ...base, dirty: false })).toBeNull();
  });

  it("cancels pending debounce work when a project is switched or the editor unmounts", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (snapshot: SaveRevision<Draft>) => snapshot.value);
    const queue = new DebouncedSaveQueue<Draft, Draft>({ save, isCurrentProject: () => true, isCurrentRevision: () => true, canSave: () => true, onSaving: vi.fn(), onSaved: vi.fn(), onFailed: vi.fn() });
    queue.schedule({ value: { name: "old project" }, projectId: "old", revision: 1, generation: 0 });
    queue.cancelPending();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    queue.schedule({ value: { name: "unmounted" }, projectId: "old", revision: 1, generation: 0 });
    queue.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });

  it("waits two seconds after the latest edit and saves only the latest revision", async () => {
    vi.useFakeTimers();
    let revision = 1;
    const save = vi.fn(async (snapshot: SaveRevision<Draft>) => snapshot.value);
    const queue = new DebouncedSaveQueue<Draft, Draft>({
      save,
      isCurrentProject: () => true,
      isCurrentRevision: (snapshot) => snapshot.revision === revision,
      canSave: () => true,
      onSaving: vi.fn(), onSaved: vi.fn(), onFailed: vi.fn(),
    });
    const snapshot = (rev: number): SaveRevision<Draft> => ({ value: { name: `revision ${rev}` }, projectId: "saved-project", revision: rev, generation: 1 });
    queue.schedule(snapshot(1));
    await vi.advanceTimersByTimeAsync(1200);
    revision = 2;
    queue.schedule(snapshot(2));
    await vi.advanceTimersByTimeAsync(1999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await queue.waitForIdle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(snapshot(2));
    queue.dispose();
  });

  it("does not overlap writes and saves edits made while an earlier revision is in flight", async () => {
    vi.useFakeTimers();
    let revision = 1;
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const responses: Array<ReturnType<typeof deferred<Draft>>> = [];
    const save = vi.fn((_snapshot: SaveRevision<Draft>) => {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      const response = deferred<Draft>();
      responses.push(response);
      return response.promise.finally(() => { activeWrites -= 1; });
    });
    const queue = new DebouncedSaveQueue<Draft, Draft>({
      save,
      isCurrentProject: () => true,
      isCurrentRevision: (snapshot) => snapshot.revision === revision,
      canSave: () => true,
      onSaving: vi.fn(), onSaved: vi.fn(), onFailed: vi.fn(),
    });
    const snapshot = (rev: number): SaveRevision<Draft> => ({ value: { name: `revision ${rev}` }, projectId: "saved-project", revision: rev, generation: 1 });
    queue.schedule(snapshot(1));
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);

    revision = 2;
    queue.schedule(snapshot(2));
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    responses[0].resolve(snapshot(1).value);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    responses[1].resolve(snapshot(2).value);
    await queue.waitForIdle();
    expect(maxActiveWrites).toBe(1);
    expect(save.mock.calls.map(([item]) => item.revision)).toEqual([1, 2]);
    queue.dispose();
  });

  it("skips incomplete drafts and invalidated project generations", async () => {
    vi.useFakeTimers();
    let allowed = false;
    let currentGeneration = 1;
    const save = vi.fn(async (snapshot: SaveRevision<Draft>) => snapshot.value);
    const queue = new DebouncedSaveQueue<Draft, Draft>({
      save,
      isCurrentProject: (snapshot) => snapshot.generation === currentGeneration,
      isCurrentRevision: () => true,
      canSave: (_snapshot, trigger) => allowed && trigger === "autosave",
      onSaving: vi.fn(), onSaved: vi.fn(), onFailed: vi.fn(),
    });
    const snapshot: SaveRevision<Draft> = { value: { name: "route project" }, projectId: "project-1", revision: 1, generation: 1 };
    queue.schedule(snapshot);
    await vi.advanceTimersByTimeAsync(2000);
    await queue.waitForIdle();
    expect(save).not.toHaveBeenCalled();

    allowed = true;
    queue.schedule(snapshot);
    currentGeneration = 2;
    await vi.advanceTimersByTimeAsync(2000);
    await queue.waitForIdle();
    expect(save).not.toHaveBeenCalled();
    queue.dispose();
  });

  it("reports failed writes and supports immediate manual retry for an unsaved project", async () => {
    const failed = vi.fn();
    const saved = vi.fn();
    let shouldFail = true;
    const queue = new DebouncedSaveQueue<Draft, Draft>({
      save: async (snapshot) => { if (shouldFail) throw new Error("server unavailable"); return snapshot.value; },
      isCurrentProject: () => true,
      isCurrentRevision: () => true,
      canSave: (_snapshot, trigger: SaveTrigger) => trigger === "manual",
      onSaving: vi.fn(), onSaved: saved, onFailed: failed,
    });
    const snapshot: SaveRevision<Draft> = { value: { name: "new project" }, projectId: "local-id", revision: 3, generation: 0 };
    await queue.saveNow(snapshot);
    expect(failed).toHaveBeenCalledWith(expect.any(Error), snapshot, true, "manual");
    expect(saved).not.toHaveBeenCalled();
    shouldFail = false;
    await queue.saveNow(snapshot);
    expect(saved).toHaveBeenCalledWith(snapshot.value, snapshot, true, "manual");
    queue.dispose();
  });
});
