# @myclash/web-marketing

The marketing / landing site served at `myclash.fr` (apex domain).

**Distinct from**: `web-public` (the per-event PWA at `app.myclash.fr`).

## Purpose

- Project homepage: what is MyClash, why it exists, a hero photo and the brand banner, and a band
  of three live counts (Events, clubs, fighters) that appears only once the API has answered.
- "For organizers" pitch with CTA → `admin.myclash.fr`.
- "For HEMA clubs" pitch with CTA → `app.myclash.fr` (the app root is the browse-events surface; there is no `/events` segment).
- The nav links to the app (`app.myclash.fr`) and its sign-in button opens `app.myclash.fr/login`.
- Privacy policy, ToS, contact, attribution.

## Pages

| Path                | Source                               | Language |
| ------------------- | ------------------------------------ | -------- |
| `/`                 | `src/pages/index.astro`              | FR       |
| `/en`               | `src/pages/en/index.astro`           | EN       |
| `/privacypolicy`    | `src/pages/privacypolicy.astro`      | FR       |
| `/en/privacypolicy` | `src/pages/en/privacypolicy.astro`   | EN       |
| `/terms`            | `src/pages/terms.astro`              | FR       |
| `/en/terms`         | `src/pages/en/terms.astro`           | EN       |
| `/guide/…`          | `src/pages/guide/[...slug].astro`    | FR       |
| `/en/guide/…`       | `src/pages/en/guide/[...slug].astro` | EN       |
| any unknown path    | `src/pages/404.astro`                | FR + EN  |

The organiser guide's pages are Markdown, one file per page per language, in
`src/content/guide/{fr,en}/` (collection in `src/content.config.ts`, paths in `src/lib/guide.ts`,
layout `src/layouts/Guide.astro`). A page added in one language only fails `test/site.test.mjs`.

**`/terms` and `/privacypolicy` are load-bearing URLs.** `LEGAL_POLICIES[kind].path` in
`packages/types/src/legal.ts` publishes them, and `legal-url.ts` in `web-public` and `web-admin`
builds every consent link and `LegalUpdateBanner` href from them. They must answer on exactly
those paths, without a redirect. `test/site.test.mjs` reads the paths out of `legal.ts` and
asserts each one resolves to its own document. `test/privacy-date.test.mjs` holds each legal
page's "Last updated" line to the version in `legal.ts` that every stored acceptance points at.

Two URLs come from no page. `@astrojs/sitemap` (`astro.config.mjs`) writes `sitemap-index.xml` at
build time, and `public/robots.txt` points crawlers at it. `GET /api/version` is answered by
Caddy itself (`Caddyfile`), with the commit the container serves, in the shape the three Next
apps answer.

## Build

**Astro, prerendered to static HTML**, served by Caddy in production.

```bash
pnpm --filter @myclash/web-marketing dev        # localhost:3004
pnpm --filter @myclash/web-marketing build      # → dist/
pnpm --filter @myclash/web-marketing test       # builds, then asserts over dist/
```

The `Dockerfile` is multi-stage: node builds `dist/`, then `caddy:2-alpine` serves it. The
runtime image contains no Node and no server — only static files and `Caddyfile`. The build
context is the **repo root**, because Astro installs from the workspace lockfile.

### Why Astro and not hand-written HTML

It was hand-written HTML: six files, each carrying its own copy of the same ~800-line
`<style>` block and its own copy of the nav and footer. The two landing pages had already
drifted (one stylesheet pointed at `assets/`, the other at `../assets/`), the support section
on the French page was English top to bottom, and only the legal pages had a language switcher.
Astro gives it one layout, one stylesheet, and a typed copy table where a missing translation
is a compile error.

### Conventions that are not obvious

- **Fonts are self-hosted** (`src/styles/fonts.css`, `@fontsource/*`). They must stay that way:
  the privacy policy's §8 undertakes to name every flow that leaves the EU, and loading them
  from `fonts.googleapis.com` sent every visitor's IP to Google — on the policy page itself.
  `test/site.test.mjs` fails on any cross-origin subresource.
- **Copy lives in `src/i18n/`**, markup in `src/components/`. Both locales are one object, so a
  missing string does not compile.
- **`public/` is for stable URLs only** — the favicon, the OG card and `robots.txt`, which social
  scrapers, browsers and crawlers address directly. Everything else goes through `src/assets/` so
  Astro can hash and re-encode it (the hero is 2.43 MB as a PNG and 25 to 115 kB as an AVIF, by
  width).
- **Scroll-reveal is opt-in via a `.js` class** on `<html>`. Starting content at `opacity: 0`
  unconditionally meant the whole features section rendered blank without JavaScript.

## What this is NOT

- Not a per-event site (that's `web-public`).
- Not interactive — no auth, and one API call: the visitor's browser reads
  `/api/v1/public/site-stats` for the counts band (`src/components/Home.astro`; the host is the
  `PUBLIC_API_URL` build arg). The container itself never talks to the API, which is why
  `scripts/check-infra-review.mjs` exempts it from the `depends_on: api` rule.
- Not the place for organizer dashboards or scoring tools.
