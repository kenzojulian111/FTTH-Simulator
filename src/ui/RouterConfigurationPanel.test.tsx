import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../domain/project";
import type { RouterConfiguration } from "../domain/types";
import { serializeRouterConfiguration } from "../domain/routerConfig";
import { Inspector } from "./Inspector";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

describe("Router configuration inspector", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; });

  it("shows static WAN fields only for static mode and persists edits as typed router properties", () => {
    const project = createEmptyProject("Router UI");
    const now = project.createdAt;
    project.nodes = [{ id: "router-1", type: "router", name: "Router 1", location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: now, updatedAt: now }];
    let lastConfiguration: RouterConfiguration = {};
    const onRouterConfiguration = vi.fn((_id: string, configuration: RouterConfiguration) => { lastConfiguration = configuration; });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root?.render(<Inspector project={project} selection={{ kind: "node", id: "router-1" }} onRename={() => undefined} onCustomerAddress={() => undefined} onCustomerOnt={() => undefined} onCustomerStatus={() => undefined} onCableAttributes={() => undefined} onRouterConfiguration={onRouterConfiguration} onInvalidFiberCount={() => undefined} onDelete={() => undefined} />));

    expect(container.textContent).toContain("ROUTER IP CONFIGURATION");
    expect(container.querySelector('input[placeholder="192.0.2.10"]')).toBeNull();
    const mode = container.querySelector<HTMLSelectElement>("select");
    act(() => { if (mode) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(mode, "static-ipv4"); mode.dispatchEvent(new Event("change", { bubbles: true })); } });
    project.nodes[0].properties.routerConfiguration = serializeRouterConfiguration(lastConfiguration);
    act(() => root?.render(<Inspector project={project} selection={{ kind: "node", id: "router-1" }} onRename={() => undefined} onCustomerAddress={() => undefined} onCustomerOnt={() => undefined} onCustomerStatus={() => undefined} onCableAttributes={() => undefined} onRouterConfiguration={onRouterConfiguration} onInvalidFiberCount={() => undefined} onDelete={() => undefined} />));
    expect(container.querySelector('input[placeholder="192.0.2.10"]')).not.toBeNull();

    const hostname = Array.from(container.querySelectorAll("input")).find((input) => input.placeholder === "e.g. home-router");
    act(() => { if (hostname) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(hostname, "branch-router"); hostname.dispatchEvent(new Event("input", { bubbles: true })); } });
    expect(onRouterConfiguration).toHaveBeenCalledWith("router-1", expect.objectContaining({ hostname: "branch-router", wanMode: "static-ipv4" }));
    expect(container.textContent).toContain("WAN reachability, DHCP leases, and PPPoE session state are not simulated");
  });
});
