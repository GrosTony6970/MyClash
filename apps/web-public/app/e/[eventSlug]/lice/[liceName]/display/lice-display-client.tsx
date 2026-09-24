'use client';

import { useCallback, useEffect, useState } from 'react';
import { LiceWaitingDisplay } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { useRealtimeWithFallback } from '../../../../../../src/lib/supabase-browser';
import { DisplayView } from '../../../match/[matchId]/display/display-view';
import { DisplayControls } from './DisplayControls';
import { EMPTY_BOARD, liceBoardPollMs, readLiceBoard, type LiceBoard } from './lice-board';

interface Props {
  eventSlug: string;
  liceName: string;
}

/**
 * Per-lice public TV display. Subscribes to `matches` filtered by
 * `lice_id` so any state change on this lice — a match starting,
 * ending, or being reassigned — refetches the current+queue payload
 * in sub-second time. Falls back to `<LiceWaitingDisplay>` between
 * matches with the next-up card; delegates to `<DisplayView>` for
 * the per-match TVScoreboard once a current match exists.
 *
 * The channel is anonymous, so an Event that hides anything from the
 * public reaches a signed-in screen by a 5 s poll instead (ruling 92).
 */
export function LiceDisplayClient({ eventSlug, liceName }: Props) {
  const { t } = useI18n();
  const [board, setBoard] = useState<LiceBoard>(EMPTY_BOARD);
  const [lastReadFailed, setLastReadFailed] = useState(false);

  // Single refetch path shared by the initial mount load, every realtime
  // event, the fallback poll and the hidden-board poll. A failed read keeps
  // the last good picture on screen.
  const refresh = useCallback(async () => {
    const next = await readLiceBoard(eventSlug, liceName);
    if (next) setBoard(next);
    setLastReadFailed(next === null);
  }, [eventSlug, liceName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh() kicks off the fetch; intentional on mount.
    void refresh();
  }, [refresh]);

  // Realtime subscription: any matches row on this lice changing —
  // status flip (scheduled→running→completed), schedule/reassignment
  // edit, side flip — triggers a refresh of the current+queue
  // projection, so the screen flips sub-second when a match starts or
  // ends. Flag-aware (disable_realtime) with a polling fallback.
  useRealtimeWithFallback({
    channelName: `lice:${board.liceId}:current`,
    table: 'matches',
    filter: `lice_id=eq.${board.liceId}`,
    enabled: Boolean(board.liceId),
    onEvent: () => void refresh(),
    onFallbackPoll: () => void refresh(),
  });

  // web-public's channel is anonymous and RLS keeps what the Event hides off
  // it: SUBSCRIBED, it still never announces such a bout (ruling 92).
  const pollMs = liceBoardPollMs(board, lastReadFailed);
  useEffect(() => {
    if (pollMs === null) return;
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, refresh]);

  // The control layer rides over BOTH states — it stays invisible until the
  // screen is touched, so it costs the projection nothing either way.
  if (!board.matchId) {
    return (
      <>
        <LiceWaitingDisplay
          eventName={board.eventName}
          liceName={liceName}
          nextMatch={board.nextMatch}
          t={t}
        />
        <DisplayControls eventSlug={eventSlug} currentLiceName={liceName} />
      </>
    );
  }

  return (
    <>
      <DisplayView matchId={board.matchId} eventSlug={eventSlug} />
      <DisplayControls eventSlug={eventSlug} currentLiceName={liceName} />
    </>
  );
}
