# FTTH Simulator API Contract (v1)

Base path: `/api/v1`. JSON uses camelCase field names. IDs are opaque stable strings. Coordinates follow RFC 7946 GeoJSON order `[longitude, latitude]` in WGS 84 decimal degrees. Lengths are metres; optical values are dB/dBm; monetary values pair a numeric amount with an ISO 4217 currency code.

## Resources

The canonical `Project`, `NetworkNode`, `Customer`, `CableSegment`, `TopologyConnection`, and calculation result shapes are defined in [PROJECT_SPEC.md](PROJECT_SPEC.md). The project is the persistence aggregate and includes `settings.opticalBudget`, `settings.constructionCost`, optional `poleSpans`, and optional `opticalComponents`. Server-generated timestamps are RFC 3339 UTC. `lengthM` is nullable until computed; clients must not treat a local map measurement as authoritative. Backend node types include `olt`, `odc`, `odp`, `ont`, `splitter`, `pole`, `router`, and `customer`; subscriber records remain in `customers`. Typed customer router configurations are stored in `properties.routerConfiguration` or `properties.routerConfig` with zero database migrations required.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/projects` | List `{ projects: ProjectSummary[] }` with metadata and device counts |
| `POST` | `/projects` | Create a new project aggregate (server assigns UUID if omitted or empty); returns `201 Created` with canonical `Project` |
| `GET` | `/projects/{projectId}` | Load a complete `Project` |
| `PUT` | `/projects/{projectId}` | Create or replace project editable data at the client-generated stable ID; body is `Project`; returns canonical `Project` |
| `DELETE` | `/projects/{projectId}` | Delete; returns `204` |
| `POST` | `/projects/{projectId}/calculations/optical-budget` | Calculate and return `OpticalBudgetResult` |
| `POST` | `/projects/{projectId}/calculations/construction-cost` | Calculate and return `ConstructionCostResult` (formal RAB report) |
| `POST` | `/projects/{projectId}/calculations/pole-spans` | Calculate explicit pole spans, diagnostics, and configured additional-pole estimates |
| `POST` | `/projects/{projectId}/validate-connection` | Pre-validate candidate connection against GPON topology rules; body is `ConnectionValidationRequest`; returns `TopologyValidationResult` |
| `GET`, `POST` | `/projects/{projectId}/validate-topology` | Validate all connections and topology constraints across the project; returns `TopologyValidationResult` |
| `POST` | `/validate-router-config` | Pre-validate a standalone `RouterConfig` payload; returns `RouterValidationResponse` |
| `POST` | `/projects/{projectId}/nodes/{nodeId}/validate-router` | Validate router configuration for a specific node in a saved project; returns `RouterValidationResponse` |

### `ProjectSummary` Schema
```json
{
  "id": "proj-gpon-alpha",
  "name": "Alpha Fiber Cluster",
  "description": "Active cluster in South Jakarta",
  "currency": "IDR",
  "createdAt": "2026-10-17T11:00:00.000Z",
  "updatedAt": "2026-10-17T11:30:00.000Z",
  "nodeCount": 4,
  "customerCount": 1,
  "cableSegmentCount": 3,
  "connectionCount": 3,
  "deviceCounts": {
    "olt": 1,
    "odc": 1,
    "odp": 1,
    "ont": 1,
    "customer": 1
  }
}
```
Clients generate a UUID before the first save, or call `POST /projects` to let the server assign a stable UUID. `PUT` creates or replaces the resource idempotently. A successful write returns the canonical persisted representation. Clients should use the returned value so server timestamps, validation, and calculated segment lengths stay authoritative.

## Errors

Errors use the common shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Human-readable summary",
    "details": [{ "field": "nodes[0].name", "message": "Must not be empty" }]
  }
}
```

Use standard HTTP status codes: `400` malformed request, `404` missing resource, `409` conflicting/stale update, `422` semantic validation, and `500` unexpected server error. `details` is optional. Clients must show safe, useful messages and retain unsaved edits after failed saves.

## Validation and behavior

