---
name: AI-first spreadsheet semantics
description: The boundary between deterministic spreadsheet safety and AI-owned semantic interpretation.
---

Workbook parsing, provenance, redaction, bounds checks, duplicate protection, tax-year derivation, confirmation gating, and financial writes remain deterministic. In the normal import path, AI owns worksheet purpose, field meanings, row inclusion/exclusion, transaction semantics, overlaps, and final worksheet disposition through a versioned validated plan.

**Why:** A locally inferred fallback can look like a completed financial interpretation while silently misreading an unfamiliar, multilingual, or reporting worksheet.

**How to apply:** Send the complete structural inventory first, accept only schema-valid bounded follow-up requests and all-sheet plans, and treat provider failure, malformed output, abstention, or exhausted limits as explicitly non-importable. A user may provide targeted manual recovery choices, but no financial record may be created before explicit confirmation.