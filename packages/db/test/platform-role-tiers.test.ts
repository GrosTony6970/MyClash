/**
 * The platform tiers the code knows are the tiers the database accepts (migration 0170, ruling
 * 827). The CHECK is read as the LAST word across the migrations in order, so a later migration
 * that drops or changes it reds here; PLATFORM_ROLES is read as TEXT from @myclash/types (this
 * package has no dependency on it, and a build edge for a test is not worth it). A tier added in
 * code without a migration, or the reverse, reds here.
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

const NAME = 'platform_roles_role_ck';
const ADDED = new RegExp(`add constraint ${NAME} check \\(role in \\(([^)]*)\\)\\)`);

const tiers = (list: string) => list.split(',').map((part) => part.trim().replace(/^'|'$/g, ''));

/** `PLATFORM_ROLES` as @myclash/types declares it. */
function tiersInCode(): string[] {
  const source = readFileSync(
    join(__dirname, '..', '..', 'types', 'src', 'platform-role.ts'),
    'utf8',
  );
  const declaration = /PLATFORM_ROLES = \[([^\]]*)\]/u.exec(source);
  expect(declaration, 'platform-role.ts must declare PLATFORM_ROLES').not.toBeNull();
  return tiers(declaration![1]!);
}

describe('the platform tiers', () => {
  // 0170 adds it inside a DO block (Postgres has no ADD CONSTRAINT IF NOT EXISTS), so the
  // statement starts with `do $$`, not `alter table`.
  const added = lastIndex((s) => ADDED.test(s));

  it('are held by a CHECK that no later migration drops', () => {
    expect(added).toBeGreaterThan(-1);
    expect(lastIndex((s) => s.includes('drop constraint') && s.includes(NAME))).toBeLessThan(added);
  });

  it('are the same in the CHECK and in PLATFORM_ROLES', () => {
    const fromSql = tiers(ADDED.exec(statements[added] ?? '')![1]!);
    expect([...fromSql].sort()).toEqual([...tiersInCode()].sort());
    expect(fromSql).toContain('super_admin');
    // The stored identifier is deliberately NOT `read_only`: that value is already an
    // organization_members.role and means something else entirely.
    expect(fromSql).not.toContain('read_only');
  });
});
