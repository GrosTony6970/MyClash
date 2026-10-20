import { describe, expect, it } from 'vitest';
import { ForfeitRulesSchema } from '@myclash/rulesets';
import { CLUB_START_FORFEIT_RULES, FFAMHE_FORFEIT_RULES } from '@myclash/types/forfeit-rules';

/**
 * The two start values of the forfeit rules exist twice: in migration 0235 (the column DEFAULT, a
 * new club ruleset's; and the built-in FFAMHE row's) and in `@myclash/types/forfeit-rules`, which
 * the penalty editor starts a new ruleset from. A comment saying they match is not a build
 * failure: this compares them.
 *
 * It lives in apps/api, not beside the constants: `packages/rulesets` has no node types (adding
 * them is refused), and a CommonJS test cannot import the `.mjs` extractor statically (TS1479), so
 * it is loaded by `await import()` beside its `.d.mts`. The extractor finds the migration by the
 * tag on its line, not by its number: the renumber at push changes nothing here.
 */
const extractor = () => import('../../../../../scripts/lib/migration-literal.mjs');

describe('the forfeit rules’ start values against migration 0235', () => {
  it('the column DEFAULT is a new club ruleset’s start', async () => {
    const { migrationLiteral } = await extractor();
    const { value } = migrationLiteral('club_start_forfeit_rules');

    expect(value).toEqual(CLUB_START_FORFEIT_RULES);
    expect(ForfeitRulesSchema.parse(value)).toEqual(CLUB_START_FORFEIT_RULES);
  });

  it('the built-in row takes FFAMHE’s', async () => {
    const { migrationLiteral } = await extractor();
    const { value } = migrationLiteral('ffamhe_forfeit_rules');

    expect(value).toEqual(FFAMHE_FORFEIT_RULES);
    expect(ForfeitRulesSchema.parse(value)).toEqual(FFAMHE_FORFEIT_RULES);
  });
});
