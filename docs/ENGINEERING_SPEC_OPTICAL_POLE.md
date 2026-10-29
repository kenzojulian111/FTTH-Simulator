# Optical Loss and Pole/Span Engineering Specification

Status: approved integration specification, 2026-10-27. This extends the existing
`API_CONTRACT.md` and preserves the current project aggregate and calculation
endpoints. It does not declare illustrative planning inputs to be manufacturer
specifications.

## Integration principles

- `Project` remains the persistence aggregate. All additions are optional so
  projects saved before this specification continue to load.
- A `pole` remains physical infrastructure and is never a topology connection
  or optical device by implication. Existing `NetworkNode` pole IDs are stable.
- Missing engineering data serializes as `null`/unknown. No missing physical
  loss, height, material, route, span relation, or price is represented by zero.
- Calculation outputs identify the source inputs and the exact object IDs used.
- An edit to a relevant project input invalidates the corresponding report.

## Optical loss model

For each independently traced directed OLT–ONT path, calculate physical losses
as the sum of unique cable-route contributions, interface losses, splice losses,
actual splitter insertion losses, and any explicitly configured additional
optical components. A component has a stable ID, kind, optional location, nullable
loss in dB, and provenance. Each physical component ID contributes at most once
within one path. A shared upstream component appears once in each subscriber's
own path result.

The engine preserves four distinct records:

1. **Project/operator standard**: comparison target and scope, never an input to
   physical attenuation. A scoped path standard variance is
   `configuredPhysicalLossDb - standardLossDb`; positive means the path exceeds
   the target.
2. **Datasheet specification**: documented device/model reference and its
   specified value/range. It is provenance, not a configured value unless the
   user separately selects/configures it.
3. **Configured calculation input**: the value used by the engine. Existing
   `parameterSources` remains authoritative for legacy optical settings.
4. **Field measurement**: observed result, timestamp, method, and optional
   instrument/operator reference. It never silently overwrites configured loss.

Fiber loss is `routeLengthM / 1000 * attenuationDbPerKm`. Interface loss is
`interfaceCount * insertionLossDbPerInterface`; splice loss is
`spliceCount * insertionLossDbPerSplice`. Splitter physical loss is its actual
configured insertion loss. `10 * log10(N)` for a 1:N splitter is an informational
ideal split reference only. Safety reserve remains outside physical loss and
physical received power. The design margin is
`txPowerDbm - physicalLossDb - sensitivityDbm - reserveDb`.

Category totals are the sum of component records. Location totals (for example
ODC, ODP, and customer premises) are subsets of those same records and must not
be added to category totals. If a required component value or an unambiguous
OLT path is missing, dependent totals and status remain unknown; no PASS may be
returned. Unaffected known components remain visible with node, cable,
connection, provenance, and a diagnostic reason.

Independent illustrative fixture (not equipment guidance): 2.0 km at
0.35 dB/km = 0.70 dB fiber; 2 interfaces at 0.50 dB = 1.00 dB; 3 splices at
0.10 dB = 0.30 dB; configured splitter insertion loss 10.80 dB; additional
component 0.20 dB. Physical total = 13.00 dB. Theoretical 1:8 split is 9.03 dB
and does not replace 10.80 dB. Against a 15.00 dB project standard, variance is
-2.00 dB. Reserve is excluded from both physical values.

## Pole and span model

- Poles are `NetworkNode(type="pole")` with optional label, pole type, material,
  height, lifecycle status (`existing`, `proposed`, `shared`, `unverified`), and
  notes. Unknown specifications remain absent/null and are not inferred.
- Cable-to-pole relationships are explicit persisted records. A span identifies
  its cable, start pole, end pole, optional route subsection geometry/coverage,
  and an optional verified lifecycle state. Proximity may produce a diagnostic
  hint but never creates a relationship.
- Span length is measured along its stored route geometry. A straight chord
  between pole coordinates is not an acceptable substitute. A whole cable
  polyline may serve as span geometry only when the record explicitly declares
  that it covers that entire cable route. Every report displays the exact length
  and geometry source used.
