# FTTH Network Planning Simulator — Project Specification

## Goal and scope

Build a web-based GIS tool for planning a fiber-to-the-home (FTTH) access network. The November 1, 2026 target is a usable planning workflow, with this first milestone establishing the frontend, map editing, typed domain model, and backend boundary.

Included: project editing, OLT/ODC/ODP/pole/customer placement and editing, cable route geometry editing, object inspection, topology links, and API integration points for persistence and engineering calculations.

Excluded from this phase: AI/ML, automatic route optimization, MikroTik integration, and authoritative optical-budget or CAPEX calculations in the browser.

## Canonical domain model

All IDs are stable opaque strings (UUID recommended). Timestamps are RFC 3339 UTC. Coordinates use WGS 84 longitude/latitude in decimal degrees, with the order **longitude, latitude** in serialized GeoJSON. Distances are metres, optical power is dBm, attenuation is dB, and money is represented as a decimal amount plus an ISO 4217 currency code. No implicit unit conversions are permitted.

### Network node

```ts
type NodeType = "olt" | "odc" | "odp" | "ont" | "splitter" | "pole" | "customer";
interface NetworkNode {
  id: string;
  type: NodeType;
  name: string;
  location: { type: "Point"; coordinates: [longitude: number, latitude: number] };
  properties: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
}
```

### Customer

```ts
interface Customer {
  id: string;
  name: string;
  address: string;
  location: { type: "Point"; coordinates: [longitude: number, latitude: number] };
  status: "planned" | "connected" | "on_hold";
  ontNodeId?: string | null;
  properties: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
}
```

### Cable segment and topology

```ts
interface CableSegment {
  id: string;
  name: string;
  cableType: string;
  fiberCount: number | null;
  geometry: { type: "LineString"; coordinates: [longitude: number, latitude: number][] };
  lengthM: number | null; // null until calculated by the server
  startNodeId?: string | null;
  endNodeId?: string | null;
  properties: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
}
interface TopologyConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  cableSegmentId: string;
}
```

Map geometry is independent from topology: moving or drawing a feature changes its geometry; connectivity is expressed only through `TopologyConnection`. A customer is a service endpoint and is not a network node.

### Project and calculation results

```ts
interface OpticalBudgetConfig {
  txPowerDbm: number; fiberAttenuationDbPerKm: number; connectorLossDb: number; connectorsPerLink: number;
  spliceLossDb: number; splicesPerLink: number; safetyMarginDb: number; rxSensitivityDbm: number;
  rxOverloadDbm: number; minMarginDb: number; splitterLossTable: Record<string, number>;
}
interface ConstructionCostConfig {
  currency: string; cableSlackPercent: number; cableUnitCostPerMeter: number; cableInstallationCostPerMeter: number;
  poleUnitCost: number; poleInstallationCost: number; oltUnitCost: number; oltInstallationCost: number;
  odcUnitCost: number; odcInstallationCost: number; odpUnitCost: number; odpInstallationCost: number;
  ontUnitCost: number; ontInstallationCost: number; splitterUnitCost: number; splitterInstallationCost: number;
}
interface Project {
  id: string;
  name: string;
  description: string;
  currency: string; // ISO 4217, e.g. IDR
  nodes: NetworkNode[];
  customers: Customer[];
  cableSegments: CableSegment[];
  connections: TopologyConnection[];
  settings: { opticalBudget: OpticalBudgetConfig; constructionCost: ConstructionCostConfig };
  createdAt: string;
  updatedAt: string;
}
interface OpticalBudgetResult {
  projectId: string;
  calculatedAt: string;
  links: Array<{ connectionId: string; lengthM: number; lossDb: number; receivedPowerDbm: number; status: "pass" | "fail" | "unknown" }>;
  paths: Array<{ ontNodeId: string; customerIds: string[]; nodeIds: string[]; connectionIds: string[]; lengthM: number | null; lossDb: number | null; receivedPowerDbm: number | null; marginDb: number | null; status: "pass" | "fail" | "unknown" }>;
  disconnectedCustomerIds: string[];
}
interface ConstructionCostResult {
  projectId: string;
  calculatedAt: string;
  currency: string;
  totalAmount: number;
  items: Array<{ code: string; description: string; quantity: number; unit: string; unitCost: number; amount: number }>;
  totalCapex: number | null;
  costPerConnectedCustomer: number | null;
  connectedCustomerCount: number | null;
}
```

`OpticalBudgetConfig` and `ConstructionCostConfig` use the backend schema's camelCase fields. Default cost rates are configurable planning assumptions, not verified market quotations.

Calculation results are server-owned and must carry a calculation timestamp. Missing results are shown as unavailable, never replaced by frontend estimates. Customer and result panels may be rendered from saved project/API data.

## User workflow

1. Open or create a project.
2. Place and select network devices, poles, and customers on the map; edit their properties or move/delete them.
3. Draw cable lines with multiple vertices, then edit their vertices and attributes.
4. Create explicit topology connections between network nodes and cable segments.
5. Inspect geometry and available properties. Request backend calculations when supported and review returned optical-budget and construction-cost results.
6. Save and reopen projects through the backend.

## Frontend architecture

- React + TypeScript + Vite; Leaflet + OpenStreetMap tiles with visible attribution.
- Typed domain definitions live outside view components.
- Map geometry editing is handled in map components; topology editing is a separate state/model concern.
- API access is isolated behind a typed client. Development adapters must be clearly identified and replaceable.
- UI components display server results but never calculate authoritative optical budget or CAPEX.
- Invalid geometry, invalid links, and API errors are surfaced with actionable messages; destructive actions require an explicit UI action.

## Acceptance criteria for the initial milestone

- The app loads with the OSM attribution intact.
- Users can create, select, move, rename/edit, and delete each supported feature type.
- Users can draw multi-vertex cables, inspect/edit their geometry and properties, and see length only when it is actually available/calculated.
- Project data follows the canonical model and is sent through the agreed API client.
- No demo calculation is presented as authoritative output.
- Frontend tests cover core model/state/API behavior and relevant interactions.
- Any feature not integrated with a real backend is clearly disclosed.
