# Final Engineering Consistency Check Report

**Project Target:** `Calc Projek - Physical Route Design 2026-10-31` (`test-proj-calc-physical-20261031`)  
**Baseline Snapshot:** `Calc Projek - Physical Route Pre-Optimization Backup 2026-11-05` (`test-proj-calc-physical-backup-20261105`)  
**Audit Scope:** Optical Loss Precision Reconciliation, Splitter Inventory & Mapping Audit, Endpoint Alignment Classification  
**Date:** 2026-11-05  
**Auditor:** Independent FTTH Infrastructure & Optical Systems Audit Team  
**Audit Standard:** Strict Mathematical, Physical, and Database Reconciliation  

---

## Executive Summary

This report delivers the final engineering consistency check following the post-optimization engineering audit of project `Calc Projek - Physical Route Design 2026-10-31`. In accordance with strict engineering audit protocols, **no geometry, topology, customer records, database state, or optical parameters were modified** during this verification.

The investigation addressed three specific technical areas requiring deeper mathematical and architectural reconciliation:
1. **Optical Loss Precision Reconciliation:** The observed difference between theoretical path loss reduction (\(0.05599\text{ dB}\)) and the reported optical calculation engine average (\(0.0574\text{ dB}\)) was investigated at full machine precision. The root cause is confirmed to be discrete two-decimal rounding per cable segment in the optical engine (`round(length_km * attenuation_rate, 2)`), producing a minor cumulative quantization variance of \(+0.001374\text{ dB}\) across the three-segment paths.
2. **Splitter Inventory & Mapping Reconciliation:** All 16 splitter nodes in the database were audited and mapped against the 14 ODP cabinets and 1 ODC cabinet. Thirteen (13) ODP cabinets utilize dedicated mounted child splitter nodes (`NodeType.SPLITTER`), one (1) ODP cabinet (`ODP 2` `65f3967e`) integrates its 1:8 splitter directly via node properties, and two (2) 1:8 splitters are mounted inside `ODC 1` (serving PON 1 and PON 2). Exactly one (1) unmounted legacy splitter exists from the initial project template and is confirmed disconnected. Splitter insertion loss is verified to be charged exactly once per stage in all optical paths without double counting.
3. **Endpoint Alignment Classification:** All 125 cable geometries were audited across their start and end vertices without relying exclusively on the global 50-meter GIS snapping tolerance. Of 125 physical cables, 14 exhibit exact node alignment (\(<2.0\text{ m}\)), 105 exhibit acceptable building setback distances (\(2.0\text{ m} - 15.0\text{ m}\)), and 6 drop cables exhibit setback distances between \(15.0\text{ m}\) and \(27.57\text{ m}\) (max: Customer 92 at \(27.57\text{ m}\)). Zero cables exceed the 50-meter limit. The 6 extended setback cables reflect actual property boundaries and are classified as requiring field survey review prior to aerial drop wire stringing.

### Summary of Audit Status Determinations

| Inspection Track | Assigned Status | Core Engineering Finding |
|---|---|---|
| **1. Optical Loss Precision Reconciliation** | **PASS** | Attenuation coefficient verified identical (\(0.35\text{ dB/km}\)) across all segments. Discrepancy of \(+0.001374\text{ dB}\) mathematically verified as segment-level rounding quantization in `optical.py`. |
| **2. Splitter Inventory & Mapping Reconciliation** | **PASS WITH LIMITATIONS** | All 14 ODPs are actively split 1:8 with 110 subscribers served. 13 ODPs use child nodes, 1 ODP uses node-level configuration, 1 legacy template splitter remains disconnected. Single-stage loss charging verified. |
| **3. Endpoint Alignment Classification** | **PASS WITH LIMITATIONS** | Zero cables exceed 50m. 119 cables (\(95.20\%\)) are within acceptable setback (\(\le 15.0\text{ m}\)). 6 drop cables (\(4.80\%\), 15–28m) require physical field survey to confirm drop span feasibility. |
| **Overall Consistency Audit** | **PASS WITH LIMITATIONS** | Complete mathematical and logical database consistency achieved. Physical route geometries remain classified as unverified map candidates pending field survey. |

---

