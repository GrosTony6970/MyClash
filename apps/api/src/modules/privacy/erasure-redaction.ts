/**
 * erasure-redaction.ts — the pure rules behind GDPR erasure.
 *
 * Split from erasure.service.ts so the decisions about WHAT counts as personal
 * data are readable and testable without a Supabase mock. The service owns the
 * sequencing; this file owns the policy.
 */

import { createHash } from 'node:crypto';

/**
 * Profile fields nulled on `global_persons`.
 *
 * Names and `slug` are absent ON PURPOSE: published competition results are a
 * public record (GDPR Art. 17(3)), so the competitor survives the person.
 */
export const GLOBAL_PERSON_NULLED = [
  'photo_url',
  'bio',
  'alias',
  'website_url',
  'instagram_url',
  'youtube_url',
  'date_of_birth',
  'country_code',
  'hema_ratings_id',
] as const;

/** Fields nulled on every event-scoped `persons` row. Names stay. */
export const PERSON_NULLED = ['email', 'notes', 'date_of_birth'] as const;

/**
 * Payload keys scrubbed from `audit_log.payload_json`, at any depth.
 *
 * Names are NOT here: retaining them on published results while stripping them
 * from an internal governance record would be incoherent. This list mirrors the
 * field set erasure nulls everywhere else.
 *
 * MAINTENANCE: when a new audit writer puts a personal field in a payload, add
 * its key here. ../entity-label/audit-payload-refs.ts carries the matching
 * census for id references.
 */
export const AUDIT_PII_KEYS = new Set([
  'email',
  'old_email',
  'new_email',
  'contact_email',
  'date_of_birth',
  'dob',
  'notes',
  'bio',
  'phone',
  'phone_number',
  'photo_url',
  'avatar_url',
  'website_url',
  'instagram_url',
  'youtube_url',
  'ip',
  'ip_first_seen',
  'user_agent',
]);

export const REDACTED = '[redacted]';

/** Bounds the recursive payload scrub against a pathological blob. */
const MAX_DEPTH = 8;

export function nulls(keys: readonly string[]): Record<string, null> {
  return Object.fromEntries(keys.map((key) => [key, null]));
}

/**
 * Stable, role-agnostic label for an anonymised profile.
 *
 * `global_persons` covers referees, instructors and workshop participants as
 * well as fighters, so "Fighter #…" would be wrong for most of them. UI
 * surfaces that know about the flag render a translated string instead; this
 * value is the fallback for CSV/PDF exports that have no locale.
 */
export function pseudonymFor(globalPersonId: string): string {
  return `Removed profile ${shortCode(globalPersonId)}`;
}

export function slugFor(globalPersonId: string): string {
  return `removed-profile-${shortCode(globalPersonId)}`;
}

/** Derived from the row id, so rotation cannot collide with a live slug. */
function shortCode(globalPersonId: string): string {
  return createHash('sha256').update(globalPersonId).digest('hex').slice(0, 8);
}

/** Full-length digest: this one must not be brute-forceable back to a name. */
export function hashSlug(slug: string): string {
  return createHash('sha256').update(slug).digest('hex');
}

/**
 * Payload shapes known to embed a person reference, from the census in
 * ../entity-label/audit-payload-refs.ts. Anything outside this set is still
 * caught when the row matches by actor or entity.
 */
export function containmentProbes(
  uid: string,
  globalPersonIds: string[],
  personIds: string[],
): Record<string, unknown>[] {
  const probes: Record<string, unknown>[] = [{ claimed_by_user_id: uid }, { user_id: uid }];
  for (const id of globalPersonIds) {
    probes.push(
      { global_person_id: id },
      // Retained deliberately: audit payloads written before migration 0185 carry
      // `fighter_id` for what is now `global_person_id`. Dropping this probe would
      // silently miss historical rows during an erasure.
      { fighter_id: id },
      { source: { id } },
      { target: { id } },
    );
  }
  for (const id of personIds) probes.push({ person_id: id });
  return probes;
}

/** Replace PII-keyed values at any depth, preserving the payload's shape. */
export function scrubPii(node: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return node;
  if (Array.isArray(node)) return node.map((child) => scrubPii(child, depth + 1));
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([key, value]) => [
        key,
        AUDIT_PII_KEYS.has(key.toLowerCase()) && value !== null && value !== undefined
          ? REDACTED
          : scrubPii(value, depth + 1),
      ]),
    );
  }
  return node;
}
