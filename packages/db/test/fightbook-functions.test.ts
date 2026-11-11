/**
 * FightBook's three race-winning calls (slice 1): `fightbook_ask`, `fightbook_answer`,
 * `fightbook_block`. This pins what the migration text can show: the signature the API calls,
 * invoker rights with a pinned search_path, the pair lock taken before any read, the answer's
 * "still open" condition, and the grants. What they DO is proven on a replayed Postgres by
 * `scripts/db-fightbook-probe.mjs` (CI: Database replay).
 */
import { describe, expect, it } from 'vitest';
import { allSql, flat, functionStatement } from './migration-sql';

const sql = allSql();

const FUNCTIONS = [
  {
    name: 'fightbook_ask',
    types: 'uuid, uuid, text, uuid, date, text, time, text, text[], text, timestamptz',
    returns: 'returns jsonb',
  },
  { name: 'fightbook_answer', types: 'uuid, uuid, text, text, boolean', returns: 'returns jsonb' },
  { name: 'fightbook_block', types: 'uuid, uuid', returns: 'returns void' },
] as const;

for (const { name, types, returns } of FUNCTIONS)
  describe(`public.${name}`, () => {
    const body = functionStatement(sql, name);

    it('runs with the caller’s rights and a pinned search path', () => {
      expect(body).toContain(returns);
      expect(body).toContain('language plpgsql');
      expect(body).not.toContain('security definer');
      expect(body).toContain('set search_path = public, pg_catalog');
    });

    it('only the service role may call it, the public roles revoked by name', () => {
      const flatSql = flat(sql);
      const sig = `public.${name}(${types})`;
      expect(flatSql).toContain(`revoke all on function ${sig} from public;`);
      expect(flatSql).toContain(`revoke execute on function ${sig} from anon, authenticated;`);
      expect(flatSql).toContain(`grant execute on function ${sig} to service_role;`);
    });
  });

describe('the pair lock comes before any read', () => {
  it.each(['fightbook_ask', 'fightbook_block'])('%s', (name) => {
    const body = functionStatement(sql, name);
    const lock = body.indexOf('pg_advisory_xact_lock(');
    const keyShare = body.indexOf('order by id for key share');
    expect(lock).toBeGreaterThan(-1);
    expect(keyShare).toBeGreaterThan(lock);
    // The first touch of the blocks and of the requests, read or write, comes after both locks.
    expect(body.indexOf('public.fightbook_blocks')).toBeGreaterThan(keyShare);
    expect(body.indexOf('public.spar_requests')).toBeGreaterThan(keyShare);
  });
});

describe('an answer lands only on a request still open', () => {
  it('names the receiver, the waiting status and the end of the day in one update', () => {
    const body = functionStatement(sql, 'fightbook_answer');
    expect(body).toContain('r.receiver_global_person_id = p_receiver');
    expect(body).toContain("r.status = 'pending'");
    expect(body).toContain('r.expires_at > now()');
  });
});