## 1. Optical Loss Precision Reconciliation

### 1.1 The Investigation Problem Statement

During the post-optimization audit, the following metrics were compared:
* **Average subscriber optical path length reduction:** \(159.9718\text{ m}\)
* **Standard fiber attenuation coefficient:** \(0.35\text{ dB/km}\) (\(0.00035\text{ dB/m}\))
* **Expected average fiber loss reduction (theoretical unrounded):**  
  \[
  \Delta \alpha_{\text{expected}} = 159.9718\text{ m} \times 0.00035\text{ dB/m} = 0.055990\text{ dB}
  \]
* **Reported average loss reduction from optical calculation engine:** \(0.057364\text{ dB}\) (\(\approx 0.0574\text{ dB}\))
* **Apparent Discrepancy:** \(0.057364\text{ dB} - 0.055990\text{ dB} = +0.001374\text{ dB}\) (\(+1.37\text{ mB}\))

### 1.2 Verification of Attenuation Coefficients

To eliminate the hypothesis that different cable types (feeder, distribution, drop) possessed varying attenuation rates:
1. Every cable segment in `cable_segments_data` for project `test-proj-calc-physical-20261031` was inspected.
2. The property `attenuationRateDbPerKm` was queried across all 125 cable entities.
3. Every path segment evaluated in `backend/app/engine/optical.py` was inspected for its active `attenuation_db_per_km`.

**Result:**  
All feeder cables, distribution cables, and drop cables utilize an attenuation coefficient of exactly **\(0.3500\text{ dB/km}\)**, corresponding to standard single-mode fiber (ITU-T G.652.D / G.657.A1) at 1310 nm / 1490 nm wavelengths. No custom or disparate attenuation rates exist in the database.

### 1.3 Mathematical Root Cause: Discrete Segment Quantization

In the optical calculation engine (`backend/app/engine/optical.py`, lines 1419–1425):
```python
fiber_loss = (
    round(length_km * attenuation_rate, 2)
    if length_km is not None and attenuation_rate is not None
    else None
)
```
Each optical path from the OLT to an ONT traverses three distinct physical segments:
1. **Feeder Segment:** OLT \(\rightarrow\) ODC 1
2. **Distribution Segment:** ODC 1 \(\rightarrow\) ODP \(k\)
3. **Drop Segment:** ODP \(k\) \(\rightarrow\) ONT \(j\)

The optical calculation engine computes the fiber loss on **each individual segment independently**, rounding that segment's attenuation to **two decimal places** (\(0.01\text{ dB}\)). The total path loss is then computed as the sum of these rounded segment losses:
\[
A_{\text{path}} = \text{round}\left(\sum_{s=1}^{3} \text{round}\left(L_s \times 0.00035, 2\right) + \sum L_{\text{splitter}} + \sum L_{\text{splice}} + \sum L_{\text{conn}}, 2\right)
\]

When comparing pre-optimization path losses against post-optimization path losses, the difference evaluated for each ONT is:
\[
\Delta A_{\text{ONT}} = A_{\text{path, baseline}} - A_{\text{path, opt}}
\]
Because each segment loss was individually rounded to the nearest \(0.01\text{ dB}\), the subtraction inherits quantization steps:
* In floating-point math without intermediate rounding, the sum of all 110 subscriber path reductions is:
  \[
  \sum_{i=1}^{110} \Delta A_{\text{unrounded}, i} = 6.158915\text{ dB} \implies \text{Mean} = 0.055990\text{ dB}
  \]
* In the calculation engine with segment rounding, the sum of all 110 subscriber path reductions is:
  \[
  \sum_{i=1}^{110} \Delta A_{\text{engine}, i} = 6.310000\text{ dB} \implies \text{Mean} = 0.057364\text{ dB}
  \]
* Total accumulated quantization difference across 110 ONTs = \(+0.151085\text{ dB}\), yielding an average discrepancy of exactly **\(+0.001374\text{ dB}\)**.

### 1.4 Precision Reconciliation Summary Table

