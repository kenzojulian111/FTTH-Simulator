import { act, createElement } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approximateLengthMeters, createEmptyProject } from "../domain/project";
import { addCableWaypoint, beginCableDrawing, formatCableDistance } from "../domain/cableDrawing";
import type { NetworkNode } from "../domain/types";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

const mocked = vi.hoisted(() => ({
  handlers: null as null | Record<string, (event: { latlng: { lng: number; lat: number } }) => void>,
  map: null as null | { getContainer: () => HTMLElement; getZoom: () => number; flyTo: ReturnType<typeof vi.fn>; latLngToContainerPoint: (point: { lng: number; lat: number }) => { x: number; y: number }; dragging: { enabled: () => boolean; disable: ReturnType<typeof vi.fn>; enable: ReturnType<typeof vi.fn> } },
}));

vi.mock("react-leaflet", async () => {
  const React = await import("react");
  return {
    MapContainer: ({ children, className, center, zoom }: { children: ReactNode; className: string; center?: [number, number]; zoom?: number }) => React.createElement("div", { className, "data-testid": "map", "data-center": center ? JSON.stringify(center) : undefined, "data-zoom": zoom !== undefined ? String(zoom) : undefined }, children),
    TileLayer: ({ url, attribution, opacity, zIndex }: { url: string; attribution: string; opacity?: number; zIndex?: number }) => React.createElement("div", { "data-testid": "tile-layer", "data-url": url, "data-attribution": attribution, "data-opacity": opacity !== undefined ? String(opacity) : undefined, "data-zindex": zIndex !== undefined ? String(zIndex) : undefined }),
    Marker: ({ position, icon, draggable, eventHandlers, children }: { position: [number, number]; icon: { options: { html: string } }; draggable?: boolean; eventHandlers?: { click?: (event: { originalEvent: Event }) => void }; children?: ReactNode }) => React.createElement("div", { "data-testid": "marker", "data-coordinate": `${position[1]},${position[0]}`, "data-icon": icon.options.html, "data-draggable": String(draggable), onClick: (event: React.MouseEvent) => eventHandlers?.click?.({ originalEvent: event.nativeEvent }) }, children),
    Polygon: ({ positions, eventHandlers }: { positions: [number, number][]; eventHandlers?: { click?: (event: { originalEvent: Event }) => void } }) => React.createElement("output", { "data-testid": "polygon", "data-positions": JSON.stringify(positions), onClick: (event: React.MouseEvent) => eventHandlers?.click?.({ originalEvent: event.nativeEvent }) }),
    Popup: ({ children }: { children: ReactNode }) => React.createElement("div", { "data-testid": "popup" }, children),
    Polyline: ({ positions, pathOptions, interactive = true, eventHandlers }: { positions: [number, number][]; pathOptions: { className?: string; color?: string; dashArray?: string }; interactive?: boolean; eventHandlers?: { click?: (event: { originalEvent: Event }) => void } }) => React.createElement("output", {
      "data-testid": pathOptions.className ? "route-preview" : "route-line",
      "data-positions": JSON.stringify(positions),
      "data-color": pathOptions.color,
      "data-dash": pathOptions.dashArray,
      "data-interactive": String(interactive),
      onClick: () => interactive
        ? eventHandlers?.click?.({ originalEvent: new MouseEvent("click") })
        : mocked.handlers?.click({ latlng: { lng: 115.0005, lat: -8.001 } }),
    }),
    useMapEvents: (handlers: Record<string, (event: { latlng: { lng: number; lat: number } }) => void>) => { mocked.handlers = handlers; return null; },
    useMap: () => mocked.map,
  };
});

import { NetworkMap } from "./NetworkMap";

