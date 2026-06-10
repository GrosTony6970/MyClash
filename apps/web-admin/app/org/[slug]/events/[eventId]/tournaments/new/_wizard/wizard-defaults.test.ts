import { describe, expect, it } from 'vitest';
import { pickWizardDefaults } from './wizard-defaults';

describe('pickWizardDefaults', () => {
  it('picks the TF_v1 ruleset with its real version from a mixed list', () => {
    const { ruleset } = pickWizardDefaults(
      [
        { code: 'Generic_PointsCap', version: '1.0.0' },
        { code: 'TF_v1', version: '1.0.0' },
      ],
      [],
    );
    expect(ruleset).toEqual({ code: 'TF_v1', version: '1.0.0' });
  });

  it('returns a null ruleset when no TF row is present', () => {
    const { ruleset } = pickWizardDefaults([{ code: 'Generic_PointsCap', version: '1.0.0' }], []);
    expect(ruleset).toBeNull();
  });

  it('picks the built-in penalty ruleset id', () => {
    const { penaltyId } = pickWizardDefaults(
      [],
      [{ id: 'own-1' }, { id: 'builtin-1', built_in: true }],
    );
    expect(penaltyId).toBe('builtin-1');
  });

  it('falls back to the ffamhe_tf_2026 code when no built_in flag is present', () => {
    const { penaltyId } = pickWizardDefaults(
      [],
      [{ id: 'own-1' }, { id: 'ffamhe-1', code: 'ffamhe_tf_2026' }],
    );
    expect(penaltyId).toBe('ffamhe-1');
  });

  it('returns a null penaltyId when neither a built-in nor the ffamhe code matches', () => {
    const { penaltyId } = pickWizardDefaults([], [{ id: 'own-1' }]);
    expect(penaltyId).toBeNull();
  });
});
