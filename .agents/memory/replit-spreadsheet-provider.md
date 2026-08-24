---
name: Replit spreadsheet provider compatibility
description: Verified compatibility requirements for the privacy-safe spreadsheet semantic provider route.
---

Use `gpt-5.4-mini` with strict `json_schema` as the primary configuration for the Replit AI Integrations route. The route was verified with a bounded non-sensitive semantic probe and accepts both the model and structured-output mode.

**Why:** The spreadsheet protocol depends on a strict, server-validated semantic contract; broad fallbacks would conceal provider configuration failures or weaken the provenance guarantees.

**How to apply:** Preserve strict server-side Zod and semantic-plan validation. A `json_object` request is only an operational fallback after the provider explicitly reports that structured output is incompatible; it is not a replacement semantic path.