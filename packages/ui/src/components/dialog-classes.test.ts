import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DIALOG_CANCEL, dialogConfirmClasses } from './dialog-classes';

/**
 * The two question dialogs read the theme (raw colours are held by the lint rule, now that both
 * left its debt list), and their buttons are touch-sized: the pad shows them to an official
 * with a glove on. Ruled 2026-10-15: the danger fill is the theme's danger, not the old red-800.
 */
describe('the buttons of the shared question dialogs', () => {
  it('are 44px tall, both of them', () => {
    expect(DIALOG_CANCEL).toContain('min-h-[44px]');
    expect(dialogConfirmClasses(true)).toContain('min-h-[44px]');
    expect(dialogConfirmClasses(false)).toContain('min-h-[44px]');
  });

  it('fill a destructive question with the danger pair, and any other with the strong pair', () => {
    expect(dialogConfirmClasses(true)).toContain('bg-danger text-danger-foreground');
    expect(dialogConfirmClasses(false)).toContain('bg-strong text-strong-foreground');
  });

  it('are the classes both dialogs draw', () => {
    for (const file of ['ConfirmDialog.tsx', 'PromptDialog.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source, file).toContain('className={DIALOG_CANCEL}');
      expect(source, file).toContain('className={dialogConfirmClasses(danger)}');
      expect(source, file).toContain('className={DIALOG_CARD}');
    }
  });
});
