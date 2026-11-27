/**
 * A draft's actions by name (MCP slice 4b, call U). The API turns each id a draft action holds
 * into the name people know (`readableDraftActions`); the page and the chat card word these in
 * EN and FR, and Claude reads the same names. No id at any depth: Marie sees "LSW-P2-M04 on
 * Piste 2", never `matchId`. Types only, so no app ships code for them.
 */

/**
 * An id the Event does not have: a Match deleted since the draft was made, another Event's
 * Tournament, or an id a failed draft never held. Never the id itself.
 */
export interface ReadableMissing {
  missing: true;
}

/** A row named by its name (a Tournament, a piste, a referee, a referee role), or missing. */
export type ReadableName = { name: string } | ReadableMissing;

/** A Match by its round code (`LSW-P2-M04`) and its Tournament's name. */
export interface ReadableMatch {
  code: string;
  tournament: string;
}

/** A Pool by its number (`P2` is 2) and its Tournament's name. */
export interface ReadablePool {
  number: number;
  tournament: string;
}

/** A phase by its type (`pool`, `swiss`, …) and its Tournament's name. */
export interface ReadablePhase {
  type: string;
  tournament: string;
}

/**
 * One draft action by name, one variant per action kind a draft carries. A plain value the
 * action does not hold (or holds in the wrong type) is absent. `unsupported` is an action of
 * no known kind: a failed draft from the form flow may store anything the model answered.
 */
export type ReadableDraftAction =
  | {
      kind: 'create_tournament';
      name?: string;
      slug?: string;
      weapon?: string;
      rulesetCode?: string;
    }
  | {
      kind: 'generate_pools';
      tournament: ReadableName;
      poolCount?: number;
      targetSize?: number;
      schoolSeparation?: boolean;
      skillBalance?: boolean;
      seed?: number;
      /** Replace the Tournament's Pools when it has some. */
      force?: boolean;
    }
  | {
      kind: 'generate_bracket';
      tournament: ReadableName;
      phaseType?: 'single_elim' | 'double_elim';
      qualifyCount?: number;
      bracketSize?: number;
      /** The phase whose results seed the bracket, when the action names one. */
      poolPhase?: ReadablePhase | ReadableMissing;
      /** Replace the Tournament's bracket when it has one. */
      force?: boolean;
    }
  | {
      kind: 'schedule_match';
      match: ReadableMatch | ReadableMissing;
      piste: ReadableName;
      /** The start as an ISO instant, or null when the action's time cannot be read. */
      startsAt: string | null;
      /** The Event's zone: the start shows on its wall clock. */
      timezone: string;
    }
  | {
      kind: 'assign_referee';
      referee: ReadableName;
      role: ReadableName;
      /** The Pool the referee is assigned to, when the action names one. */
      pool?: ReadablePool | ReadableMissing;
      /** The Match the referee is assigned to, when the action names one. */
      match?: ReadableMatch | ReadableMissing;
    }
  | { kind: 'unsupported' };
