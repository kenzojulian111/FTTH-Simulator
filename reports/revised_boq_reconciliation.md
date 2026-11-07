# Revised Bill of Quantities (BoQ) & Financial Reconciliation Report
**Project ID:** `test-proj-calc-physical-20261031`  
**Project Display Name:** `kenjo punya`  
**Document Reference:** `RAB-FTTH-2026-001`  
**Document Status:** `Revised Preliminary Cost Estimate (Rev 1.2)`  
**Audit Scope:** 18 Master BoQ Line Items, Reconciled Splitter Quantities, Subtotals & Grand Total  
**Audit Date:** November 7, 2026  

---

## 1. Executive Summary & Recapitulation

Following the physical audit and deduplication of optical splitters (from 30 units down to 16 physical units), the Bill of Quantities and CAPEX figures have been recalculated strictly from source of truth without preserving historical arbitrary totals.

```
REVISED PRELIMINARY GRAND TOTAL CAPEX: Rp 250.810.250,00
├── Material Procurement Subtotal (9 items):     Rp 132.856.100,00  (52.97%)
└── Installation & Civil Subtotal (9 items):     Rp 117.954.150,00  (47.03%)
                                                 ─────────────────
                              Reconciled Sum:    Rp 250.810.250,00  (Exact Match · Variance Rp 0,00)
```

### Key Financial Metrics:
- **Planned Customers:** 110 units
- **Assigned ONTs:** 110 units (100% assignment)
- **Connected Customers:** 0 units (pre-activation planning phase)
- **Estimated CAPEX per Planned Customer:** **$\text{Rp } 2.280.093,18$** (previously $\text{Rp } 2.301.729,55$)
- **Cost per Connected Customer:** **N/A** (properly withheld pending commercial activation)
- **Variance from Previous RAB:** $-\text{Rp } 2.380.000,00$ ($-\text{Rp } 1.680.000$ Material, $-\text{Rp } 700.000$ Installation) due to removing 14 double-counted splitter units.

---

## 2. Reconciled 18 Master BoQ Line Items

All 18 line items stem from backend double-precision arithmetic and have been verified against the physical database entities:

| No | Item Code | Description | Quantity | Unit | Unit Rate (IDR) | Total Amount (IDR) | Category | Rate Status |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | `CBL-SUPPLY-DISTRIBUTION` | Distribution fiber cable supply (incl. 10% slack) | 6.567,74 | m | Rp 5.000 | Rp 32.838.700 | Material | Planning Estimate |
| 2 | `CBL-INSTALL-DISTRIBUTION` | Distribution fiber cable aerial installation | 6.567,74 | m | Rp 7.500 | Rp 49.258.050 | Installation | Planning Estimate |
| 3 | `CBL-SUPPLY-DROP` | Drop fiber cable supply (incl. 10% slack) | 5.327,39 | m | Rp 5.000 | Rp 26.636.950 | Material | Planning Estimate |
| 4 | `CBL-INSTALL-DROP` | Drop cable aerial installation & clamping | 5.327,39 | m | Rp 7.500 | Rp 39.955.425 | Installation | Planning Estimate |
| 5 | `CBL-SUPPLY-FEEDER` | Feeder fiber cable supply (incl. 10% slack) | 1.232,09 | m | Rp 5.000 | Rp 6.160.450 | Material | Planning Estimate |
| 6 | `CBL-INSTALL-FEEDER` | Feeder fiber cable aerial installation | 1.232,09 | m | Rp 7.500 | Rp 9.240.675 | Installation | Planning Estimate |
| 7 | `POLE-SUPPLY-PROPOSED` | Concrete Pole 7m Supply (Proposed Only) | 4,00 | piece | Rp 850.000 | Rp 3.400.000 | Material | Planning Estimate |
| 8 | `POLE-INSTALL-PROPOSED` | Concrete Pole 7m Civil Installation & Foundation | 4,00 | piece | Rp 350.000 | Rp 1.400.000 | Installation | Planning Estimate |
| 9 | `OLT-SUPPLY` | GPON OLT Chassis & SFP Optical Modules | 1,00 | unit | Rp 25.000.000 | Rp 25.000.000 | Material | Planning Estimate |
| 10 | `OLT-INSTALL` | OLT Rack Mounting & DC Power Commissioning | 1,00 | unit | Rp 3.000.000 | Rp 3.000.000 | Installation | Planning Estimate |
| 11 | `ODC-SUPPLY` | Outdoor ODC Cabinet 48-port | 1,00 | unit | Rp 4.500.000 | Rp 4.500.000 | Material | Planning Estimate |
| 12 | `ODC-INSTALL` | ODC Base Civil Pad, Grounding & Mount | 1,00 | unit | Rp 1.200.000 | Rp 1.200.000 | Installation | Planning Estimate |
| 13 | `ODP-SUPPLY` | Outdoor ODP Enclosure 8/16-port | 14,00 | unit | Rp 350.000 | Rp 4.900.000 | Material | Planning Estimate |
| 14 | `ODP-INSTALL` | ODP Pole Mounting, Bracket & Sealing | 14,00 | unit | Rp 150.000 | Rp 2.100.000 | Installation | Planning Estimate |
| 15 | `SPL-SUPPLY` | **Optical PLC Splitter (1:8) Supply** | **16,00** | **piece** | **Rp 120.000** | **Rp 1.920.000** | **Material** | **Planning Estimate** |
| 16 | `SPL-INSTALL` | **Splitter Splicing, Tray Mounting & Test** | **16,00** | **piece** | **Rp 50.000** | **Rp 800.000** | **Installation** | **Planning Estimate** |
| 17 | `ONT-SUPPLY` | GPON ONT Subscriber Terminal | 110,00 | unit | Rp 250.000 | Rp 27.500.000 | Material | Planning Estimate |
| 18 | `ONT-INSTALL` | ONT Activation, Indoor Drop & Patching | 110,00 | unit | Rp 100.000 | Rp 11.000.000 | Installation | Planning Estimate |

---

## 3. Financial Reconciliation Proof

$$\begin{aligned}
\text{Material Subtotal} &= \sum_{i \in \text{Material}} \text{Amount}_i = \text{Rp } 132.856.100,00 \\
\text{Installation Subtotal} &= \sum_{i \in \text{Installation}} \text{Amount}_i = \text{Rp } 117.954.150,00 \\
\text{Grand Total CAPEX} &= \text{Material} + \text{Installation} = \text{Rp } 250.810.250,00
\end{aligned}$$

- Variance between Backend Result and Line Items: **Rp 0,00 (100% Match)**.
- Variance between Frontend Display and Backend Engine: **Rp 0,00 (100% Match)**.

---

## 4. Rate Status & Legal Disclaimer

- **Pricing Confidence Status:** All 18 line items remain classified as **Planning Estimate**.
- **Document Status:** Explicitly designated **Revised Preliminary Cost Estimate (Rev 1.2)**.
- **Survey Disclaimer:** All figures are preliminary engineering estimates. Final construction contracting requires field walkout surveys and certified vendor quotations.
