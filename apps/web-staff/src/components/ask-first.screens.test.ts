/**
 * The presses that ask first: the screens' side.
 *
 * web-staff has no React test setup, so the screens are read as text. These
 * pins hold the WIRING only; a live page proves what a tap does
 * (`tests/a11y/pad-list-card-asks-first.spec.ts`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');
const column = read('ScoringColumn.tsx');
const directCard = read('DirectCardPanel.tsx');
const question = read('AskFirstDialog.tsx');

describe('the question', () => {
  it('is the shared dialog, so Space leaves the clock alone, and Cancel leaves it', () => {
    expect(question).toMatch(/<Modal\s+open=\{open\}\s+onClose=\{onClose\}/);
  });

  it('puts Cancel first, so a Space after a slip carries out nothing', () => {
    const cancel = question.indexOf("{t('common.cancel')}");
    const yes = question.indexOf('{confirmLabel}');
    expect(cancel).toBeGreaterThan(0);
    expect(yes).toBeGreaterThan(cancel);
    expect(question).toMatch(/<>\s+<button\s+type="button"\s+onClick=\{onClose\}/);
  });

  it('has two buttons the size of a finger', () => {
    expect(question.match(/<button/g)).toHaveLength(2);
    expect(question.match(/min-h-\[44px\]/g)).toHaveLength(2);
  });
});

describe('a card of the penalty list', () => {
  it('goes through the question from both its doors: the pinned entries and the list', () => {
    expect(column.match(/onClick=\{\(\) => pickPenalty\(entry\)\}/g)).toHaveLength(2);
    expect(column).not.toContain('onClick={() => void submitPenalty(');
  });

  it('asks on the card the fighter will get, not on the entry', () => {
    expect(column).toMatch(
      /const card = resolveCard\(entry, registrationId\);\s+if \(cardAsksFirst\(card\)\) setAskedCard\(\{ entry, card \}\);\s+else void submitPenalty\(listedCard\(entry\)\);/,
    );
  });

  it('gives the card on a yes, and nothing on a Cancel', () => {
    expect(column).toMatch(
      /onClose=\{\(\) => setAskedCard\(null\)\}\s+onConfirm=\{\(\) => \{\s+const asked = askedCard;\s+setAskedCard\(null\);\s+if \(asked\) void submitPenalty\(listedCard\(asked\.entry\)\);/,
    );
  });
});

describe('a direct card', () => {
  it('asks by the same rule as a card of the list', () => {
    expect(directCard).toContain(
      'onPick={(card) => (cardAsksFirst(card) ? setConfirm(card) : void give(card))}',
    );
  });
});
