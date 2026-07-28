import { describe, expect, it } from 'vitest';
import { adminRulesetRowActions, rulesetRowActions } from './ruleset-row-actions';

describe('rulesetRowActions', () => {
  it('built-in rulesets can be viewed and cloned, never edited or deleted', () => {
    expect(rulesetRowActions({ builtIn: true, mine: false })).toEqual({
      view: true,
      clone: true,
      edit: false,
      delete: false,
    });
  });

  it('your own custom ruleset can be edited, cloned and deleted (edit covers viewing)', () => {
    expect(rulesetRowActions({ builtIn: false, mine: true })).toEqual({
      view: false,
      clone: true,
      edit: true,
      delete: true,
    });
  });

  it('a shared custom ruleset from another org can be viewed and cloned only', () => {
    expect(rulesetRowActions({ builtIn: false, mine: false })).toEqual({
      view: true,
      clone: true,
      edit: false,
      delete: false,
    });
  });
});

describe('adminRulesetRowActions', () => {
  // An archived ruleset is archived *because* something still references it, and
  // updateRuleset rejects a PATCH to any referenced non-builtin. Offering Edit
  // (or Delete, which would only re-stamp archived_at) is a dead end.
  it('archived rulesets drop to read-only View — no edit, no delete', () => {
    expect(adminRulesetRowActions({ builtIn: false, archived: true })).toEqual({
      view: true,
      edit: false,
      delete: false,
    });
  });

  it('archived wins over built-in', () => {
    expect(adminRulesetRowActions({ builtIn: true, archived: true })).toEqual({
      view: true,
      edit: false,
      delete: false,
    });
  });

  it('a live custom ruleset can be edited and deleted', () => {
    expect(adminRulesetRowActions({ builtIn: false, archived: false })).toEqual({
      view: false,
      edit: true,
      delete: true,
    });
  });

  // Super-admin edits the built-in in place (builtInSuperAdminBanner); the
  // server exempts it from the reference guard but refuses to delete it.
  it('a live built-in can be edited but never deleted', () => {
    expect(adminRulesetRowActions({ builtIn: true, archived: false })).toEqual({
      view: false,
      edit: true,
      delete: false,
    });
  });
});
