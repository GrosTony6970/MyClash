import { describe, expect, it } from 'vitest';
import {
  isOutstanding,
  readinessFixHref,
  readinessLabelKey,
  readinessMessageKey,
  readinessSemantic,
  type ReadinessCheck,
  type ReadinessLevel,
} from './readiness-copy';

function check(overrides: Partial<ReadinessCheck> = {}): ReadinessCheck {
  return { key: 'pools', level: 'warn', tournamentId: 't1', ...overrides };
}

describe('readinessSemantic', () => {
  it.each([
    ['critical', 'danger'],
    ['warn', 'paused'],
    ['ok', 'done'],
    ['info', 'ready'],
  ])('maps %s onto the %s tone', (level, expected) => {
    expect(readinessSemantic(level as ReadinessLevel)).toBe(expected);
  });
});

describe('isOutstanding', () => {
  it('counts critical and warn as work left', () => {
    expect(isOutstanding(check({ level: 'critical' }))).toBe(true);
    expect(isOutstanding(check({ level: 'warn' }))).toBe(true);
  });

  it('does not count ok or info — an info row is never a task', () => {
    expect(isOutstanding(check({ level: 'ok' }))).toBe(false);
    expect(isOutstanding(check({ key: 'bracket', level: 'info' }))).toBe(false);
  });
});

describe('readinessFixHref', () => {
  const base = '/org/my-club/events/event-1';

  it.each([
    ['tournaments', `${base}/tournaments`],
    ['pistes', `${base}/schedule`],
    ['fighters', `${base}/persons`],
    ['format', `${base}/pools`],
    ['pools', `${base}/pools`],
    ['poolReferees', `${base}/referees`],
    ['schedule', `${base}/schedule`],
    ['bracket', `${base}/bracket`],
  ])('sends %s to %s', (key, expected) => {
    expect(readinessFixHref(check({ key }), 'my-club', 'event-1')).toBe(expected);
  });

  it('sends ruleset to that tournament’s settings', () => {
    expect(
      readinessFixHref(check({ key: 'ruleset', tournamentId: 't7' }), 'my-club', 'event-1'),
    ).toBe(`${base}/tournaments/t7/settings`);
  });

  it('has no destination for a ruleset check with no tournament', () => {
    expect(
      readinessFixHref(check({ key: 'ruleset', tournamentId: null }), 'my-club', 'event-1'),
    ).toBeNull();
  });

  it('returns null for an unknown key rather than a broken link', () => {
    expect(readinessFixHref(check({ key: 'somethingNew' }), 'my-club', 'event-1')).toBeNull();
  });

  it('covers every key the API can emit', () => {
    // Pinned against the server's check keys: a new rule that lands without a
    // route here would render a row with no way to act on it.
    const apiKeys = [
      'tournaments',
      'pistes',
      'ruleset',
      'fighters',
      'format',
      'pools',
      'poolReferees',
      'schedule',
      'bracket',
    ];
    for (const key of apiKeys) {
      expect(readinessFixHref(check({ key }), 'my-club', 'event-1')).not.toBeNull();
    }
  });
});

describe('readiness i18n keys', () => {
  it('builds the label key from the check key alone', () => {
    expect(readinessLabelKey(check({ key: 'poolReferees' }))).toBe(
      'organizer.readiness.check.poolReferees.label',
    );
  });

  it('builds the message key per level, so one row reads differently when it clears', () => {
    expect(readinessMessageKey(check({ key: 'pools', level: 'warn' }))).toBe(
      'organizer.readiness.check.pools.warn',
    );
    expect(readinessMessageKey(check({ key: 'pools', level: 'ok' }))).toBe(
      'organizer.readiness.check.pools.ok',
    );
  });
});
