/**
 * A direct card goes through the pad's queue, online and offline (rulings 313, 314).
 *
 * The corrections drawer posted it at once: with no connection its buttons were
 * grey, and a card for a Fighter late on the piste could not be given at all.
 * It is now written on the tablet first, the drawer closes, and the queue sends
 * it with nothing waiting for the answer (ruling 316). A refusal is the inbox's
 * to say, with the colour, the reason and the Fighter (ruling 246).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../offline/db';
import { offlineResponse } from '../offline/failure-kind';
import { getAllPending, getRejected, requeueRejected } from '../offline/outbox';
import { SyncEngine } from '../offline/sync';
import { giveDirectCard } from './direct-card';
import { heldWhoLine } from './held-hit';

const API_URL = 'http://localhost:4000';
const BOUT = { label: 'LSW-P1-M3', red: 'Dupont', blue: 'Martin' };
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

const CARD = {
  matchId: 'm1',
  sequence: 4,
  registrationId: 'reg-blue',
  clockTimeMs: 61_000,
  bout: BOUT,
  cardedColor: 'blue',
  directCard: 'red',
  reason: 'Late on the piste',
} as const;

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

/** The server's answer to every POST, and the bodies it was sent. */
function mockApi(answer: () => Response): string[] {
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(Response.json([]));
      bodies.push(init?.body ?? '');
      return Promise.resolve(answer());
    }),
  );
  return bodies;
}

/** The three steps of the drawer, in the order they ran, and what the tablet held at the close. */
function watchedSteps(send: () => void = () => undefined) {
  const log: string[] = [];
  const watch = { onTabletAtClose: Promise.resolve(-1) };
  const steps = {
    notKept: vi.fn(),
    close: vi.fn(() => {
      log.push('close');
      watch.onTabletAtClose = db.outbox.count();
    }),
    send: vi.fn(() => {
      log.push('send');
      send();
    }),
    recorded: vi.fn(() => {
      log.push('recorded');
    }),
  };
  return { log, steps, watch };
}

describe('a direct card given from the drawer', () => {
  it('is one row of the queue, with its colour, its reason and its names', async () => {
    await giveDirectCard(CARD, watchedSteps().steps);

    const rows = await getAllPending();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'penalty', attempts: 0, ...CARD });
    expect(rows[0]?.clientUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0]).not.toHaveProperty('rulesetEntryId');
    expect(rows[0]).not.toHaveProperty('cardName');
  });

  it('is on the tablet before the drawer closes, then the send is asked for', async () => {
    const { log, steps, watch } = watchedSteps();

    await giveDirectCard(CARD, steps);

    expect(log).toEqual(['close', 'send', 'recorded']);
    expect(await watch.onTabletAtClose).toBe(1);
  });

  it('waits for no answer: the referee is back on the bout while the server is asked', async () => {
    let answer: (res: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    const engine = new SyncEngine(API_URL);
    const steps = through(engine);

    await giveDirectCard(CARD, steps);

    expect(steps.recorded).toHaveBeenCalledOnce();
    expect(engine.isDraining(), 'the card is still on its way').toBe(true);
    expect(await getAllPending()).toHaveLength(1);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    answer(Response.json({ id: 'server-card' }, { status: 201 }));
    await engine.drain();
    expect(await getAllPending()).toHaveLength(0);
  });

  it('keeps the drawer open when the tablet cannot keep the card', async () => {
    vi.spyOn(db.outbox, 'add').mockRejectedValue(new Error('QuotaExceededError'));
    const { steps } = watchedSteps();

    await giveDirectCard(CARD, steps);

    expect(steps.notKept, 'the open drawer says so').toHaveBeenCalledOnce();
    expect(steps.close).not.toHaveBeenCalled();
    expect(steps.send).not.toHaveBeenCalled();
    expect(steps.recorded).not.toHaveBeenCalled();
  });

  it('moves the sequence on when asking for the send throws: the card is kept', async () => {
    const { steps } = watchedSteps(() => {
      throw new Error('store closed');
    });

    await expect(giveDirectCard(CARD, steps)).rejects.toThrow('store closed');

    expect(steps.notKept, '"failed" over a kept card asks for it twice').not.toHaveBeenCalled();
    expect(steps.close).toHaveBeenCalledOnce();
    expect(steps.recorded).toHaveBeenCalledOnce();
    expect(await getAllPending()).toHaveLength(1);
  });
});

/** The drawer's steps over a real engine: the send runs behind, as on the pad. */
const through = (engine: SyncEngine) => watchedSteps(() => engine.sendBehind()).steps;

