export interface SaveRevision<T> {
  value: T;
  projectId: string;
  revision: number;
  generation: number;
}

export type SaveTrigger = "autosave" | "manual";

export function makeAutosaveSnapshot<T>(input: {
  value: T;
  projectId: string;
  activeProjectId: string | null;
  revision: number;
  generation: number;
  dirty: boolean;
  hasIncompleteDraft: boolean;
  switchingProject: boolean;
  blocked: boolean;
}): SaveRevision<T> | null {
  if (!input.projectId || input.activeProjectId !== input.projectId || !input.dirty || input.hasIncompleteDraft || input.switchingProject || input.blocked) return null;
  return { value: input.value, projectId: input.projectId, revision: input.revision, generation: input.generation };
}

export interface DebouncedSaveOptions<T, R> {
  delayMs?: number;
  save: (snapshot: SaveRevision<T>) => Promise<R>;
  isCurrentProject: (snapshot: SaveRevision<T>) => boolean;
  isCurrentRevision: (snapshot: SaveRevision<T>) => boolean;
  canSave: (snapshot: SaveRevision<T>, trigger: SaveTrigger) => boolean;
  onSaving: (snapshot: SaveRevision<T>, trigger: SaveTrigger) => void;
  onSaved: (result: R, snapshot: SaveRevision<T>, isLatestRevision: boolean, trigger: SaveTrigger) => void;
  onFailed: (error: unknown, snapshot: SaveRevision<T>, isLatestRevision: boolean, trigger: SaveTrigger) => void;
}

/** Debounces edits and serializes writes so this editor never has overlapping project PUTs. */
export class DebouncedSaveQueue<T, R> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly delayMs: number;

  constructor(private readonly options: DebouncedSaveOptions<T, R>) {
    this.delayMs = options.delayMs ?? 2000;
  }

  schedule(snapshot: SaveRevision<T> | null): void {
    this.cancelPending();
    if (!snapshot || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueue(snapshot, "autosave");
    }, this.delayMs);
  }

  saveNow(snapshot: SaveRevision<T>): Promise<void> {
    this.cancelPending();
    return this.enqueue(snapshot, "manual");
  }

  cancelPending(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  waitForIdle(): Promise<void> {
    return this.tail;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelPending();
  }

  private enqueue(snapshot: SaveRevision<T>, trigger: SaveTrigger): Promise<void> {
    const operation = this.tail.catch(() => undefined).then(async () => {
      if (this.disposed || !this.options.isCurrentProject(snapshot) || !this.options.isCurrentRevision(snapshot) || !this.options.canSave(snapshot, trigger)) return;
      this.options.onSaving(snapshot, trigger);
      try {
        const result = await this.options.save(snapshot);
        if (!this.disposed && this.options.isCurrentProject(snapshot)) {
          this.options.onSaved(result, snapshot, this.options.isCurrentRevision(snapshot), trigger);
        }
      } catch (error) {
        if (!this.disposed && this.options.isCurrentProject(snapshot)) {
          this.options.onFailed(error, snapshot, this.options.isCurrentRevision(snapshot), trigger);
        }
      }
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return this.tail;
  }
}
