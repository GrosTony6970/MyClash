import { describe, expect, it } from 'vitest';
import { computeWizardStep, type WizardTournamentInput } from './compute-wizard-step';

function row(overrides: Partial<WizardTournamentInput>): WizardTournamentInput {
  return {
    id: 't-1',
    name: 'T',
    slug: 't',
    ruleset_code: 'TF_v1',
    ruleset_version: '1',
    scoring_config: null,
    ruleset_config: null,
    lock_config: null,
    status: 'draft',
    ...overrides,
  };
}

describe('computeWizardStep', () => {
  it('returns 2 when basics are set but match format is not', () => {
    expect(computeWizardStep(row({}))).toBe(2);
  });

  it('returns 3 when match format is set but display buttons are not', () => {
    expect(computeWizardStep(row({ scoring_config: { pointCap: 5 } }))).toBe(3);
  });

  it('returns 4 when display is set but advanced is not', () => {
    expect(
      computeWizardStep(
        row({ scoring_config: { pointCap: 5, buttons: { clean: [{ label: 'A' }] } } }),
      ),
    ).toBe(4);
  });

  it('returns null when all four steps are complete', () => {
    expect(
      computeWizardStep(
        row({
          scoring_config: { pointCap: 5, buttons: { clean: [{ label: 'A' }] } },
          ruleset_config: { winBonus: 5 },
        }),
      ),
    ).toBe(null);
  });

  it('returns 3 when buttons.clean exists as an empty array', () => {
    expect(
      computeWizardStep(row({ scoring_config: { pointCap: 5, buttons: { clean: [] } } })),
    ).toBe(3);
  });

  it('returns 1 when basics are missing (defensive)', () => {
    expect(computeWizardStep(row({ name: '' }))).toBe(1);
  });
});
