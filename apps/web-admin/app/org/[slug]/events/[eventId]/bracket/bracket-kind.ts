import type { TournamentBracketSlotWire } from '@myclash/types/bracket-side';
import { forfeitingSide, type ForfeitingSide } from '../matches/[matchId]/forfeiting-side';
import type { SeatKind } from '../pools/pool-seats';

/**
 * What the bracket page offers and says for the Tournament's kind of entrant (ADR-022). A team
 * Tournament runs single elimination only (call 2 of slice 1c-1); a team has no rating until its
 * members are named (ruling 971), and no Swiss phase to seed from. Its seeds set the order only
 * (ruling 982). Pure, so the page stays a shell.
 */

export type SeedingStrategy = 'snake' | 'by-rating' | 'random' | 'by-pool-rank';
export type BracketPhaseType = 'single_elim' | 'double_elim';

const STRATEGIES: Record<SeatKind, readonly SeedingStrategy[]> = {
  individual: ['snake', 'by-rating', 'random', 'by-pool-rank'],
  team: ['snake', 'random', 'by-pool-rank'],
};

const PHASE_TYPES: Record<SeatKind, readonly BracketPhaseType[]> = {
  individual: ['single_elim', 'double_elim'],
  team: ['single_elim'],
};

/** The seeding strategies the generate and reseed dialogs offer for the kind. */
export function offeredStrategies(kind: SeatKind): readonly SeedingStrategy[] {
  return STRATEGIES[kind];
}

/** The bracket formats the generate dialog offers for the kind. */
export function offeredPhaseTypes(kind: SeatKind): readonly BracketPhaseType[] {
  return PHASE_TYPES[kind];
}

/**
 * The value a dialog shows and sends: the one picked while it is offered, else the first offered.
 * A hidden field is not sent: a format picked on another Tournament, or read from its bracket,
 * stays in the page's state when the organiser switches to a team Tournament.
 */
export function offeredValue<T>(picked: T, offered: readonly T[]): T {
  return offered.includes(picked) ? picked : (offered[0] as T);
}

/** The i18n keys of a strategy's label. Literal keys: the i18n sweep reads literals only. */
const STRATEGY_LABELS: Record<SeatKind, Record<SeedingStrategy, string>> = {
  individual: {
    snake: 'organizer.phaseVisibility.seedingStrategySnake',
    'by-rating': 'organizer.phaseVisibility.seedingStrategyByRating',
    random: 'organizer.phaseVisibility.seedingStrategyRandom',
    'by-pool-rank': 'organizer.phaseVisibility.seedingStrategyByPoolRank',
  },
  team: {
    snake: 'organizer.phaseVisibility.seedingStrategySnakeTeam',
    'by-rating': 'organizer.phaseVisibility.seedingStrategyByRating',
    random: 'organizer.phaseVisibility.seedingStrategyRandom',
    'by-pool-rank': 'organizer.phaseVisibility.seedingStrategyByPoolRank',
  },
};

/** The i18n key of a strategy's label, for the kind. */
export function strategyLabelKey(kind: SeatKind, strategy: SeedingStrategy): string {
  return STRATEGY_LABELS[kind][strategy];
}

/** The i18n keys of the page's words that name the entrants. */
export interface BracketWords {
  /** The no-Pools confirm: its text and its yes. */
  noPoolsBody: string;
  noPoolsConfirm: string;
  /** The fill's success line when the entrants' own order seeded the bracket. */
  successFromSeed: string;
  /** The override picker. */
  filterPlaceholder: string;
  sideA: string;
  sideB: string;
  empty: string;
  /** The forfeit's two corners. */
  forfeitRed: string;
  forfeitBlue: string;
  /** The config card's count of the bracket's entrants. */
  configCount: string;
  /** The delete confirm's closing hint. */
  deleteConfirmHint: string;
  /** The empty state's body, before a bracket is generated. */
  emptyBody: string;
}

const WORDS: Record<SeatKind, BracketWords> = {
  individual: {
    noPoolsBody: 'organizer.bracket.autoPopulateNoPoolsBody',
    noPoolsConfirm: 'organizer.bracket.autoPopulateNoPoolsConfirm',
    successFromSeed: 'organizer.bracket.autoPopulateSuccessFromSeed',
    filterPlaceholder: 'organizer.bracket.overrideModal.filterPlaceholder',
    sideA: 'organizer.bracket.overrideModal.sideA',
    sideB: 'organizer.bracket.overrideModal.sideB',
    empty: 'organizer.bracket.overrideModal.empty',
    forfeitRed: 'organizer.bracketPage.forfeitRed',
    forfeitBlue: 'organizer.bracketPage.forfeitBlue',
    configCount: 'organizer.phaseVisibility.configFighterCount',
    deleteConfirmHint: 'organizer.bracketPage.deleteConfirmHint',
    emptyBody: 'organizer.bracketPage.emptyBody',
  },
  team: {
    noPoolsBody: 'organizer.bracket.autoPopulateNoPoolsBodyTeam',
    noPoolsConfirm: 'organizer.bracket.autoPopulateNoPoolsConfirmTeam',
    successFromSeed: 'organizer.bracket.autoPopulateSuccessFromSeedTeam',
    filterPlaceholder: 'organizer.bracket.overrideModal.filterPlaceholderTeam',
    sideA: 'organizer.bracket.overrideModal.sideATeam',
    sideB: 'organizer.bracket.overrideModal.sideBTeam',
    empty: 'organizer.bracket.overrideModal.emptyTeam',
    forfeitRed: 'organizer.bracketPage.forfeitRedTeam',
    forfeitBlue: 'organizer.bracketPage.forfeitBlueTeam',
    configCount: 'organizer.phaseVisibility.configTeamCount',
    deleteConfirmHint: 'organizer.bracketPage.deleteConfirmHintTeam',
    emptyBody: 'organizer.bracketPage.emptyBodyTeam',
  },
};

/**
 * The words for the kind. The API reports a team's seed order as `source: 'registration-seed'`
 * too, so the success line is chosen by the Tournament's kind, not by the source.
 */
export function bracketWords(kind: SeatKind): BracketWords {
  return WORDS[kind];
}

/**
 * The slot override's body (call 4): only the sides the organiser changed (`undefined` = left
 * out, unchanged), each by the field of the Tournament's kind; `null` clears the side.
 */
export function slotOverrideBody(
  kind: SeatKind,
  sideA: string | null | undefined,
  sideB: string | null | undefined,
): Record<string, string | null> {
  const [fieldA, fieldB] =
    kind === 'team' ? ['teamAId', 'teamBId'] : ['registrationAId', 'registrationBId'];
  const body: Record<string, string | null> = {};
  if (sideA !== undefined) body[fieldA] = sideA;
  if (sideB !== undefined) body[fieldB] = sideB;
  return body;
}

/** The side a forfeit names on a bracket slot: its Fighter's Registration or its team. */
export function slotForfeitingSide(
  slot: Pick<TournamentBracketSlotWire, 'red' | 'blue'>,
  corner: 'red' | 'blue',
): ForfeitingSide | null {
  return forfeitingSide(
    {
      red_registration_id: slot.red?.registrationId ?? null,
      blue_registration_id: slot.blue?.registrationId ?? null,
      red_team_id: slot.red?.teamId ?? null,
      blue_team_id: slot.blue?.teamId ?? null,
    },
    corner,
  );
}
