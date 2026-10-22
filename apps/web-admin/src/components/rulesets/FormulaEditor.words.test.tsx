import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { FormulaEditor } from './FormulaEditor';
import { RulesetMatchFormatBox } from './RulesetMatchFormatBox';

/**
 * The formula editor's parse errors ("Empty formula", "Mismatched parentheses") and the
 * ruleset form's timer and scoring options ("Countdown", "Reverse (zero loses)") were English
 * written outside JSX, where the lint does not look: a French organiser read them in English.
 */
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the words of the ruleset editor', () => {
  it('says why a formula does not parse in the reader’s language', () => {
    act(() =>
      root.render(
        <I18nProvider locale="fr">
          <FormulaEditor value={null} onChange={() => undefined} />
        </I18nProvider>,
      ),
    );
    expect(container.textContent).toContain('Formule vide');
    expect(container.textContent).not.toContain('Empty formula');
  });

  it('names the timer and scoring options through the translator', () => {
    act(() =>
      root.render(
        <I18nProvider locale="fr">
          <RulesetMatchFormatBox
            own={{}}
            onChange={() => undefined}
            onValidity={() => undefined}
            hasMaxDoubles
          />
        </I18nProvider>,
      ),
    );
    const options = [...container.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual([
      'Compte à rebours',
      'Chronomètre croissant',
      'Normal',
      'Inversé (zéro perd)',
    ]);
  });
});
