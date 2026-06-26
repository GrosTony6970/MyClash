'use client';

import { t } from '@myclash/i18n';
import type { CapacityWarning, RefereeConflict } from '@myclash/types';
import { boardHealthStatus, summariseBoard, summariseRosterHealth } from './board-diagnostics';
import type { HealthStatus } from './board-diagnostics';
import { formatUnassignedReason } from './format-unassigned-reason';

/** The six health-panel rules an operator can enable/disable. Keys match
 *  the PUT pool-assignment-settings payload field names. */
export const RULE_KEYS = [
  'enableOwnPoolRule',
  'enableOfficiateVsFightRule',
  'enableDoubleBookedRule',
  'enableTwoRolesRule',
  'enableAvailabilityRule',
  'enableCapacityRule',
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

/** i18n suffix per rule under organizer.refereesPage.rules.* */
const RULE_I18N: Record<RuleKey, string> = {
  enableOwnPoolRule: 'ownPool',
  enableOfficiateVsFightRule: 'officiateVsFight',
  enableDoubleBookedRule: 'doubleBooked',
  enableTwoRolesRule: 'twoRoles',
  enableAvailabilityRule: 'availability',
  enableCapacityRule: 'capacity',
};

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
  missingSlots?: Array<{
    poolId: string;
    poolName: string;
    role: string;
    reasons?: string[];
  }>;
  conflicts?: RefereeConflict[];
  capacityWarnings?: CapacityWarning[];
  deadEndSlots?: Array<{ poolId: string; poolName: string; role: string }>;
}

function pickTheme(status: HealthStatus) {
  switch (status) {
    case 'conflict':
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

function hhmm(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function AssignmentDiagnosticsPanel({
  board,
  skillNameById,
  roleLabel,
  ruleSettings,
  onToggleRule,
  togglesDisabled,
}: {
  board: DiagnosticsBoard;
  skillNameById: Map<string, string>;
  roleLabel?: (role: string) => string;
  /** Per-rule enabled state (from pool-assignment-settings). When provided,
   *  the rules footer becomes a checkbox list with descriptions. */
  ruleSettings?: Record<RuleKey, boolean>;
  onToggleRule?: (key: RuleKey, enabled: boolean) => void;
  togglesDisabled?: boolean;
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
  const conflicts = board.conflicts ?? [];
  const capacityWarnings = board.capacityWarnings ?? [];
  const deadEndSlots = board.deadEndSlots ?? [];
  const label = (role: string) => (roleLabel ? roleLabel(role) : role);

  const status = boardHealthStatus({
    openSlots: summary.totalSlots - summary.filledSlots,
    rosterShort: rosterShort.length > 0,
    conflicts: conflicts.length,
    capacity: capacityWarnings.length,
    deadEnds: deadEndSlots.length,
  });
  const theme = pickTheme(status);

  return (
    <section aria-label={t('organizer.refereesPage.diagnostics.title')} className={theme.section}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className={`text-xs font-semibold uppercase tracking-[0.15em] ${theme.heading}`}>
          {t('organizer.refereesPage.diagnostics.title')}
        </h3>
        <p className={`text-sm font-medium ${theme.coverage}`}>{coverage}</p>
      </div>

      {conflicts.length > 0 && (
        <div className="mb-3">
          <p className={`mb-1 text-xs font-medium ${theme.sublabel}`}>
            ⚠ {t('organizer.refereesPage.conflict.sectionTitle')} ({conflicts.length})
          </p>
          <ul className="space-y-1">
            {conflicts.map((c, i) => (
              <li key={`${c.poolId}:${c.personId}:${i}`} className={`text-sm ${theme.item}`}>
                <span className="font-medium">{c.personName}</span> — {label(c.role)} · {c.poolName}
                {c.start && ` (${hhmm(c.start)})`}
                <span className={`block text-xs ${theme.sublabel}`}>
                  ↳{' '}
                  {c.kind === 'unavailable'
                    ? t('organizer.refereesPage.conflict.unavailableLine').replace(
                        '{tournament}',
                        c.otherPoolName,
                      )
                    : c.kind === 'double_booked'
                      ? c.crossVenue && c.otherVenueName
                        ? t('organizer.refereesPage.conflict.alsoOfficiatingVenue')
                            .replace('{pool}', c.otherPoolName)
                            .replace('{venue}', c.otherVenueName)
                        : t('organizer.refereesPage.conflict.alsoOfficiating').replace(
                            '{pool}',
                            c.otherPoolName,
                          )
                      : t('organizer.refereesPage.conflict.alsoFighting').replace(
                          '{pool}',
                          c.otherPoolName,
                        )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {deadEndSlots.length > 0 && (
        <div className="mb-3">
          <p className={`mb-1 text-xs font-medium ${theme.sublabel}`}>
            ⛔ {t('organizer.refereesPage.conflict.unfillableTitle')} ({deadEndSlots.length})
          </p>
          <ul className="space-y-1">
            {deadEndSlots.map((d) => (
              <li key={`${d.poolId}:${d.role}`} className={`text-sm ${theme.item}`}>
                <span className="font-medium">{d.poolName}</span> — {label(d.role)}
                <span className={`block text-xs ${theme.sublabel}`}>
                  ↳ {t('organizer.refereesPage.conflict.unfillableDetail')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {capacityWarnings.length > 0 && (
        <div className="mb-3">
          <p className={`mb-1 text-xs font-medium ${theme.sublabel}`}>
            📉 {t('organizer.refereesPage.conflict.capacityTitle')}
          </p>
          <ul className="space-y-1">
            {capacityWarnings.map((w, i) => (
              <li key={`${w.start}:${i}`} className={`text-sm ${theme.item}`}>
                {hhmm(w.start)}–{hhmm(w.end)}:{' '}
                {t('organizer.refereesPage.conflict.capacityLine')
                  .replace('{lices}', String(w.liceCount))
                  .replace('{needed}', String(w.needed))
                  .replace('{free}', String(w.free))}
              </li>
            ))}
          </ul>
        </div>
      )}

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
          <ul className="space-y-1">
            {missing.map((m) => {
              const primaryReason = m.reasons?.[0];
              return (
                <li key={`${m.poolId}:${m.role}`} className={`text-sm ${theme.item}`}>
                  <span className="font-medium">{m.poolName}</span> — {label(m.role)}
                  {primaryReason && (
                    <span className={`block text-xs ${theme.sublabel}`}>
                      ↳ {formatUnassignedReason(primaryReason, t)}
                    </span>
                  )}
                </li>
              );
            })}
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

      {ruleSettings ? (
        <div className="mt-3 border-t pt-2">
          <p
            className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wider ${theme.sublabel}`}
          >
            {t('organizer.refereesPage.rules.title')}
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {RULE_KEYS.map((key) => (
              <li key={key}>
                <label
                  className={`flex items-start gap-2 ${togglesDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={ruleSettings[key]}
                    disabled={togglesDisabled}
                    onChange={(e) => onToggleRule?.(key, e.target.checked)}
                    className="mt-0.5 rounded"
                  />
                  <span>
                    <span className={`block text-xs font-semibold ${theme.item}`}>
                      {t(`organizer.refereesPage.rules.${RULE_I18N[key]}.label`)}
                    </span>
                    <span className={`block text-[11px] ${theme.sublabel}`}>
                      {t(`organizer.refereesPage.rules.${RULE_I18N[key]}.description`)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={`mt-3 border-t pt-2 text-[11px] ${theme.sublabel}`}>
          {t('organizer.refereesPage.conflict.rulesFooter')}
        </p>
      )}
    </section>
  );
}
