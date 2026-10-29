import { z } from 'zod';

/**
 * The rules of a Tournament as the screen read them (`RulesExpected`): the RAW stored values, sent
 * back verbatim and compared raw, so nothing here normalizes, defaults or bounds them (a bound
 * tighter than the column would refuse a row the door must be able to name; the body limit holds).
 * Read by both audited doors: the re-pin and the audited settings save.
 */
export const rulesExpectedSchema = z
  .object({
    rulesetCode: z.string().nullable(),
    rulesetVersion: z.string().nullable(),
    rulesetConfig: z.record(z.string(), z.unknown()).nullable(),
    scoringConfig: z.record(z.string(), z.unknown()).nullable(),
    penaltyRulesetId: z.string().nullable(),
    penaltyRulesetVersion: z.string().nullable(),
    // The Tournament's own changes of its forfeit rules, raw (0246): a stored `{}` or a key this
    // build does not know is sent back as read.
    forfeitRules: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

/** The ceremony's two fields: a reason kept for the record, and the Tournament's name typed. */
export const justificationSchema = z.string().trim().min(10).max(1000);
export const confirmSchema = z.string().max(200);

/**
 * An audited settings save (`PATCH /tournaments/:id` with `audit`): sent again by the dialog when
 * the lock refused the same save `rules_change_needs_audit`.
 */
export const settingsAuditSchema = z
  .object({
    justification: justificationSchema,
    confirm: confirmSchema,
    expected: rulesExpectedSchema,
  })
  .strict();
