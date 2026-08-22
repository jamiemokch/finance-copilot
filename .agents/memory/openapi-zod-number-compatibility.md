---
name: OpenAPI Zod generator compatibility
description: Generator compatibility constraints for API-Zod schemas.
---

In this workspace's generated Zod output, OpenAPI `integer` is rendered as `zod.int()` and a string `uuid` format is rendered as `zod.uuid()`. Neither helper is available in the installed Zod version.

**Why:** It makes the generated API-Zod TypeScript build fail despite an otherwise valid API contract.

**How to apply:** Describe count-like response values as OpenAPI `number` and UUID-shaped headers as plain strings unless the generator/toolchain is upgraded and verified to support those helpers.