- Project rules may set maximum span/interval by cable category or project rule,
  up to a hard design ceiling of 300 m, and a placement policy. A rule without a
  placement policy cannot produce a numeric estimate. No additional-pole estimate is returned without a
  configured rule, covered route length, and confirmed endpoint pole coverage.
  With endpoint poles confirmed, additional poles are
  `max(0, ceil(routeCoverageM / maxSpanM) - 1)`; report method and assumptions.
- The ODP-to-farthest-house check is independent from pole-span checks. It uses a
  linked drop route length when present; otherwise an explicitly associated
  customer may use a geodesic fallback, which is identified in the result.
- Diagnostics cover invalid coordinates, missing pole/cable references,
  unassociated poles, over-limit spans, and incomplete estimation inputs.
- Project save/load and the API round-trip optional records. Legacy projects
  lacking them load with no inferred relationships or estimates.

## RAB integration contract

- Cable supply and installation are separate items with category, auditable
  measured length, configured slack/allowance, billed quantity, unit, rate,
  rate source, and subtotal. Shared cable assets are counted once.
- Each pole asset is counted at most once. Existing/proposed/shared/unverified
  cost policies are explicit. No status is implicitly treated as a new pole.
- Missing rates are incomplete items, not zero-valued validated prices. Router
  costs appear only when configured. Material supply and installation remain
  separate line items.
- Explicit optical connector/splice/component procurement records may carry
  quantity, unit, separate material/installation rates, rate provenance, and a
  quote reference. Unknown quantity or price creates an incomplete item.
- Result includes item completeness, source, assumptions, subtotal, and overall
  completeness. Existing rates without source metadata remain labeled legacy or
  illustrative and must not appear verified.

## Lecture Reference Profile & Physical Limits (2026-10-27)

- **Lecture Reference Profile (`lecture_material_gpon_v1`)**:
  - Feeder/distribution fiber attenuation: `0.35 dB/km`
  - Drop fiber attenuation (`dropFiberAttenuationDbPerKm`): `0.35 dB/km`
  - Splitter insertion loss table: `1:4 = 7.25 dB`, `1:8 = 10.38 dB`, `1:16 = 15.0 dB`, `1:32 = 18.6 dB`, `1:64 = 22.8 dB`
  - SC/UPC connector loss (`connectorLossDb`): `0.25 dB`
  - Fiber splicer route (`spliceLossDb`): `0.10 dB` per defined event
  - Fiber pigtail splice (`pigtailSpliceLossDb`): `0.10 dB` per defined event
  - Provenance note: Values originate from user lecture material ("materi kuliah"), not a verified universal standard, and remain fully editable.
- **Explicit Cable Categories & Map Legend**:
  - Categories: `feeder`, `distribution`, `drop`, `indoor`, `custom` stored in `properties.cableCategory` and `cableType`.
  - Map colors distinguish categories visually with a legend while never affecting calculations.
- **300 m Span & ODP-to-Farthest-House Validation**:
  - Maximum pole span limit: `300 m` (`defaultMaxSpanM = 300.0`, diagnostic `span_exceeds_300m_limit`).
  - Maximum ODP-to-farthest-house distance: `300 m` (`maxOdpToHouseDistanceM = 300.0`, reported in `odpHouseDistances` and diagnostic `odp_to_house_exceeds_300m`).

## Checkpoints and acceptance

1. Baseline and backup completed before source edits.
2. API/model additions round-trip old and new project payloads.
3. Optical component/provenance implementation passes independent fixtures and
   proves no double-counting, including shared upstream paths.
4. Pole/span CRUD, route geometry, rules, diagnostics, and estimates pass
   backend tests and can be selected/inspected on the map.
5. RAB quantity/rate completeness and shared-asset policy pass fixed arithmetic
   fixtures.
6. Frontend tests/build and an actual browser save/load walkthrough cover both
   topology and geographic views.

Baseline in this workspace on 2026-10-27: backend 131 passed, frontend 87
passed, production build passed. Browser verification had not yet been run.
