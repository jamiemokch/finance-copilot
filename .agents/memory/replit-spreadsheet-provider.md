---
name: Replit spreadsheet provider compatibility
description: Verified compatibility requirements for the privacy-safe spreadsheet semantic provider route.
---

Use the `gpt-5.4-mini` alias with strict `json_schema` only. Before managed Replit-route spreadsheet review, run a synthetic, non-importing compatibility gate; select the alias only after strict schema acceptance, JSON parsing, Zod validation, continuation identity, parser bounds, and a non-importing semantic plan all pass.

**Why:** The managed route supports the alias but rejects dated-model fallback and forbids `anyOf`, `enum`, and `const` at the schema root. A closed provider-only `{ response: ... }` envelope keeps the exact semantic union nested while server Zod remains authoritative. Any gate failure must leave review incomplete rather than fall back to object mode.

**How to apply:** Never use a dated spreadsheet model or `json_object` fallback on the managed route. Every new call and explicit retry starts from the verified alias strict policy; historical attempts remain immutable audit history only. Keep parser-bound validation, fencing, idempotency, provenance, and confirmation gates unchanged.