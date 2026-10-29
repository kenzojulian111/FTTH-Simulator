import type { NetworkNode, Project, TopologyConnection } from "./types";

export interface ConnectionDraft {
  fromNodeId: string;
  toNodeId: string;
  cableSegmentId: string;
}

export type ConnectionIssueCode =
  | "missing-source"
  | "missing-destination"
  | "missing-cable"
  | "invalid-reference"
  | "same-device"
  | "duplicate-link"
  | "incompatible-types"
  | "prohibited-cycle"
  | "capacity-exceeded";

export interface ConnectionValidation {
  valid: boolean;
  code: ConnectionIssueCode | null;
  message: string;
}

/**
 * Fast synchronous checks mirror basic project integrity. The backend candidate
 * endpoint remains authoritative for GPON transition, capacity, and cycle policy.
 */
export function validateConnection(project: Project, draft: ConnectionDraft): ConnectionValidation {
  const source = draft.fromNodeId ? project.nodes.find((node) => node.id === draft.fromNodeId) : undefined;
  const destination = draft.toNodeId ? project.nodes.find((node) => node.id === draft.toNodeId) : undefined;
  const cableExists = Boolean(draft.cableSegmentId && project.cableSegments.some((cable) => cable.id === draft.cableSegmentId));

  let code: ConnectionIssueCode | null = null;
  let message = "Connection passes the published project integrity checks.";
  if (!draft.fromNodeId) { code = "missing-source"; message = "Choose a source device."; }
  else if (!source) { code = "invalid-reference"; message = "The selected source device no longer exists in this project."; }
  else if (!draft.toNodeId) { code = "missing-destination"; message = "Choose a destination device."; }
  else if (!destination) { code = "invalid-reference"; message = "The selected destination device no longer exists in this project."; }
  else if (source.id === destination.id) { code = "same-device"; message = "A connection must join two different devices."; }
  else if (!draft.cableSegmentId) { code = "missing-cable"; message = "Choose a cable segment for this connection."; }
  else if (!cableExists) { code = "invalid-reference"; message = "The selected cable segment no longer exists in this project."; }
  else if (project.connections.some((connection) => sameConnection(connection, draft))) {
    code = "duplicate-link";
    message = "This directed connection already exists on the selected cable.";
  }

  return { valid: code === null, code, message };
}

export function getDestinationChoices(project: Project, sourceId: string, cableSegmentId: string): NetworkNode[] {
  const sourceExists = project.nodes.some((node) => node.id === sourceId);
  if (!sourceExists) return [];
  return project.nodes.filter((destination) => destination.id !== sourceId && !project.connections.some((connection) =>
    connection.fromNodeId === sourceId && connection.toNodeId === destination.id && connection.cableSegmentId === cableSegmentId,
  ));
}

export type ConnectionCreation = { ok: true; connection: TopologyConnection } | { ok: false; validation: ConnectionValidation };

export function createValidatedConnection(project: Project, draft: ConnectionDraft, id: string): ConnectionCreation {
  const validation = validateConnection(project, draft);
  if (!validation.valid) return { ok: false, validation };
  return { ok: true, connection: { id, fromNodeId: draft.fromNodeId, toNodeId: draft.toNodeId, cableSegmentId: draft.cableSegmentId } };
}

function sameConnection(connection: TopologyConnection, draft: ConnectionDraft): boolean {
  return connection.fromNodeId === draft.fromNodeId
    && connection.toNodeId === draft.toNodeId
    && connection.cableSegmentId === draft.cableSegmentId;
}
