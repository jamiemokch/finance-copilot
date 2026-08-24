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

An explicit financial confirmation must also set a terminal document review state and processed status; “reviewed” remains reserved for a saved candidate that still awaits financial confirmation.

**Why:** A review saved before confirmation and a completed financial record have different user actions available. Sharing the same state lets a reload reintroduce a finished document into review or resume queues.

**How to apply:** Whenever a confirmation creates or replays its transaction bridge, preserve the active link and return the terminal document state on evidence reloads. Queue and resume views must accept only pending or review-required states, not terminal ones.

Private bytes may be physically deduplicated only within the same authenticated user, while every business profile needs its own logical upload binding before it can register, resume, replace, link, or download evidence.

**Why:** An unguessable object path and same-user byte reuse are storage optimisations, not authorization. A path-only download or a user-only upload record can otherwise cross the selected business boundary.

**How to apply:** Create or verify the profile-to-upload binding at direct/presigned upload time, require it again at every evidence mutation, and serve evidence through the profile-and-evidence route rather than a path-only private-object URL.

Spreadsheet semantic analysis may resume only from a self-describing checkpoint: the persisted payload must contain the same continuation token as the durable session. An empty initialization payload is a new analysis, not a resumable overview.

**Why:** A fresh claimed session is already labelled `workbook_overview` but begins with an empty payload. Treating that placeholder as resumable omits the token the AI must echo, so a recovery/reclaim path can incorrectly turn an otherwise valid review into a malformed response.

**How to apply:** Build and checkpoint a full overview payload on a first attempt or reset. Resume provider work only after checking the payload’s continuation token, and scope any process-local in-flight promise to the durable claim token so a reclaimed worker does not inherit a stale worker’s result.