/**
 * No table takes a write through the database's web door, and a new table starts closed
 * (migration 0247, operator rulings 98 and 226).
 *
 * 0247 drops every web write policy of `public`, revokes INSERT, UPDATE and DELETE on every
 * relation of `public` from `anon`, `authenticated` and PUBLIC, takes the same out of the default
 * privileges, and fails its own replay if any is left. This reads the migrations and asserts that
 * 0247 says so, and that no LATER migration opens a door again: a policy that is not a read (a
 * CREATE POLICY with no FOR clause is FOR ALL) unless it names the service role alone, a grant of
 * a write (a column grant too) to a web role, or a default privilege that grants one. The running
 * database is `pnpm db:rls-probe`'s (check 20, over the whole catalogue).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');
const MIGRATION = '0247_api_only_writes_everywhere.sql';

const flat = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

const files = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

/** The statements of the migrations `pick` keeps, in order, comments out, flattened. */
const statementsOf = (pick: (name: string) => boolean) =>
  files.filter(pick).flatMap((name) =>
    readFileSync(join(migrationsDir, name), 'utf8')
      .replace(/--[^\n]*/g, '')
      .split(';')
      .map((text) => ({ name, text: flat(text) }))
      .filter(({ text }) => text !== ''),
  );

const later = statementsOf((name) => name > MIGRATION);

/** `name on table` of a CREATE or DROP POLICY, quotes and `public.` left out. */
const POLICY = /^(create|drop) policy (?:if exists )?("[^"]+"|\S+) on (?:public\.)?"?([a-z_]+)"?/;
const keyOf = (name: string, table: string) => `${name.replaceAll('"', '')} on ${table}`;

const DROP_TABLE = /^drop table (?:if exists )?(?:public\.)?"?([a-z_]+)"?/;
const RENAME_TABLE =
  /^alter table (?:if exists )?(?:public\.)?"?([a-z_]+)"? rename to "?([a-z_]+)"?$/;

/**
 * Every policy alive just before 0247 that lets a web role write: not FOR SELECT, and TO nobody
 * named (PUBLIC) or to anon, authenticated or public. No migration alters or builds a policy
 * dynamically, so the CREATE and DROP POLICY statements are the whole story, with the table
 * statements that move or end a table's policies (0023 renames `fighters`, 0211 drops
 * `person_privacy`).
 */
function webWritePoliciesBefore0247(): string[] {
  const alive = new Map<string, string>();
  const onTable = (key: string, table: string) => key.endsWith(` on ${table}`);
  for (const { text } of statementsOf((name) => name < MIGRATION)) {
    const dropTable = DROP_TABLE.exec(text);
    const rename = RENAME_TABLE.exec(text);
    const hit = POLICY.exec(text);
    if (dropTable) {
      for (const key of [...alive.keys()]) if (onTable(key, dropTable[1]!)) alive.delete(key);
    } else if (rename) {
      for (const [key, policy] of [...alive])
        if (onTable(key, rename[1]!)) {
          alive.delete(key);
          alive.set(key.replace(/ on [a-z_]+$/, ` on ${rename[2]!}`), policy);
        }
    } else if (hit) {
      const key = keyOf(hit[2]!, hit[3]!);
      if (hit[1] === 'drop') alive.delete(key);
      else alive.set(key, text);
    }
  }
  return [...alive]
    .filter(([, text]) => !/ for select /.test(`${text} `))
    .filter(([, text]) => {
      const to = / to ([a-z_, ]+?)(?: using| with check|$)/.exec(text)?.[1];
      return to === undefined || /\b(anon|authenticated|public)\b/.test(to);
    })
    .map(([key]) => key)
    .sort();
}

const droppedBy0247 = statementsOf((name) => name === MIGRATION)
  .map(({ text }) => POLICY.exec(text))
  .filter((hit): hit is RegExpExecArray => hit?.[1] === 'drop')
  .map((hit) => keyOf(hit[2]!, hit[3]!))
  .sort();

// Read only when present, so a missing 0247 fails the assertions below rather than the collection.
const sql0247 = files.includes(MIGRATION)
  ? flat(readFileSync(join(migrationsDir, MIGRATION), 'utf8').replace(/--[^\n]*/g, ''))
  : '';

