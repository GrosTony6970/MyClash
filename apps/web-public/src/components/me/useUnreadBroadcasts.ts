'use client';

import { useCallback, useEffect, useState } from 'react';

// Broadcasts carry no server-side read-state, so "unread" is tracked client-side:
// a single last-seen timestamp in localStorage, compared against each broadcast's
// createdAt. Viewing the inbox stamps "now" and clears the nav badge.
const LAST_SEEN_KEY = 'myclash:notifications:lastSeenAt';
const SEEN_EVENT = 'myclash:notifications-seen';

interface BroadcastLite {
  id: string;
  createdAt: string;
}

function readLastSeen(): number {
  if (typeof window === 'undefined') return 0;
  try {
    return Number(window.localStorage.getItem(LAST_SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Mark every currently-delivered broadcast as read and clear the nav badge.
 *  Call this when the user opens the notifications inbox. */
export function markBroadcastsSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
  } catch {
    // ignore — private mode / storage disabled; badge just won't persist
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

/** Count of broadcasts newer than the last-seen marker, for a nav unread badge.
 *  Refetches on window focus and zeroes instantly when the inbox is opened. */
export function useUnreadBroadcasts(apiUrl: string): number {
  const [unread, setUnread] = useState(0);

  const recompute = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/notifications/broadcasts`, {
          credentials: 'include',
          signal,
        });
        if (!res.ok) return; // 401 (signed out) / offline → leave count as-is
        const list = (await res.json()) as BroadcastLite[];
        const lastSeen = readLastSeen();
        const count = list.filter((b) => {
          const created = Date.parse(b.createdAt);
          return Number.isFinite(created) && created > lastSeen;
        }).length;
        setUnread(count);
      } catch {
        // ignore — network/abort; keep the previous count
      }
    },
    [apiUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch updates the unread count after the server responds
    void recompute(controller.signal);

    const onSeen = () => setUnread(0);
    const onFocus = () => void recompute();
    window.addEventListener(SEEN_EVENT, onSeen);
    window.addEventListener('focus', onFocus);
    return () => {
      controller.abort();
      window.removeEventListener(SEEN_EVENT, onSeen);
      window.removeEventListener('focus', onFocus);
    };
  }, [recompute]);

  return unread;
}
