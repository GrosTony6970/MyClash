import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG, type TournamentScoringConfig } from '@myclash/types';
import { displayBody, displayForm } from './display-form';

describe('displayForm', () => {
  it("shows the pad's buttons in force, not a button list of its own", () => {
    const form = displayForm(DEFAULT_SCORING_CONFIG);
    expect(form.buttons.clean.map((b) => b.label)).toEqual(['+2', '+1']);
    expect(form.buttons.afterblow.map((b) => b.label)).toEqual(['2-1', '1-1']);
    expect(form.sideColors).toEqual({ red: 'red', blue: 'blue' });
    expect(form.quickPenalties).toEqual([]);
  });

  it('picks each button by name, so a key the editor does not know is never sent back', () => {
    const scoring = {
      ...DEFAULT_SCORING_CONFIG,
      buttons: {
        clean: [{ label: '+3', value: 3, visible: true, legacy: 'x' }],
        afterblow: [],
      },
    } as unknown as TournamentScoringConfig;
    expect(displayForm(scoring).buttons.clean).toEqual([{ label: '+3', value: 3, visible: true }]);
  });
});

describe('displayBody', () => {
  it('sends the display and the buttons under the scoring config', () => {
    const form = displayForm(DEFAULT_SCORING_CONFIG);
    expect(displayBody(form)).toEqual({
      scoringConfig: {
        display: { sideColors: form.sideColors, quickPenalties: [] },
        buttons: form.buttons,
      },
    });
  });
});
