'use client';

import { useEffect, useMemo, useState } from 'react';
import { bracketRoundLabel } from '@myclash/types';
import { Card, SkillBadge } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';

type TFn = (key: string, values?: Record<string, string | number>) => string;

interface RefereeHistoryEntry {
  matchId: string;
  role: string | null;
  eventId: string | null;
  eventName: string | null;
  tournamentId: string | null;
  tournamentName: string | null;
  weapon: string | null;
  scheduledAt: string | null;
  durationMs: number;
  skillId: string | null;
  skillName: string | null;
  skillColor: string | null;
  phaseType: string | null;
  poolNumber: number | null;
  bracketRound: number | null;
  bracketSize: number | null;
  cards: { yellow: number; red: number; black: number };
  coReferees: {
    personId: string;
    name: string | null;
    skillId: string | null;
    skillName: string | null;
    skillColor: string | null;
  }[];
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number | null;
  blueScore: number | null;
  winner: 'red' | 'blue' | null;
}

interface RefereeStats {
  totalMatches: number;
  averageRefereeTimeMs: number;
  roles: {
    arbitre_declarant: number;
    arbitre_assesseur: number;
    arbitre_table: number;
  };
  cards: {
    yellow: number;
    red: number;
    black: number;
  };
  bestBuddies: Array<{
    userId: string;
    displayName: string | null;
    matchesTogether: number;
  }>;
  history?: RefereeHistoryEntry[];
}

function formatDuration(ms: number, t: TFn) {
  if (ms <= 0) return t('common.none');
  return t('publicApp.fighterProfile.minutes', { count: Math.round(ms / 60000) });
}

/** Sum of active time as `Xh Ym` (falls back to the minutes string under an hour). */
function formatHoursMinutes(ms: number, t: TFn) {
  if (ms <= 0) return t('common.none');
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return t('publicApp.fighterProfile.minutes', { count: minutes });
  return `${hours}h ${minutes}m`;
}

/** A refereed match's type/tier, used both to group the history tree and to
 *  detect finals / pool-vs-bracket in the stat panel. Pool matches sort first,
 *  then play-ins, then bracket rounds in chronological order (earlier round =
 *  more fighters remaining). */
function roundTier(entry: RefereeHistoryEntry): { key: string; order: number } {
  if (entry.poolNumber != null || entry.phaseType === 'pool') return { key: 'pool', order: 0 };
  if (entry.bracketRound === 0) return { key: 'playin', order: 1 };
  if (entry.bracketRound != null) {
    const code = bracketRoundLabel(entry.bracketRound, entry.bracketSize) || 'other';
    return { key: code, order: 10 + entry.bracketRound };
  }
  return { key: 'other', order: 999 };
}

/** Localized label for a tier key. Named bracket tiers resolve to i18n; any
 *  uncommon raw bracket code (e.g. R128, B2) shows as-is. */
function tierLabel(key: string, t: TFn): string {
  switch (key) {
    case 'pool':
      return t('publicApp.fighterProfile.tierPool');
    case 'playin':
      return t('publicApp.fighterProfile.tierPlayin');
    case 'F':
      return t('publicApp.fighterProfile.tierFinal');
    case 'SF':
      return t('publicApp.fighterProfile.tierSemifinal');
    case 'QF':
      return t('publicApp.fighterProfile.tierQuarterfinal');
    case 'R16':
      return t('publicApp.fighterProfile.tierR16');
    case 'R32':
      return t('publicApp.fighterProfile.tierR32');
    case 'R64':
      return t('publicApp.fighterProfile.tierR64');
    case 'other':
      return t('common.unknown');
    default:
      return key;
  }
}

/** Stable per-event / per-tournament key (falls back to the name when an id is
 *  somehow missing, so grouping never collapses two distinct events). */
function eventKey(entry: RefereeHistoryEntry): string {
  return entry.eventId ?? `name:${entry.eventName ?? 'unknown'}`;
}
function tournamentKey(entry: RefereeHistoryEntry): string {
  return entry.tournamentId ?? `name:${entry.tournamentName ?? 'unknown'}`;
}

