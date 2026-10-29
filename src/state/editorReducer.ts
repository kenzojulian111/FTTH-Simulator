import type { CableSegment, Coordinate, Customer, FeatureRef, NetworkNode, OpticalBudgetConfig, PoleSpan, Project, ProjectArea, ProjectSettings, RouterConfiguration } from "../domain/types";
import { approximateLengthMeters, extractSubspanCoordinates } from "../domain/project";
import { setLogicalPosition } from "../domain/layout";
import { createValidatedConnection } from "../domain/connectionValidation";
import { serializeRouterConfiguration } from "../domain/routerConfig";

export interface EditorState { project: Project; selection: FeatureRef | null; dirty: boolean; revision?: number; generation?: number }
export type EditorAction =
  | { type: "load"; project: Project }
  | { type: "select"; selection: FeatureRef | null }
  | { type: "add-node"; node: NetworkNode }
  | { type: "add-customer"; customer: Customer }
  | { type: "add-cable"; cable: CableSegment }
  | { type: "add-pole-span"; span: PoleSpan }
  | { type: "add-area"; area: ProjectArea }
  | { type: "update-area"; area: ProjectArea }
  | { type: "delete-pole-span"; id: string }
  | { type: "pole-span-status"; id: string; status: PoleSpan["status"] }
  | { type: "replace-unconnected-cable"; cable: CableSegment }
  | { type: "add-cable-connection"; cable: CableSegment; connection: Project["connections"][number] }
  | { type: "replace-cable-connection"; cable: CableSegment; connection: Project["connections"][number]; previousConnectionId?: string }
  | { type: "add-connection"; connection: Project["connections"][number] }
  | { type: "delete-connection"; id: string }
  | { type: "move"; ref: FeatureRef; location: Coordinate }
  | { type: "move-logical"; ref: { kind: "node" | "customer"; id: string }; position: { x: number; y: number } }
  | { type: "move-vertex"; id: string; index: number; location: Coordinate }
  | { type: "cable-attributes"; id: string; cableType: string; fiberCount: number | null; properties?: CableSegment["properties"] }
  | { type: "pole-properties"; id: string; properties: NetworkNode["properties"] }
  | { type: "pole-span-settings"; settings: NonNullable<ProjectSettings["poleSpanPlanning"]> }
  | { type: "construction-cost-config"; config: ProjectSettings["constructionCost"] }
  | { type: "optical-components"; components: NonNullable<Project["opticalComponents"]> }
  | { type: "rename"; ref: FeatureRef; name: string }
  | { type: "customer-address"; id: string; address: string }
  | { type: "customer-ont"; id: string; ontNodeId: string | null }
  | { type: "customer-status"; id: string; status: Customer["status"] }
  | { type: "router-configuration"; id: string; configuration: RouterConfiguration }
  | { type: "optical-budget-config"; config: OpticalBudgetConfig }
  | { type: "splitter-optical-config"; id: string; ratio: string | null; insertionLossDb: number | null }
  | { type: "delete"; ref: FeatureRef }
  | { type: "project-name"; name: string }
  | { type: "saved"; project: Project; expectedRevision?: number; expectedGeneration?: number };

function reconcileCablePoleSpans(project: Project, spans: PoleSpan[], cableSegmentId: string): PoleSpan[] {
  const cableSpans = spans.filter((s) => s.cableSegmentId === cableSegmentId);
  if (cableSpans.length <= 1) return spans;
  const cable = project.cableSegments.find((c) => c.id === cableSegmentId);
  const nodesById = new Map(project.nodes.map((n) => [n.id, n]));
  return spans.map((span) => {
    if (span.cableSegmentId !== cableSegmentId) return span;
    if (span.lengthSource === "measured" || span.lengthSource === "legacy") return span;
    if (span.geometry && span.geometry.coordinates.length >= 2) {
      return {
        ...span,
        coversEntireCableRoute: false,
        lengthM: Number(approximateLengthMeters(span.geometry.coordinates).toFixed(2)),
        lengthSource: "geometry",
      };
    }
    const subCoords = cable ? extractSubspanCoordinates(cable.geometry.coordinates, nodesById.get(span.fromPoleId), nodesById.get(span.toPoleId)) : null;
    if (subCoords) {
      return {
        ...span,
        geometry: { type: "LineString", coordinates: subCoords },
        coversEntireCableRoute: false,
        lengthM: Number(approximateLengthMeters(subCoords).toFixed(2)),
        lengthSource: "geometry",
      };
    }
    if (span.coversEntireCableRoute) {
      return {
        ...span,
        coversEntireCableRoute: false,
        lengthM: null,
        lengthSource: "unknown",
      };
    }
    return span;
  });
}