- Project IDs and feature IDs remain stable across updates.
- Names must be non-empty after trimming. Coordinates must be finite and within longitude `[-180, 180]`, latitude `[-90, 90]`.
- A cable `LineString` must have at least two coordinates. `fiberCount`, when present, must be a positive integer.
- A topology connection must refer to existing node IDs and an existing cable segment in the same project. Self-links are invalid.
- Optical calculation retains `links` as per-edge diagnostics and adds `paths`, one end-to-end result per ONT. Each path includes its `ontNodeId`, `customerIds`, `nodeIds`, `connectionIds`, `cableSegmentIds`, accumulated `lengthM`, physical attenuation `lossDb` (dB; excludes the design safety reserve), transmit power `txPowerDbm`, physical received power `receivedPowerDbm`, sensitivity `rxSensitivityDbm`, overload limit `rxOverloadDbm`, `sensitivityMarginDb = receivedPowerDbm - rxSensitivityDbm`, `overloadMarginDb = rxOverloadDbm - receivedPowerDbm`, design margin `marginDb = receivedPowerDbm - rxSensitivityDbm - safetyMarginDb`, required `minMarginDb`, `status` (`pass` | `fail` | `unknown`), `statusReason`, per-hop `segments` (with fiber, connector, and splice loss breakdown), traversed `splitters` (with splitter ratio, configured insertion loss `lossDb`, and theoretical ideal split loss `idealLossDb` where a `1:N` ratio is known), and diagnostic `details`. A segment's `lengthM` is the full stored geometry length; `routeLengthContributionM` shows the amount added to this end-to-end path. If a legacy project references the same physical cable ID from multiple consecutive logical connections, its route geometry and fiber attenuation contribute once per path; later segment records remain visible with a zero route contribution. Connection-level connector/splice assumptions remain reported per traversed connection. `details.reusedCableSegmentIds` identifies repeated physical cable references. The ideal split loss is `10 log10(N)` dB and is informational only; it never replaces configured actual insertion loss. Sensitivity and overload margins use physical received power and do not include design reserve; positive values indicate headroom, zero is the respective receiver boundary, and negative values indicate a limit violation. The design budget is `lossDb + safetyMarginDb`; `receivedPowerDbm` remains physical power and does not subtract the reserve. Missing or ambiguous directed OLT paths have status `unknown` and null numeric results with explicit reason (`no_directed_path_from_olt` or `multiple_directed_paths_from_olt`). `disconnectedCustomerIds` lists connected customer records without a complete path.
- Optical configuration retains the legacy numeric defaults and adds `profileId` and `parameterSources`. The default profile is `illustrative_gpon_planning_v1`; its inherited numeric values are planning assumptions, not verified manufacturer specifications. A config object with no optical settings uses that profile. An older serialized config with optical parameter values but no provenance is migrated as `legacy_fallback`: the engine retains its prior numeric calculations, exposes those values and their sources, but returns end-to-end status `unknown` with `statusReason: legacy_fallback_parameters`. To mark supplied values as authoritative project inputs, clients must include `parameterSources` entries with `configured` and supply the corresponding value; supported sources are `configured`, `profile_default`, `legacy_fallback`, and `unknown`. In a config carrying a provenance map, an omitted source/value is treated as unknown; a supplied value without a source is conservatively treated as legacy fallback. Unknown attenuation or component-loss parameters produce null affected losses while preserving route length and other known component results. Unknown transmitter/receiver values produce null dependent power or margin values. Paths expose per-parameter provenance in `parameterSources`, `profileId`, and `details`; path segments expose `fiberType` and `wavelengthNm` alongside the coefficient used.
- Per-link diagnostics count splitter insertion loss at the destination node only, so a splitter shared by adjacent hops is not repeated in both link rows. Per-link `receivedPowerDbm` is null when no transmitter-originated power value is meaningful (including passive-source, non-optical, and invalid-reference links).
- Cost calculation returns formal RAB (Rencana Anggaran Biaya) output: `items`, `totalAmount`/`totalCapex`, `materialSubtotal`, `installationSubtotal`, `grandTotal`, `costPerConnectedCustomer`, `connectedCustomerCount`, and `summary`. Each item in `items` provides `code`, `description`, `quantity`, `unit`, `unitCost`, `amount`, and `category` (`material` | `installation`). Unit rates are configurable planning inputs; defaults are not verified market prices. Unconfigured items (taxes, contingencies, markups) are not fabricated.
- Calculation endpoints return server-owned results; clients do not submit or assert calculated totals.
- `poleSpans` are optional explicit physical relations `{id, cableSegmentId, fromPoleId, toPoleId, geometry?, coversEntireCableRoute, status, notes, lengthM?}`. Pole IDs refer to `NetworkNode(type="pole")`; a missing or nearby pole is never inferred. `lengthM` is recomputed from the explicit span polyline or from cable geometry only when `coversEntireCableRoute` is true. `settings.poleSpanPlanning.rules` may configure a positive `maxSpanM` up to the hard design ceiling of 300 m per `cableCategory`; a missing `placementPolicy` keeps the additional-pole estimate unknown. `POST /calculations/pole-spans` reports pole-span length checks independently from ODP-to-house checks. The latter use the explicit drop cable route when available and a labeled geodesic fallback only when no route length is available. Each ODP result identifies the farthest linked customer/ONT and includes the route and geodesic measurements; `distanceMethod` indicates which measurement drove its 300 m check. The pole estimate is `sum(max(0, ceil(spanLengthM / maxSpanM) - 1))`; endpoint poles are assumed already included.
- `opticalComponents` are optional explicit physical component records attached to a path node or connection. `configuredLossDb/configuredSource` drives physical loss; `datasheetLossDb/datasheetReference/datasheetModel` and `measuredLossDb/measuredAt/measurementMethod/measurementReference` remain separate evidence. Optional `procurementQuantity`, `procurementUnit`, `materialUnitCost`, `installationUnitCost`, `priceSource`, and `priceReference` feed separate component RAB lines. `settings.opticalBudget.projectStandardLossDb` is a path-level comparison target only. Each path reports `standardVarianceDb = lossDb - standardLossDb`, component values, field readings, datasheet references, and location subsets. Missing configured component loss makes total physical loss unknown; it is never replaced by datasheet, measured, or ideal splitter loss.
- RAB line items expose `unitCostSource` (`configured` or `legacy_illustrative`) and optional `unitCostReference`. `settings.constructionCost.rateSources` records each rate as `configured`, `legacy_illustrative`, or `unknown`; `rateReferences` stores an auditable quote/spec reference. Unknown-rate rows are excluded from subtotals and listed in `incompleteItems`. Missing router supply/installation rates remain omitted from the priced total and are listed in `incompleteItems`; `complete` is false when required lines are missing. `assumptions` identifies legacy illustrative rates.
- `PUT` replaces the editable project aggregate atomically. Backend may add an optimistic concurrency token later; clients should preserve unknown safe fields when round-tripping where possible.


