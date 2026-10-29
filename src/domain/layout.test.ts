import { describe, expect, it } from "vitest";
import { createEmptyProject } from "./project";
import {
  computeBezierPath,
  computeDefaultLogicalLayout,
  computeLinkLabelPosition,
  computePortConnectionPoints,
  getDeviceTier,
  getStoredLogicalPosition,
  NODE_CARD_HALF_WIDTH,
  setLogicalPosition,
} from "./layout";
import type { Customer, NetworkNode } from "./types";

describe("Logical Topology Layout Engine", () => {
  it("stores and extracts valid logical coordinates while rejecting malformed values", () => {
    const props = setLogicalPosition({}, { x: 350, y: 220 });
    expect(getStoredLogicalPosition(props)).toEqual({ x: 350, y: 220 });

    expect(getStoredLogicalPosition({})).toBeNull();
    expect(getStoredLogicalPosition({ logicalPosition: null })).toBeNull();
    expect(getStoredLogicalPosition({ logicalPosition: "350,220" })).toBeNull();
    expect(getStoredLogicalPosition({ logicalPosition: { x: Number.NaN, y: 220 } })).toBeNull();
    expect(getStoredLogicalPosition({ logicalPosition: { x: 350, y: Number.POSITIVE_INFINITY } })).toBeNull();
  });

  it("assigns appropriate hierarchical tier indices for FTTH device types", () => {
    expect(getDeviceTier("olt")).toBe(0);
    expect(getDeviceTier("odc")).toBe(1);
    expect(getDeviceTier("odp")).toBe(2);
    expect(getDeviceTier("ont")).toBe(3);
    expect(getDeviceTier("router")).toBe(4);
    expect(getDeviceTier("pole")).toBe(-1);
  });

  it("strictly preserves existing user-defined logical positions", () => {
    const project = createEmptyProject("Preserve layout");
    const node1: NetworkNode = {
      id: "olt-user-moved",
      type: "olt",
      name: "Custom OLT",
      location: { type: "Point", coordinates: [115, -8] },
      properties: setLogicalPosition({}, { x: 888, y: 777 }),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const node2: NetworkNode = {
      id: "odc-default",
      type: "odc",
      name: "Auto ODC",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    project.nodes.push(node1, node2);

    const layout = computeDefaultLogicalLayout(project);
    expect(layout.get("olt-user-moved")).toEqual({ x: 888, y: 777 });
    expect(layout.get("odc-default")).toBeDefined();
    expect(layout.get("odc-default")?.x).not.toBe(888);
  });

  it("organizes unpositioned FTTH nodes into left-to-right hierarchical tiers without collisions", () => {
    const project = createEmptyProject("Hierarchical GPON");
    const olt: NetworkNode = {
      id: "olt-1",
      type: "olt",
      name: "OLT 1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const odc: NetworkNode = {
      id: "odc-1",
      type: "odc",
      name: "ODC 1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const odp: NetworkNode = {
      id: "odp-1",
      type: "odp",
      name: "ODP 1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const ont: NetworkNode = {
      id: "ont-1",
      type: "ont",
      name: "ONT 1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const router: NetworkNode = {
      id: "router-1",
      type: "router",
      name: "Router 1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    project.nodes.push(olt, odc, odp, ont, router);

    const layout = computeDefaultLogicalLayout(project);
    const posOlt = layout.get("olt-1")!;
    const posOdc = layout.get("odc-1")!;
    const posOdp = layout.get("odp-1")!;
    const posOnt = layout.get("ont-1")!;
    const posRouter = layout.get("router-1")!;

    // Signal flows from left to right: OLT < ODC < ODP < ONT < Router
    expect(posOlt.x).toBeLessThan(posOdc.x);
    expect(posOdc.x).toBeLessThan(posOdp.x);
    expect(posOdp.x).toBeLessThan(posOnt.x);
    expect(posOnt.x).toBeLessThan(posRouter.x);
  });

  it("groups customer nodes near their associated ONT and prevents collisions with OLT/ODC", () => {
    const project = createEmptyProject("Customer grouping");
    const olt: NetworkNode = {
      id: "olt-1",
      type: "olt",
      name: "OLT 1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const ont1: NetworkNode = {
      id: "ont-1",
      type: "ont",
      name: "ONT 1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const cust1: Customer = {
      id: "cust-1",
      name: "Customer 1",
      address: "123 Main St",
      status: "connected",
      ontNodeId: "ont-1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const cust2: Customer = {
      id: "cust-2",
      name: "Customer 2",
      address: "125 Main St",
      status: "connected",
      ontNodeId: "ont-1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    project.nodes.push(olt, ont1);
    project.customers.push(cust1, cust2);

    const layout = computeDefaultLogicalLayout(project);
    const posOlt = layout.get("olt-1")!;
    const posOnt = layout.get("ont-1")!;
    const posCust1 = layout.get("cust-1")!;
    const posCust2 = layout.get("cust-2")!;

    // Customers MUST NOT collide with OLT (as they did when sharing index 0)
    expect(posCust1).not.toEqual(posOlt);
    expect(posCust2).not.toEqual(posOlt);

    // Customers are placed adjacent to their ONT
    expect(posCust1.x).toBeGreaterThan(posOnt.x);
    expect(posCust2.x).toBeGreaterThan(posOnt.x);

    // Multiple customers on the same ONT are stacked vertically without colliding
    expect(posCust1.y).not.toEqual(posCust2.y);
    expect(Math.abs(posCust1.y - posCust2.y)).toBeGreaterThanOrEqual(50);
  });

  it("places unassigned customers in a separate staging area rather than on top of network nodes", () => {
    const project = createEmptyProject("Unassigned customers");
    const olt: NetworkNode = {
      id: "olt-1",
      type: "olt",
      name: "OLT 1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const custPlanned: Customer = {
      id: "cust-planned",
      name: "Planned Customer",
      address: "Unknown",
      status: "planned",
      ontNodeId: null,
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    project.nodes.push(olt);
    project.customers.push(custPlanned);

    const layout = computeDefaultLogicalLayout(project);
    const posOlt = layout.get("olt-1")!;
    const posCust = layout.get("cust-planned")!;

    expect(posCust).not.toEqual(posOlt);
    expect(Math.abs(posCust.x - posOlt.x)).toBeGreaterThan(500);
  });

  it("places utility poles along a separate civil infrastructure row", () => {
    const project = createEmptyProject("Civil poles");
    const pole1: NetworkNode = {
      id: "pole-1",
      type: "pole",
      name: "Pole 1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const olt: NetworkNode = {
      id: "olt-1",
      type: "olt",
      name: "OLT 1",
      location: { type: "Point", coordinates: [115, -8] },
      properties: {},
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    project.nodes.push(olt, pole1);

    const layout = computeDefaultLogicalLayout(project);
    const posOlt = layout.get("olt-1")!;
    const posPole = layout.get("pole-1")!;

    // Pole is positioned in the bottom civil row, well away from OLT
    expect(posPole.y).toBeGreaterThan(posOlt.y + 200);
  });

  it("calculates port connection endpoints outside node card bounds so arrowheads are visible", () => {
    const from = { x: 200, y: 150 };
    const to = { x: 500, y: 150 };

    const { start, end } = computePortConnectionPoints(from, to);
    // Start is at right edge (+58), end is at left edge (-58)
    expect(start).toEqual({ x: 200 + NODE_CARD_HALF_WIDTH, y: 150 });
    expect(end).toEqual({ x: 500 - NODE_CARD_HALF_WIDTH, y: 150 });
  });

  it("generates a smooth cubic bezier path for tier-to-tier connections", () => {
    const start = { x: 258, y: 150 };
    const end = { x: 442, y: 250 };

    const d = computeBezierPath(start, end);
    expect(d).toContain("M 258.0,150.0 C");
    expect(d).toContain("442.0,250.0");
  });

  it("offsets link labels when multiple connections share a path", () => {
    const start = { x: 200, y: 150 };
    const end = { x: 400, y: 150 };

    const labelPos0 = computeLinkLabelPosition(start, end, 0, 2);
    const labelPos1 = computeLinkLabelPosition(start, end, 1, 2);

    expect(labelPos0.x).toBe(300);
    expect(labelPos1.x).toBe(300);
    expect(labelPos0.y).not.toBe(labelPos1.y);
  });

  it("is purely deterministic across multiple calls with identical input", () => {
    const project = createEmptyProject("Deterministic test");
    project.nodes.push(
      { id: "n1", type: "olt", name: "OLT", location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { id: "n2", type: "odc", name: "ODC", location: { type: "Point", coordinates: [115, -8] }, properties: {}, createdAt: project.createdAt, updatedAt: project.updatedAt }
    );
    const run1 = computeDefaultLogicalLayout(project);
    const run2 = computeDefaultLogicalLayout(project);

    expect(run1.get("n1")).toEqual(run2.get("n1"));
    expect(run1.get("n2")).toEqual(run2.get("n2"));
  });
});
