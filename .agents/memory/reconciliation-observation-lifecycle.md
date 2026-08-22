---
name: Reconciliation observation lifecycle
description: How deterministic reconciliation scans preserve resolved review state without hiding returning facts.
---

When a reconciliation resolution leaves the observed fact unchanged (for example, confirming a declared empty coverage period), keep that exact current observation resolved across repeated scans. Reopen it only after a scan has retired it because the triggering condition disappeared and a later scan finds it again.

**Why:** Treating every already-resolved observation as a new open item made coverage confirmation appear to save successfully but immediately reintroduced the same review card on refresh.

**How to apply:** The materializer must distinguish a current, resolved revision from a historical/non-current revision. Source-mutating resolutions naturally become non-current when their detector condition disappears, so they can reopen if the same condition later returns. Dismissals remain scoped to their exact revision.