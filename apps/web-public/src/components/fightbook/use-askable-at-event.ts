'use client';

import { useEffect, useState } from 'react';
import { readAskableAtEvent } from '@/lib/fightbook/read-fightbook';

/**
 * Which of these people of an Event the signed-in fighter may ask to spar: `personId ->
 * globalPersonId`. Nothing is read for an empty list, no Event, or a visitor who is not signed in.
 *
 * The race: a fast typist's rows change while a read is out. A new list aborts the read for the old
 * one, an aborted read writes nothing, and each answer is stored with the list it answers. The hook
 * returns it only while that list is still the one shown, so an older answer never paints a button
 * on a newer row. Any answer that is not data (a 401, a 403, a failure, a bad shape) returns `{}`.
 *
 * Coming back to an earlier list (same Event, same rows) shows that list's last answer while its
 * re-read runs. That is harmless: the buttons sit on the rows the answer was for, and the API
 * refuses an ask that has gone stale.
 */
export function useAskableAtEvent(
  apiUrl: string,
  eventId: string | null,
  personIds: string[],
  signedIn: boolean,
): Record<string, string> {
  // Strings, not the array: a page passes a new array on every render.
  const idList = personIds.join(',');
  const key = `${eventId}|${idList}`;
  const [answer, setAnswer] = useState<{ key: string; map: Record<string, string> }>({
    key: '',
    map: {},
  });
  const reads = signedIn && eventId !== null && idList !== '';

  useEffect(() => {
    if (!reads || eventId === null) return;
    const controller = new AbortController();
    void readAskableAtEvent(apiUrl, eventId, idList.split(','), controller.signal).then((read) => {
      if (controller.signal.aborted) return;
      setAnswer({ key: `${eventId}|${idList}`, map: read.kind === 'data' ? read.data : {} });
    });
    return () => controller.abort();
  }, [apiUrl, eventId, idList, reads]);

  return reads && answer.key === key ? answer.map : {};
}
