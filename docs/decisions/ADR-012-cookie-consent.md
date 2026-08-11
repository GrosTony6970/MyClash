# ADR-012 — No cookie consent banner; a versioned acceptance record instead

**Date:** 2026-08-04
**Status:** Accepted

## Context

Opening signups to the public in the EU raised two questions that are routinely conflated:

1. Does MyClash need a **cookie consent banner** (ePrivacy Art. 5(3))?
2. Does MyClash need a **record of agreement** to its terms and privacy policy (GDPR Art. 7(1),
   accountability under Art. 5(2))?

They have different answers, and answering the first one wrongly is the more common failure —
a banner that asks nothing is worse than no banner, because it trains people to dismiss the one
that would matter.

The facts, each re-checkable rather than taken on trust:

- **There is no analytics or third-party tracking anywhere.** `grep -riE
'plausible|umami|matomo|gtag|google-analytics'` across `apps/` and `packages/` returns nothing.
  Sentry is loaded, but it is error reporting on first-party infrastructure and sets no
  identifying cookie.
- **Five cookies exist, all first-party.** `sb-access-token` / `sb-refresh-token` (the auth
  session), `mc_guest` (the signed guest-session cookie minted at
  `apps/api/src/modules/auth/guest-sessions.controller.ts`), `mc_locale` (the language the
  user picked, read by `apps/web-public/src/i18n/server-locale.ts`), `mc_staff` (the event staff
  PIN session, `apps/api/src/common/auth/auth.guard.ts:20`) and `mc_theme` (the scoring pad's
  theme preference). No advertising identifier, no cross-site cookie, no third-party domain.
  `mc_staff` is strictly necessary and `mc_theme` is user-set, so both sit inside the Art. 5(3)
  exemption and the decision below is unaffected.
- **The policies existed but were unreachable from the product.** They are static pages on
  `web-marketing` (`src/pages/terms.astro`, `src/pages/privacypolicy.astro`, with `/en` siblings; they lived under `public/` before the Astro rebuild). Before this
  slice, `grep -i 'terms|privacy|consent'` across `web-public`, `web-admin` and `web-staff`
  returned **zero hits**: no signup form mentioned them, no footer linked them, and nothing
  recorded that anyone had ever agreed to them.

## Decision

**No cookie consent banner.** Every cookie MyClash sets is strictly necessary for a service the
user explicitly requested (a session they asked for by logging in, a roster lookup they asked
for by tapping "this is me") or is a preference they set themselves (`mc_locale`). Both fall
inside the ePrivacy Art. 5(3) exemption. What is required is **disclosure**, not consent: the
privacy policy names the three cookies and what each is for.

**A versioned acceptance record instead.** `packages/types/src/legal.ts` is the single place that
says what version of each document is currently published; `legal_acceptances` (migration 0166)
records who accepted which version, when, and from where. Account creation is gated on it at
every entry point; guests are shown a notice and the showing is recorded; an account whose
acceptance predates a revision is asked again by a **dismissible banner**, never locked out.

## Consequences

- **The banner question is settled and re-derivable.** Anyone who proposes a consent dialog has
  to first introduce a non-exempt cookie, which is the honest trigger for revisiting this.
- **Adding analytics is now a decision with a visible cost.** The day a tracker lands, this ADR
  is wrong and a real consent mechanism — with prior blocking, not a cosmetic banner — becomes
  mandatory. That is the intended friction.
- **Bumping a policy version is a user-visible act.** Changing `LEGAL_POLICIES[...].version`
  puts the banner in front of every affected account. Editing the published text without
  bumping the version leaves the record pointing at a document that no longer exists — the
  failure mode to watch for.
- **Acceptance rows are append-only and erasable.** They cascade from `auth.users`, so an
  Art. 17 deletion takes the consent record with it. We accept that trade: retaining an
  identifier for someone who asked to be forgotten in order to prove they once agreed to a
  privacy policy is the wrong side of the same regulation.

## Alternatives considered

- **Ship a banner anyway, "to be safe."** Rejected. A consent dialog that gates nothing is not
  neutral: it is a dark pattern in the making, it trains dismissal, and under the EDPB's own
  guidance consent must be specific and informed — asking for it where it is not needed
  undermines the cases where it is.
- **Store the policy text in the database, versioned, and render it in-app.** Rejected for v1.
  It moves legal copy into a migration workflow and duplicates content that is already written,
  already indexed, and already served. The registry stores the _version_; the marketing site
  stores the _text_.
- **Block existing users until they re-accept a revised policy.** Rejected. The population
  includes competitors mid-event looking up their own pool. A hard gate there costs a real
  person something concrete to solve a paperwork problem; the banner plus the settings block
  achieves the same record without it.
