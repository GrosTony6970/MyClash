/**
 * A stubbed server for a piste of three bouts, for the stories of "the tablet
 * keeps its piste" (quick-win ruling 4).
 *
 * Bout 1 is running; bouts 2 and 3 are not started. The server gives the whole
 * piste in one read (`GET /staff/lices/:liceId/bouts`), and each bout by its
 * own routes. A dead network is the answer the pad's service worker gives: a
 * 503 with `{ error: 'offline' }`.
 */
import { expect, type Page, type Route } from '@playwright/test';
import { boutRules, rulesOf } from './pad-rounds-score';

export const PAD = 'http://localhost:3002';
export const LICE = 'lice-1';
export const ORDER = ['match-1', 'match-2', 'match-3'];

const NAMES: Record<string, [string, string]> = {
  'match-1': ['Ana Red', 'Bo Blue'],
  'match-2': ['Cy After', 'Di After'],
  'match-3': ['Eli Third', 'Fay Third'],
};

const row = (id: string, redScore: number, rules: PisteStub['boutRules']) => ({
  id,
  match_number_label: `L1-P1-M${id.slice(-1)}`,
  status: id === 'match-1' ? 'running' : 'scheduled',
  ruleset_code: 'TF',
  ruleset_version: '1.0.0',
  decision_edition: '2026-10',
  red_registration_id: `red-${id}`,
  blue_registration_id: `blue-${id}`,
  red_score: id === 'match-1' ? redScore : 0,
  blue_score: 0,
  winner_registration_id: null,
  locked_at: null,
  lice_id: LICE,
  end_reason: null,
  current_round: 1,
  red_round_wins: 0,
  blue_round_wins: 0,
  rounds_json: null,
  awaiting_round_advance: false,
  // Its own rules (ruling K): the tablet keeps no bout read without them.
  ...(rules ? { rules: rules(id) } : {}),
});

const summary = (id: string) => ({
  roundCode: `LSW-P1-M${id.slice(-1)}`,
  redName: NAMES[id]![0],
  blueName: NAMES[id]![1],
  redClub: null,
  blueClub: null,
  weapon: 'longsword',
  tournamentId: 'tournament-1',
  tournamentName: 'Longsword Open',
  poolName: 'Pool 1',
  liceName: 'Piste 2',
  phaseType: 'pool',
  bestOf: 1,
});

const tile = (id: string | undefined) =>
  id ? { id, redFighterName: NAMES[id]![0], blueFighterName: NAMES[id]![1] } : null;

const CLOCK = {
  status: 'halted',
  activeMs: 5000,
  totalActiveMs: 5000,
  startedAt: '2026-01-01T10:00:00.000Z',
  levelResolutionSteps: 0,
};

export interface PisteStub {
  network: 'up' | 'down';
  /** The red score of bout 1 on the server. A saved hit moves it. */
  redScore: number;
  /** The red score of bout 1 in the answer of the piste read: null follows `redScore`. */
  pisteRedScore: number | null;
  /** Every request that is not a read, by method and path. */
  sent: string[];
  /** Whether the server gives the Tournament's `/match-config` (its display). */
  rules: boolean;
  /** The rules each bout read carries, by bout (`rules`, ruling K); null: read without them. */
  boutRules: ((id: string) => unknown) | null;
  /** The penalty catalogue each bout's card rules give, by bout; none answers null. */
  catalogues: Record<string, unknown>;
  /** How many times the whole piste was asked. */
  pisteReads: number;
  /** Set to hold the answer of the piste read; call it to let the answer go. */
  holdPiste: boolean;
  releasePiste: () => void;
}

const OFFLINE = { status: 503, json: { error: 'offline', status: 503 } };

