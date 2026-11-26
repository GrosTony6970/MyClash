'use client';
import { useMemo } from 'react';
import { MatchTimeline, buildUnifiedTimeline, useLiveMatch } from '@myclash/ui';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import type { Translator } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

type T = Translator;

/**
 * The exchange + penalty + protest feed for the expanded bout.
 *
 * This is the only reason to expand a row rather than read it: "three doubles
 * in the last ninety seconds" is the ops signal that a bout is going sideways,
 * and nothing else on the board carries it.
 *
 * Mounted ONLY while a row is expanded, and the board allows exactly one
 * expansion at a time — so this hook, its channel and its five fetches exist
 * for one bout at a time by construction, never per row.
 */
export function BoardRowTimeline({ matchId, t }: { matchId: string; t: T }) {
  // pollMs is deliberately omitted. useLiveMatch polls only when given one (a
  // down channel, a hidden bout), and it refetches five endpoints each time — on a degraded socket
  // that is 5x the load of the board's own 7s poll, which already covers
  // everything the collapsed row shows. A panel open for twenty seconds does
  // not justify that, so a dead socket surfaces as a note instead.
  const { match, exchanges, penalties, protests, connected, loadError } = useLiveMatch(
    getPublicApiUrl(),
    matchId,
    getSupabaseBrowser(),
  );
  const events = useTimelineEvents(match, exchanges, penalties, protests, t);

  if (loadError) {
    return <p className="text-xs text-muted">{t('organizer.live.detail.timelineError')}</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {!connected && (
        <p className="text-xs text-warning">{t('organizer.live.detail.reconnecting')}</p>
      )}
      <MatchTimeline
        events={events}
        // 'page' rather than 'compact'/'tv': those are dark-stage-tuned with a
        // height cap and an auto-pinning scroller. This sits in document flow
        // on a light admin surface.
        scale="page"
        emptyLabel={t('organizer.live.detail.timelineEmpty')}
        ariaLabel={t('organizer.live.detail.timeline')}
        redColour={match?.redColour ?? null}
        blueColour={match?.blueColour ?? null}
        t={t}
      />
    </div>
  );
}

type LiveMatch = ReturnType<typeof useLiveMatch>;

/**
 * Build the unified exchange + penalty feed for the CURRENT snapshot.
 *
 * Names come from this snapshot, not from the board row: the row can be up to
 * 7 s stale mid-rollover, and labelling one bout's exchanges with the next
 * bout's fighters is the quiet kind of wrong.
 */
function useTimelineEvents(
  match: LiveMatch['match'],
  exchanges: LiveMatch['exchanges'],
  penalties: LiveMatch['penalties'],
  protests: LiveMatch['protests'],
  t: T,
) {
  const redName = match?.redFighterName ?? '—';
  const blueName = match?.blueFighterName ?? '—';
  const config = match?.scoringConfig ?? DEFAULT_SCORING_CONFIG;
  return useMemo(
    () =>
      buildUnifiedTimeline({
        exchanges,
        penalties,
        protests,
        redName,
        blueName,
        // Each side's key: a Fighter's Registration or a team. Null before the
        // bout loads or while a side is to come: a card then shows no side.
        redRegId: match?.redSideId ?? null,
        blueRegId: match?.blueSideId ?? null,
        t,
        config,
      }),
    [exchanges, penalties, protests, redName, blueName, match, t, config],
  );
}
