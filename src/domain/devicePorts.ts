import type { Customer, DevicePort, NetworkNode, PortType, TopologyConnection } from "./types";

export interface ConfiguredPortItem {
  id: string;
  label?: string;
  status?: "available" | "disabled";
  [key: string]: string | undefined;
}

export function parseSplitterOutputCount(ratio: string | null | undefined): number {
  if (!ratio || typeof ratio !== "string") return 8;
  const parts = ratio.split(":");
  if (parts.length === 2) {
    const val = parseInt(parts[1], 10);
    if (!isNaN(val) && val > 0) return val;
  }
  return 8;
}

export function getDevicePorts(
  node: NetworkNode,
  connections: TopologyConnection[] = [],
  nodesById: Record<string, NetworkNode> = {},
  customers: Customer[] = [],
): DevicePort[] {
  const ports: DevicePort[] = [];
  const configuredList = Array.isArray(node.properties.configuredPorts)
    ? (node.properties.configuredPorts as unknown as ConfiguredPortItem[])
    : [];
  const configuredMap = new Map<string, ConfiguredPortItem>(
    configuredList.map((item) => [item.id, item]),
  );

  const outgoing = connections.filter((conn) => conn.fromNodeId === node.id);
  const incoming = connections.filter((conn) => conn.toNodeId === node.id);

  if (node.type === "olt") {
    const ponCount = Math.max(
      1,
      typeof node.properties.ponPortCapacity === "number"
        ? node.properties.ponPortCapacity
        : typeof node.properties.ponPorts === "number"
          ? node.properties.ponPorts
          : 4,
    );
    const maxCust = typeof node.properties.maxCustomersPerPort === "number" ? node.properties.maxCustomersPerPort : 64;

    const usedOutgoing = new Set<string>();

    for (let i = 1; i <= ponCount; i++) {
      const portId = `PON-${i}`;
      const defaultLabel = `PON ${i}`;
      const conf = configuredMap.get(portId);
      const label = conf?.label || defaultLabel;
      const isDisabled = conf?.status === "disabled";

      // Match connection by fromPortId or label
      let conn = outgoing.find((c) => (c.fromPortId === portId || c.fromPortId === label) && !usedOutgoing.has(c.id));
      if (!conn) {
        // Fallback: match by downstream sourcePonPortId if configured
        conn = outgoing.find((c) => {
          if (usedOutgoing.has(c.id)) return false;
          const target = nodesById[c.toNodeId];
          const targetPon = target?.properties.sourcePonPortId;
          return targetPon === label || targetPon === portId;
        });
      }
      if (!conn) {
        // Fallback: sequential unassigned outgoing connection
        conn = outgoing.find((c) => !c.fromPortId && !usedOutgoing.has(c.id));
      }

      let status: "available" | "connected" | "disabled" = "available";
      let connectedNodeId: string | null = null;
      let connectedNodeName: string | null = null;
      let connectionId: string | null = null;

      if (isDisabled) {
        status = "disabled";
      } else if (conn) {
        status = "connected";
        usedOutgoing.add(conn.id);
        connectedNodeId = conn.toNodeId;
        connectedNodeName = nodesById[conn.toNodeId]?.name ?? conn.toNodeId;
        connectionId = conn.id;
      }

      ports.push({
        id: portId,
        label,
        portType: "pon",
        nodeId: node.id,
        capacity: maxCust,
        status,
        connectedNodeId,
        connectedNodeName,
        connectedPortId: conn?.toPortId ?? null,
        connectionId,
      });
    }
  } else if (node.type === "odc") {
    const feederCount = Math.max(
      1,
      typeof node.properties.feederPortCapacity === "number"
        ? node.properties.feederPortCapacity
        : 4,
    );
    const distCount = Math.max(
      1,
      typeof node.properties.distributionPortCapacity === "number"
        ? node.properties.distributionPortCapacity
        : typeof node.properties.distributionFanoutCapacity === "number"
          ? node.properties.distributionFanoutCapacity
          : 16,
    );

    const usedIncoming = new Set<string>();
    const usedOutgoing = new Set<string>();

    for (let i = 1; i <= feederCount; i++) {
      const portId = `IN-${i.toString().padStart(2, "0")}`;
      const defaultLabel = `Feeder IN ${i}`;
      const conf = configuredMap.get(portId);
      const label = conf?.label || defaultLabel;
      const isDisabled = conf?.status === "disabled";

      let conn = incoming.find((c) => (c.toPortId === portId || c.toPortId === label) && !usedIncoming.has(c.id));
      if (!conn) {
        conn = incoming.find((c) => !c.toPortId && !usedIncoming.has(c.id));
      }

      let status: "available" | "connected" | "disabled" = "available";
      let connectedNodeId: string | null = null;
      let connectedNodeName: string | null = null;
      let connectionId: string | null = null;

      if (isDisabled) {
        status = "disabled";
      } else if (conn) {
        status = "connected";
        usedIncoming.add(conn.id);
        connectedNodeId = conn.fromNodeId;
        connectedNodeName = nodesById[conn.fromNodeId]?.name ?? conn.fromNodeId;
        connectionId = conn.id;
      }

      ports.push({
        id: portId,
        label,
        portType: "feeder_in",
        nodeId: node.id,
        capacity: 1,
        status,
        connectedNodeId,
        connectedNodeName,
        connectedPortId: conn?.fromPortId ?? null,
        connectionId,
      });
    }

    for (let i = 1; i <= distCount; i++) {
      const portId = `OUT-${i.toString().padStart(2, "0")}`;
      const defaultLabel = `Distribution OUT ${i}`;
      const conf = configuredMap.get(portId);
      const label = conf?.label || defaultLabel;
      const isDisabled = conf?.status === "disabled";

      let conn = outgoing.find((c) => (c.fromPortId === portId || c.fromPortId === label) && !usedOutgoing.has(c.id));
      if (!conn) {
        conn = outgoing.find((c) => !c.fromPortId && !usedOutgoing.has(c.id));
      }

      let status: "available" | "connected" | "disabled" = "available";
      let connectedNodeId: string | null = null;
      let connectedNodeName: string | null = null;
      let connectionId: string | null = null;

      if (isDisabled) {
        status = "disabled";
      } else if (conn) {
        status = "connected";
        usedOutgoing.add(conn.id);
        connectedNodeId = conn.toNodeId;
        connectedNodeName = nodesById[conn.toNodeId]?.name ?? conn.toNodeId;
        connectionId = conn.id;
      }

      ports.push({
        id: portId,
        label,
        portType: "distribution_out",
        nodeId: node.id,
        capacity: 1,
        status,
        connectedNodeId,
        connectedNodeName,
        connectedPortId: conn?.toPortId ?? null,
        connectionId,
      });
    }
  } else if (node.type === "odp") {
    // Input Port
    const inConn = incoming[0];
    ports.push({
      id: "IN",
      label: "IN",
      portType: "input",
      nodeId: node.id,
      capacity: 1,
      status: inConn ? "connected" : "available",
      connectedNodeId: inConn?.fromNodeId ?? null,
      connectedNodeName: inConn ? (nodesById[inConn.fromNodeId]?.name ?? inConn.fromNodeId) : null,
      connectedPortId: inConn?.fromPortId ?? null,
      connectionId: inConn?.id ?? null,
    });

    // Output Ports from Splitter Ratio or explicit capacity
    const explicitCapacity = typeof node.properties.portCapacity === "number"
      ? node.properties.portCapacity
      : typeof node.properties.capacity === "number"
        ? node.properties.capacity
        : typeof node.properties.outputPorts === "number"
          ? node.properties.outputPorts
          : null;
    const ratio = typeof node.properties.splitterRatio === "string" ? node.properties.splitterRatio : "1:8";
    const outCount = Math.max(1, explicitCapacity ?? parseSplitterOutputCount(ratio));
    const usedOutgoing = new Set<string>();

    for (let i = 1; i <= outCount; i++) {
      const portId = `OUT-${i}`;
      const defaultLabel = `OUT ${i}`;
      const conf = configuredMap.get(portId);
      const label = conf?.label || defaultLabel;
      const isDisabled = conf?.status === "disabled";

      let conn = outgoing.find((c) => (c.fromPortId === portId || c.fromPortId === label) && !usedOutgoing.has(c.id));
      if (!conn) {
        conn = outgoing.find((c) => !c.fromPortId && !usedOutgoing.has(c.id));
      }

      let status: "available" | "connected" | "disabled" = "available";
      let connectedNodeId: string | null = null;
      let connectedNodeName: string | null = null;
      let connectionId: string | null = null;

      if (isDisabled) {
        status = "disabled";
      } else if (conn) {
        status = "connected";
        usedOutgoing.add(conn.id);
        connectedNodeId = conn.toNodeId;
        const targetNode = nodesById[conn.toNodeId];
        const linkedCust = customers.find((c) => c.ontNodeId === conn.toNodeId);
        connectedNodeName = linkedCust ? `${targetNode?.name ?? conn.toNodeId} (${linkedCust.name})` : (targetNode?.name ?? conn.toNodeId);
        connectionId = conn.id;
      }

      ports.push({
        id: portId,
        label,
        portType: "output",
        nodeId: node.id,
        capacity: 1,
        status,
        connectedNodeId,
        connectedNodeName,
        connectedPortId: conn?.toPortId ?? null,
        connectionId,
      });
    }
  } else if (node.type === "splitter") {
    const explicitCapacity = typeof node.properties.outputPorts === "number"
      ? node.properties.outputPorts
      : typeof node.properties.portCapacity === "number"
        ? node.properties.portCapacity
        : typeof node.properties.capacity === "number"
          ? node.properties.capacity
          : null;
    const ratio = typeof node.properties.splitterRatio === "string" ? node.properties.splitterRatio : "1:8";
    const outCount = Math.max(1, explicitCapacity ?? parseSplitterOutputCount(ratio));
    const inputCount = ratio.startsWith("2:") ? 2 : 1;
    const usedIncoming = new Set<string>();
    const usedOutgoing = new Set<string>();

    const mountedHostId =
      typeof node.properties.mountedInNodeId === "string" && node.properties.mountedInNodeId.trim() !== ""
        ? node.properties.mountedInNodeId.trim()
        : typeof node.properties.parentNodeId === "string" && node.properties.parentNodeId.trim() !== ""
          ? node.properties.parentNodeId.trim()
          : null;
    const mountedHostNode = mountedHostId ? nodesById[mountedHostId] : undefined;

    for (let i = 1; i <= inputCount; i++) {
      const portId = `IN-${i.toString().padStart(2, "0")}`;
      const label = `IN ${i}`;
      const conn = incoming.find((c) => !usedIncoming.has(c.id));
      if (conn) usedIncoming.add(conn.id);
      const isMountedInput = !conn && i === 1 && mountedHostId !== null;
      ports.push({
        id: portId,
        label,
        portType: "input",
        nodeId: node.id,
        capacity: 1,
        status: conn || isMountedInput ? "connected" : "available",
        connectedNodeId: conn?.fromNodeId ?? (isMountedInput ? mountedHostId : null),
        connectedNodeName: conn
          ? (nodesById[conn.fromNodeId]?.name ?? conn.fromNodeId)
          : isMountedInput
            ? `${mountedHostNode?.name ?? mountedHostId} (${typeof node.properties.inputPortId === "string" ? node.properties.inputPortId : "IN-1"})`
            : null,
        connectedPortId: conn?.fromPortId ?? (isMountedInput && typeof node.properties.inputPortId === "string" ? node.properties.inputPortId : null),
        connectionId: conn?.id ?? null,
      });
    }

    const assignments = Array.isArray(node.properties.outputPortAssignments)
      ? (node.properties.outputPortAssignments as Array<{ portId?: string; connectedNodeId?: string }>)
      : [];

    for (let i = 1; i <= outCount; i++) {
      const portId = `OUT-${i.toString().padStart(2, "0")}`;
      const shortPortId = `OUT-${i}`;
      const defaultLabel = `OUT ${i}`;
      const conf = configuredMap.get(portId) ?? configuredMap.get(shortPortId);
      const label = conf?.label || defaultLabel;

      let conn = outgoing.find(
        (c) => (c.fromPortId === portId || c.fromPortId === shortPortId || c.fromPortId === label) && !usedOutgoing.has(c.id),
      );
      if (!conn) {
        conn = outgoing.find((c) => !c.fromPortId && !usedOutgoing.has(c.id));
      }

      const assigned = assignments.find(
        (a) => a.portId === portId || a.portId === shortPortId || a.portId === label,
      );
      let status: "available" | "connected" | "disabled" = "available";
      let connectedNodeId: string | null = null;
      let connectedNodeName: string | null = null;
      let connectionId: string | null = null;

      if (conn) {
        status = "connected";
        usedOutgoing.add(conn.id);
        connectedNodeId = conn.toNodeId;
        connectedNodeName = nodesById[conn.toNodeId]?.name ?? conn.toNodeId;
        connectionId = conn.id;
      } else if (assigned?.connectedNodeId) {
        status = "connected";
        connectedNodeId = assigned.connectedNodeId;
        connectedNodeName = nodesById[assigned.connectedNodeId]?.name ?? assigned.connectedNodeId;
      }

      ports.push({
        id: portId,
        label,
        portType: "output",
        nodeId: node.id,
        capacity: 1,
        status,
        connectedNodeId,
        connectedNodeName,
        connectedPortId: conn?.toPortId ?? null,
        connectionId,
      });
    }
  } else if (node.type === "ont") {
    const inConn = incoming[0];
    ports.push({
      id: "PON-IN",
      label: "PON IN",
      portType: "input",
      nodeId: node.id,
      capacity: 1,
      status: inConn ? "connected" : "available",
      connectedNodeId: inConn?.fromNodeId ?? null,
      connectedNodeName: inConn ? (nodesById[inConn.fromNodeId]?.name ?? inConn.fromNodeId) : null,
      connectedPortId: inConn?.fromPortId ?? null,
      connectionId: inConn?.id ?? null,
    });

    const outConn = outgoing[0];
    ports.push({
      id: "LAN-1",
      label: "LAN 1",
      portType: "lan",
      nodeId: node.id,
      capacity: 1,
      status: outConn ? "connected" : "available",
      connectedNodeId: outConn?.toNodeId ?? null,
      connectedNodeName: outConn ? (nodesById[outConn.toNodeId]?.name ?? outConn.toNodeId) : null,
      connectedPortId: outConn?.toPortId ?? null,
      connectionId: outConn?.id ?? null,
    });
  }

  return ports;
}

