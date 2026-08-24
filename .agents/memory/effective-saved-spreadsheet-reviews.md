---
name: Effective saved spreadsheet reviews
description: How spreadsheet review mutations stay immediately consistent with saved named-column choices.
---

When a user saves a spreadsheet review decision, the response must include deterministic analysis of the uploaded workbook with those persisted mappings, selected sheets, and role choices applied. The client must use that returned analysis only after the save succeeds; a rejected save retains the previous local state and shows the structured correction guidance.

**Why:** The original inspection is intentionally immutable and AI-assisted. Continuing to derive readiness, incomplete rows, coverage, tax years, or confirmation eligibility from it after a saved mapping leaves stale blockers on screen and can incorrectly require a manual re-check.

**How to apply:** Re-run local parsing only; do not rerun AI for a review mutation. Preserve server confirmation validation as the final financial-write gate. If a mapping is incomplete or invalid, keep confirmation blocked and name the missing choice in plain language.

Saved-review confirmation must bind the normalized review, semantic plan identity, parsed source-content identity, and source object identity together. Compare equivalent nested choices canonically rather than with order-sensitive JSON serialization; a file replacement must reset any durable semantic lease/continuation before its next review.

**Why:** Semantically identical mappings can arrive with different object-key orders, while a replaced workbook must never reuse the prior source’s continuation or saved confirmation state.

**How to apply:** Treat the saved normalized draft as the confirmation authority, reject any value-level/source/plan mismatch, and allow only an explicit fresh review after replacement.