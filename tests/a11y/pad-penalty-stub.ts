/**
 * The stubbed server of the penalty-list stories, and their locators.
 *
 * The API is stubbed, and every card the pad sends is written down. The penalty
 * list has a yellow entry, a red entry, a black entry, and an entry that is
 * yellow the first time and red the second. A protest the server takes is kept,
 * and listed back as the server lists it.
 */
import { expect, type Page } from '@playwright/test';

const PAD = 'http://localhost:3002';
const BOUT = 'match-1';
const TOURNAMENT = 'tournament-1';
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
  locked_at: null as string | null,
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
/** An entry as the API sends it: `ref_number` is TEXT (migration 0071), the group a number. */
const entry = (id: string, ref: string, name: string, sanctions: string[]) => ({
  id,
  group_number: Number.parseInt(ref, 10),
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
    entry('entry-yellow', '1', 'Late on guard', ['yellow']),
    entry('entry-red', '2', 'Strike after halt', ['red']),
    entry('entry-black', '3', 'Brutality', ['black']),
    entry('entry-second', '4', 'Leaving the piste', ['yellow', 'red']),
  ],
};
/** Bo Blue already left the piste once in this bout: his second time is a red card. */
const PRIORS = {
  accumulationScope: 'match',
  priors: {
    'red-1': [],
    'blue-1': [{ sideId: 'blue-1', groupNumber: 4, card: 'yellow', source: 'ruleset' }],
  },
};

interface Stub {
  /** False: a dead network, as the pad's service worker answers it. Writes stay in the queue. */
  savesReach: boolean;
  row: typeof ROW;
  summary: typeof SUMMARY & { eventOver?: boolean; tournamentId?: string };
  /** The list entry of every card the pad sent. */
  cards: string[];
  /** Every protest the server took, as it lists it back. */
  protests: Array<Record<string, unknown>>;
  /** How many reads of the protests were answered, and how many before the last protest was taken. */
  protestReads: number;
  readsAtTake: number;
  /** The bout's writes, in order, as `POST /protests`: the pad's heartbeat is not one. */
  sent: string[];
  /** The penalty list the pad reads. */
  penaltyList: unknown;
  /** The Tournament's `/match-config`, or null: the bout has no Tournament, and it is never read. */
  matchConfig: unknown;
}

/** A protest the server takes: saved once by its `clientUuid`, as the API does. */
function takeProtest(stub: Stub, body: Record<string, unknown>) {
  const saved = stub.protests.find((row) => row['client_uuid'] === body['clientUuid']);
  if (saved) return saved;
  const row = {
    id: `protest-${stub.protests.length + 1}`,
    client_uuid: body['clientUuid'],
    match_id: BOUT,
    registration_id: body['registrationId'],
    sequence: body['sequence'],
    round_number: 1,
    clock_time_ms: body['clockTimeMs'] ?? null,
    occurred_at: body['occurredAt'],
    voided: false,
  };
  stub.protests.push(row);
  stub.readsAtTake = stub.protestReads;
  return row;
}

async function serve(page: Page, stub: Stub) {
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (method !== 'GET') {
      if (path.includes(`/matches/${BOUT}/`)) {
        stub.sent.push(`${method} ${path.slice(path.lastIndexOf('/'))}`);
      }
      if (path.endsWith(`/matches/${BOUT}/penalties`)) {
        const body = route.request().postDataJSON() as { rulesetEntryId?: string };
        stub.cards.push(body.rulesetEntryId ?? 'no entry');
      }
      // A dead network, as the pad's service worker answers it: the entry stays in the queue.
      if (!stub.savesReach)
        return route.fulfill({ status: 503, json: { error: 'offline', status: 503 } });
      if (path.endsWith(`/matches/${BOUT}/protests`)) {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ status: 201, json: takeProtest(stub, body) });
      }
      return route.fulfill({ status: 201, json: {} });
    }
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: stub.row });
    if (path.endsWith('/summary')) return route.fulfill({ json: stub.summary });
    if (path.endsWith('/penalty-ruleset')) return route.fulfill({ json: stub.penaltyList });
    if (path.endsWith(`/tournaments/${TOURNAMENT}/match-config`) && stub.matchConfig) {
      return route.fulfill({ json: stub.matchConfig });
    }
    if (path.endsWith('/penalty-scope')) return route.fulfill({ json: PRIORS });
    if (path.endsWith('/protests')) {
      stub.protestReads += 1;
      return route.fulfill({ json: stub.protests });
    }
    if (path.endsWith('/exchanges') || path.endsWith('/penalties')) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith('/clock')) return route.fulfill({ json: CLOCK });
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    return route.fulfill({ status: 404, json: {} });
  });
}

const newStub = (savesReach: boolean): Stub => ({
  savesReach,
  row: ROW,
  summary: SUMMARY,
  cards: [],
  protests: [],
  protestReads: 0,
  readsAtTake: 0,
  sent: [],
  penaltyList: PENALTY_LIST,
  matchConfig: null,
});

/** Opens a running bout. Returns the list entry of every card the pad sent. */
export async function openBout(page: Page, savesReach = true) {
  const stub = newStub(savesReach);
  await serve(page, stub);
  await page.goto(`${PAD}/matches/${BOUT}`);
  await expect(redRow(page, 'entry-red')).toBeEnabled();
  return stub.cards;
}

/**
 * Opens the running bout for the protest stories, on the stub's record. The
 * bout may be locked, or its Event over. `online`: what `navigator.onLine`
 * says, as the browser would; with false, no write reaches the server.
 * `rules`: the bout is of a Tournament, and the stub answers its
 * `/match-config` and the penalty list with these.
 */
export async function openProtestBout(
  page: Page,
  bout: {
    lockedAt?: string;
    eventOver?: boolean;
    online?: boolean;
    rules?: { matchConfig: unknown; penaltyList: unknown };
  } = {},
) {
  const online = bout.online ?? true;
  const stub = newStub(online);
  stub.row = { ...ROW, locked_at: bout.lockedAt ?? null };
  stub.summary = { ...SUMMARY, eventOver: bout.eventOver ?? false };
  if (bout.rules) {
    stub.summary.tournamentId = TOURNAMENT;
    stub.matchConfig = bout.rules.matchConfig;
    stub.penaltyList = bout.rules.penaltyList;
  }
  await page.addInitScript((isOnline) => {
    (window as unknown as { padOnline: boolean }).padOnline = isOnline;
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get: () => (window as unknown as { padOnline: boolean }).padOnline,
    });
  }, online);
  await serve(page, stub);
  await page.goto(`${PAD}/matches/${BOUT}`);
  await expect(protestChip(page, 'red')).toBeVisible();
  return stub;
}

/** One Fighter's protest button on the pad, in that Fighter's column. */
export const protestChip = (page: Page, side: 'red' | 'blue') =>
  page.locator(`[data-testid="scoring-column"][data-side="${side}"] [data-testid="protest-chip"]`);

/** One row of the penalty list, in one fighter's column. */
export const row = (page: Page, side: 'red' | 'blue', entryId: string) =>
  page.locator(
    `[data-side="${side}"] [data-testid="penalty-entry-button"][data-entry-id="${entryId}"]`,
  );
export const redRow = (page: Page, entryId: string) => row(page, 'red', entryId);
export const dialog = (page: Page) => page.getByRole('dialog');
