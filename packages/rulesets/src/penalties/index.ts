/**
 * Penalty ruleset IMPORT — turning a federation's CSV into entries.
 *
 * The sanction half of this file moved to `@myclash/types`: the cards, the
 * accumulation ladder and the per-card default cost. It had to, because the
 * referee pad needs to know which card a repeated offence earns, and
 * `@myclash/rulesets` is deliberately unreachable from `apps/web-staff` — that
 * is what keeps the AST-driven scoring engine off a tablet with no network
 * ("Seed, don't resolve", ARCHITECTURE.md §7.3).
 *
 * A penalty catalogue is not the scoring engine. It is rows the pad already
 * fetches. Splitting it this way lets the pad and the server compute a card
 * with ONE function instead of two that can drift.
 *
 * What stays here is the CSV parser, which is server and tooling work — an
 * operator uploads a rulebook, this reads it. No pad ever calls it.
 *
 * Everything moved is re-exported below, so `@myclash/rulesets` remains the
 * import site every existing caller already uses.
 */
import { normalizePenaltyCard } from '@myclash/types';
import type { PenaltyAccumulationScope, PenaltyRulesetEntry } from '@myclash/types';

export {
  computeDirectPenaltySanction,
  computePenaltySanction,
  normalizePenaltyCard,
  penaltyCausesMatchForfeit,
  penaltyScoreDelta,
} from '@myclash/types';
export type {
  ExistingPenaltyForSanction,
  PenaltyAccumulationScope,
  PenaltyCard,
  PenaltyRulesetEntry,
  PenaltySanctionResult,
  PenaltySource,
} from '@myclash/types';

export interface PenaltyRulesetDefinition {
  code: string;
  name: string;
  version: string;
  accumulationScope: PenaltyAccumulationScope;
  builtIn: boolean;
  entries: PenaltyRulesetEntry[];
}

export interface PenaltyRulesetMetadata {
  code: string;
  name: string;
  version: string;
  accumulationScope: PenaltyAccumulationScope;
  builtIn: boolean;
}

export function parsePenaltyRulesetCsv(
  csv: string,
  metadata: PenaltyRulesetMetadata,
): PenaltyRulesetDefinition {
  const rows = csv
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(splitSemicolonCsvLine);

  if (rows.length < 2) {
    throw new Error('Penalty CSV must contain a header and at least one entry');
  }

  const entries = rows.slice(1).map((row, index) => {
    const groupNumber = Number(row[0]);
    const refNumber = (row[1] ?? '').trim();
    const shortName = row[2]?.trim() ?? '';
    const description = row[3]?.trim() ?? '';
    const sanctions = row
      .slice(4, 8)
      .map((value) => value.trim())
      .filter((value) => value && !['none', 'aucun'].includes(value.toLowerCase()))
      .map(normalizePenaltyCard);

    if (!Number.isInteger(groupNumber) || groupNumber < 1) {
      throw new Error(`Penalty CSV line ${index + 2} has an invalid group number`);
    }
    // REF is opaque: digits ("1"), alphanumeric ("R7a"), or hyphenated
    // ("B-12") are all valid. Reject empty / whitespace-only / overly long.
    if (!refNumber || refNumber.length > 20 || !/^[\w-]+$/.test(refNumber)) {
      throw new Error(`Penalty CSV line ${index + 2} has an invalid ref number`);
    }
    if (!shortName) {
      throw new Error(`Penalty CSV line ${index + 2} is missing a short name`);
    }
    if (!description) {
      throw new Error(`Penalty CSV line ${index + 2} is missing a description`);
    }
    if (sanctions.length === 0) {
      throw new Error(`Penalty CSV line ${index + 2} must define at least one sanction`);
    }

    return { groupNumber, refNumber, shortName, description, sanctions };
  });

  return { ...metadata, entries };
}

function splitSemicolonCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i++;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ';' && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}
