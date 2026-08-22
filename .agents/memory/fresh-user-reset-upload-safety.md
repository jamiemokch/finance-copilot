---
name: Fresh-user reset upload safety
description: Safety invariants for deleting a user's finance records and private uploads without leaving post-reset blobs.
---

A fresh-user reset must serialize with every route that creates private-upload ownership for that user. It must transactionally record cleanup intent before deleting ownership metadata, then delete physical objects only after commit. Direct-to-storage write capabilities that cannot be revoked must not be issued.

**Why:** A client upload can otherwise finish during reset, escape the cleanup snapshot, or write bytes after reset reports success. Deleting blobs before the database commit also risks deleting data that remains referenced if the transaction fails.

**How to apply:** When adding upload paths or reset-like deletion flows, share a durable per-user write gate with ownership registration, recheck profile ownership after acquiring it, and use an outbox/retry queue for physical deletion. Do not introduce signed direct-upload URLs unless their post-reset use can be prevented.