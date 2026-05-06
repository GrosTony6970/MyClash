# ADR-008 — Identity model: guest sessions + claimed accounts

**Date:** 2025-01-01
**Status:** Accepted (partially superseded — see note)

> **Note (2026-04):** Google OAuth was implemented for organiser/admin login (web-admin app) in addition to magic-link. The core guest session model for competitors/spectators remains unchanged. This ADR should be read with that context.

## Context

HEMA events include participants who should be able to access their schedule and results without creating an account. At the same time, organiser and admin functions require a durable, verified identity.

The identity model must:

- Allow competitors to access per-event features with minimal friction
- Allow organiser accounts with verified email
- Not require a global account for spectators or casual users

## Decision

**Two-tier identity:**

1. **Guest sessions** — ephemeral, event-scoped. No signup required. A competitor can claim their slot by entering a code or clicking a link from the organiser. Session stored in a cookie.
2. **Claimed accounts** — durable Supabase auth identity (email magic-link). Required for organisers, admins, and competitors who want persistent profiles across events.

At v1: no Google OAuth for competitor/spectator flows (magic-link only for organisers).

## Consequences

- **Easy:** Low friction for event-day use. Organisers have a proper identity for audit and billing.
- **Hard:** Guest sessions complicate RLS and session management. Claiming an account mid-event requires a smooth handoff flow.
- **Committed to:** All competitor-facing flows must work without a claimed account. Claiming is always optional, never forced.

## Alternatives considered

- **Mandatory signup for all** — Too much friction for event-day use; spectators would not bother.
- **Social login only (Google)** — Excludes competitors without Google accounts; not GDPR-simple.
