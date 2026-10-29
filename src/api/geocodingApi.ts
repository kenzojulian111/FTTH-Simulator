export interface GeocodingResult {
  id: string;
  displayName: string;
  address: string;
  coordinate: [longitude: number, latitude: number];
  category: string;
}

export function validatePlaceQuery(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.length < 3) return "Enter at least 3 characters to search.";
  if (trimmed.length > 200) return "Search text must be 200 characters or fewer.";
  return null;
}

export function isValidGeographicCoordinate(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [longitude, latitude] = value;
  return typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
}

export function parsePlaceResults(value: unknown): GeocodingResult[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { results?: unknown }).results)) {
    throw new Error("The place search service returned an invalid response.");
  }
  return (value as { results: unknown[] }).results.flatMap((item): GeocodingResult[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.displayName !== "string" || !isValidGeographicCoordinate(row.coordinate)) return [];
    return [{ id: row.id, displayName: row.displayName, address: typeof row.address === "string" ? row.address : "", coordinate: row.coordinate, category: typeof row.category === "string" ? row.category : "place" }];
  });
}

const configuredBase = import.meta.env.VITE_API_BASE_URL;
const API_BASE = (typeof configuredBase === "string" && configuredBase.trim() ? configuredBase : "/api/v1").replace(/\/+$/, "");

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeocodingResult[]> {
  const validation = validatePlaceQuery(query);
  if (validation) throw new Error(validation);
  const response = await fetch(`${API_BASE}/geocoding/search?q=${encodeURIComponent(query.trim())}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    let message = response.status === 429 ? "The place search provider is busy. Wait a moment and try again." : "Place search failed. Check your connection and retry.";
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
    } catch { /* response did not include JSON */ }
    throw new Error(message);
  }
  return parsePlaceResults(await response.json());
}
