'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@myclash/api-client';
import type { Freshness } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { useRealtimeDisabled, useRealtimeWithFallback } from '@/lib/supabase-browser';
import { BOARD_POLL_MS, boardFreshness, boardIsDegraded } from './board-freshness';

export interface LiveMatch {
  id: string;
  matchNumberLabel: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  scheduledAt: string | null;
  status: string;
  tournamentName: string | null;
  redScore: number;
  blueScore: number;
}

export interface LiveLiceState {
  lice: { id: string; name: string; sortOrder: number };
  runningMatch: LiveMatch | null;
  nextMatch: LiveMatch | null;
}

export interface LiveState {
  currentBlock: { label: string; startTime: string; endTime: string; blockType: string } | null;
  nextBlock: { label: string; startTime: string } | null;
  lices: LiveLiceState[];
  /** The Event's IANA zone: the clock a bout's time is told on. */
  timezone?: string | null;
}

export interface LiveBoardView {
  /** The last read that landed, or null before the first one. */
  state: LiveState | null;
  loading: boolean;
  /** How fresh `state` is: the page SAYS it (quick win F5). */
  freshness: Freshness;
}

/**
 * The time, read once a second while `ticking`. "Not updating" comes true with
 * no event to announce it, so a tick draws the page again. Only while the
 * board depends on its poll: a healthy page does not draw itself once a second
 * all day.
 * 0 until the first tick, which `deriveFreshness` reads as "just now".
 */
function useSecondsWhile(ticking: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!ticking) return;
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, [ticking]);
  return now;
}

/**
 * The live board's data: ONE read of the Event's live state, asked on mount,
 * every thirty seconds, at each change the live channel announces, and when
 * that channel drops or comes back. A read that fails keeps the last picture,
 * and the freshness says so once three polls in a row have not landed.
 *
 * Every live block of an Event reads through here: the board, the Event home's
 * "Live now" and the display hub's "Now live". `seed` is the server's first
 * picture, drawn before the browser's first read lands.
 */
export function useLiveBoard(eventSlug: string, seed: LiveState | null = null): LiveBoardView {
  const apiUrl = getPublicApiUrl();
  const [state, setState] = useState<LiveState | null>(seed);
  const [loading, setLoading] = useState(seed === null);
  // Stamped only when a read LANDS: a poll that fires and fails must not look
  // like one that works.
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);

  const read = useCallback(async () => {
    const result = await apiRequest<LiveState>(apiUrl, `/api/v1/events/${eventSlug}/live-state`, {
      cache: 'no-store',
    });
    if (result.ok) {
      setState(result.data);
      setLastUpdateAt(Date.now());
    }
    setLoading(false);
  }, [apiUrl, eventSlug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read() kicks off the fetch; intentional on mount.
    void read();
    const timer = setInterval(() => void read(), BOARD_POLL_MS);
    return () => clearInterval(timer);
  }, [read]);

  // One channel for every piste of the Event, aware of the `disable_realtime` switch.
  const liceIds = (state?.lices ?? []).map((l) => l.lice.id);
  const channelStatus = useRealtimeWithFallback({
    channelName: `live-lices-${eventSlug}`,
    table: 'matches',
    filter: `lice_id=in.(${liceIds.join(',')})`,
    event: 'UPDATE',
    enabled: liceIds.length > 0,
    onEvent: () => void read(),
    onFallbackPoll: () => void read(),
  });
  const realtimeDisabled = useRealtimeDisabled();

  const now = useSecondsWhile(boardIsDegraded({ realtimeDisabled, channelStatus }));
  const freshness = boardFreshness({ realtimeDisabled, channelStatus, lastUpdateAt, now });
  return { state, loading, freshness };
}
