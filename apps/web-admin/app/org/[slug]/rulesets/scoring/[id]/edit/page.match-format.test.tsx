import type * as ApiClient from '@myclash/api-client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  choose,
  labelled,
  openPenaltyPage,
  save,
  typeInto,
  type OpenedPenaltyPage,
} from '../../../../../../../src/components/rulesets/penalty-page.fixtures';
import {
  FORK_TF_CONFIG,
  formulaRow,
  HIDDEN_MARKER,
  tfForkRow,
} from '../../../../../../../src/components/rulesets/scoring-page.fixtures';
import OrgEditScoringRulesetPage from './page';

/**
 * A Save stores only the field the organiser changed (operator rulings 59 and 136, 2026-10-20/22):
 * the other fields stay empty and follow the engine, what the box does not show is kept as stored,
 * and a TF_v1 copy's targets are written only when they changed.
 */
const route = vi.hoisted(() => ({ id: 'rs-formula' }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', id: route.id }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

let page: OpenedPenaltyPage;
afterEach(() => page.unmount());

async function open(id: string, row: Record<string, unknown>) {
  route.id = id;
  page = await openPenaltyPage(<OrgEditScoringRulesetPage />, {
    '/api/v1/organizations/slug/club': { id: 'org-1' },
    '/api/v1/organizations/org-1/custom-rulesets': [row],
  });
}

const patchOf = (id: string) =>
  page.saves.find((s) => s.path === `/api/v1/organizations/org-1/custom-rulesets/${id}`);

/** Picks `value` in the select labelled `words`. */
const pick = (words: string, value: string) =>
  choose(labelled(words) as unknown as HTMLSelectElement, value);

/** Presses the Reset beside the field labelled `words`. */
async function resetOf(words: string): Promise<void> {
  const head = labelled(words).previousElementSibling;
  const reset = [...(head?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === 'Reset',
  );
  if (!reset) throw new Error(`no Reset beside ${words}`);
  await act(async () => reset.click());
}

describe('an organisation’s formula ruleset', () => {
  it('saves the changed pool time beside its own stored values, the hidden level chain included', async () => {
    await open('rs-formula', formulaRow());

    await typeInto(labelled('Time limit · pool'), '150');
    await save();

    expect(patchOf('rs-formula')?.body['matchFormatDefaults']).toEqual({
      pointCap: 7,
      bestOf: { pool: 3 },
      ...HIDDEN_MARKER,
      timeLimitsSeconds: { pool: 150 },
    });
  });

  it('shows its own best-of and saves a picked one beside it, as numbers', async () => {
    await open('rs-formula', formulaRow());
    const shown = labelled('Pool best-of') as unknown as HTMLSelectElement;
    expect(shown.selectedOptions[0]?.textContent).toBe('Best of 3');

    await pick('Bracket best-of', '5');
    await save();

    expect(patchOf('rs-formula')?.body['matchFormatDefaults']).toMatchObject({
      bestOf: { pool: 3, bracket: 5 },
    });
  });

  it('drops a reset best-of from the Save', async () => {
    await open('rs-formula', formulaRow());

    await resetOf('Pool best-of');
    await save();

    expect(patchOf('rs-formula')?.body['matchFormatDefaults']).toEqual({
      pointCap: 7,
      ...HIDDEN_MARKER,
    });
  });
});

describe('an organisation’s TF_v1 copy', () => {
  it('writes its tf_config back as stored on an untouched Save, with no flat targets', async () => {
    await open('rs-fork', tfForkRow());

    await save();

    expect(patchOf('rs-fork')?.body['tfConfig']).toEqual(FORK_TF_CONFIG);
    expect(patchOf('rs-fork')?.body).not.toHaveProperty('targets');
  });

  it('writes a picked best-of to its tf_config match format', async () => {
    await open('rs-fork', tfForkRow());

    await pick('Bracket best-of', '5');
    await save();

    expect(patchOf('rs-fork')?.body['tfConfig']).toMatchObject({
      matchFormat: { pointCap: 7, bestOf: { bracket: 5 } },
    });
  });

  it('writes a changed target to the flat column and to tf_config', async () => {
    await open('rs-fork', tfForkRow());
    const headName = document.querySelector<HTMLInputElement>('input[aria-label="Target name"]');
    const headValue = headName?.nextElementSibling;
    if (!(headValue instanceof HTMLInputElement)) throw new Error('no target value field');

    await typeInto(headValue, '4');
    await save();

    const targets = [
      { ...FORK_TF_CONFIG.targets[0]!, value: 4 },
      ...FORK_TF_CONFIG.targets.slice(1),
    ];
    expect(patchOf('rs-fork')?.body['targets']).toEqual(targets);
    expect(patchOf('rs-fork')?.body['tfConfig']).toMatchObject({
      targets,
      targetValues: { deepTarget: 4, shallowTarget: 2 },
    });
  });
});
