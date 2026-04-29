# @myclash/web-marketing

The marketing / landing site served at `myclash.fr` (apex domain).

**Distinct from**: `web-public` (the per-event PWA at `app.myclash.fr`).

## Purpose

- Project homepage: what is MyClash, why it exists, screenshots.
- "For organizers" pitch with CTA → `admin.myclash.fr`.
- "For HEMA clubs" pitch with CTA → `app.myclash.fr/events` (browse events).
- Public documentation (or a link to it).
- Privacy policy, ToS, contact, attribution.

## Build

**Static HTML/CSS only.** No build tooling, no JS framework. Authored by hand, served by Caddy in production.

The production `Dockerfile` is two lines: `FROM caddy:2-alpine` + `COPY public/ /usr/share/caddy/`. No build step at runtime.

Why static? The marketing site is small (a handful of pages), changes infrequently, has no auth, no API calls, no React state. Static HTML is faster, simpler, easier to debug, and has no dependency churn. If MyClash ever needs MDX content collections, i18n, or sitemap generation, switching to Astro is a half-day migration.

## What this is NOT

- Not a per-event site (that's `web-public`).
- Not interactive — no auth, no API calls, no React state. Static content only.
- Not the place for organizer dashboards or scoring tools.
