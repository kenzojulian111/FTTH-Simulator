import type { Customer, FeatureProperties, NetworkNode, NodeType, Project, PropertyValue } from "./types";

export interface LogicalPosition {
  x: number;
  y: number;
}

export const NODE_CARD_WIDTH = 116;
export const NODE_CARD_HEIGHT = 64;
export const NODE_CARD_HALF_WIDTH = 58;
export const NODE_CARD_HALF_HEIGHT = 32;

/**
 * Extract stored logical canvas position from feature properties.
 * Returns null if missing, malformed, or non-finite.
 */
export function getStoredLogicalPosition(properties: FeatureProperties): LogicalPosition | null {
  const value = properties.logicalPosition;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { x, y } = value;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
    ? { x, y }
    : null;
}

/**
 * Assign or update the logical canvas position in feature properties.
 */
export function setLogicalPosition(properties: FeatureProperties, position: LogicalPosition): FeatureProperties {
  const logicalPosition: PropertyValue = { x: position.x, y: position.y };
  return { ...properties, logicalPosition };
}

/**
 * Canonical FTTH GPON tier index (left-to-right signal progression).
 * - Tier 0: OLT (Central Office transmitter)
 * - Tier 1: ODC (Primary distribution cabinet / 1st-stage splitters)
 * - Tier 2: ODP (Secondary distribution terminal / 2nd-stage splitters)
 * - Tier 3: ONT (Customer premises optical termination)
 * - Tier 4: Router (Customer premises LAN gateway)
 */
export function getDeviceTier(type: NodeType): number {
  switch (type) {
    case "olt": return 0;
    case "odc": return 1;
    case "splitter": return 1.5; // Staggered between feeder and distribution
    case "odp": return 2;
    case "ont": return 3;
    case "router": return 4;
    case "pole": return -1; // Civil infrastructure
    case "customer": return 5;
    default: return 2;
  }
}

export interface DefaultLayoutOptions {
  canvasWidth?: number;
  canvasHeight?: number;
  startX?: number;
  tierGapX?: number;
  rowGapY?: number;
  startY?: number;
}

/**
 * Compute readable default logical canvas positions for all network nodes and customers.
 *
 * Rules:
 * 1. STRICTLY PRESERVES any existing `logicalPosition` in node/customer properties.
 * 2. Places unpositioned nodes into clear hierarchical FTTH tiers (OLT -> ODC -> ODP -> ONT -> Router).
 * 3. Groups Customer nodes immediately adjacent to their associated ONT (`customer.ontNodeId`).
 * 4. Stacks multiple Customers sharing an ONT vertically without overlapping.
 * 5. Places unassigned customers in a dedicated staging column so they never collide with OLT/ODC nodes.
 * 6. Places civil poles along a separate bottom infrastructure row.
 * 7. Fully deterministic and pure: never mutates inputs, never introduces random jitter on render.
 */
