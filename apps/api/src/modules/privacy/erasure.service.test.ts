import { describe, expect, it } from 'vitest';
import { ErasureService } from './erasure.service';
import { AUDIT_PII_KEYS, REDACTED, pseudonymFor, scrubPii, slugFor } from './erasure-redaction';

/**
 * Supabase mock keyed BY TABLE NAME, never by call order.
 *
 * redactSubject issues a dozen queries whose order is an implementation detail;
 * an ordered mockReturnValueOnce chain silently desyncs the moment a step is
 * added or moved, and the resulting failure points at the wrong line.
 */
interface TableLog {
  updates: Record<string, unknown>[];
  deletes: number;
  rows: Record<string, unknown>[];
}

function makeSupabase(seed: Record<string, Record<string, unknown>[]> = {}) {
  const log: Record<string, TableLog> = {};
  const tableLog = (table: string): TableLog =>
    (log[table] ??= { updates: [], deletes: 0, rows: seed[table] ?? [] });

  const service = {
    from(table: string) {
      const entry = tableLog(table);
      const result = { data: entry.rows, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        contains: () => chain,
        maybeSingle: () => Promise.resolve({ data: entry.rows[0] ?? null, error: null }),
        insert: (row: Record<string, unknown>) => {
          entry.updates.push({ __insert: row });
          return Promise.resolve({ data: null, error: null });
        },
        update: (patch: Record<string, unknown>) => {
          entry.updates.push(patch);
          return chain;
        },
        delete: () => {
          entry.deletes += 1;
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };
  return { supabase: { service } as never, log };
}

describe('scrubPii', () => {
  it('redacts contact details but KEEPS names', () => {
    // The posture: names stay on published results, so stripping them from an
    // internal audit payload would be incoherent.
    const scrubbed = scrubPii(
      { given_name: 'Jean', family_name: 'Dupont', email: 'jean@example.com' },
      0,
    ) as Record<string, unknown>;

    expect(scrubbed['given_name']).toBe('Jean');
    expect(scrubbed['family_name']).toBe('Dupont');
    expect(scrubbed['email']).toBe(REDACTED);
  });

  it('reaches PII nested inside a row snapshot', () => {
    // merge.service and exchange_edit_request.approve embed whole rows.
    const scrubbed = scrubPii(
      { source: { id: 'g1', email: 'a@b.c', notes: 'private' }, count: 2 },
      0,
    ) as Record<string, { email: string; notes: string }>;

    expect(scrubbed['source']!.email).toBe(REDACTED);
    expect(scrubbed['source']!.notes).toBe(REDACTED);
  });

  it('walks arrays and preserves payload shape', () => {
    const scrubbed = scrubPii({ people: [{ email: 'a@b.c' }, { email: 'd@e.f' }] }, 0) as {
      people: { email: string }[];
    };
    expect(scrubbed.people).toHaveLength(2);
    expect(scrubbed.people.every((p) => p.email === REDACTED)).toBe(true);
  });

  it('leaves a payload with no PII byte-identical', () => {
    // redactAuditPayloads skips the UPDATE when nothing changed; this is what
    // makes that comparison meaningful rather than rewriting every row.
    const payload = { action: 'ruleset.publish', version: '1.0.0', count: 3 };
    expect(JSON.stringify(scrubPii(payload, 0))).toBe(JSON.stringify(payload));
  });

  it('does not recurse past the depth bound', () => {
    let deep: Record<string, unknown> = { email: 'leaf@example.com' };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(() => scrubPii(deep, 0)).not.toThrow();
  });

  it('ignores null values so a cleared field is not turned into a string', () => {
    const scrubbed = scrubPii({ email: null }, 0) as Record<string, unknown>;
    expect(scrubbed['email']).toBeNull();
  });
});

describe('pseudonym', () => {
  it('is stable for an id and role-agnostic', () => {
    // global_persons covers referees and instructors, so "Fighter #…" would be
    // wrong for most of the people this can apply to.
    expect(pseudonymFor('abc')).toBe(pseudonymFor('abc'));
    expect(pseudonymFor('abc')).toMatch(/^Removed profile [0-9a-f]{8}$/);
    expect(pseudonymFor('abc')).not.toBe(pseudonymFor('xyz'));
  });

  it('derives the slug from the id so rotation cannot collide', () => {
    expect(slugFor('abc')).toBe(`removed-profile-${pseudonymFor('abc').split(' ')[2]}`);
  });
});

describe('ErasureService.redactSubject', () => {
  it('nulls the profile extras and sets account_deleted_at, but not deleted_at', async () => {
    const { supabase, log } = makeSupabase();
    await new ErasureService(supabase).redactSubject('u1');

    const patch = log['global_persons']!.updates[0] as Record<string, unknown>;
    expect(patch['photo_url']).toBeNull();
    expect(patch['bio']).toBeNull();
    expect(patch['date_of_birth']).toBeNull();
    expect(patch['account_deleted_at']).toEqual(expect.any(String));

    // deleted_at belongs to the merge feature: setting it here would drop the
    // person out of the import dedup pool and spawn a duplicate profile at
    // their next event, and bar them as a merge target.
    expect(patch).not.toHaveProperty('deleted_at');

    // Names stay — the competitor survives the person.
    expect(patch).not.toHaveProperty('display_name');
    expect(patch).not.toHaveProperty('given_name');
    expect(patch).not.toHaveProperty('slug');
  });

  it('nulls the email on every event roster row while keeping names', async () => {
    const { supabase, log } = makeSupabase();
    await new ErasureService(supabase).redactSubject('u1');

    const patch = log['persons']!.updates[0] as Record<string, unknown>;
    expect(patch['email']).toBeNull();
    expect(patch['notes']).toBeNull();
    expect(patch['claim_status']).toBe('unclaimed');
    expect(patch).not.toHaveProperty('given_name');
  });

  it('deletes device telemetry and the outbound social graph', async () => {
    const { supabase, log } = makeSupabase({ persons: [{ id: 'p1' }] });
    await new ErasureService(supabase).redactSubject('u1');

    for (const table of [
      'guest_sessions',
      'follows',
      'directory_follows',
      'organization_follows',
      'notification_preferences',
      'push_subscriptions',
    ]) {
      expect(log[table]?.deletes, `${table} should be deleted`).toBeGreaterThan(0);
    }
  });

  it('deletes ALL claim requests, not just pending ones', async () => {
    const { supabase, log } = makeSupabase();
    await new ErasureService(supabase).redactSubject('u1');
    expect(log['global_person_claim_requests']?.deletes).toBeGreaterThan(0);
    expect(log['global_person_claim_tokens']?.deletes).toBeGreaterThan(0);
  });
});

describe('ErasureService.anonymiseGlobalPerson', () => {
  it('replaces the name and rotates the slug, unlike ordinary erasure', async () => {
    const { supabase, log } = makeSupabase();
    await new ErasureService(supabase).anonymiseGlobalPerson('g1');

    const patch = log['global_persons']!.updates[0] as Record<string, unknown>;
    expect(patch['display_name']).toBe(pseudonymFor('g1'));
    expect(patch['slug']).toBe(slugFor('g1'));
    expect(patch['photo_url']).toBeNull();
  });
});

describe('ErasureService.recordErasure', () => {
  it('stores a hash, never the subject id', async () => {
    const { supabase, log } = makeSupabase();
    await new ErasureService(supabase).recordErasure('u1', 'account_deletion', { persons: 2 });

    const inserted = (log['erasure_log']!.updates[0] as { __insert: Record<string, unknown> })
      .__insert;
    expect(inserted['subject_hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(inserted)).not.toContain('u1');
  });
});

describe('audit PII key census', () => {
  it('covers the keys the email-change writer masks by hand', () => {
    // person-email-change.service masks old_email/new_email at write time; the
    // erasure path must know the same keys for every writer that does not.
    expect(AUDIT_PII_KEYS.has('old_email')).toBe(true);
    expect(AUDIT_PII_KEYS.has('new_email')).toBe(true);
  });

  it('does not list name keys', () => {
    for (const key of ['given_name', 'family_name', 'display_name', 'name']) {
      expect(AUDIT_PII_KEYS.has(key), `${key} must not be scrubbed`).toBe(false);
    }
  });
});