## Topology validation and GPON rules

Topology validation is exposed via `POST /projects/{projectId}/validate-connection` (for candidate connection pre-validation in the UI before committing) and `GET`/`POST /projects/{projectId}/validate-topology` (for full-project audits).

### Pre-validation request (`ConnectionValidationRequest`)
```json
{
  "fromNodeId": "olt-1",
  "toNodeId": "odc-1",
  "cableSegmentId": "cable-1",
  "connectionId": "conn-1",
  "project": null
}
```
If `project` is omitted, the persisted project with `projectId` is retrieved from storage. If neither exists, the endpoint returns HTTP `404 Not Found`.

### Validation response (`TopologyValidationResult`)
```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "summary": {
    "fromNodeType": "olt",
    "toNodeType": "odc",
    "allowedTransition": true,
    "createsCycle": false,
    "cableFiberCount": 12,
    "cableFibersUsed": 1
  }
}
```

### GPON and Customer-Premises Allowed Transitions Matrix
| Source Node | Allowed Target Node Types | Notes |
|---|---|---|
| `olt` | `odc`, `odp`, `splitter`, `ont` | Root optical transmitter. Accepts no upstream optical feeds. |
| `odc` | `odc`, `odp`, `splitter`, `ont` | Primary distribution cabinet / first-stage splitters. |
| `odp` | `odp`, `splitter`, `ont` | Secondary distribution closure / second-stage splitters. Reverse flow to ODC rejected. |
| `splitter` | `odc`, `odp`, `splitter`, `ont` | Standalone or cascaded splitter. |
| `ont` | `router` | Terminal customer premise equipment. Supports downstream Ethernet/copper link to a customer router. Downstream optical connections prohibited. Single upstream optical feed only. |
| `router` | None | Customer-premises router (CPE). Cannot feed back into ONT or connect to optical infrastructure. Single incoming WAN feed only. |
| `pole` | None | Civil support infrastructure. Cannot be source or target of optical connections. |
| `customer` | None | Administrative subscriber record. Linked via `ontNodeId`, not cable connections. |

