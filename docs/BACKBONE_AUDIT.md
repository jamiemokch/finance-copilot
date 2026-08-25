# Finance Copilot backbone audit

## Product contract

The shortest safe user journey is:

1. Add a source once.
2. Preview deterministic extraction and classification without durable financial writes.
3. Ask only about unresolved facts that affect accounting or tax.
4. Save only after explicit confirmation.
5. Map every saved record to a filing box or a visible blocker.
6. Compare tax choices before asking the user to confirm one.
7. Produce a traceable accountant/filing workpaper. Do not imply that HMRC submission occurred.

## Audit findings

- The upload and semantic-review pipeline had more validation layers than the later tax-output pipeline. Late failures were therefore discovered after upload work had already succeeded.
- Classification rules were duplicated across spreadsheet analysis, confirmation routes, Financial Memory, tax estimates, and readiness views. This previously allowed a value accepted by one layer to be rejected by another.
- Transactions stored free-text accounting categories. There was no versioned, deterministic record-to-HMRC-box contract.
- Self Assessment readiness calculated headline totals but did not expose the source records behind each filing box.
- The old Year-End Pack was UI-only state. It claimed a pack was generated while no server artifact or downloadable file existed.
- Tax ideas and estimates did not produce an explicit mutually-exclusive decision between actual expenses and the trading allowance.
- Refresh/resume behaviour and provider execution are operational concerns; neither should decide whether already confirmed records can produce tax outputs.

## Implemented boundary

`uk-sa103s-filing-pack-v1` is the canonical downstream contract for sole traders. It is deterministic and read-only. Every in-period active record is:

- mapped to SA103S boxes 9–19 with its source record ID;
- explicitly excluded with a reason; or
- surfaced as a filing blocker.

The pack calculates boxes 20–22, checks the SA103S turnover threshold, exposes incomplete-year and missing-confirmation blockers, and compares actual expenses with the trading allowance without silently choosing.

The output is a traceable JSON workpaper, not a direct HMRC submission. Unsupported years and full-form cases fail closed to manual review.

## Regression gates

- Provider semantics: valid, empty, malformed JSON, refusal, incomplete, timeout, missing credential, strict JSON schema, native input text, exact model, one call only, no fallback/retry, no credential leakage.
- Durable-write boundary: no Financial Memory, inbox, import, or confirmation writes before explicit confirmation.
- Filing journey: income and each expense family map to a box; excluded records remain traceable; unknown types/categories block; tax-method scenarios remain unselected; the downloadable pack is derived from confirmed records only.
- UI truthfulness: no screen may claim a pack exists unless an actual downloadable artifact exists.

## Remaining limits

- This version prepares SA103S workpapers only. SA103F, VAT, companies, partnerships, capital allowances, CIS, losses, and direct HMRC submission require separate versioned contracts.
- Category aliases are intentionally conservative. New aliases require a regression test and a documented filing-box mapping.