function markEdited(state: EditorState, values: Partial<EditorState>): EditorState {
  return { ...state, ...values, revision: (state.revision ?? 0) + 1, dirty: true };
}

function moveCableNodeEndpoint(cable: CableSegment, nodeId: string, location: Coordinate): CableSegment {
  const movesStart = cable.startNodeId === nodeId;
  const movesEnd = cable.endNodeId === nodeId;
  if ((!movesStart && !movesEnd) || cable.geometry.coordinates.length === 0) return cable;
  const coordinates: Coordinate[] = cable.geometry.coordinates.map((coordinate) => [coordinate[0], coordinate[1]]);
  let changed = false;
  if (movesStart) {
    changed ||= coordinates[0][0] !== location[0] || coordinates[0][1] !== location[1];
    coordinates[0] = [location[0], location[1]];
  }
  if (movesEnd) {
    const last = coordinates.length - 1;
    changed ||= coordinates[last][0] !== location[0] || coordinates[last][1] !== location[1];
    coordinates[last] = [location[0], location[1]];
  }
  return changed ? { ...cable, geometry: { type: "LineString", coordinates }, lengthM: null } : cable;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === "load") return { project: action.project, selection: null, dirty: false, revision: 0, generation: (state.generation ?? 0) + 1 };
  if (action.type === "select") return { ...state, selection: action.selection };
  if (action.type === "saved") {
    if (action.expectedRevision !== undefined && action.expectedRevision !== (state.revision ?? 0)) return state;
    if (action.expectedGeneration !== undefined && action.expectedGeneration !== (state.generation ?? 0)) return state;
    if (action.project.id !== state.project.id) return state;
    return { ...state, project: action.project, dirty: false };
  }
  const updatedAt = new Date().toISOString();
  const project = { ...state.project, updatedAt };
  switch (action.type) {
    case "add-node": return markEdited(state, { project: { ...project, nodes: [...project.nodes, action.node] }, selection: { kind: "node", id: action.node.id } });
    case "add-customer": return markEdited(state, { project: { ...project, customers: [...project.customers, action.customer] }, selection: { kind: "customer", id: action.customer.id } });
    case "add-area": return markEdited(state, { project: { ...project, areas: [...(project.areas ?? []), action.area] }, selection: { kind: "area", id: action.area.id } });
    case "update-area": return markEdited(state, { project: { ...project, areas: (project.areas ?? []).map((area) => area.id === action.area.id ? action.area : area) } });
    case "add-cable": return markEdited(state, { project: { ...project, cableSegments: [...project.cableSegments, action.cable] }, selection: { kind: "cable", id: action.cable.id } });
    case "add-pole-span": {
      const nextSpans = reconcileCablePoleSpans(project, [...(project.poleSpans ?? []), action.span], action.span.cableSegmentId);
      return markEdited(state, { project: { ...project, poleSpans: nextSpans } });
    }
    case "delete-pole-span": return markEdited(state, { project: { ...project, poleSpans: (project.poleSpans ?? []).filter((span) => span.id !== action.id) } });
    case "pole-span-status": return markEdited(state, { project: { ...project, poleSpans: (project.poleSpans ?? []).map((span) => span.id === action.id ? { ...span, status: action.status } : span) } });
    case "replace-unconnected-cable": {
      const exists = project.cableSegments.some((cable) => cable.id === action.cable.id);
      const connected = project.connections.some((connection) => connection.cableSegmentId === action.cable.id);
      if (!exists || connected || action.cable.startNodeId || action.cable.endNodeId) return state;
      return markEdited(state, {
        project: { ...project, cableSegments: project.cableSegments.map((cable) => cable.id === action.cable.id ? action.cable : cable) },
        selection: { kind: "cable", id: action.cable.id },
      });
    }
    case "add-cable-connection": {
      if (project.cableSegments.some((cable) => cable.id === action.cable.id) || project.connections.some((connection) => connection.id === action.connection.id)) return state;
      const draftProject = { ...project, cableSegments: [...project.cableSegments, action.cable] };
      const result = createValidatedConnection(draftProject, action.connection, action.connection.id);
      if (!result.ok) return state;
      return markEdited(state, {
        project: { ...draftProject, connections: [...project.connections, result.connection] },
        selection: { kind: "cable", id: action.cable.id },
      });
    }
    case "replace-cable-connection": {
      const cableExists = project.cableSegments.some((cable) => cable.id === action.cable.id);
      const connectionIndex = action.previousConnectionId
        ? project.connections.findIndex((connection) => connection.id === action.previousConnectionId && connection.cableSegmentId === action.cable.id)
        : -1;
      if (!cableExists || (action.previousConnectionId && connectionIndex < 0) || (action.previousConnectionId && action.connection.id !== action.previousConnectionId)) return state;
      const draftProject = {
        ...project,
        cableSegments: project.cableSegments.map((cable) => cable.id === action.cable.id ? action.cable : cable),
        connections: action.previousConnectionId
          ? project.connections.filter((connection) => connection.id !== action.previousConnectionId)
          : project.connections,
      };
      const result = createValidatedConnection(draftProject, action.connection, action.connection.id);
      if (!result.ok) return state;
      const connections = [...draftProject.connections];
      connections.splice(connectionIndex < 0 ? connections.length : connectionIndex, 0, result.connection);
      return markEdited(state, { project: { ...draftProject, connections }, selection: { kind: "cable", id: action.cable.id } });
    }
    case "add-connection": {
      const result = createValidatedConnection(state.project, action.connection, action.connection.id);
      if (!result.ok) return state;
      const cableAlreadyConnected = project.connections.some((connection) => connection.cableSegmentId === result.connection.cableSegmentId);
      return markEdited(state, { project: {
        ...project,
        cableSegments: cableAlreadyConnected ? project.cableSegments : project.cableSegments.map((cable) => cable.id === result.connection.cableSegmentId
          ? { ...cable, startNodeId: result.connection.fromNodeId, endNodeId: result.connection.toNodeId, updatedAt }
          : cable),
        connections: [...project.connections, result.connection],
      } });
    }
    case "delete-connection": return markEdited(state, { project: { ...project, connections: project.connections.filter((x) => x.id !== action.id), opticalComponents: (project.opticalComponents ?? []).filter((comp) => comp.connectionId !== action.id) } });
    case "project-name": return markEdited(state, { project: { ...project, name: action.name } });
    case "customer-address": return markEdited(state, { project: { ...project, customers: project.customers.map((x) => x.id === action.id ? { ...x, address: action.address, updatedAt } : x) } });
    case "customer-ont": return markEdited(state, { project: { ...project, customers: project.customers.map((x) => x.id === action.id ? { ...x, ontNodeId: action.ontNodeId, updatedAt } : x) } });
    case "customer-status": return markEdited(state, { project: { ...project, customers: project.customers.map((x) => x.id === action.id ? { ...x, status: action.status, updatedAt } : x) } });
    case "router-configuration": return markEdited(state, { project: { ...project, nodes: project.nodes.map((node) => node.id === action.id && node.type === "router" ? { ...node, properties: { ...node.properties, routerConfiguration: serializeRouterConfiguration(action.configuration) }, updatedAt } : node) } });
    case "optical-budget-config": return markEdited(state, { project: { ...project, settings: { ...project.settings, opticalBudget: action.config } } });
    case "splitter-optical-config": return markEdited(state, { project: { ...project, nodes: project.nodes.map((node) => node.id === action.id && (node.type === "splitter" || node.properties.splitterRatio !== undefined || node.properties.splitterLossDb !== undefined) ? { ...node, properties: { ...node.properties, splitterRatio: action.ratio, splitterLossDb: action.insertionLossDb }, updatedAt } : node) } });
    case "rename": {
      const { ref, name } = action;
      if (ref.kind === "node") return markEdited(state, { project: { ...project, nodes: project.nodes.map((x) => x.id === ref.id ? { ...x, name, updatedAt } : x) } });
      if (ref.kind === "customer") return markEdited(state, { project: { ...project, customers: project.customers.map((x) => x.id === ref.id ? { ...x, name, updatedAt } : x) } });
      return markEdited(state, { project: { ...project, cableSegments: project.cableSegments.map((x) => x.id === ref.id ? { ...x, name, updatedAt } : x) } });
    }
    case "move": {
      const { ref, location } = action;
      if (ref.kind === "node") return markEdited(state, { project: { ...project, nodes: project.nodes.map((x) => x.id === ref.id ? { ...x, location: { type: "Point", coordinates: location }, properties: { ...x.properties, geographicPositionSet: true }, updatedAt } : x), cableSegments: project.cableSegments.map((cable) => moveCableNodeEndpoint(cable, ref.id, location)) } });
      if (ref.kind === "customer") return markEdited(state, { project: { ...project, customers: project.customers.map((x) => x.id === ref.id ? { ...x, location: { type: "Point", coordinates: location }, properties: { ...x.properties, geographicPositionSet: true }, updatedAt } : x) } });
      return state;
    }
    case "move-logical": {
      const { ref, position } = action;
      if (ref.kind === "node") return markEdited(state, { project: { ...project, nodes: project.nodes.map((x) => x.id === ref.id ? { ...x, properties: setLogicalPosition(x.properties, position), updatedAt } : x) } });
      return markEdited(state, { project: { ...project, customers: project.customers.map((x) => x.id === ref.id ? { ...x, properties: setLogicalPosition(x.properties, position), updatedAt } : x) } });
    }
    case "move-vertex": return markEdited(state, { project: { ...project, cableSegments: project.cableSegments.map((x) => x.id === action.id ? { ...x, geometry: { type: "LineString", coordinates: x.geometry.coordinates.map((p, i) => i === action.index ? action.location : p) }, lengthM: null, updatedAt } : x) } });
    case "cable-attributes": {
      const nextDeployment = action.properties && typeof action.properties.deploymentMethod === "string"
        ? action.properties.deploymentMethod
        : undefined;
      return markEdited(state, {
        project: {
          ...project,
          cableSegments: project.cableSegments.map((x) => x.id === action.id
            ? {
                ...x,
                cableType: action.cableType,
                fiberCount: action.fiberCount,
                ...(nextDeployment ? { deploymentMethod: nextDeployment as CableSegment["deploymentMethod"] } : {}),
                properties: action.properties ? { ...x.properties, ...action.properties } : x.properties,
                updatedAt,
              }
            : x),
        },
      });
    }
    case "pole-properties": return markEdited(state, { project: { ...project, nodes: project.nodes.map((x) => x.id === action.id && x.type === "pole" ? { ...x, properties: { ...x.properties, ...action.properties }, updatedAt } : x) } });
    case "pole-span-settings": return markEdited(state, { project: { ...project, settings: { ...project.settings, poleSpanPlanning: action.settings } } });
    case "construction-cost-config": return markEdited(state, { project: { ...project, settings: { ...project.settings, constructionCost: action.config } } });
    case "optical-components": return markEdited(state, { project: { ...project, opticalComponents: action.components } });
    case "delete": {
      const { ref } = action;
      if (ref.kind === "area") return markEdited(state, { project: { ...project, areas: (project.areas ?? []).filter((area) => area.id !== ref.id) }, selection: null });
      if (ref.kind === "node") {
        const removedConnectionIds = new Set(
          project.connections.filter((x) => x.fromNodeId === ref.id || x.toNodeId === ref.id).map((x) => x.id),
        );
        const next = {
          ...project,
          nodes: project.nodes.filter((x) => x.id !== ref.id),
          customers: project.customers.map((x) => x.ontNodeId === ref.id ? { ...x, ontNodeId: null, updatedAt } : x),
          cableSegments: project.cableSegments.map((x) => x.startNodeId === ref.id || x.endNodeId === ref.id ? { ...x, startNodeId: x.startNodeId === ref.id ? null : x.startNodeId, endNodeId: x.endNodeId === ref.id ? null : x.endNodeId, updatedAt } : x),
          connections: project.connections.filter((x) => x.fromNodeId !== ref.id && x.toNodeId !== ref.id),
          poleSpans: (project.poleSpans ?? []).map((span) => span.fromPoleId === ref.id || span.toPoleId === ref.id ? { ...span, status: "unverified" as const } : span),
          opticalComponents: (project.opticalComponents ?? []).filter(
            (comp) => comp.nodeId !== ref.id && (!comp.connectionId || !removedConnectionIds.has(comp.connectionId)),
          ),
        };
        return markEdited(state, { project: next, selection: null });
      }
      if (ref.kind === "customer") {
        return markEdited(state, { project: { ...project, customers: project.customers.filter((x) => x.id !== ref.id) }, selection: null });
      }
      const removedConnectionIds = new Set(
        project.connections.filter((x) => x.cableSegmentId === ref.id).map((x) => x.id),
      );
      const next = {
        ...project,
        cableSegments: project.cableSegments.filter((x) => x.id !== ref.id),
        connections: project.connections.filter((x) => x.cableSegmentId !== ref.id),
        poleSpans: (project.poleSpans ?? []).filter((span) => span.cableSegmentId !== ref.id),
        opticalComponents: (project.opticalComponents ?? []).filter(
          (comp) => !comp.connectionId || !removedConnectionIds.has(comp.connectionId),
        ),
      };
      return markEdited(state, { project: next, selection: null });
    }
  }
}
