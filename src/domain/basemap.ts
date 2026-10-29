export type BasemapMode = "normal" | "earth";
export type EarthProviderId = "esri_world_imagery" | "mapbox_satellite" | "custom" | "none";

export interface BasemapTileLayerSpec {
  id: string;
  url: string;
  attribution: string;
  maxZoom?: number;
  subdomains?: string | string[];
  opacity?: number;
  zIndex?: number;
}

export interface BasemapResolution {
  requestedMode: BasemapMode;
  effectiveMode: BasemapMode;
  providerId: string;
  badgeText: string;
  baseLayer: BasemapTileLayerSpec;
  labelOverlayLayer: BasemapTileLayerSpec | null;
  setupWarning: string | null;
}

export interface BasemapEnvConfig {
  VITE_EARTH_TILE_PROVIDER?: string;
  VITE_EARTH_TILE_URL?: string;
  VITE_EARTH_TILE_ATTRIBUTION?: string;
  VITE_EARTH_LABELS_TILE_URL?: string;
  VITE_EARTH_LABELS_ATTRIBUTION?: string;
  VITE_MAPBOX_ACCESS_TOKEN?: string;
  [key: string]: unknown;
}

export const NORMAL_BASEMAP_LAYER: BasemapTileLayerSpec = {
  id: "osm-normal",
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

export const ESRI_WORLD_IMAGERY_LAYER: BasemapTileLayerSpec = {
  id: "esri-world-imagery",
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution:
    "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, USDA FSA, USGS, Aerogrid, IGN, IGP, and the GIS User Community",
  maxZoom: 19,
};

export const ESRI_WORLD_BOUNDARIES_LABELS_LAYER: BasemapTileLayerSpec = {
  id: "esri-world-boundaries-places",
  url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  attribution: "Labels &copy; Esri",
  maxZoom: 19,
  opacity: 0.92,
  zIndex: 2,
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolves the active basemap layer configuration from user mode and environment variables.
 * Never fabricates missing API keys; falls back to Normal OSM with an explicit setup message
 * when an API-key-protected or custom provider is selected without required credentials.
 */
export function resolveBasemapConfig(
  mode: BasemapMode,
  env: BasemapEnvConfig = import.meta.env as BasemapEnvConfig,
): BasemapResolution {
  if (mode === "normal") {
    return {
      requestedMode: "normal",
      effectiveMode: "normal",
      providerId: "osm_standard",
      badgeText: "OSM · WGS 84",
      baseLayer: NORMAL_BASEMAP_LAYER,
      labelOverlayLayer: null,
      setupWarning: null,
    };
  }

  const rawProvider = str(env.VITE_EARTH_TILE_PROVIDER).toLowerCase();
  const customUrl = str(env.VITE_EARTH_TILE_URL);
  const customAttribution =
    str(env.VITE_EARTH_TILE_ATTRIBUTION) || "Satellite imagery &copy; configured provider";
  const customLabelsUrl = str(env.VITE_EARTH_LABELS_TILE_URL);
  const customLabelsAttribution = str(env.VITE_EARTH_LABELS_ATTRIBUTION) || customAttribution;
  const mapboxToken = str(env.VITE_MAPBOX_ACCESS_TOKEN);

  const provider: EarthProviderId =
    rawProvider === "none" || rawProvider === "disabled"
      ? "none"
      : rawProvider === "mapbox" || rawProvider === "mapbox_satellite"
        ? "mapbox_satellite"
        : rawProvider === "custom"
          ? "custom"
          : customUrl && !rawProvider
            ? "custom"
            : "esri_world_imagery";

  if (provider === "none") {
    return {
      requestedMode: "earth",
      effectiveMode: "normal",
      providerId: "none",
      badgeText: "OSM · WGS 84 (Earth unconfigured)",
      baseLayer: NORMAL_BASEMAP_LAYER,
      labelOverlayLayer: null,
      setupWarning:
        "Earth satellite imagery is disabled or unconfigured (VITE_EARTH_TILE_PROVIDER=none). Configure VITE_EARTH_TILE_PROVIDER or VITE_EARTH_TILE_URL to enable satellite view. Retaining Normal Map.",
    };
  }

  if (provider === "mapbox_satellite") {
    if (!mapboxToken) {
      return {
        requestedMode: "earth",
        effectiveMode: "normal",
        providerId: "mapbox_satellite",
        badgeText: "OSM · WGS 84 (Mapbox key missing)",
        baseLayer: NORMAL_BASEMAP_LAYER,
        labelOverlayLayer: null,
        setupWarning:
          "Mapbox Satellite Streets requires VITE_MAPBOX_ACCESS_TOKEN. Add your Mapbox token to the environment or switch VITE_EARTH_TILE_PROVIDER to esri_world_imagery. Retaining Normal Map.",
      };
    }
    return {
      requestedMode: "earth",
      effectiveMode: "earth",
      providerId: "mapbox_satellite",
      badgeText: "EARTH · MAPBOX SATELLITE · WGS 84",
      baseLayer: {
        id: "mapbox-satellite-streets",
        url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}?access_token=${encodeURIComponent(mapboxToken)}`,
        attribution:
          '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 20,
      },
      labelOverlayLayer: null,
      setupWarning: null,
    };
  }

  if (provider === "custom") {
    if (!customUrl) {
      return {
        requestedMode: "earth",
        effectiveMode: "normal",
        providerId: "custom",
        badgeText: "OSM · WGS 84 (Custom URL missing)",
        baseLayer: NORMAL_BASEMAP_LAYER,
        labelOverlayLayer: null,
        setupWarning:
          "Custom Earth imagery provider requires VITE_EARTH_TILE_URL. Configure a valid tile URL template ({z}/{x}/{y}) or use the default Esri World Imagery provider. Retaining Normal Map.",
      };
    }
    if (customUrl.includes("{apikey}") || customUrl.includes("{accessToken}")) {
      return {
        requestedMode: "earth",
        effectiveMode: "normal",
        providerId: "custom",
        badgeText: "OSM · WGS 84 (API key placeholder unresolved)",
        baseLayer: NORMAL_BASEMAP_LAYER,
        labelOverlayLayer: null,
        setupWarning:
          "VITE_EARTH_TILE_URL contains an unresolved API key placeholder ({apikey} or {accessToken}). Supply a configured key in your environment. Retaining Normal Map.",
      };
    }
    return {
      requestedMode: "earth",
      effectiveMode: "earth",
      providerId: "custom",
      badgeText: "EARTH · SATELLITE · WGS 84",
      baseLayer: {
        id: "custom-earth-imagery",
        url: customUrl,
        attribution: customAttribution,
        maxZoom: 19,
      },
      labelOverlayLayer: customLabelsUrl
        ? {
            id: "custom-earth-labels",
            url: customLabelsUrl,
            attribution: customLabelsAttribution,
            maxZoom: 19,
            opacity: 0.92,
            zIndex: 2,
          }
        : null,
      setupWarning: null,
    };
  }

  // Default: Esri World Imagery + Esri World Boundaries and Places hybrid labels
  const labelsLayer: BasemapTileLayerSpec | null =
    customLabelsUrl === "none"
      ? null
      : customLabelsUrl
        ? {
            id: "custom-earth-labels",
            url: customLabelsUrl,
            attribution: customLabelsAttribution,
            maxZoom: 19,
            opacity: 0.92,
            zIndex: 2,
          }
        : ESRI_WORLD_BOUNDARIES_LABELS_LAYER;

  return {
    requestedMode: "earth",
    effectiveMode: "earth",
    providerId: "esri_world_imagery",
    badgeText: "EARTH · ESRI SATELLITE · WGS 84",
    baseLayer: ESRI_WORLD_IMAGERY_LAYER,
    labelOverlayLayer: labelsLayer,
    setupWarning: null,
  };
}
