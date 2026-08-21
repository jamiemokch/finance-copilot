---
name: SME Finance Copilot idempotency
description: Durable rules for preserving one financial effect per user action across retries and concurrent requests.
---

Every financial write needs a stable identity that survives a lost response, and every terminal source status must commit atomically with its ledger or Inbox outcome.

**Why:** UI-only in-flight guards stop double-clicks but cannot distinguish a server commit followed by a lost response from a failed request. Retrying without the same source identity can create a second financial fact and change totals twice.

**How to apply:** Reuse the same source-row/evidence/manual-action identity on retries; have the server return the existing persisted outcome for that identity. Keep ledger writes and their corresponding terminal source state in one database transaction. Treat database uniqueness races as successful replays when the stored payload belongs to the same authenticated profile.