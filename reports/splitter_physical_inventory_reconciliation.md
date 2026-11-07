# Splitter Physical Inventory & Procurement Reconciliation Report
**Project ID:** `test-proj-calc-physical-20261031`  
**Project Display Name:** `kenjo punya`  
**Audit Scope:** End-to-End Physical & Topological Audit of All Splitter Entities and Enclosure Properties  
**Audit Status:** Preliminary Engineering Audit (Pending Physical Survey Verification)  
**Date:** November 7, 2026  
**Auditor:** Senior Telecommunications Reliability Engineer & Passive ODN Specialist  

---

## 1. Executive Summary & Audit Determination

A critical discrepancy in legacy project versions was the procurement count of **30 splitters** in the Bill of Quantities (BoQ) despite the network topology operating with **16 functional splitters**.

### Core Audit Finding:
1. **The 30-Unit Figure was a Double-Counting Bug:** In the legacy backend cost calculation, `splitter_count` was computed as the sum of all `NodeType.SPLITTER` nodes (16 entities) **PLUS** every network node declaring `"splitterRatio"` or `"splitterLossDb"` in its `properties` (14 ODP nodes), yielding:
   $$\text{Legacy Tally} = 16\text{ splitter nodes} + 14\text{ ODP property declarations} = 30\text{ units}$$
2. **Component Properties Represent the Same Physical Devices:** Detailed inspection of database node IDs and properties confirms that 13 of the 14 ODPs contain internal mounted splitter node entities (`mountedInNodeId: odp.id`), where the ODP's `splitterRatio: "1:8"` property simply mirrors the mounted splitter's ratio. They are **the exact same physical devices inside the enclosure**, not additional external splitters.
3. **True Physical Procurement Requirement:** The network requires exactly **16 physical splitters**:
   - **2 Feeder Splitters** (Stage 1, 1:8 PLC) co-located inside outdoor cabinet ODC 1.
   - **14 Access Splitters** (Stage 2, 1:8 PLC) distributed across the 14 ODP locations (13 mounted nodes + 1 integrated component).
   - **1 Legacy Disconnected Splitter** (`Splitter 1`, ID `561494fe...`) is unmounted, has zero optical connections, and is designated `retained_disconnected_in_optimization`. It is **excluded** from required procurement.
4. **Financial Adjustment:** Correcting the procurement quantity from 30 to 16 reduces splitter supply cost by $\text{Rp } 1.680.000,00$ and installation cost by $\text{Rp } 700.000,00$, reducing total CAPEX by $\text{Rp } 2.380.000,00$ (from $\text{Rp } 253.190.250,00$ to **$\text{Rp } 250.810.250,00$**).

---

## 2. Complete Physical Splitter Node Inventory (All 16 Database Entities)