describe("NetworkMap cable drawing mode", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let mapContainer: HTMLDivElement;
  let draggingEnabled: boolean;
  const nodes: NetworkNode[] = [{ id: "start", type: "olt", name: "OLT start", location: { type: "Point", coordinates: [115, -8] }, properties: { geographicPositionSet: true }, createdAt: "now", updatedAt: "now" }];

  beforeEach(() => {
    mapContainer = document.createElement("div");
    draggingEnabled = true;
    mocked.map = { getContainer: () => mapContainer, getZoom: () => 13, flyTo: vi.fn(), latLngToContainerPoint: (point) => ({ x: point.lng * 10, y: point.lat * 10 }), dragging: { enabled: () => draggingEnabled, disable: vi.fn(() => { draggingEnabled = false; }), enable: vi.fn(() => { draggingEnabled = true; }) } };
    mocked.handlers = null;
  });
  afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; vi.clearAllMocks(); });

  function mount(tool: "cable" | null, cableDrawing: ReturnType<typeof beginCableDrawing> | null, previewPoint: [number, number] | null, onCableNodeClick = vi.fn(), onMapClick = vi.fn(), onMapMove = vi.fn()) {
    const project = { ...createEmptyProject("Map drawing"), nodes };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root?.render(createElement(NetworkMap, { project, tool, selection: null, cableDrawing, previewPoint, onCableNodeClick, onMapClick, onMapMove, onSelect: vi.fn(), onMove: vi.fn(), onMoveVertex: vi.fn() })));
    return { onCableNodeClick, onMapClick, onMapMove };
  }

  it("sets the cable cursor, highlights candidates, prevents dragging nodes, and restores map dragging", () => {
    const { onCableNodeClick, onMapClick } = mount("cable", beginCableDrawing(), null);
    expect(container?.querySelector('[data-testid="map"]')?.className).toContain("cable-drawing");
    expect(mapContainer.classList.contains("cable-drawing")).toBe(true);
    expect(draggingEnabled).toBe(false);
    expect(container?.querySelector('[data-testid="marker"]')?.getAttribute("data-icon")).not.toContain("cable-endpoint-candidate");
    expect(container?.querySelector('[data-testid="marker"]')?.getAttribute("data-draggable")).toBe("false");
    act(() => {
      mocked.handlers?.click({ latlng: { lng: 115.001, lat: -8.001 } });
      mocked.handlers?.click({ latlng: { lng: 115.002, lat: -8.002 } });
    });
    expect(onMapClick).toHaveBeenNthCalledWith(1, [115.001, -8.001]);
    expect(onMapClick).toHaveBeenNthCalledWith(2, [115.002, -8.002]);
    expect(onCableNodeClick).not.toHaveBeenCalled();
    act(() => root?.render(createElement(NetworkMap, { project: { ...createEmptyProject("Map drawing"), nodes }, tool: null, selection: null, cableDrawing: null, previewPoint: null, onCableNodeClick: vi.fn(), onMapClick: vi.fn(), onMapMove: vi.fn(), onSelect: vi.fn(), onMove: vi.fn(), onMoveVertex: vi.fn() })));
    expect(draggingEnabled).toBe(true);
    expect(mapContainer.classList.contains("cable-drawing")).toBe(false);
  });

  it("routes map clicks and pointer movement to geographic waypoint handlers", () => {
    const { onMapClick, onMapMove } = mount("cable", beginCableDrawing(), null);
    expect(mocked.handlers).not.toBeNull();
    act(() => {
      mocked.handlers?.click({ latlng: { lng: 115.001, lat: -8.001 } });
      mocked.handlers?.mousemove({ latlng: { lng: 115.002, lat: -8.002 } });
    });
    expect(onMapClick).toHaveBeenCalledWith([115.001, -8.001]);
    expect(onMapMove).toHaveBeenCalledWith([115.002, -8.002]);
  });

  it("shows a non-blocking live segment and total label, preserves length on a vertex click, and hides on exit", () => {
    const session = addCableWaypoint(addCableWaypoint(beginCableDrawing(), [115, -8]).session, [115.001, -8]).session;
    const { onMapClick, onMapMove } = mount("cable", session, null);
    const cursor: [number, number] = [115.002, -8.001];
    act(() => mocked.handlers?.mousemove({ latlng: { lng: cursor[0], lat: cursor[1] } }));
    const label = mapContainer.querySelector<HTMLElement>(".cable-measurement-preview");
    expect(label).not.toBeNull();
    expect(label?.hidden).toBe(false);
    expect(label?.style.pointerEvents).toBe("none");
    expect(label?.textContent).toContain(`Segment ${formatCableDistance(approximateLengthMeters([[115.001, -8], cursor]))}`);
    expect(label?.textContent).toContain(`Total ${formatCableDistance(approximateLengthMeters([[115, -8], [115.001, -8], cursor]))}`);

    act(() => mocked.handlers?.click({ latlng: { lng: cursor[0], lat: cursor[1] } }));
    expect(onMapClick).toHaveBeenCalledWith(cursor);
    expect(label?.textContent).toContain("Segment 0.0 m");
    expect(label?.textContent).toContain(`Total ${formatCableDistance(approximateLengthMeters([[115, -8], [115.001, -8], cursor]))}`);

    act(() => mocked.handlers?.mouseout({ latlng: { lng: cursor[0], lat: cursor[1] } }));
    expect(label?.hidden).toBe(true);
    expect(onMapMove).toHaveBeenLastCalledWith(null);
  });

  it("coalesces rapid cursor callbacks while keeping the floating measurement live", () => {
    vi.useFakeTimers();
    try {
      const session = addCableWaypoint(beginCableDrawing(), [115, -8]).session;
      const { onMapMove } = mount("cable", session, null);
      act(() => {
        mocked.handlers?.mousemove({ latlng: { lng: 115.001, lat: -8 } });
        mocked.handlers?.mousemove({ latlng: { lng: 115.002, lat: -8 } });
        mocked.handlers?.mousemove({ latlng: { lng: 115.003, lat: -8 } });
      });
      expect(onMapMove).toHaveBeenCalledTimes(1);
      expect(mapContainer.querySelector(".cable-measurement-preview")?.textContent).toContain("Total");
      act(() => { vi.advanceTimersByTime(40); });
      expect(onMapMove).toHaveBeenCalledTimes(2);
      expect(onMapMove).toHaveBeenLastCalledWith([115.003, -8]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recalculates the label when a marker click commits a route vertex", () => {
    const session = addCableWaypoint(beginCableDrawing(), [114.999, -8]).session;
    const { onMapClick } = mount("cable", session, null);
    const markerPoint: [number, number] = [115, -8];
    act(() => mocked.handlers?.mousemove({ latlng: { lng: markerPoint[0], lat: markerPoint[1] } }));
    const label = mapContainer.querySelector<HTMLElement>(".cable-measurement-preview");
    expect(label?.textContent).toContain(`Segment ${formatCableDistance(approximateLengthMeters([[114.999, -8], markerPoint]))}`);
    act(() => container?.querySelector<HTMLElement>('[data-testid="marker"]')?.click());
    expect(onMapClick).toHaveBeenCalledWith(markerPoint);

    const afterVertex = addCableWaypoint(session, markerPoint).session;
    const project = { ...createEmptyProject("Marker vertex"), nodes };
    act(() => root?.render(createElement(NetworkMap, {
      project, tool: "cable", selection: null, cableDrawing: afterVertex, previewPoint: null,
      onCableNodeClick: vi.fn(), onMapClick, onMapMove: vi.fn(), onSelect: vi.fn(), onMove: vi.fn(), onMoveVertex: vi.fn(),
    })));
    expect(label?.textContent).toContain("Segment 0.0 m");
    expect(label?.textContent).toContain(`Total ${formatCableDistance(approximateLengthMeters([[114.999, -8], markerPoint]))}`);
  });

  it("lets map clicks add route waypoints on top of existing cables while drawing", () => {
    const project = {
      ...createEmptyProject("Map drawing"),
      nodes,
      cableSegments: [{
        id: "existing-cable", name: "Existing route", cableType: "SM", fiberCount: 12,
        geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.001, -8]] as [number, number][] },
        lengthM: 100, properties: {}, createdAt: "now", updatedAt: "now",
      }],
    };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const onMapClick = vi.fn();
    act(() => root?.render(createElement(NetworkMap, { project, tool: "cable", selection: null, cableDrawing: beginCableDrawing(), previewPoint: null, onCableNodeClick: vi.fn(), onMapClick, onMapMove: vi.fn(), onSelect: vi.fn(), onMove: vi.fn(), onMoveVertex: vi.fn() })));
    expect(container?.querySelector('[data-testid="route-line"]')?.getAttribute("data-interactive")).toBe("false");
    act(() => container?.querySelector<HTMLOutputElement>('[data-testid="route-line"]')?.click());
    expect(onMapClick).toHaveBeenCalledWith([115.0005, -8.001]);
  });

  it("renders a distinct multi-vertex preview including the live cursor point", () => {
    const drawing = beginCableDrawing();
    drawing.coordinates.push([115, -8]);
    drawing.coordinates.push([115.001, -8.002]);
    mount("cable", drawing, [115.002, -8.001]);
    const preview = container?.querySelector<HTMLOutputElement>('[data-testid="route-preview"]');
    expect(preview).not.toBeNull();
    expect(JSON.parse(preview?.dataset.positions ?? "[]")).toEqual([[-8, 115], [-8.002, 115.001], [-8.001, 115.002]]);
    expect(preview?.getAttribute("data-testid")).toBe("route-preview");
  });

  it("renders unconnected, connected, and rejected cable states distinctly", () => {
    const project = createEmptyProject("Cable states");
    const cable = (id: string) => ({ id, name: id, cableType: "SM", fiberCount: 12, geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.001, -8]] as [number, number][] }, lengthM: null, properties: {}, createdAt: "now", updatedAt: "now" });
    project.cableSegments = [cable("unconnected"), cable("connected"), cable("rejected")];
    project.connections = [{ id: "conn", fromNodeId: "a", toNodeId: "b", cableSegmentId: "connected" }];
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root?.render(createElement(NetworkMap, { project, tool: null, selection: null, cableDrawing: null, previewPoint: null, failedCableIds: ["rejected"], onCableNodeClick: vi.fn(), onMapClick: vi.fn(), onMapMove: vi.fn(), onSelect: vi.fn(), onMove: vi.fn(), onMoveVertex: vi.fn() })));
    const lines = Array.from(container.querySelectorAll<HTMLOutputElement>('[data-testid="route-line"]'));
    expect(lines.map((line) => [line.dataset.color, line.dataset.dash])).toEqual([
      ["#d99b38", "10 7"], ["#38bdf8", undefined], ["#ef4444", "10 7"],
    ]);
  });

  it("overlays and selects an explicit pole span using its stored route geometry", () => {
    const project = createEmptyProject("Span map overlay");
    project.cableSegments = [{ id: "c1", name: "Route", cableType: "distribution", fiberCount: null, geometry: { type: "LineString", coordinates: [[115, -8], [115.001, -8], [115.001, -8.001]] }, lengthM: 200, properties: {}, createdAt: "now", updatedAt: "now" }];
    project.poleSpans = [{ id: "s1", cableSegmentId: "c1", fromPoleId: "p1", toPoleId: "p2", geometry: { type: "LineString", coordinates: [[115, -8], [115.001, -8], [115.001, -8.001]] }, coversEntireCableRoute: true, status: "existing", notes: "", lengthM: 200 }];
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const onSelect = vi.fn();
    act(() => root?.render(createElement(NetworkMap, { project, tool: null, selection: null, cableDrawing: null, previewPoint: null, onCableNodeClick: vi.fn(), onMapClick: vi.fn(), onMapMove: vi.fn(), onSelect, onMove: vi.fn(), onMoveVertex: vi.fn() })));
    const lines = Array.from(container.querySelectorAll<HTMLOutputElement>('[data-testid="route-line"]'));
    expect(lines).toHaveLength(2);
    expect(lines[1].dataset.color).toBe("#22c55e");
    expect(JSON.parse(lines[1].dataset.positions ?? "[]")).toEqual([[-8, 115], [-8, 115.001], [-8.001, 115.001]]);
    act(() => lines[1].click());
    expect(onSelect).toHaveBeenCalledWith({ kind: "cable", id: "c1" });
  });

  it("renders distinct map colors for feeder, distribution, drop, indoor, and custom cable categories", () => {
    const project = createEmptyProject("Cable categories");
    const makeCatCable = (id: string, cat: string) => ({
      id,
      name: id,
      cableType: cat,
      fiberCount: 12,
      geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.001, -8]] as [number, number][] },
      lengthM: 100,
      properties: { cableCategory: cat },
      createdAt: "now",
      updatedAt: "now",
    });
    project.cableSegments = [
      makeCatCable("c-feeder", "feeder"),
      makeCatCable("c-dist", "distribution"),
      makeCatCable("c-drop", "drop"),
      makeCatCable("c-indoor", "indoor"),
      makeCatCable("c-custom", "custom"),
    ];
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root?.render(createElement(NetworkMap, { project, tool: null, selection: null, cableDrawing: null, previewPoint: null, onCableNodeClick: vi.fn(), onMapClick: vi.fn(), onMapMove: vi.fn(), onSelect: vi.fn(), onMove: vi.fn(), onMoveVertex: vi.fn() })));
    const colors = Array.from(container.querySelectorAll<HTMLOutputElement>('[data-testid="route-line"]')).map((line) => line.dataset.color);
    expect(colors).toEqual(["#0ea5e9", "#10b981", "#a855f7", "#ec4899", "#14b8a6"]);
  });

  it("defaults to Normal OSM basemap, switches to Earth satellite + hybrid labels, and restores Normal without losing selection or overlays", () => {
    const project = {
      ...createEmptyProject("Basemap switch"),
      nodes: [
        ...nodes,
        { id: "odp-1", type: "odp" as const, name: "ODP 1", location: { type: "Point" as const, coordinates: [115.002, -8.001] as [number, number] }, properties: { geographicPositionSet: true }, createdAt: "now", updatedAt: "now" },
      ],
      cableSegments: [{
        id: "c-feeder", name: "Feeder 01", cableType: "feeder", fiberCount: 24,
        geometry: { type: "LineString" as const, coordinates: [[115, -8], [115.002, -8.001]] as [number, number][] },
        lengthM: 250, properties: { cableCategory: "feeder" }, createdAt: "now", updatedAt: "now",
      }],
    };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const onSelect = vi.fn();

    // 1. Default is Normal mode (OpenStreetMap)
    act(() => root?.render(createElement(NetworkMap, {
      project, tool: null, selection: { kind: "node", id: "odp-1" },
      cableDrawing: null, previewPoint: null, onCableNodeClick: vi.fn(),
      onMapClick: vi.fn(), onMapMove: vi.fn(), onSelect, onMove: vi.fn(), onMoveVertex: vi.fn(),
    })));
    const mapElementBefore = container.querySelector('[data-testid="map"]');
    expect(mapElementBefore?.className).toContain("basemap-normal");
    expect(mapElementBefore?.getAttribute("data-center")).toBe("[-8,115]");
    expect(mapElementBefore?.getAttribute("data-zoom")).toBe("13");
    let tileLayers = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="tile-layer"]'));
    expect(tileLayers).toHaveLength(1);
    expect(tileLayers[0].dataset.url).toContain("tile.openstreetmap.org");
    expect(tileLayers[0].dataset.attribution).toContain("OpenStreetMap");

    // 2. Switch to Earth mode (Esri World Imagery + hybrid boundary/place labels)
    act(() => root?.render(createElement(NetworkMap, {
      project, tool: null, selection: { kind: "node", id: "odp-1" },
      basemapMode: "earth",
      cableDrawing: null, previewPoint: null, onCableNodeClick: vi.fn(),
      onMapClick: vi.fn(), onMapMove: vi.fn(), onSelect, onMove: vi.fn(), onMoveVertex: vi.fn(),
    })));
    const mapElementEarth = container.querySelector('[data-testid="map"]');
    expect(mapElementEarth).toBe(mapElementBefore); // Same MapContainer DOM instance (not remounted)
    expect(mapElementEarth?.className).toContain("basemap-earth");
    expect(mapElementEarth?.getAttribute("data-center")).toBe("[-8,115]");
    expect(mapElementEarth?.getAttribute("data-zoom")).toBe("13");
    tileLayers = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="tile-layer"]'));
    expect(tileLayers).toHaveLength(2);
    expect(tileLayers[0].dataset.url).toContain("World_Imagery/MapServer/tile/{z}/{y}/{x}");
    expect(tileLayers[0].dataset.attribution).toContain("Esri");
    expect(tileLayers[1].dataset.url).toContain("World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}");

    // Verify FTTH engineering layers and selected state remain intact in Earth mode
    const markers = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="marker"]'));
    expect(markers).toHaveLength(2);
    expect(markers[1].dataset.icon).toContain("selected");
    const routeLines = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="route-line"]'));
    expect(routeLines).toHaveLength(1);
    expect(routeLines[0].dataset.color).toBe("#0ea5e9");

    // 3. Switch back to Normal mode
    act(() => root?.render(createElement(NetworkMap, {
      project, tool: null, selection: { kind: "node", id: "odp-1" },
      basemapMode: "normal",
      cableDrawing: null, previewPoint: null, onCableNodeClick: vi.fn(),
      onMapClick: vi.fn(), onMapMove: vi.fn(), onSelect, onMove: vi.fn(), onMoveVertex: vi.fn(),
    })));
    expect(container.querySelector('[data-testid="map"]')?.className).toContain("basemap-normal");
    tileLayers = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="tile-layer"]'));
    expect(tileLayers).toHaveLength(1);
    expect(tileLayers[0].dataset.url).toContain("tile.openstreetmap.org");
  });


  it("navigates to a validated search result without replacing the map or engineering overlays in either basemap", () => {
    const project = createEmptyProject("Search navigation");
    project.nodes = nodes;
    project.cableSegments = [{ id: "c1", name: "Cable", cableType: "feeder", fiberCount: 12, geometry: { type: "LineString", coordinates: [[115, -8], [115.001, -8]] }, lengthM: 100, properties: { cableCategory: "feeder" }, createdAt: "now", updatedAt: "now" }];
    project.areas = [{ id: "a1", name: "Area", geometry: { type: "Polygon", coordinates: [[[115, -8], [115.01, -8], [115.01, -8.01], [115, -8]]] }, fillColor: "#22c55e", fillOpacity: 0.2 }];
    const result = { id: "place-1", displayName: "Denpasar", address: "Bali", coordinate: [115.21, -8.65] as [number, number], category: "city" };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const props = { project, tool: null, selection: null, cableDrawing: null, previewPoint: null, searchResult: result, onDismissSearchResult: vi.fn(), onCableNodeClick: vi.fn(), onMapClick: vi.fn(), onMapMove: vi.fn(), onSelect: vi.fn(), onMove: vi.fn(), onMoveVertex: vi.fn() };
    act(() => root?.render(createElement(NetworkMap, { ...props, basemapMode: "normal" })));
    const originalMap = container.querySelector('[data-testid="map"]');
    expect(mocked.map?.flyTo).toHaveBeenCalledWith([-8.65, 115.21], 15, { animate: true, duration: 0.65 });
    expect(Array.from(container.querySelectorAll<HTMLElement>('[data-testid="marker"]')).some((marker) => marker.dataset.coordinate === "115.21,-8.65")).toBe(true);
    expect(container.querySelectorAll('[data-testid="route-line"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="polygon"]')).toHaveLength(1);
    act(() => root?.render(createElement(NetworkMap, { ...props, basemapMode: "earth" })));
    expect(container.querySelector('[data-testid="map"]')).toBe(originalMap);
    expect(mocked.map?.flyTo).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[data-testid="route-line"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="polygon"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="marker"]')).toHaveLength(2);
    act(() => root?.render(createElement(NetworkMap, { ...props, searchResult: { ...result, coordinate: [300, 100] as [number, number] } })));
    expect(mocked.map?.flyTo).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[data-testid="marker"]')).toHaveLength(1);
  });

  it("handles missing or unconfigured Earth provider credentials gracefully by retaining Normal basemap", () => {
    const project = { ...createEmptyProject("Missing Earth config"), nodes };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);

    // Mapbox provider selected without VITE_MAPBOX_ACCESS_TOKEN
    act(() => root?.render(createElement(NetworkMap, {
      project, tool: null, selection: null,
      basemapMode: "earth",
      basemapEnv: { VITE_EARTH_TILE_PROVIDER: "mapbox_satellite", VITE_MAPBOX_ACCESS_TOKEN: "" },
      cableDrawing: null, previewPoint: null, onCableNodeClick: vi.fn(),
      onMapClick: vi.fn(), onMapMove: vi.fn(), onSelect: vi.fn(), onMove: vi.fn(), onMoveVertex: vi.fn(),
    })));
    expect(container.querySelector('[data-testid="map"]')?.className).toContain("basemap-normal");
    const tileLayers = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="tile-layer"]'));
    expect(tileLayers).toHaveLength(1);
    expect(tileLayers[0].dataset.url).toContain("tile.openstreetmap.org");
  });
});