describe('the queue sends it', () => {
  /** Gives the card, then waits for the send nobody waited for. */
  async function given(engine = new SyncEngine(API_URL)) {
    const steps = through(engine);
    await giveDirectCard(CARD, steps);
    await engine.drain();
    return steps;
  }

  it('waits on the tablet with no connection, and the drawer still closes', async () => {
    // What a dead hall looks like here: the service worker answers 503 itself.
    mockApi(offlineResponse);
    const steps = await given();

    expect(await getAllPending()).toHaveLength(1);
    expect(await getRejected()).toHaveLength(0);
    expect(steps.close).toHaveBeenCalledOnce();
    expect(steps.recorded).toHaveBeenCalledOnce();
  });

  it('posts the colour and the reason, and no name', async () => {
    const bodies = mockApi(() => Response.json({ id: 'server-card' }, { status: 201 }));

    await given();

    expect(await getAllPending()).toHaveLength(0);
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({
      sequence: 4,
      registrationId: 'reg-blue',
      clockTimeMs: 61_000,
      directCard: 'red',
      reason: 'Late on the piste',
    });
    expect(bodies[0]).not.toMatch(/Dupont|Martin|LSW-P1-M3|cardedColor|bout/);
  });

  it('sent again under a new sequence after a 400, it is still the same direct card', async () => {
    const answers = [
      Response.json({ message: 'sequence already used' }, { status: 400 }),
      Response.json({ id: 'server-card' }, { status: 201 }),
    ];
    const bodies = mockApi(() => answers.shift() ?? Response.error());

    await given();

    expect(await getAllPending()).toHaveLength(0);
    expect(await getRejected()).toHaveLength(0);
    expect(bodies).toHaveLength(2);
    const [first, second] = bodies.map((body) => JSON.parse(body) as Record<string, unknown>);
    expect(second).toMatchObject({ directCard: 'red', reason: 'Late on the piste' });
    expect(second?.['clientUuid']).toBe(first?.['clientUuid']);
    expect(second?.['sequence']).not.toBe(first?.['sequence']);
  });

  it('a refused one is held, and its row says the colour, the reason and the Fighter', async () => {
    mockApi(() =>
      Response.json(
        { message: 'Event results are frozen', code: 'event_results_frozen' },
        { status: 409 },
      ),
    );

    await given();

    const held = await getRejected();
    expect(held).toHaveLength(1);
    expect(held[0]?.rejectedCode).toBe('event_results_frozen');
    expect(heldWhoLine(held[0]!, t)).toBe(
      'scoring.penalties.cards.red · Late on the piste · scoring.quarantine.cardAgainst {"who":"Martin"}',
    );
  });

  it('a held one put back in the queue is still a direct card', async () => {
    mockApi(() => Response.json({ message: 'Match is locked', code: 'locked' }, { status: 409 }));
    await given();

    await requeueRejected();

    expect((await getAllPending())[0]).toMatchObject({
      directCard: 'red',
      reason: 'Late on the piste',
      cardedColor: 'blue',
      bout: BOUT,
    });
  });
});

describe('the screens', () => {
  // web-staff has no React test setup: the screens are read as text.
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');

  it('the panel sends nothing itself', () => {
    const panel = read('components', 'DirectCardPanel.tsx');
    expect(panel).not.toContain('apiRequest');
    expect(panel).not.toContain('/penalties');
    expect(panel).toContain('await giveDirectCard(');
    expect(panel, 'nothing waits for the send').toContain(
      'send: () => props.syncEngine?.sendBehind(),',
    );
  });

  it('the panel queues the card with its sequence, its Fighter, its colour and its reason', () => {
    const panel = read('components', 'DirectCardPanel.tsx');
    for (const field of [
      'sequence: props.nextSequence,',
      "registrationId: fighter === 'red' ? props.redRegistrationId : props.blueRegistrationId,",
      'clockTimeMs: props.clockTimeMs,',
      'bout: props.bout,',
      'cardedColor: fighter,',
      'directCard: card,',
      'reason: reason.trim(),',
    ]) {
      expect(panel, field).toContain(field);
    }
  });

  it('the card buttons are live with no connection', () => {
    const panel = read('components', 'DirectCardPanel.tsx');
    expect(panel).toContain('disabled={disabled || busy || reason.trim().length === 0}');
    expect(read('components', 'MatchCorrectionsDrawer.tsx')).toContain('disabled={busy || locked}');
  });

  it('the panel says so with no connection (ruling 315), and a fault in the reader’s language', () => {
    const panel = read('components', 'DirectCardPanel.tsx');
    expect(panel).toMatch(/\{!online && <p[^>]*>\{t\('scoring\.lice\.directCardOffline'\)\}/);
    expect(panel).toContain("notKept: () => setError(t('scoring.corrections.actionFailed')),");
    expect(panel).not.toContain('Network error');
  });

  it('a typed reason outlives a shut drawer, and is no longer than the server takes', () => {
    const drawer = read('components', 'MatchCorrectionsDrawer.tsx');
    // Above the drawer's "shut" guard: the panel below it leaves the page.
    expect(drawer.indexOf('useState(NO_DIRECT_CARD_DRAFT)')).toBeGreaterThan(0);
    expect(drawer.indexOf('useState(NO_DIRECT_CARD_DRAFT)')).toBeLessThan(
      drawer.indexOf('if (!open) return null;'),
    );
    expect(drawer).toMatch(/draft=\{cardDraft\}\s+onDraft=\{setCardDraft\}/);
    const panel = read('components', 'DirectCardPanel.tsx');
    expect(panel).toContain('const REASON_MAX_LENGTH = 500;');
    expect(panel).toContain('maxLength={REASON_MAX_LENGTH}');
    expect(
      read('..', '..', 'api', 'src', 'modules', 'penalties', 'dto', 'penalties.dto.ts'),
    ).toContain('reason: z.string().max(500).optional(),');
  });

  it('the drawer posts no card', () => {
    const drawer = read('components', 'MatchCorrectionsDrawer.tsx');
    expect(drawer).not.toContain('/penalties');
    expect(drawer).toContain('<DirectCardPanel');
  });

  it('the bout screen hands the drawer the queue, the names and the sequence step', () => {
    const view = read('components', 'MatchView.tsx');
    expect(view).toMatch(
      /<MatchCorrectionsDrawer[\s\S]*?syncEngine=\{syncEngine\}\s+bout=\{submit\.bout\}\s+onCardQueued=\{moveSequenceOn\}/,
    );
  });

  it('a card has one way into the queue', () => {
    const column = read('components', 'ScoringColumn.tsx');
    expect(column).toMatch(/import \{[^}]*\bqueueCard\b[^}]*\} from '\.\.\/offline\/outbox';/);
    expect(column).not.toContain('function queueCard(');
    expect(read('lib', 'direct-card.ts')).toContain("from '../offline/outbox'");
  });
});
