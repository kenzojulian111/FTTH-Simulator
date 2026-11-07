# Equipment & Optical Splitter Reconciliation Report
**Project ID:** `test-proj-calc-physical-20261031`  
**Project Display Name:** `kenjo punya`  
**Audit Scope:** Network Devices, PON Architecture, Splitter Procurement vs Topology  
**Audit Status:** Preliminary Engineering Audit (Pending Verification)  
**Audit Date:** November 7, 2026  

---

## 1. Executive Summary & Table 4.1 Reconciliation Matrix

This report reconciles database node entities, functional active devices, and procurement line items following the physical deduplication audit.

### Table 1: End-to-End Equipment Reconciliation Schedule

| Equipment Category | Database Entity Count | Active Functional Count | Procurement (BoQ) Count | Variance | Engineering Explanation & Reconciliation Rationale |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **OLT Chassis** | 1 | 1 | 1 | 0 | 1 central GPON chassis at Central Office (`olt-1`), equipped with 2 active PON ports. |
| **ODC Cabinets** | 1 | 1 | 1 | 0 | 1 primary outdoor cross-connect cabinet (`odc-1`), housing feeder splitters and fiber trays. |
| **ODP Enclosures** | 14 | 14 | 14 | 0 | 14 pole-mounted distribution points across the service area (112 gross ports, 110 assigned). |
| **Optical PLC Splitters (1:8)** | **16** | **16** | **16** | **0** | **Reconciliation Successful (Zero Discrepancy):**<br>• Active Topology: 2 feeder splitters in ODC 1 + 14 access splitters in ODPs = **16 units**.<br>• BoQ Count: **16 units**.<br>• Reconciliation: 13 duplicate ODP component property declarations have been de-duplicated with mounted splitter nodes, and 1 legacy disconnected splitter is excluded from procurement. |
| **ONT Subscriber Units** | 110 | 110 | 110 | 0 | 110 subscriber units mapped 1:1 to 110 planned customers. |
| **Support Poles** | 9 | 9 | 4 | -5 | 9 total structural poles in network: 4 proposed (new procurement), 1 existing, 3 shared, 1 unverified. Only 4 are billed to CAPEX. |

---

## 2. PON Architecture & Optical Tree Topology

The optical distribution network (ODN) uses a two-stage balanced 1:8 tree architecture driven by two independent PON ports:

```
                          ┌── [PON Port 1: +6.00 dBm]
                          │         │
                          │         ▼
                          │    [Feeder Splitter 1 (1:8)]  (in ODC 1)
                          │         ├── Branch 1 ──> ODP 03 (1:8) ──> 8 ONTs
                          │         ├── Branch 2 ──> ODP 06 (1:8) ──> 8 ONTs
                          │         ├── Branch 3 ──> ODP 07 (1:8) ──> 8 ONTs
                          │         ├── Branch 4 ──> ODP 12 (1:8) ──> 8 ONTs
                          │         ├── Branch 5 ──> ODP 14 (1:8) ──> 8 ONTs
                          │         ├── Branch 6 ──> ODP 02 (1:8) ──> 8 ONTs
                          │         └── Branch 7 ──> ODP 02#2 (1:8) ──> 8 ONTs
[OLT 1 (CO)] ─────────────┤
                          │
                          └── [PON Port 2: +6.00 dBm]
                                    │
                                    ▼
                               [Feeder Splitter 2 (1:8)]  (in ODC 1)
                                    ├── Branch 8  ──> ODP 04 (1:8) ──> 8 ONTs
                                    ├── Branch 9  ──> ODP 05 (1:8) ──> 8 ONTs
                                    ├── Branch 10 ──> ODP 08 (1:8) ──> 8 ONTs
                                    ├── Branch 11 ──> ODP 09 (1:8) ──> 8 ONTs
                                    ├── Branch 12 ──> ODP 13 (1:8) ──> 8 ONTs
                                    ├── Branch 13 ──> ODP 01 (1:8) ──> 6 ONTs
                                    └── Branch 14 ──> ODP 11 (1:8) ──> 8 ONTs
```

### Key Optical Tree Statistics:
- **Total Feeder Splitters:** 2 units (both located in ODC 1, ratio 1:8).
- **Total Distribution / Access Splitters:** 14 units (located in ODP 01 through ODP 14, ratio 1:8).
- **Total Active Splitters in Service:** $2 + 14 = 16\text{ units}$.
- **Customer Termination:** 13 ODPs $\times 8\text{ ONTs} + 1\text{ ODP} \times 6\text{ ONTs} = 110\text{ ONTs}$.
- **Total Split Ratio per Customer Path:** $1:8 \times 1:8 = 1:64$ (Insertion loss $\approx 10,38\text{ dB} + 10,00\text{ dB} = 20,38\text{ dB}$).
- **Optical Power Margins:** All 110 ONTs receive between $-16,5\text{ dBm}$ and $-18,2\text{ dBm}$, well above the receiver sensitivity limit of $-27,0\text{ dBm}$ and within overload limits ($-8,0\text{ dBm}$).
- **Proposed Architecture Status:** All optical links represent **Simulated Proposed Architecture Performance (Estimasi Desain Perencanaan)**. Field verification and as-built commissioning are required prior to declaring commercial operational status.
