---
name: SME Finance Copilot architecture
description: Key decisions and patterns for the sme-finance-copilot artifact
---

## Architecture
- Artifact: artifacts/sme-finance-copilot (React + Vite, TypeScript strict)
- State: single StoreProvider in lib/store.tsx — all data is local state, no backend
- Routing: wouter, base path from import.meta.env.BASE_URL
- UI: custom component library at @/components/ui (Card, Badge, Button, Input, Label, etc.)
- TypeScript: strict mode — always annotate .map() / .reduce() callback params explicitly
- Badge variants available: default, secondary, outline, destructive — no 'warning' or 'success' variants

## Pages & routes
- /dashboard — cash-first KPIs, deadline, 2 decision card previews
- /position — clickable KPIs with full drilldowns (P&L, tax calc, AR, AP, cash)
- /inbox — guided AI resolution with sub-options
- /copilot — chat history + split view
- /tax — tax idea cards with status actions
- /decisions — peer benchmarks + decision cards with full scenario comparison
- /compliance — chronological compliance timeline
- /year-end — checklist + locked Build Pack action
- /settings — multi-profile switcher, shared context editor
- FloatingCopilot in layout.tsx — driven by copilotTrigger state in store (cross-component)

## Key store patterns
- copilotTrigger / setCopilotTrigger: used by Decision Cards to pre-fill the floating Copilot chat
- All drilldown data (plBreakdown, taxCalculation, arEntries, apEntries, cashBreakdown) is static prototype data in store; only decisionCards and inboxItems have mutable state
- peerCategory and benchmarks are static for p2 (sole trader); not yet implemented for p1

**Why no backend:** This is a clickable product prototype only. Real HMRC filing, Open Banking, and AI inference are explicitly out of scope.

## Data model summary (store.tsx exported types)
- Profile, SharedContext, PositionItem, InboxItem, TaxIdea, ChatMessage, ChatSession, TransactionItem
- PeerCategory, BenchmarkMetric, DecisionCard (+ DecisionScenario), ComplianceItem
- PLRevenue, PLExpense, PLBreakdown, TaxLine, TaxCalculation
- AREntry, APEntry, CashAccount, CashFlow, CashBreakdown
