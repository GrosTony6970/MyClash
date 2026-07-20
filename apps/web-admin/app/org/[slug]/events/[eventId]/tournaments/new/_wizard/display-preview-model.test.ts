import { describe, expect, it } from 'vitest';
import { displayPreviewModel } from './display-preview-model';

describe('displayPreviewModel', () => {
  it('resolves each side colour token to its shared palette style', () => {
    const m = displayPreviewModel({
      sideColors: { red: 'black', blue: 'green' },
      buttons: { clean: [], afterblow: [] },
      rulesetCode: 'TF_v1',
    });
    expect(m.red.token).toBe('black');
    expect(m.blue.token).toBe('green');
    expect(m.red.panel).toMatch(/^#/); // hex from the same palette the scoreboard uses
  });

  it('keeps only visible buttons', () => {
    const m = displayPreviewModel({
      sideColors: { red: 'red', blue: 'blue' },
      buttons: {
        clean: [
          { label: '+1', value: 1, visible: true },
          { label: 'hidden', value: 2, visible: false },
        ],
        afterblow: [],
      },
      rulesetCode: 'TF_v1',
    });
    expect(m.cleanButtons.map((b) => b.label)).toEqual(['+1']);
  });

  it('shows the afterblow buttons that exist, whatever the ruleset is called', () => {
    // This test used to assert the opposite ("only for the TF_v1 ruleset"),
    // pinning the hardcoding rather than a requirement. Re-deriving visibility
    // from the ruleset CODE made the preview disagree with the editor directly
    // above it and with the referee's pad, hiding a custom ruleset's real
    // afterblow buttons. Whether a ruleset HAS afterblow is now the ruleset's
    // own answer, and a ruleset without it simply has no buttons here.
    const afterblow = [{ label: 'AB', attackerPts: 1, defenderPts: 1, visible: true }];
    const base = { sideColors: { red: 'red', blue: 'blue' }, buttons: { clean: [], afterblow } };
    expect(displayPreviewModel({ ...base, rulesetCode: 'TF_v1' }).afterblowButtons).toHaveLength(1);
    expect(
      displayPreviewModel({ ...base, rulesetCode: 'custom_house' }).afterblowButtons,
    ).toHaveLength(1);
  });

  it('shows none when the ruleset has no afterblow buttons', () => {
    const model = displayPreviewModel({
      sideColors: { red: 'red', blue: 'blue' },
      buttons: { clean: [], afterblow: [] },
      rulesetCode: 'Generic_PointsCap',
    });
    expect(model.afterblowButtons).toHaveLength(0);
  });

  it('still hides a button the operator marked invisible', () => {
    const model = displayPreviewModel({
      sideColors: { red: 'red', blue: 'blue' },
      buttons: {
        clean: [],
        afterblow: [
          { label: 'shown', attackerPts: 2, defenderPts: 1, visible: true },
          { label: 'hidden', attackerPts: 1, defenderPts: 1, visible: false },
        ],
      },
      rulesetCode: 'custom_house',
    });
    expect(model.afterblowButtons.map((b) => b.label)).toEqual(['shown']);
  });
});
