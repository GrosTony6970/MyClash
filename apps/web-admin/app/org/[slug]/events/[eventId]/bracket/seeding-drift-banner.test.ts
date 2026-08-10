import { describe, expect, it } from 'vitest';
import { seedingDriftBanner } from './seeding-drift-banner';

/**
 * The ordering assertions here are the point. Regenerate sits on the same card
 * and destroys every bout already fought in the bracket, its schedule and its
 * referee crew — so a banner that says "the seeding is stale" and stops there
 * is an instruction to nuke a bracket over one seed.
 */
describe('seedingDriftBanner', () => {
  it('shows nothing for a bracket that still matches its standings', () => {
    expect(
      seedingDriftBanner({
        state: 'fresh',
        source: 'pool-standings',
        changedSlotIds: [],
        blockingMatchIds: [],
      }),
    ).toBeNull();
  });

  it('shows nothing for a draw that is not seeded from results', () => {
    // Rating and random re-order on every withdrawal; a diff against them says
    // nothing about whether the bracket is correct.
    expect(
      seedingDriftBanner({
        state: 'not-applicable',
        source: null,
        changedSlotIds: [],
        blockingMatchIds: [],
      }),
    ).toBeNull();
  });

  it('shows nothing when the bracket read carries no drift block', () => {
    expect(seedingDriftBanner(undefined)).toBeNull();
    expect(seedingDriftBanner(null)).toBeNull();
  });

  it('offers NO remedy while a pool bout is back in play', () => {
    // The bracket is about to heal itself. Offering Regenerate here is advice
    // to destroy a bracket that needs nothing done to it.
    const banner = seedingDriftBanner({
      state: 'pending',
      source: 'pool-standings',
      changedSlotIds: [],
      blockingMatchIds: ['m1'],
    });

    expect(banner).toEqual({
      headline: { key: 'organizer.bracketPage.seedingDriftPending' },
      remedies: [],
    });
  });

  it('names resetting the started bout BEFORE regenerating', () => {
    const banner = seedingDriftBanner({
      state: 'stale',
      source: 'pool-standings',
      changedSlotIds: ['s2'],
      blockingMatchIds: ['m1'],
    });

    expect(banner!.headline).toEqual({ key: 'organizer.bracketPage.seedingDriftStaleOne' });
    // Asserted by KIND, not by key: `kind` is the ordering contract, and it is
    // what reaches the DOM as `data-remedy` for the browser test to read.
    expect(banner!.remedies.map((line) => line.kind)).toEqual(['reset', 'regenerate']);
    expect(banner!.remedies[0]!.key).toBe('organizer.bracketPage.seedingDriftRemedyResetOne');
  });

  it('points at Populate, not Regenerate, when nothing has started', () => {
    // Nothing blocks the re-seed, so the button already on this card fixes it.
    const banner = seedingDriftBanner({
      state: 'stale',
      source: 'pool-standings',
      changedSlotIds: ['s1', 's2'],
      blockingMatchIds: [],
    });

    expect(banner!.remedies.map((line) => line.kind)).toEqual(['populate', 'regenerate']);
    expect(banner!.remedies[0]!.key).toBe('organizer.bracketPage.seedingDriftRemedyPopulate');
  });

  it('counts the drifted places and the blocking bouts separately', () => {
    // `t()` has no plural engine, so each count gets a singular and a plural
    // key rather than "1 places".
    const banner = seedingDriftBanner({
      state: 'stale',
      source: 'swiss-standings',
      changedSlotIds: ['s1', 's2', 's3'],
      blockingMatchIds: ['m1', 'm2'],
    });

    expect(banner!.headline).toEqual({
      key: 'organizer.bracketPage.seedingDriftStaleMany',
      values: { count: 3 },
    });
    expect(banner!.remedies[0]).toEqual({
      kind: 'reset',
      key: 'organizer.bracketPage.seedingDriftRemedyResetMany',
      values: { count: 2 },
    });
  });

  it('always ends on Regenerate, never opens with it', () => {
    for (const blockingMatchIds of [[], ['m1'], ['m1', 'm2']]) {
      const banner = seedingDriftBanner({
        state: 'stale',
        source: 'pool-standings',
        changedSlotIds: ['s1'],
        blockingMatchIds,
      })!;
      expect(banner.remedies[0]!.kind).not.toBe('regenerate');
      expect(banner.remedies.at(-1)!.kind).toBe('regenerate');
    }
  });
});
