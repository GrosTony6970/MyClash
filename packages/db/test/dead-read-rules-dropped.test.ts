/**
 * Read rules that no reader can pass are dropped, and stay dropped (migration 0274, operator
 * rulings 825 and 835).
 *
 * Since 0247 no web role writes and since 0273 `authenticated` reads nothing, so only anon reads
 * through a rule. 36 rules had no branch anon can pass (a helper that needs an account, or an
 * `= auth.uid()` comparison), and two were `TO service_role`, which bypasses RLS. This reads the
 * migrations in order, keyed on (rule, table): two of the rules share a name. A later migration
 * that creates one again, or `is_platform_staff`, goes red here. The running database is
 * `pnpm db:rls-probe`'s (check 23).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');
const MIGRATION = '0274_dead_read_rules_dropped.sql';

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
// From the listing, so a missing 0274 fails the tests below by name, not the file's collection.
const own = statementsOf(files.filter((file) => file === MIGRATION));
const later = statementsOf(files.filter((file) => file > MIGRATION));

const lastIndex = (match: (statement: string) => boolean) =>
  all.reduce((last, statement, index) => (match(statement) ? index : last), -1);

const RULES: Array<[string, string]> = [
  ['ai_usage_read', 'ai_usage_log'],
  ['audit_log_select', 'audit_log'],
  ['custom_rulesets_org_owner_read', 'custom_rulesets'],
  ['custom_rulesets_super_admin_read', 'custom_rulesets'],
  ['deletion_requests_select', 'deletion_requests'],
  ['event_broadcast_notifications_select', 'event_broadcast_notifications'],
  ['event_broadcast_recipients_select', 'event_broadcast_recipients'],
  ['event_instructors_select', 'event_instructors'],
  ['epb_read', 'event_programme_blocks'],
  ['epc_read', 'event_programme_configs'],
  ['follows_select', 'follows'],
  ['guest_sessions_select', 'guest_sessions'],
  ['league_org_roles_select', 'league_organization_roles'],
  ['league_links_select', 'league_tournament_links'],
  ['league_user_roles_select', 'league_user_roles'],
  ['legal_acceptances_owner_select', 'legal_acceptances'],
  ['notification_preferences_select', 'notification_preferences'],
  ['org_ai_keys_read', 'organization_ai_keys'],
  ['ai_settings_read', 'organization_ai_settings'],
  ['org_members_select', 'organization_members'],
  ['orgs_select', 'organizations'],
  ['person_email_change_requests_select_own', 'person_email_change_requests'],
  ['persons_select', 'persons'],
  ['platform_ai_usage_super_admin', 'platform_ai_usage_log'],
  ['platform_roles_select', 'platform_roles'],
  ['pool_assignment_settings_select', 'pool_assignment_settings'],
  ['push_subscriptions_select', 'push_subscriptions'],
  ['rces_read', 'referee_compensation_event_settings'],
  ['rcpay_read', 'referee_compensation_payments'],
  ['tournament_penalty_reviews_select', 'tournament_penalty_reviews'],
  ['tournament_query_history_org_admin_read', 'tournament_query_history'],
  ['tournament_query_history_own_read', 'tournament_query_history'],
  ['tournament_query_settings_org_admin_read', 'tournament_query_settings'],
  ['workshop_breaks_select', 'workshop_breaks'],
  ['workshop_enrollments_select', 'workshop_enrollments'],
  ['workshop_feedback_select', 'workshop_feedback'],
  ['service_role_all', 'hema_rating_history'],
  ['service_role_all', 'hema_ratings_snapshots'],
];

const on = (table: string) => `\\s+on\\s+(?:public\\.)?${table}(\\s|$)`;
const PLATFORM_STAFF =
  /^(create( or replace)?|drop) function (if exists )?(public\.)?is_platform_staff\s*\(/;

describe('read rules no reader can pass', () => {
  it('lists 38 distinct rules', () => {
    expect(new Set(RULES.map(([name, table]) => `${name} on ${table}`)).size).toBe(38);
  });

  it.each(RULES)('drops "%s" on %s in 0274, and it never comes back', (name, table) => {
    const created = lastIndex((s) => new RegExp(`^create policy "?${name}"?${on(table)}`).test(s));
    const dropped = lastIndex((s) => new RegExp(`^drop policy "?${name}"?${on(table)}`).test(s));
    expect(created).toBeGreaterThan(-1);
    expect(dropped).toBeGreaterThan(created);
    expect(own.some((s) => new RegExp(`^drop policy "?${name}"?${on(table)}`).test(s))).toBe(true);
  });

  it('drops is_platform_staff, whose only caller went, and never creates it again', () => {
    expect(own).toContain('drop function public.is_platform_staff()');
    expect(later.filter((s) => PLATFORM_STAFF.test(s))).toEqual([]);
  });

  it('names each guard: the rules, the function, write rules, and roles that cannot run a rule', () => {
    const text = own.join(';');
    expect(text).toContain("raise exception '0274: a dead read rule is left: %'");
    expect(text).toContain("raise exception '0274: is_platform_staff is left'");
    expect(text).toContain("raise exception '0274: a rule in public is not a read rule: %'");
    expect(text).toContain("raise exception '0274: a rule names a role that cannot run it: %'");
    // What the raises read: the write-rule and role conditions, as written.
    expect(text).toContain("p.polcmd <> 'r'");
    expect(text).toContain("not has_any_column_privilege(r.role_name, c.oid, 'select')");
    expect(text).toContain('(select rolbypassrls from pg_roles where rolname = r.role_name)');
  });

  it.each(RULES)('the guard looks for "%s" on %s', (name, table) => {
    expect(own.join(';')).toContain(`('${table}', '${name}')`);
  });
});
