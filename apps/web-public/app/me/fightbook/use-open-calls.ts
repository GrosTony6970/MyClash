'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { KnownTranslationKey } from '@myclash/i18n';
import type { OpenCallsAtEvent } from '@myclash/types';
import { readOpenCalls, writeFightBook } from '@/lib/fightbook/read-fightbook';
import { sparRefusalKey } from '@/lib/fightbook/refusal';
import { signInAgainHere } from '@/lib/sign-in-return';
import { useInFlight } from './use-in-flight';

/**
 * The sentence for a refusal of an open-call write. A call has its own words for `not_open` and
 * `self`: the request ones ("This request...", "ask yourself") do not fit a call. Whole keys, so
 * the i18n sweep sees each one used.
 */
export function callRefusalKey(code: string | null): KnownTranslationKey {
  if (code === 'not_open') return 'publicApp.fightBook.floor.notOpen';
  if (code === 'self') return 'publicApp.fightBook.floor.self';
  return sparRefusalKey(code);
}

type Loaded = { eventId: string; calls: OpenCallsAtEvent | 'failed' };

const enc = encodeURIComponent;

/**
 * The read of today's open calls at one Event. Two races, named:
 * - a reload after a write aborts the read still in flight (the effect's cleanup), so an older
 *   answer never lands over a newer one;
 * - an answer is kept with the Event it answers, so a switch of Event never shows the old list.
 */
function useCallsRead(apiUrl: string, eventId: string) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readOpenCalls(apiUrl, eventId, controller.signal).then((read) => {
      if (controller.signal.aborted || read.kind === 'aborted') return;
      if (read.kind === 'signin') return signInAgainHere();
      setLoaded({ eventId, calls: read.kind === 'data' ? read.data : 'failed' });
    });
    return () => controller.abort();
  }, [apiUrl, eventId, attempt]);

  const reload = () => setAttempt((n) => n + 1);
  const retry = () => {
    setLoaded(null);
    reload();
  };
  return { calls: loaded?.eventId === eventId ? loaded.calls : null, reload, retry };
}

type WriteDeps = {
  apiUrl: string;
  run: ReturnType<typeof useInFlight>['run'];
  reload: () => void;
  say: (sentence: string | null) => void;
  t: ReturnType<typeof useI18n>['t'];
};
/** A write's id (for `useInFlight`), path, method, body, and `gone`: a 404 is a call gone. */
type WriteArgs = [
  id: string,
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  gone?: boolean,
];

/** One write; true when it went through. */
async function sendWrite(deps: WriteDeps, ...[id, path, method, body, gone = true]: WriteArgs) {
  deps.say(null);
  const res = await deps.run(id, () => writeFightBook<unknown>(deps.apiUrl, path, method, body));
  if (res.ok) {
    deps.reload();
    return true;
  }
  // A 403 reaches here as `unauthenticated` too: only a 401 means the login ended.
  if (res.status === 401) {
    signInAgainHere();
    return false;
  }
  if (gone && res.status === 404) {
    deps.reload();
    return false;
  }
  if (res.code === 'not_open') deps.reload();
  deps.say(deps.t(callRefusalKey(res.code)));
  return false;
}

/**
 * Today's open calls at one Event, and the writes on them. Two taps on one button send one write
 * (`useInFlight`). A 404 on a write to a call id means the call vanished for me (or my "I'm in"
 * was already taken back): the list is read again and nothing is said. A 409 `not_open` reads
 * again and says so.
 */
export function useOpenCalls(apiUrl: string, eventId: string) {
  const { t } = useI18n();
  const { calls, reload, retry } = useCallsRead(apiUrl, eventId);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { inFlight, run } = useInFlight();
  const deps: WriteDeps = { apiUrl, run, reload, say: setRefusal, t };
  const send = (...args: WriteArgs) => sendWrite(deps, ...args);

  return {
    calls,
    refusal,
    inFlight,
    retry,
    answer: (id: string) => send(id, `/api/v1/me/fightbook/calls/${enc(id)}/answer`, 'PUT'),
    takeBack: (id: string) => send(id, `/api/v1/me/fightbook/calls/${enc(id)}/answer`, 'DELETE'),
    pick: (id: string, globalPersonId: string) =>
      send(id, `/api/v1/me/fightbook/calls/${enc(id)}/pick`, 'POST', { globalPersonId }),
    close: (id: string) => send(id, `/api/v1/me/fightbook/calls/${enc(id)}`, 'DELETE'),
    post: (weapons: string[], time: string) =>
      send(
        'post',
        `/api/v1/me/fightbook/events/${enc(eventId)}/calls`,
        'POST',
        { weapons, time },
        false,
      ),
  };
}
