---
name: Spreadsheet semantic execution epochs
description: Rules for retrying a spreadsheet semantic review without reusing its exhausted provider budget or mutable audit state.
---

An unchanged workbook keeps its stable semantic review and work identity, but every explicit automatic retry must create a fresh execution epoch with its own execution ID, continuation state, context history, provider-call budget, cache scope, claim token, and lease.

Provider-attempt audit ordinals remain globally monotonic for the stable review and each attempt is linked to the execution that made it. A retry must never mutate an older execution or reuse its provider budget. Every execution-local provider allowance, including repairs, is bounded by the remaining execution budget.

**Why:** Retaining a prior session's exhausted calls or broad content-only cache lets a retry either fail prematurely or appear successful without performing its own bounded provider work. Reusing or leaving an old execution active also permits ambiguous audit history and stale-worker writes.

**How to apply:** Fence every checkpoint and provider-attempt write by semantic session, work identity, execution ID, and claim token. Cache semantic results within an execution scope. Cap automatic retry epochs for the same source and move to manual recovery after the cap. On a source replacement, atomically terminalize any nonterminal old execution before clearing the parent binding and starting the new source execution.