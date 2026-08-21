---
name: SME Finance Copilot architecture
description: Core design decisions for the SME Copilot — frontend + backend, auth, store shape, routing
---

## What it is
Full-stack React/Vite + Express/PostgreSQL Alpha-lite for UK sole traders.
Frontend at `artifacts/sme-finance-copilot`, API server at `artifacts/api-server`.
Replit OIDC auth (cookie sessions). Real OpenAI (gpt-4o-mini). Demo data auto-seeded on first login.

## Route map
- `/` → Welcome (unauthenticated landing — "Sign in with Replit" button calls `login()` from store)
- `/dashboard` → Dashboard
- `/position` → Financial Position
- `/business-ideas` → Business Ideas
- `/tasks` → Tasks & Timeline (Inbox + Compliance)
- `/copilot` → Copilot
- `/settings` → Settings
- `/ingest` → Evidence upload (real GCS + GPT-4o-mini OCR)
- `/decisions`, `/tax`, `/year-end` → stub redirects

## Auth gate (App.tsx)
Uses wouter `<Redirect>` component (not `navigate()` calls during render — that causes setState-in-render).
- Not authenticated + private route → `<Redirect to="/" />`
- Authenticated + public route (/) → `<Redirect to="/dashboard" />`
- While `isLoading` → render null

## Store types (post-API migration)
`store.tsx` internal implementation swapped from localStorage to API calls.
Public interface unchanged: `useStore()` returns same shape as before.
Added: `isAuthenticated`, `isLoading`, `authUser`, `login` to AppState.

### Present
- `BusinessIdea`, `AssumptionField`, `DecisionMemoryEntry`, `SAChecklistItem`, `BenchmarkMetric`
- All benchmark data flagged `isIllustrative: true`

### Removed (do NOT use)
- `DecisionCard`, `TaxIdea`, `decisionCards`, `taxIdeas`, `yearEndReadiness`
- `updateDecisionCard`, `updateTaxIdeaStatus`

## API server build notes
- esbuild bundles to `dist/index.mjs`. Workspace packages (`@workspace/db`, `@workspace/api-zod`) are bundled inline.
- `zod` must be in api-server's direct `dependencies` (not just transitive). Import as `from "zod"` not `from "zod/v4"` — esbuild cannot resolve the `/v4` subpath export.
- `pdf-parse` and other node_modules are handled by esbuild's external fallback (not in explicit external list but resolved at runtime).

## Evidence upload flow (ingest.tsx)
Server-side upload (avoids browser→GCS CORS entirely):
1. `evidenceApi.uploadDirect(file)` → `POST /api/storage/uploads/direct` (octet-stream, 25MB limit) → `{ objectPath }`
2. `evidenceApi.register(profileId, { filename, objectPath, mimeType, category })` → DB record
3. `evidenceApi.process(profileId, evidenceId)` → GPT-4o-mini OCR + tax check → auto-tx or Inbox item

Key: `ObjectStorageService.saveContent(buffer, contentType)` uses GCS client `.save()` directly (no signed URL needed server-side). objectPath normalised as `/objects/uploads/{uuid}`. `getObjectEntityFile(objectPath)` maps back to same GCS path for read-back during extraction.

Verified end-to-end: PUT ✓, roundtrip ✓, AI extraction ✓, route 401-gated ✓ (not 404).

## DB notes
- `jsonb` columns in Drizzle: pass JavaScript objects/arrays directly — do NOT call `JSON.stringify()` before inserting. Drizzle serialises automatically; double-stringifying stores a JSON string literal not an object.

## Key architecture decisions
- Finance arithmetic is server-side only (`finance.ts`); AI interprets results, never calculates
- `GET /profiles/:id/position` computes everything from DB on demand — nothing stored as computed
- Confidence threshold 0.75: above + deductible → auto-create transaction; below → inbox item
- Demo auto-seeds on first login via `POST /demo/seed` (idempotent)

**Why:** TypeScript narrowing quirk — do not add `disabled={idea.status === 'actioned'}` inside a block already guarded by `idea.status !== 'actioned'`; the types have no overlap and TS2367 fires.
