/**
 * A held hit's row names its bout, its Fighters and who scored (ruling 243).
 *
 * The names are saved on the tablet beside the hit when it is scored. They must
 * not leave it: the drain posts named fields only, and the heartbeat sends counts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../offline/db';
import { computeHeartbeatMetrics } from '../offline/heartbeat';
import {
  enqueue,
  getAllPending,
  getRejected,
  quarantine,
  requeueRejected,
} from '../offline/outbox';
import { summariseQuarantine } from '../offline/quarantine-report';
import { SyncEngine } from '../offline/sync';
import { boutNames, heldBoutLine, heldWhoLine } from './held-hit';

const BOUT = { label: 'LSW-P1-M3', red: 'Dupont', blue: 'Martin' };
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

describe('the bout a hit is queued with', () => {
  it('is the round code and the two names the bout screen shows', () => {
    expect(
      boutNames({
        roundCode: 'LSW-P1-M3',
        matchNumberLabel: 'L1-P1-M03',
        redFighterName: 'Dupont',
        blueFighterName: 'Martin',
      }),
    ).toEqual(BOUT);
  });

  it('falls back to the bout number, and to no name, when the summary is missing', () => {
    expect(boutNames({ roundCode: '', matchNumberLabel: 'L1-P1-M03' })).toEqual({
      label: 'L1-P1-M03',
      red: '',
      blue: '',
    });
  });
});

describe('the bout line of a held row', () => {
  it('names the bout and both Fighters', () => {
    expect(heldBoutLine({ bout: BOUT })).toBe('LSW-P1-M3 · Dupont – Martin');
  });

  it('names the bout alone when a name is missing', () => {
    expect(heldBoutLine({ bout: { label: 'LSW-P1-M3', red: 'Dupont', blue: '' } })).toBe(
      'LSW-P1-M3',
    );
  });

  it('says nothing for a row queued before the names were saved', () => {
    expect(heldBoutLine({})).toBeNull();
    expect(heldBoutLine({ bout: { label: '', red: '', blue: '' } })).toBeNull();
  });
});

describe('who a held row is about', () => {
  it('names who scored a clean hit, the corner and the points', () => {
    expect(heldWhoLine({ bout: BOUT, firstStrikerColor: 'blue', firstStrikeValue: 3 }, t)).toBe(
      'scoring.quarantine.scored {"who":"Martin (scoring.lice.blue)","points":3}',
    );
  });

  it('adds the afterblow’s points', () => {
    expect(
      heldWhoLine(
        { bout: BOUT, firstStrikerColor: 'red', firstStrikeValue: 3, afterblowValue: 1 },
        t,
      ),
    ).toBe(
      'scoring.quarantine.scoredAfterblow {"who":"Dupont (scoring.lice.red)","points":3,"afterblow":1}',
    );
  });

  it('names the corner alone on a row with no name', () => {
    expect(heldWhoLine({ firstStrikerColor: 'red', firstStrikeValue: 2 }, t)).toBe(
      'scoring.quarantine.scored {"who":"scoring.lice.red","points":2}',
    );
  });

  it('names who a card is against', () => {
    expect(heldWhoLine({ kind: 'penalty', bout: BOUT, cardedColor: 'blue' }, t)).toBe(
      'scoring.quarantine.cardAgainst {"who":"Martin (scoring.lice.blue)"}',
    );
  });

  it('says nothing for a double, a no-exchange and an older card', () => {
    expect(heldWhoLine({ bout: BOUT }, t)).toBeNull();
    expect(heldWhoLine({ kind: 'penalty', bout: BOUT }, t)).toBeNull();
  });
});

describe('the names stay on the tablet', () => {
  async function queueNamedHit() {
    return enqueue({
      clientUuid: 'uuid-1',
      matchId: 'm1',
      sequence: 1,
      type: 'clean',
      occurredAt: new Date().toISOString(),
      firstStrikerColor: 'red',
      firstStrikeValue: 3,
      bout: BOUT,
    });
  }

  it('a held row keeps them, and so does a row put back in the queue', async () => {
    await quarantine(await queueNamedHit(), 'Match is locked');
    expect((await getRejected())[0]?.bout).toEqual(BOUT);

    await requeueRejected();

    expect((await getAllPending())[0]?.bout).toEqual(BOUT);
  });

  it('the drain posts no name', async () => {
    await queueNamedHit();
    await enqueue({
      kind: 'penalty',
      clientUuid: 'uuid-card',
      matchId: 'm1',
      sequence: 2,
      registrationId: 'reg-blue',
      occurredAt: new Date().toISOString(),
      directCard: 'yellow',
      reason: 'late',
      cardedColor: 'blue',
      bout: BOUT,
    });
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: { body?: string }) => {
        bodies.push(init?.body ?? '');
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ id: 's' }) });
      }),
    );

    await new SyncEngine('http://localhost:4000').drain();

    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).not.toMatch(/Dupont|Martin|LSW-P1-M3|cardedColor|bout/);
    }
  });

  it('the heartbeat sends none', async () => {
    await queueNamedHit();
    await quarantine(await queueNamedHit(), 'Match is locked');
    const beat = JSON.stringify({
      ...computeHeartbeatMetrics(await getAllPending(), Date.now()),
      ...summariseQuarantine(await getRejected()),
    });

    expect(beat).not.toMatch(/Dupont|Martin|LSW-P1-M3/);
  });
});

describe('the screens', () => {
  // web-staff has no React test setup: the screens are read as text.
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');

  it('a hit is queued with the bout of the bout screen', () => {
    expect(read('components', 'MatchView.tsx')).toContain('bout: boutNames(match),');
    expect(read('hooks', 'useScoringSubmit.ts')).toMatch(
      /await enqueue\(\{[^}]*\bbout,[^}]*\.\.\.exchange,[^}]*\}\);/,
    );
  });

  it('a card is queued with the bout and the corner it is against', () => {
    const column = read('components', 'ScoringColumn.tsx');
    expect(column).toMatch(/await queueCard\(\{[^}]*bout: submit\.bout,[^}]*\}\);/);
    expect(column).toMatch(/await queueCard\(\{[^}]*cardedColor: side,[^}]*\}\);/);
  });

  it('the inbox row shows both lines', () => {
    const inbox = read('components', 'QuarantineInbox.tsx');
    expect(inbox).toContain('heldBoutLine(entry)');
    expect(inbox).toContain('heldWhoLine(entry, t)');
  });
});
