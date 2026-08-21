---
name: SME Finance Copilot PM audit changes
description: Summary of all PM audit changes applied to the prototype — what was changed, key decisions, and current state
---

## Changes applied (all complete as of Aug 2026)

### Store (src/lib/store.tsx)
- `BusinessIdea` extended with `priorityTier` ('do_now'|'consider'|'watch'), `plImpactRange`, `cashImpactRange`, `taxImpactRange` (ImpactRange type), `paybackRange` (PaybackRange type), `urgencyNote`
- `DecisionMemoryEntry` extended with `actualOutcome?`, `actualPLImpact?`, `actualCashImpact?`, `actualTaxImpact?`
- `updateDecisionMemoryOutcome` added to AppState and StoreProvider
- `initialBusinessIdeas` reordered by priority: bi2 (do_now, chase AR), bi4 (do_now, WFH allowance), bi3 (do_now, AIA purchase), bi5 (consider, accelerate equipment), bi1 (watch, hire)
- bi1 `currentRevenue` in `computeScenario` fixed: 36500 → 39800

### layout.tsx
- Copilot removed from primary navItems (now only floating button)
- Profile switcher block added between logo and nav: shows all profiles, highlights active, supports switching
- FloatingCopilot remains at bottom-right; hint text added in sidebar footer

### ingest.tsx (Evidence page)
- FlowDiagram accepts `pendingCount` prop; shows orange badge on Inbox node when >0
- UploadCard replaced with multi-step AI animation: uploading → reading → identifying → checking → categorising → done
- Step progress bar shows 5 segments; result shows "Categorised automatically" or "Sent to Inbox"

### business-ideas.tsx
- `DecisionMemoryCard` sub-component added (status management, actual outcome input, status change buttons)
- `TIER_CONFIG` and `ImpactPill` helpers added
- IdeaCard summary row: shows priority tier badge, category badge, quantified impact pills (tax saving, cash range, payback), urgencyNote for do_now/deadline ideas
- Main page ideas list: grouped into Do now / Consider / Watch sections with explanatory subtitles
- Decision Memory section: always visible; committed pipeline forecast card (total P&L/cash/tax across live decisions); `DecisionMemoryCard` for each entry

### dashboard.tsx
- `previewIdeas` filtered to `do_now` tier only (up to 3), with urgencyNote and impact pills shown
- Tax reserve gap card added: £6,900 balance due − £3,500 reserve = £3,400 gap, with Axiom AR callout
- `taxBalanceDue`, `taxReserve`, `taxReserveGap` constants defined from canonical figures

### tasks.tsx
- TabId: 'action'|'deadlines'|'yearend' → 'todo'|'timeline'
- Tabs: "Action Needed" + "Deadlines" + "Year-End" → "To Do" + "Timeline"
- Timeline tab renders ComplianceTab + YearEndTab as merged sections

**Why:**
All changes agreed by user in PM audit ("agree all please go ahead and amend"). The goal is a cleaner, more decision-oriented prototype that ties all numbers to canonical figures and makes priority obvious.

**How to apply:**
- All canonical figures are in `sme-copilot-figures.md`
- Never invent new numbers — always trace back to the canonical set
- Priority tier grouping in BI page is the main navigation pattern for ideas; don't flatten back to a list
