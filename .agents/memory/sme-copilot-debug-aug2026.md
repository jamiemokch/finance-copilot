---
name: SME Finance Copilot debug findings (Aug 2026)
description: Root causes and fixes from the full-app sanity check and two reported bugs
---

## Bug 1: Business Ideas page — ideas and Decision Memory not visible

**Root cause:** `PeerBenchmarkSection` defaulted to `isCollapsed = false` (fully expanded). The benchmark grid fills the entire 720px viewport, pushing the ideas list and Decision Memory section below the fold. Users see only benchmarks and assume nothing else is there.

**Fix:** Changed `useState(false)` → `useState(true)` in `PeerBenchmarkSection`. Section starts collapsed, showing just a header row; ideas appear immediately on page load.

## Bug 2: Resolve inbox item does not update financial state

**Root cause (multi-layer):**
1. `plBreakdown` and `taxCalculation` were static constants passed directly into the store value object — NOT from `useState`. They could never change at runtime.
2. `positionItems` used `const [positionItems] = useState(...)` — no setter, structurally immutable.
3. `resolveInboxItem` only set `status: 'resolved'` on the inbox item — zero financial effect.
4. Dashboard `taxBalanceDue = 6900` and `taxReserve = 3500` were hardcoded local constants, not read from store state.
5. `PLExpense` had no `inboxItemId` field, so pending expenses couldn't be linked to the inbox item that created them.

**Fix:**
- Added `inboxItemId?: string` to `PLExpense` interface; set on both pending expenses in `initialPLBreakdown`
- Added `computeTaxFromProfit(tradingProfit)` pure function (UK 2023/24 tax rules) and `classifyResolution(res)` helper to store
- Changed `plBreakdown` and `taxCalculation` to `useState` in `StoreProvider`
- Changed `positionItems` to have a setter (`const [positionItems, setPositionItems]`)
- Enhanced `resolveInboxItem` to: classify resolution → move pending→confirmed expense → recalculate profit → recalculate tax → update positionItems KPIs (kpi1 P&L, kpi2 Estimated Tax) → auto-mark SA checklist sa3 done when all inbox items resolved
- Changed `plBreakdown:` and `taxCalculation:` in store `value` object to use the reactive state variables
- Fixed dashboard to read `taxBalanceDue = taxKpi?.rawValue ?? 6900` and `taxReserve = cashBreakdown.taxReserve` from store

## Other bugs found (pre-sprint)

- `complianceItems`, `arEntries`, `apEntries` are passed as direct constant references (no `useState`) — immutable. Low priority for prototype.
- `computeScenario()` in business-ideas.tsx uses hardcoded revenue (39800) not derived from store. Acceptable since revenue doesn't change on inbox resolve; only expenses change.

## Pre-Alpha sprint fixes (Aug 2026)

- **position.tsx**: Available Cash drilldown was missing `cashBreakdown.apDueWithin30Days` (£250) from `netAvailable` calc — showed £6,340 not £6,090. Fixed by subtracting AP; now shows both "Tax Reserve" and "AP due within 30 days" in the Ringfenced card.
- **layout.tsx**: Added two-click Reset demo button to amber banner (first click shows "Confirm reset?", 4s auto-cancel). Rewrote FloatingCopilot responses to be context-aware — pulls live store values (taxDue, profit, cash, AR, gap) so Copilot answers reference real numbers.
- **ingest.tsx**: Added `useRef` + hidden `<input type="file">` to each UploadCard so the browser file-picker opens on button click. Captures real filename and shows it during processing and in the done state. "Resolve in Inbox" button now navigates to `/tasks`. Manual entry has inline validation (required description, valid non-zero number amount).
- **tasks.tsx**: Empty pending state now shows a full golden-journey CTA (emerald panel) with two buttons ("View updated Home →" and "View updated Finances →") only when resolvedItems.length > 0; falls back to the old "all caught up" panel when no items have ever been resolved.

## Source of truth after fix

After fix: `plBreakdown`, `taxCalculation`, `positionItems` all reactive. All pages reading from `useStore()` automatically update when inbox items are resolved. Dashboard KPIs (Cash, P&L, Tax, AR, AP), Finances drilldown, Business Ideas, and SA checklist all share the same single store.

**Why these bugs existed:** `plBreakdown`, `taxCalculation` were written as static data objects for the initial prototype and the useState migration was never done. The resolve action was scaffolded as a UI-only state change with intent to add financial logic later.
