import type { Coordinate, FeatureRef, Project } from "./types";
import { ILLUSTRATIVE_OPTICAL_CONFIG } from "./opticalProfiles";

export function createEmptyProject(name = "Untitled FTTH project"): Project {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), name, description: "", currency: "IDR", nodes: [], customers: [], cableSegments: [], connections: [], poleSpans: [], opticalComponents: [],
    settings: {
      opticalBudget: { ...ILLUSTRATIVE_OPTICAL_CONFIG, splitterLossTable: { ...ILLUSTRATIVE_OPTICAL_CONFIG.splitterLossTable }, parameterSources: { ...ILLUSTRATIVE_OPTICAL_CONFIG.parameterSources } },
      constructionCost: { currency: "IDR", cableSlackPercent: 10, cableUnitCostPerMeter: 5000, cableInstallationCostPerMeter: 7500, poleUnitCost: 850000, poleInstallationCost: 350000, oltUnitCost: 25000000, oltInstallationCost: 3000000, odcUnitCost: 4500000, odcInstallationCost: 1200000, odpUnitCost: 350000, odpInstallationCost: 150000, ontUnitCost: 250000, ontInstallationCost: 100000, splitterUnitCost: 120000, splitterInstallationCost: 50000 },
      poleSpanPlanning: { rules: [] },
    },
    createdAt: now, updatedAt: now,
  };
}

export function findFeature(project: Project, ref: FeatureRef) {
  if (ref.kind === "node") return project.nodes.find((item) => item.id === ref.id);
  if (ref.kind === "customer") return project.customers.find((item) => item.id === ref.id);
  if (ref.kind === "area") return project.areas?.find((item) => item.id === ref.id);
  return project.cableSegments.find((item) => item.id === ref.id);
}

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const [lon1, lat1] = a; const [lon2, lat2] = b;
  if (lon1 === lon2 && lat1 === lat2) return 0;
  const dLat = rad(lat2 - lat1); const dLon = rad(lon2 - lon1);
  const rawH = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  const h = Math.min(1, Math.max(0, rawH));
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function approximateLengthMeters(coordinates: Coordinate[]): number {
  return coordinates.slice(1).reduce((total, point, index) => total + distanceMeters(coordinates[index], point), 0);
}

const VERTEX_MATCH_TOLERANCE_M = 1.0;

function isGeographicallyPlaced(node: { properties?: Record<string, unknown> } | undefined): boolean {
  if (!node) return false;
  return node.properties?.geographicPositionSet !== false;
}

export function findMatchingCableVertexIndex(
  coordinates: Coordinate[],
  pole: { type?: string; location: { coordinates: Coordinate }; properties?: Record<string, unknown> } | undefined,
  toleranceM = VERTEX_MATCH_TOLERANCE_M,
): number | null {
  if (!pole || pole.type !== "pole" || !isGeographicallyPlaced(pole) || coordinates.length === 0) return null;
  let bestIdx: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coordinates.length; i += 1) {
    const dist = distanceMeters(coordinates[i], pole.location.coordinates);
    if (dist <= toleranceM && dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function extractSubspanCoordinates(
  cableCoordinates: Coordinate[],
  fromPole: { type?: string; location: { coordinates: Coordinate }; properties?: Record<string, unknown> } | undefined,
  toPole: { type?: string; location: { coordinates: Coordinate }; properties?: Record<string, unknown> } | undefined,
  toleranceM = VERTEX_MATCH_TOLERANCE_M,
): Coordinate[] | null {
  if (cableCoordinates.length < 2) return null;
  const startIdx = findMatchingCableVertexIndex(cableCoordinates, fromPole, toleranceM);
  const endIdx = findMatchingCableVertexIndex(cableCoordinates, toPole, toleranceM);
  if (startIdx === null || endIdx === null || startIdx === endIdx) return null;
  if (startIdx < endIdx) {
    return cableCoordinates.slice(startIdx, endIdx + 1);
  }
  return cableCoordinates.slice(endIdx, startIdx + 1).reverse();
}
