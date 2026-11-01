/**
 * One ruleset code, one row (migration 0224, operator ruling "One tag"); 0224's Event-move check
 * is gone (migration 0247, ruling 229).
 *
 * The API refuses a foreign pair at its doors, and a code held by two owners (a decoy, or a
 * squatter) cannot exist. 0224 also kept a Tournament's ruleset in its club when its Event moved,
 * with a trigger that refused only a writer signed in through PostgREST. Since 0247 no web role
 * may write `events` (the API never moves an Event to another club), so the trigger could never
 * fire: 0247 drops it, its function and the helper only it called, as 0233 dropped 0224's two
 * Tournament triggers (`tournaments-api-only-writes.test.ts`). This reads the migrations in order
 * and asserts the last word. The RLS probe (check 10, `pnpm db:rls-probe` after
 * `pnpm db:migrations:replay`) reads the same facts off the running database.
 */
import { describe, it, expect } from 'vitest';
import { allSql, flat, lastIndex, matches } from './migration-sql';

const CODE_INDEX = 'custom_rulesets_code_unique_idx';

describe('one ruleset code, one row', () => {
  const sql = allSql();

  it('holds one row per ruleset code, whatever its owner, and no later migration undoes it', () => {
    const create = `create\\s+unique\\s+index\\s+(?:if\\s+not\\s+exists\\s+)?${CODE_INDEX}\\b[^;]*;`;
    expect(matches(sql, create).at(-1)?.text).toBe(
      flat(`create unique index if not exists ${CODE_INDEX} on public.custom_rulesets (code);`),
    );
    const created = lastIndex(sql, create);
    expect(
      lastIndex(
        sql,
        `drop\\s+index\\s+(?:concurrently\\s+)?(?:if\\s+exists\\s+)?(?:public\\.)?${CODE_INDEX}\\b`,
      ),
    ).toBeLessThan(created);
    expect(
      lastIndex(sql, `alter\\s+index\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${CODE_INDEX}\\b`),
    ).toBe(-1);
    // 0055's per-owner index let two owners hold one code: it goes, and does not come back.
    const perOwner = 'custom_rulesets_scope_unique_idx';
    expect(
      lastIndex(sql, `drop\\s+index\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${perOwner}\\b`),
    ).toBeGreaterThan(
      lastIndex(sql, `create\\s+unique\\s+index\\s+(?:if\\s+not\\s+exists\\s+)?${perOwner}\\b`),
    );
  });
});

describe("0224's Event-move check is gone (ruling 229)", () => {
  const sql = allSql();
  const trigger = 'events_ruleset_pairs_follow_move';
  const dropTrigger = lastIndex(sql, `drop\\s+trigger\\s+${trigger}\\s+on\\s+public\\.events\\s*;`);
  const dropFunction = (name: string, args: string) =>
    lastIndex(sql, `drop\\s+function\\s+public\\.${name}\\s*\\(\\s*${args}\\s*\\)\\s*;`);

  it('drops the trigger, and no later migration makes it again', () => {
    expect(dropTrigger).toBeGreaterThan(-1);
    expect(lastIndex(sql, `create\\s+(?:or\\s+replace\\s+)?trigger\\s+${trigger}\\b`)).toBeLessThan(
      dropTrigger,
    );
  });

  it.each([
    ['ruleset_pairs_follow_event_move', ''],
    ['ruleset_code_offered_to', 'text\\s*,\\s*uuid'],
  ])('drops %s after the trigger, and no later migration makes it again', (name, args) => {
    const dropped = dropFunction(name, args);
    expect(dropped).toBeGreaterThan(dropTrigger);
    expect(
      lastIndex(sql, `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\b`),
    ).toBeLessThan(dropped);
  });

  it('drops the helper after the function that calls it', () => {
    expect(dropFunction('ruleset_code_offered_to', 'text\\s*,\\s*uuid')).toBeGreaterThan(
      dropFunction('ruleset_pairs_follow_event_move', ''),
    );
  });
});
