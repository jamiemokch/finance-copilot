---
name: SME Finance Copilot canonical figures
description: All canonical money values for the Sole Trader (p2) sample data — must be consistent across every page
---

## Revenue
- Total YTD: **£39,800** (project fees £31,200 + retainer £7,200 + licensing £1,400)

## Expenses
- Confirmed: **£4,800** (Adobe £600, WeWork £2,400, insurance £780, accountancy £600, travel £420)
- Pending Inbox (excluded from headline): **£1,399** (Apple Store £1,249 + meeting room £150)

## Profit
- YTD confirmed profit: **£35,000** (£39,800 − £4,800)

## Tax calculation
- Taxable: £35,000 trading + £10,200 property − £12,570 personal allowance = £32,630
- Income Tax: £6,526 | NI Class 4: £2,019 | NI Class 2: £179 = total £8,724
- Less PoA already paid: £1,800
- **Balance due Jan 2025: £6,924 (displayed as £6,900)**

## Cash
- Starling balance: £9,840
- Less tax reserve: −£3,500
- Less AP due ≤30d: −£250 (Adobe £50 + WeWork £200)
- **Available cash: £6,090**

## AR / AP
- AR total: £3,400 (2 invoices — Axiom #1042 £2,400 overdue 7d; Studio Nine £1,000 due 5 Apr)
- AP total: £250 (Adobe £50 + WeWork £200, both due <30d)
- AR excluded from available cash

## Tax reserve gap
- Balance due: £6,900
- Reserved: £3,500
- **Gap: £3,400** — actionable: chase Axiom (£2,400) → move to tax pot

## Key constants in code (dashboard.tsx)
```
const taxBalanceDue = 6900;
const taxReserve = 3500;
const taxReserveGap = 3400;
```

**Why:**
These figures must be consistent across Evidence, Finances, Dashboard, Business Ideas, and Tasks. Any change to one must propagate to all others. The bi1 computeScenario bug (36500 vs 39800) is the canonical example of what goes wrong when you don't trace back to this file.
