# ADR-011 — No edge HTTP cache at v1 (Souin rejected)

**Date:** 2026-07-29
**Status:** Accepted

## Context

After shipping the GeoBlock and Fail2Ban edge plugins, the [Souin](https://plugins.traefik.io/plugins/6294728cffc0cd18356a97c2/souin)
Traefik plugin — an RFC-7234 HTTP cache middleware — was evaluated as a third addition to
the edge. Four findings decided it, each re-checkable against the code rather than taken
on trust:

1. **Almost nothing is cacheable.** `web-public` is deliberately uncacheable end to end:
   `force-dynamic` + `revalidate = 0` on the home, organisers, `/o/[slug]` and participants
   pages, and `cache: 'no-store'` on roughly thirty-five fetches.
   `apps/web-public/app/e/[eventSlug]/match/[matchId]/page.tsx:16` states the reason —
   _"always fresh — scores change constantly during an event."_ `web-marketing` is already
   plain static HTML behind Caddy with gzip (`apps/web-marketing/Dockerfile`).
   `/_next/static/*` already carries immutable far-future headers, and Storage objects
   already return `max-age=3600` (the supabase-js default; nothing in `apps/api` overrides
   it). The API sits behind the global AuthGuard, so nearly every route is per-user by
   construction.

2. **It would be unsafe today.** The codebase emits essentially no `Vary` headers — the only
   one is `Vary: Origin` on an SSE stream
   (`apps/api/src/modules/organizer-chat/organizer-chat.controller.ts:139`). But SSR output
   _does_ vary per request: `apps/web-public/src/i18n/server-locale.ts:19-21` renders off the
   `mc_locale` cookie and `Accept-Language`, and the session cookie drives the personal-space
   overlays and `SiteHeader`. Souin keys on scheme + host + method + path + query, **not
   cookies**. Without a full upstream `Vary` / `Cache-Control: private` sweep it would serve a
   French page to an English visitor and one logged-in user's rendered HTML to another — a
   personal-data incident on an app that ships an erasure/export suite.

3. **It fights a hard resource budget.** Traefik is pinned at `mem_limit: 256m` / `cpus: 0.5`
   in `infra/docker-compose.prod.yml`, and Souin's default Badger store lives inside that
   process — as a third Yaegi-interpreted plugin on the hot path of every router.

4. **Yaegi risk already paid for once.** GeoBlock's undocumented mandatory `api` field 404'd
   every router referencing it (see `infra/config/traefik/middlewares.yml`). Souin is far
   larger; its documentation concedes Prometheus metrics do not work under Traefik because
   plugins may not use the `unsafe` library, and its loader breaks across Traefik releases.
   The `TRAEFIK_PLUGINS=off` kill-switch catches a failed plugin _download_, not a silently
   wrong cache.

No latency incident or performance regression prompted the evaluation. Tournament-day load is
spiky but small, and the spike lands on live data.

## Decision

**No edge HTTP cache at v1.** Caching stays where it already is: the browser (immutable
`_next/static`, Storage `max-age=3600`), Next.js's own data and route cache, and the
`web-scoring` service worker.

## Consequences

- **Easy:** Traefik stays inside its 256m/0.5cpu budget with two plugins. There is no
  cache-invalidation surface to reason about during a live event, and no new failure mode
  between visitor and app.
- **Hard:** Every read hits the origin. If tournament-day load ever becomes the constraint,
  the fix is origin-side (Next `revalidate`, API `Cache-Control`), not edge-side.
- **Committed to:** any future edge cache is blocked on a prerequisite `Vary` /
  `Cache-Control: private` sweep across the SSR surfaces, and must run as a compiled
  standalone container — never as a Yaegi plugin.

## Alternatives considered

- **Souin as a Traefik plugin** — rejected for all four reasons above. The correctness hazard
  alone is disqualifying, and fixing it means doing the header work anyway, at which point
  Next's own caching delivers the win with no new component.
- **Souin as a standalone compiled container** — technically sound, avoids Yaegi entirely.
  Still blocked on the `Vary` sweep, and there is no measured demand. Revisit only with
  evidence.
- **Origin-side `Cache-Control` on genuinely static reads** — `/api/v1/version`,
  `/api/v1/weapons?active=true`, the ruleset registry, the organiser/league directory. This
  is the cheap option if a need ever appears: no new infrastructure, no shared-cache
  correctness risk. Not done now — nothing is asking for it.
- **A CDN in front (Cloudflare, Fastly)** — adds a non-EU dependency on the request path,
  conflicting with [ADR-003](./ADR-003-hosting-region.md).