function answerGet(stub: PisteStub, path: string, route: Route) {
  const bout = ORDER.find((id) => path.includes(`/matches/${id}`));
  if (path.endsWith(`/staff/lices/${LICE}/bouts`)) {
    stub.pisteReads += 1;
    const body = {
      liceId: LICE,
      liceName: 'Piste 2',
      bouts: ORDER.map((id) => ({
        match: row(id, stub.pisteRedScore ?? stub.redScore, stub.boutRules),
        summary: summary(id),
      })),
    };
    if (!stub.holdPiste) return route.fulfill({ json: body });
    stub.releasePiste = () => void route.fulfill({ json: body });
    return undefined;
  }
  if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
  // The Tournament's config: the tablet keeps no bout of a Tournament whose
  // display it does not hold. A story may take it away.
  if (path.endsWith('/match-config')) {
    return stub.rules ? route.fulfill({ json: rulesOf(false, 5) }) : route.fulfill(OFFLINE);
  }
  if (!bout) return route.fulfill({ status: 404, json: {} });
  if (path.endsWith('/neighbors')) {
    const at = ORDER.indexOf(bout);
    return route.fulfill({ json: { previous: tile(ORDER[at - 1]), next: tile(ORDER[at + 1]) } });
  }
  if (path.endsWith(`/matches/${bout}`)) {
    return route.fulfill({ json: row(bout, stub.redScore, stub.boutRules) });
  }
  if (path.endsWith('/summary')) return route.fulfill({ json: summary(bout) });
  if (path.endsWith('/exchanges') || path.endsWith('/penalties'))
    return route.fulfill({ json: [] });
  if (path.endsWith('/clock')) return route.fulfill({ json: CLOCK });
  if (path.endsWith('/penalty-ruleset'))
    return route.fulfill({ json: stub.catalogues[bout] ?? null });
  return route.fulfill({ status: 404, json: {} });
}

/** Routes the pad's API to the stub. Returns its switches. */
export async function stubPiste(page: Page): Promise<PisteStub> {
  const stub: PisteStub = {
    network: 'up',
    redScore: 3,
    pisteRedScore: null,
    sent: [],
    rules: true,
    boutRules: () => boutRules(false, 5),
    catalogues: {},
    pisteReads: 0,
    holdPiste: false,
    releasePiste: () => undefined,
  };
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (stub.network === 'down') return route.fulfill(OFFLINE);
    if (route.request().method() === 'GET') return answerGet(stub, path, route);
    // The pad posts a heartbeat on its own: only the bouts' requests are written down.
    if (path.includes('/matches/')) stub.sent.push(`${route.request().method()} ${path}`);
    // A saved hit: the server's score of bout 1 moves.
    if (path.endsWith('/matches/match-1/exchanges')) stub.redScore += 1;
    return route.fulfill({ status: 201, json: { id: 'saved' } });
  });
  return stub;
}

/** The body of one row of the tablet's `reads` table, or null with no row. */
export function keptRow(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (path) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open('myclash-staff');
        open.onerror = () => resolve('the store did not open');
        open.onsuccess = () => {
          const get = open.result.transaction('reads').objectStore('reads').get(path);
          get.onsuccess = () => {
            const kept = get.result as { body?: unknown } | undefined;
            open.result.close();
            resolve(kept ? (kept.body ?? '') : null);
          };
        };
      }),
    key,
  );
}

/** How many entries the tablet's queue holds for a bout. */
export function queuedFor(page: Page, matchId: string): Promise<number> {
  return page.evaluate(
    (id) =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('myclash-staff');
        open.onerror = () => resolve(-1);
        open.onsuccess = () => {
          const all = open.result.transaction('outbox').objectStore('outbox').getAll();
          all.onsuccess = () => {
            const rows = all.result as Array<{ matchId?: string }>;
            open.result.close();
            resolve(rows.filter((entry) => entry.matchId === id).length);
          };
        };
      }),
    matchId,
  );
}

/** Opens bout 1 with the network up, and waits until the tablet holds its piste. */
export async function openFirstBout(
  page: Page,
  start: Partial<Pick<PisteStub, 'rules' | 'boutRules' | 'catalogues'>> = {},
): Promise<PisteStub> {
  const stub = await stubPiste(page);
  Object.assign(stub, start);
  await page.goto(`${PAD}/matches/match-1`);
  await expect(page.getByTestId('double-button')).toBeEnabled();
  await expect.poll(() => keptRow(page, `piste/${LICE}`)).toEqual(ORDER);
  return stub;
}
