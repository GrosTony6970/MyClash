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

  // The NOTE that used to live here recorded that "returns 4" was unreachable,
  // because matchFormat lives inside ruleset_config and that blob is seeded at
  // create. That is now fixed by recording the step rather than inferring it —
  // see the `wizard_step` block at the bottom of this file.

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

// ── recorded progress (migration 0144) ───────────────────────────────────────
// The heuristic above could not distinguish "the operator completed this step"
// from "the server backfilled this blob", because the server writes complete
// blobs: ruleset_config at create, and the whole scoring config on any PATCH.

describe('computeWizardStep — recorded wizard_step', () => {
  it('resumes on the step after the one recorded', () => {
    expect(computeWizardStep(row({ wizard_step: 1 }))).toBe(2);
    expect(computeWizardStep(row({ wizard_step: 2 }))).toBe(3);
    expect(computeWizardStep(row({ wizard_step: 3 }))).toBe(4);
  });

  it('reports complete once step 4 is recorded', () => {
    expect(computeWizardStep(row({ wizard_step: 4 }))).toBe(null);
  });

  it('sends a freshly created tournament to step 2, not to "complete"', () => {
    // The regression seeding would otherwise cause: create writes
    // ruleset_config (so pointCap exists) and, after the named-targets work,
    // scoring_config_json.buttons too — which the old heuristic read as every
    // step being done.
    expect(
      computeWizardStep(
        row({
          wizard_step: 1,
          ruleset_config: { matchFormat: { pointCap: 5 } },
          scoring_config_json: { buttons: { clean: [{ label: '+2' }] } },
        }),
      ),
    ).toBe(2);
  });

  it('still offers step 3 after step 2 saved, despite the backfilled buttons', () => {
    // Step 2 PATCHes { afterblowMode }, and normalizeTournamentScoringConfig
    // backfills buttons AND display from DEFAULT_SCORING_CONFIG. The old
    // heuristic read that as Step 3 being finished.
    expect(
      computeWizardStep(
        row({
          wizard_step: 2,
          ruleset_config: { matchFormat: { pointCap: 5 } },
          scoring_config_json: {
            buttons: { clean: [{ label: '+2' }], afterblow: [{ label: '2-1' }] },
            display: { sideColors: { red: 'red', blue: 'blue' } },
          },
        }),
      ),
    ).toBe(3);
  });

  it('reaches step 4, which the heuristic alone never could', () => {
    expect(
      computeWizardStep(
        row({
          wizard_step: 3,
          ruleset_config: { matchFormat: { pointCap: 5 } },
          scoring_config_json: { buttons: { clean: [{ label: '+2' }] } },
        }),
      ),
    ).toBe(4);
  });

  it('falls back to the heuristic for rows predating the column', () => {
    // Nothing changes for a draft already in flight when the migration lands.
    expect(computeWizardStep(row({ wizard_step: null }))).toBe(2);
    expect(
      computeWizardStep(
        row({ wizard_step: undefined, ruleset_config: { matchFormat: { pointCap: 5 } } }),
      ),
    ).toBe(3);
  });

  it('still checks basics first — a half-created row goes to step 1', () => {
    expect(computeWizardStep(row({ wizard_step: 4, name: '' }))).toBe(1);
  });
});
