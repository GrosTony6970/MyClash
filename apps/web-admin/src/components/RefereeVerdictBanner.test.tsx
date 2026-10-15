import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { RefereeConflictEntry } from '@/lib/referee-reasons';
import { RefereeVerdictBanner } from './RefereeVerdictBanner';

/**
 * A referee nobody named reaches the rule-8 banner with a blank name (X2: the server sends
 * a blank, never an id). The organiser must still read who to reassign.
 */
const CONFLICT: RefereeConflictEntry = {
  assignmentId: 'a-1',
  personId: 'gp-anon-4f2a',
  personName: '',
  unitId: 'pool-1',
  unitName: 'Longsword · Pool A',
  tournamentId: 't-1',
  role: 'arbitre_declarant',
  start: null,
  level: 'impossible',
  reasons: [],
};

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

describe('the referee verdict banner', () => {
  it('names a referee with no name "Unknown referee", never a blank or the id', async () => {
    await act(async () => {
      root.render(
        <I18nProvider locale="en">
          <RefereeVerdictBanner conflicts={[CONFLICT]} />
        </I18nProvider>,
      );
    });
    expect(container.querySelector('strong')?.textContent).toBe('Unknown referee');
    expect(container.textContent).not.toContain('gp-anon');
  });
});
