/**
 * Composes the selected sheets into one printable document.
 *
 * One document rather than four print dialogs: on event morning the operator
 * hits print once and picks the whole pack out of the tray in order.
 */
import { printDocument } from './print-shell';
import { poolSheetHtml } from './pool-sheet';
import { matchScoresheetHtml } from './match-scoresheet';
import { pisteSheetHtml, groupByPiste } from './piste-sheet';
import { bracketSheetHtml } from './bracket-sheet';
import type {
  PrintBracketRound,
  PrintLabels,
  PrintMatch,
  PrintPool,
  PrintTournamentMeta,
} from './print-types';

export type PrintSectionKey = 'pools' | 'scoresheets' | 'pistes' | 'bracket';

export interface PrintPackInput {
  meta: PrintTournamentMeta;
  labels: PrintLabels;
  pools: readonly PrintPool[];
  bracketRounds: readonly PrintBracketRound[];
  /** Every bout in the tournament, in the order it will be fought. */
  allMatches: readonly PrintMatch[];
  sections: readonly PrintSectionKey[];
}

export function printPackHtml(input: PrintPackInput): string {
  const { meta, labels, pools, bracketRounds, allMatches, sections } = input;
  const selected = new Set(sections);
  const sheets: string[] = [];

  if (selected.has('pools')) {
    sheets.push(...pools.map((pool) => poolSheetHtml(pool, meta, labels)));
  }

  if (selected.has('bracket') && bracketRounds.length > 0) {
    sheets.push(bracketSheetHtml(bracketRounds, meta, labels));
  }

  if (selected.has('pistes')) {
    sheets.push(
      ...groupByPiste(allMatches, labels.unassigned).map((piste) =>
        pisteSheetHtml(piste, meta, labels),
      ),
    );
  }

  // Last on purpose: one page per bout makes this the thickest section by far,
  // and an operator who only wants the pool sheets should not have to page past
  // sixty scoresheets to check them.
  if (selected.has('scoresheets')) {
    sheets.push(...allMatches.map((match) => matchScoresheetHtml(match, meta, labels)));
  }

  return printDocument(`${meta.tournamentName} — ${meta.eventName}`, sheets);
}
