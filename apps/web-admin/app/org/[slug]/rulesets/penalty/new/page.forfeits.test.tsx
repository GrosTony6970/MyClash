import type * as ApiClient from '@myclash/api-client';
import { CLUB_START_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  labelled,
  MARKER,
  openPenaltyPage,
  penaltyRow,
  save,
  typeInto,
  type OpenedPenaltyPage,
} from '../../../../../../src/components/rulesets/penalty-page.fixtures';
import AdminNewPenaltyRulesetPage from '../../../../../admin/rulesets/penalty/new/page';
import OrgNewPenaltyRulesetPage from './page';

/**
 * A new penalty ruleset carries its forfeit rules (operator rulings 63-76, 2026-10-20): a blank
 * one starts from the club start, "disqualify after" Off (ruling 67), and a copy keeps its
 * source's (ruling 75).
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

describe('a new penalty ruleset’s forfeit rules', () => {
  it('start from the club start', async () => {
    page = await openPenaltyPage(<OrgNewPenaltyRulesetPage />, ORG);

    await typeInto(labelled('Name'), 'House cards');
    await typeInto(labelled('Code'), 'house');
    await save();

    expect(page.saves).toHaveLength(1);
    expect(page.saves[0]?.body['forfeitRules']).toEqual(CLUB_START_FORFEIT_RULES);
  });

  it('start from the club start on the platform’s new page too', async () => {
    page = await openPenaltyPage(<AdminNewPenaltyRulesetPage />, {});

    await typeInto(labelled('Name'), 'Platform cards');
    await typeInto(labelled('Code'), 'platform');
    await save();

    expect(page.saves).toHaveLength(1);
    expect(page.saves[0]?.body['forfeitRules']).toEqual(CLUB_START_FORFEIT_RULES);
  });

  it('are the source’s on a copy', async () => {
    query.params = new URLSearchParams({ cloneFrom: 'pr-1' });
    page = await openPenaltyPage(<OrgNewPenaltyRulesetPage />, {
      ...ORG,
      '/api/v1/penalty-rulesets/pr-1': penaltyRow(MARKER),
    });

    await typeInto(labelled('Code'), 'house-copy');
    await save();

    expect(page.saves[0]?.body['forfeitRules']).toEqual(MARKER);
  });
});
