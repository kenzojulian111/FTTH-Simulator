# Engineering Reliability Sprint Audit

Audit date: 2026-10-22. This document records the current backend behavior and the scope completed in the reliability sprint. It is not a manufacturer or field validation statement.

## Why saved ONTs show `UNKNOWN`

The current SQLite project data reproduced several independent causes:

- A coherent OLT → ODC → splitter → ODP → ONT graph had no splitter ratio or actual insertion loss. The optical engine correctly withheld physical loss and PASS because the splitter is unconfigured.
- Older projects retained numeric optical values but omitted `parameterSources`. Those values remain available for partial calculations, but are marked `legacy_fallback`, so feasibility is UNKNOWN until the user reviews and explicitly sources them.
- Another saved design had no directed OLT-to-ONT path; a geographic line alone is not a graph edge.
- A design routed two OLTs into one downstream splitter. The path engine reported ambiguity, while project-wide topology validation previously failed to report the illegal merge. Candidate and project validation now reject multiple upstream feeds into ODC, ODP, and splitter nodes.
- One saved route reused a single cable segment ID across three consecutive topology links. The path engine previously counted the full stored geometry three times. The route's geometric length and fiber attenuation now contribute once per unique cable ID in an end-to-end path. Per-hop records retain their full geometry length and expose `routeLengthContributionM` separately.

No connection or parameter is repaired automatically. The UI presents backend topology issues and parameter provenance, with links to select the affected device.

## Parameter inventory and provenance

| Parameter | Current illustrative default | Unit | Provenance behavior |
|---|---:|---|---|
| Fiber attenuation | 0.35 | dB/km | `illustrative_gpon_planning_v1`; per-cable override is explicit. Current engine has one selected fiber type/wavelength coefficient, not a complete manufacturer rate table. |
| Fiber type / wavelength | G.652.D / 1310 | type / nm | Profile metadata. These values identify the assumed profile context; attenuation is not dynamically looked up by type and wavelength. |
| Connector interfaces per link | 2 | interfaces | Illustrative profile assumption; cable property override is supported. |
| Connector insertion loss | 0.50 | dB/interface | Illustrative profile assumption; cable property override is supported. |
| Fusion splices per link | 1 | splices | Illustrative profile assumption; cable property override is supported. |
| Fusion splice loss | 0.10 | dB/splice | Illustrative profile assumption; cable property override is supported. |
| Splitter loss table | 1:2 3.5; 1:4 7.2; 1:8 10.5; 1:16 13.8; 1:32 17.1; 1:64 20.5 | dB | Illustrative profile assumptions, not device specifications. A splitter node may provide actual `splitterLossDb`; missing ratio/loss stays unknown. Ideal split loss is informational only. |
| OLT transmit power | 2.5 | dBm | Illustrative profile assumption; `txPowerDbm` node property overrides it. |
| ONT sensitivity / overload | -27 / -8 | dBm | Illustrative profile assumptions; ONT properties may override. |
| Design reserve / minimum margin | 3 / 0 | dB | Illustrative profile assumptions; reserve affects design margin, not physical received power or overload evaluation. |

Projects with no optical config receive the documented illustrative profile. Older configs with numeric values but no provenance preserve those values as `legacy_fallback` and report UNKNOWN feasibility. Explicitly configured or profile-default sources are exposed in each per-ONT result. Unknown component parameters leave their dependent losses null while route length and unrelated component values remain reportable.

## Existing calculation behavior retained

- The optical engine traces directed OLT-to-ONT routes, excludes router Ethernet from fiber paths, accumulates component losses, and reports physical received power, sensitivity headroom, overload headroom, and design margin separately.
- Cable route length is based on the complete stored GeoJSON polyline. Backend persistence recomputes length from every consecutive vertex.
- Splitter loss is counted once per traversed splitter in an end-to-end path. Per-link diagnostics charge a splitter at the destination only.
- Existing RAB cost arithmetic and mapped pole counts remain in place. Configured numeric construction prices are explicitly documented as planning assumptions rather than verified market prices.

## Changes completed in this sprint

- Added one-upstream-feed validation for passive distribution nodes to both candidate and full-project topology validation. Separate OLT trees remain valid if they do not merge.
- Optical path traversal excludes connection edges that full-project topology validation identifies as invalid. Affected ONTs return `unknown` with exact connection IDs and backend issue details rather than a false PASS.
- Repeated references to a physical cable ID contribute its geographic route length and fiber attenuation once per end-to-end path. The report distinguishes full segment geometry length from the path contribution.
- Frontend optical analysis now shows topology/configuration categories, parameter names, units, source, actionable guidance, route length, and valid partial metrics. It calls backend full-project topology validation and links to affected devices where possible.
- Added regression tests for multiple passive inputs, invalid path exclusion, reused cable geometry, and UI diagnostics.

