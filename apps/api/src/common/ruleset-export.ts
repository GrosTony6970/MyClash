import { createHash } from 'node:crypto';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { stableStringify } from '@myclash/rulesets';

/**
 * Portable, self-contained ruleset export/import.
 *
 * A ruleset is serialised to a versioned envelope that carries only its
 * DEFINITION — never platform state (id, owner, status, public_visibility,
 * content-hash stamps, review flags). Import re-validates the definition and
 * creates a FRESH org-owned row (new code, owner = importing org, unshared);
 * the file's identity is never trusted. The `definitionHash` is an integrity
 * check (sha256 over a canonical, sorted-key serialisation), recomputed on
 * import rather than trusted — a hand-edited file still imports as long as its
 * definition re-validates.
 *
 * Coded forks (base_code) are deliberately NOT portable: they reuse a named
 * engine (TF_v1) that must already exist on the target platform, so there is no
 * self-contained definition to carry. Export blocks them; import rejects an
 * envelope carrying `baseCode` via the strict schema below.
 */
export const RULESET_EXPORT_FORMAT = 'myclash.ruleset';
export const RULESET_EXPORT_VERSION = 1;

export const scoringRulesetExportDefinitionSchema = z
  .object({
    name: z.string().min(2).max(100),
    version: z.string().max(50).optional(),
    description: z.string().max(1000).nullish(),
    scoreFormula: z.record(z.string(), z.unknown()),
    constants: z.record(z.string(), z.number()).optional(),
    tiebreakers: z
      .array(z.object({ variable: z.string(), direction: z.enum(['asc', 'desc']) }))
      .optional(),
    doublePenaltyFormula: z.unknown().nullish(),
    matchFormatDefaults: z.record(z.string(), z.unknown()).nullish(),
    targets: z.array(z.object({ name: z.string(), value: z.number() })).nullish(),
    hasAfterblow: z.boolean().nullish(),
    afterblowMode: z.enum(['full', 'deductive']).nullish(),
    afterblowValuation: z.enum(['fixed', 'weighted']).nullish(),
    afterblowFixedValue: z.number().nullish(),
  })
  .strict();
export type ScoringRulesetExportDefinition = z.infer<typeof scoringRulesetExportDefinitionSchema>;

export const penaltyRulesetExportDefinitionSchema = z
  .object({
    name: z.string().min(1).max(200),
    version: z.string().max(50),
    description: z.string().nullish(),
    accumulationScope: z.enum(['match', 'phase', 'tournament']),
    yellowCardPoints: z.number().optional(),
    redCardPoints: z.number().optional(),
    blackCardPoints: z.number().optional(),
    firstBlackCardForfeit: z.enum(['match', 'tournament', 'none']).optional(),
    secondBlackCardForfeit: z.enum(['match', 'tournament', 'none']).optional(),
    entries: z.array(
      z.object({
        groupNumber: z.number(),
        refNumber: z.string(),
        shortName: z.string(),
        description: z.string(),
        sanctions: z.array(z.enum(['yellow', 'red', 'black'])),
      }),
    ),
  })
  .strict();
export type PenaltyRulesetExportDefinition = z.infer<typeof penaltyRulesetExportDefinitionSchema>;

export const rulesetExportEnvelopeSchema = z
  .object({
    format: z.literal(RULESET_EXPORT_FORMAT),
    formatVersion: z.literal(RULESET_EXPORT_VERSION),
    type: z.enum(['scoring', 'penalty']),
    exportedAt: z.string(),
    definitionHash: z.string(),
    definition: z.unknown(),
  })
  .strict();
export type RulesetExportEnvelope = z.infer<typeof rulesetExportEnvelopeSchema>;

/** Request body for both import endpoints: a full export envelope. */
export class RulesetImportDto extends createZodDto(rulesetExportEnvelopeSchema) {}

/** sha256 over the canonical (sorted-key) serialisation of the definition. */
export function computeDefinitionHash(definition: unknown): string {
  return createHash('sha256').update(stableStringify(definition)).digest('hex');
}

/** Wrap a definition in the versioned envelope, stamping the integrity hash. */
export function buildRulesetExport(
  type: 'scoring' | 'penalty',
  definition: unknown,
): RulesetExportEnvelope {
  return {
    format: RULESET_EXPORT_FORMAT,
    formatVersion: RULESET_EXPORT_VERSION,
    type,
    exportedAt: new Date().toISOString(),
    definitionHash: computeDefinitionHash(definition),
    definition,
  };
}
