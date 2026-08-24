---
name: OIDC auth cache safety
description: Prevent valid Replit OIDC sessions from being misclassified as signed out after callback.
---

Authenticated identity reads must not rely on browser or proxy cache revalidation. A callback-created session is only useful once the returning client has consumed a fresh authenticated-user response and routed from the public entry screen.

**Why:** Identity responses may differ for the same URL before and after an OIDC callback. A stale or revalidated anonymous response can cause the client to render the public Welcome state despite a valid server-side session.

**How to apply:** Keep the current-user API response non-cacheable and request it with a cache-bypassing client policy. Preserve focused coverage for callback/session → reload → authenticated routing whenever auth bootstrap or caching changes.