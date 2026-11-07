# Final Topology & Splitter Configuration Audit Report

**Project**: `Calc Projek - Physical Route Design 2026-10-31` (`id: test-proj-calc-physical-20261031`)  
**Audit Date**: November 5, 2026  
**Auditor**: Antigravity Optical & Network Systems Engineering  
**Baseline Database**: `ftth_simulator.db` (Verified against safety backup `ftth_simulator.db.bak_20261105_final_audit`)  
**Status**: COMPLETE · AUDIT PASSED

---

## 1. Executive Summary & Verification Boundaries

This audit verifies the topology integrity, device port mappings, and passive splitter configurations of project `Calc Projek - Physical Route Design 2026-10-31`. All evaluations adhere strictly to project safety guidelines:

1. **Safety Isolation**: Modifications and reporting were applied exclusively to `test-proj-calc-physical-20261031`. The reference baseline project `Calc Projek` (`test-proj-calc`) remains 100% unaltered.
2. **Customer Preservation**: All 110 customer records, unique coordinates, connection IDs, and ONT assignments remain strictly preserved.
3. **No Fabricated Parameters**: Missing field measurements are explicitly designated as *Estimated / Desktop Planning* or *Unverified*, and never fabricated.
4. **Authoritative Calculation**: All optical metrics are derived directly from the backend FastAPI optical calculation engine.

---

## 2. Infrastructure Inventory Summary

The active network contains 143 total nodes, 125 cable segments, 126 connections, and 110 connected subscribers:

| Node Type | Database Count | Active in Paths | Role & Configuration |
| :--- | :---: | :---: | :--- |
| **OLT** | 1 | 1 | `OLT 1`: Huawei SmartAX MA5800-X7 (4 PON ports, Tx: +6.00 dBm, 1310 nm) |
| **ODC** | 1 | 1 | `ODC 1`: FiberHome ODC-F288 (16 output ports, serving 14 active ODP branches) |
| **ODP** | 14 | 14 | 14 distribution enclosures terminating 110 drop links to subscribers |
| **Mounted Splitter** | 13 | 13 | 1:8 PLC splitters mounted in ODPs 1–9, 11–14 (10.00 dB configured loss) |
| **Feeder Splitters** | 2 | 2 | 2× 1:8 feeder splitters configured at ODC 1 (10.38 dB table loss) |
| **ODP Integrated Splitter** | 1 | 1 | `ODP 2 [65f3967e · ODP #10]` using node-level 1:8 ratio (10.38 dB table loss) |
| **Legacy Splitter Node** | 1 | 0 | `Splitter 1` (`561494fe`): Disconnected legacy node outside optical paths |
| **ONT** | 110 | 110 | 110 subscriber optical network terminals (all active, 0 disconnected) |
| **Poles** | 2 | 2 | Survey / boundary pole markers |
| **Customers** | 110 | 110 | 110 subscriber accounts mapped 1:1 to ONTs |

---

## 3. Passive Splitter Architecture & Disambiguation

### 3.1 Splitter Count & Path Allocation (16 Active + 1 Legacy Inactive = 17 Total)

The project database contains 17 splitter records. Through rigorous optical path tracing:
- **Feeder Stage (2 Splitters)**: Two 1:8 splitters inside ODC 1 split the two incoming feeder feeds from OLT 1 (PON 1 and PON 2) to serve 7 ODPs per branch.
- **Distribution Stage (14 Splitters)**:
  - **13 Mounted Splitters**: Devices named `ODP X Splitter [proposed]` are hosted within ODP 1 through ODP 9 and ODP 11 through ODP 14. Their insertion loss is explicitly configured at `10.00 dB`.
  - **1 Integrated Splitter**: The 10th ODP enclosure in the database (`ODP 2 [65f3967e · ODP #10]`) has its 1:8 splitter integrated into its node properties rather than as a separate mounted child node. Its insertion loss is evaluated by the backend optical engine as `10.38 dB` (per standard 1:8 PLC loss table).
  - **1 Legacy Disconnected Splitter**: `Splitter 1` (`561494fe-bb1c-4389-9a74-d4cbfad135b5`) is an unlinked, legacy record from early topology sketching. It has 0 input and 0 output connections and is not traversed by any of the 110 subscriber paths.

### 3.2 ODP 2 Naming Ambiguity Resolution

Two physical enclosures share the display name `"ODP 2"`. To prevent confusion during field operations and audit verification, they are disambiguated as follows:

| Disambiguated Name | Node UUID | DB Index | Upstream Feeder | Hosted Splitter | Loss | Output Ports |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`ODP 2 [4c58feef]`** | `4c58feef-3ebd-468d-9b9c-e8c7ac7619c5` | 2 | OLT 1 PON 1 → ODC 1 | Mounted `75ed4232` | 10.00 dB | 8 / 8 (0 free) |
| **`ODP 2 [65f3967e · ODP #10]`** | `65f3967e-61be-4800-bf65-7092f711ebba` | 10 | OLT 1 PON 1 → ODC 1 | Integrated on node | 10.38 dB | 8 / 8 (0 free) |

---

## 4. Complete Device Port & Utilization Schedule

| Device / Enclosure | Role | Feeder / Dist Cable | Input Port | Splitter Ratio | Port Capacity | Ports Used | Ports Free | Connected ONTs |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **OLT 1** | Central Office | Feeder 01 / Cable 6 | Uplink | N/A | 4 PON | 2 PON | 2 PON | 110 |
| **ODC 1** | Distribution Cabinet | Feeder Cable 6 | IN 1, IN 2 | 2× (1:8) | 16 Out | 14 Out | 2 Out | 110 |
| **ODP 1** | Access Point | Cable 3 | IN 1 | 1:8 | 8 Out | 6 Out | 2 Out | 6 |
| **ODP 2 [4c58feef]** | Access Point | Proposed dist to ODP 2 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 3** | Access Point | Proposed dist to ODP 3 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 4** | Access Point | Proposed dist to ODP 4 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 5** | Access Point | Proposed dist to ODP 5 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 6** | Access Point | Proposed dist to ODP 6 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 7** | Access Point | Proposed dist to ODP 7 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 8** | Access Point | Proposed dist to ODP 8 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 9** | Access Point | Proposed dist to ODP 9 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 2 [65f3967e · ODP #10]** | Access Point | Proposed dist to ODP 10 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 11** | Access Point | Proposed dist to ODP 11 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 12** | Access Point | Proposed dist to ODP 12 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 13** | Access Point | Proposed dist to ODP 13 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **ODP 14** | Access Point | Proposed dist to ODP 14 | IN 1 | 1:8 | 8 Out | 8 Out | 0 Out | 8 |
| **Splitter 1** | Legacy Node | None (Disconnected) | None | Legacy | 0 Out | 0 Out | 0 Out | 0 |

---

## 5. Audit Conclusions

1. **Topology Hierarchy**: The active network establishes a strict, validated two-tier GPON tree architecture: `OLT 1 → ODC 1 → 14 ODPs → 110 ONTs`.
2. **Zero Stranded Customers**: All 110 customer records terminate at active ONTs with deterministic optical link budget results.
3. **Port Integrity**: Total ODP capacity is 112 ports (14 enclosures × 8 ports). With 110 subscribers connected, ODP utilization is 98.2% (2 spare ports remain at ODP 1).
4. **Data Cleanliness**: The presence of the disconnected `Splitter 1` node has been thoroughly audited and isolated as an inactive legacy artifact that does not impact active subscriber services.
