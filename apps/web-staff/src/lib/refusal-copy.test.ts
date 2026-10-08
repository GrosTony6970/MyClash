import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { en, fr } from '@myclash/i18n';

import { heldReason, refusalMessage } from './refusal-copy';
import { canSendAgain } from '../offline/can-send-again';

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

describe('heldReason', () => {
  it('says a hit held because the Event is over in the reader’s language', () => {
    expect(
      heldReason(
        { rejectedReason: 'Event results are frozen', rejectedCode: 'event_results_frozen' },
        t,
      ),
    ).toBe('scoring.quarantine.eventOver');
  });

  // Ruling 286: a queued hit whose bout was put back to unplayed.
  it('says a hit held because its bout is not started in the reader’s language', () => {
    expect(
      heldReason(
        { rejectedReason: 'This bout is not started', rejectedCode: 'bout_not_started' },
        t,
      ),
    ).toBe('scoring.quarantine.boutNotStarted');
  });

  it('is these words (ruling 286)', () => {
    expect(en.scoring.quarantine.boutNotStarted).toBe(
      'This bout is not started, or it was reset after this entry. It is held here, not lost. Start the bout and retry, or discard it.',
    );
    expect(fr.scoring.quarantine.boutNotStarted).toBe(
      "Cet assaut n'est pas commencé, ou il a été remis à zéro après cette saisie. Elle est conservée ici, pas perdue. Démarrez l'assaut puis réessayez, ou supprimez-la.",
    );
  });

  // Ruling 290: the hit belongs to a fight that was cancelled. A new send
  // meets the same refusal for ever, so the inbox offers Discard alone.
  it('says a hit scored before a reset in the reader’s language, with no way to send it again', () => {
    const held = { rejectedReason: 'Scored before the reset', rejectedCode: 'scored_before_reset' };

    expect(heldReason(held, t)).toBe('scoring.quarantine.scoredBeforeReset');
    expect(canSendAgain(held)).toBe(false);
    expect(en.scoring.quarantine.scoredBeforeReset).toBe(
      'This entry was scored before the bout was reset, so the server did not accept it. It belongs to the fight that was cancelled. Discard it; if it still counts, enter it again by hand.',
    );
    expect(fr.scoring.quarantine.scoredBeforeReset).toBe(
      "Cette saisie a été marquée avant la remise à zéro de l'assaut : le serveur ne l'a pas acceptée. Elle appartient au combat annulé. Supprimez-la ; si elle compte encore, ressaisissez-la à la main.",
    );
  });

  // The organiser locked the bout while the hit waited: an unlock cures it.
  it('says a hit held because its bout is locked in the reader’s language, with Retry', () => {
    const held = { rejectedReason: 'Match is locked', rejectedCode: 'match_locked' };

    expect(heldReason(held, t)).toBe('scoring.quarantine.boutLocked');
    expect(canSendAgain(held)).toBe(true);
    expect(en.scoring.quarantine.boutLocked).toBe(
      'This bout is locked, so the server did not accept this entry. It is held here, not lost. Reopen the bout, then retry.',
    );
    expect(fr.scoring.quarantine.boutLocked).toBe(
      "Cet assaut est verrouillé : le serveur n'a pas accepté cette saisie. Elle est conservée ici, pas perdue. Rouvrez l'assaut, puis réessayez.",
    );
  });

  it('lets every other held hit be sent again', () => {
    expect(canSendAgain({ rejectedReason: 'x', rejectedCode: 'bout_not_started' })).toBe(true);
    expect(canSendAgain({ rejectedReason: 'x', rejectedCode: 'event_results_frozen' })).toBe(true);
    expect(canSendAgain({ rejectedReason: 'Match is locked' })).toBe(true);
  });

  it('keeps the server’s own words for any other refusal', () => {
    expect(heldReason({ rejectedReason: 'Match is locked' }, t)).toBe('Match is locked');
    expect(heldReason({ rejectedReason: 'Match is locked', rejectedCode: 'BAD_REQUEST' }, t)).toBe(
      'Match is locked',
    );
  });

  it('is what the refused-hits inbox shows', () => {
    // The pad's vitest mounts no component: the inbox is pinned as text.
    const inbox = readFileSync(join(__dirname, '..', 'components', 'QuarantineInbox.tsx'), 'utf8');
    expect(inbox).toContain('{heldReason(entry, t)}');
    // The retry button of a row is drawn only for a hit a new send can save.
    expect(inbox).toContain('{canSendAgain(entry) && (');
    expect(inbox).not.toContain('{entry.rejectedReason}');
  });
});

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

  it.each<[string, string]>([
    ['correction_later_bout_fought', 'scoring.corrections.laterBoutFought'],
    ['correction_leaves_bout_level', 'scoring.corrections.leavesBoutLevel'],
    ['correction_changes_closed_round', 'scoring.corrections.closedRoundResult'],
  ])('explains a correction refused whole: %s', (code, key) => {
    // The API's own sentence rides along, in English: the code must win.
    expect(refusalMessage(refusal(409, { code, detail: 'It was not applied.' }), t, FALLBACK)).toBe(
      key,
    );
  });

  it('says the bout is not started to a call the pad sends at once (ruling 286)', () => {
    expect(
      refusalMessage(
        refusal(409, { code: 'bout_not_started', detail: 'This bout is not started' }),
        t,
        FALLBACK,
      ),
    ).toBe('scoring.corrections.boutNotStarted');
  });

  it('says the bout is locked, instead of the API sentence', () => {
    expect(
      refusalMessage(
        refusal(400, { code: 'match_locked', detail: 'Match is locked' }),
        t,
        FALLBACK,
      ),
    ).toBe('scoring.corrections.boutLocked');
    expect(en.scoring.corrections.boutLocked).toBe(
      'This bout is locked. Reopen it, then try again.',
    );
    expect(fr.scoring.corrections.boutLocked).toBe(
      'Cet assaut est verrouillé. Rouvrez-le, puis réessayez.',
    );
  });

  it('says the Event is over, instead of the API sentence', () => {
    expect(
      refusalMessage(
        refusal(409, { code: 'event_results_frozen', detail: 'Event results are frozen' }),
        t,
        FALLBACK,
      ),
    ).toBe('scoring.corrections.eventOver');
  });

  it('says the Event is over when the archived lock refuses, not ask-an-organiser', () => {
    // A 403, so without its own case it reads as "only an organiser can do
    // this": false, an organiser is refused the same way.
    expect(
      refusalMessage(
        refusal(403, { code: 'event_archived', detail: 'This event is archived and read-only.' }),
        t,
        FALLBACK,
      ),
    ).toBe('scoring.corrections.eventOver');
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

  it('says KEEP FIGHTING when the time is not up, not a remedy', () => {
    // The other level refusal, and it must not read like this one's siblings:
    // the scores are level but the bout still has time, so there is nothing to
    // play yet. Telling a referee to start sudden death here would end a bout
    // with a minute left on the clock.
    expect(refusalMessage(refusal(400, { code: 'time_not_finished' }), t, FALLBACK)).toBe(
      'scoring.level.refusedTimeNotFinished',
    );
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
