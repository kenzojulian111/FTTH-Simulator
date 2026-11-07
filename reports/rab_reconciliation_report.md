# RAB Report Reconciliation & Financial Integrity Audit
**Project ID:** `test-proj-calc-physical-20261031`  
**Project Display Name:** `kenjo punya`  
**Document Reference:** `RAB-FTTH-2026-001`  
**Document Revision:** `Revised Preliminary Cost Estimate (Rev 1.2)`  
**Audit Date:** November 7, 2026  
**Auditor:** Senior Telecommunications Reliability Engineer & Cost Auditor  

---

## 1. Executive Summary & Objective

This audit reconciles the Rencana Anggaran Biaya (RAB) / Bill of Quantities (BoQ) for project `test-proj-calc-physical-20261031` (`kenjo punya`). 

This revised audit establishes:
1. **Zero Financial Discrepancy:** The master BoQ line items sum exactly to the material subtotal ($\text{Rp } 132.856.100,00$), installation subtotal ($\text{Rp } 117.954.150,00$), and grand total CAPEX ($\text{Rp } 250.810.250,00$).
2. **Correct Customer Semantics:** 110 customers are planned and assigned to 110 ONT drop terminations. Active connected customers are strictly 0 (pre-activation phase). Estimated CAPEX per Planned Customer is explicitly defined as $\text{Rp } 2.280.093,18$, eliminating the erroneous "Cost per Connected Customer" label.
3. **Audited Splitter Procurement:** Reconciled from 30 down to **16 physical splitters** (2 feeder splitters in ODC 1 + 14 access splitters in ODP 1–14). The 13 duplicate ODP property declarations have been de-duplicated and the 1 legacy disconnected splitter is excluded.
4. **Audited Pole Infrastructure:** Exactly 4 proposed poles are billed to CAPEX ($\text{Rp } 4.800.000,00$); 1 existing, 3 shared, and 1 unverified pole are excluded.

---

## 2. Customer Metric & Investment Allocation Audit

| Metric Parameter | Database Count | Topological State | Cost Result Value | Audit Determination |
| :--- | :---: | :---: | :---: | :--- |
| **Planned Customers** | 110 | Mapped coordinates | 110 | 100% Verified. All 110 customer records exist with valid locations. |
| **Assigned ONTs** | 110 | 110 ONT nodes | 110 | 100% Verified. Each customer has `ontNodeId` mapped 1:1 to an ONT. |
| **Connected Customers** | 0 | Pre-activation | 0 | 100% Verified. Network is pre-commissioning; no active subscribers. |
| **Estimated CAPEX / Planned Customer** | — | — | **Rp 2.280.093,18** | $\text{Grand Total } (\text{Rp } 250.810.250) / 110 = \text{Rp } 2.280.093,18$. |
| **Cost / Connected Customer** | — | — | **N/A** | Correctly withheld (`null` / `—`). Division by zero avoided. |

---

## 3. Financial Recapitulation & Category Subtotals

```
Grand Total CAPEX: Rp 250.810.250,00
├── Material Procurement Subtotal:     Rp 132.856.100,00  (52.97%)
└── Installation & Civil Subtotal:     Rp 117.954.150,00  (47.03%)
                                       ─────────────────
                            Reconciled Sum: Rp 250.810.250,00  (Variance: Rp 0,00)
```

### Table 3.1: Detailed Category Subtotals vs BoQ Summation

| Category | Database / Backend Subtotal | Line Item Summation | Variance | Verification Status |
| :--- | :---: | :---: | :---: | :---: |
| **Material Procurement (Supply)** | Rp 132.856.100,00 | Rp 132.856.100,00 | Rp 0,00 | **100% MATCH** |
| **Installation & Civil Works** | Rp 117.954.150,00 | Rp 117.954.150,00 | Rp 0,00 | **100% MATCH** |
| **Grand Total CAPEX** | **Rp 250.810.250,00** | **Rp 250.810.250,00** | **Rp 0,00** | **100% MATCH** |

