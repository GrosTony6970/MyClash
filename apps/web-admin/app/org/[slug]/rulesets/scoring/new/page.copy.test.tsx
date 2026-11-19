import type * as ApiClient from '@myclash/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openPenaltyPage,
  type OpenedPenaltyPage,
} from '../../../../../../src/components/rulesets/penalty-page.fixtures';
import OrgNewScoringRulesetPage from './page';

/**
 * An organisation's scoring ruleset is born published: usable as soon as it is
 * created (custom-rulesets.service.ts, createOrgRuleset). The page shared the
 * platform admin's sentence, "The ruleset is created as draft; publish it when
 * ready", which is true only of a platform ruleset.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club' }),
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

describe('an organisation’s new scoring ruleset page', () => {
  it('says the ruleset is usable at once, never that it is a draft', async () => {
    page = await openPenaltyPage(<OrgNewScoringRulesetPage />, {
      '/api/v1/organizations/slug/club': { id: 'org-1' },
    });
    const text = document.body.textContent ?? '';

    expect(text).toContain('Your organisation can use the ruleset as soon as it is created.');
    expect(text).not.toContain('draft');
  });
});
