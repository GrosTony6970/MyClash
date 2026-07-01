'use client';

/**
 * In-app tournament view for the personal space. Renders the SAME tab content
 * as the public `/e/[eventSlug]/t/[tournamentSlug]` page (Pools · Pool matches ·
 * Standings · Bracket · Final ranking) but inside the `/me` shell, and
 * highlights the logged-in user's own row/slot via `highlightRegistrationId`
 * (their registration id for this tournament; null when they're referee-only).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getApiUrl } from '@/lib/api-url';
import { useI18n } from '@/i18n/I18nProvider';
import { useMyEvents } from '@/components/me/hooks';
import { HubLoading, HubNotFound } from '@/components/me/EventHubChrome';
import {
  derivePodium,
  colorTokenToHex,
  type TournamentData,
} from '../../../../../e/[eventSlug]/t/[tournamentSlug]/tournament-data';
import { StandingsView } from '../../../../../e/[eventSlug]/t/[tournamentSlug]/StandingsView';
import { PoolMatchesView } from '../../../../../e/[eventSlug]/t/[tournamentSlug]/PoolMatchesView';
import { BracketLive } from '../../../../../e/[eventSlug]/t/[tournamentSlug]/BracketLive';
import {
  TournamentTabs,
  type TabKey,
} from '../../../../../e/[eventSlug]/t/[tournamentSlug]/TournamentTabs';
import { PoolsCompositionView } from '../../../../../e/[eventSlug]/t/[tournamentSlug]/PoolsCompositionView';
import { PoolListSelfFocus } from '../../../../../e/[eventSlug]/t/[tournamentSlug]/PoolListSelfFocus';
import { buildSelfPoolHighlight } from '../../../../../e/[eventSlug]/t/[tournamentSlug]/self-pool-highlight';
import { FinalRankingTab } from '../../../../../e/[eventSlug]/t/[tournamentSlug]/FinalRankingTab';

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export default function PersonalTournamentPage() {
  const { eventSlug, tournamentSlug } = useParams<{ eventSlug: string; tournamentSlug: string }>();
  const { t } = useI18n();
  const { events, loading } = useMyEvents();
  const [data, setData] = useState<TournamentData | null>(null);
  const [notFound, setNotFound] = useState(false);

  const myEvent = events?.find((e) => e.event.slug === eventSlug) ?? null;
  // The viewer's registration in THIS tournament (null when referee-only).
  const highlightRegistrationId =
    myEvent?.tournaments.find((tr) => tr.slug === tournamentSlug)?.registrationId ?? null;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `${getApiUrl()}/api/v1/events/${eventSlug}/tournaments/${tournamentSlug}/standings`,
      { credentials: 'include', cache: 'no-store', signal: controller.signal },
    )
      .then(async (res) => {
        if (res.ok) setData((await res.json()) as TournamentData);
        else setNotFound(true);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setNotFound(true);
      });
    return () => controller.abort();
  }, [eventSlug, tournamentSlug]);

  if (loading || (!data && !notFound)) return <HubLoading />;
  if (notFound || !data) return <HubNotFound />;

  const { tournament, pools, bracketSlots, bracketSize, bracketRounds } = data;
  // Resolve which pools are "yours" (fight in and/or referee) for the Pool List
  // ring + name highlight + auto-scroll. Empty/null when the viewer has no role
  // in this tournament. The bracket self-focus is driven separately inside
  // BracketLive off highlightRegistrationId.
  const self = buildSelfPoolHighlight({
    refereeOf: myEvent?.refereeOf ?? [],
    tournamentName: tournament.name,
    pools,
    highlightRegistrationId,
  });
  const podium = derivePodium(bracketSlots);
  const podiumDecided = !!(podium?.gold && podium.silver);
  const tournamentColor = tournament.color ?? null;
  const accentColor = colorTokenToHex(tournamentColor);

  const isDraft = tournament.status === 'draft';
  const poolsTabVisible = pools.length > 0;
  const bracketTabVisible = !isDraft;
  const finalRankingTabVisible = !isDraft;

  const visibleByKey: Partial<Record<TabKey, boolean>> = {
    pools: poolsTabVisible,
    poolmatches: poolsTabVisible,
    standings: poolsTabVisible,
    bracket: bracketTabVisible,
    finalranking: finalRankingTabVisible,
  };
  const preferredDefault: TabKey =
    tournament.status === 'completed'
      ? 'finalranking'
      : tournament.status === 'running'
        ? 'standings'
        : 'pools';
  const fallbackOrder: TabKey[] = ['pools', 'poolmatches', 'standings', 'bracket', 'finalranking'];
  const defaultTab: TabKey = visibleByKey[preferredDefault]
    ? preferredDefault
    : (fallbackOrder.find((k) => visibleByKey[k]) ?? 'pools');

  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-2xl lg:max-w-6xl">
      <div className="sticky top-16 z-10 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <Link
          href={`/me/events/${eventSlug}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-foreground"
        >
          <BackIcon />
          {t('publicApp.me.hub.backToOverview')}
        </Link>
        <h1 className="mt-1 font-display text-xl font-bold text-foreground">{tournament.name}</h1>
        <p className="text-xs text-muted">
          {tournament.weapon && `${tournament.weapon} · `}
          {tournament.rulesetCode}
        </p>
      </div>

      <div className="px-4 py-4">
        <TournamentTabs
          defaultTab={defaultTab}
          colorToken={tournamentColor}
          tabs={[
            {
              key: 'pools',
              label: t('publicApp.tournament.tabs.poolList'),
              visible: poolsTabVisible,
              panel: (
                <>
                  <PoolListSelfFocus targetPoolId={self.scrollTargetPoolId} />
                  <PoolsCompositionView
                    pools={pools.map((p) => ({
                      id: p.id,
                      name: p.name,
                      members: p.members ?? [],
                      referees: p.referees ?? [],
                      liceName: p.liceName ?? null,
                      liceColorHex: p.liceColorHex ?? null,
                      startAt: p.startAt ?? null,
                    }))}
                    accentColor={accentColor}
                    colorToken={tournamentColor}
                    highlightRegistrationId={highlightRegistrationId}
                    ringPoolIds={self.ringPoolIds}
                    refereeRowKeys={self.refereeRowKeys}
                    wide
                  />
                </>
              ),
            },
            {
              key: 'poolmatches',
              label: t('publicApp.tournament.tabs.poolMatches'),
              visible: poolsTabVisible,
              panel: (
                <PoolMatchesView
                  eventSlug={eventSlug}
                  tournamentSlug={tournamentSlug}
                  colorToken={tournamentColor}
                  highlightRegistrationId={highlightRegistrationId}
                />
              ),
            },
            {
              key: 'standings',
              label: t('publicApp.tournament.tabs.standings'),
              visible: poolsTabVisible,
              panel: (
                <StandingsView
                  tournamentId={tournament.id}
                  pools={pools}
                  bracketSize={bracketSize}
                  colorToken={tournamentColor}
                  highlightRegistrationId={highlightRegistrationId}
                />
              ),
            },
            {
              key: 'bracket',
              label: t('publicApp.tournament.tabs.bracket'),
              visible: bracketTabVisible,
              panel:
                bracketSlots.length > 0 ? (
                  <BracketLive
                    eventSlug={eventSlug}
                    tournamentSlug={tournamentSlug}
                    initialSlots={bracketSlots}
                    bracketSize={bracketSize}
                    mainBracketSize={data.mainBracketSize}
                    byeCount={data.byeCount}
                    byeSeedCount={data.byeSeedCount}
                    playInMatchCount={data.playInMatchCount}
                    hasPlayInRound={data.hasPlayInRound}
                    rounds={bracketRounds}
                    weapon={tournament.weapon}
                    podium={podium}
                    podiumDecided={podiumDecided}
                    highlightRegistrationId={highlightRegistrationId}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
                    {t('publicApp.tournament.bracket.placeholder')}
                  </div>
                ),
            },
            {
              key: 'finalranking',
              label: t('publicApp.tournament.tabs.finalRanking'),
              visible: finalRankingTabVisible,
              panel: (
                <FinalRankingTab
                  isTournamentCompleted={Boolean(podium?.gold && podium?.silver)}
                  tournamentId={tournament.id}
                  bracketSlots={bracketSlots}
                  highlightRegistrationId={highlightRegistrationId}
                />
              ),
            },
          ]}
        />
      </div>
    </main>
  );
}
