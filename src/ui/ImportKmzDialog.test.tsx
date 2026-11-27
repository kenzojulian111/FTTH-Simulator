import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportKmzDialog } from "./ImportKmzDialog";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

describe("ImportKmzDialog backend guidance", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null; host?.remove(); host = null;
  });

  it("shows the application stack command and disables repeat import if FastAPI is offline", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const onImport = vi.fn(async () => { throw new Error("Could not reach the FastAPI server. Check that the backend is running and try again."); });
    act(() => root?.render(<ImportKmzDialog onImport={onImport} onSuccess={() => undefined} onClose={() => undefined} />));

    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["<kml />"], "survey.kml", { type: "application/vnd.google-earth.kml+xml" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    act(() => fileInput.dispatchEvent(new Event("change", { bubbles: true })));

    const submit = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Import & Open Project"))!;
    await act(async () => { submit.click(); });

    expect(host.textContent).toContain("FastAPI API is not responding");
    expect(host.textContent).toContain("npm run dev:stack");
    const disabledButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Start the application stack"));
    expect(disabledButton?.disabled).toBe(true);
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
