/**
 * The bracket sheet: every bracket bout, grouped by round, with blank score
 * boxes.
 *
 * Deliberately a round-by-round list and not a drawn tree. A tree that survives
 * an arbitrary bracket size, a play-in round, a repechage and a grand-final
 * reset — all of which this codebase supports — does not fit an A4 page without
 * scaling type down to the point where nobody at a piste can read it. The list
 * carries the same information, prints reliably at any size, and leaves room to
 * write the score next to the bout.
 */
import { escapeHtml } from '@myclash/types';
import { cornerSwatch, sheetHead } from './print-shell';
import type { PrintBracketRound, PrintLabels, PrintTournamentMeta } from './print-types';

function roundBlock(
  round: PrintBracketRound,
  meta: PrintTournamentMeta,
  labels: PrintLabels,
): string {
  const rows = round.matches
    .map(
      (match) =>
        `<tr><td>${escapeHtml(match.roundCode)}</td>` +
        `<td>${cornerSwatch(meta.sideColors.red)}${escapeHtml(match.redName)}</td>` +
        `<td class="box narrow"></td>` +
        `<td>${cornerSwatch(meta.sideColors.blue)}${escapeHtml(match.blueName)}</td>` +
        `<td class="box narrow"></td>` +
        `<td>${escapeHtml(match.liceName ?? labels.unassigned)}</td></tr>`,
    )
    .join('');

  return (
    `<h2>${escapeHtml(round.roundName)}</h2>` +
    `<table><thead><tr>` +
    `<th>${escapeHtml(labels.round)}</th>` +
    `<th>${escapeHtml(labels.red)}</th>` +
    `<th class="narrow">${escapeHtml(labels.score)}</th>` +
    `<th>${escapeHtml(labels.blue)}</th>` +
    `<th class="narrow">${escapeHtml(labels.score)}</th>` +
    `<th>${escapeHtml(labels.piste)}</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`
  );
}

export function bracketSheetHtml(
  rounds: readonly PrintBracketRound[],
  meta: PrintTournamentMeta,
  labels: PrintLabels,
): string {
  return (
    `<section class="sheet">` +
    sheetHead(labels.bracketSheet, meta, labels) +
    rounds.map((round) => roundBlock(round, meta, labels)).join('') +
    `<div class="sig">${escapeHtml(labels.signature)}<span class="line"></span></div>` +
    `</section>`
  );
}
