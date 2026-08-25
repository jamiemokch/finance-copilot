---
name: Spreadsheet semantic v3
description: The active new-review path uses one bounded direct semantic call and local all-row application.
---

New spreadsheet reviews must use the `spreadsheet-semantic.v3` contract, not the historical continuation/session protocol.

**Why:** Provider context must remain bounded and privacy-conscious while the deterministic parser retains full-row responsibility. This prevents a review from sending an entire workbook to a model or requiring automatic multi-call continuation.

**How to apply:** Send only workbook structure and a small representative sample, make exactly one direct Responses request with strict JSON, then validate its bounded mappings and apply them locally to the parsed workbook. Any provider, parsing, schema, or semantic-mapping failure stays incomplete and cannot create financial records until the separate confirmation gate succeeds. Keep v2 code only as rollback history; do not route new reviews to it.