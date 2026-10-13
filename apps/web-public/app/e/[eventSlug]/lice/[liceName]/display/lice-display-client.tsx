'use client';

import { useEffect } from 'react';
import { LiceWaitingDisplay, useDisplayMirror } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { useRealtimeWithFallback } from '../../../../../../src/lib/supabase-browser';
import { DisplayView } from '../../../match/[matchId]/display/display-view';
import { DisplayControls } from './DisplayControls';
import { ScreenSettings } from './ScreenSettings';
import { liceBoardPollMs } from './lice-board';
import { usePisteScreen } from './use-piste-screen';

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
 * the per-match TVScoreboard once a current match exists. A match that
 * is over stays for its winner's card (`usePisteScreen`).
 *
 * The channel is anonymous, so an Event that hides anything from the
 * public reaches a signed-in screen by a 5 s poll instead (ruling 92).
 */
export function LiceDisplayClient({ eventSlug, liceName }: Props) {
  const { t } = useI18n();
  // Single refetch path (`refresh`) shared by the initial mount load, every
  // realtime event, the fallback poll and the hidden-board poll. The bout on
  // screen (`shown`) is not always the bout the piste names: a bout that is
  // over keeps the screen for its card's time.
  const { board, shown, rereadSignal, lastReadFailed, refresh, cardDone } = usePisteScreen(
    eventSlug,
    liceName,
  );

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

  // Not swapped until somebody swaps it: the public piste TV opens as it always did.
  const [mirror, toggleMirror] = useDisplayMirror(false);

  // The control layer rides over BOTH states — it stays invisible until the
  // screen is touched, so it costs the projection nothing either way.
  const controls = (
    <DisplayControls
      eventSlug={eventSlug}
      currentLiceName={liceName}
      settings={<ScreenSettings mirror={mirror} onToggleMirror={toggleMirror} />}
    />
  );

  if (!shown) {
    return (
      <>
        <LiceWaitingDisplay
          eventName={board.eventName}
          liceName={liceName}
          nextMatch={board.nextMatch}
          mirror={mirror}
          t={t}
        />
        {controls}
      </>
    );
  }

  return (
    <>
      <DisplayView
        matchId={shown}
        eventSlug={eventSlug}
        onBoutOver={cardDone}
        rereadSignal={rereadSignal}
        mirror={mirror}
      />
      {controls}
    </>
  );
}