| No | Splitter Node Name | Physical Node ID | Location / Mounted In | Splitter Ratio | Insertion Loss | Status / Provenance | Physical Connection & Role |
| :---: | :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| 1 | `Splitter 1` | `561494fe-1699-4e13-9799-f455e21ebdfb` | Unmounted (`None`) | Unset (`None`) | 10.00 dB | **Legacy Disconnected** (`retained_disconnected_in_optimization`) | 0 In / 0 Out. Disconnected legacy artifact. **Excluded from BoQ**. |
| 2 | `ODC 1 Feeder Splitter PON 1 [proposed 1:8]` | `69d91394-1b59-49f4-a8d3-182303a27826` | Mounted in ODC 1 (`339c407c...`) | 1:8 PLC | 10.38 dB | **Proposed but not installed** (PON 1 Feeder) | Connected to OLT PON 1 via Cable 6; fanout to 7 ODPs (ODP 3, 6, 7, 12, 14, 4c58, 65f3). |
| 3 | `ODC 1 Feeder Splitter PON 2 [proposed 1:8]` | `a5e33a99-13fd-47f4-aa86-47c7878e724d` | Mounted in ODC 1 (`339c407c...`) | 1:8 PLC | 10.38 dB | **Proposed but not installed** (PON 2 Feeder) | Connected to OLT PON 2 via Cable 6; fanout to 7 ODPs (ODP 1, 4, 5, 8, 9, 11, 13). |
| 4 | `ODP 1 Splitter [proposed]` | `b3223acf-8dab-4f45-9ccb-967684d1ab03` | Mounted in ODP 1 (`bef512cb...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 6 ONTs (Customer 1, 6, 8, 9, 11, 12). |
| 5 | `ODP 2 Splitter [proposed]` | `75ed4232-aa29-4aca-8e6b-cd2c1c0862b5` | Mounted in ODP 2 (`4c58feef...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 5, 7, 10, 13, 15, 16, 18, 19). |
| 6 | `ODP 3 Splitter [proposed]` | `1dabbeb7-e35d-4ac0-b44a-252296332266` | Mounted in ODP 3 (`406d6242...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 38, 39, 40, 41, 42, 75, 76, 77). |
| 7 | `ODP 4 Splitter [proposed]` | `5c340766-96da-4fce-b355-5310e2af6382` | Mounted in ODP 4 (`e6f35d69...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 46, 47, 48, 49, 50, 78, 79, 80). |
| 8 | `ODP 5 Splitter [proposed]` | `f3856b54-7164-4bee-acd4-81fc00ee604d` | Mounted in ODP 5 (`f966dc68...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 81, 82, 83, 84, 85, 86, 87, 89). |
| 9 | `ODP 6 Splitter [proposed]` | `79115496-d28e-4ceb-87ea-0a3a2f68c7f6` | Mounted in ODP 6 (`582f69ce...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 90, 91, 94, 95, 96, 97, 98, 99). |
| 10 | `ODP 7 Splitter [proposed]` | `803e6dc7-ddf3-4af8-a9c0-981b9742132e` | Mounted in ODP 7 (`9dace938...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 100, 101, 102, 103, 105, 106, 107, 108). |
| 11 | `ODP 8 Splitter [proposed]` | `be50b2f0-8574-4f7e-9175-41344e0ded30` | Mounted in ODP 8 (`a620efe7...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 23, 25, 28, 30, 32, 37, 109, ONT 9). |
| 12 | `ODP 9 Splitter [proposed]` | `ade94653-089c-476d-9adc-1bc05263c5a1` | Mounted in ODP 9 (`c46cf14c...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 43, 44, 45, ONT 3, 6, 7, 8, ONT 11). |
| 13 | `ODP 11 Splitter [proposed]` | `c35dbe6c-f712-4904-bb7d-ff4696407638` | Mounted in ODP 11 (`dc41c170...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 14, 22, 24, 26, 27, 29, 31, ONT 2). |
| 14 | `ODP 12 Splitter [proposed]` | `2bd02ef3-56e1-4fd5-b325-f94645841398` | Mounted in ODP 12 (`612671c5...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 17, 20, 21, 33, 34, 35, 36, 88). |
| 15 | `ODP 13 Splitter [proposed]` | `7bbe3f85-a5b9-4b73-a2b5-06ae4056f802` | Mounted in ODP 13 (`a85174fa...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 52, 53, 54, 55, 56, 58, 104, ONT 10). |
| 16 | `ODP 14 Splitter [proposed]` | `82d906f2-4dd1-4375-92a3-26847eacd589` | Mounted in ODP 14 (`633c0283...`) | 1:8 PLC | 10.00 dB | **Proposed but not installed** (ODP Access) | Serves 8 ONTs (Customer 60, 61, 69, 70, 71, 72, 73, 74). |

---

## 3. ODP Enclosure Splitter Property Audit (All 14 ODP Nodes)

