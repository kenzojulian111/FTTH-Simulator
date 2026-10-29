import { useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import type { Customer, FeatureProperties, FeatureRef, NetworkNode, NodeType, Project } from "../domain/types";

const WIDTH = 1000;
const HEIGHT = 700;
const NODE_TYPES: Exclude<NodeType, "customer">[] = ["olt", "odc", "odp", "ont", "splitter", "pole", "router"];
export type PaletteDevice = Exclude<NodeType, "customer"> | "customer";
export type ConnectionEndpoint = { kind: "node" | "customer"; id: string };
export type CanvasPosition = { x: number; y: number };
type Position = CanvasPosition;
type MovableFeatureRef = { kind: "node" | "customer"; id: string };
type ClientPointEvent = { clientX: number; clientY: number; currentTarget: { getBoundingClientRect: () => DOMRect } };
type CanvasItem = { kind: "node"; item: NetworkNode; position: Position } | { kind: "customer"; item: Customer; position: Position };
type Viewport = Position & { scale: number };

function storedPosition(properties: FeatureProperties): Position | null {
  const value = properties.logicalPosition;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { x, y } = value;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) ? { x, y } : null;
}

function itemPosition(item: NetworkNode | Customer, index: number): Position {
  return storedPosition(item.properties) ?? { x: 180 + (index % 4) * 200, y: 150 + Math.floor(index / 4) * 145 };
}

function point(event: ClientPointEvent) {
  const rect = event.currentTarget instanceof SVGSVGElement
    ? event.currentTarget.getBoundingClientRect()
    : document.querySelector<SVGSVGElement>(".topology-canvas")?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height };
}

function symbol(type: string) {
  return type === "customer" ? "⌂" : type === "pole" ? "P" : type === "splitter" ? "1:8" : type === "router" ? "R" : type.toUpperCase();
}

function title(type: string) {
  return type === "olt" ? "OLT" : type === "odc" ? "ODC" : type === "odp" ? "ODP" : type === "ont" ? "ONT" : type === "pole" ? "Pole" : type === "customer" ? "Customer" : type === "router" ? "Router" : "Splitter";
}

interface Props {
  project: Project;
  selection: FeatureRef | null;
  onSelect: (selection: FeatureRef) => void;
  onAddDevice: (type: PaletteDevice, position: Position) => void;
  onMove: (selection: { kind: "node" | "customer"; id: string }, position: Position) => void;
  onConnect: (source: ConnectionEndpoint, target: ConnectionEndpoint) => void;
  onInvalidConnect: () => void;
}

