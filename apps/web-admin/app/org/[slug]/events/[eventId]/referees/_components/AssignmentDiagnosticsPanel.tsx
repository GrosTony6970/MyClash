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
  missingSlots?: Array<{ poolId: string; poolName: string; role: string }>;
}

type HealthStatus = 'healthy' | 'gaps' | 'shortage';

function pickTheme(status: HealthStatus) {
  switch (status) {
    case 'shortage':
      return {
        section: 'mb-4 rounded-xl border border-red-300 bg-red-50 p-4',
        heading: 'text-red-700',
        coverage: 'text-red-900',
        sublabel: 'text-red-600',
        item: 'text-red-800',
        badge: 'bg-red-100 text-red-800',
      };
    case 'gaps':
      return {
        section: 'mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4',
        heading: 'text-amber-700',
        coverage: 'text-amber-900',
        sublabel: 'text-amber-700',
        item: 'text-amber-800',
        badge: 'bg-amber-100 text-amber-800',
      };
    default:
      return {
        section: 'mb-4 rounded-xl border border-slate-200 bg-white p-4',
        heading: 'text-slate-500',
        coverage: 'text-slate-900',
        sublabel: 'text-slate-500',
        item: 'text-slate-700',
        badge: 'bg-slate-100 text-slate-700',
      };
  }
}

export function AssignmentDiagnosticsPanel({
  board,
  skillNameById,
  roleLabel,
}: {
  board: DiagnosticsBoard;
  skillNameById: Map<string, string>;
  roleLabel?: (role: string) => string;
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
  const missing = board.missingSlots ?? [];

  // Red when something the operator can't fix from this tab (no
  // qualified people for a skill). Amber when there are unfilled
  // slots that are theoretically fillable. Otherwise neutral.
  const status: HealthStatus =
    rosterShort.length > 0
      ? 'shortage'
      : summary.filledSlots < summary.totalSlots
        ? 'gaps'
        : 'healthy';
  const theme = pickTheme(status);

  return (
    <section aria-label={t('organizer.refereesPage.diagnostics.title')} className={theme.section}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className={`text-xs font-semibold uppercase tracking-[0.15em] ${theme.heading}`}>
          {t('organizer.refereesPage.diagnostics.title')}
        </h3>
        <p className={`text-sm font-medium ${theme.coverage}`}>{coverage}</p>
      </div>

      {reasonEntries.length > 0 && (
        <div className="mb-3">
          <p className={`mb-1 text-xs font-medium ${theme.sublabel}`}>
            {t('organizer.refereesPage.diagnostics.unfilledLabel')}
          </p>
          <ul className="space-y-1">
            {reasonEntries.map(([code, count]) => (
              <li key={code} className={`text-sm ${theme.item}`}>
                <span
                  className={`mr-2 inline-block min-w-6 rounded px-1.5 py-px text-center text-xs font-semibold ${theme.badge}`}
                >
                  {count}
                </span>
                {formatUnassignedReason(code, t)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {missing.length > 0 && (
        <div className="mb-3">
          <p className={`mb-1 text-xs font-medium ${theme.sublabel}`}>
            {t('organizer.refereesPage.missingAssignments')}
          </p>
          <ul className="space-y-0.5">
            {missing.map((m) => (
              <li key={`${m.poolId}:${m.role}`} className={`text-sm ${theme.item}`}>
                {m.poolName} — {roleLabel ? roleLabel(m.role) : m.role}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className={`mb-1 text-xs font-medium ${theme.sublabel}`}>
          {t('organizer.refereesPage.diagnostics.rosterHealth')}
        </p>
        {rosterShort.length === 0 ? (
          <p className="text-sm text-emerald-700">
            {t('organizer.refereesPage.diagnostics.rosterOk')}
          </p>
        ) : (
          <ul className="space-y-1">
            {rosterShort.map((r) => (
              <li key={r.skillId} className="text-sm font-medium text-red-800">
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
