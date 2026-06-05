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
import { BracketView, MedalPodium, type BracketSlotData, type PodiumData } from '@myclash/ui';
import { supabase } from '@/lib/supabase';
import type { BracketSlot } from './page';

interface Props {
  eventSlug: string;
  tournamentSlug: string;
  apiUrl: string;
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
  apiUrl,
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
}: Props) {
  const router = useRouter();
  const [slots, setSlots] = useState<BracketSlot[]>(initialSlots);
  const [, startTransition] = useTransition();

  async function refresh() {
    try {
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

  return (
    <div role="region" aria-label="Tournament bracket" aria-live="polite">
      {podium && podiumDecided && (
        <div className="mb-6 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <MedalPodium podium={podium} showBronze={!!podium.bronze || !!podium.fourth} />
        </div>
      )}
      <div className="overflow-x-auto pb-4">
        <BracketView
          slots={adminShapeSlots}
          rounds={rounds}
          bracketSize={bracketSize}
          weapon={weapon}
          bracketConfig={{
            phaseType: 'single_elim',
            rounds,
          }}
          onMatchClick={onMatchClick}
        />
      </div>
      <p className="mt-4 text-xs text-slate-500">
        {bracketSize}-fighter bracket
        {mainBracketSize && mainBracketSize !== bracketSize && ` · main ${mainBracketSize}`}
        {hasPlayInRound && playInMatchCount ? ` · ${playInMatchCount} play-in matches` : ''}
        {byeCount ? ` · ${byeCount} byes` : ''}
        {byeSeedCount ? ` · top ${byeSeedCount} seeded` : ''}
      </p>
    </div>
  );
}
