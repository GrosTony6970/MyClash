import type * as ApiClient from '@myclash/api-client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  labelled,
  openPenaltyPage,
  save,
  typeInto,
  type OpenedPenaltyPage,
} from '../../../../../../src/components/rulesets/penalty-page.fixtures';
import {
  FORK_TF_CONFIG,
  tfForkRow,
} from '../../../../../../src/components/rulesets/scoring-page.fixtures';
import OrgNewScoringRulesetPage from './page';

/**
 * An organisation's new scoring ruleset stores only its own values (operator rulings 59 and 136):
 * a blank one none, and a copy of a club's TF_v1 copy its source's win bonus, targets and match
 * format. The copy used to post the editor's win bonus 3; the blank one its 5 / 180.
 */
const query = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club' }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => query.params,
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const ORG = { '/api/v1/organizations/slug/club': { id: 'org-1' } };

let page: OpenedPenaltyPage;
afterEach(() => {
  page.unmount();
  query.params = new URLSearchParams();
});

describe('an organisation’s new scoring ruleset', () => {
  it('stores no match format when the box is left alone', async () => {
    page = await openPenaltyPage(<OrgNewScoringRulesetPage />, ORG);

    await typeInto(labelled('Name'), 'House pools');
    const victories = [...document.querySelectorAll('button')].find(
      (each) => each.textContent?.trim() === '+ Victories',
    );
    if (!victories) throw new Error('no + Victories button');
    await act(async () => victories.click());
    await save();

    const create = page.saves.find((s) => s.path === '/api/v1/organizations/org-1/custom-rulesets');
    expect(create?.body['matchFormatDefaults']).toBeNull();
  });
});

describe('a copy of a club’s TF_v1 copy', () => {
  it('posts the source’s own tf_config, win bonus and targets included', async () => {
    query.params = new URLSearchParams({ cloneFrom: 'rs-fork' });
    page = await openPenaltyPage(<OrgNewScoringRulesetPage />, {
      ...ORG,
      '/api/v1/organizations/org-1/custom-rulesets': [tfForkRow()],
    });

    await save();

    const fork = page.saves.find(
      (s) => s.path === '/api/v1/organizations/org-1/custom-rulesets/fork',
    );
    expect(fork?.body['tfConfig']).toEqual(FORK_TF_CONFIG);
    expect(fork?.body['targets']).toEqual(FORK_TF_CONFIG.targets);
  });
});
