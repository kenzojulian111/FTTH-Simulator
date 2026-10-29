# Implementation Plan

## Milestone 1 — Frontend foundation and map editing

- Establish project spec and `/api/v1` contract.
- Scaffold React, TypeScript, Vite, Leaflet, and test tooling.
- Build typed domain/state and replaceable project API adapter.
- Implement OSM map, feature selection, placement, movement, editing/deletion, cable route drawing/editing, and inspector.
- Keep geometry separate from topology and calculations separate from rendering.
- Add focused frontend tests and run available checks.

## Milestone 2 — Backend integration

- Coordinate the contract with Gemini CLI backend owner.
- Configure HTTP API base URL and verify CRUD, error mapping, validation, and server-returned canonical data against FastAPI.
- Resolve contract drift in this document and backend schemas through explicit coordination.

## Milestone 3 — Engineering panels

- Add topology connection editor and validation UX.
- Add optical budget and construction cost panels consuming backend calculation results only.
- Add customer information panel with project customer data.
- Add loading, stale-result, and calculation failure states.

## Milestone 4 — Hardening and delivery

- Exercise realistic project datasets and large-map usability.
- Improve accessibility, keyboard interaction, responsive layouts, and performance.
- Document deployment/configuration and verify release build.

## Current milestone status

- Frontend models/API adapter include backend settings, ONT and splitter nodes, customer-to-ONT association, detailed cost results, and end-to-end optical path results.
- Backend path tracing is supported alongside per-edge diagnostic links. Cost per connected customer correctly evaluates to null when zero customers are connected.
- The Starlette TestClient / AnyIO 4.15.1 worker threadpool hang under Python 3.14.7 was resolved by converting route handlers to native `async def` ASGI coroutines, completely bypassing threadpool offloading.
- In-process ASGI tests were verified using both Starlette `TestClient` and native `httpx.ASGITransport`, covering health, CORS, CRUD, validation, optical budget (link + path), and BoQ cost estimation. Full pytest suite passes (41 passed).

## Optical loss and pole/span integration checkpoint — 2026-10-27

- Added backward-compatible optional `poleSpans` and `opticalComponents` project
  arrays, optional pole-span interval rules, and additive SQLite JSON columns.
- Added separately sourced optical configured/datasheet/measured values,
  project-standard variance, physical component rows, and location subsets
  without substituting ideal splitter loss or including reserve in physical
  loss.
- Added explicit pole-span calculation, routed geometry length, rule
  diagnostics, and estimates only for verified endpoints. The UI can edit pole
  properties, link a cable to poles, set span status and interval rules, and
  open the pole report.
- RAB cable quantities split by category and report cable IDs, physical route
  length, slack, billed length, and legacy illustrative rate sources. Missing
  router rates produce incomplete line records.
- Interactive browser save/load verification remains outstanding. Available
  local Firefox has no WebDriver/Playwright binding in this environment; this
  limitation is recorded in the reliability audit.

## Recovery and 300 m integration checkpoint — 2026-10-27

- Confirmed active project path at `/home/kenzojulian/Projects/project/anjaykanlek`;
  created a restorable source/database backup at
  `/tmp/anjaykanlek-recovery-20261027T115526Z.tar.gz` before changes. The local
  `.git` directory is empty; parent Git has no commit and an existing staged
  snapshot, so no reset/checkout/clean operation was used.
- Added a PUT-update-then-GET regression: a minimal saved project is updated at
  the same ID with pole spans, optical components, and settings, then reloaded.
  Added an additive SQLite migration test for legacy tables without the two
  optional JSON columns. Restored the tracked project database after test runs.
- Enforced the 300 m ceiling on per-category pole rules. A missing placement
  policy now leaves the estimate null; global and category rules use the
  stricter effective interval. Pole-span and ODP-to-house checks remain
  independent. Linked drop routes drive the house check when available;
  geodesic fallback is explicitly identified in results and reports.
- The pole report includes cable category and distance basis, and can select the
  farthest customer/ONT. Cable map category colors and legend were already
  present and are covered by category-color UI regression tests. Removed a
  duplicate test definition and retained separate unknown pole/device and
  router-rate cases.
- Latest checks: backend **150 passed**, frontend **99 passed**, production
  build **passed**, and dedicated TypeScript checking of
  `RouterConfigurationPanel.test.tsx` **passed**. `git diff --check` passed.
- Interactive browser verification remains blocked: Vite cannot bind to
  `127.0.0.1:5173` in this sandbox (`listen EPERM`). No browser save/load claim
  is made.
