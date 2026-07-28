import { describe, expect, it, vi } from 'vitest';
import { insertAuditLog, maskAuditPayload, maskEmail, __testing } from './audit-log';

describe('maskEmail', () => {
  it('keeps one character of local and domain, matching the established shape', () => {
    // person-email-change.service chose this shape by hand; the helper adopts it
    // rather than inventing a second convention.
    expect(maskEmail('jean.dupont@example.com')).toBe('j***@e***');
  });

  it('survives a malformed address without throwing', () => {
    expect(maskEmail('not-an-email')).toBe('n***@***');
    expect(maskEmail('')).toBe('');
  });
});

describe('maskAuditPayload', () => {
  it('masks every spelling of an email key', () => {
    const masked = maskAuditPayload({
      email: 'a@b.com',
      old_email: 'c@d.com',
      new_email: 'e@f.com',
      target_email: 'g@h.com',
    }) as Record<string, string>;

    for (const value of Object.values(masked)) {
      expect(value).toMatch(/^.\*\*\*@.\*\*\*$/);
    }
  });

  it('does NOT mask names — they are public-record data', () => {
    // Consistent with erasure: results keep the competitor's name, so masking it
    // in an internal governance record would be incoherent.
    const masked = maskAuditPayload({
      given_name: 'Jean',
      family_name: 'Dupont',
      display_name: 'Jean Dupont',
    }) as Record<string, string>;

    expect(masked['given_name']).toBe('Jean');
    expect(masked['family_name']).toBe('Dupont');
    expect(masked['display_name']).toBe('Jean Dupont');
  });

  it('keeps the year of a date of birth, which is the part with audit value', () => {
    const masked = maskAuditPayload({ date_of_birth: '1990-04-17' }) as Record<string, string>;
    expect(masked['date_of_birth']).toBe('1990-**-**');
  });

  it('keeps the network prefix of an IP and the browser family of a UA', () => {
    const masked = maskAuditPayload({
      ip_first_seen: '203.0.113.42',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0)',
    }) as Record<string, string>;

    expect(masked['ip_first_seen']).toBe('203.0.*.*');
    expect(masked['user_agent']).toBe('Mozilla');
  });

  it('reaches PII nested inside a row snapshot', () => {
    // merge.service and exchange_edit_request.approve embed whole rows.
    const masked = maskAuditPayload({
      source: { id: 'g1', email: 'a@b.com', given_name: 'Jean' },
    }) as { source: Record<string, string> };

    expect(masked.source['email']).toBe('a***@b***');
    expect(masked.source['given_name']).toBe('Jean');
  });

  it('walks arrays', () => {
    const masked = maskAuditPayload({ users: [{ email: 'a@b.com' }, { email: 'c@d.com' }] }) as {
      users: { email: string }[];
    };
    expect(masked.users.every((u) => u.email.includes('***'))).toBe(true);
  });

  it('leaves a non-string value alone rather than stringifying it', () => {
    // date_of_birth: null must stay null, not become '***'.
    const masked = maskAuditPayload({ date_of_birth: null, phone: 42 }) as Record<string, unknown>;
    expect(masked['date_of_birth']).toBeNull();
    expect(masked['phone']).toBe(42);
  });

  it('leaves a payload with nothing personal byte-identical', () => {
    const payload = { organization_id: 'org-1', role: 'admin', count: 3 };
    expect(JSON.stringify(maskAuditPayload(payload))).toBe(JSON.stringify(payload));
  });

  it('does not recurse past the depth bound', () => {
    let deep: Record<string, unknown> = { email: 'a@b.com' };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(() => maskAuditPayload(deep)).not.toThrow();
  });

  it('does not mask a key that merely contains a rule word', () => {
    // `emailed_at` is a timestamp, not an address. Suffix matching on `_email`
    // or an exact name is what keeps it out.
    const masked = maskAuditPayload({ emailed_at: '2026-07-28T10:00:00Z' }) as Record<
      string,
      string
    >;
    expect(masked['emailed_at']).toBe('2026-07-28T10:00:00Z');
  });
});

describe('maskerFor', () => {
  it('matches exact and suffixed spellings but not arbitrary substrings', () => {
    expect(__testing.maskerFor('email')).toBeTruthy();
    expect(__testing.maskerFor('target_email')).toBeTruthy();
    expect(__testing.maskerFor('emailed_at')).toBeNull();
    expect(__testing.maskerFor('role')).toBeNull();
  });
});

describe('insertAuditLog', () => {
  function makeSupabase(error: { message: string } | null = null) {
    const insert = vi.fn().mockResolvedValue({ error });
    return { supabase: { from: () => ({ insert }) } as never, insert };
  }

  it('masks the payload before it reaches the database', async () => {
    const { supabase, insert } = makeSupabase();
    await insertAuditLog(supabase, {
      actorUserId: 'u1',
      action: 'user.update',
      entityType: 'user',
      entityId: 'u2',
      payload: { email: 'jean@example.com' },
    });

    const row = insert.mock.calls[0]![0] as { payload_json: { email: string } };
    expect(row.payload_json.email).toBe('j***@e***');
  });

  it('returns the error instead of throwing, so callers keep their own severity', async () => {
    // Most treat a failed audit write as best-effort; merge.service throws.
    const { supabase } = makeSupabase({ message: 'db down' });
    await expect(
      insertAuditLog(supabase, {
        actorUserId: 'u1',
        action: 'a',
        entityType: 'e',
        entityId: 'x',
      }),
    ).resolves.toEqual({ error: { message: 'db down' } });
  });

  it('honours an explicit createdAt but omits the column otherwise', async () => {
    // event-archive.worker stamps every row in a batch with one instant; letting
    // the column default would silently scatter them across the run.
    const batch = makeSupabase();
    await insertAuditLog(batch.supabase, {
      actorUserId: null,
      action: 'event.auto_archive',
      entityType: 'event',
      entityId: 'e1',
      createdAt: '2026-07-28T05:00:00.000Z',
    });
    expect((batch.insert.mock.calls[0]![0] as Record<string, unknown>)['created_at']).toBe(
      '2026-07-28T05:00:00.000Z',
    );

    const plain = makeSupabase();
    await insertAuditLog(plain.supabase, {
      actorUserId: 'u1',
      action: 'a',
      entityType: 'e',
      entityId: 'x',
    });
    expect(plain.insert.mock.calls[0]![0] as Record<string, unknown>).not.toHaveProperty(
      'created_at',
    );
  });

  it('writes NULL for a system actor rather than a sentinel string', async () => {
    const { supabase, insert } = makeSupabase();
    await insertAuditLog(supabase, {
      actorUserId: null,
      action: 'event.auto_archive',
      entityType: 'event',
      entityId: 'e1',
    });

    const row = insert.mock.calls[0]![0] as { actor_user_id: unknown; payload_json: unknown };
    expect(row.actor_user_id).toBeNull();
    expect(row.payload_json).toBeNull();
  });
});
