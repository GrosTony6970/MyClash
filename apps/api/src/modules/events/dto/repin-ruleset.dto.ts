import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { rulesetCodeSchema } from './events.dto';
import { confirmSchema, justificationSchema, rulesExpectedSchema } from './rules-audit.schema';

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
    justification: justificationSchema,
    // The Tournament's name, typed by the organiser (`sameTournamentName`).
    confirm: confirmSchema,
    expected: rulesExpectedSchema,
  })
  .strict();
export class RepinTournamentRulesetDto extends createZodDto(repinTournamentRulesetSchema) {}
