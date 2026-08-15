'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { hhmmInZone } from './conflict-detection';
import type { RefereeConflictRow } from './referee-conflict-rows';
import type {
  RefereeCrewConflict,
  RefereeCrewConflictsResult,
  RefereeCrewRules,
} from './schedule-reads';

/**
 * Hard rule 8 on the schedule board, from two sources kept visibly apart.
 *
 * TWO GROUPS, NEVER ONE LIST. The live group is recomputed from the bouts on
 * screen every time a card moves, so it is true right now. The crew group is a
 * re-read that can be a minute or two old and is keyed by pool rather than by
 * fight. Merging them would need reconciling two shapes, and — worse — the
 * fresh half would vouch for the stale one. Each group says what it is and when
 * it was true.
 *
 * The crew group renders even when it is empty; the live group does not. An
 * empty live group means the board just looked and found nothing. An empty crew
 * group can also mean the read failed, or that the check is switched off in
 * referee settings — and on a safety banner those must not look like a clean
 * board.
 */

type Translate = ReturnType<typeof useI18n>['t'];

/** Which of the three checks are off, in the operator's language. */
function rulesOff(rules: RefereeCrewRules, t: Translate): string[] {
  const off: string[] = [];
  // Three literal calls rather than a lookup table. The i18n sweep resolves
  // keys that appear as literals at the call site; indexing a table by rule
  // name would hide all three from its forward check and orphan them in its
  // reverse one.
  if (!rules.officiateVsFight) {
    off.push(t('organizer.schedulePage.grid.refereeRuleOfficiateVsFight'));
  }
  if (!rules.doubleBooked) off.push(t('organizer.schedulePage.grid.refereeRuleDoubleBooked'));
  if (!rules.availability) off.push(t('organizer.schedulePage.grid.refereeRuleAvailability'));
  return off;
}

/** One live finding, as a sentence. */
function liveLine(row: RefereeConflictRow, t: Translate): string {
  if (row.kind === 'own_bout') {
    return t('organizer.schedulePage.grid.refereeOwnBout', {
      person: row.personName,
      match: row.refereeingLabel,
    });
  }
  return t('organizer.schedulePage.grid.refereeOverlap', {
    person: row.personName,
    fight: row.fightingLabel,
    fightTime: row.fightingTime,
    refereeing: row.refereeingLabel,
    refereeTime: row.refereeingTime,
  });
}

/**
 * One crew finding, in the same words the referee workspace uses. Those
 * sentences have one owner: duplicating them here would let two surfaces
 * describe the same finding differently.
 */
function crewDetail(conflict: RefereeCrewConflict, t: Translate): string {
  if (conflict.kind === 'unavailable') {
    return t('organizer.refereesPage.conflict.unavailableLine', {
      tournament: conflict.otherPoolName,
    });
  }
  if (conflict.kind === 'double_booked') {
    return conflict.crossVenue && conflict.otherVenueName
      ? t('organizer.refereesPage.conflict.alsoOfficiatingVenue', {
          pool: conflict.otherPoolName,
          venue: conflict.otherVenueName,
        })
      : t('organizer.refereesPage.conflict.alsoOfficiating', { pool: conflict.otherPoolName });
  }
  return t('organizer.refereesPage.conflict.alsoFighting', { pool: conflict.otherPoolName });
}

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
  const crewIsClean = crew?.ok === true && crewConflicts.length === 0 && off.length === 0;
  // Nothing to say and nothing wrong: the first read is still out, or it came
  // back clean with every check running. A banner in either case would flash on
  // every page load and then cry wolf.
  if (live.length === 0 && (crew === null || crewIsClean)) return null;

  const asOf = crew?.ok ? hhmmInZone(crew.asOf, eventTz) : '';

  return (
    <div className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-3 mb-6 text-sm">
      <p className="font-bold text-danger mb-2">{t('organizer.schedulePage.grid.refereeTitle')}</p>

      {live.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-medium text-danger/80 mb-1">
            {t('organizer.schedulePage.grid.refereeLiveGroup')}
          </p>
          <ul className="list-disc list-inside text-danger space-y-0.5">
            {live.map((row) => (
              <li key={`${row.kind}:${row.fightingMatchId}:${row.refereeingMatchId}`}>
                {liveLine(row, t)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-danger/80 mb-1">
          {crew?.ok
            ? t('organizer.schedulePage.grid.refereeCrewGroup', { time: asOf })
            : t('organizer.schedulePage.grid.refereeCrewUnavailable')}
        </p>
        {off.length > 0 && (
          <p className="text-xs text-danger/80 mb-1">
            {t('organizer.schedulePage.grid.refereeCrewRulesOff', { rules: off.join(' · ') })}
          </p>
        )}
        {crew?.ok &&
          (crewConflicts.length > 0 ? (
            <ul className="list-disc list-inside text-danger space-y-0.5">
              {crewConflicts.map((c, i) => (
                <li key={`${c.poolId}:${c.personId}:${i}`}>
                  <strong>{c.personName}</strong> — {c.poolName} · {crewDetail(c, t)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-danger/80">{t('organizer.schedulePage.grid.refereeCrewNone')}</p>
          ))}
      </div>
    </div>
  );
}
