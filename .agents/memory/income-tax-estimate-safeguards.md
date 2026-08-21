---
name: Income-tax estimate safeguards
description: Boundaries that keep the UK sole-trader income-tax estimate honest.
---

The income-tax estimate must use the canonical ledger's tax-allowable business profit, not raw expenses: non-deductible records do not reduce it, and mixed-use records use their saved allowable amount.

**Why:** Treating every expense as deductible materially understates an income-tax estimate and conflicts with the ledger's existing tax semantics.

**How to apply:** Keep a transparent actual P&L available for review, but feed only income less allowable expenses into income-tax calculations.

Other taxable income is tied to a saved tax year and must be ignored when it does not match the profile's selected tax year. Cash-basis profiles can use the existing ledger date; accrual-basis profiles remain incomplete until Financial Memory stores the necessary recognition dates.

**Why:** Reusing a personal-income value across years or pretending transaction dates are accrual recognition dates gives a falsely complete figure.

**How to apply:** Return an explicit incomplete status and named missing inputs instead of falling back to £0 or applying an unsupported basis conversion.