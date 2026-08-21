---
name: SME Finance Copilot architecture
description: Architecture decisions for the full-stack SME Finance Copilot — what is real vs mocked, data flow, and key conventions.
---

## Stack
- Frontend: React/Vite in artifacts/sme-finance-copilot (TypeScript, Tailwind, recharts, wouter)
- API server: Express in artifacts/api-server (TypeScript, Drizzle ORM, Postgres, pnpm esbuild)
- DB schema: lib/db/src/schema/app.ts
- Auth: Replit OIDC (session cookie, requireAuth middleware)

## Data flow (live since the backend rewrite)
1. User uploads evidence → POST /storage/uploads/direct (server-side GCS save)
2. POST /evidence/:id/process → AI extraction (GPT-4o-mini) with ExtractionContext
3. High-confidence (≥0.75) → auto-post transaction; low-confidence → Inbox item
4. User resolves Inbox → PATCH /inbox/:id/resolve → write ledger transaction
5. GET /position recomputes everything from transactions on demand (no stored P&L)

## Key backend decisions
- Finance arithmetic is server-side only (finance.ts); AI never calculates
- Non-deductible items ARE recorded in ledger (taxTreatment: non_deductible) for transparency
- Income items (high-confidence) auto-post as positive transactions
- Mixed-use: allowableAmount = amount × allowablePercentage/100 (stored alongside full amount)
- taxImpact on inbox resolution = computeTaxImpactDiff(profitBefore, profitAfter) — no flat %
- Business Ideas = forecast layer only (decision_memory table, never touches transactions)
- generateBusinessIdeasAI uses real GPT-4o-mini call via AI_INTEGRATIONS_OPENAI_BASE_URL

## Frontend store
- store.tsx: StoreProvider fetches all data, exposes derived types
### Financial Memory invariants
- Profile-scoped async data must remain bound to the selected profile.
  **Why:** Late responses from a previously selected profile can expose another business’s financial data in the current UI.
  **How to apply:** Any future profile-scoped operation must discard stale results after a profile switch.
- Explicit ledger classification is canonical; conventions such as an amount’s sign are legacy fallback only.
  **Why:** Bank or spreadsheet inputs can retain a positive cash value even when explicitly classified as an expense.
  **How to apply:** New ledger writers must persist the semantic type, and readers must prefer it whenever it exists.
- mapPLBreakdown: uses allowableAmount for deductible expenses (not raw amount)
- nonDeductibleExpenses: separate PLBreakdown array, shown in UI but excluded from profit
- monthlyTrend, vatWarning, taxLinesRaw, nonDeductibleTotal: all exposed from store

## API conventions
- zod (not zod/v4) for route validation
- Drizzle jsonb: pass JS objects directly, never JSON.stringify()
- OpenAI: prefers AI_INTEGRATIONS_OPENAI_BASE_URL, falls back to OPENAI_API_KEY

## Demo seed
- demo.ts: getDemoTransactions(), getDemoInboxItems(), getDemoSAChecklist()
- DEMO_PROFILE_DEFAULTS: has industry:'technology', cashAccounts, arEntries, apEntries
- demo route uses DEMO_PROFILE_DEFAULTS (renamed from DEMO_PROFILE_DATA)
- All demo transactions now include accountingCategory, allowablePercentage, allowableAmount

## Incomplete / outstanding
- Settings UI for industry + vatRegistered (backend PATCH endpoint exists, no frontend form)
- End-to-end test for inbox resolution → tax recalculation loop
- Mobile companion app (Expo) for on-the-go receipt capture