### Diagnostic error codes and UI policy mapping
To seamlessly interoperate with the frontend `ConnectionDialog` and configuration panels, `TopologyIssue` returns both backend diagnostic codes and frontend `policyCode` values:

| Backend Issue Code | `policyCode` | Description |
|---|---|---|
| `pole_not_optical_device` | `incompatible-types` | Attempt to connect fiber to or from a civil pole. |
| `customer_not_optical_node` | `incompatible-types` | Attempt to connect fiber to or from a customer entity. |
| `ont_cannot_have_downstream_connections` | `incompatible-types` | Attempt to connect downstream optical links from an ONT (non-router target). |
| `olt_cannot_have_upstream_feed` | `incompatible-types` | Attempt to feed upstream into an OLT. |
| `passive_node_multiple_inputs` | `incompatible-types` | An ODC, ODP, or splitter has more than one upstream feed, merging branches or OLT sources in the directed GPON tree. |
| `invalid_connection_direction` | `incompatible-types` | Attempt to violate GPON hierarchy (e.g. ODP -> ODC). |
| `ont_multiple_inputs` | `incompatible-types` | Attempt to connect more than one upstream optical feed into an ONT. |
| `router_cannot_feed_ont` | `incompatible-types` | Attempt to connect a router back into an ONT. |
| `router_invalid_upstream_connection` | `incompatible-types` | Attempt to connect a router to optical distribution infrastructure (OLT/ODC/ODP/Splitter). |
| `router_invalid_optical_connection` | `incompatible-types` | Attempt to connect optical infrastructure directly to a router without passing through an ONT. |
| `router_multiple_wan_feeds` | `incompatible-types` | Attempt to connect multiple incoming feeds into a single customer router. |
| `wan_lan_subnet_overlap` | `subnet-overlap` | Static WAN IPv4 subnet and LAN IPv4 subnet overlap. |
| `self_loop` | `same-device` | Source and destination node IDs are identical. |
| `duplicate_connection` | `duplicate-link` | Identical source, destination, and cable segment already connected. |
| `prohibited_cycle` | `prohibited-cycle` | Connection would introduce a circular optical path/loop. |
| `cable_capacity_exceeded` | `capacity-exceeded` | Total connections using cable exceed `fiberCount`. |
| `splitter_capacity_exceeded` | `capacity-exceeded` | Downstream connections exceed splitter ratio or capacity. |
| `device_capacity_exceeded` | `capacity-exceeded` | Downstream connections exceed configured device `maxPorts`/`capacity`. |
| `missing_from_node` / `missing_to_node` / `missing_cable_segment` | `invalid-reference` | Referenced ID does not exist in project. |

### Capacity rule semantics
- Capacities are strictly enforced only when explicitly configured (e.g. `splitterRatio: "1:8"`, `fiberCount: 12`, `maxPorts: 4`).
- When not configured, capacity reports as `"unconfigured"` in the summary and does not block connection creation.
- OLT is the root. Each ODC, ODP, splitter, and ONT supports one upstream optical feed in the directed GPON tree. Separate OLT trees may coexist in a project, but may not converge on the same passive node.

