import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeocodingResult } from "../api/geocodingApi";
import { LocationSearch } from "./LocationSearch";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
const first: GeocodingResult = { id: "1", displayName: "Denpasar", address: "Bali", coordinate: [115.21, -8.65], category: "city" };

describe("LocationSearch", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { if (root) act(() => root?.unmount()); root = null; container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const render = (search: (query: string, signal: AbortSignal) => Promise<GeocodingResult[]>, onSelect = vi.fn()) => { act(() => root?.render(createElement(LocationSearch, { search, onSelect }))); return onSelect; };
  const input = () => container.querySelector("input[type=search]") as HTMLInputElement;
  const setQuery = (value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); });
  const submit = () => act(() => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

  it("shows validation, loading, results, empty, and errors only after explicit submit", async () => {
    const search = vi.fn().mockResolvedValueOnce([first]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Provider busy"));
    render(search);
    setQuery("ab"); submit();
    expect(container.textContent).toContain("3 characters"); expect(search).not.toHaveBeenCalled();
    setQuery("Denpasar"); expect(search).not.toHaveBeenCalled(); submit(); expect(container.textContent).toContain("Searching");
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); });
    expect(container.textContent).toContain("Denpasar");
    setQuery("Nowhere"); submit(); await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); });
    expect(container.textContent).toContain("No places found");
    setQuery("Provider"); submit(); await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); });
    expect(container.textContent).toContain("Provider busy");
  });

  it("debounces explicit submits, ignores stale results, supports keyboard selection, and caches repeats", async () => {
    let resolveFirst!: (value: GeocodingResult[]) => void;
    let resolveSecond!: (value: GeocodingResult[]) => void;
    const search = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; })).mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const onSelect = render(search);
    setQuery("First place"); submit();
    act(() => vi.advanceTimersByTime(300));
    setQuery("Second place"); submit();
    expect(search).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(300));
    expect(search).toHaveBeenCalledTimes(2);
    await act(async () => { resolveSecond([first]); await Promise.resolve(); });
    await act(async () => { resolveFirst([{ ...first, displayName: "Stale" }]); await Promise.resolve(); });
    expect(container.textContent).toContain("Denpasar"); expect(container.textContent).not.toContain("Stale");
    act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith(first);
    setQuery("Second place"); submit();
    expect(search).toHaveBeenCalledTimes(2);
  });
});
