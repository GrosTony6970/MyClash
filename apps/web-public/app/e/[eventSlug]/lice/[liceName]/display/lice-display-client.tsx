'use client';

import { useEffect, useState } from 'react';
import { LiceWaitingDisplay, type LiceWaitingDisplayNextMatch } from '@myclash/ui';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { supabase } from '../../../../../../src/lib/supabase';
import { DisplayView } from '../../../match/[matchId]/display/display-view';

interface Props {
  apiUrl: string;
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
export function LiceDisplayClient({ apiUrl, eventSlug, liceName }: Props) {
  const { t } = useI18n();
  const [liceId, setLiceId] = useState<string | null>(null);
  const [payload, setPayload] = useState<LicePayload>({
    matchId: null,
    eventName: null,
    nextMatch: null,
  });

  // Single refetch path used by both the initial mount load and every
  // subscription event. Reads /current and projects what the waiting
  // surface needs (event name + next match) plus the current match id
  // for the DisplayView delegation.
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventSlug}/lices/${encodeURIComponent(liceName)}/current`,
        { cache: 'no-store' },
      );
      if (!res.ok || cancelled) return;
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
      if (cancelled) return;
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
    }

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, eventSlug, liceName]);

  // Realtime subscription: any matches row on this lice changing —
  // status flip (scheduled→running→completed), schedule/reassignment
  // edit, side flip — triggers a refresh of the current+queue
  // projection. Replaces the previous 5 s polling loop so the screen
  // flips sub-second when a match starts or ends.
  useEffect(() => {
    if (!liceId) return;
    const channel = supabase
      .channel(`lice:${liceId}:current`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `lice_id=eq.${liceId}`,
        },
        () => {
          // Re-read the projection. We can't reuse `refresh` from the
          // other effect (closure isolation), so duplicate the read here.
          // Cheap call (single endpoint, no heavy join) and keeps the
          // subscription effect self-contained.
          void fetch(
            `${apiUrl}/api/v1/events/${eventSlug}/lices/${encodeURIComponent(liceName)}/current`,
            { cache: 'no-store' },
          ).then(async (res) => {
            if (!res.ok) return;
            const body = (await res.json()) as {
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
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [apiUrl, eventSlug, liceName, liceId]);

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
