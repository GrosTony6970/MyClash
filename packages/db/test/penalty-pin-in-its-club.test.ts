/**
 * An Event or a Tournament pins only a penalty ruleset its own organisation may
 * pin (migration 0199, operator ruling 68).
 *
 * The API refuses a foreign pin at its five doors; RLS `events_update` and
 * `tournaments_write` still let an organisation admin write the columns through
 * PostgREST, so the rule also lives in triggers. This reads the migrations in
 * order and asserts each function body and trigger statement WHOLE, so an `or`
 * turned into `and`, a widened allow-list or a `return null` cannot pass as a
 * substring. It cannot see the running database; `pnpm db:migrations:replay`
 * and a probe insert cover that.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

function allSql(): string {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, ''))
    .join('\n');
}

const flat = (text: string | null | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase();

/** The body of the last CREATE OR REPLACE of `name`, between its dollar quotes. */
function functionBody(sql: string, name: string): string {
  const pattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${name}\\s*\\(\\)[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$`,
    'gi',
  );
  return flat([...sql.matchAll(pattern)].map((hit) => hit[1]).at(-1));
}

/** The last CREATE TRIGGER statement for `name`, up to its semicolon. */
function triggerStatement(sql: string, name: string): string {
  const pattern = new RegExp(`create\\s+trigger\\s+${name}\\b[\\s\\S]*?;`, 'gi');
  return flat([...sql.matchAll(pattern)].map((hit) => hit[0]).at(-1));
}

const ALLOWED = '(pr.built_in or pr.public_visibility or pr.owner_organization_id = ';

const EXPECTED_TRIGGERS: Record<string, string> = {
  events_penalty_pin_insert:
    'create trigger events_penalty_pin_insert before insert on public.events for each row ' +
    'when (new.penalty_ruleset_id is not null) execute function public.penalty_pin_in_its_club();',
  events_penalty_pin_update:
    'create trigger events_penalty_pin_update before update of penalty_ruleset_id, ' +
    'penalty_ruleset_version, organization_id on public.events for each row when ' +
    '(new.penalty_ruleset_id is not null and (new.penalty_ruleset_id is distinct from ' +
    'old.penalty_ruleset_id or new.penalty_ruleset_version is distinct from ' +
    'old.penalty_ruleset_version or new.organization_id is distinct from old.organization_id)) ' +
    'execute function public.penalty_pin_in_its_club();',
  events_penalty_pins_follow_move:
    'create trigger events_penalty_pins_follow_move before update of organization_id on ' +
    'public.events for each row when (new.organization_id is distinct from old.organization_id) ' +
    'execute function public.penalty_pins_follow_event_move();',
  tournaments_penalty_pin_insert:
    'create trigger tournaments_penalty_pin_insert before insert on public.tournaments for each ' +
    'row when (new.penalty_ruleset_id is not null) execute function ' +
    'public.penalty_pin_in_its_club();',
  tournaments_penalty_pin_update:
    'create trigger tournaments_penalty_pin_update before update of penalty_ruleset_id, ' +
    'penalty_ruleset_version, event_id on public.tournaments for each row when ' +
    '(new.penalty_ruleset_id is not null and (new.penalty_ruleset_id is distinct from ' +
    'old.penalty_ruleset_id or new.penalty_ruleset_version is distinct from ' +
    'old.penalty_ruleset_version or new.event_id is distinct from old.event_id)) ' +
    'execute function public.penalty_pin_in_its_club();',
};

describe('the triggers that keep a penalty ruleset pin in its own club', () => {
  const sql = allSql();

  it("accepts the built-in, a shared ruleset, or one of the row's own organisation", () => {
    expect(functionBody(sql, 'penalty_pin_in_its_club')).toBe(
      flat(`declare owner_org uuid; begin
        if tg_table_name = 'events' then owner_org := new.organization_id;
        else select e.organization_id into owner_org from public.events e where e.id = new.event_id;
        end if;
        if not exists (select 1 from public.penalty_rulesets pr where pr.id = new.penalty_ruleset_id
          and ${ALLOWED}owner_org))
        then raise exception 'This penalty ruleset is not available to this organisation'
          using errcode = 'check_violation';
        end if; return new; end;`),
    );
  });

  it("re-checks every Tournament's pin when its Event moves to another organisation", () => {
    expect(functionBody(sql, 'penalty_pins_follow_event_move')).toBe(
      flat(`begin if exists (select 1 from public.tournaments t where t.event_id = new.id
          and t.penalty_ruleset_id is not null and not exists (select 1 from public.penalty_rulesets pr
            where pr.id = t.penalty_ruleset_id and ${ALLOWED}new.organization_id)))
        then raise exception 'A Tournament of this Event pins a penalty ruleset the new organisation may not use'
          using errcode = 'check_violation';
        end if; return new; end;`),
    );
  });

  it.each(Object.entries(EXPECTED_TRIGGERS))(
    '%s fires on insert, or on a change of the pin, its version or its owner',
    (name, expected) => {
      expect(triggerStatement(sql, name)).toBe(flat(expected));
    },
  );

  it.each(Object.keys(EXPECTED_TRIGGERS))('%s is not dropped by a later migration', (name) => {
    const create = new RegExp(`create\\s+trigger\\s+${name}\\b`, 'gi');
    // `DROP FUNCTION … CASCADE` takes the trigger with it.
    const drop = new RegExp(
      `drop\\s+trigger\\s+(?:if\\s+exists\\s+)?${name}\\b|drop\\s+function\\s+(?:if\\s+exists\\s+)?(?:public\\.)?penalty_pin(?:s_follow_event_move|_in_its_club)\\s*\\(\\s*\\)\\s*cascade`,
      'gi',
    );
    const lastCreate = Math.max(-1, ...[...sql.matchAll(create)].map((hit) => hit.index));
    const lastDrop = Math.max(-1, ...[...sql.matchAll(drop)].map((hit) => hit.index));
    expect(lastCreate).toBeGreaterThan(lastDrop);
  });
});