export function getAvailablePorts(
  node: NetworkNode,
  connections: TopologyConnection[] = [],
  direction: "in" | "out" = "out",
  nodesById: Record<string, NetworkNode> = {},
): DevicePort[] {
  const allPorts = getDevicePorts(node, connections, nodesById);
  const inTypes: PortType[] = ["feeder_in", "input", "uplink"];
  const outTypes: PortType[] = ["pon", "distribution_out", "output", "drop_out", "lan"];

  return allPorts.filter((p) => {
    if (p.status !== "available") return false;
    if (direction === "in") return inTypes.includes(p.portType);
    return outTypes.includes(p.portType);
  });
}

export function validatePortConnection(
  fromNode: NetworkNode,
  fromPortId: string | null | undefined,
  toNode: NetworkNode,
  toPortId: string | null | undefined,
  connections: TopologyConnection[] = [],
): { valid: boolean; message: string } {
  const fromPorts = getDevicePorts(fromNode, connections);
  const toPorts = getDevicePorts(toNode, connections);

  if (fromPortId) {
    const fromPort = fromPorts.find((p) => p.id === fromPortId || p.label === fromPortId);
    if (!fromPort) {
      return { valid: false, message: `Port '${fromPortId}' not found on device '${fromNode.name}'.` };
    }
    if (fromPort.status === "disabled") {
      return { valid: false, message: `Port '${fromPort.label}' on '${fromNode.name}' is disabled.` };
    }
    if (fromPort.status === "connected") {
      return { valid: false, message: `Port '${fromPort.label}' on '${fromNode.name}' is already connected to '${fromPort.connectedNodeName}'.` };
    }
  }

  if (toPortId) {
    const toPort = toPorts.find((p) => p.id === toPortId || p.label === toPortId);
    if (!toPort) {
      return { valid: false, message: `Port '${toPortId}' not found on device '${toNode.name}'.` };
    }
    if (toPort.status === "disabled") {
      return { valid: false, message: `Port '${toPort.label}' on '${toNode.name}' is disabled.` };
    }
    if (toPort.status === "connected") {
      return { valid: false, message: `Port '${toPort.label}' on '${toNode.name}' is already connected to '${toPort.connectedNodeName}'.` };
    }
  }

  return { valid: true, message: "Ports are valid and available." };
}
