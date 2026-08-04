/**
 * accepted-legal.schema.ts — the fields every account-creation DTO carries.
 *
 * Shared rather than repeated so a new signup path cannot quietly ship without
 * them. The values are the client's CLAIM about which version it displayed;
 * `LegalAcceptanceService.assertCurrent` is what decides whether that claim is
 * acceptable, and the row it writes uses the registry's version, not this one.
 *
 * Bounded, not validated for shape: a version is an opaque published
 * identifier, and pinning its format here would mean two places to change the
 * day it stops being a date.
 */
import { z } from 'zod';

const versionField = z.string().min(1).max(64);

export const acceptedLegalShape = {
  /** Version of the terms the client displayed and the user ticked. */
  acceptedTerms: versionField,
  /** Version of the privacy policy the client displayed and the user ticked. */
  acceptedPrivacy: versionField,
} as const;

export const acceptedLegalSchema = z.object(acceptedLegalShape);

export type AcceptedLegalInput = z.infer<typeof acceptedLegalSchema>;

/** Reshape a DTO's flat fields into what `assertCurrent` expects. */
export function acceptedVersionsOf(input: Partial<AcceptedLegalInput>): {
  terms?: string;
  privacy?: string;
} {
  return { terms: input.acceptedTerms, privacy: input.acceptedPrivacy };
}
