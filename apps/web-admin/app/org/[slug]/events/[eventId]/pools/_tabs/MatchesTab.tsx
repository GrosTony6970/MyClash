'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { t } from '@myclash/i18n';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { useI18n } from '@/i18n/I18nProvider';
import { sideStyle, statusPillTone, matchStatusSemantic, StatusHelp } from '@myclash/ui';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { parseSideColors, type SideColors } from './parse-side-colors';
import { mergeScores, type MatchScoreUpdate } from './match-scores-merge';
import { countPoolFighters } from './count-pool-fighters';
import { buildMatchScoringHref, STAFF_APP_PREFIX } from './build-scoring-href';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

// Pinned header cells. `border-collapse` (Tailwind preflight) makes the TABLE
// paint every border, so a `border-b` on a sticky row stays behind at its
// original position and scrolls away with the body. The inset shadow is drawn
// by the cell itself and travels with it — same trick as the sticky Actions
// column in the organiser Persons table. The fill has to live on the cells
// too: a pinned row group backed only at the <thead>/<tr> level lets match
// rows show through.
const APPLY_ROW_TH = 'bg-surface shadow-[inset_0_-1px_0_var(--color-border)]';
const HEAD_ROW_TH = 'bg-background shadow-[inset_0_-1px_0_var(--color-border)]';

interface RefereeAssignment {
  role: string;
  refereeId: string;
  refereeName: string;
}

interface MatchRow {
  id: string;
  pool_id: string;
  round_number: number;
  red_registration_id: string;
  blue_registration_id: string;
  red_name: string;
  red_club_abbrev: string | null;
  blue_name: string;
  blue_club_abbrev: string | null;
  red_score: number | null;
  blue_score: number | null;
  status: string;
  lice_id: string | null;
  referee_id: string | null;
  match_number_label: string | null;
  /** Canonical round code (e.g. `LSW-P1-M1`) built on the backend
   *  by `listPoolsWithMatches`. The scoreboard ships the same field via
   *  `getMatchSummary` — render it verbatim, do not re-format here. */
  roundCode: string;
  /** Per-role assignments from `referee_assignments` (scope_type='match').
   *  One entry per role the operator has assigned a referee to. The pool
   *  tab renders one column per configured role, falling back to
   *  "Unassigned" when no entry exists for that role. */
  referees: RefereeAssignment[];
}

interface RoleConfig {
  id: string;
  displayName: string;
}

interface PoolWithMatches {
  poolId: string;
  poolName: string;
  matches: MatchRow[];
}

interface Lice {
  id: string;
  name: string;
}

// Shape returned by GET /api/v1/events/:eventId/referees — mirrors
// EventRefereeRow in apps/api/src/modules/referees/qualifications.service.ts.
// Post-0063, personId is global_persons.id — the canonical key matching
// referee_qualifications.person_id, event_referees.person_id, and
// referee_assignments.person_id (the persist target on
// PUT /matches/:id/referee-role-assignments).
interface Referee {
  personId: string;
  displayName: string;
  clubLabel: string | null;
  /** Per-role qualifications. We rebuild the role-to-personId map locally
   *  to filter dropdown options per slot's role. */
  qualifications: Array<{ skillId: string; rating: number | null }>;
}

interface MatchesTabProps {
  tournamentId: string;
  poolPhaseId: string;
  slug: string;
  eventId: string;
}

