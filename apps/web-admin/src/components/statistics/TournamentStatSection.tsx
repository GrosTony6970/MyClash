'use client';

import { useState } from 'react';
import type { FighterStats, TournamentDetail, TournamentSummary } from './types';
import { StandingsHeaderCell } from '@/components/standings/StandingsHeaderCell';
import { useStandingsView } from '@/components/standings/useStandingsView';
import { getColumnHelp } from '@/components/standings/columnHelp';

type Translate = (key: string, values?: Record<string, string | number>) => string;

const MEDALS = ['🥇', '🥈', '🥉'];

function fmt(n: number): string {
  return String(n);
}
function fmtRatio(n: number | null): string {
  return n === null || n === undefined ? '—' : n.toFixed(2);
}

// ── Exchange distribution bar (clean / afterblow / double) ──────────────────
function DistributionBar({
  fighters,
  exchangeCount,
  doublesCount,
  t,
}: {
  fighters: FighterStats[];
  exchangeCount: number;
  doublesCount: number;
  t: Translate;
}) {
  // Each clean/afterblow blow is counted by both fighters → halve.
  const clean = fighters.reduce((s, f) => s + f.hitsGiven1 + f.hitsGiven2, 0) / 2;
  const afterblow = fighters.reduce((s, f) => s + f.afterblowGiven1 + f.afterblowGiven2, 0) / 2;
  const total = exchangeCount > 0 ? exchangeCount : 1;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  const seg = [
    { n: clean, cls: 'bg-success', label: t('organizer.eventStats.distribution.clean') },
    { n: afterblow, cls: 'bg-warning', label: t('organizer.eventStats.distribution.afterblow') },
    { n: doublesCount, cls: 'bg-danger', label: t('organizer.eventStats.distribution.double') },
  ];
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.eventStats.distribution.title')}
      </h4>
      <div className="mb-2 flex h-7 overflow-hidden rounded-md">
        {seg.map((s) => (
          <div key={s.label} className={s.cls} style={{ width: pct(s.n) }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        {seg.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${s.cls}`} />
            {s.label} {pct(s.n)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Per-fighter blow table (lyonamhe.fr layout) ─────────────────────────────
function DetailTable({ fighters, t }: { fighters: FighterStats[]; t: Translate }) {
  const sorted = [...fighters].sort((a, b) => (b.hitRatio ?? -1) - (a.hitRatio ?? -1));
  const numCols: Array<{ key: keyof FighterStats; head: string; cls?: string }> = [
    { key: 'doubles', head: t('organizer.eventStats.detail.colDoubles') },
    { key: 'hitsGiven1', head: '✓1', cls: 'text-success' },
    { key: 'afterblowGiven1', head: '✓1-1', cls: 'text-warning' },
    { key: 'hitsGiven2', head: '✓2', cls: 'text-success' },
    { key: 'afterblowGiven2', head: '✓2-1', cls: 'text-warning' },
    { key: 'hitsReceived1', head: '✗1', cls: 'text-danger' },
    { key: 'afterblowReceived1', head: '✗1-1', cls: 'text-danger' },
    { key: 'hitsReceived2', head: '✗2', cls: 'text-danger' },
    { key: 'afterblowReceived2', head: '✗2-1', cls: 'text-danger' },
    { key: 'totalExchanges', head: t('organizer.eventStats.detail.colTotal') },
  ];
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.eventStats.tournament.detail')}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 pr-3 text-left font-medium">
                {t('organizer.eventStats.detail.colFighter')}
              </th>
              {numCols.map((c) => (
                <th
                  key={String(c.key)}
                  className={`px-1.5 py-2 text-center font-medium ${c.cls ?? ''}`}
                >
                  {c.head}
                </th>
              ))}
              <th className="py-2 pl-2 text-right font-medium">
                {t('organizer.eventStats.detail.colRatio')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((f, idx) => (
              <tr
                key={f.registrationId}
                className={`border-b border-border/60 ${idx === 0 ? 'text-foreground' : 'text-foreground-secondary'}`}
              >
                <td className="py-2 pr-3">
                  <p className="font-medium leading-tight">
                    {f.givenName} {f.familyName}
                  </p>
                  {f.clubName ? <p className="text-xs text-muted">{f.clubName}</p> : null}
                </td>
                {numCols.map((c) => (
                  <td key={String(c.key)} className={`px-1.5 py-2 text-center ${c.cls ?? ''}`}>
                    {fmt(f[c.key] as number)}
                  </td>
                ))}
                <td className="py-2 pl-2 text-right font-mono font-bold">{fmtRatio(f.hitRatio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">{t('organizer.eventStats.detail.caption')}</p>
    </div>
  );
}

// ── Overall standings table (generic ruleset columns) ───────────────────────
function StandingsTable({ detail, t }: { detail: TournamentDetail; t: Translate }) {
  const { columns, rows } = detail.standings;
  const { query, setQuery, view, sortKey, direction, toggle } = useStandingsView(rows);
  const sortAscLabel = t('admin.common.sortAscLabel');
  const sortDescLabel = t('admin.common.sortDescLabel');
  const lastDataIndex = columns.length - 1;
  if (rows.length === 0) {
    return <p className="text-sm text-muted">{t('organizer.eventStats.tournament.noStandings')}</p>;
  }
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.eventStats.tournament.standings')}
      </h4>
      <div className="mb-2 flex items-center gap-2">
        <input
          aria-label={t('organizer.pools.standings.searchFighter')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('organizer.pools.standings.searchFighter')}
          className="w-64 rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="px-2 text-sm text-muted hover:text-foreground-secondary"
          >
            {t('actions.clear')}
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-xs uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-3 py-2">
                <StandingsHeaderCell
                  label="#"
                  columnKey="rank"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  help={getColumnHelp('rank', t)}
                  align="left"
                  tooltipAnchor="start"
                  ariaSortAsc={sortAscLabel}
                  ariaSortDesc={sortDescLabel}
                />
              </th>
              <th className="px-3 py-2">
                <StandingsHeaderCell
                  label={t('organizer.eventStats.detail.colFighter')}
                  columnKey="fighter"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  help={getColumnHelp('fighter', t)}
                  align="left"
                  tooltipAnchor="start"
                  ariaSortAsc={sortAscLabel}
                  ariaSortDesc={sortDescLabel}
                />
              </th>
              {columns.map((c, i) => (
                <th key={c.key} className="px-3 py-2 text-center">
                  <StandingsHeaderCell
                    label={c.label}
                    columnKey={c.key}
                    sortDesc={c.sortDesc}
                    currentKey={sortKey}
                    direction={direction}
                    onToggle={toggle}
                    help={getColumnHelp(c.key, t)}
                    align="center"
                    tooltipAnchor={i === lastDataIndex ? 'end' : 'center'}
                    ariaSortAsc={sortAscLabel}
                    ariaSortDesc={sortDescLabel}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.registrationId} className="border-t border-border">
                <td className="px-3 py-2 text-muted">{r.rank}</td>
                <td className="px-3 py-2">
                  <span className="font-medium text-foreground">{r.displayName}</span>
                  {r.club ? <span className="ml-2 text-xs text-muted">{r.club.name}</span> : null}
                </td>
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-center text-foreground-secondary">
                    {String(r.stats[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TournamentStatSection({
  summary,
  eventId,
  apiUrl,
  t,
}: {
  summary: TournamentSummary;
  eventId: string;
  apiUrl: string;
  t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${apiUrl}/api/v1/events/${eventId}/statistics/tournaments/${summary.id}`,
          { credentials: 'include' },
        );
        if (!res.ok) throw new Error(t('organizer.eventStats.tournament.detailError'));
        setDetail((await res.json()) as TournamentDetail);
      } catch (e) {
        setError(e instanceof Error ? e.message : t('organizer.eventStats.tournament.detailError'));
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
      >
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-medium text-foreground">
            {summary.name}
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            {summary.weapon ? <span className="capitalize">{summary.weapon}</span> : null}
            {summary.weapon ? ' · ' : ''}
            {t('organizer.eventStats.tournament.participants', { count: summary.participantCount })}
            {' · '}
            {summary.doublesPercent}% {t('organizer.eventStats.band.doubles').toLowerCase()}
            {' · '}
            {t('organizer.eventStats.tournament.completion', {
              percent: summary.completionPercent,
            })}
          </p>
        </div>
        <span className="shrink-0 text-muted" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open ? (
        <div className="space-y-6 border-t border-border px-4 py-5">
          {/* Podium */}
          {summary.podium.length > 0 ? (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                {t('organizer.eventStats.tournament.podium')}
              </h4>
              <ol className="flex flex-wrap gap-3">
                {summary.podium.map((p, i) => (
                  <li
                    key={p.place}
                    className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
                  >
                    <span className="text-lg" aria-hidden="true">
                      {MEDALS[i] ?? `${p.place}.`}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-foreground">
                        {p.fighterName}
                      </span>
                      {p.club ? <span className="block text-xs text-muted">{p.club}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-sm text-muted">
              {t('organizer.eventStats.tournament.podiumPending')}
            </p>
          )}

          {/* Top fighters */}
          {summary.topFighters.length > 0 ? (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                {t('organizer.eventStats.tournament.topFighters')}
              </h4>
              <div className="flex flex-col gap-1.5">
                {summary.topFighters.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2"
                  >
                    <span className="w-4 text-right text-sm font-bold text-muted">{i + 1}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {f.name}
                      </span>
                      {f.club ? (
                        <span className="block truncate text-xs text-muted">{f.club}</span>
                      ) : null}
                    </span>
                    <span className="font-mono text-sm font-bold text-foreground">
                      {fmtRatio(f.hitRatio)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">
                {t('organizer.eventStats.tournament.topFightersHint')}
              </p>
            </div>
          ) : null}

          {/* Lazy detail: distribution + standings + blow table */}
          {loading ? (
            <p className="text-sm text-muted">
              {t('organizer.eventStats.tournament.loadingDetail')}
            </p>
          ) : error ? (
            <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : detail ? (
            detail.fighters.length === 0 && detail.standings.rows.length === 0 ? (
              <p className="text-sm text-muted">
                {t('organizer.eventStats.tournament.noFighters')}
              </p>
            ) : (
              <div className="space-y-6">
                {detail.fighters.length > 0 ? (
                  <DistributionBar
                    fighters={detail.fighters}
                    exchangeCount={summary.exchangeCount}
                    doublesCount={summary.doublesCount}
                    t={t}
                  />
                ) : null}
                <StandingsTable detail={detail} t={t} />
                {detail.fighters.length > 0 ? (
                  <DetailTable fighters={detail.fighters} t={t} />
                ) : null}
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
