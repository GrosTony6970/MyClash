/**
 * The piste day-sheet: everything happening on one lice, in order.
 *
 * This is what gets taped to the piste table. It is derived from the same bouts
 * the pool and bracket sheets use rather than from the schedule endpoint — one
 * source means the three sheets in a pack can never disagree about who is
 * fighting where, which is the failure that actually costs an event time.
 *
 * Bouts with no lice assigned are grouped under their own heading rather than
 * dropped: "not yet placed" is information the organiser needs on paper too.
 */
import { escapeHtml } from '@myclash/types';
import { formatInZone } from '@myclash/time';
import { cornerSwatch, sheetHead } from './print-shell';
import type { PrintLabels, PrintMatch, PrintPiste, PrintTournamentMeta } from './print-types';

/**
 * Regroup bouts by piste, IN CLOCK ORDER.
 *
 * It used to keep the order it was given — pools first, then bracket rounds —
 * on the reasoning that this is the order they are fought. That is only true of
 * a day nobody has scheduled. Once the bouts have times, the order they will be
 * fought is the times, and a sheet taped to a piste table listing them by
 * generation order is actively misleading: the person reading it is looking for
 * what happens next.
 *
 * Bouts with no time go LAST, in the order they arrived. They are not "at 00:00"
 * — they are not placed yet, and sorting them to the top would put the least
 * certain rows where the eye goes first.
 *
 * Only the piste sheet is regrouped this way. The pool, bracket and scoresheet
 * sections keep the order they have, because a pool sheet is a round-robin grid
 * and a bracket is a tree — neither reads by the clock.
 */
export function groupByPiste(
  matches: readonly PrintMatch[],
  unassignedLabel: string,
): PrintPiste[] {
  const byPiste = new Map<string, PrintMatch[]>();
  for (const match of matches) {
    const key = match.liceName ?? unassignedLabel;
    const bucket = byPiste.get(key);
    if (bucket) bucket.push(match);
    else byPiste.set(key, [match]);
  }
  return [...byPiste.entries()].map(([liceName, pisteMatches]) => ({
    liceName,
    matches: [...pisteMatches].sort(byClockThenGiven),
  }));
}

/**
 * Earliest first; unscheduled last; otherwise the order given.
 *
 * ISO instants compare correctly as strings only when they share an offset, so
 * this compares parsed milliseconds. `Array.prototype.sort` is stable, which is
 * what preserves generation order inside a shared minute and across the whole
 * unscheduled tail.
 */
function byClockThenGiven(a: PrintMatch, b: PrintMatch): number {
  if (!a.scheduledAt && !b.scheduledAt) return 0;
  if (!a.scheduledAt) return 1;
  if (!b.scheduledAt) return -1;
  return Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt);
}

/** `HH:MM` on the EVENT's clock, or an em dash for a bout with no time yet. */
function clockCell(scheduledAt: string | null, timeZone: string): string {
  if (!scheduledAt) return '—';
  return formatInZone(scheduledAt, timeZone, { hour: '2-digit', minute: '2-digit' });
}

export function pisteSheetHtml(
  piste: PrintPiste,
  meta: PrintTournamentMeta,
  labels: PrintLabels,
): string {
  const rows = piste.matches
    .map(
      (match) =>
        `<tr><td>${escapeHtml(clockCell(match.scheduledAt, meta.timeZone))}</td>` +
        `<td>${escapeHtml(match.roundCode)}</td>` +
        `<td>${cornerSwatch(meta.sideColors.red)}${escapeHtml(match.redName)}</td>` +
        `<td>${cornerSwatch(meta.sideColors.blue)}${escapeHtml(match.blueName)}</td>` +
        `<td>${escapeHtml(match.referees.length > 0 ? match.referees.join(', ') : labels.unassigned)}</td>` +
        `<td class="box narrow"></td></tr>`,
    )
    .join('');

  return (
    `<section class="sheet">` +
    sheetHead(`${labels.pisteSheet} — ${piste.liceName}`, meta, labels) +
    `<table><thead><tr>` +
    `<th class="narrow">${escapeHtml(labels.time)}</th>` +
    `<th>${escapeHtml(labels.round)}</th>` +
    `<th>${escapeHtml(labels.red)}</th>` +
    `<th>${escapeHtml(labels.blue)}</th>` +
    `<th>${escapeHtml(labels.referee)}</th>` +
    `<th class="narrow">${escapeHtml(labels.score)}</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>` +
    `</section>`
  );
}