const WEB = /\bto\b[\s\S]*\b(anon|authenticated|public)\b/;

/** A policy that lets someone other than the service role write. */
const opensAPolicy = (s: string) =>
  s.startsWith('create policy') &&
  !/ for select /.test(`${s} `) &&
  !/ to service_role( |$)/.test(`${s} `);

/** A grant of a write, on a table or on its columns, to a web role or to PUBLIC. */
const grantsAWrite = (s: string) =>
  s.startsWith('grant') &&
  /^grant [\s\S]*\b(insert|update|delete|all)\b/.test(s.split(' on ')[0]!) &&
  WEB.test(s.split(' on ').slice(1).join(' on '));

/** A default privilege that grants anything. */
const grantsADefault = (s: string) =>
  s.startsWith('alter default privileges') && / grant /.test(`${s} `);

describe('0247: only the API writes any table', () => {
  it('is in the migrations', () => {
    expect(files).toContain(MIGRATION);
  });

  it('drops every web write policy the earlier migrations left, and only those', () => {
    const before = webWritePoliciesBefore0247();
    // The count a replay of `6b94449d` measured in `pg_policies` (rulings 98, 226).
    expect(before).toHaveLength(76);
    expect(droppedBy0247).toEqual(before);
  });

  it('revokes every web write on every relation of public', () => {
    expect(sql0247).toContain(
      'revoke insert, update, delete on all tables in schema public from anon, authenticated, public;',
    );
  });

  it("takes the writes out of both migration roles' default privileges, in public and globally", () => {
    expect(sql0247).toContain("foreach r in array array['postgres', 'supabase_admin'] loop");
    expect(sql0247).toContain(
      "'alter default privileges for role %i in schema public revoke insert, update, delete on tables from anon, authenticated, public'",
    );
    expect(sql0247).toContain(
      "'alter default privileges for role %i revoke insert, update, delete on tables from anon, authenticated, public'",
    );
  });

  it.each([
    "raise exception '0247: a web write policy is left: %'",
    "raise exception '0247: a web write privilege is left: %'",
    "raise exception '0247: a web write default privilege is left: %'",
  ])('fails its own replay when a door is left: %s', (guard) => {
    expect(sql0247).toContain(guard);
  });
});

describe('no migration after 0247 opens a web write door', () => {
  it.each([
    ['write policy', opensAPolicy],
    ['write grant', grantsAWrite],
    ['write default privilege', grantsADefault],
  ])('holds no web %s', (_what, opens) => {
    expect(later.filter(({ text }) => opens(text))).toEqual([]);
  });
});

describe('the door patterns name what they must', () => {
  it.each([
    'create policy x on public.t using (true)',
    'create policy x on public.t for update to authenticated using (true)',
    'create policy x on public.t for all to authenticated, service_role using (true)',
  ])('a policy that writes: %s', (s) => {
    expect(opensAPolicy(s)).toBe(true);
  });

  it.each([
    'create policy x on public.t for select using (true)',
    'create policy x on public.t for all to service_role using (true)',
  ])('a policy that does not open a web write: %s', (s) => {
    expect(opensAPolicy(s)).toBe(false);
  });

  it.each([
    'grant insert on public.t to authenticated',
    'grant update (name) on public.clubs to authenticated',
    'grant select, delete on all tables in schema public to anon',
    'grant all on public.t to public',
  ])('a write grant to a web role: %s', (s) => {
    expect(grantsAWrite(s)).toBe(true);
  });

  it.each([
    'grant select on public.t to anon, authenticated',
    'grant insert, update on public.t to service_role',
    'grant execute on function public.f() to authenticated',
  ])('not a web write grant: %s', (s) => {
    expect(grantsAWrite(s)).toBe(false);
  });

  it('a default privilege that grants', () => {
    expect(
      grantsADefault('alter default privileges in schema public grant insert on tables to anon'),
    ).toBe(true);
    expect(
      grantsADefault(
        'alter default privileges for role postgres in schema public revoke insert on tables from anon',
      ),
    ).toBe(false);
  });
});
