/**
 * D is the Double button and U is "Undo last entry" (quick win P19; operator,
 * 2026-10-12). A key presses its button, so it does nothing the screen says it
 * cannot. The live proof is `tests/a11y/pad-letter-keys.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { en, fr } from '@myclash/i18n';
import { isPadLetter, PAD_KEYS, pressButtonOf } from './pad-keys';

const plain = { ctrlKey: false, metaKey: false, altKey: false };
const component = (name: string) => readFileSync(join(__dirname, '..', 'components', name), 'utf8');

describe('a letter key of the pad', () => {
  // The place of the key, not its letter: the same on an AZERTY keyboard.
  it('is D or U, by the place of the key', () => {
    expect(PAD_KEYS).toEqual({ double: 'KeyD', undo: 'KeyU' });
    expect(isPadLetter({ code: 'KeyD', ...plain })).toBe(true);
    expect(isPadLetter({ code: 'KeyU', ...plain })).toBe(true);
  });

  it.each(['Space', 'KeyZ', 'KeyW', 'Enter', 'Escape'])('is not %s', (code) => {
    expect(isPadLetter({ code, ...plain })).toBe(false);
  });

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)('is not D with %s', (modifier) => {
    expect(isPadLetter({ code: 'KeyD', ...plain, [modifier]: true })).toBe(false);
  });
});

describe('the press of a letter key', () => {
  it('presses the button that declares the key', () => {
    const click = vi.fn();
    const asked = vi.fn(() => ({ disabled: false, click }));
    expect(pressButtonOf('KeyD', { querySelector: asked as never })).toBe(true);
    expect(asked).toHaveBeenCalledWith('button[data-pad-key="KeyD"]');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the button is disabled', () => {
    const click = vi.fn();
    const asked = vi.fn(() => ({ disabled: true, click }));
    expect(pressButtonOf('KeyU', { querySelector: asked as never })).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('does nothing when the button is not on the screen', () => {
    expect(pressButtonOf('KeyU', { querySelector: (() => null) as never })).toBe(false);
  });
});

describe('the bout screen', () => {
  const view = component('MatchView.tsx');
  const controls = component('ScoringCenterControls.tsx');

  it('gives each key to its button', () => {
    expect(controls).toMatch(
      /onClick=\{\(\) => submit\.submitDouble\(\)\}\s+data-pad-key=\{PAD_KEYS\.double\}/,
    );
    expect(controls).toMatch(/onClick=\{undo\.undo\}\s+data-pad-key=\{PAD_KEYS\.undo\}/);
    expect(controls.match(/data-pad-key=/g)).toHaveLength(2);
  });

  // The guards of Space come first: a repeat, a field, the drawer, a locked bout, a dialog.
  it('reads a letter key after every guard of Space, and before the clock', () => {
    const guard = view.indexOf(
      'if (document.querySelector(\'[role="dialog"][aria-modal="true"]\')) return;',
    );
    const letter = view.indexOf('if (isPadLetter(e)) {');
    const clock = view.indexOf("const status = boutClock?.status ?? 'idle';");
    expect(guard).toBeGreaterThan(-1);
    expect(letter).toBeGreaterThan(guard);
    expect(clock).toBeGreaterThan(letter);
    expect(view).toContain("if (e.code !== 'Space' && !isPadLetter(e)) return;");
    expect(view).toMatch(
      /if \(isPadLetter\(e\)\) \{\s+if \(pressButtonOf\(e\.code, document\)\) e\.preventDefault\(\);\s+return;\s+\}/,
    );
  });

  it('lists the three keys under the clock, in both languages', () => {
    expect(controls).toContain("{t('scoring.lice.keysHint')}");
    for (const hint of [en.scoring.lice.keysHint, fr.scoring.lice.keysHint]) {
      expect(hint).toMatch(/\bD\b/);
      expect(hint).toMatch(/\bU\b/);
    }
    expect(en.scoring.lice.keysHint).toMatch(/Space/);
    expect(fr.scoring.lice.keysHint).toMatch(/Espace/);
  });
});
