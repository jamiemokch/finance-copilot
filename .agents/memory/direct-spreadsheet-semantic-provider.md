---
name: Direct spreadsheet semantic provider
description: Durable routing and safety boundary for spreadsheet semantic interpretation.
---

Spreadsheet semantic interpretation must select the dedicated direct OpenAI Responses provider explicitly. It must not inherit the managed AI-integration route, credentials, model routing, retries, schema fallback, contract repair, or Chat Completions behavior used by general assistant features.

**Why:** The managed structured-output route returned completed-looking envelopes without a usable semantic JSON document. Silent repair or failover risks hidden extra provider work and can undermine the protected review-before-confirmation workflow.

**How to apply:** Keep direct spreadsheet requests on the fixed current model with native `input_text`, strict versioned JSON Schema, and zero SDK/application retries. Any provider or contract failure returns a safe unavailable/incomplete review. Continue to preserve parser, wire-envelope, Zod, bounded-context, semantic-plan, and explicit-confirmation gates before financial writes. Local loopback tests may use an explicit test-only direct base URL; production uses the official direct endpoint.