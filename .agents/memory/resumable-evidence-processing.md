---
name: Resumable evidence processing
description: Durable rule for safely recovering interrupted evidence uploads without duplicating records.
---

Use server-persisted evidence as the recovery source of truth. A recovery lease alone is insufficient: every claim needs an opaque token, and the worker must hold the evidence-row lock and still own that token before it writes a transaction, Inbox item, or terminal evidence state.

**Why:** A worker can outlive its lease. Without fencing, a recovery request can safely reclaim the evidence while the original worker later posts a competing financial outcome.

**How to apply:** Keep mapped imports resumable by their saved evidence ID and mapping. Renew the lease during long imports, check the token before each row-level outcome, block mapping changes during an active lease, and permit discard only when no current lease or linked outcome exists.

For original documents, keep extraction/review separate from the ledger: only an explicit, idempotent confirmation may create a financial transaction. Treat document lifecycle, review state, and evidence-to-transaction links as independent state; new document links must use the bridge relationship rather than legacy singular evidence fields.

**Why:** AI confidence and file identity are not financial authority. A file can support several records (or none), and lifecycle races must not silently reintroduce a detached or tombstoned relationship.

**How to apply:** Gate every workflow-2 document route that could create import outcomes, use active-lifecycle predicates under transaction locks, and use server-derived content hashes with database uniqueness for object/document reuse. Do not let hash reuse suppress a later, legitimate link.