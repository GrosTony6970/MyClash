/**
 * What to say when a bracket's seeding no longer matches the standings it was
 * drawn from — and, crucially, in what ORDER to say the remedies.
 *
 * Regenerate is right there on the same card and it destroys every bout already
 * fought in the bracket, plus its schedule and its referee crew. Drift is
 * almost never worth that: it is unrecoverable only because one R1 bout was
 * left started, and putting that one bout back to "not started" lets the next
 * pool completion heal the draw for free. Naming the cheap fix FIRST is the
 * whole point of the banner; a banner that only said "the seeding is stale"
 * next to a Regenerate button would cost organisers brackets.
 *
 * Copy lives in i18n; this owns which sentences apply. Pure and free of React,
 * following the `readiness-copy.ts` pattern.
 */

/** `SeedingDrift` as it arrives on `GET /tournaments/:id/bracket`. */
export interface SeedingDrift {
  state: 'fresh' | 'stale' | 'pending' | 'not-applicable';
  source: 'pool-standings' | 'swiss-standings' | null;
  /** R1/R0 slots whose seeded fighter no longer matches the standings. */
  changedSlotIds: string[];
  /** Started R0/R1 matches — why the bracket cannot re-seed itself. */
  blockingMatchIds: string[];
}

export interface BannerLine {
  key: string;
  values?: Record<string, string | number>;
}

/**
 * A remedy plus WHAT it is, independent of its wording.
 *
 * The ordering contract is the whole point of this module, and an i18n key is a
 * poor thing to assert it with: the copy is bilingual, so a browser test would
 * be asserting on whichever language the session happened to be in. `kind` is
 * rendered as `data-remedy` and is what both the unit test and the E2E read.
 */
export type RemedyKind = 'reset' | 'populate' | 'regenerate';

export interface RemedyLine extends BannerLine {
  kind: RemedyKind;
}

export interface SeedingDriftBanner {
  /** The headline. */
  headline: BannerLine;
  /** Remedies, CHEAPEST FIRST. Empty while the source is still settling. */
  remedies: RemedyLine[];
}

export function seedingDriftBanner(
  drift: SeedingDrift | null | undefined,
): SeedingDriftBanner | null {
  // `fresh` needs no banner, and neither does a draw seeded from registrations,
  // ratings or a random shuffle — those re-order on any withdrawal, so a diff
  // against them says nothing about whether the bracket is right.
  if (!drift || drift.state === 'fresh' || drift.state === 'not-applicable') return null;

  if (drift.state === 'pending') {
    // Informational, and deliberately remedy-free: the bracket is about to heal
    // itself. Offering Regenerate here would be advice to destroy a bracket
    // that needs nothing done to it.
    return {
      headline: { key: 'organizer.bracketPage.seedingDriftPending' },
      remedies: [],
    };
  }

  const changed = drift.changedSlotIds.length;
  const blocking = drift.blockingMatchIds.length;
  return {
    headline:
      changed === 1
        ? { key: 'organizer.bracketPage.seedingDriftStaleOne' }
        : { key: 'organizer.bracketPage.seedingDriftStaleMany', values: { count: changed } },
    remedies: [
      blocking === 0
        ? // Nothing has started, so the server will accept a re-populate — the
          // button is on this very card.
          { kind: 'populate', key: 'organizer.bracketPage.seedingDriftRemedyPopulate' }
        : blocking === 1
          ? { kind: 'reset', key: 'organizer.bracketPage.seedingDriftRemedyResetOne' }
          : {
              kind: 'reset',
              key: 'organizer.bracketPage.seedingDriftRemedyResetMany',
              values: { count: blocking },
            },
      { kind: 'regenerate', key: 'organizer.bracketPage.seedingDriftRemedyRegenerate' },
    ],
  };
}