## Remaining engineering gaps

- `warning` is supported by frontend presentation but the backend optical result currently classifies `pass`, `fail`, and `unknown`; a documented configurable warning band is not implemented.
- Fiber attenuation is a scalar selected-profile value, not a matrix keyed by fiber type and wavelength. The current UI must not be read as evidence of equipment-specific attenuation.
- Connector and splice counts are profile-per-link assumptions or cable-property overrides; the model does not represent physical interfaces and splice locations individually.
- Topology capacity uses configured `splitterRatio`, `maxPorts`, or `capacity` counts. Explicit port IDs/assignments and occupied-versus-available port reporting are not modeled.
- Cable category-specific procurement quantities and pole-span estimates are not implemented. Cost currently applies one global cable slack percentage and costs all stored non-copper cable segments, including unconnected cable geometry.
- Construction cost settings contain legacy numeric defaults. There is no source/completeness model for every rate; missing optional router prices omit router rows but do not mark the estimate incomplete. Shared device nodes are counted once, but cost policy for inactive/draft cable assets is not explicit.
- Deterministic design alternative comparison is not implemented.
- No browser was launched in this sprint, so map selection, report readability, and project-level actions still require manual browser verification.

## Frontend integration checklist

- Consume `routeLengthContributionM` on optical segment rows; older backends may omit it, in which case display `lengthM` as the contribution.
- Handle `statusReason: invalid_topology_connection` and show `details.invalidConnections` with affected device selection.
- Add dedicated warning UI only when the backend returns the status; do not infer it from a locally chosen threshold.
- Preserve nullable component values and show unknown/unconfigured inputs without substituting zero.
- Keep profile values labeled illustrative and keep unknown/legacy provenance visible after project reload.

## Optical and pole/span integration checkpoint (2026-10-27)

The new contract is specified in `ENGINEERING_SPEC_OPTICAL_POLE.md` and the
optional aggregate/API fields are documented in `API_CONTRACT.md`.

- `Project.opticalComponents` keeps configured loss, datasheet reference/value,
  and field measurement separate. Per-ONT results expose component rows, path
  standard variance, and location subsets. Unmapped cable/interface/splice
  losses are explicitly rolled up under `unallocated_route`; splitter nodes use
  their ODC/ODP/ONT location class unless an `opticalLocation` is specified.
- `Project.poleSpans` stores explicit cable and endpoint pole IDs. Length comes
  from the span polyline or an explicitly declared whole-cable route. The new
  `/calculations/pole-spans` result reports over-limit/missing-reference and
  unassociated-pole diagnostics. Estimates are unknown without an interval,
  route coverage, and verified endpoint poles.
- SQLite project persistence uses additive JSON columns for these two optional
  arrays. Old tables receive the columns at startup; legacy project payloads
  load with empty lists and no inferred links.
- Existing RAB rates remain legacy illustrative inputs and are labeled as such.
  Missing router rates are surfaced as incomplete lines. Cable items split by
  category and identify included cable IDs/length/slack in calculation summary.

Still not covered by this checkpoint: individual connector/splice physical
locations unless explicitly modeled as `opticalComponents`; field work order
integration; map overlay styling that differentiates a sub-route span from its
parent cable; market-verified construction rates; and live browser verification
of server save/load across both map modes. The in-session browser automation
surface has no WebDriver/Playwright binding, and the sandbox rejected Vite's
localhost bind with `listen EPERM`; interactive server save/load acceptance
could not be run in this session.

## Recovery and 300 m integration verification (2026-10-27)

- `ProjectRepository.save()` assigns both `pole_spans_data` and
  `optical_components_data` on create and update. The API regression now does a
  first PUT, a second PUT to the same project ID with both collections, and a
  GET that verifies the records and settings survive. An old-schema SQLite test
  verifies additive columns/default empty arrays.
- Maximum span rule values are constrained to 300 m. Estimates are unknown if
  placement policy, covered geometry, or verified endpoints are missing. A
  category-specific rule is capped by the configured global limit.
- The separate ODP-to-house check uses a linked route length when available and
  explicit customer-to-ODP geodesic fallback otherwise; outputs include both
  available measurements and `distanceMethod`. Boundary and independent-failure
  regression fixtures cover both checks.
- Verification results: backend 150 passed; frontend 99 passed; Vite production
  build passed; targeted `tsc` check for `RouterConfigurationPanel.test.tsx`
  passed. Starlette emits one httpx integration deprecation warning.
- Browser/server verification remains unavailable in this sandbox: starting
  Vite on `127.0.0.1:5173` failed with `listen EPERM`. This is not evidence of
  browser save/load acceptance.
