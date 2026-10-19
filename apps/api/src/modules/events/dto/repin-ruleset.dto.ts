import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { rulesetCodeSchema } from './events.dto';

/**
 * The rules of a Tournament as the screen read them (`RulesExpected`): the RAW stored values, sent
 * back verbatim and compared raw, so nothing here normalizes, defaults or bounds them (a bound
 * tighter than the column would refuse a row the door must be able to name; the body limit holds).
 */
const rulesExpectedSchema = z
  .object({
    rulesetCode: z.string().nullable(),
    rulesetVersion: z.string().nullable(),
    rulesetConfig: z.record(z.string(), z.unknown()).nullable(),
    scoringConfig: z.record(z.string(), z.unknown()).nullable(),
    penaltyRulesetId: z.string().nullable(),
    penaltyRulesetVersion: z.string().nullable(),
  })
  .strict();

// Mid-event ruleset re-pin: a deliberate, audited swap of the tournament's
// ruleset AFTER results exist. Distinct from the ordinary PATCH (which is now
// blocked once matches are scored) — this one requires a justification, the
// Tournament's name typed, and the rules the screen read; it records an
// append-only audit with the changes and the before/after placings.
const repinTournamentRulesetSchema = z
  .object({
    rulesetCode: rulesetCodeSchema.min(1),
    // Optional — normalised server-side; none named is a built-in's latest or a club ruleset's current.
    rulesetVersion: z.string().max(20).optional(),
    // Mandatory justification (the ceremony). Kept short-but-meaningful so the
    // public disclosure and the audit trail always carry a real reason.
    justification: z.string().trim().min(10).max(1000),
    // The Tournament's name, typed by the organiser (`sameTournamentName`).
    confirm: z.string().max(200),
    expected: rulesExpectedSchema,
  })
  .strict();
export class RepinTournamentRulesetDto extends createZodDto(repinTournamentRulesetSchema) {}
