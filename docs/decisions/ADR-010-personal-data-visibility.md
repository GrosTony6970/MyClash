# ADR-010 — Default visibility for personal data: follows physical venue reality

**Date:** 2025-01-01
**Status:** Accepted

## Context

HEMA events are public competitions. Participants are announced in the venue, results are read aloud, brackets are displayed on screens. However, online publication of personal data (full name, club, score) requires a principled default.

The platform must balance:

- GDPR minimisation principle
- The practical reality that event results are intended to be public
- Competitor expectations (they entered a public competition)

## Decision

**Default visibility mirrors what would be visible in the physical venue.**

Specifically:

- **Competition results, rankings, bracket positions, scores** → public by default (as they are on venue screens and printed brackets)
- **Email addresses** → never public; internal only
- **Fighter profile photos** → visible to authenticated users by default; organisers can mark events as fully public
- **Workshop attendance, personal schedule** → visible only to the individual and the organiser
- **Detailed exchange data** (which hit landed where) → public at the event level; aggregated in public stats

Competitors can opt out of public result publication per event via their profile settings (GDPR right to object, Article 21). Opting out replaces their name with "Anonymous" in public views.

## Consequences

- **Easy:** Simple default rule that maps to user expectations. Minimal GDPR friction for the primary use case.
- **Hard:** The opt-out flow must be implemented before go-live. "Anonymous" entries in rankings look odd — acceptable, and documented in the privacy policy.
- **Committed to:** Email addresses are never returned by any public API endpoint. RLS enforces this at the DB layer.

## Alternatives considered

- **Opt-in for public results** — Creates too much friction and would break the core use case (live public brackets).
- **All data private by default** — Contradicts the purpose of a public competition platform.
