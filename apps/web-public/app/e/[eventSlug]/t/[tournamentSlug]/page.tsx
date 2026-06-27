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

/* eslint-disable myclash/no-literal-string */

import type { Metadata } from 'next';
import { getApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
import { MedalPodium, type PodiumData } from '@myclash/ui';
import { t } from '@myclash/i18n';
import { StandingsView } from './StandingsView';
import { PoolMatchesView } from './PoolMatchesView';
import { BracketLive } from './BracketLive';
import { TournamentTabs, type TabKey } from './TournamentTabs';
import { PoolsCompositionView, type PoolMember, type PoolReferee } from './PoolsCompositionView';
import { ParticipantsTab, type ParticipantsTabEntry } from './ParticipantsTab';
import { FinalRankingTab } from './FinalRankingTab';

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
    description: `${fighterCount} fighters · ${data.tournament.rulesetCode}`,
  };
}

// ── API types ─────────────────────────────────────────────────────────────────

export interface StandingRow {
  registrationId: string;
  fighterName: string;
  clubName: string | null;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  doubles: number;
  score: number;
  seed: number;
}

export interface Pool {
  id: string;
  name: string;
  members: PoolMember[];
  referees: PoolReferee[];
  standings: StandingRow[];
  /** Pool's lice (piste) + start time, derived server-side from its matches —
   *  drives the Pool List's start-time sections + per-card piste badge. */
  liceName?: string | null;
  liceColorHex?: string | null;
  startAt?: string | null;
}

export interface BracketSlot {
  id: string;
  round: number;
  position: number;
  redFighterName: string | null;
  blueFighterName: string | null;
  redClubAbbrev?: string | null;
  blueClubAbbrev?: string | null;
  redScore: number | null;
  blueScore: number | null;
  status: string;
  matchId: string | null;
  redRegistrationId?: string | null;
  blueRegistrationId?: string | null;
}

interface Tournament {
  id: string;
  name: string;
  weapon: string | null;
  rulesetCode: string;
  status: string;
  /**
   * Optional brand color token (e.g. 'red', 'blue', 'amber'). The
   * page resolves it via colorTokenToHex for the legacy stripe/title
   * paint AND threads the raw token through TournamentTabs +
   * PoolsCompositionView so @myclash/ui's color-token helpers can
   * paint the accent borders + section titles.
   */
  color?: string | null;
}

interface TournamentData {
  tournament: Tournament;
  pools: Pool[];
  bracketSlots: BracketSlot[];
  bracketSize: number;
  mainBracketSize?: number;
  byeCount?: number;
  byeSeedCount?: number;
  playInMatchCount?: number;
  hasPlayInRound?: boolean;
  bracketRounds: number;
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

// ── Podium derivation ─────────────────────────────────────────────────────────

/** Compute the gold/silver/bronze/4th from bracketSlots. By convention
 *  position 1 at maxRound is the final; position 2 (when present) is the
 *  bronze match. Returns undefined when no bracket data is available. */
function derivePodium(bracketSlots: BracketSlot[]): PodiumData | undefined {
  if (bracketSlots.length === 0) return undefined;
  const maxRound = bracketSlots.reduce((m, s) => Math.max(m, s.round), 0);
  const final = bracketSlots.find((s) => s.round === maxRound && s.position === 1) ?? null;
  const bronze = bracketSlots.find((s) => s.round === maxRound && s.position === 2) ?? null;
  if (!final && !bronze) return undefined;
  const winnerName = (s: BracketSlot | null) => {
    if (!s || s.status !== 'completed') return null;
    const rs = s.redScore ?? 0;
    const bs = s.blueScore ?? 0;
    if (rs === bs) return null;
    const name = rs > bs ? s.redFighterName : s.blueFighterName;
    return name ? { fighterName: name } : null;
  };
  const loserName = (s: BracketSlot | null) => {
    if (!s || s.status !== 'completed') return null;
    const rs = s.redScore ?? 0;
    const bs = s.blueScore ?? 0;
    if (rs === bs) return null;
    const name = rs > bs ? s.blueFighterName : s.redFighterName;
    return name ? { fighterName: name } : null;
  };
  return {
    gold: winnerName(final),
    silver: loserName(final),
    bronze: winnerName(bronze),
    fourth: loserName(bronze),
  };
}

// ── Tournament colour stripe ─────────────────────────────────────────────────

function colorTokenToHex(token: string | null | undefined): string {
  switch (token) {
    case 'red':
      return '#ef4444';
    case 'orange':
      return '#f97316';
    case 'amber':
      return '#f59e0b';
    case 'yellow':
      return '#eab308';
    case 'green':
      return '#22c55e';
    case 'teal':
      return '#14b8a6';
    case 'blue':
      return '#3b82f6';
    case 'violet':
      return '#8b5cf6';
    case 'purple':
      return '#a855f7';
    case 'pink':
      return '#ec4899';
    case 'gold':
      return '#facc15';
    case 'silver':
      return '#cbd5e1';
    case 'bronze':
      return '#d97706';
    default:
      return '#64748b';
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
            Tournament not found
          </h1>
          <p className="text-gray-400 text-sm">
            Check the URL or come back when the schedule is published.
          </p>
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
            This tournament couldn&apos;t be loaded
          </h1>
          <p className="text-gray-400 text-sm">
            Please retry — if it keeps happening, let the organizer know.
          </p>
          {(outcome.message || outcome.status) && (
            <details className="mt-4 text-left text-xs text-gray-500">
              <summary className="cursor-pointer">Technical details</summary>
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
            {fighterCount > 0 && ` · ${fighterCount} fighters`}
          </p>
        </div>
      </div>

      <TournamentTabs
        defaultTab={defaultTab}
        colorToken={tournamentColor}
        tabs={[
          {
            key: 'participants',
            label: 'Participants',
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
                  No bracket yet — the bracket will appear here once the tournament&apos;s
                  elimination phase is generated.
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
            label: 'Final Ranking',
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
                podium={podium ?? null}
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
