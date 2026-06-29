'use client';

/**
 * BracketLive — public-side live bracket using the admin's @myclash/ui
 * BracketView. Renders read-only: no onOverrideSlot, no onForfeitClick.
 * Clicking a card navigates to /e/<slug>/match/<matchId>.
 *
 * Subscribes to Supabase Realtime on the `matches` table filtered by
 * bracket_slot_id IN slotIds; any change re-fetches the enriched
 * bracket payload so scores + status update without a page reload.
 */

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  BracketView,
  MedalPodium,
  extractBronzeMatch,
  type BracketSlotData,
  type PodiumData,
} from '@myclash/ui';
import { supabase } from '@/lib/supabase';
import { getApiUrl } from '@/lib/api-url';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import type { BracketSlot } from './page';

interface Props {
  eventSlug: string;
  tournamentSlug: string;
  initialSlots: BracketSlot[];
  bracketSize: number;
  mainBracketSize?: number;
  byeCount?: number;
  byeSeedCount?: number;
  playInMatchCount?: number;
  hasPlayInRound?: boolean;
  rounds: number;
  weapon: string | null;
  /** Derived podium (gold/silver/bronze/fourth). Page-level
   *  derivePodium() owns the computation; we only render. */
  podium?: PodiumData;
  /** True when at least gold + silver are decided. Matches the
   *  same gate the Podium tab uses so an in-progress bracket
   *  doesn't render "results pending" tiles above the cards. */
  podiumDecided?: boolean;
  /** Personal space: mark the viewer's own slots with a "YOU" chip. */
  highlightRegistrationId?: string | null;
}

interface TournamentDataLike {
  bracketSlots: BracketSlot[];
  bracketSize: number;
  mainBracketSize?: number;
  byeCount?: number;
  byeSeedCount?: number;
  playInMatchCount?: number;
  hasPlayInRound?: boolean;
  bracketRounds: number;
}

export function BracketLive({
  eventSlug,
  tournamentSlug,
  initialSlots,
  bracketSize,
  mainBracketSize,
  byeCount,
  byeSeedCount,
  playInMatchCount,
  hasPlayInRound,
  rounds,
  weapon,
  podium,
  podiumDecided,
  highlightRegistrationId,
}: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [slots, setSlots] = useState<BracketSlot[]>(initialSlots);
  const [, startTransition] = useTransition();

  async function refresh() {
    try {
      // Resolve client-side — the public (browser-reachable) URL.
      const apiUrl = getApiUrl();
      const res = await fetch(
        `${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}/tournaments/${encodeURIComponent(tournamentSlug)}/standings`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const data = (await res.json()) as TournamentDataLike;
      startTransition(() => setSlots(data.bracketSlots));
    } catch {
      // Swallow — keep the previous slot data.
    }
  }

  useEffect(() => {
    const slotIds = initialSlots.map((s) => s.id);
    if (slotIds.length === 0) return;

    const channel = supabase
      .channel(`bracket-${tournamentSlug}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `bracket_slot_id=in.(${slotIds.join(',')})`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentSlug]);

  function onMatchClick(matchId: string | null) {
    if (!matchId) return;
    router.push(`/e/${eventSlug}/match/${matchId}`);
  }

  const adminShapeSlots: BracketSlotData[] = slots.map((s) => ({
    id: s.id,
    round: s.round,
    position: s.position,
    redFighterName: s.redFighterName,
    blueFighterName: s.blueFighterName,
    redClubAbbrev: (s as { redClubAbbrev?: string | null }).redClubAbbrev ?? null,
    blueClubAbbrev: (s as { blueClubAbbrev?: string | null }).blueClubAbbrev ?? null,
    redScore: s.redScore,
    blueScore: s.blueScore,
    status: s.status,
    matchId: s.matchId,
    redRegistrationId: (s as { redRegistrationId?: string | null }).redRegistrationId ?? null,
    blueRegistrationId: (s as { blueRegistrationId?: string | null }).blueRegistrationId ?? null,
  }));

  // Extract the bronze final so BracketView renders it separately
  // below the gold final — without this split, both finals collapse
  // to a single card at the SF midpoint and the bronze disappears.
  // Matches the admin bracket page's call shape.
  const { bronze, mainSlots } = extractBronzeMatch(adminShapeSlots);

  return (
    <div
      role="region"
      aria-label={t('publicApp.tournament.bracket.regionLabel')}
      aria-live="polite"
    >
      {podium && podiumDecided && (
        <div className="mb-6 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <MedalPodium podium={podium} showBronze={!!podium.bronze || !!podium.fourth} />
        </div>
      )}
      {/* No outer overflow-x-auto here — BracketView has its own
          internal scroll container. Nesting two overflow:auto
          parents caused the connector SVG's ResizeObserver to
          observe stale dimensions and render empty paths on
          first paint (admin uses a single non-scrolling wrapper
          and renders connectors fine). */}
      <BracketView
        slots={mainSlots}
        rounds={rounds}
        bracketSize={bracketSize}
        weapon={weapon}
        bracketConfig={{
          phaseType: 'single_elim',
          rounds,
        }}
        bronzeMatch={bronze}
        onMatchClick={onMatchClick}
        highlightRegistrationId={highlightRegistrationId}
        youLabel={t('publicApp.me.hub.youChip')}
      />
      <p className="mt-4 text-xs text-slate-500">
        {t('publicApp.tournament.bracket.summarySize', { count: bracketSize })}
        {mainBracketSize &&
          mainBracketSize !== bracketSize &&
          ` · ${t('publicApp.tournament.bracket.summaryMain', { count: mainBracketSize })}`}
        {hasPlayInRound && playInMatchCount
          ? ` · ${t('publicApp.tournament.bracket.summaryPlayIn', { count: playInMatchCount })}`
          : ''}
        {byeCount ? ` · ${t('publicApp.tournament.bracket.summaryByes', { count: byeCount })}` : ''}
        {byeSeedCount
          ? ` · ${t('publicApp.tournament.bracket.summarySeeded', { count: byeSeedCount })}`
          : ''}
      </p>
    </div>
  );
}
