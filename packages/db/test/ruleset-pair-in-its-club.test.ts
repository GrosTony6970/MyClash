/**
 * One ruleset code, one row; an Event moved through PostgREST takes no
 * Tournament to a club that may not use its ruleset (migration 0224, operator
 * rulings "Pair through the DB", "One tag", "Platform draft", "Version check",
 * "Exempt list", "Super admin" and "Direct login").
 *
 * The API refuses a foreign pair at its doors. Events stay writable through
 * PostgREST, so the Event-move rule lives in a trigger, and a code held by two
 * owners (a decoy, or a squatter) cannot exist. Tournaments are written by the
 * API only since 0233, which dropped 0224's two Tournament triggers and their
 * function (`tournaments-api-only-writes.test.ts` holds that). This reads the
 * migrations in order and asserts each function WHOLE, header and body, and the
 * trigger statement WHOLE, so a dropped status check, an `or` turned into `and`,
 * a wider exempt list, a BEFORE trigger (which answers a writer RLS would
 * refuse) or a flip to SECURITY INVOKER (whose writer cannot see another club's
 * row) cannot pass as a substring; and it refuses the later statements that
 * would undo them that it knows how to spell. The RLS probe (check 10, `pnpm
 * db:rls-probe` after `pnpm db:migrations:replay`) reads the same facts off the
 * running database.
 */
import { describe, it, expect } from 'vitest';
import {
  allSql,
  createOf,
  flat,
  functionStatement,
  lastIndex,
  matches,
  routine,
  triggerStatement,
} from './migration-sql';

const DEFINER = 'security definer set search_path = public, pg_catalog as $$';
const EXEMPT = `if current_setting('role') in ('service_role', 'none') then return new; end if;`;
const REFUSE = (message: string) =>
  `then raise exception '${message}' using errcode = 'check_violation'; end if;`;

const EXPECTED_FUNCTIONS: Record<string, string> = {
  ruleset_code_offered_to: `create or replace function public.ruleset_code_offered_to(p_code text, p_org uuid)
    returns boolean language sql stable ${DEFINER}
    select exists (select 1 from public.custom_rulesets cr where cr.code = p_code
      and ((cr.is_system and cr.owner_organization_id is null)
        or (not cr.is_system and cr.status not in ('archived', 'draft')
          and (cr.public_visibility or cr.owner_organization_id = p_org)))); $$`,
  ruleset_pairs_follow_event_move: `create or replace function public.ruleset_pairs_follow_event_move()
    returns trigger language plpgsql ${DEFINER}
    begin ${EXEMPT}
    if exists (select 1 from public.tournaments t where t.event_id = new.id
      and not public.ruleset_code_offered_to(t.ruleset_code, new.organization_id))
    ${REFUSE('A Tournament of this Event names a ruleset the new organisation may not use')}
    return new; end; $$`,
};

/** The grants a migration gives these functions: none. */
const GRANTS: Record<string, string[]> = {
  ruleset_code_offered_to: [],
  ruleset_pairs_follow_event_move: [],
};

const CODE_INDEX = 'custom_rulesets_code_unique_idx';

const EXPECTED_TRIGGERS: Record<string, string> = {
  events_ruleset_pairs_follow_move:
    'create trigger events_ruleset_pairs_follow_move after update of organization_id on ' +
    'public.events for each row when (new.organization_id is distinct from old.organization_id) ' +
    'execute function public.ruleset_pairs_follow_event_move();',
};

describe("the trigger that keeps a Tournament's ruleset in its own club when its Event moves", () => {
  const sql = allSql();

  it.each(Object.entries(EXPECTED_FUNCTIONS))(
    '%s is SECURITY DEFINER and holds the ruled check, whole',
    (name, expected) => {
      expect(functionStatement(sql, name)).toBe(flat(expected));
    },
  );

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

  it.each(Object.entries(GRANTS))(
    '%s keeps EXECUTE revoked from PostgREST, and no later ALTER, GRANT or DROP undoes it',
    (name, grants) => {
      const created = lastIndex(sql, createOf(name));
      const revoked = lastIndex(
        sql,
        `revoke\\s+execute\\s+on\\s+${routine(name)}\\s*\\([^)]*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
      );
      expect(created).toBeGreaterThan(-1);
      expect(revoked).toBeGreaterThan(created);
      expect(lastIndex(sql, `alter\\s+${routine(name)}`)).toBe(-1);
      const granted = matches(sql, `grant\\s[^;]*\\bon\\s+${routine(name)}[^;]*;`);
      expect(granted.map((hit) => hit.text)).toEqual(grants);
      expect(granted.every((hit) => hit.at > revoked)).toBe(true);
      expect(
        lastIndex(sql, `grant\\s[^;]*\\bon\\s+all\\s+(?:functions|routines|procedures)\\b`),
      ).toBeLessThan(created);
      expect(
        lastIndex(
          sql,
          `drop\\s+(?:function|routine)\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${name}\\b`,
        ),
      ).toBeLessThan(created);
    },
  );

  it.each(Object.entries(EXPECTED_TRIGGERS))(
    '%s fires after a change of the owner',
    (name, expected) => {
      expect(triggerStatement(sql, name)).toBe(flat(expected));
    },
  );

  it.each(Object.keys(EXPECTED_TRIGGERS))(
    '%s is not dropped, renamed or switched by a later migration',
    (name) => {
      const created = lastIndex(sql, `create\\s+(?:or\\s+replace\\s+)?trigger\\s+${name}\\b`);
      expect(lastIndex(sql, `drop\\s+trigger\\s+(?:if\\s+exists\\s+)?${name}\\b`)).toBeLessThan(
        created,
      );
      const switched = `(?:disable|enable\\s+(?:replica|always))\\s+trigger\\s+(?:${name}|all|user)\\b`;
      expect(lastIndex(sql, switched)).toBe(-1);
      expect(lastIndex(sql, `alter\\s+trigger\\s+${name}\\b`)).toBe(-1);
    },
  );
});
