import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewProjectDialog } from "./NewProjectDialog";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

describe("NewProjectDialog", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null; host?.remove(); host = null;
  });

  it("requires a name and submits the new project name", () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const onCreate = vi.fn();
    act(() => root?.render(<NewProjectDialog creating={false} error={null} onCreate={onCreate} onClose={() => undefined} />));
    const input = host.querySelector<HTMLInputElement>("input")!;
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "North District");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);
    act(() => host?.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onCreate).toHaveBeenCalledWith("North District");
  });
});
