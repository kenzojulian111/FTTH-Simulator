import { describe, expect, it } from "vitest";
import { ESRI_WORLD_BOUNDARIES_LABELS_LAYER, ESRI_WORLD_IMAGERY_LAYER, NORMAL_BASEMAP_LAYER, resolveBasemapConfig } from "./basemap";

describe("basemap configuration resolver", () => {
  it("resolves Normal mode to OpenStreetMap standard tiles", () => {
    const config = resolveBasemapConfig("normal", {});
    expect(config.requestedMode).toBe("normal");
    expect(config.effectiveMode).toBe("normal");
    expect(config.baseLayer).toEqual(NORMAL_BASEMAP_LAYER);
    expect(config.labelOverlayLayer).toBeNull();
    expect(config.setupWarning).toBeNull();
  });

  it("resolves Earth mode by default to Esri World Imagery + Esri World Boundaries and Places labels", () => {
    const config = resolveBasemapConfig("earth", {});
    expect(config.requestedMode).toBe("earth");
    expect(config.effectiveMode).toBe("earth");
    expect(config.providerId).toBe("esri_world_imagery");
    expect(config.baseLayer).toEqual(ESRI_WORLD_IMAGERY_LAYER);
    expect(config.labelOverlayLayer).toEqual(ESRI_WORLD_BOUNDARIES_LABELS_LAYER);
    expect(config.setupWarning).toBeNull();
  });

  it("handles missing Mapbox access token gracefully by falling back to Normal map with a setup warning", () => {
    const config = resolveBasemapConfig("earth", {
      VITE_EARTH_TILE_PROVIDER: "mapbox_satellite",
      VITE_MAPBOX_ACCESS_TOKEN: "",
    });
    expect(config.requestedMode).toBe("earth");
    expect(config.effectiveMode).toBe("normal");
    expect(config.baseLayer).toEqual(NORMAL_BASEMAP_LAYER);
    expect(config.setupWarning).toContain("VITE_MAPBOX_ACCESS_TOKEN");
  });

  it("supports Mapbox Satellite Streets when a token is provided", () => {
    const config = resolveBasemapConfig("earth", {
      VITE_EARTH_TILE_PROVIDER: "mapbox_satellite",
      VITE_MAPBOX_ACCESS_TOKEN: "pk.test_token_123",
    });
    expect(config.effectiveMode).toBe("earth");
    expect(config.baseLayer.url).toContain("mapbox/satellite-streets-v12");
    expect(config.baseLayer.url).toContain("pk.test_token_123");
    expect(config.setupWarning).toBeNull();
  });

  it("handles disabled or missing custom Earth tile URL gracefully", () => {
    const disabled = resolveBasemapConfig("earth", { VITE_EARTH_TILE_PROVIDER: "none" });
    expect(disabled.effectiveMode).toBe("normal");
    expect(disabled.baseLayer).toEqual(NORMAL_BASEMAP_LAYER);
    expect(disabled.setupWarning).toContain("Retaining Normal Map");

    const missingCustom = resolveBasemapConfig("earth", { VITE_EARTH_TILE_PROVIDER: "custom" });
    expect(missingCustom.effectiveMode).toBe("normal");
    expect(missingCustom.setupWarning).toContain("VITE_EARTH_TILE_URL");

    const unresolvedPlaceholder = resolveBasemapConfig("earth", {
      VITE_EARTH_TILE_PROVIDER: "custom",
      VITE_EARTH_TILE_URL: "https://tiles.example.com/{z}/{x}/{y}.jpg?key={apikey}",
    });
    expect(unresolvedPlaceholder.effectiveMode).toBe("normal");
    expect(unresolvedPlaceholder.setupWarning).toContain("placeholder");
  });
});
