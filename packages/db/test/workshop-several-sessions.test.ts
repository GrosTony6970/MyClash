/**
 * A Workshop may run several sessions (migration 0257, operator ruling 515). Read from the
 * migrations as one text: a later migration that puts back one session per Workshop, or drops the
 * index the foreign key now relies on, reds here.
 */
import { describe, expect, it } from 'vitest';
import { allSql, flat } from './migration-sql';

const sql = flat(allSql());

describe('Several sessions per Workshop', () => {
  it('drops the one-session-per-Workshop constraint of 0098', () => {
    expect(sql).toContain('drop constraint if exists workshop_sessions_workshop_id_key');
  });

  it('indexes the sessions by Workshop, in start order', () => {
    expect(sql).toContain(
      'create index if not exists workshop_sessions_workshop_idx on public.workshop_sessions (workshop_id, starts_at)',
    );
  });
});
