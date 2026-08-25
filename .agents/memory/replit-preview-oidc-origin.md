---
name: Replit preview OIDC origin
description: How browser-visible callback origins must be derived for Replit development previews.
---

For development previews, construct the OIDC callback origin from Replit's canonical development domain rather than an API request's forwarded host. In production, continue deriving the origin from the public request headers.

**Why:** A preview request can traverse API-specific proxy hops. Using that hop as the redirect URI can send the provider somewhere that never reaches the browser-visible callback, leaving the user at Welcome with no session.

**How to apply:** Keep login, callback, and logout on the same origin resolver. Cover both the development-preview and production-request cases, plus a logout → login → callback → reload browser flow.