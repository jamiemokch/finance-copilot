---
name: SME Finance Copilot architecture
description: Core design decisions for the frontend prototype — store shape, routing, page structure, and what types exist/don't exist
---

## What it is
Frontend-only React/Vite prototype for UK sole traders / landlords / micro limited companies.
No backend, no real AI, all fictional data. Local state via `StoreProvider` (`src/lib/store.tsx`).

## Route map
- `/` → Onboarding (landing)
- `/dashboard` → Dashboard
- `/position` → Financial Position (Finances)
- `/business-ideas` → Business Ideas (merged Decisions + Tax Ideas)
- `/tasks` → Tasks & Timeline (merged Inbox + Compliance + Year-End)
- `/copilot` → Copilot history/search
- `/settings` → Settings/Profile
- `/ingest` → Upload records
- `/decisions`, `/tax`, `/year-end` → stub files (route in App.tsx redirects to new pages)

## Store types (current — post-restructure)
### Present
- `BusinessIdea` — replaces old `DecisionCard` + `TaxIdea`; has `editableAssumptions: AssumptionField[]`, `status: 'new'|'saved'|'actioned'|'dismissed'`, `category: BusinessIdeaCategory`
- `AssumptionField` — name, label, value, unit, min, max, step
- `DecisionMemoryEntry` — committed decisions with expectedPLImpact/cashImpact/taxImpact
- `SAChecklistItem` — year-end readiness checklist
- `BenchmarkMetric` — expanded with sourceFull, peerDefinition, sampleSize, isIllustrative
- All benchmark data flagged `isIllustrative: true`

### Removed (do NOT use — will cause TS errors)
- `DecisionCard`, `TaxIdea` — deleted from store
- `decisionCards`, `taxIdeas`, `yearEndReadiness` — removed from AppState
- `updateDecisionCard`, `updateTaxIdeaStatus` — removed actions

## Key architecture decisions
- Scenario computation is a pure function `computeScenario(ideaId, assumptions)` in `business-ideas.tsx` — reruns on every assumption change, not stored in state
- Committing a decision writes to `decisionMemory[]`; Financial Position reads this to show forecast impact
- `copilot.tsx` labels all system messages with a "Demo" badge; floating copilot in layout.tsx also labels "Demo response"
- Nav badges: Business Ideas shows count of new/saved ideas; Tasks shows pending inbox items

**Why:** TypeScript narrowing quirk — do not add `disabled={idea.status === 'actioned'}` inside a block already guarded by `idea.status !== 'actioned'`; the types have no overlap and TS2367 fires.
