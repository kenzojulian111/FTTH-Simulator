# Test Execution & Verification Summary
**Project:** FTTH Simulator (`kenjo punya` / `test-proj-calc-physical-20261031`)  
**Execution Date:** November 7, 2026  
**Target Environments:** Backend (FastAPI, Python 3.14, Pytest), Frontend (React, TypeScript, Vitest)  

---

## 1. Summary of Test Results

| Test Suite | Framework / Runner | Total Tests | Passed | Failed | Skipped | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Backend Cost Calculation Suite** | Pytest (`test_cost_calculation.py`) | 15 | 15 | 0 | 0 | **PASSED** |
| **Backend Full Test Suite** | Pytest (`backend/tests`) | 219 | 219 | 0 | 0 | **PASSED** |
| **Frontend Report Component Suite** | Vitest (`reports.test.tsx`) | 22 | 22 | 0 | 0 | **PASSED** |
| **Frontend Full Test Suite** | Vitest (37 test files) | 220 | 220 | 0 | 0 | **PASSED** |
| **TypeScript Typecheck** | `tsc -b` | — | — | 0 errors | — | **PASSED** |
| **Production Build** | `npm run build` | — | — | 0 errors | — | **PASSED** |
| **PDF Compilation** | CDP Headless Brave | 2 PDFs | 2 | 0 | 0 | **PASSED** |

---

## 2. Backend Pytest Execution Details

### Command:
```bash
.venv/bin/pytest backend/tests/test_cost_calculation.py -v
```

### Key Verified Behaviors:
1. `test_splitter_deduplication_and_procurement_reconciliation`:
   - Validates that mounted splitter nodes and ODP/ODC component properties are not double-counted.
   - Validates that legacy disconnected splitters are excluded from required procurement.
   - Evaluates to exactly 4 splitters in the test fixture (2 feeder in ODC + 1 mounted in ODP 1 + 1 integrated in ODP 2), rejecting double counting.
2. `test_customer_semantics_planned_assigned_connected`:
   - Planned customers: 110
   - Assigned ONTs: 110
   - Connected customers: 0
   - Cost per planned customer: $\text{Rp } 2.280.093,18$
   - Cost per connected customer: `None`
3. `test_cable_quantity_slack_formula`: Verifies $L_{\text{billed}} = L_{\text{physical}} \times 1.10$.
4. Full regression: All 219 tests across backend domain, engine, persistence, and API passed.

---

## 3. Frontend Vitest Execution Details

### Command:
```bash
npx vitest run --run
```
- 37 test files passed.
- 220 total tests passed in 7.48s.

---

## 4. PDF Compilation & Integrity Test

### Execution Command:
```bash
node scripts/generate_pdf.cjs
```

### Output Summary:
- `ftth_engineering_report_final.pdf`:
  - Title: FTTH Network Engineering Report
  - Sections: 16 sections rendered
  - ONT Table Rows: 110 ONT subscriber lines rendered
  - File Size: 1.769.134 bytes, 31 Pages A4
- `ftth_rab_report_final.pdf`:
  - Title: Rencana Anggaran Biaya (RAB)
  - Sections: 16 sections rendered
  - Grand Total: `IDR 250,810,250`
  - File Size: 459.076 bytes, 12 Pages A4
