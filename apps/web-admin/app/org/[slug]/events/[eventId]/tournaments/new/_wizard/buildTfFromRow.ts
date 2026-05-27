/**
 * Hydrate the Step 4 wizard's local state from the persisted
 * `ruleset_config` JSONB blob.
 *
 * Why this is its own module: the previous inline implementation in
 * Step4Advanced.tsx used `{ ...defaults, ...rowSlice }` which leaked
 * **any** key the row carried into the wizard's state, and then back
 * out via the PATCH body. With the API's strict
 * `forbidNonWhitelisted: true` ValidationPipe, that meant a 400 the
 * moment the row carried a single key the DTO didn't recognise —
 * notably the rulesets-engine `forfeitPolicy.reasons.*` blob that
 * shared the `forfeitPolicy` name before this commit renamed the
 * wizard's switches to `tournamentPolicy`.
 *
 * This helper builds the wizard state by **explicit field picks**, so
 * a future legacy/leaked key on the row simply gets dropped. The
 * companion vitest case asserts the JSON output never contains an
 * unknown key — that's the regression guard.
 */

export interface RulesetConfigTF {
  winBonus: number;
  targetValues: { deepTarget: number; shallowTarget: number };
  tournamentPolicy: {
    forfeitDrawsCount: boolean;
    forfeitFighterBefore1stMatch: boolean;
    disqualifyAfter: number;
  };
}

export const TF_DEFAULTS: RulesetConfigTF = {
  winBonus: 3,
  targetValues: { deepTarget: 2, shallowTarget: 1 },
  tournamentPolicy: {
    forfeitDrawsCount: false,
    forfeitFighterBefore1stMatch: false,
    disqualifyAfter: 2,
  },
};

export function buildTfFromRow(
  rc: Partial<RulesetConfigTF> & Record<string, unknown>,
  defaults: RulesetConfigTF,
): RulesetConfigTF {
  const tv = (rc.targetValues ?? {}) as Partial<RulesetConfigTF['targetValues']>;
  const tp = (rc.tournamentPolicy ?? {}) as Partial<RulesetConfigTF['tournamentPolicy']>;
  return {
    winBonus: typeof rc.winBonus === 'number' ? rc.winBonus : defaults.winBonus,
    targetValues: {
      deepTarget:
        typeof tv.deepTarget === 'number' ? tv.deepTarget : defaults.targetValues.deepTarget,
      shallowTarget:
        typeof tv.shallowTarget === 'number'
          ? tv.shallowTarget
          : defaults.targetValues.shallowTarget,
    },
    tournamentPolicy: {
      forfeitDrawsCount:
        typeof tp.forfeitDrawsCount === 'boolean'
          ? tp.forfeitDrawsCount
          : defaults.tournamentPolicy.forfeitDrawsCount,
      forfeitFighterBefore1stMatch:
        typeof tp.forfeitFighterBefore1stMatch === 'boolean'
          ? tp.forfeitFighterBefore1stMatch
          : defaults.tournamentPolicy.forfeitFighterBefore1stMatch,
      disqualifyAfter:
        typeof tp.disqualifyAfter === 'number'
          ? tp.disqualifyAfter
          : defaults.tournamentPolicy.disqualifyAfter,
    },
  };
}
