/**
 * An organisation's sidebar profile (migration 0256). The value list is owned by
 * ORG_MENU_PROFILES in @myclash/types (`packages/types/src/org-menu-profile.test.ts` pins it);
 * this pins the CHECK to the same two values. Read from the migrations as one text, so a later
 * migration that drops the column reds here.
 */
import { describe, expect, it } from 'vitest';
import { allSql, flat } from './migration-sql';

const sql = flat(allSql());

describe('Organisation menu profile', () => {
  it('adds menu_profile, not null, default everything', () => {
    expect(sql).toContain(
      "add column if not exists menu_profile text not null default 'everything'",
    );
  });

  it('allows exactly everything and workshops', () => {
    expect(sql).toContain("check (menu_profile in ('everything','workshops'))");
    expect(sql).toContain('validate constraint organizations_menu_profile_check');
  });
});
