/**
 * Tournament page — T-605
 * Route: /e/[eventSlug]/t/[tournamentSlug]
 *
 * SSR: fetch tournament + phases + initial standings + bracket.
 * Client: StandingsTable subscribes to Realtime for live updates.
 *
 * AC:
 *   ✓ Pool standings update live (Supabase Realtime)
 *   ✓ Bracket renders for 8/16/32 fighters
 *   ✓ Standings table matches lyonamhe.fr layout (V/Pts+/Pts−/Dbl/Score)
 */

import type { Metadata } from 'next';
import { getApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
import { MedalPodium } from '@myclash/ui';
import { t } from '@myclash/i18n';
import { StandingsView } from './StandingsView';
import { PoolMatchesView } from './PoolMatchesView';
import { BracketLive } from './BracketLive';
import { TournamentTabs, type TabKey } from './TournamentTabs';
import { PoolsCompositionView } from './PoolsCompositionView';
import { ParticipantsTab, type ParticipantsTabEntry } from './ParticipantsTab';
import { FinalRankingTab } from './FinalRankingTab';
import { derivePodium, colorTokenToHex, type TournamentData } from './tournament-data';

// Re-exported so the sibling tab components keep importing these types from
// `./page` while the definitions live in the shared `./tournament-data`.
export type { StandingRow, Pool, BracketSlot } from './tournament-data';

interface Props {
  params: Promise<{ eventSlug: string; tournamentSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug, tournamentSlug } = await params;
  const apiUrl = getApiUrl();
  const outcome = await fetchTournamentData(eventSlug, tournamentSlug, apiUrl);
  if (outcome.kind !== 'ok') return { title: `${tournamentSlug} · MyClash` };
  const { data } = outcome;
  const fighterCount = data.pools.reduce(
    (n, pool) => n + (pool.members?.length ?? pool.standings.length),
    0,
  );
  return {
    title: `${data.tournament.name} · MyClash`,
    description: `${t('publicApp.tournament.fighterCount', { count: fighterCount })} · ${data.tournament.rulesetCode}`,
  };
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

type FetchOutcome =
  | { kind: 'ok'; data: TournamentData }
  | { kind: 'not-found' }
  | { kind: 'server-error'; status: number; message: string | null };

/**
 * Tri-state fetch — preserve the HTTP status so the page can distinguish
 * "tournament URL is wrong" (404) from "backend choked" (400/5xx).
 * The previous boolean collapse made every failure look like
 * "Tournament not found" even when the standings endpoint had a real
 * server-side bug (see post-0063 `user_id` regression: a stale column
 * in a downstream PostgREST query returned 400, which the page
 * rendered as "tournament missing").
 */
async function fetchTournamentData(
  eventSlug: string,
  tournamentSlug: string,
  apiUrl: string,
): Promise<FetchOutcome> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${eventSlug}/tournaments/${tournamentSlug}/standings`,
      { cache: 'no-store' },
    );
    if (res.ok) return { kind: 'ok', data: (await res.json()) as TournamentData };
    if (res.status === 404) return { kind: 'not-found' };
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return {
      kind: 'server-error',
      status: res.status,
      message: body?.message ?? null,
    };
  } catch (err) {
    return {
      kind: 'server-error',
      status: 0,
      message: err instanceof Error ? err.message : null,
    };
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function TournamentPage({ params }: Props) {
  const { eventSlug, tournamentSlug } = await params;
  const apiUrl = getApiUrl();

  const outcome = await fetchTournamentData(eventSlug, tournamentSlug, apiUrl);

  if (outcome.kind === 'not-found') {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <p className="text-4xl mb-3">⚔️</p>
          <h1 className="font-display text-2xl font-bold text-white sm:text-3xl mb-2">
            {t('publicApp.tournament.errors.notFoundTitle')}
          </h1>
          <p className="text-gray-400 text-sm">{t('publicApp.tournament.errors.notFoundBody')}</p>
        </div>
      </main>
    );
  }

  if (outcome.kind === 'server-error') {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <p className="text-4xl mb-3">⚠️</p>
          <h1 className="font-display text-2xl font-bold text-white sm:text-3xl mb-2">
            {t('publicApp.tournament.errors.loadFailedTitle')}
          </h1>
          <p className="text-gray-400 text-sm">{t('publicApp.tournament.errors.loadFailedBody')}</p>
          {(outcome.message || outcome.status) && (
            <details className="mt-4 text-left text-xs text-gray-500">
              <summary className="cursor-pointer">
                {t('publicApp.tournament.errors.technicalDetails')}
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-gray-900 px-3 py-2 text-gray-400">
                {outcome.status ? `HTTP ${outcome.status}\n` : ''}
                {outcome.message ?? ''}
              </pre>
            </details>
          )}
        </div>
      </main>
    );
  }

  const { data } = outcome;

  const {
    tournament,
    pools,
    bracketSlots,
    bracketSize,
    mainBracketSize,
    byeCount,
    byeSeedCount,
    playInMatchCount,
    hasPlayInRound,
    bracketRounds,
  } = data;
  const podium = derivePodium(bracketSlots);
  const podiumDecided = !!(podium?.gold && podium.silver);
  const fighterCount = pools.reduce(
    (n, pool) => n + (pool.members?.length ?? pool.standings.length),
    0,
  );
  const tournamentColor = (tournament as { color?: string | null }).color ?? null;
  const accentColor = colorTokenToHex(tournamentColor);

  // Per-tournament participants — pulled from the event roster and
  // filtered to this tournament. Includes active + waitlist rows.
  const participantsTabEntries = await fetchTournamentParticipants(
    eventSlug,
    tournamentSlug,
    apiUrl,
  );

  // A draft tournament isn't public yet, so it exposes nothing structural —
  // only the Participants list (the Pool/Standings tabs already hide because
  // the API returns empty pools for non-public statuses).
  const isDraft = tournament.status === 'draft';
  const poolsTabVisible = pools.length > 0;
  const standingsTabVisible = pools.length > 0;
  // Bracket tab is visible once the tournament is public — visitors should
  // know the section exists even before the operator generates the bracket
  // (the panel renders a placeholder when bracketSlots is empty). Hidden
  // while still draft.
  const bracketTabVisible = !isDraft;
  const podiumTabVisible = podiumDecided;
  const participantsTabVisible = participantsTabEntries.length > 0;
  // Final Ranking tab is visible once public too — content gates on
  // `tournament.status === 'completed'`; otherwise placeholder. Hidden
  // while still draft.
  const finalRankingTabVisible = !isDraft;

  // Default tab adapts to status. Falls back to the first visible tab
  // when the preferred default isn't available yet.
  const visibleByKey: Record<TabKey, boolean> = {
    participants: participantsTabVisible,
    pools: poolsTabVisible,
    poolmatches: poolsTabVisible,
    standings: standingsTabVisible,
    bracket: bracketTabVisible,
    podium: podiumTabVisible,
    finalranking: finalRankingTabVisible,
  };
  const preferredDefault: TabKey =
    tournament.status === 'completed'
      ? 'finalranking'
      : tournament.status === 'running'
        ? 'standings'
        : 'pools';
  const fallbackOrder: TabKey[] = [
    'participants',
    'pools',
    'poolmatches',
    'standings',
    'bracket',
    'podium',
    'finalranking',
  ];
  const defaultTab: TabKey = visibleByKey[preferredDefault]
    ? preferredDefault
    : (fallbackOrder.find((k) => visibleByKey[k]) ?? 'pools');

  return (
    <main className="mx-auto flex max-w-6xl flex-col px-4 py-6">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={t('publicApp.tournament.backToEventHome')}
        className="mb-4"
      />

      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <div
          className="mt-2 h-12 w-1.5 rounded-full"
          style={{ backgroundColor: accentColor }}
          aria-hidden="true"
        />
        <div className="flex-1">
          <h1
            className="font-display text-2xl font-bold sm:text-3xl"
            style={{ color: accentColor }}
          >
            {tournament.name}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {tournament.weapon && `${tournament.weapon} · `}
            {tournament.rulesetCode}
            {fighterCount > 0 &&
              ` · ${t('publicApp.tournament.fighterCount', { count: fighterCount })}`}
          </p>
        </div>
      </div>

      <TournamentTabs
        defaultTab={defaultTab}
        colorToken={tournamentColor}
        tabs={[
          {
            key: 'participants',
            label: t('publicApp.tournament.tabs.participants'),
            visible: participantsTabVisible,
            panel: <ParticipantsTab entries={participantsTabEntries} />,
          },
          {
            key: 'pools',
            label: t('publicApp.tournament.tabs.poolList'),
            visible: poolsTabVisible,
            panel: (
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
              />
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
              />
            ),
          },
          {
            key: 'standings',
            label: t('publicApp.tournament.tabs.standings'),
            visible: standingsTabVisible,
            panel: (
              <StandingsView
                tournamentId={tournament.id}
                pools={pools}
                bracketSize={bracketSize}
                colorToken={tournamentColor}
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
                  mainBracketSize={mainBracketSize}
                  byeCount={byeCount}
                  byeSeedCount={byeSeedCount}
                  playInMatchCount={playInMatchCount}
                  hasPlayInRound={hasPlayInRound}
                  rounds={bracketRounds}
                  weapon={tournament.weapon}
                  podium={podium}
                  podiumDecided={podiumDecided}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-slate-500">
                  {t('publicApp.tournament.bracket.placeholder')}
                </div>
              ),
          },
          {
            key: 'podium',
            label: t('publicApp.tournament.tabs.podium'),
            visible: podiumTabVisible,
            panel:
              podium && podiumDecided ? (
                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <MedalPodium podium={podium} showBronze={!!podium.bronze || !!podium.fourth} />
                </div>
              ) : null,
          },
          {
            key: 'finalranking',
            label: t('publicApp.tournament.tabs.finalRanking'),
            visible: finalRankingTabVisible,
            panel: (
              <FinalRankingTab
                // Gate on the bracket actually being resolved (a champion +
                // runner-up decided in the completed final), NOT on the
                // tournament's lifecycle status — a fully-played tournament is
                // usually still `published`, never flipped to `completed`, so
                // the old status gate left this empty while the admin (which
                // computes from completed matches) showed it.
                isTournamentCompleted={Boolean(podium?.gold && podium?.silver)}
                tournamentId={tournament.id}
                bracketSlots={bracketSlots}
              />
            ),
          },
        ]}
      />
    </main>
  );
}

async function fetchTournamentParticipants(
  eventSlug: string,
  tournamentSlug: string,
  apiUrl: string,
): Promise<ParticipantsTabEntry[]> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}/participants`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      personId: string;
      displayName: string;
      clubName: string | null;
      clubAbbrev: string | null;
      isReferee?: boolean;
      tournaments: Array<{
        slug: string;
        registrationState: 'active' | 'waitlist';
        waitlistPosition?: number | null;
        hemaRating?: { weightedRating: number; rank: number | null } | null;
      }>;
    }>;
    const entries: ParticipantsTabEntry[] = [];
    for (const person of rows) {
      const tournamentEntry = person.tournaments.find((t) => t.slug === tournamentSlug);
      if (!tournamentEntry) continue;
      entries.push({
        personId: person.personId,
        displayName: person.displayName,
        clubName: person.clubName,
        clubAbbrev: person.clubAbbrev,
        registrationState: tournamentEntry.registrationState,
        waitlistPosition: tournamentEntry.waitlistPosition ?? null,
        isReferee: person.isReferee ?? false,
        hemaRating: tournamentEntry.hemaRating ?? null,
      });
    }
    return entries;
  } catch {
    return [];
  }
}
