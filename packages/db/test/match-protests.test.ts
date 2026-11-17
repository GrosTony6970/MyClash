/**
 * A protest is its own entry of the Match (migration 0276, the protest counter's design).
 *
 * The table is read as `match_penalties` is read: by anyone, for a bout of a public Event and a
 * public Tournament. Only the API writes it. Live updates carry it, as 0167 did for cards. Read
 * from the migrations as one text, so a later migration that drops one of these reds here. The
 * running database is `pnpm db:rls-probe`'s (the seeded protest in VERDICTS and API_ONLY_WRITES).
 */
import { describe, expect, it } from 'vitest';
import { allSql, flat, matches } from './migration-sql';

const sql = allSql();
const text = flat(sql);

/** The `create table … match_protests (…);` statement, flattened. */
function tableStatement(): string {
  const found = matches(
    sql,
    String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?match_protests\s*\([\s\S]*?\);`,
  );
  expect(found).toHaveLength(1);
  return found[0]!.text;
}

describe('match_protests', () => {
  it('turns RLS on', () => {
    expect(text).toContain('alter table match_protests enable row level security');
  });

  it('has exactly one rule, a read rule for the public bout, with no club-member branch', () => {
    const policies = matches(
      sql,
      String.raw`create\s+policy[^;]*?\son\s+(?:public\.)?match_protests\b[^;]*;`,
    );
    expect(policies).toHaveLength(1);
    const policy = policies[0]!.text;
    expect(policy).toContain(' for select ');
    expect(policy).toContain("e.status in ('published','running','completed')");
    expect(policy).toContain("t.status in ('published','running','completed')");
    expect(policy).not.toContain('is_org_member');
  });

  it('carries live updates: the old row on each change, and the publication, guarded', () => {
    expect(text).toContain('alter table match_protests replica identity full');
    const guarded = matches(sql, String.raw`do\s+\$\$[\s\S]*?\$\$`).filter((block) =>
      block.text.includes('alter publication supabase_realtime add table match_protests'),
    );
    expect(guarded).toHaveLength(1);
    expect(guarded[0]!.text).toContain("tablename = 'match_protests'");
  });

  it('gives no web role a write', () => {
    const grants = matches(
      sql,
      String.raw`grant\s+[^;]*?\son\s+(?:table\s+)?(?:public\.)?match_protests\b[^;]*;`,
    );
    expect(grants.filter((grant) => /\b(insert|update|delete|all)\b/.test(grant.text))).toEqual([]);
  });

  it('lets every key follow its parent: a delete cascades or sets null, never refuses', () => {
    const table = tableStatement();
    const keys = [...table.matchAll(/references [a-z_.]+\s*\([a-z_]+\)[^,)]*/g)].map(
      (hit) => hit[0],
    );
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const key of keys) expect(key).toMatch(/on delete (cascade|set null)/);
  });

  it('holds one protest per pad id and one per place in the Match', () => {
    const table = tableStatement();
    expect(table).toContain('client_uuid uuid not null unique');
    expect(table).toContain('unique (match_id, sequence)');
  });
});
