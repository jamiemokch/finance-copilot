# Finance Copilot — Development Control Rules

These rules are mandatory for all Claude Code work in this repository unless the repository owner explicitly overrides them for a specific task.

## Roles
- ChatGPT is the Product Owner, Technical PM, controller, and reviewer.
- Claude Code is the single repository coding agent.
- Replit is runtime/hosting only unless explicitly authorised otherwise.
- Do not overlap code-writing work with another coding agent.

## Core operating model
1. Stabilise before adding features whenever core reliability is not Verified.
2. Understand → test → fix root cause → regression test → verify → next.
3. Never use guessing-based patch loops.
4. Prefer the smallest evidence-backed change.
5. Do not expand scope beyond the approved task.

## Bug control
- Maximum two implementation attempts on the same bug.
- After two unsuccessful implementation attempts, STOP coding.
- Switch to diagnostic-only root-cause analysis with concrete evidence before any further fix.

## Priority order
- P0: auth, session, routing, persistence
- P1: Financial Memory, data consistency, evidence linking
- P2: ingestion
- P3: AI/provider reliability
- P4: UX/polish

Do not prioritise P4 work while unresolved higher-priority foundation issues block the Golden Path.

## Required task contract
Every implementation task must explicitly state:
- WHY
- ROOT CAUSE — confirmed, probable, or not yet confirmed
- CHANGE
- WILL NOT CHANGE
- RISK / IMPACT
- TEST PLAN
- ROLLBACK
- DONE WHEN

If ROOT CAUSE is not confirmed, do not present a speculative fix as certain.

## Status language
Use only these delivery states:
- Built: code has been written.
- Tested: relevant automated tests pass.
- Verified: the relevant end-to-end / browser Golden Path passes with no known regression.

Only Verified counts as Done.

## Golden Path
The core sole-trader journey must remain the heartbeat regression path:
1. Create account / sign in
2. Complete onboarding
3. Reload and confirm persistence
4. Upload bank CSV and review resulting records
5. Upload receipt/document
6. AI review/categorisation where applicable
7. Explicit confirmation creates the correct Financial Memory record
8. Confirmed evidence disappears from the review queue
9. Upload spreadsheet and complete semantic review/import when in scope
10. Logout
11. Login again
12. Confirm business/profile/Financial Memory state persists and remains consistent

Meaningful changes must state which Golden Path steps are affected and how they were verified.

## Safety and scope
- No direct writes to `main`; work through a branch and pull request unless explicitly authorised.
- No production deployment from a coding task unless explicitly authorised.
- No production database or destructive data changes unless explicitly authorised.
- Never expose secrets, tokens, customer financial data, or sensitive runtime values in logs, commits, issues, or PRs.
- Do not silently change environment variables, dependencies, runtime configuration, schemas, or deployment settings.
- Keep rollback practical and explicit for implementation work.

## Diagnostic-only tasks
When a task says DIAGNOSTIC ONLY:
- Make no code changes.
- Make no refactors.
- Make no dependency/configuration changes.
- Do not deploy.
- Distinguish every material finding as CONFIRMED, PROBABLE, or UNKNOWN.
- Cite concrete repository evidence for confirmed findings.
- State exactly what runtime/log/browser evidence is missing for unknowns.

## Communication
The repository owner is non-technical. Final task reports must include a short plain-English explanation covering:
- what was found or changed
- why it matters
- what could be affected
- what was tested
- whether the result is Built, Tested, or Verified

Do not claim success beyond the evidence available.