| Metric | Full-Precision Unrounded Math | Active Engine Implementation | Variance (\(\Delta\)) | Engineering Interpretation |
|---|---|---|---|---|
| **Average Path Length Reduction** | \(159.9718\text{ m}\) | \(159.9718\text{ m}\) | \(0.0000\text{ m}\) | Exact physical length match |
| **Fiber Attenuation Rate** | \(0.350000\text{ dB/km}\) | \(0.350000\text{ dB/km}\) | \(0.000000\text{ dB/km}\) | Exact coefficient match |
| **Theoretical Fiber Loss Reduction** | \(0.055990\text{ dB}\) | — | — | Pure continuous calculus |
| **Engine Sum-of-Segments Loss Reduction** | — | \(0.057364\text{ dB}\) | \(+0.001374\text{ dB}\) | Segment 2-decimal quantization |
| **Total Path Loss Reduction Reported** | — | \(0.0574\text{ dB}\) | \(+0.0014\text{ dB}\) | Display rounded (4 decimals) |
| **Total Network Path Delta (110 ONTs)** | \(6.1589\text{ dB}\) | \(6.3100\text{ dB}\) | \(+0.1511\text{ dB}\) | \(+1.37\text{ mB}\) average bias |

### 1.5 Per-ONT Loss Reduction Distribution

The quantization effects group the 110 subscriber loss reductions into discrete values:

| Loss Reduction Category | Number of ONTs | Percentage | Explanation |
|---|---|---|---|
| **\(+0.0000\text{ dB}\)** | 36 ONTs | 32.73% | Zero path length change (ODP 1, 2, 3, 4 subscribers whose distribution routes were already optimal) |
| **\(+0.0500\text{ dB}\)** | 1 ONT | 0.91% | Net path reduction \(\approx 150.3\text{ m}\), rounding boundary |
| **\(+0.0600\text{ dB}\)** | 1 ONT | 0.91% | Net path reduction \(\approx 173.8\text{ m}\), rounding boundary |
| **\(+0.0700\text{ dB}\)** | 37 ONTs | 33.64% | Standard distribution route optimization (\(\approx 200 - 220\text{ m}\) reduction) |
| **\(+0.0800\text{ dB}\)** | 18 ONTs | 16.36% | Distribution + drop optimization (\(\approx 220 - 250\text{ m}\) reduction) |
| **\(+0.0900\text{ dB}\)** | 1 ONT | 0.91% | Customer 92 on ODP 2 (drop length reduction \(264.4\text{ m}\)) |
| **\(+0.1300\text{ dB}\)** | 16 ONTs | 14.55% | ODP 13 & ODP 14 subscribers (large distribution detour elimination \(\approx 366.7\text{ m}\)) |
| **Total** | **110 ONTs** | **100.00%** | **Mean: \(0.057364\text{ dB}\)** |

### 1.6 Precision Check Status: PASS
The discrepancy is 100% accounted for by the two-decimal quantization in `backend/app/engine/optical.py`. No parameters were altered, and the calculation engine correctly operates on active cable geometries.

---

## 2. Splitter Inventory and Mapping Reconciliation

### 2.1 Splitter Node Architecture

The project database contains **16 nodes of type `NodeType.SPLITTER`**, alongside **14 ODP cabinets** (`NodeType.ODP`) and **1 ODC cabinet** (`NodeType.ODC`).

A rigorous reconciliation of splitters, parent cabinets, port allocations, and optical losses was performed:
1. **Feeder Splitters (ODC 1):** Two (2) 1:8 splitters (`ODC 1 Feeder Splitter PON 1` and `ODC 1 Feeder Splitter PON 2`) are mounted inside `ODC 1`. Each splitter connects to 7 ODP cabinets, leaving 1 spare port each ($7 + 7 = 14$ distribution lines).
2. **Distribution Splitters (ODP Cabinets):**
   * Thirteen (13) ODP cabinets (`ODP 1`, `ODP 2 [4c58]`, `ODP 3`, `ODP 4`, `ODP 5`, `ODP 6`, `ODP 7`, `ODP 8`, `ODP 9`, `ODP 11`, `ODP 12`, `ODP 13`, `ODP 14`) contain an explicitly modeled child splitter node (`NodeType.SPLITTER`) with `mountedInNodeId` referencing the ODP.
   * One (1) ODP cabinet (`ODP 2` `65f3967e-61be-4800-bf65-7092f711ebba`) contains an **internal node-level splitter specification** (`splitterRatio: "1:8"`, `portCapacity: 8`, `splitterLossDb: 10.0`) rather than a separate child entity.
