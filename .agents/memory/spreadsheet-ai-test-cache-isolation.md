---
name: Spreadsheet AI test cache isolation
description: Prevent mock semantic tests from sharing a cached success through an identical workbook content hash.
---

Focused spreadsheet-AI tests run in one process and successful analyses are cached by workbook content hash. A later test with identical workbook bytes can receive the earlier result without exercising its mock provider.

**Why:** A success-path fixture can make an intended malformed-response or persistence regression appear to pass for the wrong reason.

**How to apply:** Give new tests distinct workbook contents, or explicitly clear the semantic cache before an assertion that must exercise a provider mock. Keep this isolated to test setup; production cache behavior remains unchanged.