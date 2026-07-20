/**
 * packages/rulesets/src/tf_v1/targets.ts
 *
 * Named targets — the grammar half of a ruleset: what an exchange can be and
 * what it is worth.
 *
 * TF_v1 modelled this as exactly two anonymous slots, `{deepTarget,
 * shallowTarget}`, which is FFAMHE's convention rather than a property of
 * fencing. A federation scoring head/torso/limb, or one that scores a single
 * undifferentiated hit, could not be expressed at all. `targets[]` replaces the
 * pair with any number of *named* targets.
 *
 * Two things this is NOT:
 *  - It is not where scoring reads point values from. Scoring reads the value
 *    off the pressed button on the exchange (`scoring_config_json.buttons`);
 *    targets are what the tournament's buttons get SEEDED from at creation.
 *    Exchanges remain the source of truth.
 *  - It is not i18n. Target names are operator-authored data rendered raw —
 *    a federation names its own targets. Only the chrome around them is
 *    translated.
 */
import { z } from 'zod';

/**
 * Upper bound on target count. The afterblow button grid is the full
 * attacker × defender product, so N targets seed N² afterblow buttons — 8
 * targets is already 64 buttons on a referee's pad.
 */
export const MAX_TARGETS = 8;

/**
 * Upper bound on a stored target value.
 *
 * Deliberately LOOSER than the authoring bound. `createExchangeSchema` caps
 * `firstStrikeValue` at 10, so a target worth more than that produces a button
 * that 400s the exchange POST — which the offline queue then drops as terminal.
 * The API DTO therefore rejects >10 on WRITE, while the engine stays liberal on
 * READ: a config stored before that bound existed must still parse, because
 * failing here would 400 the standings page too, turning a broken button into a
 * broken tournament.
 */
export const MAX_STORED_TARGET_VALUE = 99;

/**
 * Upper bound on an AUTHORED target value — the write-side counterpart to
 * `MAX_STORED_TARGET_VALUE`.
 *
 * 10 is not arbitrary: it is `createExchangeSchema`'s cap on
 * `firstStrikeValue`. Authoring a target worth more produces a scoring button
 * that 400s the exchange POST, and the offline queue treats a 400 as terminal
 * and drops the exchange — so an out-of-range target does not degrade, it
 * loses fencing data. Reject it at authoring time, where the operator is
 * present to fix it.
 */
export const MAX_AUTHORED_TARGET_VALUE = 10;

export const TargetSchema = z.object({
  name: z.string().trim().min(1).max(40),
  value: z.number().int().min(1).max(MAX_STORED_TARGET_VALUE),
});

export type Target = z.infer<typeof TargetSchema>;

/** Read-side: liberal, so a config stored before the bounds existed still parses. */
export const TargetsSchema = z.array(TargetSchema).min(1).max(MAX_TARGETS);

/** Write-side: strict, so nothing new is stored that scoring cannot accept. */
export const AuthoredTargetsSchema = z
  .array(
    TargetSchema.extend({
      value: z.number().int().min(1).max(MAX_AUTHORED_TARGET_VALUE),
    }),
  )
  .min(1)
  .max(MAX_TARGETS);

/**
 * TF_v1's federal pair, expressed as named targets. Names are seed values the
 * operator renames, not labels — the referee's pad shows the numeric button
 * label ("+2"), never the target name.
 */
export const DEFAULT_TARGETS: Target[] = [
  { name: 'Deep', value: 2 },
  { name: 'Shallow', value: 1 },
];

/** The legacy shape `targets[]` replaces. */
interface LegacyTargetValues {
  deepTarget?: unknown;
  shallowTarget?: unknown;
}

/**
 * Derive `targets[]` from a legacy `{deepTarget, shallowTarget}` config.
 *
 * Runs at the OBJECT level rather than as a field preprocess because it reads a
 * sibling key. Returns the input untouched whenever `targets` is already
 * present, so a migrated config is never overwritten by its own legacy mirror.
 */
export function withDerivedTargets(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const config = raw as Record<string, unknown>;
  if (config['targets'] !== undefined) return raw;

  const legacy = config['targetValues'];
  if (legacy === null || typeof legacy !== 'object' || Array.isArray(legacy)) return raw;

  const { deepTarget, shallowTarget } = legacy as LegacyTargetValues;
  const derived: Target[] = [];
  if (typeof deepTarget === 'number') derived.push({ name: 'Deep', value: deepTarget });
  if (typeof shallowTarget === 'number') derived.push({ name: 'Shallow', value: shallowTarget });
  if (derived.length === 0) return raw;

  return { ...config, targets: derived };
}