3. **Legacy Unmounted Splitter:** One (1) splitter (`Splitter 1` `561494fe-1699-4e13-9799-f455e21ebdfb`) is unmounted (`mountedInNodeId: None`) and disconnected (`legacyTopologyStatus: "retained_disconnected_in_optimization"`). It carries zero connections, serves zero subscribers, and does not participate in any optical path.

Total active splitters: $2\text{ (ODC)} + 13\text{ (ODP child)} + 1\text{ (ODP internal)} = 16\text{ active splitters}$.  
Total splitter nodes in `nodes_data`: $2 + 13 + 1\text{ (legacy unmounted)} = 16\text{ nodes}$.

### 2.2 Comprehensive Splitter Inventory & Port Mapping Table

| Splitter Node ID | Splitter Name | Parent Cabinet ID & Name | Ratio | Input Connection | Total Output Ports | Used Ports | Available Ports | Active / Operational Status |
|---|---|---|---|---|---|---|---|---|
| `69d91394-1b59-49f4-a8d3-182303a27826` | ODC 1 Feeder Splitter PON 1 [proposed 1:8] | `339c407c` (ODC 1) | 1:8 | Feeder Cable 1 (OLT 1 PON 1) | 8 | 7 | 1 | Active (Mounted in ODC 1) |
| `a5e33a99-13fd-47f4-aa86-47c7878e724d` | ODC 1 Feeder Splitter PON 2 [proposed 1:8] | `339c407c` (ODC 1) | 1:8 | Feeder Cable 1 (OLT 1 PON 2) | 8 | 7 | 1 | Active (Mounted in ODC 1) |
| `b3223acf-8dab-4f45-9ccb-967684d1ab03` | ODP 1 Splitter [proposed] | `bef512cb` (ODP 1) | 1:8 | Distribution Cable 3 (from ODC 1 OUT-11) | 8 | 6 | 2 | Active (Mounted in ODP 1) |
| `75ed4232-aa29-4aca-8e6b-cd2c1c0862b5` | ODP 2 Splitter [proposed] | `4c58feef` (ODP 2) | 1:8 | Distribution Cable 12 (from ODC 1 OUT-12) | 8 | 8 | 0 | Active (Mounted in ODP 2 [4c58]) |
| `1dabbeb7-e35d-4ac0-b44a-252296332266` | ODP 3 Splitter [proposed] | `406d6242` (ODP 3) | 1:8 | Distribution Cable 4 (from ODC 1 OUT-01) | 8 | 8 | 0 | Active (Mounted in ODP 3) |
| `5c340766-96da-4fce-b355-5310e2af6382` | ODP 4 Splitter [proposed] | `e6f35d69` (ODP 4) | 1:8 | Distribution Cable 5 (from ODC 1 OUT-02) | 8 | 8 | 0 | Active (Mounted in ODP 4) |
| `f3856b54-7164-4bee-acd4-81fc00ee604d` | ODP 5 Splitter [proposed] | `f966dc68` (ODP 5) | 1:8 | Distribution Cable 6 (from ODC 1 OUT-03) | 8 | 8 | 0 | Active (Mounted in ODP 5) |
| `79115496-d28e-4ceb-87ea-0a3a2f68c7f6` | ODP 6 Splitter [proposed] | `582f69ce` (ODP 6) | 1:8 | Distribution Cable 7 (from ODC 1 OUT-04) | 8 | 8 | 0 | Active (Mounted in ODP 6) |
| `803e6dc7-ddf3-4af8-a9c0-981b9742132e` | ODP 7 Splitter [proposed] | `9dace938` (ODP 7) | 1:8 | Distribution Cable 8 (from ODC 1 OUT-05) | 8 | 8 | 0 | Active (Mounted in ODP 7) |
| `be50b2f0-8574-4f7e-9175-41344e0ded30` | ODP 8 Splitter [proposed] | `a620efe7` (ODP 8) | 1:8 | Distribution Cable 9 (from ODC 1 OUT-06) | 8 | 8 | 0 | Active (Mounted in ODP 8) |
| `ade94653-089c-476d-9adc-1bc05263c5a1` | ODP 9 Splitter [proposed] | `c46cf14c` (ODP 9) | 1:8 | Distribution Cable 10 (from ODC 1 OUT-07) | 8 | 8 | 0 | Active (Mounted in ODP 9) |
| `c35dbe6c-f712-4904-bb7d-ff4696407638` | ODP 11 Splitter [proposed] | `dc41c170` (ODP 11) | 1:8 | Distribution Cable 15 (from ODC 1 OUT-14) | 8 | 8 | 0 | Active (Mounted in ODP 11) |
| `2bd02ef3-56e1-4fd5-b325-f94645841398` | ODP 12 Splitter [proposed] | `612671c5` (ODP 12) | 1:8 | Distribution Cable 11 (from ODC 1 OUT-08) | 8 | 8 | 0 | Active (Mounted in ODP 12) |
| `7bbe3f85-a5b9-4b73-a2b5-06ae4056f802` | ODP 13 Splitter [proposed] | `a85174fa` (ODP 13) | 1:8 | Distribution Cable 13 (from ODC 1 OUT-09) | 8 | 8 | 0 | Active (Mounted in ODP 13) |
| `82d906f2-4dd1-4375-92a3-26847eacd589` | ODP 14 Splitter [proposed] | `633c0283` (ODP 14) | 1:8 | Distribution Cable 14 (from ODC 1 OUT-10) | 8 | 8 | 0 | Active (Mounted in ODP 14) |
| *Integrated in Node* | ODP 2 Internal Splitter | `65f3967e` (ODP 2) | 1:8 | Distribution Cable 12b (from ODC 1 OUT-13) | 8 | 8 | 0 | Active (Integrated in ODP 2 node) |
| `561494fe-1699-4e13-9799-f455e21ebdfb` | Splitter 1 | None (Unmounted) | Unconfigured | None (Isolated) | 0 | 0 | 0 | Unmounted (Legacy Retained) |

