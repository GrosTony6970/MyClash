import { describe, expect, it } from 'vitest';
import { computeWizardStep, type WizardTournamentInput } from './compute-wizard-step';

function row(overrides: Partial<WizardTournamentInput>): WizardTournamentInput {
  return {
    id: 't-1',
    name: 'T',
    slug: 't',
    ruleset_code: 'TF_v1',
    ruleset_version: '1',
    scoring_config_json: null,
    ruleset_config: null,
    lock_config_json: null,
    status: 'draft',
    ...overrides,
  };
}

describe('computeWizardStep', () => {
  // The function reads `pointCap` from `ruleset_config.matchFormat` and
  // `buttons.clean` from `scoring_config_json` — these are the real
  // column names on the tournaments row returned by GET
  // /api/v1/tournaments/:id. Stubs below mirror that shape so the
  // tests catch a real-world regression instead of a fixture-only one.

  it('returns 2 when basics are set but match format is not', () => {
    expect(computeWizardStep(row({}))).toBe(2);
  });

  it('returns 3 when match format is set but display buttons are not', () => {
    expect(computeWizardStep(row({ ruleset_config: { matchFormat: { pointCap: 5 } } }))).toBe(3);
  });

  // NOTE: "returns 4" (display done, advanced not) is currently unreachable
  // because matchFormat (Step 2's payload) is stored INSIDE ruleset_config,
  // so the moment Step 2 completes, `Object.keys(ruleset_config).length > 0`
  // and the Step-4 heuristic marks advanced as touched. That's a pre-existing
  // routing bug — out of scope for the buttons-persistence fix.

  it('returns null when all four steps are complete (lock_config_json non-empty)', () => {
    expect(
      computeWizardStep(
        row({
          ruleset_config: { matchFormat: { pointCap: 5 } },
          scoring_config_json: { buttons: { clean: [{ label: 'A' }] } },
          lock_config_json: { autoLockEnabled: true },
        }),
      ),
    ).toBe(null);
  });

  it('returns 3 when buttons.clean exists as an empty array', () => {
    expect(
      computeWizardStep(
        row({
          ruleset_config: { matchFormat: { pointCap: 5 } },
          scoring_config_json: { buttons: { clean: [] } },
        }),
      ),
    ).toBe(3);
  });

  it('returns 1 when basics are missing (defensive)', () => {
    expect(computeWizardStep(row({ name: '' }))).toBe(1);
  });

  // Regression for the production bug: GET /api/v1/tournaments/:id returns
  // the raw row from `select('*')`, so the response carries the JSONB
  // columns with their real names — `scoring_config_json` and
  // `lock_config_json`, not `scoring_config` / `lock_config`. Before the
  // fix the function read the (non-existent) `scoring_config` field, so
  // a tournament whose Step 3 was saved still bounced back to Step 3.
  it("reads the API row's `scoring_config_json` field, not `scoring_config`", () => {
    expect(
      computeWizardStep(
        row({
          ruleset_config: { matchFormat: { pointCap: 5 } },
          scoring_config_json: { buttons: { clean: [{ label: 'A' }] } },
          lock_config_json: { autoLockEnabled: true },
        }),
      ),
    ).toBe(null);
  });
});
