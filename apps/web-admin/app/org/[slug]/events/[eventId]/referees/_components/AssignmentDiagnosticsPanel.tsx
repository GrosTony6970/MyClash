'use client';

import { t } from '@myclash/i18n';
import { summariseBoard, summariseRosterHealth } from './board-diagnostics';
import { formatUnassignedReason } from './format-unassigned-reason';

interface DiagnosticsBoard {
  pools: Array<{
    roleSlots: Array<{
      role: string;
      assignment: unknown | null;
      missingReasons: string[];
    }>;
  }>;
  candidates: Array<{
    personId: string;
    qualifications: Array<{ role: string; rating: number | null }>;
  }>;
}

export function AssignmentDiagnosticsPanel({
  board,
  skillNameById,
}: {
  board: DiagnosticsBoard;
  skillNameById: Map<string, string>;
}) {
  const summary = summariseBoard(board);
  const roster = summariseRosterHealth(board, skillNameById);
  if (summary.totalSlots === 0) return null;

  const coverage =
    summary.filledSlots === summary.totalSlots
      ? t('organizer.refereesPage.diagnostics.coverageNoneOpen')
      : t('organizer.refereesPage.diagnostics.coverage')
          .replace('{filled}', String(summary.filledSlots))
          .replace('{total}', String(summary.totalSlots));

  const reasonEntries = Object.entries(summary.byReason).sort((a, b) => b[1] - a[1]);
  const rosterShort = roster.filter((r) => r.shortBy > 0);

  return (
    <section
      aria-label={t('organizer.refereesPage.diagnostics.title')}
      className="mb-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
          {t('organizer.refereesPage.diagnostics.title')}
        </h3>
        <p className="text-sm font-medium text-slate-900">{coverage}</p>
      </div>

      {reasonEntries.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-medium text-slate-500">
            {t('organizer.refereesPage.diagnostics.unfilledLabel')}
          </p>
          <ul className="space-y-1">
            {reasonEntries.map(([code, count]) => (
              <li key={code} className="text-sm text-slate-700">
                <span className="mr-2 inline-block min-w-6 rounded bg-slate-100 px-1.5 py-px text-center text-xs font-semibold text-slate-700">
                  {count}
                </span>
                {formatUnassignedReason(code, t)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">
          {t('organizer.refereesPage.diagnostics.rosterHealth')}
        </p>
        {rosterShort.length === 0 ? (
          <p className="text-sm text-emerald-700">
            {t('organizer.refereesPage.diagnostics.rosterOk')}
          </p>
        ) : (
          <ul className="space-y-1">
            {rosterShort.map((r) => (
              <li key={r.skillId} className="text-sm font-medium text-amber-700">
                {t('organizer.refereesPage.diagnostics.rosterShortBy')
                  .replace('{skill}', r.skillName)
                  .replace('{count}', String(r.shortBy))
                  .replace('{open}', String(r.slotsOpen))
                  .replace('{qualified}', String(r.qualifiedCount))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
