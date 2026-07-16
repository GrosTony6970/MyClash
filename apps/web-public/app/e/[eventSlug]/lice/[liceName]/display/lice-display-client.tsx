'use client';

import { useCallback, useEffect, useState } from 'react';
import { LiceWaitingDisplay, type LiceWaitingDisplayNextMatch } from '@myclash/ui';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { useRealtimeWithFallback } from '../../../../../../src/lib/supabase-browser';
import { getPublicApiUrl } from '../../../../../../src/lib/api-url';
import { DisplayView } from '../../../match/[matchId]/display/display-view';

interface Props {
  eventSlug: string;
  liceName: string;
}

interface LicePayload {
  matchId: string | null;
  eventName: string | null;
  nextMatch: LiceWaitingDisplayNextMatch | null;
}

/**
 * Per-lice public TV display. Subscribes to `matches` filtered by
 * `lice_id` so any state change on this lice — a match starting,
 * ending, or being reassigned — refetches the current+queue payload
 * in sub-second time. Falls back to `<LiceWaitingDisplay>` between
 * matches with the next-up card; delegates to `<DisplayView>` for
 * the per-match TVScoreboard once a current match exists.
 */
export function LiceDisplayClient({ eventSlug, liceName }: Props) {
  const { t } = useI18n();
  const [liceId, setLiceId] = useState<string | null>(null);
  const [payload, setPayload] = useState<LicePayload>({
    matchId: null,
    eventName: null,
    nextMatch: null,
  });

  // Single refetch path shared by the initial mount load and every realtime
  // event / fallback poll. Reads /current and projects what the waiting
  // surface needs (event name + next match) plus the current match id for
  // the DisplayView delegation.
  const refresh = useCallback(async () => {
    // Client-side base URL (browser-reachable public host).
    const apiUrl = getPublicApiUrl();
    const res = await fetch(
      `${apiUrl}/api/v1/events/${eventSlug}/lices/${encodeURIComponent(liceName)}/current`,
      { cache: 'no-store' },
    );
    if (!res.ok) return;
    const body = (await res.json()) as {
      liceId: string;
      liceName: string;
      event: { name?: string | null } | null;
      current: { id: string } | null;
      queue: Array<{
        id: string;
        redFighterName: string | null;
        blueFighterName: string | null;
        roundCode: string | null;
        matchNumberLabel: string | null;
        scoringConfig: LiceWaitingDisplayNextMatch['scoringConfig'];
        tournamentName: string | null;
      }>;
    };
    setLiceId(body.liceId);
    const next = body.queue[0] ?? null;
    setPayload({
      matchId: body.current?.id ?? null,
      eventName: body.event?.name ?? null,
      nextMatch: next
        ? {
            redFighterName: next.redFighterName,
            blueFighterName: next.blueFighterName,
            roundCode: next.roundCode,
            matchNumberLabel: next.matchNumberLabel,
            scoringConfig: next.scoringConfig,
            tournamentName: next.tournamentName,
          }
        : null,
    });
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
    channelName: `lice:${liceId}:current`,
    table: 'matches',
    filter: `lice_id=eq.${liceId}`,
    enabled: Boolean(liceId),
    onEvent: () => void refresh(),
    onFallbackPoll: () => void refresh(),
  });

  if (!payload.matchId) {
    return (
      <LiceWaitingDisplay
        eventName={payload.eventName}
        liceName={liceName}
        nextMatch={payload.nextMatch}
        t={t}
      />
    );
  }

  return <DisplayView matchId={payload.matchId} eventSlug={eventSlug} />;
}
