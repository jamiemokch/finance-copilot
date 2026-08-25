---
name: Replit spreadsheet provider compatibility
description: Verified compatibility requirements for the privacy-safe spreadsheet semantic provider route.
---

Use the `gpt-5.4-mini` alias with strict `json_schema` only. Before managed Replit-route spreadsheet review, run a synthetic, non-importing compatibility gate; select the alias only after strict schema acceptance, JSON parsing, Zod validation, continuation identity, parser bounds, and a non-importing semantic plan all pass.

**Why:** The managed route supports the alias but rejects dated-model fallback and forbids `anyOf`, `enum`, and `const` at the schema root. A closed provider-only `{ response: ... }` envelope keeps the exact semantic union nested while server Zod remains authoritative. Any gate failure must leave review incomplete rather than fall back to object mode.

**How to apply:** Never use a dated spreadsheet model or `json_object` fallback on the managed route. Every new call and explicit retry starts from the verified alias strict policy; historical attempts remain immutable audit history only. Keep parser-bound validation, fencing, idempotency, provenance, and confirmation gates unchanged.

Managed Responses replies can expose a null top-level `output_text` while the strict JSON payload is carried in the first message's `output[].content[].text`. Normalize that fixed representation before strict parsing, but do not treat it as a looser response mode.

**Why:** A live protected review reached the managed alias successfully yet could not parse a payload until this Responses representation was supported.

**How to apply:** Keep extraction paths explicitly allowlisted in the data-free shape fingerprint and use the message-content representation only as a response-envelope adapter. The existing JSON, wire-envelope, Zod, continuation, parser-bounds, and semantic-plan validation gates remain mandatory.

Release verification uses two separate data-free managed-route gates: the safe abstain probe and a positive final-plan probe. The positive probe has a fixed two-row synthetic ledger and must validate a complete, parser-bounded plan before a release is accepted.