export function TopologyCanvas({ project, selection, onSelect, onAddDevice, onMove, onConnect, onInvalidConnect }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [dragPosition, setDragPosition] = useState<{ ref: MovableFeatureRef; position: Position } | null>(null);
  const [pan, setPan] = useState<{ pointer: Position; origin: Position } | null>(null);
  const [linkSource, setLinkSource] = useState<ConnectionEndpoint | null>(null);
  const [linkStart, setLinkStart] = useState<Position | null>(null);
  const [linkEnd, setLinkEnd] = useState<Position | null>(null);
  const items: CanvasItem[] = [
    ...project.nodes.map((item, index) => ({ kind: "node" as const, item, position: itemPosition(item, index) })),
    ...project.customers.map((item, index) => ({ kind: "customer" as const, item, position: itemPosition(item, index) })),
  ];
  const positions = new Map(items.filter((item): item is Extract<CanvasItem, { kind: "node" }> => item.kind === "node").map((item) => [item.item.id, dragPosition?.ref.kind === "node" && dragPosition.ref.id === item.item.id ? dragPosition.position : item.position]));
  const canvasPoint = (event: ClientPointEvent) => {
    const raw = point(event);
    return { x: (raw.x - viewport.x) / viewport.scale, y: (raw.y - viewport.y) / viewport.scale };
  };

  function beginNodeDrag(event: PointerEvent<SVGGElement>, item: CanvasItem) {
    if (event.button !== 0) return;
    event.stopPropagation();
    svg.current?.setPointerCapture(event.pointerId);
    const ref: MovableFeatureRef = { kind: item.kind, id: item.item.id };
    onSelect(ref);
    setDragPosition({ ref, position: item.position });
  }

  function beginLink(event: PointerEvent<SVGCircleElement>, source: ConnectionEndpoint, position: Position) {
    event.stopPropagation();
    svg.current?.setPointerCapture(event.pointerId);
    setLinkSource(source);
    setLinkStart({ x: position.x + 58, y: position.y });
    setLinkEnd(canvasPoint(event));
  }

  function movePointer(event: PointerEvent<SVGSVGElement>) {
    const raw = point(event);
    if (pan) {
      setViewport((current) => ({ ...current, x: pan.origin.x + raw.x - pan.pointer.x, y: pan.origin.y + raw.y - pan.pointer.y }));
      return;
    }
    if (dragPosition) setDragPosition({ ...dragPosition, position: canvasPoint(event) });
    if (linkSource) setLinkEnd(canvasPoint(event));
  }

  function finishPointer(event: PointerEvent<SVGSVGElement>) {
    if (dragPosition) onMove(dragPosition.ref, dragPosition.position);
    if (linkSource) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGElement>("[data-feature-kind][data-feature-id]");
      const kind = target?.dataset.featureKind;
      const id = target?.dataset.featureId;
      if ((kind === "node" || kind === "customer") && id && (id !== linkSource.id || kind !== linkSource.kind)) onConnect(linkSource, { kind, id });
      else onInvalidConnect();
      setLinkSource(null);
      setLinkStart(null);
      setLinkEnd(null);
    }
    setDragPosition(null);
    setPan(null);
  }

  function beginPan(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("[data-feature-kind], [data-link-port]"))) return;
    svg.current?.setPointerCapture(event.pointerId);
    setPan({ pointer: point(event), origin: { x: viewport.x, y: viewport.y } });
  }

  function zoom(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const anchor = point(event);
    const scale = Math.max(0.55, Math.min(2.2, viewport.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
    const world = { x: (anchor.x - viewport.x) / viewport.scale, y: (anchor.y - viewport.y) / viewport.scale };
    setViewport({ x: anchor.x - world.x * scale, y: anchor.y - world.y * scale, scale });
  }

  function dropDevice(event: React.DragEvent<SVGSVGElement>) {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/x-ftth-device");
    if (!isPaletteDevice(kind)) return;
    onAddDevice(kind, canvasPoint(event));
  }

  return <section className="map-stage topology-stage">
    <div className="map-toolbar"><div className="map-label"><span className="live-dot" /> LOGICAL TOPOLOGY <small>LAYOUT UNITS · NOT GPS</small></div><div className="map-controls"><span>Drag devices · drag a port to connect · drag canvas to pan</span><button onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}>Reset view</button><button onClick={() => setViewport((view) => ({ ...view, scale: Math.max(.55, view.scale / 1.1) }))}>−</button><button onClick={() => setViewport((view) => ({ ...view, scale: Math.min(2.2, view.scale * 1.1) }))}>+</button></div></div>
    <svg ref={svg} className="topology-canvas" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" onPointerDown={beginPan} onPointerMove={movePointer} onPointerUp={finishPointer} onPointerCancel={finishPointer} onWheel={zoom} onDragOver={(event) => event.preventDefault()} onDrop={dropDevice}>
      <defs><pattern id="topology-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#243542" /></pattern><marker id="topology-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#70cbb0" /></marker></defs>
      <rect width={WIDTH} height={HEIGHT} fill="url(#topology-grid)" />
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
        {project.connections.map((connection) => {
          const from = positions.get(connection.fromNodeId); const to = positions.get(connection.toNodeId);
          if (!from || !to) return null;
          const cable = project.cableSegments.find((segment) => segment.id === connection.cableSegmentId);
          return <g key={connection.id}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="topology-link" markerEnd="url(#topology-arrow)" /><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 10} className="topology-link-label">{cable?.name ?? "Cable missing"} · connected</text></g>;
        })}
        {project.customers.map((customer, index) => {
          if (!customer.ontNodeId) return null;
          const from = positions.get(customer.ontNodeId); const to = itemPosition(customer, index);
          return from ? <line key={`customer-link-${customer.id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="topology-customer-link" /> : null;
        })}
        {linkSource && linkStart && linkEnd && <line x1={linkStart.x} y1={linkStart.y} x2={linkEnd.x} y2={linkEnd.y} className="topology-link-preview" />}
        {items.map((entry) => {
          const ref: FeatureRef = { kind: entry.kind, id: entry.item.id };
          const position = dragPosition?.ref.kind === ref.kind && dragPosition.ref.id === ref.id ? dragPosition.position : entry.position;
          const deviceType = entry.kind === "customer" ? "customer" : entry.item.type;
          return <g key={`${entry.kind}-${entry.item.id}`} data-feature-kind={entry.kind} data-feature-id={entry.item.id} transform={`translate(${position.x} ${position.y})`} className={`topology-device ${selection?.kind === ref.kind && selection.id === ref.id ? "selected" : ""}`} onPointerDown={(event) => beginNodeDrag(event, entry)} onClick={() => onSelect(ref)}>
            <rect x="-58" y="-32" width="116" height="64" rx="7" className={`topology-device-card device-${deviceType}`} />
            <text x="0" y="-4" textAnchor="middle" className="topology-device-symbol">{symbol(deviceType)}</text>
            <text x="0" y="15" textAnchor="middle" className="topology-device-name">{entry.item.name}</text>
            <text x="0" y="27" textAnchor="middle" className="topology-device-type">{title(deviceType)}{entry.kind === "customer" ? ` · ${entry.item.status}` : ""}</text>
            <circle cx="58" cy="0" r="7" className="topology-link-port" data-link-port="true" onPointerDown={(event) => beginLink(event, { kind: entry.kind, id: entry.item.id }, position)} />
          </g>;
        })}
      </g>
      <text x="18" y="682" className="topology-coordinates-note">Logical canvas positions are stored separately from geographic coordinates.</text>
    </svg>
    <div className="topology-zoom-label">{Math.round(viewport.scale * 100)}%</div>
  </section>;
}

function isPaletteDevice(value: string): value is PaletteDevice {
  return value === "customer" || NODE_TYPES.some((type) => type === value);
}