interface SkillRef {
  id: string;
  name: string;
  color: string;
}
interface CoRefereeChipData {
  personId: string;
  name: string | null;
  skillName: string | null;
  skillColor: string | null;
}
interface RefereeMatchRow {
  matchId: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  /** Final score per side; null means unresolved, which renders as "-" rather
   *  than a 0 that would read as a genuine shutout. */
  redScore: number | null;
  blueScore: number | null;
  /** Winning side, from the match's recorded winner — null on a draw or an
   *  undecided match. Never inferred from the scores (forfeits invert them). */
  winner: 'red' | 'blue' | null;
  /** The viewer's own role for this match (null when unresolved). */
  viewerRole: SkillRef | null;
  coReferees: CoRefereeChipData[];
}
interface TierGroup {
  key: string;
  order: number;
  matchIds: Set<string>;
  skills: Map<string, SkillRef>;
  matches: Map<string, RefereeMatchRow>;
}
interface TournamentGroup {
  id: string;
  name: string;
  matchIds: Set<string>;
  tiers: Map<string, TierGroup>;
}
interface EventGroup {
  id: string;
  name: string;
  matchIds: Set<string>;
  tournaments: Map<string, TournamentGroup>;
}

/** Group the flat history into event → tournament → match-type tiers. */
function buildRefereeTree(history: RefereeHistoryEntry[], unknown: string): EventGroup[] {
  const events = new Map<string, EventGroup>();
  for (const entry of history) {
    const eId = eventKey(entry);
    const event =
      events.get(eId) ??
      ({
        id: eId,
        name: entry.eventName ?? unknown,
        matchIds: new Set(),
        tournaments: new Map(),
      } satisfies EventGroup);
    event.matchIds.add(entry.matchId);

    const tId = tournamentKey(entry);
    const tournament =
      event.tournaments.get(tId) ??
      ({
        id: tId,
        name: entry.tournamentName ?? unknown,
        matchIds: new Set(),
        tiers: new Map(),
      } satisfies TournamentGroup);
    tournament.matchIds.add(entry.matchId);

    const tier = roundTier(entry);
    const tierGroup =
      tournament.tiers.get(tier.key) ??
      ({
        key: tier.key,
        order: tier.order,
        matchIds: new Set(),
        skills: new Map(),
        matches: new Map(),
      } satisfies TierGroup);
    tierGroup.matchIds.add(entry.matchId);
    const viewerRole: SkillRef | null =
      entry.skillId && entry.skillName && entry.skillColor
        ? { id: entry.skillId, name: entry.skillName, color: entry.skillColor }
        : null;
    if (viewerRole) tierGroup.skills.set(viewerRole.id, viewerRole);
    if (!tierGroup.matches.has(entry.matchId)) {
      tierGroup.matches.set(entry.matchId, {
        matchId: entry.matchId,
        redFighterName: entry.redFighterName,
        blueFighterName: entry.blueFighterName,
        redScore: entry.redScore,
        blueScore: entry.blueScore,
        winner: entry.winner,
        viewerRole,
        coReferees: (entry.coReferees ?? []).map((coRef) => ({
          personId: coRef.personId,
          name: coRef.name,
          skillName: coRef.skillName,
          skillColor: coRef.skillColor,
        })),
      });
    }
    tournament.tiers.set(tier.key, tierGroup);
    event.tournaments.set(tId, tournament);
    events.set(eId, event);
  }
  return [...events.values()].sort((a, b) => b.matchIds.size - a.matchIds.size);
}