export function MatchesTab({ tournamentId, poolPhaseId, slug, eventId }: MatchesTabProps) {
  const [pools, setPools] = useState<PoolWithMatches[]>([]);
  const [sideColors, setSideColors] = useState<SideColors>({ red: 'red', blue: 'blue' });
  const [lices, setLices] = useState<Lice[]>([]);
  const [referees, setReferees] = useState<Referee[]>([]);
  const [roleConfig, setRoleConfig] = useState<RoleConfig[]>([]);
  const [qualifiedRefereesByRole, setQualifiedRefereesByRole] = useState<Map<string, Set<string>>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Use the scoreboard's exact side-colour palette so the fighter pills match
  // the configured tournament colours (and the live scoreboard) one-for-one.
  const sideConfig = { ...DEFAULT_SCORING_CONFIG, display: { sideColors } };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch lifecycle: loading flag toggled before the network call resolves
    setLoading(true);
    void Promise.all([
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/pools-with-matches`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : [])),
      // Post-0063: /events/:id/referees returns EventRefereeRow[] keyed
      // on global_persons.id, with qualifications embedded. The old
      // /persons?is_referee=true endpoint ignored the query param and
      // returned event-scoped persons.id values that no longer matched
      // the qualifications + referee_assignments identifier space.
      fetch(`${apiUrl}/api/v1/events/${eventId}/referees`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/pool-match-role-config`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : { roles: [] })),
    ]).then(([poolsData, tournamentData, licesData, refereesData, roleConfigData]) => {
      setPools(poolsData as PoolWithMatches[]);
      setSideColors(parseSideColors(tournamentData));
      setLices(licesData as Lice[]);
      const refs = refereesData as Referee[];
      setReferees(refs);
      setRoleConfig((roleConfigData as { roles: RoleConfig[] }).roles ?? []);
      // Build role → Set<personId> map for fast filtering when
      // populating each role-column's dropdown options. Source of truth
      // is the qualifications array embedded on each EventRefereeRow.
      const qualByRole = new Map<string, Set<string>>();
      for (const ref of refs) {
        for (const q of ref.qualifications) {
          const set = qualByRole.get(q.skillId) ?? new Set<string>();
          set.add(ref.personId);
          qualByRole.set(q.skillId, set);
        }
      }
      setQualifiedRefereesByRole(qualByRole);
      setLoading(false);
    });
  }, [tournamentId, eventId, poolPhaseId, refreshKey]);

  // Surgical sync: pull (id, status, red_score, blue_score) only and
  // merge in place. Used by both the manual entry-point and the 30s
  // fallback poll. Object identity on unchanged rows lets React skip
  // the re-render → open <select> dropdowns stay open, no flicker.
  const syncScores = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/match-scores`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const updates = (await res.json()) as MatchScoreUpdate[];
      setPools((prev) => mergeScores(prev, updates));
    } catch {
      // Network blip — leave state untouched. Next poll cycle retries.
    }
  }, [tournamentId]);

  useRealtimeWithFallback({
    channelName: `pool-matches-list-${tournamentId}`,
    table: 'matches',
    filter: `phase_id=eq.${poolPhaseId}`,
    event: '*',
    onEvent: (payload) => {
      const incoming = payload.new as MatchRow | null;
      if (!incoming) return;
      setPools((prev) =>
        prev.map((pool) => ({
          ...pool,
          matches: pool.matches.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m)),
        })),
      );
    },
    // Was: `refresh` (full refetch). The lighter path keeps the table
    // mounted; only changed rows re-render. The "Refresh" button at
    // the top of the tab still calls full `refresh` for an explicit
    // operator override.
    onFallbackPoll: () => void syncScores(),
    fallbackPollMs: 30_000,
  });

  async function updateMatchAssignment(
    matchId: string,
    field: 'liceId' | 'refereeId',
    value: string | null,
  ) {
    const dbField = field === 'liceId' ? 'lice_id' : 'referee_id';
    setPools((prev) =>
      prev.map((pool) => ({
        ...pool,
        matches: pool.matches.map((m) => (m.id === matchId ? { ...m, [dbField]: value } : m)),
      })),
    );
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error('Update failed');
    } catch (err) {
      console.error('Match assignment update failed:', err);
      refresh();
    }
  }

  function refereeLabel(r: Referee): string {
    if (r.displayName) return r.displayName;
    // Anonymous fallback — keeps the picker readable when a person row
    // has no display name on file, instead of surfacing a raw UUID.
    return `Anonymous (${r.personId.slice(0, 6)})`;
  }

  async function updateMatchRoleAssignment(
    matchId: string,
    role: string,
    refereeId: string | null,
  ) {
    // Optimistic: rewrite the referees array for this match (replace
    // existing entry for `role`, or drop it when refereeId is null).
    setPools((prev) =>
      prev.map((pool) => ({
        ...pool,
        matches: pool.matches.map((m) => {
          if (m.id !== matchId) return m;
          const others = m.referees.filter((a) => a.role !== role);
          if (refereeId === null) return { ...m, referees: others };
          const ref = referees.find((r) => r.personId === refereeId);
          const refName = ref ? refereeLabel(ref) : refereeId;
          return {
            ...m,
            referees: [...others, { role, refereeId, refereeName: refName }],
          };
        }),
      })),
    );
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/referee-role-assignments`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, refereeId }),
      });
      if (!res.ok) throw new Error('Role assignment update failed');
    } catch (err) {
      console.error('Referee role assignment failed:', err);
      refresh();
    }
  }

  // ── Pool-wide assignments ───────────────────────────────────────────────
  // The pool header strip lets the operator apply one Lice / one
  // referee-per-role to every match in the pool in a single click. We
  // optimistically rewrite the row state, then PUT; on failure we refetch.

  async function applyPoolLice(poolId: string, liceId: string | null) {
    setPools((prev) =>
      prev.map((pool) =>
        pool.poolId === poolId
          ? { ...pool, matches: pool.matches.map((m) => ({ ...m, lice_id: liceId })) }
          : pool,
      ),
    );
    try {
      const res = await fetch(`${apiUrl}/api/v1/pools/${poolId}/lice`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liceId }),
      });
      if (!res.ok) throw new Error('Pool lice update failed');
    } catch (err) {
      console.error('Pool lice update failed:', err);
      refresh();
    }
  }

  async function applyPoolReferee(poolId: string, role: string, refereeId: string | null) {
    const ref = refereeId ? referees.find((r) => r.personId === refereeId) : null;
    const refName = ref ? refereeLabel(ref) : (refereeId ?? '');
    setPools((prev) =>
      prev.map((pool) => {
        if (pool.poolId !== poolId) return pool;
        return {
          ...pool,
          matches: pool.matches.map((m) => {
            const others = m.referees.filter((a) => a.role !== role);
            return refereeId === null
              ? { ...m, referees: others }
              : { ...m, referees: [...others, { role, refereeId, refereeName: refName }] };
          }),
        };
      }),
    );
    try {
      const res = await fetch(`${apiUrl}/api/v1/pools/${poolId}/referee-role-assignments`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, refereeId }),
      });
      if (!res.ok) throw new Error('Pool referee role assignment failed');
    } catch (err) {
      console.error('Pool referee role assignment failed:', err);
      refresh();
    }
  }

  // The strip displays a value in its picker only when every match in
  // the pool shares the same assignment for that field — otherwise we
  // render `(mixed)` so the operator knows the field varies. Picking a
  // value still applies it to every match.
  function poolLiceCommonValue(pool: { matches: MatchRow[] }): string | 'mixed' {
    if (pool.matches.length === 0) return '';
    const first = pool.matches[0]?.lice_id ?? '';
    return pool.matches.every((m) => (m.lice_id ?? '') === first) ? first : 'mixed';
  }

  function poolRoleCommonValue(pool: { matches: MatchRow[] }, role: string): string | 'mixed' {
    if (pool.matches.length === 0) return '';
    const first = pool.matches[0]?.referees.find((a) => a.role === role)?.refereeId ?? '';
    return pool.matches.every(
      (m) => (m.referees.find((a) => a.role === role)?.refereeId ?? '') === first,
    )
      ? first
      : 'mixed';
  }

  if (loading) {
    return <p className="text-sm text-muted">{t('common.loading')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={refresh}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
        >
          {t('actions.refresh')}
        </button>
      </div>

      {pools.length === 0 && (
        <p className="rounded-md border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
          {t('organizer.pools.matches.noPools')}
        </p>
      )}

      {/*
        One pool per row, full width — the per-role referee columns
        (Déclarant / Assesseur / Table) make a 2-up grid overflow on the
        right at common laptop widths. Matches the Configure tab pattern.
      */}
      <div className="flex flex-col gap-4">
        {pools.map((pool) => {
          const done = pool.matches.filter((m) => m.status === 'completed').length;
          const total = pool.matches.length;
          return (
            <section key={pool.poolId} className="rounded-lg border border-border bg-surface">
              <header className="border-b border-border px-4 py-3">
                <h3 className="font-display font-semibold text-lg sm:text-xl text-foreground">
                  {pool.poolName}
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  {t('admin.orgPools.fighterCount', { count: countPoolFighters(pool.matches) })}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {t('organizer.pools.matches.summary', {
                    done: String(done),
                    total: String(total),
                  })}
                </p>
              </header>

              {pool.matches.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">
                  {t('organizer.pools.matches.empty')}
                </p>
              ) : (
                // Height cap turns this wrapper into a real vertical scroll
                // container, which is what the sticky <thead> below resolves
                // against. It already scrolled horizontally, and `overflow-x`
                // alone promotes the other axis to `auto` — but with no cap it
                // never actually scrolls, so the header had nothing to pin to.
                // `max-h`, not `h`: short pools never grow a scrollbar.
                <div className="max-h-[70vh] overflow-auto">
                  <table className="w-full text-sm">
                    {/*
                      Pool-wide assignment row (top of <thead>) — one picker
                      per applicable column so each "Apply to all" control
                      sits directly above the column it bulk-applies to.
                      `(mixed)` is shown when the pool's matches already
                      have different values; picking resets them all.
                    */}
                    <thead className="sticky top-0 z-sticky bg-background text-left text-xs uppercase tracking-wide text-muted">
                      <tr className="bg-surface text-xs normal-case tracking-normal text-muted">
                        <th
                          colSpan={6}
                          className={`px-4 py-2 text-right font-semibold uppercase tracking-wide text-muted ${APPLY_ROW_TH}`}
                        >
                          {t('organizer.pools.matches.applyToAll')}
                        </th>
                        <th className={`w-32 px-4 py-2 ${APPLY_ROW_TH}`}>
                          <select
                            value={(() => {
                              const v = poolLiceCommonValue(pool);
                              return v === 'mixed' ? '__mixed__' : v;
                            })()}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === '__mixed__') return;
                              void applyPoolLice(pool.poolId, raw || null);
                            }}
                            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                          >
                            {poolLiceCommonValue(pool) === 'mixed' && (
                              <option value="__mixed__">
                                {t('organizer.pools.matches.mixed')}
                              </option>
                            )}
                            <option value="">{t('common.none')}</option>
                            {lices.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </th>
                        {roleConfig.map((role) => {
                          const common = poolRoleCommonValue(pool, role.id);
                          const qualifiedSet = qualifiedRefereesByRole.get(role.id);
                          const options =
                            qualifiedSet && qualifiedSet.size > 0
                              ? referees.filter((r) => qualifiedSet.has(r.personId))
                              : referees;
                          return (
                            <th key={role.id} className={`w-32 px-4 py-2 ${APPLY_ROW_TH}`}>
                              <select
                                value={common === 'mixed' ? '__mixed__' : common}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === '__mixed__') return;
                                  void applyPoolReferee(pool.poolId, role.id, raw || null);
                                }}
                                className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                              >
                                {common === 'mixed' && (
                                  <option value="__mixed__">
                                    {t('organizer.pools.matches.mixed')}
                                  </option>
                                )}
                                <option value="">{t('common.none')}</option>
                                {options.map((r) => (
                                  <option key={r.personId} value={r.personId}>
                                    {refereeLabel(r)}
                                  </option>
                                ))}
                              </select>
                            </th>
                          );
                        })}
                        <th className={`w-10 px-4 py-2 ${APPLY_ROW_TH}`} />
                      </tr>
                      <tr>
                        <th className={`w-16 px-4 py-2 ${HEAD_ROW_TH}`}>
                          {t('organizer.pools.matches.round')}
                        </th>
                        <th className={`px-4 py-2 ${HEAD_ROW_TH}`}>
                          {t('organizer.pools.matches.red')}
                        </th>
                        <th className={`w-12 px-2 py-2 text-center ${HEAD_ROW_TH}`}>
                          {t('organizer.pools.matches.scoreRed')}
                        </th>
                        <th className={`w-12 px-2 py-2 text-center ${HEAD_ROW_TH}`}>
                          {t('organizer.pools.matches.scoreBlue')}
                        </th>
                        <th className={`px-4 py-2 ${HEAD_ROW_TH}`}>
                          {t('organizer.pools.matches.blue')}
                        </th>
                        <th className={`w-32 px-4 py-2 ${HEAD_ROW_TH}`}>
                          {t('organizer.pools.matches.status')}
                        </th>
                        <th className={`w-32 px-4 py-2 ${HEAD_ROW_TH}`}>
                          {t('organizer.pools.matches.lice')}
                        </th>
                        {/* One column per resolved referee role — system or
                            custom — coming from the tournament's staffing
                            config. Each cell renders a dropdown of
                            referees QUALIFIED for that role. */}
                        {roleConfig.map((role) => (
                          <th key={role.id} className={`w-32 px-4 py-2 ${HEAD_ROW_TH}`}>
                            {role.displayName}
                          </th>
                        ))}
                        <th className={`w-10 px-4 py-2 ${HEAD_ROW_TH}`} />
                      </tr>
                    </thead>
                    <tbody>
                      {pool.matches.map((m) => {
                        // Always-clickable: lice-scoped scoring URL when
                        // a lice is assigned, per-match URL otherwise.
                        // The previous "Assign a lice first" disabled
                        // treatment is gone — the web-staff
                        // /matches/:matchId route renders the same UI
                        // without needing a lice context.
                        // Same-origin proxy at `/scoring/*` (Traefik) serves
                        // the scoring PWA. The bundle reads its apiUrl as ''
                        // in browsers, so all fetches resolve to
                        // admin.myclash.fr/api/v1/* — same origin, admin
                        // session cookie, no dev-cert prompt. The
                        // `externalDisplay` query carries the read-only
                        // admin scoreboard URL so the operator can throw
                        // the projection on a second monitor in one click.
                        const scoreboardHref = m.id ? `/display/${m.id}` : null;
                        const scoringHref = m.id
                          ? buildMatchScoringHref(
                              STAFF_APP_PREFIX,
                              m.id,
                              typeof window !== 'undefined' ? window.location.href : null,
                              scoreboardHref,
                            )
                          : null;
                        function openScoring() {
                          if (scoringHref) window.location.href = scoringHref;
                        }
                        const auditHref = `/org/${slug}/events/${eventId}/matches/${m.id}`;
                        // Winner-bold rule: only completed matches with a
                        // clear differential elect a winner. Ties leave both
                        // sides in the regular weight — matches the engine
                        // semantics where ties have no winner row.
                        const isCompleted = m.status === 'completed';
                        const redScore = m.red_score ?? 0;
                        const blueScore = m.blue_score ?? 0;
                        const isRedWinner = isCompleted && redScore > blueScore;
                        const isBlueWinner = isCompleted && blueScore > redScore;
                        return (
                          <tr
                            key={m.id}
                            role="link"
                            tabIndex={0}
                            aria-label={t('organizer.pool.match.openScoreboard')}
                            onClick={() => {
                              if (scoringHref) openScoring();
                            }}
                            onKeyDown={(e) => {
                              if ((e.key === 'Enter' || e.key === ' ') && scoringHref) {
                                e.preventDefault();
                                openScoring();
                              }
                            }}
                            className={[
                              'border-b border-border last:border-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent',
                              'cursor-pointer hover:bg-background',
                              // Done rows recede; not-done rows stay
                              // vivid white so they pull the operator's
                              // attention.
                              isCompleted
                                ? 'bg-background text-foreground-secondary'
                                : 'bg-surface',
                            ].join(' ')}
                          >
                            <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted">
                              {m.roundCode}
                            </td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-2">
                                <span
                                  className="h-6 w-1 rounded"
                                  style={{ backgroundColor: sideStyle(sideConfig, 'red').border }}
                                  aria-hidden="true"
                                />
                                <span
                                  className={
                                    isRedWinner
                                      ? 'font-bold text-foreground'
                                      : 'font-medium text-foreground'
                                  }
                                >
                                  {m.red_name}
                                </span>
                                {m.red_club_abbrev && (
                                  <span className="rounded bg-border px-1.5 py-0.5 text-xs text-foreground-secondary">
                                    {m.red_club_abbrev}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-center font-mono text-sm">
                              {isCompleted ? (
                                <span
                                  className={
                                    isRedWinner
                                      ? 'font-bold text-foreground'
                                      : 'text-foreground-secondary'
                                  }
                                >
                                  {redScore}
                                </span>
                              ) : (
                                <span className="text-muted">-</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-center font-mono text-sm">
                              {isCompleted ? (
                                <span
                                  className={
                                    isBlueWinner
                                      ? 'font-bold text-foreground'
                                      : 'text-foreground-secondary'
                                  }
                                >
                                  {blueScore}
                                </span>
                              ) : (
                                <span className="text-muted">-</span>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-2">
                                <span
                                  className="h-6 w-1 rounded"
                                  style={{ backgroundColor: sideStyle(sideConfig, 'blue').border }}
                                  aria-hidden="true"
                                />
                                <span
                                  className={
                                    isBlueWinner
                                      ? 'font-bold text-foreground'
                                      : 'font-medium text-foreground'
                                  }
                                >
                                  {m.blue_name}
                                </span>
                                {m.blue_club_abbrev && (
                                  <span className="rounded bg-border px-1.5 py-0.5 text-xs text-foreground-secondary">
                                    {m.blue_club_abbrev}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <StatusPill status={m.status} />
                            </td>
                            <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={m.lice_id ?? ''}
                                onChange={(e) =>
                                  void updateMatchAssignment(m.id, 'liceId', e.target.value || null)
                                }
                                className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                              >
                                <option value="">{t('common.none')}</option>
                                {lices.map((l) => (
                                  <option key={l.id} value={l.id}>
                                    {l.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            {roleConfig.map((role) => {
                              const current =
                                m.referees.find((a) => a.role === role.id)?.refereeId ?? '';
                              const qualifiedSet = qualifiedRefereesByRole.get(role.id);
                              // Filter referees by qualification. If no
                              // one is qualified for this role yet, fall
                              // back to the full referee list so the
                              // operator can still assign someone — and
                              // we don't render a dropdown that's stuck
                              // on "Unassigned" with no options.
                              const options =
                                qualifiedSet && qualifiedSet.size > 0
                                  ? referees.filter((r) => qualifiedSet.has(r.personId))
                                  : referees;
                              return (
                                <td
                                  key={role.id}
                                  className="px-4 py-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <select
                                    value={current}
                                    onChange={(e) =>
                                      void updateMatchRoleAssignment(
                                        m.id,
                                        role.id,
                                        e.target.value || null,
                                      )
                                    }
                                    className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                                  >
                                    <option value="">{t('common.none')}</option>
                                    {options.map((r) => (
                                      <option key={r.personId} value={r.personId}>
                                        {refereeLabel(r)}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              );
                            })}
                            <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                              <Link
                                href={auditHref}
                                className="inline-flex items-center justify-center rounded p-1 text-foreground-secondary hover:bg-border"
                                title={t('organizer.pool.match.openAudit')}
                                aria-label={t('organizer.pool.match.openAudit')}
                              >
                                {/* Inline SVG: magnifying glass over a document (audit / file-search) */}
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                  <circle cx="11.5" cy="14.5" r="2.5" />
                                  <line x1="13.5" y1="16.5" x2="16" y2="19" />
                                </svg>
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  // Locale-aware `t` for the help popover specifically. The module-level `t`
  // this file imports elsewhere is bound to EN, so a new user-facing string
  // routed through it would never translate.
  const { t: translate } = useI18n();
  const tone = statusPillTone(matchStatusSemantic(status), 'light');
  return (
    <span className="inline-flex items-center">
      <span
        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
          tone.className
        }${tone.pulse ? ' animate-pulse' : ''}`}
      >
        {status}
      </span>
      <StatusHelp domain="match" status={status} t={translate} />
    </span>
  );
}
