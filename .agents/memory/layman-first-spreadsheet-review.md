---
name: Layman-first spreadsheet review
description: Product rule for how spreadsheet uncertainty and confirmation rejections are presented.
---

The normal spreadsheet journey must never present a vague uncertainty, a raw correction grid, or a generic confirmation failure. It must explain what a sheet appears to contain, name the exact missing or ambiguous fact in plain language, show a small relevant preview, and offer only safe next-step choices. A server-side validation rejection must use that same sheet- and field-linked guidance model.

**Why:** Founder UAT showed that labels such as “not clear enough,” unexplained correction controls, and technical validation copy leave non-accountants unable to make a safe decision.

**How to apply:** Keep raw field assignment, audit vocabulary, confidence details, and provenance terminology inside explicit Advanced paths. Persist each layman-facing resolution through the existing review draft before allowing confirmation. Block confirmation locally for unanswered questions, while retaining server validation as the final safety net.