/**
 * The tablet does not sleep while a bout is on its screen (quick win P7). The
 * rules of the lock are in `packages/ui` (`wake-lock.test.ts`), the live proof
 * in `tests/a11y/pad-stays-awake.spec.ts`. This pins WHICH screen holds it: the
 * bout screen, and no other screen of the pad.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAD = join(__dirname, '..', '..');

/** Every source file of the pad, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the wake lock of the pad', () => {
  it('is held by the bout screen', () => {
    const view = readFileSync(join(__dirname, 'MatchView.tsx'), 'utf8');
    expect(view).toMatch(/const \{ t, locale \} = useI18n\(\);\s+\/\/[^\n]+\n\s+useWakeLock\(\);/);
  });

  it('is held by no other screen', () => {
    const holders = [...sources(join(PAD, 'src')), ...sources(join(PAD, 'app'))].filter((path) =>
      readFileSync(path, 'utf8').includes('useWakeLock('),
    );
    expect(holders).toEqual([join(__dirname, 'MatchView.tsx')]);
  });
});
