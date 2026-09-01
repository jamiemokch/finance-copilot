# Finance Copilot — Development Rules

These rules replace the previous detailed control framework.

## 1. Backbone V1 first
Build and verify the simplest clean end-to-end Finance Copilot backbone before expanding features or chasing edge cases.

Backbone V1 is:

simple financial input (spreadsheet / bank / document)
→ AI understands and proposes a clean internal financial representation
→ user reviews and confirms
→ Financial Memory is updated
→ tax estimate, tax-return readiness, deadlines, reminders and useful business/tax suggestions refresh from Financial Memory
→ the user keeps adding documents/financial information through the year
→ Financial Memory and guidance keep updating
→ year-end output becomes a tax-return-ready annual pack.

Everything should support this backbone or stay out of the critical path.

Keep architecture, code, tests, state ownership and data flows clean so future development is easy. Do not over-engineer for hypothetical future requirements, but do not leave avoidable duplication, dead paths or confusing ownership behind when touching an area.

## 2. Use agent time and tokens sensibly
Agents should use the time/tokens genuinely needed to understand the relevant code, make a coherent change and test it properly.

Do not optimise for minimum tokens or artificially tiny tasks.
Do not waste tokens on repeated broad audits, progress checklists, unnecessary documentation, speculative architecture or endless debugging loops.

Rules must be neither so tight that agents cannot finish coherent work nor so loose that scope becomes uncontrolled.

## 3. Keep / Consolidate / Remove — always keep it simple
When working in an area, classify existing code and paths as:

- KEEP — clear, useful and part of the current/future backbone.
- CONSOLIDATE — duplicated or overlapping logic/state that should have one clear owner.
- REMOVE — dead, superseded, temporary, obsolete diagnostic/workaround or unnecessary complexity.

Prefer the simplest coherent design that preserves correctness and future extensibility.
Do not refactor unrelated code just to make it prettier.
Do not keep obsolete complexity merely because it already exists.

## 4. Controller must keep work moving
ChatGPT is the active project controller/product owner.
Claude is the primary repository implementation agent.
Replit is the runtime/UAT environment.

The controller should actively chase agents, review output, unblock delivery, make decisions and move to the next useful task. Do not leave an available agent or delivery lane idle when useful non-conflicting work can proceed.

Avoid making the repository owner act as an intermediary. Escalate only genuine product/business decisions, permissions or unavoidable access blockers.

## Working principles
- Prefer one meaningful end-to-end outcome over chains of micro-issues.
- Fix root causes where practical; do not repeatedly patch symptoms.
- Keep Financial Memory as the core financial source of truth. Workflow/session/AI execution state should support it, not compete with it.
- AI should make semantic judgements; deterministic application logic should own deterministic structure, validation and bookkeeping rules where practical.
- User confirmation remains the boundary before proposed financial records become confirmed Financial Memory.
- A complex edge case must not block Backbone V1 if the simple supported path works safely and the edge case can fail cleanly.
- Every meaningful change should leave the codebase at least as understandable and testable as before.

## Minimum safety boundaries
These are baseline engineering/data protections, not reasons to create process overhead:

- Never expose secrets, tokens, customer financial data or other sensitive information in logs, commits, issues or agent prompts.
- Never silently import or confirm financial records without the required user confirmation.
- Avoid destructive production data changes unless explicitly authorised.
- Avoid overlapping agents editing the same code at the same time.
- Application changes should remain reviewable and testable before being treated as complete.

## Definition of progress
Progress is measured primarily by how much of Backbone V1 is cleanly working end to end, not by issue count or number of fixes merged.

When deciding what to do next, ask:
1. Does this materially unblock or strengthen Backbone V1?
2. Does it simplify or clarify the code/data flow for future development?
3. Is there a cheaper/simpler way to reach the same reliable outcome?

If the answer to all three is no, it is probably not the next priority.
