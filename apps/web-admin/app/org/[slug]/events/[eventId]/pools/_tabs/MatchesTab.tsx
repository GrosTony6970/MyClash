'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { t } from '@myclash/i18n';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { accentClassFor, type ColorToken } from '@myclash/ui';
import { mergeScores, type MatchScoreUpdate } from './match-scores-merge';
import { buildScoringHref } from './build-scoring-href';
import { countPoolFighters } from './count-pool-fighters';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
// Cross-app deep link into the web-scoring ScoringPad. Set per env
// in infra/docker-compose.*.yml. Local dev fallback matches the
// `next dev --port 3002` in apps/web-scoring/package.json.
const scoringBaseUrl = process.env['NEXT_PUBLIC_SCORING_URL'] ?? 'http://localhost:3002';

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
  /** Canonical round code (e.g. `LSW-P1-ML1-PA-M1`) built on the backend
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

interface Qualification {
  personId: string;
  role: string;
  active: boolean;
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

// Shape returned by GET /api/v1/events/:eventId/persons — camelCase per
// mapPerson() in apps/api/src/modules/persons/persons.service.ts. There
// is no display_name on the Person type; we build the label from
// givenName + familyName.
interface Referee {
  id: string;
  givenName?: string | null;
  familyName?: string | null;
}

interface MatchesTabProps {
  tournamentId: string;
  poolPhaseId: string;
  slug: string;
  eventId: string;
}

export function MatchesTab({ tournamentId, poolPhaseId, slug, eventId }: MatchesTabProps) {
  const [pools, setPools] = useState<PoolWithMatches[]>([]);
  const [redColor, setRedColor] = useState<ColorToken>('red');
  const [blueColor, setBlueColor] = useState<ColorToken>('blue');
  const [lices, setLices] = useState<Lice[]>([]);
  const [referees, setReferees] = useState<Referee[]>([]);
  const [roleConfig, setRoleConfig] = useState<RoleConfig[]>([]);
  const [qualifiedRefereesByRole, setQualifiedRefereesByRole] = useState<Map<string, Set<string>>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
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
      fetch(`${apiUrl}/api/v1/events/${eventId}/persons?is_referee=true`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/pool-match-role-config`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : { roles: [] })),
      fetch(`${apiUrl}/api/v1/events/${eventId}/referee-qualifications`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : [])),
    ]).then(
      ([
        poolsData,
        tournamentData,
        licesData,
        refereesData,
        roleConfigData,
        qualificationsData,
      ]) => {
        setPools(poolsData as PoolWithMatches[]);
        const tournament = tournamentData as {
          scoring_config?: { display?: { sideColors?: { red: string; blue: string } } };
        } | null;
        const sc = tournament?.scoring_config;
        if (sc?.display?.sideColors) {
          setRedColor((sc.display.sideColors.red as ColorToken) ?? 'red');
          setBlueColor((sc.display.sideColors.blue as ColorToken) ?? 'blue');
        }
        setLices(licesData as Lice[]);
        setReferees(refereesData as Referee[]);
        setRoleConfig((roleConfigData as { roles: RoleConfig[] }).roles ?? []);
        // Build role → Set<personId> map for fast filtering when
        // populating each role-column's dropdown options.
        const qualByRole = new Map<string, Set<string>>();
        for (const q of (qualificationsData as Qualification[]) ?? []) {
          if (!q.active) continue;
          const set = qualByRole.get(q.role) ?? new Set<string>();
          set.add(q.personId);
          qualByRole.set(q.role, set);
        }
        setQualifiedRefereesByRole(qualByRole);
        setLoading(false);
      },
    );
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
    onFallbackPoll: syncScores,
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
      // eslint-disable-next-line no-console
      console.error('Match assignment update failed:', err);
      refresh();
    }
  }

  function refereeLabel(r: Referee): string {
    const name = `${r.givenName ?? ''} ${r.familyName ?? ''}`.trim();
    if (name) return name;
    // Anonymous fallback — keeps the picker readable when a person row
    // has neither given_name nor family_name on file, instead of
    // surfacing a raw UUID.
    return `Anonymous (${r.id.slice(0, 6)})`;
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
          const ref = referees.find((r) => r.id === refereeId);
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
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
      console.error('Pool lice update failed:', err);
      refresh();
    }
  }

  async function applyPoolReferee(poolId: string, role: string, refereeId: string | null) {
    const ref = refereeId ? referees.find((r) => r.id === refereeId) : null;
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
      // eslint-disable-next-line no-console
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
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={refresh}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t('actions.refresh')}
        </button>
      </div>

      {pools.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
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
            <section key={pool.poolId} className="rounded-lg border border-slate-200 bg-white">
              <header className="border-b border-slate-200 px-4 py-3">
                <h3 className="font-semibold text-slate-900">{pool.poolName}</h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  {countPoolFighters(pool.matches)} fighters
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t('organizer.pools.matches.summary', {
                    done: String(done),
                    total: String(total),
                  })}
                </p>
              </header>

              {/*
                Pool-wide assignment strip. One picker per field; picking
                a value bulk-applies to every match in this pool via the
                pool-scoped endpoints. `(mixed)` is shown when the
                pool's matches already have different values — picking
                resets them all to the chosen value.
              */}
              {pool.matches.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-slate-500">
                    {t('organizer.pools.matches.applyToAll')}
                  </span>
                  <label className="flex items-center gap-1.5">
                    <span className="text-slate-600">{t('organizer.pools.matches.lice')}</span>
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
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      {poolLiceCommonValue(pool) === 'mixed' && (
                        <option value="__mixed__">{t('organizer.pools.matches.mixed')}</option>
                      )}
                      <option value="">{t('common.none')}</option>
                      {lices.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {roleConfig.map((role) => {
                    const common = poolRoleCommonValue(pool, role.id);
                    const qualifiedSet = qualifiedRefereesByRole.get(role.id);
                    const options =
                      qualifiedSet && qualifiedSet.size > 0
                        ? referees.filter((r) => qualifiedSet.has(r.id))
                        : referees;
                    return (
                      <label key={role.id} className="flex items-center gap-1.5">
                        <span className="text-slate-600">{role.displayName}</span>
                        <select
                          value={common === 'mixed' ? '__mixed__' : common}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === '__mixed__') return;
                            void applyPoolReferee(pool.poolId, role.id, raw || null);
                          }}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                        >
                          {common === 'mixed' && (
                            <option value="__mixed__">{t('organizer.pools.matches.mixed')}</option>
                          )}
                          <option value="">{t('common.none')}</option>
                          {options.map((r) => (
                            <option key={r.id} value={r.id}>
                              {refereeLabel(r)}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              )}

              {pool.matches.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">
                  {t('organizer.pools.matches.empty')}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="w-16 px-4 py-2">{t('organizer.pools.matches.round')}</th>
                        <th className="px-4 py-2">{t('organizer.pools.matches.red')}</th>
                        <th className="w-12 px-2 py-2 text-center">
                          {t('organizer.pools.matches.scoreRed')}
                        </th>
                        <th className="w-12 px-2 py-2 text-center">
                          {t('organizer.pools.matches.scoreBlue')}
                        </th>
                        <th className="px-4 py-2">{t('organizer.pools.matches.blue')}</th>
                        <th className="w-32 px-4 py-2">{t('organizer.pools.matches.status')}</th>
                        <th className="w-32 px-4 py-2">{t('organizer.pools.matches.lice')}</th>
                        {/* One column per resolved referee role — system or
                            custom — coming from the tournament's staffing
                            config. Each cell renders a dropdown of
                            referees QUALIFIED for that role. */}
                        {roleConfig.map((role) => (
                          <th key={role.id} className="w-32 px-4 py-2">
                            {role.displayName}
                          </th>
                        ))}
                        <th className="w-10 px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {pool.matches.map((m) => {
                        const scoringHref = buildScoringHref(scoringBaseUrl, m.lice_id);
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
                        const rowLabel = scoringHref
                          ? t('organizer.pool.match.openScoreboard')
                          : t('organizer.pool.match.assignLiceFirst');
                        return (
                          <tr
                            key={m.id}
                            role="link"
                            tabIndex={0}
                            aria-label={rowLabel}
                            title={scoringHref ? undefined : rowLabel}
                            onClick={() => {
                              if (scoringHref) window.location.href = scoringHref;
                            }}
                            onKeyDown={(e) => {
                              if ((e.key === 'Enter' || e.key === ' ') && scoringHref) {
                                e.preventDefault();
                                window.location.href = scoringHref;
                              }
                            }}
                            className={[
                              'border-b border-slate-100 last:border-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-300',
                              scoringHref
                                ? 'cursor-pointer hover:bg-slate-100'
                                : 'cursor-not-allowed opacity-70',
                              // Done rows recede; not-done-with-lice rows
                              // stay vivid white so they pull the
                              // operator's attention.
                              isCompleted ? 'bg-slate-50 text-slate-600' : 'bg-white',
                            ].join(' ')}
                          >
                            <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-500">
                              {m.roundCode}
                            </td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-2">
                                <span
                                  className={`h-6 w-1 rounded ${accentClassFor(redColor)}`}
                                  aria-hidden="true"
                                />
                                <span
                                  className={
                                    isRedWinner
                                      ? 'font-bold text-slate-900'
                                      : 'font-medium text-slate-900'
                                  }
                                >
                                  {m.red_name}
                                </span>
                                {m.red_club_abbrev && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                                    {m.red_club_abbrev}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-center font-mono text-sm">
                              {isCompleted ? (
                                <span
                                  className={
                                    isRedWinner ? 'font-bold text-slate-900' : 'text-slate-600'
                                  }
                                >
                                  {redScore}
                                </span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-center font-mono text-sm">
                              {isCompleted ? (
                                <span
                                  className={
                                    isBlueWinner ? 'font-bold text-slate-900' : 'text-slate-600'
                                  }
                                >
                                  {blueScore}
                                </span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-2">
                                <span
                                  className={`h-6 w-1 rounded ${accentClassFor(blueColor)}`}
                                  aria-hidden="true"
                                />
                                <span
                                  className={
                                    isBlueWinner
                                      ? 'font-bold text-slate-900'
                                      : 'font-medium text-slate-900'
                                  }
                                >
                                  {m.blue_name}
                                </span>
                                {m.blue_club_abbrev && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
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
                                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
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
                                  ? referees.filter((r) => qualifiedSet.has(r.id))
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
                                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                                  >
                                    <option value="">{t('common.none')}</option>
                                    {options.map((r) => (
                                      <option key={r.id} value={r.id}>
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
                                className="inline-flex items-center justify-center rounded p-1 text-slate-600 hover:bg-slate-200"
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
  const colors: Record<string, string> = {
    scheduled: 'bg-slate-100 text-slate-700',
    ready: 'bg-amber-100 text-amber-700',
    running: 'bg-red-100 text-red-700',
    completed: 'bg-green-100 text-green-700',
    forfeit: 'bg-slate-200 text-slate-600',
    disqualified: 'bg-slate-200 text-slate-600',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? colors['scheduled']}`}
    >
      {status}
    </span>
  );
}
