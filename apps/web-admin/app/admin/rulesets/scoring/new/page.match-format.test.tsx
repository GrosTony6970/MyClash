import type * as ApiClient from '@myclash/api-client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  labelled,
  openPenaltyPage,
  save,
  typeInto,
  type OpenedPenaltyPage,
} from '../../../../../src/components/rulesets/penalty-page.fixtures';
import NewRulesetPage from './page';

/**
 * An untouched Create stores no match format of its own (operator ruling 59, 2026-10-20): every
 * field follows the engine. It used to write the editor's own 5 / 180 / 0 / no ceiling.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({}),
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

/** Adds the "Victories" variable to the score formula: Save needs one. */
async function authorFormula(): Promise<void> {
  const button = [...document.querySelectorAll('button')].find(
    (each) => each.textContent?.trim() === '+ Victories',
  );
  if (!button) throw new Error('no + Victories button');
  await act(async () => button.click());
}

describe('the platform’s new scoring ruleset', () => {
  it('stores no match format when the box is left alone', async () => {
    page = await openPenaltyPage(<NewRulesetPage />, {});

    await typeInto(labelled('Name'), 'Platform pools');
    await authorFormula();
    await save();

    const create = page.saves.find((s) => s.path === '/api/v1/admin/custom-rulesets');
    expect(create?.body['matchFormatDefaults']).toBeNull();
  });
});
