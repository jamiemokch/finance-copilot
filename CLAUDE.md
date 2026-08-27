# Finance Copilot — Development Control Rules

These rules are mandatory for all Claude Code work in this repository unless the repository owner explicitly overrides them for a specific task.

## Roles
- ChatGPT is the Product Owner, Technical PM, controller, acceptance reviewer, and merge controller.
- Claude Code is the single repository coding agent and owns implementation decomposition inside an approved controller item.
- Replit is runtime/hosting/UAT only unless explicitly authorised otherwise. Replit must not independently write application code.
- Do not overlap code-writing work with another coding agent.

## Primary optimisation target
1. Optimise for low-rework delivery, not minimum turns, minimum tokens, or artificially tiny diffs.
2. Engineering cost/time is acceptable when it improves first-time-right architecture, implementation quality, regression coverage, observability, or Golden Path confidence.
3. Avoid spend that produces rebuild/debug loops caused by an incomplete controller contract, misunderstood architecture, duplicated implementation, or premature runtime patching.
4. Every meaningful implementation cycle should leave durable value: reliable code, regression tests, architecture knowledge, observability, or verified Golden Path confidence.
5. Never use guessing-based patch loops.

## Core operating model
1. Stabilise before adding features whenever core reliability is not Verified.
2. Controller defines the meaningful outcome, constraints, acceptance criteria, risk boundaries, and prohibited surfaces.
3. Claude inspects the relevant repository surfaces, identifies dependencies, decomposes the work internally, implements the coherent solution, tests it, commits/pushes it, and reports all deliverables in one implementation log.
4. Controller reviews the complete delivered diff, tests, architecture fit, regression risk, privacy/data risk, and acceptance criteria before merge.
5. Merge only after controller review. Runtime UAT follows merge where required.
6. Understand → implement root-cause-correct solution → regression test → controller review → runtime verify → next.

## Task boundary and decomposition
- Prefer one meaningful, bounded outcome over many micro-issues.
- Use the smallest coherent vertical slice that can fully satisfy the outcome; do not split work by individual field, error code, helper, or file unless that split is independently valuable and testable.
- Claude owns internal implementation decomposition. The controller should not feed implementation one tiny step at a time.
- Controller task contracts should name expected files when useful, but avoid rigid allowlists that prevent necessary dependencies. Use hard prohibited surfaces for genuinely high-risk areas instead.
- If Claude must touch an unexpected but directly required dependency, it may do so within the approved outcome and must explain the reason in its delivery report. High-risk surfaces remain prohibited unless explicitly authorised.
- Do not expand product/business scope beyond the approved outcome.

## Attempt / debugging guardrail
- The historical two-attempt rule is a guardrail against repeating the same failed hypothesis, not a mechanical quota.
- If an implementation attempt makes evidence-backed progress and only a direct, bounded correction remains, the controller may continue that coherent implementation without creating artificial micro-tasks.
- If two attempts substantially repeat the same failing approach, or the root cause remains unproven, STOP repeating that approach and switch to diagnostic-only root-cause analysis before further coding.
- Diagnostic work should repair the implementation understanding or controller contract, then return to one coherent implementation item; do not create a chain of one-field successor issues unless independently justified.

## Priority order
- P0: auth, session, routing, persistence
- P1: Financial Memory, data consistency, evidence linking
- P2: ingestion
- P3: AI/provider reliability
- P4: UX/polish

Do not prioritise P4 work while unresolved higher-priority foundation issues block the Golden Path.

## Required controller task contract
Every implementation item must explicitly state:
- WHY / user or reliability outcome
- ROOT CAUSE — confirmed, probable, or not yet confirmed
- ACCEPTANCE CRITERIA / DONE WHEN
- IMPORTANT CONSTRAINTS and PROHIBITED SURFACES
- RISK / IMPACT
- TEST PLAN, including relevant regression coverage
- ROLLBACK
- GOLDEN PATH impact

Expected files or likely seams may be listed for orientation, but they are not automatically hard allowlists.

If ROOT CAUSE is not confirmed, do not present a speculative fix as certain. Spend diagnostic effort first when uncertainty is material to architecture or likely to cause rework.

## Implementation delivery contract
A Claude implementation attempt should normally complete the whole bounded item:
- inspect relevant dependencies
- make the coherent implementation
- add/update focused regression tests
- run required tests
- commit and push all intended changes
- report commit SHA, changed files, tests/results, deviations from expected files, remaining unknowns, and Built/Tested status

Do not spend turns producing progress checklists when those turns are needed to finish the implementation. Internal decomposition is Claude's responsibility.

## Controller review contract
Before merge, ChatGPT must review the delivered work as one package:
- actual changed files and diff
- whether the implementation satisfies the outcome rather than merely passing tests
- architecture fit and unnecessary duplication
- scope creep and unexpected dependencies
- privacy/data/security implications
- relevant automated tests and regression coverage
- rollback practicality
- Golden Path impact

CI success alone is never Verified.

## Status language
Use only these delivery states:
- Built: code has been written and delivered to the implementation branch.
- Tested: relevant automated tests pass.
- Verified: the relevant end-to-end / browser/runtime Golden Path passes with no known regression.

Only Verified counts as Done where runtime verification is required.

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

## Safety and high-risk surfaces
- No direct writes to `main`; work through a branch and pull request unless explicitly authorised.
- No production deployment from a coding task unless explicitly authorised.
- No production database or destructive data changes unless explicitly authorised.
- Never expose secrets, tokens, customer financial data, or sensitive runtime values in logs, commits, issues, or PRs.
- Do not silently change environment variables, dependencies, runtime configuration, schemas, migrations, auth/session design, deployment settings, or workflow permissions. Treat these as high-risk surfaces requiring explicit controller awareness/authorisation.
- Keep rollback practical and explicit for implementation work.
- Replit remains runtime-only and must not make overlapping application-code fixes. Runtime findings return to the GitHub/Claude implementation loop.

## Diagnostic-only tasks
When a task says DIAGNOSTIC ONLY:
- Make no code changes.
- Make no refactors.
- Make no dependency/configuration changes.
- Do not deploy.
- Distinguish every material finding as CONFIRMED, PROBABLE, or UNKNOWN.
- Cite concrete repository evidence for confirmed findings.
- State exactly what runtime/log/browser evidence is missing for unknowns.
- Produce the smallest coherent next implementation contract that resolves the root cause; do not default to micro-task decomposition.

## Communication
The repository owner is non-technical. Final task reports must include a short plain-English explanation covering:
- what was found or changed
- why it matters
- what could be affected
- what was tested
- whether the result is Built, Tested, or Verified

Do not claim success beyond the evidence available.
