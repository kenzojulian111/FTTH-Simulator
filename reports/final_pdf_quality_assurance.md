# Final PDF Quality Assurance Report
**Project ID:** `test-proj-calc-physical-20261031`  
**Project Display Name:** `kenjo punya`  
**Audited Artifacts:**
1. `ftth_rab_report_final.pdf` (Rencana Anggaran Biaya & Master BoQ)
2. `ftth_engineering_report_final.pdf` (Detailed Optical Budget & Network Engineering)  
**Inspection Date:** November 7, 2026  
**Tooling:** Headless Brave Browser (CDP), `pdfinfo`, `pdftotext`, `pdftoppm`  

---

## 1. Document Metrics & Technical Characteristics

| Parameter | `ftth_rab_report_final.pdf` | `ftth_engineering_report_final.pdf` |
| :--- | :---: | :---: |
| **Page Count** | 12 Pages | 31 Pages |
| **Page Format** | Standard A4 Portrait (594.96 × 841.92 pts) | Standard A4 Portrait (594.96 × 841.92 pts) |
| **File Size** | 459.076 bytes | 1.769.134 bytes |
| **Tagged PDF** | Yes (`Tagged: yes`, accessible PDF structure) | Yes (`Tagged: yes`, accessible PDF structure) |
| **PDF Version** | 1.4 | 1.4 |
| **Visual Theme** | Traditional Engineering Consultant Aesthetic (Navy / Slate / Crisp White) | Traditional Engineering Consultant Aesthetic (Navy / Slate / Crisp White) |
| **Reconciled Grand Total** | **IDR 250,810,250** | — |
| **Material Subtotal** | **IDR 132,856,100** | — |
| **Installation Subtotal** | **IDR 117,954,150** | — |
| **CAPEX / Planned Customer** | **IDR 2,280,093.18** | — |
| **Splitter Procurement Count** | **16 units** (0 variance) | 16 active units |
| **Customer Schedule** | Reconciled Table 3.1 (110 Planned / 110 Assigned / 0 Connected) | Complete 110-Customer Optical Loss & Headroom Schedule |

---

## 2. Visual & Structural QA Checklist

### A. Document Control & Typography
- [x] **Clean Engineering Typography:** Set in clean system sans-serif font stack with crisp hierarchy (H1, H2, H3, table captions, footnote disclaimers).
- [x] **Restrained Color Palette:** Strict telecommunication engineering consultant styling: deep navy `#0f2744` for primary accents/headers, slate gray `#334155` for body text, light cool-gray `#f8fafc` for alternating table rows.
- [x] **No AI Clutter / Gimmicks:** Completely free from glassmorphism, background gradients, neon badges, rounded cards, oversized KPI icons, or floating boxes.
- [x] **Document Control Block:** Present on Cover Page featuring:
  - Document Reference: `RAB-FTTH-2026-001`
  - Document Status: `Revised Preliminary Cost Estimate (Rev 1.2)`
  - Currency: `IDR (Rp)`
  - Calculation Timestamp: Localized timestamp rendered in Indonesian locale.

### B. Table Formatting & Pagination
- [x] **Running Headers & Footers:** Formal print headers on every page (`RENCANA ANGGARAN BIAYA (RAB) · BILL OF QUANTITIES · kenjo punya · REVISED PRELIMINARY COST ESTIMATE`), with running document footers.
- [x] **Table Header Repeat:** Table header rows (`thead`) repeat cleanly across page breaks using CSS `break-inside: avoid` and print table rules.
- [x] **Numeric Alignment:** All currency figures and physical/billed lengths are right-aligned with standardized comma/period formatting.
- [x] **Zero Arithmetic Discrepancy:** Sum of 9 material items equals `IDR 132,856,100`; sum of 9 installation items equals `IDR 117,954,150`; sum equals Grand Total `IDR 250,810,250` (0,00 discrepancy).

### C. Hygiene & Information Disclosure
- [x] **No Raw Warning Logs:** Suppressed all internal backend warning strings such as `ROUTE_FIELD_VERIFICATION_REQUIRED` from visible user-facing text.
- [x] **No UUID Clutter:** Node and cable IDs are presented in shortened, human-readable format or descriptive functional labels (`ODC 1`, `ODP 01`–`14`, `Cable 6`).
- [x] **Clear Preliminary Disclaimers:** Explicitly marked as a *Revised Preliminary Cost Estimate*. The non-binding nature of the unit rates, necessity of field walkout surveys, and pending commercial vendor quotations are prominently stated in Section 01, Section 14, Section 15, and Section 16.

---

## 3. QA Determination

Both `ftth_rab_report_final.pdf` and `ftth_engineering_report_final.pdf` meet telecommunications consultant grade quality. Document status is explicitly maintained as **Preliminary / Pending Field Survey Verification**.
