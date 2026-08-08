import { describe, expect, it } from 'vitest';
import { PassService } from './pass.service';
import { hashPassToken } from './pass-token';
import { mockSupabase, supabaseChain, queriedTables } from '../../common/testing/supabase-chain';

const TOKEN = 'k'.repeat(43);

describe('PassService.issue', () => {
  it('stores only the hash, and hands back only the raw', async () => {
    const passes = supabaseChain({ data: null, error: null });
    const supabase = mockSupabase({ events: { data: { end_date: '2026-08-09' }, error: null } });
    supabase.from.mockImplementation((table: string) =>
      table === 'event_passes' ? passes : supabaseChain({ data: { end_date: '2026-08-09' } }),
    );
    const service = new PassService(supabase as never);

    const issued = await service.issue('event-1', 'person-1', 'self');

    const written = passes.upsert.mock.calls[0]?.[0] as Record<string, unknown>;
    // The whole security property of the table: a dump yields nothing
    // presentable at a desk.
    expect(written['token_hash']).toBe(hashPassToken(issued.token));
    expect(JSON.stringify(written)).not.toContain(issued.token);
  });

  it('upserts on (event_id, person_id), so a reissue RETIRES the old pass', async () => {
    const passes = supabaseChain({ data: null, error: null });
    const supabase = mockSupabase({ events: { data: { end_date: '2026-08-09' }, error: null } });
    supabase.from.mockImplementation((table: string) =>
      table === 'event_passes' ? passes : supabaseChain({ data: { end_date: '2026-08-09' } }),
    );
    const service = new PassService(supabase as never);

    await service.issue('event-1', 'person-1', 'email');

    // Without the conflict target, "send me a new pass because I lost my phone"
    // would leave two working QRs in the world.
    expect(passes.upsert).toHaveBeenCalledWith(expect.anything(), {
      onConflict: 'event_id,person_id',
    });
  });

  it('resets the scan history, because a reissue is a different credential', async () => {
    const passes = supabaseChain({ data: null, error: null });
    const supabase = mockSupabase({ events: { data: { end_date: '2026-08-09' }, error: null } });
    supabase.from.mockImplementation((table: string) =>
      table === 'event_passes' ? passes : supabaseChain({ data: { end_date: '2026-08-09' } }),
    );
    const service = new PassService(supabase as never);

    await service.issue('event-1', 'person-1', 'self');

    expect(passes.upsert.mock.calls[0]?.[0]).toMatchObject({
      scan_count: 0,
      last_scanned_at: null,
    });
  });

  it('expires the pass a week after the event ends, like a guest session', async () => {
    const passes = supabaseChain({ data: null, error: null });
    const supabase = mockSupabase({ events: { data: { end_date: '2026-08-09' }, error: null } });
    supabase.from.mockImplementation((table: string) =>
      table === 'event_passes' ? passes : supabaseChain({ data: { end_date: '2026-08-09' } }),
    );
    const service = new PassService(supabase as never);

    const issued = await service.issue('event-1', 'person-1', 'self');

    expect(issued.expiresAt).toBe('2026-08-16T00:00:00.000Z');
  });

  it('never returns two identical tokens', async () => {
    const supabase = mockSupabase({
      event_passes: { data: null, error: null },
      events: { data: { end_date: '2026-08-09' }, error: null },
    });
    const service = new PassService(supabase as never);

    const a = await service.issue('event-1', 'person-1', 'self');
    const b = await service.issue('event-1', 'person-1', 'self');

    expect(a.token).not.toBe(b.token);
  });
});

