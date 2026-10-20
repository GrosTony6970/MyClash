'use client';

import { useEffect, useState } from 'react';
import { apiRequest, type ApiResult } from '@myclash/api-client';
import type { ForfeitChanges, ForfeitRulesInForce } from '@myclash/types/forfeit-rules';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

/** `GET …/forfeit-rules`'s answer (`ForfeitRulesController`), as the block reads it. */
interface ForfeitRulesRead {
  ruleset: ForfeitRulesInForce | null;
  invalid?: string;
}

/** The rules a Tournament's forfeit block lays its form's changes over. */
export interface ForfeitRulesShown {
  /** The penalty ruleset's rules and black card settings: what a Reset returns to. */
  ruleset: ForfeitRulesInForce | null;
  /** The stored rules do not parse: the block says so, and offers Reset on each stored change. */
  invalid: boolean;
  /** The read failed: the block says so, and offers nothing to change. */
  failed: boolean;
  /** The pick's read was refused (only an admin reads another ruleset): the pinned rules, read-only. */
  readOnly: boolean;
}

function shownOf(r: ApiResult<ForfeitRulesRead>, readOnly: boolean): ForfeitRulesShown {
  if (!r.ok) return { ruleset: null, invalid: false, failed: true, readOnly };
  return { ruleset: r.data.ruleset, invalid: !!r.data.invalid, failed: false, readOnly };
}

/**
 * The read for `pick`. None reads the Event's rules, else the built-in's: what applies once None
 * is saved, even on a Tournament that pins one. The stored pin reads with no pick, so a ruleset
 * its owner stopped sharing still loads. Another pick is an admin's: a 403 falls back to the
 * same route's own rules, read-only.
 */
async function readForfeitRules(
  eventId: string,
  tournamentId: string | null,
  pick: string,
  storedPin: string | null,
): Promise<ForfeitRulesShown> {
  const read = (path: string) => apiRequest<ForfeitRulesRead>(apiUrl, path);
  if (!pick) return shownOf(await read(`/api/v1/events/${eventId}/forfeit-rules`), false);
  const route = tournamentId
    ? `/api/v1/tournaments/${tournamentId}/forfeit-rules`
    : `/api/v1/events/${eventId}/forfeit-rules`;
  if (tournamentId && pick === storedPin) return shownOf(await read(route), false);
  const picked = await read(`${route}?penaltyRulesetId=${encodeURIComponent(pick)}`);
  if (picked.ok || picked.kind !== 'unauthenticated' || picked.status !== 403) {
    return shownOf(picked, false);
  }
  return shownOf(await read(route), true);
}

/** A Tournament's card pin and forfeit changes as it stores them: as read, then as each save left them. */
export interface StoredForfeit {
  pin: string | null;
  forfeit: ForfeitChanges | null;
}

/**
 * What a Tournament's forfeit block shows under the penalty ruleset `pick` (`''` is None), read by
 * the Tournament when one exists (a resumed draft, Basics), else by its Event. A read only. An
 * answer made for another pick is dropped: null until the pick on screen has its own.
 *
 * A Tournament's read waits for `stored` (null until its row is read): before it, the pick on
 * screen is not the Tournament's. Each new `stored`, a save's, reads again, so rules that did not
 * parse and a Reset saved show what the server now holds.
 */
export function useForfeitRules(
  eventId: string,
  tournamentId: string | null,
  pick: string,
  stored: StoredForfeit | null,
): ForfeitRulesShown | null {
  const waiting = tournamentId !== null && stored === null;
  const key = `${tournamentId ?? ''}|${pick}`;
  const [answer, setAnswer] = useState<{ key: string; shown: ForfeitRulesShown } | null>(null);
  useEffect(() => {
    if (waiting) return;
    let live = true;
    void readForfeitRules(eventId, tournamentId, pick, stored?.pin ?? null).then((shown) => {
      if (live) setAnswer({ key, shown });
    });
    return () => {
      live = false;
    };
  }, [eventId, tournamentId, pick, stored, waiting, key]);
  return !waiting && answer?.key === key ? answer.shown : null;
}
