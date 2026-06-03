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
import { MedalPodium, type PodiumData } from '@myclash/ui';
import { StandingsTable } from './StandingsTable';
import { BracketLive } from './BracketLive';
import { TournamentTabs, type TabKey } from './TournamentTabs';
import { PoolsCompositionView, type PoolMember, type PoolReferee } from './PoolsCompositionView';

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
          <h1 className="text-xl font-bold text-white mb-2">Tournament not found</h1>
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
          <h1 className="text-xl font-bold text-white mb-2">
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

  const poolsTabVisible = pools.length > 0;
  const standingsTabVisible = pools.length > 0;
  const bracketTabVisible = bracketSlots.length > 0;
  const podiumTabVisible = podiumDecided;

  // Default tab adapts to status. Falls back to the first visible tab
  // when the preferred default isn't available yet.
  const visibleByKey: Record<TabKey, boolean> = {
    pools: poolsTabVisible,
    standings: standingsTabVisible,
    bracket: bracketTabVisible,
    podium: podiumTabVisible,
  };
  const preferredDefault: TabKey =
    tournament.status === 'completed'
      ? 'podium'
      : tournament.status === 'running'
        ? 'standings'
        : 'pools';
  const fallbackOrder: TabKey[] = ['pools', 'standings', 'bracket', 'podium'];
  const defaultTab: TabKey = visibleByKey[preferredDefault]
    ? preferredDefault
    : (fallbackOrder.find((k) => visibleByKey[k]) ?? 'pools');

  return (
    <main className="mx-auto flex max-w-6xl flex-col px-4 py-6">
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

      {!poolsTabVisible && !standingsTabVisible && !bracketTabVisible && !podiumTabVisible ? (
        <div className="py-12 text-center">
          <p className="mb-3 text-4xl">⏳</p>
          <p className="text-slate-500">
            Pools and bracket will appear here once the organizer generates them.
          </p>
        </div>
      ) : (
        <TournamentTabs
          defaultTab={defaultTab}
          tabs={[
            {
              key: 'pools',
              label: 'Pools',
              visible: poolsTabVisible,
              panel: (
                <PoolsCompositionView
                  pools={pools.map((p) => ({
                    id: p.id,
                    name: p.name,
                    members: p.members ?? [],
                    referees: p.referees ?? [],
                  }))}
                  accentColor={accentColor}
                />
              ),
            },
            {
              key: 'standings',
              label: 'Standings',
              visible: standingsTabVisible,
              panel: (
                <div className="flex flex-col gap-6">
                  {pools.map((pool) => (
                    <StandingsTable
                      key={pool.id}
                      poolId={pool.id}
                      poolName={pool.name}
                      initialStandings={pool.standings}
                      tournamentId={tournament.id}
                      apiUrl={apiUrl}
                    />
                  ))}
                </div>
              ),
            },
            {
              key: 'bracket',
              label: 'Bracket',
              visible: bracketTabVisible,
              panel: (
                <BracketLive
                  eventSlug={eventSlug}
                  tournamentSlug={tournamentSlug}
                  apiUrl={apiUrl}
                  initialSlots={bracketSlots}
                  bracketSize={bracketSize}
                  mainBracketSize={mainBracketSize}
                  byeCount={byeCount}
                  byeSeedCount={byeSeedCount}
                  playInMatchCount={playInMatchCount}
                  hasPlayInRound={hasPlayInRound}
                  rounds={bracketRounds}
                  weapon={tournament.weapon}
                />
              ),
            },
            {
              key: 'podium',
              label: 'Podium',
              visible: podiumTabVisible,
              panel:
                podium && podiumDecided ? (
                  <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                    <MedalPodium podium={podium} showBronze={!!podium.bronze || !!podium.fourth} />
                  </div>
                ) : null,
            },
          ]}
        />
      )}
    </main>
  );
}