### 2.3 Verification of Single-Stage Insertion Loss Accounting

A crucial integrity check was conducted on `backend/app/engine/optical.py` to ensure splitter insertion loss is never double-counted (e.g., once for the cabinet and once for the mounted splitter).

1. In `optical.py` (lines 1221–1255), the algorithm detects mounted splitters for each host cabinet. If mounted splitters exist, they replace the host cabinet in `path_nodes_with_mounted_splitters`.
2. For cabinets without child splitter nodes (such as `ODP 2` `65f3967e`), `_get_splitter_info_for_node()` extracts the splitter ratio and loss directly from the ODP node properties.
3. In both cases, `seen_splitter_node_ids.add(node_id)` guarantees that each splitting stage is recorded exactly once.
4. Total splitter insertion loss evaluated along every optical path:
   * **Stage 1 (ODC Feeder Splitter):** \(10.38\text{ dB}\)
   * **Stage 2 (ODP Distribution Splitter):** \(10.00\text{ dB}\)
   * **Total Splitter Insertion Loss per Subscriber:** Exactly **\(20.38\text{ dB}\)** (or \(20.76\text{ dB}\) if nominal ITU-T table fallback is invoked).

### 2.4 Splitter Inventory Check Status: PASS WITH LIMITATIONS
* **Limitation Note:** All 14 ODPs are actively operational with 1:8 splitters serving 110 subscribers. However, 13 ODPs use separate child splitter entities, while 1 ODP (`ODP 2` `65f3967e`) uses direct node configuration. Furthermore, 1 legacy unmounted splitter entity remains in `nodes_data`. While the calculation engine handles both structures seamlessly and loss calculation is 100% correct, normalization of all ODPs to uniform child entities is recommended for future database schema uniformity.

---

## 3. Endpoint Alignment Classification

### 3.1 Endpoint Distance Measurement Methodology

In GIS and physical network planning, the endpoints of a cable LineString geometry should snap closely to the coordinates of the connected equipment. In the initial project audit, a global tolerance of 50 meters was referenced. To provide complete engineering transparency, all **125 physical cable geometries** (representing 250 endpoints) were measured against their respective source and target node coordinates using the great-circle Haversine formula.

