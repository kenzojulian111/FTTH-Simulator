# Router Backend Contract Dependency

The current backend contract does not support Router nodes. `NodeType` accepts `olt`, `odc`, `odp`, `ont`, `splitter`, `pole`, and `customer`; an API save containing `type: "router"` is rejected. Its topology validation matrix also has no ONT-to-Router transition, and its construction-cost settings/calculator have no Router rates or rows. The frontend must not treat Router save/load, authoritative link approval, or Router RAB calculation as live until the backend implements this contract.

## Project model

- Add `router` to the backend `NodeType` enum and node schema.
- Preserve Router settings under `NetworkNode.properties.routerConfiguration` with camelCase JSON keys:
  - `hostname: string`
  - `wanMode: "dhcp-client" | "static-ipv4" | "pppoe"`
  - For `static-ipv4`: `wanIpv4Address: string`, `wanPrefix: integer (0..32)`, `defaultGateway: string`
  - `lanIpv4Address: string`, `lanPrefix: integer (0..32)`
  - `dhcpServerEnabled: boolean`, and, when enabled, `dhcpPoolStart`/`dhcpPoolEnd: string`
  - `dnsServers: string[]`, `natEnabled: boolean`, optional `vlanId: integer (1..4094)`
- Round-trip the opaque typed configuration unchanged through project create, save/upsert, get, and load. Validate address and subnet rules server-side too.
- This is configuration only. Do not return or imply DHCP lease, WAN reachability, or PPPoE session state.

## Logical ONT-to-Router connection

The current `TopologyConnection` always requires a `cableSegmentId`, while every accepted connection is treated as an optical link. The backend should add a typed connection discriminator, `connectionType: "fiber" | "ethernet"`, to `TopologyConnection` and connection-validation requests. Preserve the existing fiber behavior and required cable reference for `fiber`; for `ethernet`, define whether a cable reference is optional or refers to an Ethernet segment. The validation contract should approve only the intended directed ONT-to-Router subscriber edge, return stable issue codes for rejected directions/duplicates/references, and keep Router and its LAN nodes out of optical path tracing. The optical budget must continue to end at the ONT.

The UI currently sends proposed edges to `POST /projects/{projectId}/validate-connection`, uses backend approval as the sole topology policy, and blocks on rejection. The endpoint response should identify the connection type in its summary and keep the usual `valid/errors/warnings` shape.

## Construction cost / RAB

- Add optional configurable `routerUnitCost` and `routerInstallationCost` inputs to `ConstructionCostConfig`; do not seed a market price.
- Emit distinct `RTR-SUPPLY` and `RTR-INSTALL` `CostItem` rows only when a configured unit rate is explicitly available. Return quantities, units, categories, totals, and subtotals through the existing construction-cost response.
- Define an explicit rule for integrated ONT/router equipment (for example a `routerIncludedWithOnt` property) so the same hardware is not counted twice. Omit a row when price or quantity is not configured; do not ask the frontend to synthesize one.

Once those changes land, add backend schema, validation, cost, persistence, and optical regression tests before enabling the UI against the live API.
