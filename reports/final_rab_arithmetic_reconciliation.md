# FTTH Simulator: RAB (Rencana Anggaran Biaya) Arithmetic Reconciliation Report

**Project**: `Calc Projek - Physical Route Design 2026-10-31` / `kenjo punya` (`id: test-proj-calc-physical-20261031`)  
**Document Ref**: `RAB-FTTH-2026-001`  
**Generated File**: [`ftth_rab_report_final.pdf`](file:///home/kenzojulian/Projects/project/anjaykanlek/ftth_rab_report_final.pdf)  
**Evaluation Date**: November 7, 2026  
**Auditor**: Independent Senior FTTH Reliability & Cost Estimation Auditor  
**Reconciliation Status**: **100% RECONCILED (ZERO DISCREPANCY)**

---

## 1. Executive Cost Recapitulation Summary

| Category | Component Description | Subtotal (IDR / Rp) | Proportion (%) | Formula / Source |
| :--- | :--- | :---: | :---: | :--- |
| **A** | **Pengadaan Perangkat & Material (Material Supply)** | **Rp 134.536.100** | 53,14% | $\sum (\text{Qty} \times \text{Unit Cost})$ for all `material` items |
| **B** | **Jasa Pemasangan & Penarikan (Installation Labor)** | **Rp 118.654.150** | 46,86% | $\sum (\text{Qty} \times \text{Unit Cost})$ for all `installation` items |
| **C** | **Pekerjaan Lain-lain (Other Items)** | **Rp 0** | 0,00% | None returned |
| **TOTAL** | **Grand Total Belanja Modal (Total CAPEX)** | **Rp 253.190.250** | **100,00%** | $\text{Subtotal A} + \text{Subtotal B} + \text{Subtotal C}$ |

```
Arithmetic Check:
  Material Subtotal     : Rp 134.536.100,00
+ Installation Subtotal : Rp 118.654.150,00
--------------------------------------------
= Grand Total CAPEX     : Rp 253.190.250,00
Backend Returned Capex  : Rp 253.190.250,00
Variance                : Rp 0,00 (EXACT MATCH)
```

---

## 2. Line-by-Line Bill of Quantities (BoQ) Reconciliation

### 2.1 Material Procurement Schedule (Subtotal: Rp 134.536.100)

| No | Item Code | Work / Material Description | Quantity | Unit | Unit Price (Rp) | Extended Line Total (Rp) | Rate Reference |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| 1 | `CBL-SUPPLY-DISTRIBUTION` | Distribution fiber cable supply (incl. 10% slack allowance) | 6.567,74 | meter | Rp 5.000 | Rp 32.838.700 | Legacy illustrative rate |
| 2 | `CBL-SUPPLY-DROP` | Drop fiber cable supply (incl. 10% slack allowance) | 5.327,39 | meter | Rp 5.000 | Rp 26.636.950 | Legacy illustrative rate |
| 3 | `CBL-SUPPLY-FEEDER` | Feeder fiber cable supply (incl. 10% slack allowance) | 1.232,09 | meter | Rp 5.000 | Rp 6.160.450 | Legacy illustrative rate |
| 4 | `POLE-SUPPLY-PROPOSED` | Proposed pole supply | 4,00 | piece | Rp 850.000 | Rp 3.400.000 | Standard 7m/9m pole rate |
| 5 | `OLT-SUPPLY` | GPON OLT Chassis & SFP Optical Modules | 1,00 | unit | Rp 25.000.000 | Rp 25.000.000 | Carrier-grade OLT unit |
| 6 | `ODC-SUPPLY` | Optical Distribution Cabinet (ODC) Enclosure | 1,00 | unit | Rp 4.500.000 | Rp 4.500.000 | 288-core outdoor cabinet |
| 7 | `ODP-SUPPLY` | Optical Distribution Point (ODP) Box Enclosure | 14,00 | unit | Rp 350.000 | Rp 4.900.000 | 8/16-port pole enclosure |
| 8 | `SPL-SUPPLY` | Optical PLC Splitter Supply | 30,00 | piece | Rp 120.000 | Rp 3.600.000 | 1:8 PLC splitter module |
| 9 | `ONT-SUPPLY` | GPON ONT Subscriber Terminal Device | 110,00 | unit | Rp 250.000 | Rp 27.500.000 | GPON ONU terminal device |
| **—** | **Subtotal Material** | | | | | **Rp 134.536.100** | **Reconciled** |

### 2.2 Installation & Construction Schedule (Subtotal: Rp 118.654.150)

| No | Item Code | Work / Service Description | Quantity | Unit | Unit Price (Rp) | Extended Line Total (Rp) | Rate Reference |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| 1 | `CBL-INSTALL-DISTRIBUTION` | Distribution fiber cable installation | 6.567,74 | meter | Rp 7.500 | Rp 49.258.050 | Aerial pulling & lashing |
| 2 | `CBL-INSTALL-DROP` | Drop fiber cable installation | 5.327,39 | meter | Rp 7.500 | Rp 39.955.425 | Subscriber drop pulling |
| 3 | `CBL-INSTALL-FEEDER` | Feeder fiber cable installation | 1.232,09 | meter | Rp 7.500 | Rp 9.240.675 | Feeder corridor pulling |
| 4 | `POLE-INSTALL-PROPOSED` | Proposed pole installation | 4,00 | piece | Rp 350.000 | Rp 1.400.000 | Digging & foundation |
| 5 | `OLT-INSTALL` | OLT Central Office Rack Mount & Commissioning | 1,00 | unit | Rp 3.000.000 | Rp 3.000.000 | Central office integration |
| 6 | `ODC-INSTALL` | ODC Pad Foundation & Feeder Termination Splicing | 1,00 | unit | Rp 1.200.000 | Rp 1.200.000 | Civil pad & tray splicing |
| 7 | `ODP-INSTALL` | ODP Pole Mounting & Drop Cable Termination | 14,00 | unit | Rp 150.000 | Rp 2.100.000 | Pole bracket & splicing |
| 8 | `SPL-INSTALL` | Splitter Tray Installation & Fusion Splicing | 30,00 | piece | Rp 50.000 | Rp 1.500.000 | Precision fusion splicing |
| 9 | `ONT-INSTALL` | Customer Premise Drop Wire & ONT Installation | 110,00 | unit | Rp 100.000 | Rp 11.000.000 | Premise commissioning |
| **—** | **Subtotal Installation** | | | | | **Rp 118.654.150** | **Reconciled** |

---

## 3. Cable Quantity & Slack Allowance Audit

The backend calculates billed quantities using the formal engineering formula:
$$L_{\text{billed}} = L_{\text{physical}} \times (1 + \text{slack})$$
with a standard planning slack allowance of $\text{slack} = 10\% = 0.10$.

| Cable Category | Physical Route Length ($L_{\text{physical}}$) | Slack Allowance | Theoretical Billed Length | Rounded Billed Length | Backend Billed Length | Reconciliation Difference |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Feeder** | 1.120,08 m | 10% | $1.120,08 \times 1,10 = 1.232,088$ m | 1.232,09 m | 1.232,09 m | **0,00 m** |
| **Distribution** | 5.970,67 m | 10% | $5.970,67 \times 1,10 = 6.567,737$ m | 6.567,74 m | 6.567,74 m | **0,00 m** |
| **Drop** | 4.843,08 m | 10% | $4.843,08 \times 1,10 = 5.327,388$ m | 5.327,39 m | 5.327,39 m | **0,00 m** |
| **TOTAL** | **11.933,83 m** | **10%** | **13.127,213 m** | **13.127,21 m** | **13.127,21 m** | **0,00 m** |

---

## 4. Pole Cost Policy Verification

| Pole Status | Count | Cost Policy | Material Supply Line | Installation Labor Line | Audit Compliance |
| :--- | :---: | :--- | :---: | :---: | :---: |
| **Proposed** | 4 | Supply & Install | Included (`POLE-SUPPLY-PROPOSED`, Rp 3.400.000) | Included (`POLE-INSTALL-PROPOSED`, Rp 1.400.000) | **PASS** |
| **Existing** | 1 | Reused in-situ | Excluded (Rp 0) | Excluded (Rp 0) | **PASS** |
| **Shared** | 3 | Utility sharing | Excluded (Rp 0) | Excluded (Rp 0) | **PASS** |
| **Unverified** | 1 | Incomplete flag | Excluded from priced subtotal | Excluded from priced subtotal | **PASS** |
| **TOTAL** | **9** | Stable pole ID deduplication verified | | | **PASS** |

---

## 5. Subscriber Investment Metrics

- **Total Connected Subscribers**: 110 subscribers
- **Total CAPEX**: Rp 253.190.250
- **Cost per Connected Subscriber**:
  $$\text{CAPEX per Subscriber} = \frac{\text{Rp } 253.190.250}{110} = \text{Rp } 2.301.729,55$$
  - Rounded presentation: **Rp 2.301.730** per subscriber.
- This investment level represents a highly competitive rural/semi-urban FTTH greenfield deployment benchmark (< Rp 3.000.000 per home connected).

---

## 6. Audit Conclusion

All 18 priced line items reconcile strictly to the penny. The subtotal groupings (Material, Installation, Grand Total) exhibit 0,00 discrepancy across both backend calculations and the redesigned 10-page PDF document ([`ftth_rab_report_final.pdf`](file:///home/kenzojulian/Projects/project/anjaykanlek/ftth_rab_report_final.pdf)).
