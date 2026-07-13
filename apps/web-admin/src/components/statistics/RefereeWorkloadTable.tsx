'use client';

import type { RefereeWorkloadRow } from './types';

type Translate = (key: string, values?: Record<string, string | number>) => string;

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function CardCount({ count, className }: { count: number; className: string }) {
  if (count <= 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="inline-block h-2.5 w-2 rounded-[1px]" />
      {count}
    </span>
  );
}

/** Event-wide referee workload leaderboard. */
export function RefereeWorkloadTable({
  referees,
  t,
}: {
  referees: RefereeWorkloadRow[];
  t: Translate;
}) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.eventStats.referees.title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('organizer.eventStats.referees.subtitle')}</p>

      {referees.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          {t('organizer.eventStats.referees.empty')}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-background text-xs uppercase tracking-[0.14em] text-muted">
              <tr>
                <th className="px-4 py-3">{t('organizer.eventStats.referees.colReferee')}</th>
                <th className="px-4 py-3 text-center">
                  {t('organizer.eventStats.referees.colMatches')}
                </th>
                <th className="px-4 py-3 text-center">
                  {t('organizer.eventStats.referees.colLead')}
                </th>
                <th className="px-4 py-3 text-center">
                  {t('organizer.eventStats.referees.colAssessor')}
                </th>
                <th className="px-4 py-3 text-center">
                  {t('organizer.eventStats.referees.colTable')}
                </th>
                <th className="px-4 py-3 text-center">
                  {t('organizer.eventStats.referees.colCards')}
                </th>
                <th className="px-4 py-3 text-right">
                  {t('organizer.eventStats.referees.colAvgTime')}
                </th>
              </tr>
            </thead>
            <tbody>
              {referees.map((r) => (
                <tr key={r.personId} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-foreground">{r.name}</td>
                  <td className="px-4 py-3 text-center font-semibold text-foreground">
                    {r.matchesReffed}
                  </td>
                  <td className="px-4 py-3 text-center text-muted">{r.roles.arbitre_declarant}</td>
                  <td className="px-4 py-3 text-center text-muted">{r.roles.arbitre_assesseur}</td>
                  <td className="px-4 py-3 text-center text-muted">{r.roles.arbitre_table}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-2">
                      <CardCount count={r.cards.yellow} className="text-warning" />
                      <CardCount count={r.cards.red} className="text-danger" />
                      <CardCount count={r.cards.black} className="text-foreground" />
                      {r.cards.yellow + r.cards.red + r.cards.black === 0 ? (
                        <span className="text-muted">—</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted">
                    {formatDuration(r.averageRefereeTimeMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
