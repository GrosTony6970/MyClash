import { describe, expect, it } from 'vitest';
import { rulesetRowActions } from './ruleset-row-actions';

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
