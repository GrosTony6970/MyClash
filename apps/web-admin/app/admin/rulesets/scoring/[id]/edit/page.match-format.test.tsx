import type * as ApiClient from '@myclash/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openPenaltyPage,
  save,
  typeInto,
  type OpenedPenaltyPage,
} from '../../../../../../src/components/rulesets/penalty-page.fixtures';
import { tfV1Row } from '../../../../../../src/components/rulesets/scoring-page.fixtures';
import EditRulesetPage from './page';

/**
 * An untouched Save of TF_v1 keeps its row as it is (operator rulings 59 and 136, 2026-10-20/22):
 * the platform admin's one change stays, and nothing the engine already says is written beside it.
 * It used to write the win bonus, the targets and the whole match format box on every Save. A
 * changed target is written to the flat column and to tf_config.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'rs-tf' }),
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

describe('the platform’s TF_v1 editor', () => {
  it('sends the stored tf_config back unchanged on an untouched Save', async () => {
    page = await openPenaltyPage(<EditRulesetPage />, {
      '/api/v1/admin/custom-rulesets/rs-tf': tfV1Row(),
      '/api/v1/admin/custom-rulesets/rs-tf/versions': [],
    });

    await save();

    const patch = page.saves.find((s) => s.path === '/api/v1/admin/custom-rulesets/rs-tf');
    expect(patch?.body['tfConfig']).toEqual({ matchFormat: { timeLimitsSeconds: { pool: 120 } } });
    expect(patch?.body).not.toHaveProperty('targets');
  });

  it('writes a changed target to the flat column and to tf_config, the legacy pair too', async () => {
    page = await openPenaltyPage(<EditRulesetPage />, {
      '/api/v1/admin/custom-rulesets/rs-tf': tfV1Row(),
      '/api/v1/admin/custom-rulesets/rs-tf/versions': [],
    });
    const deepName = document.querySelector<HTMLInputElement>('input[aria-label="Target name"]');
    const deepValue = deepName?.nextElementSibling;
    if (!(deepValue instanceof HTMLInputElement)) throw new Error('no target value field');

    await typeInto(deepValue, '4');
    await save();

    const patch = page.saves.find((s) => s.path === '/api/v1/admin/custom-rulesets/rs-tf');
    const targets = [
      { name: 'Deep', value: 4 },
      { name: 'Shallow', value: 1 },
    ];
    expect(patch?.body['targets']).toEqual(targets);
    expect(patch?.body['tfConfig']).toMatchObject({
      targets,
      targetValues: { deepTarget: 4, shallowTarget: 1 },
    });
  });
});
