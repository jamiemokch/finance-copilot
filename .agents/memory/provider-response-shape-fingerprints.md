---
name: Provider response shape fingerprints
description: Privacy boundary for persisting SDK/provider response-envelope diagnostics during spreadsheet semantic review.
---

Provider response fingerprints must use fixed extraction paths and an explicit key allowlist. They may record JSON types and capped array lengths, but must never persist scalar values, unknown key names, semantic-object keys, raw response content, or provider identifiers.

**Why:** A malformed SDK envelope can prevent JSON parsing before contract diagnostics see any data. The fingerprint reveals which extraction representation was present without creating a new route for workbook or provider data to enter persisted telemetry.

**How to apply:** Keep the fingerprint attached only to the existing response-validation diagnostic path. Expand it only for new extraction paths, with an explicit allowlisted key and a regression that proves forbidden values and unknown key names are absent.