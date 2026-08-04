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
import { cornerSwatch, sheetHead } from './print-shell';
import type { PrintLabels, PrintMatch, PrintPiste, PrintTournamentMeta } from './print-types';

/**
 * Regroup bouts by piste, preserving the order they were given in (pools first,
 * then bracket rounds — the order they will actually be fought).
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
    matches: pisteMatches,
  }));
}

export function pisteSheetHtml(
  piste: PrintPiste,
  meta: PrintTournamentMeta,
  labels: PrintLabels,
): string {
  const rows = piste.matches
    .map(
      (match) =>
        `<tr><td>${escapeHtml(match.roundCode)}</td>` +
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
    `<th>${escapeHtml(labels.round)}</th>` +
    `<th>${escapeHtml(labels.red)}</th>` +
    `<th>${escapeHtml(labels.blue)}</th>` +
    `<th>${escapeHtml(labels.referee)}</th>` +
    `<th class="narrow">${escapeHtml(labels.score)}</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>` +
    `</section>`
  );
}
