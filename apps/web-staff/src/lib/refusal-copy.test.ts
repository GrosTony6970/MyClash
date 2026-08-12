import { describe, expect, it } from 'vitest';
import { refusalMessage } from './refusal-copy';

/**
 * Each case pins one thing the referee must be told. The mapper's whole job is
 * that the pad stops rendering API English at somebody standing at a piste, so
 * "which key" IS the behaviour — there is nothing else to assert.
 */
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const FALLBACK = 'scoring.corrections.actionFailed';

describe('refusalMessage', () => {
  it('names the offline case, which carries no message at all', () => {
    // `sw.js` answers every /api/ request with `{error:'offline', status:503}`.
    // Without this the operator gets the generic failure string and no hint
    // that the pad is simply not connected.
    expect(refusalMessage(503, { error: 'offline' }, t, FALLBACK)).toBe(
      'scoring.corrections.offlineRefusal',
    );
  });

  it('counts the fought dependents, with a separate key at one', () => {
    // `t()` has no plural engine, so "the 1 later bouts" is what this prevents.
    expect(
      refusalMessage(
        409,
        { code: 'dependent_results_would_be_discarded', foughtCount: 1 },
        t,
        FALLBACK,
      ),
    ).toBe('scoring.corrections.dependentsBlockedOne');
    expect(
      refusalMessage(
        409,
        { code: 'dependent_results_would_be_discarded', foughtCount: 3 },
        t,
        FALLBACK,
      ),
    ).toBe('scoring.corrections.dependentsBlockedMany:{"count":3}');
  });

  it('explains the forfeit refusal instead of the API sentence', () => {
    expect(refusalMessage(409, { code: 'forfeit_withdrew_fighter' }, t, FALLBACK)).toBe(
      'scoring.corrections.forfeitBlocked',
    );
  });

  it('explains the Swiss refusal', () => {
    expect(refusalMessage(409, { code: 'swiss_later_round_already_drawn' }, t, FALLBACK)).toBe(
      'scoring.corrections.swissRoundAhead',
    );
  });

  it('turns any 403 on these routes into ask-an-organiser', () => {
    // Kept as a status check as well as a code: `authorizeMatchScoring` can
    // refuse before the un-completion owner is reached, so there is no code.
    expect(refusalMessage(403, {}, t, FALLBACK)).toBe('scoring.corrections.organiserOnly');
    expect(refusalMessage(403, { code: 'uncomplete_requires_organiser' }, t, FALLBACK)).toBe(
      'scoring.corrections.organiserOnly',
    );
  });

  it('falls through to the server’s own words when it does not recognise the code', () => {
    // Not a generic apology. A 400 carries a real, specific message and the
    // operator is better served by it — same principle as the quarantine inbox.
    expect(
      refusalMessage(400, { message: 'Confirmation phrase must be RESET MATCH' }, t, FALLBACK),
    ).toBe('Confirmation phrase must be RESET MATCH');
  });

  it('falls back to the caller’s key when there is no body at all', () => {
    expect(refusalMessage(500, null, t, FALLBACK)).toBe(FALLBACK);
  });
});
