import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createRecordingFetch } from './recording-fetch';
import { QueryErrorRecorder, type QueryErrorRecord } from './recorder';

/**
 * Driven through a REAL `createClient`, not a hand-rolled stub.
 *
 * The defect this file exists to pin is invisible to a stub: reading the
 * response body in the wrapper leaves it disturbed for postgrest-js, which
 * consumes it afterwards. Only the real client can show that the CALLER's
 * `error.code` survives — and the caller is what every `error.code === '23505'`
 * branch in this repo depends on.
 */

const SUPABASE_URL = 'https://app.myclash.localhost';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A recorder that captures instead of writing, plus the rows it captured. */
function capturingRecorder(): { recorder: QueryErrorRecorder; rows: QueryErrorRecord[] } {
  const rows: QueryErrorRecord[] = [];
  let clock = 0;
  const recorder = new QueryErrorRecorder(
    async (record) => {
      rows.push(record);
    },
    // Advance past the throttle on every call so each test controls its own
    // repetition explicitly rather than inheriting a shared window.
    () => (clock += 60_000),
  );
  return { recorder, rows };
}

function clientWith(fetchImpl: typeof fetch, recorder: QueryErrorRecorder) {
  return createClient(SUPABASE_URL, 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createRecordingFetch(recorder, fetchImpl) },
  });
}

describe('createRecordingFetch through a real Supabase client', () => {
  /**
   * THE REGRESSION. Both halves must hold at once: the row is recorded AND the
   * caller still receives the real error. Asserting only the row passes while
   * every caller in the repo is broken.
   */
  it('records an embed error and still gives the caller the real code', async () => {
    const { recorder, rows } = capturingRecorder();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        code: 'PGRST200',
        message:
          "Could not find a relationship between 'matches' and 'tournaments' in the schema cache",
        details: null,
        hint: null,
      }),
    );

    const { data, error } = await clientWith(fetchImpl, recorder)
      .from('matches')
      .select('id, tournaments(name)');

    // The caller's view is untouched.
    expect(error?.code).toBe('PGRST200');
    expect(error?.message).toContain('Could not find a relationship');
    expect(data).toBeNull();

    // And the tripwire fired.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      table: 'matches',
      status: 400,
      code: 'PGRST200',
      severity: 'error',
      isRpc: false,
    });
  });

  /**
   * The embed class is the point of the runtime tripwire: the offline schema
   * scan is deliberately cowardly about select strings carrying `(`, so it can
   * never see this one.
   */
  it('leaves a successful response completely untouched', async () => {
    const { recorder, rows } = capturingRecorder();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, [{ id: 'm1' }]));

    const { data, error } = await clientWith(fetchImpl, recorder).from('matches').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'm1' }]);
    expect(rows).toEqual([]);
  });

  it('keeps a unique violation readable by the caller that switches on it', async () => {
    const { recorder, rows } = capturingRecorder();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        code: '23505',
        message: 'duplicate key value violates unique constraint "persons_event_id_email_key"',
        details: 'Key (email)=(someone@example.com) already exists.',
        hint: null,
      }),
    );

    const { error } = await clientWith(fetchImpl, recorder)
      .from('persons')
      .insert({ email: 'someone@example.com' });

    // This is the branch bracket-match-sync.ts and four other services take.
    expect(error?.code).toBe('23505');
    // A unique violation is ordinary flow here, not a contract defect.
    expect(rows[0]?.severity).toBe('warning');
  });

  it('stores no personal data from the request or the body', async () => {
    const { recorder, rows } = capturingRecorder();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        code: '23505',
        message: 'duplicate key Key (email)=(someone@example.com) already exists.',
      }),
    );

    await clientWith(fetchImpl, recorder)
      .from('persons')
      .select('id')
      .eq('email', 'someone@example.com');

    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain('someone@example.com');
    expect(serialised).toContain('<redacted>');
  });

  it('ignores GoTrue and Storage failures that share this fetch', async () => {
    const { recorder, rows } = capturingRecorder();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { code: 'PGRST301', message: 'JWT expired' }));

    // A stale cookie 401 is deliberately swallowed in ~20 places; recording it
    // would bury the real signal under routine noise.
    await clientWith(fetchImpl, recorder).auth.getUser('stale-token');

    expect(rows).toEqual([]);
  });

  it('records a non-JSON gateway failure as operational', async () => {
    const { recorder, rows } = capturingRecorder();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    await clientWith(fetchImpl, recorder).from('matches').select('id');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 502, code: null, severity: 'warning' });
  });

  it('names the function for a failed rpc call', async () => {
    const { recorder, rows } = capturingRecorder();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { code: 'PGRST202', message: 'function not found' }));

    await clientWith(fetchImpl, recorder).rpc('admin_runtime_db_stats');

    expect(rows[0]).toMatchObject({
      table: 'admin_runtime_db_stats',
      isRpc: true,
      severity: 'error',
    });
  });

  /** A diagnostic that can break a query is worse than no diagnostic. */
  it('never lets a recorder failure reach the caller', async () => {
    const exploding = new QueryErrorRecorder(async () => {
      throw new Error('the database is down');
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { code: '42703', message: 'undefined column' }));

    const { error } = await clientWith(fetchImpl, exploding).from('matches').select('nope');

    expect(error?.code).toBe('42703');
  });
});

describe('QueryErrorRecorder throttling', () => {
  it('writes once per fingerprint per interval', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    let clock = 0;
    const recorder = new QueryErrorRecorder(write, () => clock);
    const record = {
      fingerprint: 'fp',
      method: 'GET',
      table: 'matches',
      isRpc: false,
      status: 400,
      code: '42703',
      severity: 'error' as const,
      path: 'matches?select=id',
      message: 'undefined column',
    };

    recorder.record(record);
    recorder.record(record);
    recorder.record(record);
    expect(write).toHaveBeenCalledTimes(1);

    clock += 10_001;
    recorder.record(record);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('throttles per fingerprint, not globally', () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const recorder = new QueryErrorRecorder(write, () => 0);
    const base = {
      method: 'GET',
      table: 'matches',
      isRpc: false,
      status: 400,
      code: '42703',
      severity: 'error' as const,
      path: 'matches?select=id',
      message: 'undefined column',
    };

    recorder.record({ ...base, fingerprint: 'a' });
    recorder.record({ ...base, fingerprint: 'b' });

    expect(write).toHaveBeenCalledTimes(2);
  });
});
