/**
 * A signed-in reader reads through the API, never through the database's web door (migration
 * 0273, operator rulings 821 and 822).
 *
 * A signed-in account's own token opens PostgREST and the live channel as `authenticated`, where
 * the RLS helpers loop. On the live channel one such socket stopped every viewer's updates (one
 * poll serves them all). 0273 takes SELECT on every relation of `public` from `authenticated`, takes
 * it from the default privileges of new tables, and drops the eight policies that served that role
 * alone. This reads the migrations in order: a later migration that gives the role a read back, or
 * a policy for it, goes red here, not only on the replay. The running database is
 * `pnpm db:rls-probe`'s (check 22).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');
const MIGRATION = '0273_signed_in_reads_api_only.sql';

const files = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

/** Statements of the given files, comments out, flattened and lower-cased, split on `;`. */
const statementsOf = (names: string[]) =>
  names
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, ''))
    .join('\n')
    .split(';')
    .map((text) => text.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((text) => text !== '');

const all = statementsOf(files);
const own = statementsOf([MIGRATION]);
const later = statementsOf(files.filter((file) => file > MIGRATION));

const lastIndex = (match: (statement: string) => boolean) =>
  all.reduce((last, statement, index) => (match(statement) ? index : last), -1);

/**
 * A GRANT (or a default-privilege GRANT) whose privileges include a read, to `authenticated` or to
 * PUBLIC (every role is a member of PUBLIC), or a role grant that makes `authenticated` a member of
 * another role (`grant anon to authenticated` would hand it every read anon has).
 */
const grantsARead = (s: string) => {
  if (!/(^|[^a-z_])grant\s/.test(s) || !/\bto\s[^;]*\b(authenticated|public)\b/.test(s))
    return false;
  if (!/\son\s/.test(s)) return /\bto\s[^;]*\bauthenticated\b/.test(s);
  return (
    /\b(select|all)\b/.test(s.split(/\son\s|\sto\s/)[0] ?? '') &&
    !/\bon\s+(function|functions|routine|routines|procedure|procedures|all\s+functions|all\s+routines|all\s+procedures|schema|sequence|sequences|all\s+sequences)\b/.test(
      s,
    )
  );
};

const POLICIES: Array<[string, string]> = [
  ['authenticated_read', 'hema_ratings_snapshots'],
  ['authenticated_read', 'hema_rating_history'],
  ['org admins read exchange edit requests', 'public.exchange_edit_requests'],
  ['organizer_ai_assistant_drafts_org_read', 'organizer_ai_assistant_drafts'],
  ['organizer_chat_conversations_org_read', 'organizer_chat_conversations'],
  ['organizer_chat_messages_org_read', 'organizer_chat_messages'],
  ['org members read tournament ruleset repins', 'public.tournament_ruleset_repins'],
  ['super admins read tournament ruleset repins', 'public.tournament_ruleset_repins'],
];

const quoted = (name: string) => (/^[a-z_]+$/.test(name) ? `"?${name}"?` : `"${name}"`);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('a signed-in reader reads nothing through the database', () => {
  it('takes SELECT on every relation of public from authenticated, by name', () => {
    expect(own).toContain('revoke select on all tables in schema public from authenticated');
  });

  it('takes it from the default privileges of new tables, in public and globally, and guards it', () => {
    const text = own.join(';');
    expect(text).toContain("raise exception '0273: authenticated still reads %'");
    expect(text).toContain(
      "raise exception '0273: new tables of % still give authenticated select'",
    );
    expect(text).toContain("raise exception '0273: a policy for authenticated alone is left: %'");
    expect(text).toContain(
      "'alter default privileges for role %i in schema public revoke select on tables from authenticated'",
    );
    expect(text).toContain(
      "'alter default privileges for role %i revoke select on tables from authenticated'",
    );
  });

  it.each(POLICIES)('drops "%s" on %s, and it never comes back', (name, table) => {
    const on = `\\s+on\\s+(?:public\\.)?${escape(table.replace(/^public\./, ''))}(\\s|$)`;
    const created = lastIndex((s) => new RegExp(`^create policy ${quoted(name)}${on}`).test(s));
    const dropped = lastIndex((s) => new RegExp(`^drop policy ${quoted(name)}${on}`).test(s));
    expect(created).toBeGreaterThan(-1);
    expect(dropped).toBeGreaterThan(created);
  });

  it('gives authenticated no read again, table, column or default', () => {
    expect(later.filter(grantsARead)).toEqual([]);
  });

  it('creates no later policy for authenticated', () => {
    expect(
      later.filter(
        (s) => /^(create|alter) policy\s/.test(s) && /\sto\s[^;]*\bauthenticated\b/.test(s),
      ),
    ).toEqual([]);
  });
});