## Geographic Cable Route Geometry and Multi-Vertex Polylines

FTTH fiber routes support multi-vertex geographic paths following roads, civil trenches, and pole lines.

### Cable Geometry Specification
- `geometry`: GeoJSON-compatible `{"type": "LineString", "coordinates": [[lon, lat], ...]}`.
- Coordinates follow RFC 7946 GeoJSON order: `[longitude, latitude]` in WGS 84 decimal degrees.
- Coordinate values must be finite floating-point numbers within physical WGS 84 bounds:
  - Longitude: `[-180.0, 180.0]`
  - Latitude: `[-90.0, 90.0]`
- A valid cable route requires at least 2 vertices (`coordinates.length >= 2`). Single-point or empty coordinates are rejected with HTTP 422.
- Consecutive identical vertices (zero-length segments) are handled safely without division by zero or errors, contributing 0.0 metres to the length.

### Server-Authoritative Cable Length
- Cable segment `lengthM` is authoritative and computed by the backend on create/update:
  $$\text{lengthM} = \sum_{i=0}^{n-2} \text{distance}(P_i, P_{i+1})$$
  using the spherical Haversine formula (Earth radius = 6,378,137 m).
- The full multi-vertex polyline length is used in calculations:
  - **RAB Construction Cost**: Optical fiber supply (`CBL-SUPPLY`) and installation (`CBL-INSTALL`) bill the full polyline distance. Copper patch cords (`medium: "copper"`) are excluded from optical cable pulling.
  - **Optical Power Budget**: Fiber attenuation accumulates across the full polyline route ($A_{\text{fiber}} = \text{length\_km} \times \alpha$).
  - Bent routes obeying street corners and road curves are strictly longer than direct Euclidean chords (triangle inequality), reflecting real-world optical attenuation and civil pulling costs.

### Endpoint Correspondence and Route Validation
When a cable segment defines `startNodeId` and/or `endNodeId`:
- **First Coordinate Correspondence**: `coordinates[0]` must match the geographic position of `startNodeId` within a 50.0-metre tolerance. Mismatches are rejected with code `cable_start_node_mismatch` (`endpoint-mismatch`).
- **Last Coordinate Correspondence**: `coordinates[-1]` must match the geographic position of `endNodeId` within a 50.0-metre tolerance. Mismatches are rejected with code `cable_end_node_mismatch` (`endpoint-mismatch`).
- **Reversed Route Detection**: If `coordinates[0]` matches `endNodeId` and `coordinates[-1]` matches `startNodeId`, the backend rejects with code `cable_coordinates_reversed` (`reverse-geometry`) and guides vertex reordering.
- **Self-Loop Prevention**: A cable segment cannot have identical start and end nodes (`startNodeId == endNodeId`). Rejected with code `cable_self_loop` (`same-device`).
- **Connection Endpoints Matching**: Any `TopologyConnection` utilizing a cable segment must connect nodes that correspond to the cable's `{startNodeId, endNodeId}`. Violations are flagged with code `cable_endpoint_mismatch` (`endpoint-mismatch`).

### Manual Road Waypoint Drawing Baseline
- Intermediate polyline vertices represent explicit manual road waypoints drawn by network designers in the UI map editor.
- The backend imposes no external third-party routing engine or road-snapping network dependencies.
- Geographic vertices in `geometry.coordinates` are strictly decoupled from logical canvas positions (`logicalPosition`, `logicalWaypoints`), ensuring geographic GIS realism and Cisco-style logical canvas clarity operate independently without cross-corruption.

## Router Model and IP Configuration Validation

Customer routers are represented as `NetworkNode` with `type: "router"`. The typed router configuration is stored in `properties.routerConfiguration` or `properties.routerConfig`.

