import { describe, expect, it } from 'vitest';
import { cloneCodedBase, type CloneSourceRow } from './clone-source';

function row(over: Partial<CloneSourceRow>): CloneSourceRow {
  return {
    code: 'custom_thing-abc',
    version: '1.0.0',
    is_system: false,
    base_code: null,
    base_version: null,
    ...over,
  };
}

describe('cloneCodedBase', () => {
  it('bases a clone of the built-in on the built-in itself', () => {
    expect(cloneCodedBase(row({ code: 'TF_v1', version: '1.0.0', is_system: true }))).toEqual({
      baseCode: 'TF_v1',
      baseVersion: '1.0.0',
    });
  });

  it("bases a clone of a fork on the fork's OWN base, never on the fork", () => {
    // The load-bearing case: only a built-in can be a base, so adopting another
    // org's shared fork must re-base on TF_v1 rather than point at a row that
    // org could later delete.
    expect(
      cloneCodedBase(
        row({ code: 'custom_tf_v1_fork_x', base_code: 'TF_v1', base_version: '1.0.0' }),
      ),
    ).toEqual({ baseCode: 'TF_v1', baseVersion: '1.0.0' });
  });

  it('defaults a forks base version when the column predates it', () => {
    expect(cloneCodedBase(row({ base_code: 'TF_v1', base_version: null }))).toEqual({
      baseCode: 'TF_v1',
      baseVersion: '1.0.0',
    });
  });

  it('returns null for an authored formula ruleset, which clones as a formula', () => {
    expect(cloneCodedBase(row({}))).toBeNull();
  });
});