describe('PassService.resolve', () => {
  it('looks the token up by its HASH, never by the raw value', async () => {
    const passes = supabaseChain({
      data: { id: 'pass-1', person_id: 'person-1', expires_at: null, scan_count: 3 },
      error: null,
    });
    const supabase = mockSupabase({ event_passes: { data: null, error: null } });
    supabase.from.mockReturnValue(passes);
    const service = new PassService(supabase as never);

    await service.resolve(TOKEN, 'event-1');

    expect(passes.eq).toHaveBeenCalledWith('token_hash', hashPassToken(TOKEN));
    expect(passes.eq).not.toHaveBeenCalledWith('token_hash', TOKEN);
  });

  it('scopes the lookup to the scanning event', async () => {
    const passes = supabaseChain({
      data: { id: 'pass-1', person_id: 'person-1', expires_at: null, scan_count: 0 },
      error: null,
    });
    const supabase = mockSupabase({ event_passes: { data: null, error: null } });
    supabase.from.mockReturnValue(passes);
    const service = new PassService(supabase as never);

    await service.resolve(TOKEN, 'event-1');

    // A pass from last month resolves to nothing here rather than to a person
    // this desk then fails to mark.
    expect(passes.eq).toHaveBeenCalledWith('event_id', 'event-1');
  });

  it('rejects a non-token WITHOUT a database round trip', async () => {
    // A desk pointed at a poster decodes a frame at a time. None of those
    // should become a query.
    const supabase = mockSupabase({});
    const service = new PassService(supabase as never);

    await expect(service.resolve('https://myclash.fr', 'event-1')).rejects.toThrow(
      /pass_not_recognized/,
    );
    expect(queriedTables(supabase.from)).toEqual([]);
  });

  it('gives the same answer for an unknown token as for another event’s', async () => {
    const supabase = mockSupabase({ event_passes: { data: null, error: null } });
    const service = new PassService(supabase as never);

    // Distinguishing them would turn the scanner into an oracle for which
    // tokens exist.
    await expect(service.resolve(TOKEN, 'event-1')).rejects.toThrow(/pass_not_recognized/);
  });

  it('refuses an expired pass', async () => {
    const supabase = mockSupabase({
      event_passes: {
        data: {
          id: 'pass-1',
          person_id: 'person-1',
          expires_at: '2020-01-01T00:00:00.000Z',
          scan_count: 0,
        },
        error: null,
      },
    });
    const service = new PassService(supabase as never);

    await expect(service.resolve(TOKEN, 'event-1')).rejects.toThrow(/pass_expired/);
  });

  it('records the scan instead of consuming the pass — it is presented all weekend', async () => {
    const passes = supabaseChain({
      data: { id: 'pass-1', person_id: 'person-1', expires_at: null, scan_count: 3 },
      error: null,
    });
    const supabase = mockSupabase({ event_passes: { data: null, error: null } });
    supabase.from.mockReturnValue(passes);
    const service = new PassService(supabase as never);

    await expect(service.resolve(TOKEN, 'event-1')).resolves.toEqual({ personId: 'person-1' });

    // The two token tables this copies DELETE on redemption. Doing that here
    // would break the pass the second time the fighter opened their phone.
    expect(passes.delete).not.toHaveBeenCalled();
    expect(passes.update).toHaveBeenCalledWith(expect.objectContaining({ scan_count: 4 }));
  });
});

describe('PassService.preview', () => {
  it('returns the name and event, and nothing else', async () => {
    const supabase = mockSupabase({
      event_passes: {
        data: {
          expires_at: null,
          persons: { given_name: 'Marie', family_name: 'Dubois' },
          events: { name: 'FAL 2026', slug: 'fal-2026', start_date: '2026-08-08' },
        },
        error: null,
      },
    });
    const service = new PassService(supabase as never);

    // This is a @Public() route: the projection IS the security boundary, and
    // every field here was already in the inbox that received the link.
    await expect(service.preview(TOKEN)).resolves.toEqual({
      givenName: 'Marie',
      familyName: 'Dubois',
      eventName: 'FAL 2026',
      eventSlug: 'fal-2026',
      startDate: '2026-08-08',
    });
  });

  it('404s an unknown token rather than revealing that it is unknown', async () => {
    const supabase = mockSupabase({ event_passes: { data: null, error: null } });
    const service = new PassService(supabase as never);

    await expect(service.preview(TOKEN)).rejects.toThrow(/pass_not_recognized/);
  });

  it('404s an expired token with the same message', async () => {
    const supabase = mockSupabase({
      event_passes: {
        data: {
          expires_at: '2020-01-01T00:00:00.000Z',
          persons: { given_name: 'Marie', family_name: 'Dubois' },
          events: { name: 'FAL 2026', slug: 'fal-2026', start_date: '2026-08-08' },
        },
        error: null,
      },
    });
    const service = new PassService(supabase as never);

    await expect(service.preview(TOKEN)).rejects.toThrow(/pass_expired/);
  });

  it('rejects a non-token without querying', async () => {
    const supabase = mockSupabase({});
    const service = new PassService(supabase as never);

    await expect(service.preview('WIFI:S:venue;;')).rejects.toThrow(/pass_not_recognized/);
    expect(queriedTables(supabase.from)).toEqual([]);
  });
});
