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

| Subdomain                       | Service                                  |
| ------------------------------- | ---------------------------------------- |
| `myclash.fr` / `www.myclash.fr` | Marketing landing page                   |
| `app.myclash.fr`                | Public/spectator PWA + competitor portal |
| `admin.myclash.fr`              | Organiser admin + super-admin            |
| `scoring.myclash.fr`            | Scorekeeper PWA                          |
| `api.myclash.fr`                | NestJS REST API + Supabase services      |

## Consequences

- **Easy:** Each subdomain gets its own Let's Encrypt cert (TLS-ALPN-01 challenge) via Traefik; adding a new surface is a Traefik label change.
- **Hard:** `.fr` TLD requires a EU/French registrant — satisfied by the project owner's location.
- **Committed to:** The subdomain map above is the canonical routing contract. Changes require updating Traefik config, `.env`, and this ADR.

## Alternatives considered

- **myclash.com** — Not available or significantly more expensive.
- **myclash.io** — Less clear geographic signal for a EU-focused project.
