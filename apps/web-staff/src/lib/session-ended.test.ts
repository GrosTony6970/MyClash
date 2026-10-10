/**
 * A tap answered "nobody is signed in" sends the pad to its sign-in screen
 * (ruling 342).
 *
 * A Reopen or a Reset of the clock, a correction, a forfeit and the undo are
 * sent at once. Answered 401, the tap showed the server's English words under its button ("Staff
 * session required") and the bar stayed green. Every refused tap is worded by
 * `refusalMessage`, so it tells the bout screen there, and the screen leaves
 * for the sign-in screen, which says the hits the tablet still holds.
 *
 * One 401 is not that: an organiser's door asked by a tablet whose PIN session
 * is alive (Unlock on a bout with auto-lock on). Somebody IS signed in. The
 * API marks that answer with a code, and the pad says "only an organiser".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { en, fr } from '@myclash/i18n';
import { hearSessionEnded } from '../offline/caller-refusal';
import { signInPath } from './nav';
import { refusalMessage } from './refusal-copy';

const t = (key: string) => key;
const FALLBACK = 'scoring.clock.actionFailed';

/** A refusal as `apiRequest` reports it, after its one renewal of the login. */
function refusal(status: number, code: string | null, detail = 'in English'): ApiFailure {
  const base = { status, detail, code, details: null };
  return status === 401 || status === 403
    ? { kind: 'unauthenticated', ...base, status: status as 401 | 403 }
    : { kind: 'http', ...base, validationErrors: null };
}

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

/** The bout screen, listening. */
function listening() {
  const heard = vi.fn();
  stop = hearSessionEnded(heard);
  return heard;
}

describe('a tap answered 401', () => {
  it.each<[string, string | null]>([
    ['the API’s own code', 'UNAUTHORIZED'],
    ['no code at all', null],
  ])('with %s tells the bout screen, and says it in the reader’s language', (_what, code) => {
    const heard = listening();

    const said = refusalMessage(refusal(401, code, 'Staff session required'), t, FALLBACK);

    expect(heard).toHaveBeenCalledTimes(1);
    expect(said).toBe('scoring.corrections.sessionEnded');
  });

  it('says it with no screen listening: the sentence stands alone', () => {
    expect(refusalMessage(refusal(401, 'UNAUTHORIZED'), t, FALLBACK)).toBe(
      'scoring.corrections.sessionEnded',
    );
  });

  it('at an organiser’s door, with a PIN session alive, sends nobody away', () => {
    const heard = listening();

    const said = refusalMessage(
      refusal(401, 'organizer_session_required', 'Organizer session required'),
      t,
      FALLBACK,
    );

    expect(heard).not.toHaveBeenCalled();
    expect(said).toBe('scoring.corrections.organiserOnly');
  });

  it('is these words', () => {
    expect(en.scoring.corrections.sessionEnded).toBe('Your session has ended. Sign in again.');
    expect(fr.scoring.corrections.sessionEnded).toBe('Votre session a pris fin. Reconnectez-vous.');
  });
});

describe('a tap refused for another cause', () => {
  it.each<[string, ApiFailure]>([
    ['a 403 about the person', refusal(403, 'account_cannot_score')],
    ['a 403 that carries the organiser door’s code', refusal(403, 'organizer_session_required')],
    ['a 403 with no code', refusal(403, null)],
    ['an over Event', refusal(409, 'event_results_frozen')],
    ['a bad request', refusal(400, 'BAD_REQUEST')],
    ['a server fault', refusal(500, 'INTERNAL_SERVER_ERROR')],
    ['read-only mode', refusal(503, 'read_only_mode')],
    ['the worker’s 503', refusal(503, null)],
    ['no connection', { kind: 'network' }],
    ['the caller’s own abort', { kind: 'aborted' }],
  ])('%s sends nobody to the sign-in screen', (_what, failure) => {
    const heard = listening();

    refusalMessage(failure, t, FALLBACK);

    expect(heard).not.toHaveBeenCalled();
  });
});

describe('who listens', () => {
  it('is nobody once the bout screen has left', () => {
    const heard = listening();
    stop?.();

    refusalMessage(refusal(401, 'UNAUTHORIZED'), t, FALLBACK);

    expect(heard).not.toHaveBeenCalled();
  });

  it('is the newest screen: the stop of an older one does not silence it', () => {
    const older = vi.fn();
    const stopOlder = hearSessionEnded(older);
    const newer = listening();
    stopOlder();

    refusalMessage(refusal(401, 'UNAUTHORIZED'), t, FALLBACK);

    expect(older).not.toHaveBeenCalled();
    expect(newer).toHaveBeenCalledTimes(1);
  });
});

describe('the sign-in screen’s address', () => {
  it('stays under the admin site’s mount, which a bare /login would leave', () => {
    expect(signInPath('/staff/matches/m1')).toBe('/staff/login');
  });

  it('is /login on the pad’s own site', () => {
    expect(signInPath('/matches/m1')).toBe('/login');
    expect(signInPath('')).toBe('/login');
  });
});

describe('the pad’s screens', () => {
  // web-staff has no React test setup: the screens are read as text.
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', '..', ...path), 'utf8');

  it('tell the bout screen from the ONE place every refused tap is worded', () => {
    const copy = read('src', 'lib', 'refusal-copy.ts');
    expect(copy.match(/tellSessionEnded\(/g)).toHaveLength(1);
    for (const screen of ['MatchView', 'MatchClock', 'MatchCorrectionsDrawer', 'ForfeitPanel']) {
      expect(read('src', 'components', `${screen}.tsx`), screen).not.toContain('SessionEnded');
    }
  });

  it('the bout screen listens, and leaves for the sign-in screen of its own mount', () => {
    const page = read('app', 'matches', '[matchId]', 'page.tsx');
    expect(page).toContain('useSignInWhenSessionEnded();');
    const hook = read('src', 'hooks', 'useSignInWhenSessionEnded.ts');
    expect(hook).toContain(
      'hearSessionEnded(() => router.replace(signInPath(window.location.pathname)))',
    );
  });

  it('the staff sign-out goes to the same address', () => {
    const banner = read('src', 'components', 'EventBanner.tsx');
    expect(banner).toContain('router.replace(signInPath(');
  });
});
