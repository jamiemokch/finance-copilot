---
name: OpenAPI Zod number compatibility
description: Generator compatibility constraint for numeric count schemas.
---

In this workspace's generated Zod output, an OpenAPI `integer` is rendered as `zod.int()`, which is unavailable in the installed Zod version.

**Why:** It makes the generated API-Zod TypeScript build fail despite an otherwise valid API contract.

**How to apply:** Describe count-like response values as OpenAPI `number` unless the generator/toolchain is upgraded and verified to support integer generation.