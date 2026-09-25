'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { RefereeSwitches, RefereeVerdict } from '@myclash/rulesets/scheduling/referee-checker';
import { RefereeReasons } from '@/components/RefereeReasons';
import { hhmmInZone } from './conflict-detection';
import type { RefereeConflictRow } from './referee-conflict-rows';
import type { RefereeCrewConflict, RefereeCrewConflictsResult } from './schedule-reads';

/**
 * Hard rule 8 on the schedule board, from two sources kept visibly apart (ADR-021). Both
 * are the one checker's verdicts (ADR-016), worded by one component.
 *
 * TWO GROUPS, NEVER ONE LIST. The live group is recomputed from the bouts on screen every
 * time a card moves, so it is true right now — but it can only see what the cards carry.
 * The server group is a re-read that can be a minute or two old and also sees teaching,
 * attending and availability. Merging them would let the fresh half vouch for the stale
 * one. Each group says what it is and when it was true.
 *
 * Red is Impossible, amber is Discouraged, grey is a reason the organiser already
 * confirmed over (ruling 135) — listed, but no longer a warning. A banner of nothing but
 * grey is not shown.
 *
 * The server group renders even when it is empty; the live group does not. An empty live
 * group means the board just looked and found nothing. An empty server group can also mean
 * the read failed, or that an amber rule is switched off in the referee settings — and on
 * a safety banner those must not look like a clean board.
 */

type Translate = ReturnType<typeof useI18n>['t'];

/** Which amber rules are off, in the operator's words — the settings screen's labels. */
function rulesOff(rules: RefereeSwitches, t: Translate): string[] {
  // Literal calls rather than a table: the i18n sweep resolves keys at the call site.
  const off: string[] = [];
  if (!rules.ownPool) off.push(t('organizer.refereesPage.rules.ownPool.label'));
  if (!rules.ownPoolSpan) off.push(t('organizer.refereesPage.rules.ownPoolSpan.label'));
  if (!rules.twoRoles) off.push(t('organizer.refereesPage.rules.twoRoles.label'));
  if (!rules.attendWorkshop) off.push(t('organizer.refereesPage.rules.attendWorkshop.label'));
  return off;
}

const needsAction = (entry: { level: RefereeVerdict['level'] }) => entry.level !== 'fine';

export function RefereeConflictBanner({
  live,
  crew,
  eventTz,
}: {
  /** Derived from the bouts on screen — see ./referee-conflict-rows. */
  live: RefereeConflictRow[];
  /** Null while the first read is still out. */
  crew: RefereeCrewConflictsResult | null;
  /** Every time below is read on the event's clock, never the viewer's. */
  eventTz: string;
}) {
  const { t } = useI18n();
  const crewConflicts = crew?.ok ? crew.conflicts : [];
  const off = crew?.ok ? rulesOff(crew.rules, t) : [];
  const crewIsClean = crew?.ok === true && !crewConflicts.some(needsAction) && off.length === 0;
  // Nothing to act on: the first read is still out, or everything is clean or confirmed.
  // A banner then would flash on every page load and cry wolf.
  if (!live.some(needsAction) && (crew === null || crewIsClean)) return null;

  const red =
    live.some((r) => r.level === 'impossible') ||
    crewConflicts.some((c) => c.level === 'impossible');
  // Whole class names: Tailwind reads them from the source, never from a template.
  const tone = red
    ? { box: 'bg-danger/10 border-danger/30', title: 'text-danger' }
    : { box: 'bg-warning/10 border-warning/30', title: 'text-warning' };
  const asOf = crew?.ok ? hhmmInZone(crew.asOf, eventTz) : '';

  return (
    <div className={`${tone.box} border rounded-xl px-4 py-3 mb-6 text-sm`}>
      <p className={`font-bold ${tone.title} mb-2`}>
        {t('organizer.schedulePage.grid.refereeTitle')}
      </p>

      {live.length > 0 && <LiveGroup live={live} />}

      <CrewGroup crew={crew} conflicts={crewConflicts} off={off} asOf={asOf} eventTz={eventTz} />
    </div>
  );
}

/** The group recomputed from the cards on screen. */
function LiveGroup({ live }: { live: RefereeConflictRow[] }) {
  const { t } = useI18n();
  return (
    <div className="mb-2">
      <p className="text-xs font-medium text-muted mb-1">
        {t('organizer.schedulePage.grid.refereeLiveGroup')}
      </p>
      <ul className="list-disc list-inside space-y-0.5">
        {live.map((row) => (
          <li key={row.key}>
            <strong>{row.personName}</strong> — {row.refereeingLabel}
            {row.refereeingTime && ` (${row.refereeingTime})`}:{' '}
            <RefereeReasons reasons={row.reasons} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The server's re-read: its time, the amber rules switched off, and its verdicts. */
function CrewGroup({
  crew,
  conflicts,
  off,
  asOf,
  eventTz,
}: {
  crew: RefereeCrewConflictsResult | null;
  conflicts: RefereeCrewConflict[];
  off: string[];
  asOf: string;
  eventTz: string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <p className="text-xs font-medium text-muted mb-1">
        {crew?.ok
          ? t('organizer.schedulePage.grid.refereeCrewGroup', { time: asOf })
          : t('organizer.schedulePage.grid.refereeCrewUnavailable')}
      </p>
      {off.length > 0 && (
        <p className="text-xs text-warning mb-1">
          {t('organizer.schedulePage.grid.refereeCrewRulesOff', { rules: off.join(' · ') })}
        </p>
      )}
      {crew?.ok &&
        (conflicts.length > 0 ? (
          <ul className="list-disc list-inside space-y-0.5">
            {conflicts.map((c) => (
              <li key={`${c.assignmentId}:${c.role}`}>
                <strong>{c.personName}</strong> — {c.unitName}
                {c.start && ` (${hhmmInZone(c.start, eventTz)})`}:{' '}
                <RefereeReasons reasons={c.reasons} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t('organizer.schedulePage.grid.refereeCrewNone')}</p>
        ))}
    </div>
  );
}
