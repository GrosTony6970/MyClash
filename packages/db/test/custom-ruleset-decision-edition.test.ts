/**
 * A club formula ruleset keeps the end decision of the day it was published
 * (migration 0228, rulings "Club formulas" and "Edition day", 2026-10-17).
 *
 * The CHECKs read as the LAST word across the migrations in order, so a later
 * migration that drops or widens one reds here. The edition list is read as
 * TEXT from @myclash/rules, as test 34 of rls.test.ts reads the platform roles:
 * an edition added in code without a migration, or the reverse, reds here. The
 * running database is the replay's (the RLS probe seeds a club row with one).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

const statements = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, ''))
  .join('\n')
  .split(';')
  .map((text) =>
    text.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase(),
  )
  .filter((text) => text !== '');

const lastIndex = (match: (statement: string) => boolean) =>
  statements.reduce((last, statement, index) => (match(statement) ? index : last), -1);

/** `DECISION_EDITIONS` as @myclash/rules declares it. */
function editionsInCode(): string[] {
  const source = readFileSync(
    join(__dirname, '..', '..', 'rules', 'src', 'match-format.ts'),
    'utf8',
  );
  const declaration = /DECISION_EDITIONS = \[([^\]]*)\] as const/u.exec(source);
  expect(declaration, 'match-format.ts must declare DECISION_EDITIONS').not.toBeNull();
  return declaration![1]!.split(',').map((part) => part.trim().replace(/^'|'$/gu, ''));
}

const knownList = () =>
  `(${editionsInCode()
    .map((edition) => `'${edition}'`)
    .join(', ')})`;

describe('the decision edition of a club formula ruleset', () => {
  it.each(['custom_rulesets', 'custom_ruleset_versions'])(
    'adds the column to %s, with no default',
    (table) => {
      const added = statements.filter((s) =>
        new RegExp(
          `^alter table (public\\.)?${table} add column (if not exists )?decision_edition `,
        ).test(`${s} `),
      );
      expect(added).toEqual([`alter table ${table} add column decision_edition text`]);
    },
  );

  it.each([
    ['custom_rulesets', 'custom_rulesets_decision_edition_known'],
    ['custom_ruleset_versions', 'custom_ruleset_versions_decision_edition_known'],
  ])('%s holds only the editions @myclash/rules declares (%s)', (table, name) => {
    const check = `add constraint ${name} check (decision_edition in ${knownList()})`;
    const added = lastIndex((s) => s.startsWith(`alter table ${table} `) && s.includes(check));
    expect(added).toBeGreaterThan(-1);
    expect(lastIndex((s) => s.includes(`drop constraint`) && s.includes(name))).toBeLessThan(added);
  });

  it('requires one on every row that is neither a built-in mirror nor a coded fork', () => {
    const name = 'custom_rulesets_decision_edition_required';
    const check = `add constraint ${name} check (base_code is not null or is_system or decision_edition is not null)`;
    const added = lastIndex(
      (s) => s.startsWith('alter table custom_rulesets ') && s.includes(check),
    );
    expect(added).toBeGreaterThan(-1);
    expect(lastIndex((s) => s.includes(`drop constraint`) && s.includes(name))).toBeLessThan(added);
  });

  it('gives the rows stored before it the edition the API gave them, before the CHECK lands', () => {
    const row = lastIndex(
      (s) =>
        s ===
        "update custom_rulesets set decision_edition = '2026-10' where base_code is null and not is_system",
    );
    const snapshot = lastIndex(
      (s) =>
        s ===
        "update custom_ruleset_versions v set decision_edition = '2026-10' from custom_rulesets r " +
          'where r.id = v.custom_ruleset_id and r.base_code is null and not r.is_system',
    );
    const required = lastIndex((s) =>
      s.includes('custom_rulesets_decision_edition_required check'),
    );
    expect(row).toBeGreaterThan(-1);
    expect(snapshot).toBeGreaterThan(-1);
    expect(row).toBeLessThan(required);
  });
});
