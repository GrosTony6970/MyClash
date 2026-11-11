/**
 * A roster row says "claimed" exactly when an account holds it (migration 0262, ruling 580).
 *
 * The claim doors decide by the holder alone; the CHECK is what keeps the status from saying
 * otherwise. This reads the migrations in order and pins the two repairs that run before the
 * CHECK, the CHECK itself, and that no later migration drops it. What it refuses is checked on a
 * replayed Postgres by `pnpm db:rls-probe` (`scripts/lib/roster-holder-probe.mjs`).
 */
import { describe, expect, it } from 'vitest';
import { allSql, matches } from './migration-sql';

const NAME = 'persons_claim_status_holder_check';
const sql = allSql();

const HELD_SAYS_CLAIMED =
  "update persons set claim_status = 'claimed' where claimed_by_user_id is not null and claim_status <> 'claimed'";
const UNHELD_SAYS_UNCLAIMED =
  "update persons set claim_status = 'unclaimed' where claimed_by_user_id is null and claim_status = 'claimed'";
const CHECK = `alter table persons add constraint ${NAME} check ((claim_status = 'claimed') = (claimed_by_user_id is not null))`;

/** Where `statement` starts in the migrations, as a whitespace-tolerant pattern. */
const at = (statement: string) => {
  const pattern = statement
    .split(' ')
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return matches(sql, pattern);
};

describe('a roster row says claimed exactly when an account holds it', () => {
  it('adds the CHECK once, after both repairs', () => {
    const check = at(CHECK);
    const held = at(HELD_SAYS_CLAIMED);
    const unheld = at(UNHELD_SAYS_UNCLAIMED);

    expect(check.map((hit) => hit.text)).toEqual([CHECK]);
    expect(held).toHaveLength(1);
    expect(unheld).toHaveLength(1);
    expect(held[0]!.at).toBeLessThan(check[0]!.at!);
    expect(unheld[0]!.at).toBeLessThan(check[0]!.at!);
  });

  it('names the CHECK in no other statement, so no later migration drops it', () => {
    expect(matches(sql, NAME)).toHaveLength(1);
  });
});
