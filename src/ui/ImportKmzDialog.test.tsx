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

  it("shows actionable FastAPI steps and disables repeat import after a Rust 405", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const onImport = vi.fn(async () => { throw new Error("This Rust backend does not provide KMZ/KML import."); });
    act(() => root?.render(<ImportKmzDialog onImport={onImport} onSuccess={() => undefined} onClose={() => undefined} />));

    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["<kml />"], "survey.kml", { type: "application/vnd.google-earth.kml+xml" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    act(() => fileInput.dispatchEvent(new Event("change", { bubbles: true })));

    const submit = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Import & Open Project"))!;
    await act(async () => { submit.click(); });

    expect(host.textContent).toContain("Stop Rust with Ctrl+C");
    expect(host.textContent).toContain("python -m uvicorn backend.app.main:app");
    const disabledButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Switch to FastAPI to import"));
    expect(disabledButton?.disabled).toBe(true);
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
