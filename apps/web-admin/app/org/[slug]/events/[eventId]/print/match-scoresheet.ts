/**
 * The blank match scoresheet: one bout per page, with numbered exchange rows.
 *
 * This is the sheet that stands in for the pad. If the tablet dies mid-bout, a
 * scorekeeper picks this up and keeps going — so it carries the same primitives
 * the pad records (exchange number, who struck, the value, whether it was a
 * double) rather than only a final score, and it ends with a signature line
 * because a hand-written result needs someone's name against it.
 */
import { escapeHtml } from '@myclash/types';
import { cornerSwatch, sheetHead } from './print-shell';
import type { PrintLabels, PrintMatch, PrintTournamentMeta } from './print-types';

/** Rows to print. Enough for a long bout; a second sheet is always available. */
const EXCHANGE_ROWS = 20;

function fighterCell(name: string, club: string | null, color: string): string {
  return (
    `${cornerSwatch(color)}<strong>${escapeHtml(name)}</strong>` +
    (club ? `<br><span style="color:#666;font-size:10px">${escapeHtml(club)}</span>` : '')
  );
}

function exchangeRows(): string {
  let rows = '';
  for (let index = 1; index <= EXCHANGE_ROWS; index += 1) {
    rows +=
      `<tr><td class="center narrow">${index}</td>` +
      `<td class="box"></td><td class="box"></td><td class="box narrow"></td></tr>`;
  }
  return rows;
}

export function matchScoresheetHtml(
  match: PrintMatch,
  meta: PrintTournamentMeta,
  labels: PrintLabels,
): string {
  const referees = match.referees.length > 0 ? match.referees.join(', ') : labels.unassigned;
  const piste = match.liceName ?? labels.unassigned;

  return (
    `<section class="sheet">` +
    sheetHead(
      `${labels.scoresheet} — ${match.roundCode}`,
      meta,
      labels,
      `${labels.piste}: ${piste} · ${labels.referee}: ${referees}`,
    ) +
    `<table><thead><tr>` +
    `<th style="width:50%">${escapeHtml(labels.red)}</th>` +
    `<th style="width:50%">${escapeHtml(labels.blue)}</th>` +
    `</tr></thead><tbody><tr>` +
    `<td>${fighterCell(match.redName, match.redClub, meta.sideColors.red)}</td>` +
    `<td>${fighterCell(match.blueName, match.blueClub, meta.sideColors.blue)}</td>` +
    `</tr><tr><td class="box"></td><td class="box"></td></tr></tbody></table>` +
    `<h2>${escapeHtml(labels.exchanges)}</h2>` +
    `<table><thead><tr>` +
    `<th class="narrow">#</th>` +
    `<th>${escapeHtml(labels.red)}</th>` +
    `<th>${escapeHtml(labels.blue)}</th>` +
    `<th class="narrow">${escapeHtml(labels.doubles)}</th>` +
    `</tr></thead><tbody>${exchangeRows()}</tbody></table>` +
    `<h2>${escapeHtml(labels.penalties)}</h2>` +
    `<table><tbody><tr><td class="box"></td></tr></tbody></table>` +
    `<h2>${escapeHtml(labels.notes)}</h2>` +
    `<table><tbody><tr><td class="box"></td></tr></tbody></table>` +
    `<div class="sig">${escapeHtml(labels.winner)}<span class="line"></span>` +
    `&nbsp;&nbsp;${escapeHtml(labels.signature)}<span class="line"></span></div>` +
    `</section>`
  );
}
