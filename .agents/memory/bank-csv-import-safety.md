---
name: Bank CSV import safety model
description: Durable boundaries for importing bank CSV files into Financial Memory.
---

Bank CSV data must pass through a profile-owned staged batch before it can create
canonical ledger records. The canonical `transactions` ledger remains the only
financial source of truth; import batches and rows are provenance, preview,
duplicate, and idempotency metadata.

**Why:** A bank statement is evidence of movement, not proof of accounting
classification. Directly importing it as income or expenditure would silently
overstate profit or tax, and retrying a partially completed upload could
duplicate financial records.

**How to apply:** Keep imported movements as `unknown`/`unreviewed` until a
person explicitly classifies them. Filter unreviewed and voided movements out of
confirmed P&L and tax figures. Preserve immutable import snapshots; soft-void
imported records instead of deleting them. Same-file retry handling relies on
profile plus file hash, and commit processing requires a fenced lease token and
row-level provenance uniqueness.

**Verification:** Database-backed import safety tests must create a uniquely
named disposable database, apply the current schema only there, and force-drop
that database after the suite. The runner requires database create/drop
privileges and must never fall back to shared development tables.

**Why:** These tests deliberately exercise commits, leases, soft-voids, and
profile isolation. Running them against development data could create or remove
financial records during verification.