### `RouterConfig` Schema
```json
{
  "hostname": "home-gw",
  "wanMode": "static-ipv4",
  "wanIpv4Address": "203.0.113.10",
  "wanPrefix": 24,
  "defaultGateway": "203.0.113.1",
  "lanIpv4Address": "192.168.1.1",
  "lanPrefix": 24,
  "dhcpServerEnabled": true,
  "dhcpPoolStart": "192.168.1.50",
  "dhcpPoolEnd": "192.168.1.200",
  "dnsServers": ["1.1.1.1", "8.8.8.8"],
  "natEnabled": true,
  "vlanId": 100,
  "pppoeUsername": "user@isp",
  "pppoePassword": "secretpassword"
}
```

### Security Rule
- `pppoePassword` values are strictly masked as `"******"` in string and representation formats, and are never echoed in error envelopes, validation issues, or server logs.

### Validation Rules
1. **WAN Mode**: Must be one of `dhcp-client`, `static-ipv4`, or `pppoe` (also accepts normalized aliases `dhcp` and `static`).
2. **Static WAN Mode**:
   - `wanIpv4Address` must be valid IPv4 syntax.
   - `wanPrefix` must be an integer between 0 and 32.
   - `defaultGateway` must be valid IPv4 and belong to the WAN subnet.
   - `defaultGateway` must not equal `wanIpv4Address`.
3. **LAN Addressing**:
   - `lanIpv4Address` must be valid IPv4 syntax.
   - `lanPrefix` must be an integer between 0 and 32.
   - For prefixes `<= 30`, the LAN IP must not be the subnet network or broadcast address.
4. **Subnet Overlap**:
   - Static WAN subnet and LAN subnet must not overlap.
5. **DHCP Server Pool**:
   - When enabled, `dhcpPoolStart` and `dhcpPoolEnd` must be valid IPv4 addresses.
   - Pool start must be `<= pool end`.
   - Both start and end addresses must reside within the LAN subnet.
   - The router's own `lanIpv4Address` must be outside the DHCP pool range.
   - For prefixes `<= 30`, network and broadcast addresses must be excluded from the pool.
6. **DNS & VLAN**:
   - DNS entries must be valid IPv4 unicast addresses.
   - Optional `vlanId` must be between 1 and 4094 (standard IEEE 802.1Q).

## RAB Construction Cost Calculation Integration

`ConstructionCostConfig` accepts optional configurable router rates:
- `routerUnitCost` (optional; no default rate)
- `routerInstallationCost` (optional; no default rate)

Existing projects that omit these fields remain valid and do not receive router cost items until rates are configured. Any supplied rate is a planning input and is not a verified market price.

When standalone router nodes exist in the project, the BoQ / formal RAB report includes:
- `RTR-SUPPLY`: Customer Premises Router (Wi-Fi 6 / Gigabit CPE) with category `"material"`.
- `RTR-INSTALL`: Router Setup, Wi-Fi Configuration & Customer Handover with category `"installation"`.

### Integrated ONT vs. Standalone Router Behavior
- Routers built into ONTs (`node.properties.integratedRouter: true`) are billed as integrated ONTs under `ONT-SUPPLY` and `ONT-INSTALL`, and summarized under `summary.integratedRouterCount`.
- Dedicated `RTR-SUPPLY` and `RTR-INSTALL` items are generated exclusively for standalone `router` nodes (`summary.routerCount`), preventing double-counting.
- Fiber cable route pulling (`CBL-SUPPLY` and `CBL-INSTALL`) measures only optical fiber cable segments, automatically excluding copper Ethernet patch cords (`medium: "copper"`).

## Optical Budget Engine Isolation

- The GPON optical power budget is strictly optical; calculation paths trace from OLT transceivers and terminate at ONT receivers.
- Customer routers and copper Ethernet links (`ONT -> Router`) are non-optical customer-premises drops and do not contribute to optical attenuation, cable pulling loss, or receiver margin.
- Individual non-optical connections report status `"unknown"` with a diagnostic note in per-link results without affecting the end-to-end optical pass/fail status of the GPON path.

## Frontend adapter

The frontend uses a `ProjectApi` interface with list/create/get/save/delete and calculation operations. The HTTP implementation targets this contract. If no API URL is configured, the development adapter is in-memory and clearly marked; its calculations report unavailable rather than fabricated values. The development adapter is not persistent and must not be used as production storage.
