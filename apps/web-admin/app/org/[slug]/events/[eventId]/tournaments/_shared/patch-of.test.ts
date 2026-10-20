import { describe, expect, it } from 'vitest';
import { patchOf } from './patch-of';

const saved = {
  rulesetConfig: {
    matchFormat: { pointCap: 7, timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 } },
  },
  scoringConfig: { buttons: { clean: [{ label: '+2', value: 2 }] } },
};

describe('patchOf', () => {
  it('answers nothing for an untouched form', () => {
    expect(patchOf(saved, structuredClone(saved))).toBeNull();
  });

  it('sends exactly the leaf that changed', () => {
    const edited = structuredClone(saved);
    edited.rulesetConfig.matchFormat.timeLimitsSeconds.pool = 120;
    expect(patchOf(saved, edited)).toEqual({
      rulesetConfig: { matchFormat: { timeLimitsSeconds: { pool: 120 } } },
    });
  });

  it('sends a list whole when it differs, as the server replaces it', () => {
    const edited = structuredClone(saved);
    edited.scoringConfig.buttons.clean.push({ label: '+1', value: 1 });
    expect(patchOf(saved, edited)).toEqual({
      scoringConfig: {
        buttons: { clean: [...saved.scoringConfig.buttons.clean, { label: '+1', value: 1 }] },
      },
    });
  });

  it('sends a null as a value', () => {
    const before = { rulesetConfig: { matchFormat: { maxDoubleHits: 2 } } };
    const cleared = { rulesetConfig: { matchFormat: { maxDoubleHits: null } } };
    expect(patchOf(before, cleared)).toEqual(cleared);
    expect(patchOf(cleared, structuredClone(cleared))).toBeNull();
  });

  it('never reads a key the form does not hold as a change', () => {
    expect(patchOf({ ...saved, lockConfig: { autoLockEnabled: true } }, saved)).toBeNull();
  });
});
