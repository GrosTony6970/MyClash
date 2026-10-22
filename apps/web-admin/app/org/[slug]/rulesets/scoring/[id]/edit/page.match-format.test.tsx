import type * as ApiClient from '@myclash/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  labelled,
  openPenaltyPage,
  save,
  typeInto,
  type OpenedPenaltyPage,
} from '../../../../../../../src/components/rulesets/penalty-page.fixtures';
import {
  BEST_OF_MARKER,
  FORK_TF_CONFIG,
  formulaRow,
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

describe('an organisation’s formula ruleset', () => {
  it('saves the changed pool time beside its own stored values, and nothing else', async () => {
    await open('rs-formula', formulaRow());

    await typeInto(labelled('Time limit · pool'), '150');
    await save();

    expect(patchOf('rs-formula')?.body['matchFormatDefaults']).toEqual({
      pointCap: 7,
      bestOf: BEST_OF_MARKER,
      timeLimitsSeconds: { pool: 150 },
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