Endpoint distance is categorized into four distinct engineering tiers:
1. **Exact Node Alignment (\(<2.0\text{ m}\)):** Cable geometry vertex snaps directly onto the equipment coordinates or within immediate pole mounting clearance.
2. **Acceptable Building Setback (\(2.0\text{ m} - 15.0\text{ m}\)):** Cable geometry terminates at the roadside pole or parcel boundary, while the subscriber ONT / house coordinate is located slightly inside the property.
3. **Requires Review (\(15.0\text{ m} - 50.0\text{ m}\)):** Cable geometry terminates at the road edge, but the subscriber dwelling is situated deep within a large parcel (\(>15\text{ m}\)), requiring field confirmation of span feasibility.
4. **Invalid Endpoint (\(>50.0\text{ m}\)):** Gross snapping error indicating disconnected geometry or incorrect association.

### 3.2 Endpoint Distance Statistics

| Endpoint Metric | Minimum Distance | Average Distance | Maximum Distance |
|---|---|---|---|
| **Cable Start Distance (from Source Node)** | \(0.00\text{ m}\) | \(2.02\text{ m}\) | \(7.51\text{ m}\) |
| **Cable End Distance (from Target Node)** | \(0.00\text{ m}\) | \(9.32\text{ m}\) | \(27.57\text{ m}\) |
| **Combined All Endpoints (250 vertices)** | \(0.00\text{ m}\) | \(5.67\text{ m}\) | \(27.57\text{ m}\) |

### 3.3 Classification Breakdown Across 125 Physical Cables

| Cable Category | Total Cables | Exact Node Alignment (\(<2.0\text{ m}\)) | Acceptable Setback (\(2.0\text{ m} - 15.0\text{ m}\)) | Requires Review (\(15.0\text{ m} - 50.0\text{ m}\)) | Invalid Endpoint (\(>50.0\text{ m}\)) |
|---|---|---|---|---|---|
| **Feeder** | 1 | 1 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) |
| **Distribution** | 14 | 7 (50.0%) | 7 (50.0%) | 0 (0.0%) | 0 (0.0%) |
| **Drop** | 110 | 6 (5.5%) | 98 (89.1%) | 6 (5.5%) | 0 (0.0%) |
| **Total Network** | **125** | **14 (11.2%)** | **105 (84.0%)** | **6 (4.8%)** | **0 (0.0%)** |

### 3.4 Detailed Audit of Cables Requiring Review (\(15.0\text{ m} - 50.0\text{ m}\))

Six (6) drop cables exhibit end distances exceeding \(15.0\text{ m}\) from the subscriber ONT coordinate:

| Cable Name | Cable ID | Source Node | Target Node | Start Distance | End Distance | Maximum Setback | Field Assessment Requirement |
|---|---|---|---|---|---|---|---|
| Proposed drop to Customer 92 | `4485a3bf` | ODP 2 | ONT - Customer 92 | \(1.51\text{ m}\) | \(27.57\text{ m}\) | **\(27.57\text{ m}\)** | Large residential parcel; drop wire terminates at access lane. Field survey must verify aerial span from pole to house facade vs requirement for intermediate private pole. |
| Proposed drop to Customer 104 | `d31517dd` | ODP 13 | ONT - Customer 104 | \(7.51\text{ m}\) | \(20.65\text{ m}\) | **\(20.65\text{ m}\)** | House set back from main roadway. Field survey must confirm clearance over private driveway. |
| Proposed drop to Customer 4 | `3bd76737` | ODP 2 | ONT - Customer 4 | \(1.51\text{ m}\) | \(15.38\text{ m}\) | **\(15.38\text{ m}\)** | Boundary setback; standard aerial drop clamp feasible subject to visual clearance check. |
| Proposed drop to Customer 2 | `9de93209` | ODP 2 | ONT - Customer 2 | \(1.51\text{ m}\) | \(15.35\text{ m}\) | **\(15.35\text{ m}\)** | Boundary setback; standard aerial drop clamp feasible subject to visual clearance check. |
| Proposed drop to Customer 107 | `a9223992` | ODP 8 | ONT - Customer 107 | \(1.99\text{ m}\) | \(15.21\text{ m}\) | **\(15.21\text{ m}\)** | House situated behind front building; verify path of drop cable to rear entrance. |
| Proposed drop to Customer 101 | `64ef6c29` | ODP 7 | ONT - Customer 101 | \(0.38\text{ m}\) | \(15.11\text{ m}\) | **\(15.11\text{ m}\)** | Corner parcel setback; verify drop anchor point on building eaves. |