export function computeDefaultLogicalLayout(
  project: Project,
  options: DefaultLayoutOptions = {}
): Map<string, LogicalPosition> {
  const startX = options.startX ?? 120;
  const tierGapX = options.tierGapX ?? 200;
  const startY = options.startY ?? 140;
  const rowGapY = options.rowGapY ?? 110;

  const positions = new Map<string, LogicalPosition>();

  // 1. Gather all nodes with pre-existing user-defined positions
  for (const node of project.nodes) {
    const stored = getStoredLogicalPosition(node.properties);
    if (stored) positions.set(node.id, stored);
  }

  // 2. Separate unpositioned nodes by tier
  const tierBuckets = new Map<number, NetworkNode[]>();
  const poles: NetworkNode[] = [];

  for (const node of project.nodes) {
    if (positions.has(node.id)) continue;
    if (node.type === "pole") {
      poles.push(node);
      continue;
    }
    const tier = Math.floor(getDeviceTier(node.type));
    const bucket = tierBuckets.get(tier) ?? [];
    bucket.push(node);
    tierBuckets.set(tier, bucket);
  }

  // 3. Assign positions for optical/network nodes by tier
  for (const [tier, nodes] of tierBuckets.entries()) {
    const x = startX + tier * tierGapX;
    const baseOffsetY = nodes.length > 3 ? Math.max(80, startY - 40) : startY;

    nodes.forEach((node, index) => {
      const y = baseOffsetY + index * rowGapY;
      positions.set(node.id, { x, y });
    });
  }

  // 4. Assign positions for civil infrastructure (poles) along bottom row
  if (poles.length > 0) {
    const poleY = options.canvasHeight ? options.canvasHeight - 90 : 610;
    const poleStartX = startX + 50;
    const poleGapX = 140;
    poles.forEach((pole, index) => {
      positions.set(pole.id, { x: poleStartX + index * poleGapX, y: poleY });
    });
  }

  // 5. Gather all customers with pre-existing user-defined positions
  for (const customer of project.customers) {
    const stored = getStoredLogicalPosition(customer.properties);
    if (stored) positions.set(customer.id, stored);
  }

  // 6. Group unpositioned customers near their associated ONTs
  const ontCustomerMap = new Map<string, Customer[]>();
  const unassignedCustomers: Customer[] = [];

  for (const customer of project.customers) {
    if (positions.has(customer.id)) continue;
    if (customer.ontNodeId && positions.has(customer.ontNodeId)) {
      const list = ontCustomerMap.get(customer.ontNodeId) ?? [];
      list.push(customer);
      ontCustomerMap.set(customer.ontNodeId, list);
    } else {
      unassignedCustomers.push(customer);
    }
  }

  for (const [ontId, customers] of ontCustomerMap.entries()) {
    const ontPos = positions.get(ontId)!;
    const customerOffsetX = 140; // To the right of the ONT
    const count = customers.length;
    const spacingY = 65;

    customers.forEach((customer, index) => {
      // Center the vertical stack of customers relative to the parent ONT
      const yOffset = count === 1 ? 0 : (index - (count - 1) / 2) * spacingY;
      positions.set(customer.id, {
        x: ontPos.x + customerOffsetX,
        y: ontPos.y + yOffset,
      });
    });
  }

  // 7. Place unassigned customers in a clean staging column on the far right / bottom
  if (unassignedCustomers.length > 0) {
    const unassignedX = startX + 4 * tierGapX + 40;
    const unassignedStartY = startY;
    const unassignedGapY = 75;
    unassignedCustomers.forEach((customer, index) => {
      positions.set(customer.id, {
        x: unassignedX,
        y: unassignedStartY + index * unassignedGapY,
      });
    });
  }

  return positions;
}

/**
 * Compute port connection points between two nodes.
 * Connects the right port of the source node (+58) to the left port of the destination node (-58)
 * for standard forward flow, keeping arrowheads outside the card boundary and in plain sight.
 */
export function computePortConnectionPoints(
  fromPos: LogicalPosition,
  toPos: LogicalPosition
): { start: LogicalPosition; end: LogicalPosition } {
  // If destination is to the right (standard forward flow)
  if (toPos.x >= fromPos.x) {
    return {
      start: { x: fromPos.x + NODE_CARD_HALF_WIDTH, y: fromPos.y },
      end: { x: toPos.x - NODE_CARD_HALF_WIDTH, y: toPos.y },
    };
  }

  // If destination is to the left (reverse flow or feedback)
  return {
    start: { x: fromPos.x - NODE_CARD_HALF_WIDTH, y: fromPos.y },
    end: { x: toPos.x + NODE_CARD_HALF_WIDTH, y: toPos.y },
  };
}

/**
 * Generate a smooth cubic Bézier curve SVG path string between two port positions.
 * Prevents straight lines from cutting diagonally across intervening tier cards.
 */
export function computeBezierPath(start: LogicalPosition, end: LogicalPosition): string {
  const dx = end.x - start.x;
  const controlOffset = Math.max(30, Math.abs(dx) * 0.45);

  const cp1x = start.x + (dx >= 0 ? controlOffset : -controlOffset);
  const cp1y = start.y;
  const cp2x = end.x - (dx >= 0 ? controlOffset : -controlOffset);
  const cp2y = end.y;

  return `M ${start.x.toFixed(1)},${start.y.toFixed(1)} C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${end.x.toFixed(1)},${end.y.toFixed(1)}`;
}

/**
 * Compute midpoint and vertical offset for link labels to prevent overlapping text.
 */
export function computeLinkLabelPosition(
  start: LogicalPosition,
  end: LogicalPosition,
  index = 0,
  total = 1
): LogicalPosition {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  if (total <= 1) {
    return { x: midX, y: midY - 10 };
  }

  // If multiple connections share a path, distribute label offsets vertically
  const offset = (index - (total - 1) / 2) * 16 - 10;
  return { x: midX, y: midY + offset };
}
