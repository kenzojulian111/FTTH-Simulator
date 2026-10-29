/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_EARTH_TILE_PROVIDER?: string;
  readonly VITE_EARTH_TILE_URL?: string;
  readonly VITE_EARTH_TILE_ATTRIBUTION?: string;
  readonly VITE_EARTH_LABELS_TILE_URL?: string;
  readonly VITE_EARTH_LABELS_ATTRIBUTION?: string;
  readonly VITE_MAPBOX_ACCESS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