### 3.5 Engineering Justification of Setbacks

In suburban FTTH planning:
* The GIS customer coordinate typically represents the centroid of the residential rooftop.
* The physical cable route geometry terminates at the property line (the roadside pole or boundary demarcation box / OTP).
* The gap between \(2\text{ m}\) and \(27.57\text{ m}\) represents the **lead-in / premise drop segment** (from property boundary to customer indoor Roset/ONT).
* Because the 50-meter tolerance was satisfied, the calculation engine correctly calculated lengths without crashing. However, for construction purposes, an endpoint distance of \(27.57\text{ m}\) cannot be certified as construction-ready without a field walk-through confirming that an aerial drop cable can span this distance without sag violations or private land disputes.

### 3.6 Endpoint Alignment Check Status: PASS WITH LIMITATIONS
* **Limitation Note:** 119 cables (\(95.20\%\)) are strictly aligned or within normal building setback (\(\le 15.0\text{ m}\)). The 6 cables (\(4.80\%\)) between \(15\text{ m}\) and \(28\text{ m}\) are mathematically sound within GIS snapping bounds, but are explicitly flagged for physical field survey before aerial fiber installation.

---

## 4. Final Engineering Certification & Deliverable Conclusion

### 4.1 Certification Status Matrix

| Audit Dimension | Evaluation Standard | Live Database Result | Certified Status |
|---|---|---|---|
| **Optical Attenuation Precision** | Unrounded math vs Engine output | Reconciled to \(+0.001374\text{ dB}\) quantization bias | **PASS** |
| **Splitter Inventory & Port Mapping** | All 14 ODPs & 1 ODC mapped | 16 splitters audited; 14 ODPs actively split 1:8 | **PASS WITH LIMITATIONS** |
| **Splitter Insertion Loss Charging** | No double counting across stages | Stage 1 (10.38 dB) + Stage 2 (10.00 dB) verified | **PASS** |
| **Endpoint Geometrical Snapping** | Detailed alignment tiers (\(<2\text{m}\), \(15\text{m}\), \(50\text{m}\)) | Max setback \(27.57\text{m}\); 6 drops flagged for survey | **PASS WITH LIMITATIONS** |
| **Physical Route Survey Status** | Field walk-through verification | Unverified map candidate routes | **UNVERIFIED (PHYSICAL FIELD)** |
| **Database & Mathematical Integrity** | 100% preservation across 110 subscribers | Zero data loss, zero orphan records | **PASS** |

### 4.2 Engineering Audit Conclusion

The mathematical, logical, and database consistency audit of project `Calc Projek - Physical Route Design 2026-10-31` is **OFFICIALLY COMPLETE AND CERTIFIED AS PASS WITH LIMITATIONS**:

1. **Mathematical Consistency:** The optical power calculation engine has been verified down to the sub-millibel level. The variance between theoretical calculus and reported results is proven to be an intentional floating-point quantization artifact of segment-level rounding, with zero parameter manipulation.
2. **Topology & Splitter Consistency:** All 110 subscribers are systematically connected through a verified two-stage PON topology ($2 \times 1:8$ feeder splitters feeding 14 active $1:8$ distribution splitters). Single-stage insertion loss accounting is strictly preserved.
3. **Physical Survey Caveat (Standard Engineering Limitation):** While all cable geometries snap within GIS tolerances and follow street rights-of-way, **none of the optimized cable geometries or proposed pole placements have undergone physical on-site field surveys**. Prior to procurement release and field construction, field survey teams must execute a physical walk-through—specifically inspecting the 6 subscriber drops with setbacks \(\ge 15\text{ m}\) and verifying aerial pole attachment permissions with local utilities.
