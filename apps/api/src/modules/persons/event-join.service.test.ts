import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventJoinService } from './event-join.service';

type Answer = { data: unknown; error: { message: string } | null };

/**
 * A double that answers each table from its own queue and RECORDS every read: its select string
 * and its `.eq` filters, so a test proves which rows a step looked at.
 */
function recordingDb(answers: Record<string, Answer[]>) {
  const reads: Array<{ table: string; select?: string; eq: Array<[string, unknown]> }> = [];
  const next = (table: string): Answer => {
    const answer = answers[table]?.shift();
    if (!answer) throw new Error(`unexpected read of ${table}`);
    return answer;
  };
  const db = {
    from(table: string) {
      const read = { table, eq: [] as Array<[string, unknown]> };
      reads.push(read);
      const chain = {
        select(columns: string) {
          Object.assign(read, { select: columns });
          return chain;
        },
        eq(column: string, value: unknown) {
          read.eq.push([column, value]);
          return chain;
        },
        maybeSingle: () => Promise.resolve(next(table)),
        then: (resolve: (a: Answer) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve()
            .then(() => next(table))
            .then(resolve, reject),
      };
      return chain;
    },
  };
  return { db: { service: db } as never, reads };
}

const ok = (data: unknown): Answer => ({ data, error: null });
const ACCOUNT = { id: 'user-bob', email: 'Bob@Mail.fr' };
const READER = { userId: 'user-bob', staff: null };
const OPEN_EVENT = {
  id: 'ev-1',
  status: 'published',
  organization_id: 'org-1',
  event_kind: 'standard',
  workshop_self_join: true,
};
const PROFILE = {
  id: 'gp-bob',
  given_name: 'Bob',
  family_name: 'Martin',
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
};
const row = (over: Record<string, unknown>) => ({
  id: 'p-x',
  email: null,
  given_name: 'Alice',
  family_name: 'Durand',
  claimed_by_user_id: null,
  global_person_id: null,
  ...over,
});

let createPerson: ReturnType<typeof vi.fn>;
let claimOwnRow: ReturnType<typeof vi.fn>;
let assertOrgRole: ReturnType<typeof vi.fn>;

function service(answers: Record<string, Answer[]>) {
  const { db, reads } = recordingDb(answers);
  const joins = new EventJoinService(
    db,
    { claimOwnRow } as never,
    { createPerson } as never,
    { assertOrgRole } as never,
  );
  return { joins, reads };
}

beforeEach(() => {
  createPerson = vi.fn().mockResolvedValue({ id: 'p-new' });
  claimOwnRow = vi.fn().mockResolvedValue('claimed');
  // The real refusal of a non-member, which `isInsider` reads as "not an insider".
  assertOrgRole = vi.fn().mockRejectedValue(new ForbiddenException('not a member'));
});

describe('EventJoinService — an account joins an Event by itself (rulings 516, 568)', () => {
  it('reads the Event with its switch, the live profile, and the roster of THIS Event', async () => {
    const { joins, reads } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([PROFILE])],
      persons: [ok([]), ok([])],
    });
    await joins.join('ev-1', ACCOUNT, READER, {});
    expect(reads.slice(0, 3)).toEqual([
      {
        table: 'events',
        select: 'id, status, organization_id, event_kind, workshop_self_join',
        eq: [['id', 'ev-1']],
      },
      {
        table: 'global_persons',
        select: 'id, given_name, family_name, deleted_at, merged_into_id, account_deleted_at',
        eq: [['claimed_by_user_id', 'user-bob']],
      },
      {
        table: 'persons',
        select: 'id, email, given_name, family_name, claimed_by_user_id, global_person_id',
        eq: [['event_id', 'ev-1']],
      },
    ]);
  });

  it('refuses an Event whose switch is off, and writes nothing', async () => {
    const { joins } = service({ events: [ok({ ...OPEN_EVENT, workshop_self_join: false })] });
    await expect(joins.join('ev-1', ACCOUNT, READER, {})).rejects.toMatchObject({
      response: { code: 'SELF_JOIN_CLOSED' },
    });
    expect(createPerson).not.toHaveBeenCalled();
  });

  it('answers an Event the caller may not see as unknown', async () => {
    const { joins } = service({ events: [ok({ ...OPEN_EVENT, status: 'draft' })] });
    await expect(joins.join('ev-1', ACCOUNT, READER, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(createPerson).not.toHaveBeenCalled();
  });

  it('answers with the row the account already holds, and makes no second one', async () => {
    const { joins } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([PROFILE])],
      persons: [ok([row({ id: 'p-bob', claimed_by_user_id: 'user-bob' })])],
    });
    await expect(joins.join('ev-1', ACCOUNT, READER, {})).resolves.toEqual({
      personId: 'p-bob',
      joined: 'already',
    });
    expect(createPerson).not.toHaveBeenCalled();
    expect(claimOwnRow).not.toHaveBeenCalled();
  });

  it("takes the unclaimed row carrying the account's address, through the claim's owner", async () => {
    const { joins } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([])],
      persons: [ok([row({ id: 'p-listed', email: 'bob@mail.fr' })])],
    });
    await expect(joins.join('ev-1', ACCOUNT, READER, {})).resolves.toEqual({
      personId: 'p-listed',
      joined: 'claimed',
    });
    expect(claimOwnRow).toHaveBeenCalledWith(ACCOUNT, 'p-listed');
    expect(createPerson).not.toHaveBeenCalled();
  });

  it("never takes a row another account holds, even with the account's address", async () => {
    const { joins } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([PROFILE])],
      persons: [ok([row({ id: 'p-other', email: 'bob@mail.fr', claimed_by_user_id: 'user-x' })])],
    });
    await expect(joins.join('ev-1', ACCOUNT, READER, {})).rejects.toMatchObject({
      response: { code: 'ASK_ORGANISER', reason: 'yourAddress' },
    });
    expect(claimOwnRow).not.toHaveBeenCalled();
    expect(createPerson).not.toHaveBeenCalled();
  });

  it('refuses when a row with no email has the same name: the organiser decides (572)', async () => {
    const { joins } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([PROFILE])],
      persons: [ok([]), ok([row({ given_name: ' bob ', family_name: 'MARTIN' })])],
    });
    await expect(joins.join('ev-1', ACCOUNT, READER, {})).rejects.toMatchObject({
      response: { code: 'ASK_ORGANISER', reason: 'sameName' },
    });
    expect(createPerson).not.toHaveBeenCalled();
  });

  it('lets a namesake with another address be: a second row is made', async () => {
    const { joins } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([PROFILE])],
      persons: [
        ok([]),
        ok([row({ given_name: 'Bob', family_name: 'Martin', email: 'other@mail.fr' })]),
      ],
    });
    await expect(joins.join('ev-1', ACCOUNT, READER, {})).resolves.toEqual({
      personId: 'p-new',
      joined: 'new',
    });
  });

  it("refuses when a row is linked to the account's profile under another address", async () => {
    const { joins } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([PROFILE])],
      persons: [ok([]), ok([row({ email: 'old@mail.fr', global_person_id: 'gp-bob' })])],
    });
    await expect(joins.join('ev-1', ACCOUNT, READER, {})).rejects.toMatchObject({
      response: { code: 'ASK_ORGANISER', reason: 'yourProfile' },
    });
  });

  it("makes the row with the profile's names and the ACCOUNT's address, then claims it", async () => {
    const { joins } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([PROFILE])],
      persons: [ok([]), ok([])],
    });
    const typed = { givenName: 'Robert', familyName: 'Someone' };
    await expect(joins.join('ev-1', ACCOUNT, READER, typed)).resolves.toEqual({
      personId: 'p-new',
      joined: 'new',
    });
    expect(createPerson).toHaveBeenCalledWith(
      'ev-1',
      { givenName: 'Bob', familyName: 'Martin', email: 'Bob@Mail.fr', globalPersonId: 'gp-bob' },
      'user-bob',
    );
    expect(claimOwnRow).toHaveBeenCalledWith(ACCOUNT, 'p-new');
  });

  it('asks for names when the account has no live profile (a merged one is none)', async () => {
    const merged = { ...PROFILE, merged_into_id: 'gp-else' };
    const { joins } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([merged])],
      persons: [ok([])],
    });
    await expect(joins.join('ev-1', ACCOUNT, READER, {})).rejects.toMatchObject({
      response: { code: 'NAMES_REQUIRED' },
    });
    expect(createPerson).not.toHaveBeenCalled();
  });

  it('makes the row with the typed names when the account has no profile', async () => {
    const { joins } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([])],
      persons: [ok([]), ok([])],
    });
    await joins.join('ev-1', ACCOUNT, READER, { givenName: 'Bob', familyName: 'Martin' });
    expect(createPerson).toHaveBeenCalledWith(
      'ev-1',
      { givenName: 'Bob', familyName: 'Martin', email: 'Bob@Mail.fr', globalPersonId: null },
      'user-bob',
    );
  });

  it('a second tap that won the race: the add refuses, the look again finds the row', async () => {
    createPerson.mockRejectedValue(new ConflictException('A person with email b***@mail.fr'));
    const { joins } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([PROFILE])],
      persons: [ok([]), ok([]), ok([row({ id: 'p-bob', claimed_by_user_id: 'user-bob' })])],
    });
    await expect(joins.join('ev-1', ACCOUNT, READER, {})).resolves.toEqual({
      personId: 'p-bob',
      joined: 'already',
    });
  });

  it('a database fault with nothing found keeps its own error, never "ask the organiser"', async () => {
    const fault = new BadRequestException('connection reset');
    createPerson.mockRejectedValue(fault);
    const { joins } = service({
      events: [ok(OPEN_EVENT)],
      global_persons: [ok([PROFILE])],
      persons: [ok([]), ok([]), ok([]), ok([])],
    });
    await expect(joins.join('ev-1', ACCOUNT, READER, {})).rejects.toBe(fault);
  });
});
