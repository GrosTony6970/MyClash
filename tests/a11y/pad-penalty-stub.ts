/**
 * The stubbed server of the penalty-list stories, and their locators.
 *
 * The API is stubbed, and every card the pad sends is written down. The penalty
 * list has a yellow entry, a red entry, a black entry, and an entry that is
 * yellow the first time and red the second.
 */
import { expect, type Page } from '@playwright/test';

const PAD = 'http://localhost:3002';
const BOUT = 'match-1';
const ROW = {
  id: BOUT,
  match_number_label: 'M1',
  status: 'running',
  decision_edition: '2026-10',
  red_registration_id: 'red-1',
  blue_registration_id: 'blue-1',
  red_score: 0,
  blue_score: 0,
  winner_registration_id: null,
  locked_at: null,
  lice_id: null,
  end_reason: null,
  current_round: 1,
  red_round_wins: 0,
  blue_round_wins: 0,
  rounds_json: null,
  awaiting_round_advance: false,
};
const SUMMARY = {
  roundCode: 'P1',
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  weapon: 'longsword',
  phaseType: 'pool',
  bestOf: 1,
};
const CLOCK = {
  status: 'halted',
  activeMs: 5000,
  totalActiveMs: 5000,
  startedAt: '2026-01-01T10:00:00.000Z',
  levelResolutionSteps: 0,
};
const entry = (id: string, ref: number, name: string, sanctions: string[]) => ({
  id,
  group_number: ref,
  ref_number: ref,
  short_name: name,
  description: `${name}, in full`,
  sanctions,
});
const PENALTY_LIST = {
  id: 'list-1',
  name: 'House list',
  accumulation_scope: 'match',
  penalty_ruleset_entries: [
    entry('entry-yellow', 1, 'Late on guard', ['yellow']),
    entry('entry-red', 2, 'Strike after halt', ['red']),
    entry('entry-black', 3, 'Brutality', ['black']),
    entry('entry-second', 4, 'Leaving the piste', ['yellow', 'red']),
  ],
};
/** Bo Blue already left the piste once in this bout: his second time is a red card. */
const PRIORS = {
  accumulationScope: 'match',
  priors: {
    'red-1': [],
    'blue-1': [{ registrationId: 'blue-1', groupNumber: 4, card: 'yellow', source: 'ruleset' }],
  },
};

/** Opens a running bout. Returns the list entry of every card the pad sent. */
export async function openBout(page: Page, savesReach = true) {
  const cards: string[] = [];
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (method !== 'GET') {
      if (path.endsWith(`/matches/${BOUT}/penalties`)) {
        const body = route.request().postDataJSON() as { rulesetEntryId?: string };
        cards.push(body.rulesetEntryId ?? 'no entry');
      }
      // A dead network, as the pad's service worker answers it: the card stays in the queue.
      if (!savesReach)
        return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
      return route.fulfill({ status: 201, json: {} });
    }
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: ROW });
    if (path.endsWith('/summary')) return route.fulfill({ json: SUMMARY });
    if (path.endsWith('/penalty-ruleset')) return route.fulfill({ json: PENALTY_LIST });
    if (path.endsWith('/penalty-scope')) return route.fulfill({ json: PRIORS });
    if (path.endsWith('/exchanges') || path.endsWith('/penalties')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock')) return route.fulfill({ json: CLOCK });
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  await expect(redRow(page, 'entry-red')).toBeEnabled();
  return cards;
}

/** One row of the penalty list, in one fighter's column. */
export const row = (page: Page, side: 'red' | 'blue', entryId: string) =>
  page.locator(
    `[data-side="${side}"] [data-testid="penalty-entry-button"][data-entry-id="${entryId}"]`,
  );
export const redRow = (page: Page, entryId: string) => row(page, 'red', entryId);
export const dialog = (page: Page) => page.getByRole('dialog');
