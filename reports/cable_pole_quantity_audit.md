# Cable & Pole Quantity Engineering Audit
**Project ID:** `test-proj-calc-physical-20261031`  
**Project Display Name:** `kenjo punya`  
**Audit Scope:** Cable Categories, Physical vs Billed Lengths, Deployment Methods, Pole Status Breakdown  
**Audit Status:** Preliminary Engineering Audit (Pending Field Survey)  
**Audit Date:** November 7, 2026  

---

## 1. Cable Quantity & Slack Formula Audit

All cable segment measurements are calculated from candidate road centerline geometries (retrieved via OSRM from OpenStreetMap) and reconciled against database storage.

### Slack Allowance Formula:
$$L_{\text{billed}} = L_{\text{physical}} \times (1 + \text{slack})$$
Where standard engineering $\text{slack} = 0,10$ ($10\%$) is applied to cover sag, pole risers, coil slack (spare loops every 250m and at splice closures), and tray terminations.

### Table 1.1: Physical vs Billed Cable Quantity Reconciliation

| Cable Category | Segment Count | Physical Route Length ($L_{\text{physical}}$) | Slack Factor | Billed Length ($L_{\text{billed}}$) | Material Subtotal (IDR) | Installation Subtotal (IDR) | Total Subtotal (IDR) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Feeder Cable (24C)** | 1 | 1.120,08 m | 10% | 1.232,09 m | Rp 6.160.450 | Rp 9.240.675 | Rp 15.401.125 |
| **Distribution Cable (12C)** | 14 | 5.970,67 m | 10% | 6.567,74 m | Rp 32.838.700 | Rp 49.258.050 | Rp 82.096.750 |
| **Drop Cable (1C)** | 110 | 4.843,08 m | 10% | 5.327,39 m | Rp 26.636.950 | Rp 39.955.425 | Rp 66.592.375 |
| **Total Cable Network** | **125** | **11.933,83 m** | **10%** | **13.127,21 m** | **Rp 65.636.100** | **Rp 98.454.150** | **Rp 164.090.250** |

---

## 2. Cable Deployment Method Audit & The 307.48 m Unspecified Cables

Each cable segment is categorized by its planned deployment environment:

| Deployment Method | Physical Route Length (m) | Percentage of Total Route | Audit Determination & Survey Action Item |
| :--- | :---: | :---: | :--- |
| **Aerial (Kabel Udara)** | 11.626,35 m | 97,42% | Verified candidate aerial path along pole infrastructure. |
| **Unspecified / Pending Survey** | **307,48 m** | **2,58%** | **Audited 9 drop segments without definitive method tag:**<br>• Drop to Customer 27 (47.94 m)<br>• Drop to Customer 43 (10.26 m)<br>• Drop to Customer 44 (101.13 m)<br>• Drop to Customer 45 (52.61 m)<br>• Drop to Customer 46 (8.17 m)<br>• Drop to Customer 47 (2.18 m)<br>• Drop to Customer 48 (13.35 m)<br>• Drop to Customer 49 (30.39 m)<br>• Drop to Customer 50 (41.45 m)<br>**Audit Rule:** Kept strictly as *Unspecified* pending physical walkout survey. Not arbitrarily classified as aerial or underground without physical evidence. |
| **Total** | **11.933,83 m** | **100,00%** | Complete physical network span. |

---

## 3. Support Pole Infrastructure Audit

Poles provide physical suspension for aerial feeder, distribution, and drop spans. The database contains 9 pole records deduplicated by stable pole ID:

### Table 3.1: Pole Status, Ownership & CAPEX Policy

| Pole ID | Pole Name | Status | Role / Supported Cable | CAPEX Treatment | Unit Material Rate | Unit Install Rate | Total CAPEX Impact |
| :--- | :--- | :---: | :--- | :--- | :---: | :---: | :---: |
| `8f892ebd...` | Pole 1 | **existing** | Pre-installed operator pole | Excluded (Capitalized) | Rp 0 | Rp 0 | Rp 0 |
| `7c47ce87...` | Pole 2 | **shared** | Joint-use PLN pole | Excluded from CAPEX | Rp 0 | Rp 0 | Rp 0 |
| `4a32d8f1...` | Pole 3 | **shared** | Joint-use PLN pole | Excluded from CAPEX | Rp 0 | Rp 0 | Rp 0 |
| `1121b492...` | Pole 4 | **shared** | Joint-use PLN pole | Excluded from CAPEX | Rp 0 | Rp 0 | Rp 0 |
| `0b015029...` | Pole 5 | **unverified** | Pending structural audit | Excluded pending survey | Rp 0 | Rp 0 | Rp 0 |
| `87339e44...` | Proposed Pole C51-A | **proposed** | ODP-side support (Cable `7ea7...`) | **Billed 100%** | Rp 850.000 | Rp 350.000 | Rp 1.200.000 |
| `3dfe1e7c...` | Proposed Pole C51-B | **proposed** | Customer-frontage (Cable `7ea7...`) | **Billed 100%** | Rp 850.000 | Rp 350.000 | Rp 1.200.000 |
| `39fc81f9...` | Proposed Pole C52-A | **proposed** | ODP-side support (Cable `df25...`) | **Billed 100%** | Rp 850.000 | Rp 350.000 | Rp 1.200.000 |
| `f1e823eb...` | Proposed Pole C52-B | **proposed** | Customer-frontage (Cable `df25...`) | **Billed 100%** | Rp 850.000 | Rp 350.000 | Rp 1.200.000 |
| **Total** | **9 Poles Total** | — | — | **4 Billed / 5 Excluded** | — | — | **Rp 4.800.000** |

Only the 4 proposed new poles are charged to the project CAPEX.
