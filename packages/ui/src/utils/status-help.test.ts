import { describe, expect, it } from 'vitest';
import { en } from '@myclash/i18n';
import {
  hasStatusHelp,
  statusHelpKeys,
  statusesWithHelp,
  type StatusHelpDomain,
} from './status-help';
import {
  clockStatusSemantic,
  matchStatusSemantic,
  phaseVisibilitySemantic,
  reviewStatusSemantic,
  rulesetSemantic,
  tournamentStatusSemantic,
  workshopStatusSemantic,
} from './status-pill';

const DOMAINS: StatusHelpDomain[] = [
  'event',
  'tournament',
  'match',
  'workshop',
  'registration',
  'review',
  'phaseVisibility',
  'clock',
  'ruleset',
  'organization',
];

describe('statusHelpKeys', () => {
  it('builds the three field keys under the domain and status', () => {
    expect(statusHelpKeys('tournament', 'draft')).toEqual({
      means: 'statusHelp.tournament.draft.means',
      next: 'statusHelp.tournament.draft.next',
      who: 'statusHelp.tournament.draft.who',
    });
  });

  it('keeps an underscored status intact — the key mirrors the stored value', () => {
    expect(statusHelpKeys('registration', 'checked_in').means).toBe(
      'statusHelp.registration.checked_in.means',
    );
  });
});

describe('hasStatusHelp', () => {
  it('is true for a status with copy', () => {
    expect(hasStatusHelp('tournament', 'draft')).toBe(true);
  });

  it('is false for a status nobody wrote copy for, so no empty ⓘ appears', () => {
    expect(hasStatusHelp('tournament', 'cancelled')).toBe(false);
  });

  it('is false for an unknown domain', () => {
    expect(hasStatusHelp('spaceship', 'draft')).toBe(false);
  });

  it('is false for the prototype keys a plain object inherits', () => {
    // `'toString' in obj` is true on any object; presence must be a real leaf.
    expect(hasStatusHelp('tournament', 'toString')).toBe(false);
    expect(hasStatusHelp('constructor', 'draft')).toBe(false);
  });
});

describe('every domain carries complete copy', () => {
  it.each(DOMAINS)('%s has at least one status, each with all three fields', (domain) => {
    const statuses = statusesWithHelp(domain);
    expect(statuses.length).toBeGreaterThan(0);
    const authored = Object.keys(
      (en as unknown as Record<string, Record<string, unknown>>)['statusHelp']?.[domain] ?? {},
    );
    // A status half-written (means but no who) would slip past the i18n parity
    // test, which only compares EN against FR — both could be equally partial.
    expect(statuses.sort()).toEqual(authored.sort());
  });
});

describe('copy matches the vocabularies the app actually renders', () => {
  it('covers exactly the match statuses the column can hold', () => {
    // matches.status is CHECK-constrained; matchStatusSemantic accepts more
    // strings than that, and explaining a state that cannot occur is noise.
    expect(statusesWithHelp('match').sort()).toEqual(
      ['completed', 'paused', 'running', 'scheduled', 'voided'].sort(),
    );
  });

  it('covers exactly the registration statuses the column can hold', () => {
    expect(statusesWithHelp('registration').sort()).toEqual(
      ['checked_in', 'disqualified', 'registered', 'waitlist', 'withdrawn'].sort(),
    );
  });

  it('covers exactly the event statuses the column can hold', () => {
    expect(statusesWithHelp('event').sort()).toEqual(
      ['archived', 'completed', 'draft', 'published', 'running'].sort(),
    );
  });

  it.each([
    ['tournament', tournamentStatusSemantic],
    ['match', matchStatusSemantic],
    ['workshop', workshopStatusSemantic],
    ['review', reviewStatusSemantic],
    ['phaseVisibility', phaseVisibilitySemantic],
    ['clock', clockStatusSemantic],
    ['ruleset', rulesetSemantic],
  ] as const)('every %s status with copy is one the palette mapper knows', (domain, mapper) => {
    // The reverse direction is deliberately NOT asserted: the mappers accept
    // strings the database cannot store, and those get no copy on purpose.
    for (const status of statusesWithHelp(domain)) {
      expect(typeof mapper(status)).toBe('string');
    }
  });
});
