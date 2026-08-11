# ADR-004 — Domain: myclash.fr

**Date:** 2025-01-01
**Status:** Accepted

## Context

The platform needs a canonical domain. Requirements:

- Short and memorable
- `.fr` TLD to signal French/European origin and GDPR commitment
- Available for registration

## Decision

**`myclash.fr`** as the apex domain.

Subdomain structure:

| Subdomain                       | Service                                              |
| ------------------------------- | ---------------------------------------------------- |
| `myclash.fr` / `www.myclash.fr` | Marketing landing page                               |
| `app.myclash.fr`                | Public/spectator PWA + competitor portal             |
| `admin.myclash.fr`              | Organiser admin + super-admin                        |
| `staff.myclash.fr`              | Scorekeeper PWA                                      |
| `api.myclash.fr`                | NestJS REST API (and the unprefixed `/health` probe) |
| `studio.myclash.fr`             | Supabase Studio, IP-allowlisted + basic-auth         |
| `traefik.myclash.fr`            | Traefik dashboard                                    |

The **Supabase services are not on `api.`** — they are same-origin on `app.${DOMAIN}`:
`/auth/v1` (GoTrue), `/rest/v1` (PostgREST), `/realtime/v1`, `/storage/v1`, alongside a same-origin
`/api/v1` mount. Building a Supabase client URL, a probe or a redirect URI from the `api.` row
targets a host with no such router.

## Consequences

- **Easy:** Each subdomain gets its own Let's Encrypt cert (TLS-ALPN-01 challenge) via Traefik; adding a new surface is a Traefik label change.
- **Hard:** `.fr` TLD requires a EU/French registrant — satisfied by the project owner's location.
- **Committed to:** The subdomain map above is the canonical routing contract. Changes require updating Traefik config, `.env`, and this ADR.

## Alternatives considered

- **myclash.com** — Not available or significantly more expensive.
- **myclash.io** — Less clear geographic signal for a EU-focused project.
