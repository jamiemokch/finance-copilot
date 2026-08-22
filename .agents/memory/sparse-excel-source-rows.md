---
name: Sparse Excel source rows
description: Safely retain source provenance for sparse workbooks without materializing virtual blank cells as records.
---

For Excel workbooks, treat rows with actual cells, row metadata, or merged cells as source rows. Keep the worksheet range for coordinate validation, but do not expand its entire rectangular extent into blank audit rows.

**Why:** A valid workbook can contain only a header and a final-row movement at Excel's maximum row number. Materializing every intermediate coordinate turns a small upload into an unbounded in-memory audit population.

**How to apply:** Preserve actual row numbers and source-row identity for sparse rows, including very large coordinates. CSV is different: physical blank records are meaningful parsed source rows and should remain explicit.