---

## 4. Master Bill of Quantities (BoQ) Line-by-Line Audit

| Item Code | Description | Qty | Unit | Unit Rate (IDR) | Subtotal (IDR) | Category | Rate Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `CBL-SUPPLY-DISTRIBUTION` | Distribution cable supply (incl. 10% slack) | 6.567,74 | m | Rp 5.000 | Rp 32.838.700 | Material | Planning Estimate |
| `CBL-INSTALL-DISTRIBUTION` | Distribution cable aerial installation | 6.567,74 | m | Rp 7.500 | Rp 49.258.050 | Installation | Planning Estimate |
| `CBL-SUPPLY-DROP` | Drop cable supply (incl. 10% slack) | 5.327,39 | m | Rp 5.000 | Rp 26.636.950 | Material | Planning Estimate |
| `CBL-INSTALL-DROP` | Drop cable installation & clamping | 5.327,39 | m | Rp 7.500 | Rp 39.955.425 | Installation | Planning Estimate |
| `CBL-SUPPLY-FEEDER` | Feeder cable supply (incl. 10% slack) | 1.232,09 | m | Rp 5.000 | Rp 6.160.450 | Material | Planning Estimate |
| `CBL-INSTALL-FEEDER` | Feeder cable aerial installation | 1.232,09 | m | Rp 7.500 | Rp 9.240.675 | Installation | Planning Estimate |
| `POLE-SUPPLY-PROPOSED` | Concrete Pole 7m (Proposed Only) | 4 | piece | Rp 850.000 | Rp 3.400.000 | Material | Planning Estimate |
| `POLE-INSTALL-PROPOSED` | Pole Planting, Foundation & Civil Works | 4 | piece | Rp 350.000 | Rp 1.400.000 | Installation | Planning Estimate |
| `OLT-SUPPLY` | GPON OLT 8-PON Port Chassis & Optics | 1 | unit | Rp 25.000.000 | Rp 25.000.000 | Material | Planning Estimate |
| `OLT-INSTALL` | OLT Rack Mounting, DC Power & Config | 1 | unit | Rp 3.000.000 | Rp 3.000.000 | Installation | Planning Estimate |
| `ODC-SUPPLY` | Outdoor ODC Cabinet 48-port | 1 | unit | Rp 4.500.000 | Rp 4.500.000 | Material | Planning Estimate |
| `ODC-INSTALL` | ODC Base Civil Pad, Grounding & Mount | 1 | unit | Rp 1.200.000 | Rp 1.200.000 | Installation | Planning Estimate |
| `ODP-SUPPLY` | Outdoor ODP Enclosure 8/16-port | 14 | unit | Rp 350.000 | Rp 4.900.000 | Material | Planning Estimate |
| `ODP-INSTALL` | ODP Pole Mounting, Bracket & Sealing | 14 | unit | Rp 150.000 | Rp 2.100.000 | Installation | Planning Estimate |
| `SPL-SUPPLY` | **Optical PLC Splitter (1:8) Module** | **16** | **piece** | **Rp 120.000** | **Rp 1.920.000** | **Material** | **Planning Estimate** |
| `SPL-INSTALL` | **Splitter Splicing, Tray Mounting & Test** | **16** | **piece** | **Rp 50.000** | **Rp 800.000** | **Installation** | **Planning Estimate** |
| `ONT-SUPPLY` | GPON ONT Subscriber Terminal | 110 | unit | Rp 250.000 | Rp 27.500.000 | Material | Planning Estimate |
| `ONT-INSTALL` | ONT Activation, Indoor Drop & Patching | 110 | unit | Rp 100.000 | Rp 11.000.000 | Installation | Planning Estimate |

---

## 5. Pricing Confidence & Preliminary Status

All 18 unit rates stem from baseline engineering planning estimates (`Planning Estimate`). Document status is strictly **Revised Preliminary Cost Estimate (Rev 1.2)** with non-binding preliminary engineering disclaimers.
