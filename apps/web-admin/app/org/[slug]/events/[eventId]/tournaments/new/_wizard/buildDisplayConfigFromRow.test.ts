import { describe, expect, it } from 'vitest';
import {
  buildDisplayConfigFromRow,
  DISPLAY_DEFAULTS,
  type DisplayState,
} from './buildDisplayConfigFromRow';

describe('buildDisplayConfigFromRow', () => {
  it('returns defaults when the row is empty', () => {
    expect(buildDisplayConfigFromRow({}, DISPLAY_DEFAULTS)).toEqual(DISPLAY_DEFAULTS);
  });

  it('overlays sideColors and button arrays from the row', () => {
    const out = buildDisplayConfigFromRow(
      {
        display: { sideColors: { red: 'amber', blue: 'teal' } },
        buttons: {
          clean: [{ label: 'X', value: 2, visible: true }],
          afterblow: [{ label: 'Y', attackerPts: 1, defenderPts: 0, visible: false }],
        },
      },
      DISPLAY_DEFAULTS,
    );
    expect(out.sideColors).toEqual({ red: 'amber', blue: 'teal' });
    expect(out.buttons.clean).toEqual([{ label: 'X', value: 2, visible: true }]);
    expect(out.buttons.afterblow).toEqual([
      { label: 'Y', attackerPts: 1, defenderPts: 0, visible: false },
    ]);
  });

  it('discards unknown keys in sideColors and unknown button fields', () => {
    const out = buildDisplayConfigFromRow(
      {
        display: {
          sideColors: { red: 'red', blue: 'blue', gold: 'amber' },
          theme: 'dark',
        },
        buttons: {
          clean: [{ label: 'P', value: 1, visible: true, hotkey: 'q' }],
          afterblow: [
            { label: 'A', attackerPts: 1, defenderPts: 1, visible: true, tier: 'legacy' },
          ],
        },
        legacyKey: 'leak',
      } as unknown as Partial<DisplayState> & Record<string, unknown>,
      DISPLAY_DEFAULTS,
    );

    const json = JSON.stringify(out);
    expect(json).not.toContain('gold');
    expect(json).not.toContain('hotkey');
    expect(json).not.toContain('legacyKey');
    expect(json).not.toContain('"theme"');
    expect(json).not.toContain('"tier"');
    expect(Object.keys(out.sideColors).sort()).toEqual(['blue', 'red']);
    expect(Object.keys(out.buttons.clean[0]!).sort()).toEqual(['label', 'value', 'visible']);
    expect(Object.keys(out.buttons.afterblow[0]!).sort()).toEqual(
      ['attackerPts', 'defenderPts', 'label', 'visible'].sort(),
    );
  });
});
