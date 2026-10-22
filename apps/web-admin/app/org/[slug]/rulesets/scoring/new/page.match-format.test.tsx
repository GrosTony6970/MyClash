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
  formulaRow,
  pointsCapRow,
  tfForkRow,
  VICTORIES,
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

/** Authors the score formula `victories` with the formula editor's variable button. */
async function pressVictories(): Promise<void> {
  const victories = [...document.querySelectorAll('button')].find(
    (each) => each.textContent?.trim() === '+ Victories',
  );
  if (!victories) throw new Error('no + Victories button');
  await act(async () => victories.click());
}

let page: OpenedPenaltyPage;
afterEach(() => {
  page.unmount();
  query.params = new URLSearchParams();
});

describe('an organisation’s new scoring ruleset', () => {
  it('stores no match format when the box is left alone', async () => {
    page = await openPenaltyPage(<OrgNewScoringRulesetPage />, ORG);

    await typeInto(labelled('Name'), 'House pools');
    await pressVictories();
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

describe('a copy of Points cap (operator ruling 133)', () => {
  it('is a formula ruleset of the club’s own, starting from Points cap’s match format', async () => {
    query.params = new URLSearchParams({ cloneFrom: 'rs-pc' });
    page = await openPenaltyPage(<OrgNewScoringRulesetPage />, {
      ...ORG,
      '/api/v1/organizations/org-1/custom-rulesets': [
        pointsCapRow({ matchFormat: { timeLimitsSeconds: { pool: 120 } } }),
      ],
    });

    await pressVictories();
    await save();

    // The live preview's validate call is no save.
    const writes = page.saves.filter((s) => !s.path.endsWith('/validate'));
    expect(writes.map((s) => s.path)).toEqual(['/api/v1/organizations/org-1/custom-rulesets']);
    const create = writes[0]?.body;
    expect(create?.['scoreFormula']).toEqual(VICTORIES);
    expect(create?.['matchFormatDefaults']).toEqual({ timeLimitsSeconds: { pool: 120 } });
    expect(create?.['tiebreakers']).toEqual([{ variable: 'victories', direction: 'desc' }]);
    expect(create?.['targets']).toEqual([{ name: 'Hit', value: 1 }]);
    expect(create).not.toHaveProperty('baseCode');
  });
});

describe('a copy of a club’s formula ruleset', () => {
  it('leaves its empty tie-breaker list empty', async () => {
    query.params = new URLSearchParams({ cloneFrom: 'rs-formula' });
    page = await openPenaltyPage(<OrgNewScoringRulesetPage />, {
      ...ORG,
      '/api/v1/organizations/org-1/custom-rulesets': [{ ...formulaRow(), tiebreakers: [] }],
    });

    await save();

    const create = page.saves.find((s) => s.path === '/api/v1/organizations/org-1/custom-rulesets');
    expect(create?.body['tiebreakers']).toEqual([]);
  });
});
