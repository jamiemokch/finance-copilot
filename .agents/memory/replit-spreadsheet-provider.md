---
name: Replit spreadsheet provider compatibility
description: Verified compatibility requirements for the privacy-safe spreadsheet semantic provider route.
---

Use strict `json_schema` for Spreadsheet AI v2. Start with the `gpt-5.4-mini` alias, but after an explicit strict-format compatibility rejection resolve to `gpt-5.4-mini-2026-03-17` before considering the narrow object-mode fallback.

**Why:** The managed Replit route can reject the floating alias for strict structured output even though the dated model accepts the same contract. The spreadsheet protocol still depends on strict, server-validated semantics; broad fallbacks would conceal configuration failures or weaken provenance guarantees.

**How to apply:** Preserve strict server-side Zod and semantic-plan validation. A `json_object` request is only an operational fallback after explicit strict-format compatibility failures for both alias and dated strict attempts; it is not a replacement semantic path. Preserve the working model and response mode through bounded contract repair and durable retries.