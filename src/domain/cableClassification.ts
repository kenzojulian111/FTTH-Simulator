import type { CableCategory, CableSegment, Project } from "./types";
import { resolveCableCategory } from "./types";

export interface CableRecommendation { category: CableCategory; explanation: string; warning?: string }

function connectionCategory(project: Project, cable: CableSegment, connection: Project["connections"][number]): CableCategory | null {
  const start = project.nodes.find((node) => node.id === connection.fromNodeId);
  const end = project.nodes.find((node) => node.id === connection.toNodeId);
  if (!start || !end) return null;
  const types = [start.type, end.type];
  if (types.includes("olt") && types.includes("odc")) return "feeder";
  if (types.includes("odc") && types.includes("odp")) return "distribution";
  if (types.includes("odp") && types.includes("ont")) return "drop";
  if (types.includes("ont") && (cable.deploymentMethod === "building_attached" || cable.properties.indoorSegment === true)) return "indoor";
  return null;
}

export function recommendCableCategory(project: Project, cable: CableSegment): CableRecommendation {
  const endpoints = project.connections.filter((connection) => connection.cableSegmentId === cable.id);
  if (endpoints.length > 1) return { category: "custom", explanation: "Multiple topology connections use this cable; no single category is inferred." };
  if (endpoints.length === 1) {
    const category = connectionCategory(project, cable, endpoints[0]);
    if (category) return { category, explanation: `The ${endpoints[0].fromNodeId}–${endpoints[0].toNodeId} connection matches the ${category} topology rule.` };
  }
  const start = project.nodes.find((node) => node.id === (endpoints[0]?.fromNodeId ?? cable.startNodeId));
  const end = project.nodes.find((node) => node.id === (endpoints[0]?.toNodeId ?? cable.endNodeId));
  if (!start || !end) return { category: "custom", explanation: "Both connected endpoint node types are required for a recommendation." };
  const types = [start.type, end.type];
  if (types.includes("olt") && types.includes("odc")) return { category: "feeder", explanation: "OLT–ODC connection matches the feeder rule." };
  if (types.includes("odc") && types.includes("odp")) return { category: "distribution", explanation: "ODC–ODP connection matches the distribution rule." };
  if (types.includes("odp") && types.includes("ont")) return { category: "drop", explanation: "ODP–ONT connection matches the drop rule." };
  if (types.includes("ont") && (cable.deploymentMethod === "building_attached" || cable.properties.indoorSegment === true)) return { category: "indoor", explanation: "An ONT endpoint and explicit indoor/building-attached cable metadata support an indoor segment." };
  return { category: "custom", explanation: `The ${start.type.toUpperCase()}–${end.type.toUpperCase()} connection has no standard category rule.` };
}

export function cableCategoryWarning(project: Project, cable: CableSegment): string | null {
  const actual = resolveCableCategory(cable);
  const connections = project.connections.filter((connection) => connection.cableSegmentId === cable.id);
  if (connections.length > 1) {
    const categories = connections.map((connection) => connectionCategory(project, cable, connection));
    const unique = [...new Set(categories.filter((category): category is CableCategory => category !== null))];
    if (unique.length > 1) return `Logical connections imply conflicting cable categories (${unique.join(", ")}); the selected category ${actual ?? "unspecified"} is preserved.`;
    if (categories.some((category) => category === null) || unique.length === 0) return null;
    return actual && actual !== unique[0] ? `Manual category ${actual} differs from the shared topology recommendation ${unique[0]}; the selected category is preserved.` : null;
  }
  const recommendation = recommendCableCategory(project, cable);
  return actual && actual !== recommendation.category ? `Manual category ${actual} differs from recommendation ${recommendation.category}; the selected category is preserved.` : null;
}

export function validateProjectArea(area: { geometry: { type: string; coordinates: number[][][] } }): string | null {
  const rings = area.geometry?.coordinates;
  if (area.geometry?.type !== "Polygon" || !rings?.length) return "A polygon needs at least three vertices and a closing coordinate.";
  for (const ring of rings) {
    if (!ring || ring.length < 4) return "A polygon needs at least three vertices and a closing coordinate.";
    for (const point of ring) if (point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) return "Polygon coordinates must use valid longitude/latitude values.";
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) return "The polygon ring must be closed (first and last coordinates must match).";
    const vertices = ring.slice(0, -1).map(([longitude, latitude]) => [longitude, latitude] as const);
    if (vertices.some((point, index) => point[0] === vertices[(index + 1) % vertices.length][0] && point[1] === vertices[(index + 1) % vertices.length][1])) return "Polygon ring must not contain duplicate adjacent vertices.";
    if (new Set(vertices.map(([longitude, latitude]) => `${longitude},${latitude}`)).size < 3) return "Polygon ring must contain at least three distinct vertices.";
    const doubledArea = vertices.reduce((areaSum, point, index) => {
      const next = vertices[(index + 1) % vertices.length];
      return areaSum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    if (Math.abs(doubledArea) <= 1e-15) return "Polygon must enclose a non-zero area.";

    const orient = (a: readonly number[], b: readonly number[], c: readonly number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const onSegment = (a: readonly number[], point: readonly number[], b: readonly number[]) => Math.min(a[0], b[0]) <= point[0] && point[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= point[1] && point[1] <= Math.max(a[1], b[1]);
    const intersects = (a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]) => {
      const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
      if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
      return (o1 === 0 && onSegment(a, c, b)) || (o2 === 0 && onSegment(a, d, b)) || (o3 === 0 && onSegment(c, a, d)) || (o4 === 0 && onSegment(c, b, d));
    };
    for (let first = 0; first < vertices.length; first += 1) {
      for (let second = first + 1; second < vertices.length; second += 1) {
        if (second === first + 1 || (first === 0 && second === vertices.length - 1)) continue;
        if (intersects(vertices[first], vertices[(first + 1) % vertices.length], vertices[second], vertices[(second + 1) % vertices.length])) return "Polygon boundary must not self-intersect.";
      }
    }
  }
  return null;
}
