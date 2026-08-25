import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';

import { refusalMessage } from './refusal-copy';

/**
 * Each case pins one thing the referee must be told. The mapper's whole job is
 * that the pad stops rendering API English at somebody standing at a piste, so
 * "which key" IS the behaviour — there is nothing else to assert.
 *
 * ── Why these take an `ApiFailure` and not a body ────────────────────────────
 * They used to hand the mapper a hand-built body: `{ code:
 * 'dependent_results_would_be_discarded', foughtCount: 3 }`. No server ever
 * sent that. The exception filter put the thrower's own code and payload under
 * `details` and set the top-level `code` from the STATUS, so the real body read
 * `code: 'CONFLICT'` and every case in the switch was unreachable — the pad
 * rendered the API's English sentence, the exact thing this file exists to
 * prevent, and these tests stayed green throughout.
 *
 * Building the failure the way `apiRequest` builds it is what stops that
 * happening again: `code` and `details` are separate members, and a case can
 * only pass by matching the one the wire actually carries.
 */
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const FALLBACK = 'scoring.corrections.actionFailed';

/** A refusal as `apiRequest` reports it. */
function refusal(
  status: number,
  fields: { code?: string; detail?: string; details?: Record<string, unknown> | null } = {},
): ApiFailure {
  const base = {
    status,
    detail: fields.detail ?? null,
    code: fields.code ?? null,
    details: fields.details ?? null,
  };
  return status === 401 || status === 403
    ? { kind: 'unauthenticated', ...base, status: status as 401 | 403 }
    : { kind: 'http', ...base, validationErrors: null };
}

describe('refusalMessage', () => {
  it('names the offline case, which carries no message at all', () => {
    // `sw.js` answers every /api/ request with `{error:'offline', status:503}`.
    // Without this the operator gets the generic failure string and no hint
    // that the pad is simply not connected.
    expect(refusalMessage(refusal(503), t, FALLBACK)).toBe('scoring.corrections.offlineRefusal');
  });

  it('treats a genuine network failure as offline too', () => {
    // Only reachable before the service worker installs — after that a dead
    // network is the synthetic 503 above. Same situation for the referee.
    expect(refusalMessage({ kind: 'network' }, t, FALLBACK)).toBe(
      'scoring.corrections.offlineRefusal',
    );
  });

  it('has nothing to say about an abort', () => {
    expect(refusalMessage({ kind: 'aborted' }, t, FALLBACK)).toBeNull();
  });

  it('counts the fought dependents, with a separate key at one', () => {
    // `t()` has no plural engine, so "the 1 later bouts" is what this prevents.
    // The count comes out of `details`, which is where the filter puts it —
    // reading it off the top level gave every refusal the singular sentence.
    expect(
      refusalMessage(
        refusal(409, {
          code: 'dependent_results_would_be_discarded',
          details: { foughtCount: 1 },
        }),
        t,
        FALLBACK,
      ),
    ).toBe('scoring.corrections.dependentsBlockedOne');
    expect(
      refusalMessage(
        refusal(409, {
          code: 'dependent_results_would_be_discarded',
          details: { foughtCount: 3 },
        }),
        t,
        FALLBACK,
      ),
    ).toBe('scoring.corrections.dependentsBlockedMany:{"count":3}');
  });

  it('says one bout when the count is missing or nonsense', () => {
    // The singular sentence names no number, so it is the safe read: "3 later
    // bouts" against a count nobody sent would be worse than saying less.
    const bags: Array<Record<string, unknown> | undefined> = [
      undefined,
      {},
      { foughtCount: 'three' },
      { foughtCount: 0 },
    ];
    for (const details of bags) {
      expect(
        refusalMessage(
          refusal(409, { code: 'dependent_results_would_be_discarded', details }),
          t,
          FALLBACK,
        ),
      ).toBe('scoring.corrections.dependentsBlockedOne');
    }
  });

  it('explains the forfeit refusal instead of the API sentence', () => {
    expect(refusalMessage(refusal(409, { code: 'forfeit_withdrew_fighter' }), t, FALLBACK)).toBe(
      'scoring.corrections.forfeitBlocked',
    );
  });

  it('explains the Swiss refusal', () => {
    expect(
      refusalMessage(refusal(409, { code: 'swiss_later_round_already_drawn' }), t, FALLBACK),
    ).toBe('scoring.corrections.swissRoundAhead');
  });

  it('turns any 403 on these routes into ask-an-organiser', () => {
    // Kept as a status check as well as a code: `authorizeMatchScoring` can
    // refuse before the un-completion owner is reached, so there is no code.
    expect(refusalMessage(refusal(403), t, FALLBACK)).toBe('scoring.corrections.organiserOnly');
    expect(
      refusalMessage(refusal(403, { code: 'uncomplete_requires_organiser' }), t, FALLBACK),
    ).toBe('scoring.corrections.organiserOnly');
  });

  it('never lets the API sentence win over a code it recognises', () => {
    // The regression that shipped: a real refusal carries BOTH, and reading the
    // sentence is what put "Undoing this result would invalidate it." in front
    // of a referee at a piste.
    expect(
      refusalMessage(
        refusal(409, {
          code: 'forfeit_withdrew_fighter',
          detail: 'The fighter withdrew from the tournament.',
        }),
        t,
        FALLBACK,
      ),
    ).toBe('scoring.corrections.forfeitBlocked');
  });

  it('falls through to the server’s own words when it does not recognise the code', () => {
    // Not a generic apology. A 400 carries a real, specific message and the
    // operator is better served by it — same principle as the quarantine inbox.
    expect(
      refusalMessage(
        refusal(400, { detail: 'Confirmation phrase must be RESET MATCH' }),
        t,
        FALLBACK,
      ),
    ).toBe('Confirmation phrase must be RESET MATCH');
  });

  it('falls back to the caller’s key when there is no reason at all', () => {
    expect(refusalMessage(refusal(500), t, FALLBACK)).toBe(FALLBACK);
  });
});

/**
 * A LEVEL bout at time. The clock refuses to end it and names the remedy; this
 * is where the API's English becomes something the referee reads in their own
 * language, on the tablet, mid-bout.
 */
describe('refusalMessage — level at time', () => {
  it('names the extra time, with the seconds the organiser configured', () => {
    expect(
      refusalMessage(
        refusal(400, {
          code: 'level_at_time_unresolved',
          details: { remedy: 'extra_time', seconds: 60 },
        }),
        t,
        FALLBACK,
      ),
    ).toBe('scoring.level.refusedExtraTime:{"seconds":60}');
  });

  it('names sudden death, which needs no number', () => {
    expect(
      refusalMessage(
        refusal(400, { code: 'level_at_time_unresolved', details: { remedy: 'sudden_death' } }),
        t,
        FALLBACK,
      ),
    ).toBe('scoring.level.refusedSuddenDeath');
  });

  it('falls back to sudden death when the remedy is missing or malformed', () => {
    // Sudden death is the fallback DELIBERATELY: it is the only remedy that
    // needs no number, so an unrecognised body still tells the referee
    // something true — play on until one of them leads.
    for (const details of [null, {}, { remedy: 'extra_time' }, { remedy: 'coin_toss' }]) {
      expect(
        refusalMessage(refusal(400, { code: 'level_at_time_unresolved', details }), t, FALLBACK),
      ).toBe('scoring.level.refusedSuddenDeath');
    }
  });
});
