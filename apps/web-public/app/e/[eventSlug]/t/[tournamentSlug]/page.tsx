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
import { getServerApiUrl } from '@/lib/api-url';
import { getServerT, resolveServerLocale } from '@/i18n/server-locale';
import { BackLink } from '@/components/BackLink';
import { MedalPodium } from '@myclash/ui';
import { createTranslator, getMessages } from '@myclash/i18n';
import { StandingsView } from './StandingsView';
import { PoolMatchesView } from './PoolMatchesView';
import { BracketLive } from './BracketLive';
import { TournamentTabs, type TabKey } from './TournamentTabs';
import { PoolsCompositionView } from './PoolsCompositionView';
import { ParticipantsTab, type ParticipantsTabEntry } from './ParticipantsTab';
import { FinalRankingTab } from './FinalRankingTab';
import { StatsTab } from './StatsTab';
import { derivePodium, colorTokenToHex, type TournamentData } from './tournament-data';

// Re-exported so the sibling tab components keep importing these types from
// `./page` while the definitions live in the shared `./tournament-data`.
export type { StandingRow, Pool, BracketSlot } from './tournament-data';

interface Props {
  params: Promise<{ eventSlug: string; tournamentSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug, tournamentSlug } = await params;
  const apiUrl = getServerApiUrl();
  const t = await getServerT();
  const outcome = await fetchTournamentData(eventSlug, tournamentSlug, apiUrl);
  if (outcome.kind !== 'ok') return { title: `${tournamentSlug} · MyClash` };
  const { data } = outcome;
  const fighterCount = data.pools.reduce(
    (n, pool) => n + (pool.members?.length ?? pool.standings.length),
    0,
  );
  return {
    title: `${data.tournament.name} · MyClash`,
    description: `${t('publicApp.tournament.fighterCount', { count: fighterCount })} · ${data.tournament.rulesetLabel ?? data.tournament.rulesetCode}`,
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
  const apiUrl = getServerApiUrl();
  const locale = await resolveServerLocale();
  const t = createTranslator(getMessages(locale));

  const outcome = await fetchTournamentData(eventSlug, tournamentSlug, apiUrl);

  if (outcome.kind === 'not-found') {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <p className="text-4xl mb-3">⚔️</p>
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl mb-2">
            {t('publicApp.tournament.errors.notFoundTitle')}
          </h1>
          <p className="text-muted text-sm">{t('publicApp.tournament.errors.notFoundBody')}</p>
        </div>
      </main>
    );
  }

  if (outcome.kind === 'server-error') {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <p className="text-4xl mb-3">⚠️</p>
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl mb-2">
            {t('publicApp.tournament.errors.loadFailedTitle')}
          </h1>
          <p className="text-muted text-sm">{t('publicApp.tournament.errors.loadFailedBody')}</p>
          {(outcome.message || outcome.status) && (
            <details className="mt-4 text-left text-xs text-muted">
              <summary className="cursor-pointer">
                {t('publicApp.tournament.errors.technicalDetails')}
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-surface px-3 py-2 text-muted">
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
    phaseType,
    wbRounds,
    lbRounds,
  } = data;
  const podium = derivePodium(bracketSlots, { phaseType, wbRounds, lbRounds });
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

  // Published AI recap (organizer-reviewed). Null when none is published.
  const recap = await fetchPublishedRecap(tournament.id, apiUrl);

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
  // Statistics tab is visible once public (mirrors bracket/finalranking). The
  // panel fetches on demand and renders its own empty state when there are no
  // exchanges yet, so no need to gate on match data here.
  const statsTabVisible = !isDraft;

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
    stats: statsTabVisible,
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
    'stats',
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
          <p className="mt-0.5 text-sm text-muted">
            {tournament.weapon && `${tournament.weapon} · `}
            {tournament.rulesetLabel ?? tournament.rulesetCode}
            {fighterCount > 0 &&
              ` · ${t('publicApp.tournament.fighterCount', { count: fighterCount })}`}
          </p>
        </div>
      </div>

      {tournament.rulesetRepin && (
        <section className="mb-6 rounded-xl border border-warning/30 bg-warning/10 p-5">
          <h2 className="mb-1 font-display text-lg font-semibold text-warning">
            {t('publicApp.tournament.rulesetChangedTitle')}
          </h2>
          <p className="text-sm text-foreground-secondary">
            {t('publicApp.tournament.rulesetChangedFromTo', {
              from: tournament.rulesetRepin.fromLabel,
              to: tournament.rulesetRepin.toLabel,
            })}
          </p>
          <p className="mt-2 text-sm text-foreground-secondary">
            <span className="font-medium">{t('publicApp.tournament.rulesetChangedReason')}:</span>{' '}
            {tournament.rulesetRepin.justification}
          </p>
          {tournament.rulesetRepin.bucketDiff && (
            <ul className="mt-3 space-y-1">
              {[
                {
                  label: t('publicApp.tournament.lineageGrammar'),
                  status: tournament.rulesetRepin.bucketDiff.grammar,
                },
                {
                  label: t('publicApp.tournament.lineageEndConditions'),
                  status: tournament.rulesetRepin.bucketDiff.endConditions,
                },
                {
                  label: t('publicApp.tournament.lineageRanking'),
                  status: tournament.rulesetRepin.bucketDiff.ranking,
                },
              ].map(({ label, status }) => (
                <li key={label} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      status === 'changed' ? 'bg-warning' : 'bg-success'
                    }`}
                  />
                  <span className="text-foreground-secondary">{label}</span>
                  <span
                    className={`text-xs ${status === 'changed' ? 'text-warning' : 'text-muted'}`}
                  >
                    ·{' '}
                    {status === 'changed'
                      ? t('publicApp.tournament.lineageChanged')
                      : t('publicApp.tournament.lineageSame')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!tournament.rulesetRepin.rankingCompatible && (
            <p className="mt-2 text-sm font-medium text-warning">
              {t('publicApp.tournament.rulesetChangedRankingAffected')}
            </p>
          )}
        </section>
      )}

      {recap && (
        <section className="mb-6 rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-2 font-display text-lg font-semibold text-foreground">
            {t('publicApp.tournament.recapTitle')}
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-secondary">
            {recap}
          </p>
        </section>
      )}

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
                locale={locale}
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
                  phaseType={phaseType}
                  wbRounds={wbRounds}
                  lbRounds={lbRounds}
                  weapon={tournament.weapon}
                  podium={podium}
                  podiumDecided={podiumDecided}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
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
                <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
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
                phaseType={phaseType}
                wbRounds={wbRounds}
                lbRounds={lbRounds}
              />
            ),
          },
          {
            key: 'stats',
            label: t('publicApp.tournament.tabs.stats'),
            visible: statsTabVisible,
            // Load-on-demand: StatsTab fetches the stats projections client-side
            // only when the tab is first opened, so the main tournament page
            // load stays light.
            panel: <StatsTab tournamentId={tournament.id} accentColor={accentColor} />,
          },
        ]}
      />
    </main>
  );
}

/**
 * Published AI recap for the public page. SSR text renders in the default
 * locale (EN), and the public read falls back to EN anyway, so request EN.
 */
async function fetchPublishedRecap(tournamentId: string, apiUrl: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/public/generated-content/tournament_recap/${tournamentId}?locale=en`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string } | null;
    return data?.content ?? null;
  } catch {
    return null;
  }
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
