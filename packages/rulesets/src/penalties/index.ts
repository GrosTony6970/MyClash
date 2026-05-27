export type PenaltyCard = 'yellow' | 'red' | 'black';
export type PenaltyAccumulationScope = 'match' | 'phase' | 'tournament';
export type PenaltySource = 'ruleset' | 'direct';

export interface PenaltyRulesetEntry {
  groupNumber: number;
  /**
   * Identifier of the rule within its group. String to allow alphanumeric
   * rulebook references like "R7a" or "B-12". The engine treats it as
   * opaque — validation only enforces non-empty + a safe-char set at the
   * input boundary (CSV parser and API DTO).
   */
  refNumber: string;
  shortName: string;
  description: string;
  sanctions: readonly PenaltyCard[];
}

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

export interface ExistingPenaltyForSanction {
  registrationId: string;
  groupNumber?: number;
  card: PenaltyCard;
  source: PenaltySource;
  voided?: boolean;
}

export interface PenaltySanctionResult {
  card: PenaltyCard;
  groupOccurrence: number;
  scoreDelta: number;
  causesMatchForfeit: boolean;
}

export function normalizePenaltyCard(value: string): PenaltyCard {
  const normalized = value.trim().toLowerCase();
  if (['jaune', 'yellow'].includes(normalized)) return 'yellow';
  if (['rouge', 'red'].includes(normalized)) return 'red';
  if (['noir', 'black'].includes(normalized)) return 'black';
  throw new Error(`Unknown penalty card "${value}"`);
}

export function penaltyScoreDelta(card: PenaltyCard): number {
  return card === 'red' ? -1 : 0;
}

export function penaltyCausesMatchForfeit(card: PenaltyCard): boolean {
  return card === 'black';
}

export function computePenaltySanction(
  entry: PenaltyRulesetEntry,
  existingPenalties: ExistingPenaltyForSanction[],
  registrationId = 'fighter-1',
): PenaltySanctionResult {
  const previousSameGroup = existingPenalties.filter(
    (penalty) =>
      !penalty.voided &&
      penalty.source === 'ruleset' &&
      penalty.registrationId === registrationId &&
      penalty.groupNumber === entry.groupNumber,
  ).length;
  const groupOccurrence = previousSameGroup + 1;
  const card = entry.sanctions[Math.min(groupOccurrence, entry.sanctions.length) - 1];
  if (!card) {
    throw new Error(
      `Penalty entry ${entry.refNumber} has no sanction for occurrence ${groupOccurrence}`,
    );
  }
  return {
    card,
    groupOccurrence,
    scoreDelta: penaltyScoreDelta(card),
    causesMatchForfeit: penaltyCausesMatchForfeit(card),
  };
}

export function computeDirectPenaltySanction(card: PenaltyCard): PenaltySanctionResult {
  return {
    card,
    groupOccurrence: 0,
    scoreDelta: penaltyScoreDelta(card),
    causesMatchForfeit: penaltyCausesMatchForfeit(card),
  };
}

export function parsePenaltyRulesetCsv(
  csv: string,
  metadata: PenaltyRulesetMetadata,
): PenaltyRulesetDefinition {
  const rows = csv
    .replace(/^\uFEFF/, '')
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