export function RefereeProfileClient({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const [stats, setStats] = useState<RefereeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<string>('global');

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/fighters/me/referee-stats`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('referee-stats');
        setStats((await response.json()) as RefereeStats);
      })
      .catch(() => {
        setError(t('publicApp.fighterProfile.loadRefereeStatsError'));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiUrl, t]);

  const history = useMemo(() => stats?.history ?? [], [stats]);
  const tree = useMemo(() => buildRefereeTree(history, t('common.unknown')), [history, t]);

  // Stat panel scoped to Global (all) or a single event.
  const scoped = useMemo(
    () => (scope === 'global' ? history : history.filter((entry) => eventKey(entry) === scope)),
    [history, scope],
  );

  const summary = useMemo(() => {
    const durationByMatch = new Map<string, number>();
    const cardsByMatch = new Map<string, { yellow: number; red: number; black: number }>();
    const skills = new Map<
      string,
      { name: string; color: string; hasBadge: boolean; count: number }
    >();
    const weapons = new Set<string>();
    const events = new Set<string>();
    const tournaments = new Set<string>();
    const poolMatches = new Set<string>();
    const bracketMatches = new Set<string>();
    const finalMatches = new Set<string>();
    let earliestYear: string | null = null;

    for (const entry of scoped) {
      durationByMatch.set(entry.matchId, entry.durationMs);
      cardsByMatch.set(entry.matchId, entry.cards);
      events.add(eventKey(entry));
      tournaments.add(tournamentKey(entry));
      if (entry.weapon) weapons.add(entry.weapon);

      const skillId = entry.skillId ?? entry.role ?? 'unknown';
      const skill = skills.get(skillId) ?? {
        name: entry.skillName ?? entry.role ?? t('common.unknown'),
        color: entry.skillColor ?? 'slate',
        hasBadge: Boolean(entry.skillId && entry.skillColor),
        count: 0,
      };
      skill.count += 1;
      skills.set(skillId, skill);

      const tier = roundTier(entry);
      if (tier.key === 'pool') poolMatches.add(entry.matchId);
      else bracketMatches.add(entry.matchId);
      if (tier.key === 'F') finalMatches.add(entry.matchId);

      const year = entry.scheduledAt?.slice(0, 4);
      if (year && (earliestYear === null || year < earliestYear)) earliestYear = year;
    }

    const durations = [...durationByMatch.values()];
    const totalTimeMs = durations.reduce((sum, value) => sum + value, 0);
    const cards = [...cardsByMatch.values()].reduce(
      (acc, card) => ({
        yellow: acc.yellow + card.yellow,
        red: acc.red + card.red,
        black: acc.black + card.black,
      }),
      { yellow: 0, red: 0, black: 0 },
    );

    return {
      totalMatches: durationByMatch.size,
      averageRefereeTimeMs: durations.length ? Math.round(totalTimeMs / durations.length) : 0,
      totalTimeMs,
      cards,
      cardsTotal: cards.yellow + cards.red + cards.black,
      skills: [...skills.values()]
        .filter((skill) => skill.count > 0)
        .sort((a, b) => b.count - a.count),
      eventsWorked: events.size,
      tournamentsWorked: tournaments.size,
      weaponsWorked: weapons.size,
      poolMatches: poolMatches.size,
      bracketMatches: bracketMatches.size,
      finalsRefereed: finalMatches.size,
      activeSince: earliestYear,
    };
  }, [scoped, t]);

  const toggle = (key: string) =>
    setOpenNodes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (loading) {
    return (
      <Card className="text-sm text-muted">
        {t('publicApp.fighterProfile.loadingRefereeStats')}
      </Card>
    );
  }

  if (error || !stats) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm text-danger">
          {error ?? t('publicApp.fighterProfile.loadRefereeStatsError')}
        </p>
        <p className="mt-2 text-xs text-muted">{t('publicApp.fighterProfile.accessRequired')}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
          {t('publicApp.fighterProfile.refereeHistory')}
        </h2>
        {tree.length ? (
          <div className="flex flex-col gap-2">
            {tree.map((event) => {
              const eventOpen = openNodes.has(event.id);
              return (
                <div key={event.id} className="rounded-lg border border-border bg-background">
                  <AccordionRow
                    open={eventOpen}
                    onToggle={() => toggle(event.id)}
                    title={event.name}
                    count={event.matchIds.size}
                    t={t}
                    strong
                  />
                  {eventOpen && (
                    <div className="border-t border-border px-2 pb-2 pt-1">
                      {[...event.tournaments.values()].map((tournament) => {
                        const tKey = `${event.id}/${tournament.id}`;
                        const tournamentOpen = openNodes.has(tKey);
                        return (
                          <div key={tKey} className="mt-1 first:mt-0">
                            <AccordionRow
                              open={tournamentOpen}
                              onToggle={() => toggle(tKey)}
                              title={tournament.name}
                              count={tournament.matchIds.size}
                              t={t}
                            />
                            {tournamentOpen && (
                              <ul className="mb-1 ml-3 border-l border-border pl-3">
                                {[...tournament.tiers.values()]
                                  .sort((a, b) => a.order - b.order)
                                  .map((tier) => {
                                    const tierKey = `${tKey}/${tier.key}`;
                                    const tierOpen = openNodes.has(tierKey);
                                    return (
                                      <li key={tier.key} className="py-1.5 text-xs text-muted">
                                        <button
                                          type="button"
                                          onClick={() => toggle(tierKey)}
                                          aria-expanded={tierOpen}
                                          className="flex min-h-[36px] w-full flex-wrap items-center gap-2 text-left [touch-action:manipulation]"
                                        >
                                          <Chevron open={tierOpen} />
                                          <span className="font-semibold text-foreground-secondary">
                                            {tierLabel(tier.key, t)}
                                          </span>
                                          <CountBadge count={tier.matchIds.size} t={t} />
                                          {[...tier.skills.values()].map((skill) => (
                                            <SkillBadge
                                              key={skill.id}
                                              color={skill.color}
                                              label={skill.name}
                                              size="xs"
                                            />
                                          ))}
                                        </button>
                                        {tierOpen && (
                                          <ul className="mt-1 ml-6 flex flex-col gap-1.5 border-l border-border pl-3">
                                            {[...tier.matches.values()].map((match) => (
                                              <MatchRow key={match.matchId} match={match} t={t} />
                                            ))}
                                          </ul>
                                        )}
                                      </li>
                                    );
                                  })}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">{t('publicApp.fighterProfile.noRefereeStats')}</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
          {t('publicApp.fighterProfile.refereeing')}
        </h2>

        {/* Global pill + event dropdown — scopes every card below. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setScope('global')}
            aria-pressed={scope === 'global'}
            className={[
              'min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors [touch-action:manipulation]',
              scope === 'global'
                ? 'bg-accent text-accent-foreground'
                : 'border border-border text-muted hover:text-foreground',
            ].join(' ')}
          >
            {t('publicApp.fighterProfile.statsGlobalTab')}
          </button>
          <select
            aria-label={t('publicApp.fighterProfile.statsForEvent')}
            value={scope === 'global' ? '' : scope}
            onChange={(event) => setScope(event.target.value || 'global')}
            className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent [touch-action:manipulation]"
          >
            <option value="">{t('publicApp.fighterProfile.statsForEvent')}</option>
            {tree.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <RefereeStat
            label={t('publicApp.fighterProfile.refereeMatches')}
            value={summary.totalMatches}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.averageRefereeTime')}
            value={formatDuration(summary.averageRefereeTimeMs, t)}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.totalTimeRefereed')}
            value={formatHoursMinutes(summary.totalTimeMs, t)}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.eventsWorked')}
            value={summary.eventsWorked}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.tournamentsWorked')}
            value={summary.tournamentsWorked}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.weaponsRefereed')}
            value={summary.weaponsWorked}
          />
          {summary.skills.map((skill, index) => (
            <SkillStat key={`${skill.name}-${index}`} skill={skill} value={skill.count} />
          ))}
          <RefereeStat
            label={t('publicApp.fighterProfile.finalsRefereed')}
            value={summary.finalsRefereed}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.poolMatches')}
            value={summary.poolMatches}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.bracketMatches')}
            value={summary.bracketMatches}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.yellowCards')}
            value={summary.cards.yellow}
          />
          <RefereeStat label={t('publicApp.fighterProfile.redCards')} value={summary.cards.red} />
          <RefereeStat
            label={t('publicApp.fighterProfile.blackCards')}
            value={summary.cards.black}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.cardsIssued')}
            value={summary.cardsTotal}
          />
          {summary.activeSince && (
            <RefereeStat
              label={t('publicApp.fighterProfile.activeSince')}
              value={summary.activeSince}
            />
          )}
        </div>

        {stats.bestBuddies.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
              {t('publicApp.fighterProfile.bestRefereeBuddies')}
            </h3>
            <ul className="space-y-2 text-sm text-foreground-secondary">
              {stats.bestBuddies.slice(0, 5).map((buddy) => (
                <li key={buddy.userId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {buddy.displayName ?? t('common.unknown')}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {t('publicApp.fighterProfile.matchesTogether', {
                      count: buddy.matchesTogether,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Expandable event/tournament row: chevron + name + match count. */
function AccordionRow({
  open,
  onToggle,
  title,
  count,
  t,
  strong = false,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  count: number;
  t: TFn;
  strong?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left [touch-action:manipulation]"
    >
      <Chevron open={open} />
      <span
        className={[
          'min-w-0 flex-1 truncate',
          strong ? 'text-sm font-semibold text-foreground' : 'text-sm text-foreground-secondary',
        ].join(' ')}
      >
        {title}
      </span>
      <CountBadge count={count} t={t} />
    </button>
  );
}

function CountBadge({ count, t }: { count: number; t: TFn }) {
  return (
    <span
      aria-label={t('publicApp.fighterProfile.matchesRefereedCount', { count })}
      className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-bold tabular-nums text-muted"
    >
      {count}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={['h-4 w-4 shrink-0 text-muted transition-transform', open ? 'rotate-90' : ''].join(
        ' ',
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function RefereeStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <p className="text-[11px] uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/** A stat tile whose label is the referee skill (coloured badge) it counts. */
function SkillStat({
  skill,
  value,
}: {
  skill: { name: string; color: string; hasBadge: boolean };
  value: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <div className="mb-1 flex min-w-0">
        {skill.hasBadge ? (
          <SkillBadge color={skill.color} label={skill.name} size="xs" />
        ) : (
          <p className="truncate text-[11px] uppercase tracking-widest text-muted">{skill.name}</p>
        )}
      </div>
      <p className="text-xl font-black tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/** One refereed match: the two fighters stacked on the left, each in their
 *  corner colour with their score, and the whole referee crew — the viewer
 *  first — as identical pills on the right. */
function MatchRow({ match, t }: { match: RefereeMatchRow; t: TFn }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <span className="flex min-w-0 flex-1 basis-48 flex-col gap-px">
        <FighterLine
          side="red"
          name={match.redFighterName}
          score={match.redScore}
          isWinner={match.winner === 'red'}
          t={t}
        />
        <FighterLine
          side="blue"
          name={match.blueFighterName}
          score={match.blueScore}
          isWinner={match.winner === 'blue'}
          t={t}
        />
      </span>
      <span
        className="flex flex-wrap items-center gap-1.5"
        aria-label={t('publicApp.fighterProfile.refereeCoReferees')}
      >
        {match.viewerRole && (
          <RefereeChip
            name={t('publicApp.fighterProfile.refereeYouChip')}
            skillName={match.viewerRole.name}
            skillColor={match.viewerRole.color}
            isSelf
          />
        )}
        {match.coReferees.length > 0 ? (
          match.coReferees.map((coRef) => (
            <RefereeChip
              key={coRef.personId}
              name={coRef.name ?? t('common.unknown')}
              skillName={coRef.skillName}
              skillColor={coRef.skillColor}
            />
          ))
        ) : (
          <span className="text-[11px] text-muted">
            {t('publicApp.fighterProfile.refereeSoloMatch')}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * Per-side presentation. Painted from the `corner-red`/`corner-blue` semantic
 * tokens rather than the tournament's configured side colours: the
 * referee-stats payload carries no scoring config, so `sideStyle()` has nothing
 * to resolve here — the same reasoning the public match page documents.
 */
const SIDE_STYLE = {
  red: { tint: 'bg-corner-red/10', stripe: 'bg-corner-red', label: 'scoring.liveMatch.red' },
  blue: { tint: 'bg-corner-blue/10', stripe: 'bg-corner-blue', label: 'scoring.liveMatch.blue' },
} as const;

/** One fighter's line: a corner-coloured stripe + soft tint, the name, and the
 *  score — mirroring the bracket MatchCard's FighterRow. The winner is
 *  emphasised; a null score shows "-" so "unknown" stays distinct from a
 *  genuine 0. */
function FighterLine({
  side,
  name,
  score,
  isWinner,
  t,
}: {
  side: 'red' | 'blue';
  name: string | null;
  score: number | null;
  isWinner: boolean;
  t: TFn;
}) {
  const style = SIDE_STYLE[side];
  return (
    <span className={`flex min-h-[22px] items-stretch overflow-hidden rounded-sm ${style.tint}`}>
      <span aria-hidden="true" className={`w-[3px] shrink-0 ${style.stripe}`} />
      <span className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2">
        <span
          className={[
            'min-w-0 truncate text-xs',
            isWinner ? 'font-bold text-foreground' : 'text-foreground-secondary',
          ].join(' ')}
        >
          {/* The stripe is decorative, so the side is spelled out for readers
              that never see it. */}
          <span className="sr-only">{t(style.label)}: </span>
          {name ?? t('common.unknown')}
        </span>
        <span
          className={[
            'shrink-0 font-mono text-xs tabular-nums',
            isWinner ? 'font-bold text-foreground' : 'text-muted',
          ].join(' ')}
        >
          {score ?? '-'}
        </span>
      </span>
    </span>
  );
}

/** One referee on a match: their name paired with their referee-skill badge.
 *  The viewer and their co-referees share this component so the crew reads as
 *  one row of identical pills; `isSelf` only tints it with the accent, the
 *  same self-marking convention the bracket and final-ranking tables use.
 *  Renders the human-readable name only (never the id); the badge is omitted
 *  when the referee has no resolved skill. */
function RefereeChip({
  name,
  skillName,
  skillColor,
  isSelf = false,
}: {
  name: string;
  skillName: string | null;
  skillColor: string | null;
  isSelf?: boolean;
}) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5',
        isSelf ? 'border-accent/40 bg-accent/10' : 'border-border bg-background',
      ].join(' ')}
    >
      <span
        className={[
          'text-[11px]',
          isSelf ? 'font-semibold text-accent' : 'text-foreground-secondary',
        ].join(' ')}
      >
        {name}
      </span>
      {skillName && skillColor && <SkillBadge color={skillColor} label={skillName} size="xs" />}
    </span>
  );
}
