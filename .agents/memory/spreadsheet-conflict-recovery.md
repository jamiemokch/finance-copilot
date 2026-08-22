---
name: Spreadsheet conflict recovery
description: Safety rules for retrying or replacing a spreadsheet after a source-row identity conflict.
---

Workbook replacement is a recovery action only: allow it solely while that evidence item is in a failed import state, and retain its evidence identity. A confirmation that parses a workbook must atomically claim the same object identity before it can write rows.

**Why:** Replacing a completed workbook can make changed row positions evade per-evidence source-row uniqueness. Separately, a retry can otherwise parse old bytes just before replacement and write them into the replacement evidence record.

**How to apply:** When adding import recovery paths, reject replacement for completed or active imports. Bind the processing claim to the object path (or equally durable content identity) that was read, and retain the claim token checks through the write transaction.