# Topology validation integration

The Create Connection dialog uses the backend-owned `POST /api/v1/projects/{projectId}/validate-connection` endpoint before allowing a proposed link. It sends the current stable `project.id` in the URL and camelCase `fromNodeId`, `toNodeId`, `cableSegmentId`, and the full current `project` in the request body. Including `project` lets validation cover unsaved editor changes; it does not persist the draft.

The backend's `{ valid, errors, warnings, summary }` response is authoritative. Candidate destinations are pre-validated with the same endpoint and rejected options are disabled with their backend issue messages. Connect remains disabled while validation is pending, after an endpoint/network error, or when `valid` is false. Error `policyCode` is shown when available, with the backend diagnostic `code` as a fallback. Warnings are shown while a valid proposal remains connectable.

The current backend contract enforces the GPON transition matrix, pole/customer exclusions, ONT and OLT direction rules, one upstream ONT feed, exact duplicate detection, directed cycle detection, and configured cable/device/splitter capacities. The frontend does not duplicate these rules locally. The reducer retains basic project-reference and duplicate guards as a last line of defense.

The current `TopologyConnection` schema has no connection-type field; the dialog says so and does not add a client-only field. In-memory API mode cannot apply authoritative FTTH policy and therefore rejects validation requests rather than permitting local-only connections. Project editing and memory-mode save/load remain available.