| No | ODP Enclosure Name | ODP Node ID | Declared `splitterRatio` | Internal Mounted Splitter Node ID | Reconciliation Analysis |
| :---: | :--- | :--- | :---: | :--- | :--- |
| 1 | `ODP 1` | `bef512cb-8d35-44d8-a16b-6996d53cdc5c` | 1:8 | `b3223acf...` (`ODP 1 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 2 | `ODP 2` (Branch 1) | `4c58feef-3ebd-468d-9b9c-e8c7ac7619c5` | 1:8 | `75ed4232...` (`ODP 2 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 3 | `ODP 3` | `406d6242-fb48-409d-838f-5188a297a20b` | 1:8 | `1dabbeb7...` (`ODP 3 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 4 | `ODP 4` | `e6f35d69-a7aa-494a-9758-82453855611b` | 1:8 | `5c340766...` (`ODP 4 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 5 | `ODP 5` | `f966dc68-ba99-4c58-8e08-d1fb3c219065` | 1:8 | `f3856b54...` (`ODP 5 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 6 | `ODP 6` | `582f69ce-2033-4ebc-a656-5cfb187e2525` | 1:8 | `79115496...` (`ODP 6 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 7 | `ODP 7` | `9dace938-8859-48cd-9277-14979f4849af` | 1:8 | `803e6dc7...` (`ODP 7 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 8 | `ODP 8` | `a620efe7-73f8-4bb6-9310-77f3d609cfab` | 1:8 | `be50b2f0...` (`ODP 8 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 9 | `ODP 9` | `c46cf14c-25b1-44f7-aa91-9bd751554fc1` | 1:8 | `ade94653...` (`ODP 9 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 10 | `ODP 2` (Branch 2 / #10) | `65f3967e-61be-4800-bf65-7092f711ebba` | 1:8 | *None (no separate node)* | **Integrated Component.** Configured directly on ODP (counts as 1 splitter). |
| 11 | `ODP 11` | `dc41c170-2125-46ae-a8c3-16a265ecb945` | 1:8 | `c35dbe6c...` (`ODP 11 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 12 | `ODP 12` | `612671c5-3b3c-477c-8488-700da3af9ffa` | 1:8 | `2bd02ef3...` (`ODP 12 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 13 | `ODP 13` | `a85174fa-f806-4bb7-bbde-82d9ccaefb80` | 1:8 | `7bbe3f85...` (`ODP 13 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |
| 14 | `ODP 14` | `633c0283-c996-49cd-b01c-627b4ffbb233` | 1:8 | `82d906f2...` (`ODP 14 Splitter [proposed]`) | **Exact Same Device.** De-duplicated (counts as 1 splitter). |

---

## 4. Classification & Category Separation

In accordance with strict telecommunications asset audit guidelines:

| Category | Count | Node Entities / IDs | Procurement Treatment |
| :--- | :---: | :--- | :--- |
| **Existing and Installed** | **0** | None | Not applicable (Greenfield planning network) |
| **Required New Procurement** | **16** | 2 Feeder Splitters in ODC 1 + 14 Access Splitters in ODP 1–14 | **Billed 100% in BoQ** (16 units) |
| **Proposed but not installed** | **15** | Splitters 2–16 (2 feeder splitters + 13 mounted ODP splitter nodes) | Sub-category of required procurement |
| **Integrated component** | **1** | ODP `65f3967e-61be-4800-bf65-7092f711ebba` (integrated 1:8 cassette) | Sub-category of required procurement |
| **Legacy disconnected** | **1** | `Splitter 1` (`561494fe-1699-4e13-9799-f455e21ebdfb`) | **Excluded from BoQ** (0 unit billed) |
| **De-duplicated ODP Properties** | **13** | Properties on ODP 1–9, 11–14 matching mounted nodes | **Excluded from double-counting** |

$$\text{Total Evaluated Database Records} = 16\text{ (Required)} + 13\text{ (De-duplicated)} + 1\text{ (Legacy Disconnected)} = \mathbf{30\text{ items}}$$

---

## 5. Conclusion & Engineering Certification

- The physical requirement of optical splitters for project `test-proj-calc-physical-20261031` is rigorously established as **16 units**.
- Double-counting has been completely eliminated in both backend calculation and frontend reporting.
- Status: **Preliminary Engineering Estimate** (pending final physical walkout survey and vendor quotation).
