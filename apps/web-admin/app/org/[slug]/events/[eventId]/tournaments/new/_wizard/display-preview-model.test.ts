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

  it('shows afterblow buttons only for the TF_v1 ruleset', () => {
    const afterblow = [{ label: 'AB', attackerPts: 1, defenderPts: 1, visible: true }];
    const base = { sideColors: { red: 'red', blue: 'blue' }, buttons: { clean: [], afterblow } };
    expect(displayPreviewModel({ ...base, rulesetCode: 'TF_v1' }).afterblowButtons).toHaveLength(1);
    expect(displayPreviewModel({ ...base, rulesetCode: 'OTHER' }).afterblowButtons).toHaveLength(0);
  });
});
