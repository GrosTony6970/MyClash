import { describe, expect, it } from 'vitest';
import { OwnWordsError, databaseReason, logReason, unreadable } from './log-reason';

const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566601';

describe('databaseReason: a database code in words, never its message', () => {
  it.each([
    // Postgres: the exact condition name of a common code.
    ['23505', 'unique_violation (23505)'],
    ['22P02', 'invalid_text_representation (22P02)'],
    ['57014', 'query_canceled (57014)'],
    ['40P01', 'deadlock_detected (40P01)'],
    ['P0001', 'raise_exception (P0001)'],
    // The outage ones, named exactly: what a redeploy or a full disk looks like.
    ['53100', 'disk_full (53100)'],
    ['53200', 'out_of_memory (53200)'],
    ['57P01', 'admin_shutdown (57P01)'],
    ['57P03', 'cannot_connect_now (57P03)'],
    // Postgres: any other code of a known family gets the family's name.
    ['23999', 'integrity_constraint_violation (23999)'],
    ['53999', 'insufficient_resources (53999)'],
    ['XX999', 'internal_error (XX999)'],
    // PostgREST: a few exact names, else the name of its group.
    ['PGRST116', 'not_exactly_one_row (PGRST116)'],
    ['PGRST204', 'unknown_column (PGRST204)'],
    ['PGRST000', 'postgrest_connection_error (PGRST000)'],
    ['PGRST100', 'postgrest_request_error (PGRST100)'],
    ['PGRST299', 'postgrest_schema_cache_error (PGRST299)'],
    ['PGRST301', 'postgrest_jwt_error (PGRST301)'],
    ['PGRSTX00', 'postgrest_internal_error (PGRSTX00)'],
    // Neither: the bare code.
    ['ZZ999', 'ZZ999'],
    // A failed fetch has an empty code; a non-JSON answer (a proxy's page) has none.
    ['', 'no code'],
    [undefined, 'no code'],
  ])('%s → %s', (code, words) => {
    expect(databaseReason({ code })).toBe(words);
  });

  it('never says the message', () => {
    const error = { code: '22P02', message: `invalid input syntax for type uuid: "${ACCOUNT}"` };
    expect(databaseReason(error)).not.toContain(ACCOUNT);
    expect(unreadable('the profile is unreadable', error).message).toBe(
      'the profile is unreadable: invalid_text_representation (22P02)',
    );
  });
});

describe('logReason: our own words, else the kind', () => {
  it.each([
    ['our own words', new OwnWordsError('the request was not found'), 'the request was not found'],
    [
      'a database refusal',
      unreadable('the blocks are unreadable', { code: '57014' }),
      'the blocks are unreadable: query_canceled (57014)',
    ],
    ['a foreign Error', new TypeError(`job x:${ACCOUNT} failed`), 'TypeError'],
    ['a thrown string', `down for ${ACCOUNT}`, 'string'],
  ])('%s', (_, cause, words) => {
    expect(logReason(cause)).toBe(words);
  });
});
