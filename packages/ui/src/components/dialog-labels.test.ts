import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConfirmDialogProps } from './ConfirmDialog';
import type { PromptDialogProps, PromptOptions } from './PromptDialog';
import type { ConfirmOptions } from './useConfirm';

/**
 * The dialogs have no English "Confirm" / "Cancel" of their own (X4, moved from push 3): a
 * French organiser read English buttons on every question that passed no words. Both words
 * are required, so a caller that forgets one does not compile (the typecheck holds the
 * `@ts-expect-error` lines below), and no default may come back into the source.
 */
// @ts-expect-error a question with no words for its buttons does not compile
const confirmWithoutWords: ConfirmOptions = { title: 'Remove?' };
// @ts-expect-error a prompt with no words for its buttons does not compile
const promptWithoutWords: PromptOptions = { title: 'Why?' };
// @ts-expect-error the cancel word alone is not enough
const confirmWithoutCancel: Pick<ConfirmDialogProps, 'confirmLabel' | 'cancelLabel'> = {
  confirmLabel: 'Supprimer',
};
const promptWords: Pick<PromptDialogProps, 'confirmLabel' | 'cancelLabel'> = {
  confirmLabel: 'Envoyer',
  cancelLabel: 'Annuler',
};

describe('the dialogs’ button words', () => {
  it('come from the caller only', () => {
    expect([
      confirmWithoutWords,
      promptWithoutWords,
      confirmWithoutCancel,
      promptWords,
    ]).toHaveLength(4);
    for (const file of ['ConfirmDialog.tsx', 'PromptDialog.tsx', 'useConfirm.tsx']) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source, file).not.toMatch(/Label = '/);
      expect(source, file).not.toMatch(/'(Confirm|Cancel)'/);
    }
  });
});
