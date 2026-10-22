import type * as ApiClient from '@myclash/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  labelled,
  openPenaltyPage,
  save,
  typeInto,
  type OpenedPenaltyPage,
} from '../../../../../../src/components/rulesets/penalty-page.fixtures';
import { pointsCapRow } from '../../../../../../src/components/rulesets/scoring-page.fixtures';
import EditRulesetPage from './page';

/**
 * The platform admin's Points-cap editor writes where Points-cap Tournaments read (operator ruling
 * 139, 2026-10-22): its own match format, in `tf_config`. It used to write the flat
 * `match_format_defaults`, which nothing reads for a built-in, so an edit reached no Tournament.
 * It edits only what Points cap has: no field for a formula, a win bonus, a double penalty or a
 * doubles ceiling (the read-only system panel names the engine's), and its targets and afterblow
 * are read-only (they are its code).
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'rs-pc' }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const PATH = '/api/v1/admin/custom-rulesets/rs-pc';
/** A pool time no engine default holds: the platform admin's own. */
const OWN = { timeLimitsSeconds: { pool: 120 } };
const HEAD = { name: 'Ruleset rs-pc', description: '', version: '1.0.0' };

let page: OpenedPenaltyPage;
afterEach(() => page.unmount());

async function openPointsCap(tfConfig: Record<string, unknown> | null): Promise<void> {
  page = await openPenaltyPage(<EditRulesetPage />, {
    [PATH]: pointsCapRow(tfConfig),
    [`${PATH}/versions`]: [],
  });
}

const patch = () => page.saves.find((s) => s.path === PATH)?.body;
/** Each section's title, without the words of its help tooltip. */
const headings = () =>
  [...document.querySelectorAll('h3')].map((h) => h.childNodes[0]?.textContent?.trim());

describe('the platform’s Points-cap editor', () => {
  it('shows its own match format from tf_config, the engine for the rest', async () => {
    await openPointsCap({ matchFormat: OWN });

    expect(labelled('Time limit · pool').value).toBe('120');
    expect(labelled('Point cap').value).toBe('10');
  });

  it('sends exactly its name and an empty tf_config on an untouched Save of an empty row', async () => {
    await openPointsCap(null);

    await save();

    expect(patch()).toEqual({ ...HEAD, tfConfig: {} });
  });

  it('keeps its own match format on an untouched Save', async () => {
    await openPointsCap({ matchFormat: OWN });

    await save();

    expect(patch()).toEqual({ ...HEAD, tfConfig: { matchFormat: OWN } });
  });

  it('writes a changed field to tf_config beside the stored one', async () => {
    await openPointsCap({ matchFormat: OWN });

    await typeInto(labelled('Point cap'), '7');
    await save();

    expect(patch()).toEqual({ ...HEAD, tfConfig: { matchFormat: { ...OWN, pointCap: 7 } } });
  });

  it('has no field for a formula, constants, tie-breakers, win bonus, double penalty or doubles ceiling', async () => {
    await openPointsCap(null);

    expect(headings()).toEqual(
      expect.arrayContaining(['Targets', 'Afterblow', 'Match-format defaults']),
    );
    for (const absent of ['Score formula', 'Constants', 'Tie-breakers', 'Double-hit penalty']) {
      expect(headings()).not.toContain(absent);
    }
    // The system panel above the form names the engine's win bonus ("—"); no field edits one.
    expect(() => labelled('Win bonus')).toThrow();
    expect(() => labelled('Max double hits')).toThrow();
  });

  it('shows its single hit and its afterblow read-only', async () => {
    await openPointsCap(null);

    const target = document.querySelector<HTMLInputElement>('input[aria-label="Target name"]');
    expect(target?.value).toBe('Hit');
    expect(target?.disabled).toBe(true);
    expect(labelled('This ruleset uses afterblow').disabled).toBe(true);
  });
});
