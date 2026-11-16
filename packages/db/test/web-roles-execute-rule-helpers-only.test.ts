/**
 * The web roles run only the helpers the read rules call (migration 0275, operator ruling 826).
 *
 * Every function made in `public` used to start executable by PUBLIC, anon and authenticated, so
 * the public key could call over /rest/v1/rpc any of them no migration had revoked by hand, and the
 * one sequence gave both web roles setval. 0275 takes EXECUTE on every routine of `public` from all
 * three, gives anon back only the helpers its read rules need (derived from the catalogue), closes
 * sequences, and makes new functions and sequences start closed (ruling 838 keeps PUBLIC's default
 * in `realtime`). This reads the migrations in order: a later migration that opens a function to
 * authenticated or PUBLIC, a schema-wide grant to a web role, a sequence grant, a default that
 * opens new objects, or one that closes `realtime`'s goes red here. A later `grant execute on
 * function <one> to anon` is allowed here (a new read rule's helper needs one): `pnpm db:rls-probe`
 * (check 24) judges whether a read rule needs it. A sequence granted with table syntax (`grant
 * usage on <seq>`) is not seen here; check 24 (f) reads every sequence.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');
const MIGRATION = '0275_web_roles_execute_rule_helpers_only.sql';

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

// From the listing, so a missing 0275 fails the tests below by name, not the file's collection.
const own = statementsOf(files.filter((file) => file === MIGRATION));
const later = statementsOf(files.filter((file) => file > MIGRATION));

const WEB = /\bto\s[^;]*\b(anon|authenticated|public)\b/;
const isGrant = (s: string) => /(^|[^a-z_])grant\s/.test(s) && !/^revoke\s/.test(s);
const onRoutines = (s: string) =>
  /\son\s+(all\s+)?(function|functions|routine|routines|procedure|procedures)\b/.test(s);
const onSequences = (s: string) => /\son\s+(all\s+)?(sequence|sequences)\b/.test(s);

describe('the web roles run only the helpers the read rules call', () => {
  it('grants service_role every routine first, then takes them from PUBLIC and both web roles', () => {
    const grant = own.indexOf('grant execute on all routines in schema public to service_role');
    const fromPublic = own.indexOf('revoke execute on all routines in schema public from public');
    const fromWeb = own.indexOf(
      'revoke execute on all routines in schema public from anon, authenticated',
    );
    expect(grant).toBeGreaterThan(-1);
    expect(fromPublic).toBeGreaterThan(grant);
    expect(fromWeb).toBeGreaterThan(grant);
  });

  it('gives anon back only what the read rules need, derived from pg_policy, not listed', () => {
    const text = own.join(';');
    expect(text).toContain("execute format('grant execute on function %s to anon', fn)");
    expect(text).toContain("join pg_depend d on d.classid = 'pg_policy'::regclass");
    expect(own.filter((s) => /^grant execute on function /.test(s))).toEqual([]);
  });

  it('closes the sequences to PUBLIC and both web roles', () => {
    expect(own).toContain(
      'revoke all on all sequences in schema public from public, anon, authenticated',
    );
  });

  it('makes new functions and sequences start closed, and guards every part', () => {
    const text = own.join(';');
    for (const line of [
      "'alter default privileges for role %i revoke execute on functions from public'",
      "'alter default privileges for role %i in schema public revoke execute on functions from anon, authenticated'",
      "'alter default privileges for role %i in schema public revoke all on sequences from anon, authenticated'",
      "raise exception '0275: a web role still runs a function: %'",
      "raise exception '0275: anon runs the wrong functions: %'",
      "raise exception '0275: service_role cannot run %'",
      "raise exception '0275: a web role may still use a sequence: %'",
      "raise exception '0275: new functions of % still give public execute'",
      "raise exception '0275: a default privilege still gives a web role a new function or sequence: %'",
      // Ruling 838: Realtime's own functions, made after the migrations, keep PUBLIC's EXECUTE.
      "'alter default privileges for role %i in schema realtime grant execute on functions to public'",
      "raise exception '0275: new functions of % in realtime no longer give public execute'",
    ])
      expect(text).toContain(line);
  });

  it('opens no function to authenticated or PUBLIC again, and none schema-wide to a web role', () => {
    const opens = later.filter(
      (s) =>
        isGrant(s) &&
        onRoutines(s) &&
        WEB.test(s) &&
        (/\bto\s[^;]*\b(authenticated|public)\b/.test(s) ||
          /\son\s+all\s/.test(s) ||
          !/\bto\s+anon$/.test(s)),
    );
    expect(opens).toEqual([]);
  });

  it('gives no web role a sequence again', () => {
    expect(later.filter((s) => isGrant(s) && onSequences(s) && WEB.test(s))).toEqual([]);
  });

  it('opens no default for new functions or sequences again', () => {
    expect(
      later.filter(
        (s) =>
          /^alter default privileges\s/.test(s) &&
          /\sgrant\s/.test(s) &&
          /\son\s+(functions|routines|sequences)\b/.test(s) &&
          WEB.test(s),
      ),
    ).toEqual([]);
  });

  it("keeps realtime's default and Realtime's own functions open (ruling 838)", () => {
    expect(
      later.filter(
        (s) =>
          /(^|\s)revoke\s/.test(s) &&
          (/\sin\s+schema\s+[^;]*\brealtime\b/.test(s) ||
            /\son\s+(function|routine)\s+realtime\./.test(s)),
      ),
    ).toEqual([]);
  });
});
