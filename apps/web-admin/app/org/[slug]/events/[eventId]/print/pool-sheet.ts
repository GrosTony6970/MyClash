/**
 * The pool sheet: who is in the pool, and every bout with blank boxes to score
 * it by hand.
 *
 * This is the sheet an event falls back to when the stack is unreachable, so it
 * gets printed blank before the day starts. Everything a scorekeeper needs to reconstruct
 * the pool afterwards has to be on it: the round code (so the bout can be
 * matched back to a row in the database), both names with clubs, and the piste.
 */
import { escapeHtml } from '@myclash/types';
import { cornerSwatch, sheetHead } from './print-shell';
import type { PrintLabels, PrintPool, PrintTournamentMeta } from './print-types';

function rosterTable(pool: PrintPool, labels: PrintLabels): string {
  const rows = pool.fighters
    .map(
      (fighter, index) =>
        `<tr><td class="center narrow">${index + 1}</td>` +
        `<td>${escapeHtml(fighter.name)}</td>` +
        `<td>${escapeHtml(fighter.club ?? '')}</td></tr>`,
    )
    .join('');
  return (
    `<table><thead><tr><th class="narrow">#</th>` +
    `<th>${escapeHtml(labels.fighter)}</th><th>${escapeHtml(labels.club)}</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`
  );
}

function boutRows(pool: PrintPool, meta: PrintTournamentMeta): string {
  return pool.matches
    .map(
      (match) =>
        `<tr><td>${escapeHtml(match.roundCode)}</td>` +
        `<td>${cornerSwatch(meta.sideColors.red)}${escapeHtml(match.redName)}` +
        (match.redClub ? ` <span style="color:#666">(${escapeHtml(match.redClub)})</span>` : '') +
        `</td>` +
        `<td>${cornerSwatch(meta.sideColors.blue)}${escapeHtml(match.blueName)}` +
        (match.blueClub ? ` <span style="color:#666">(${escapeHtml(match.blueClub)})</span>` : '') +
        `</td>` +
        // Blank on purpose — the point of the sheet is that these get written in.
        `<td class="box narrow"></td><td class="box narrow"></td>` +
        `<td class="box narrow"></td><td class="box"></td></tr>`,
    )
    .join('');
}

export function poolSheetHtml(
  pool: PrintPool,
  meta: PrintTournamentMeta,
  labels: PrintLabels,
): string {
  const pistes = [...new Set(pool.matches.map((m) => m.liceName).filter(Boolean))].join(', ');
  const subtitle = pistes ? `${labels.piste}: ${pistes}` : undefined;

  return (
    `<section class="sheet">` +
    sheetHead(`${labels.poolSheet} — ${pool.poolName}`, meta, labels, subtitle) +
    rosterTable(pool, labels) +
    `<h2>${escapeHtml(labels.bout)}</h2>` +
    `<table><thead><tr>` +
    `<th>${escapeHtml(labels.round)}</th>` +
    `<th>${escapeHtml(labels.red)}</th>` +
    `<th>${escapeHtml(labels.blue)}</th>` +
    `<th class="narrow">${escapeHtml(labels.score)}</th>` +
    `<th class="narrow">${escapeHtml(labels.doubles)}</th>` +
    `<th class="narrow">${escapeHtml(labels.penalties)}</th>` +
    `<th>${escapeHtml(labels.winner)}</th>` +
    `</tr></thead><tbody>${boutRows(pool, meta)}</tbody></table>` +
    `<div class="sig">${escapeHtml(labels.signature)}<span class="line"></span></div>` +
    `</section>`
  );
}
