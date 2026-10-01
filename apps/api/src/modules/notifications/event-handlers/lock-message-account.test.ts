/**
 * The lock message finds the referee through his profile (ruling 201). Marc referees the Open and
 * holds his profile. Claire picked him from the directory, so the Open's roster has no row for him.
 * Before, the lock message looked for his roster row in the Event, found none and told nobody; a
 * referee on the roster was told only once that row was linked to his account. His "starting soon"
 * alert already looked at his profile. The email goes to his account's own address (ruling 201a),
 * never to the one on his profile or on a roster row: an organiser may have typed either.
 */
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  type SupabaseRow,
  type TableSeed,
} from '../../../common/testing/supabase-chain';
import { NotificationEventsService } from './notification-events.service';

const MARC = 'u-marc';
const HIS_PROFILE = 'gp-marc';
const DUTY: SupabaseRow = {
  id: 'd-marc',
  event_id: 'e-open',
  person_id: HIS_PROFILE,
  role: 'Referee',
  matches: { match_number_label: 'L1-P1-M1' },
};
/** His profile carries an address he left behind: the account's own is the one to write to. */
const PROFILE: SupabaseRow = {
  id: HIS_PROFILE,
  claimed_by_user_id: MARC,
  email: 'marc-old@example.com',
};

type Account = { ok: boolean; status: number; data: { id: string; email?: string } | null };
const HIS_ACCOUNT: Account = {
  ok: true,
  status: 200,
  data: { id: MARC, email: 'marc@example.com' },
};

/** The Open's roster is left out on purpose: the double throws on a table nobody seeded. */
function tables(profiles: SupabaseRow[], duty: SupabaseRow = DUTY): Record<string, TableSeed> {
  return {
    referee_assignments: { rows: [duty] },
    global_persons: { rows: profiles },
  };
}

const scheduler = { sendImmediate: vi.fn() };
const getAuthAdminUser = vi.fn<(userId: string) => Promise<Account>>();
let db: ReturnType<typeof mockSupabase>;
let warn: MockInstance<Logger['warn']>;

/** Claire locks Marc's duty; the lock messages queued. */
async function locked(seed: Record<string, TableSeed>): Promise<unknown[]> {
  db = mockSupabase(seed);
  const supabase = { ...db, getAuthAdminUser };
  await new NotificationEventsService(supabase as never, scheduler as never).assignmentChanged(
    'd-marc',
  );
  return scheduler.sendImmediate.mock.calls.map(([job]) => job as unknown);
}

const toMarc = (email: string | null) => ({
  kind: 'assignment_changed',
  entityId: 'd-marc',
  userId: MARC,
  title: "Affectation d'arbitrage mise à jour / Referee assignment updated",
  body: 'Mise à jour : Referee, L1-P1-M1. / Referee for L1-P1-M1 has been updated.',
  url: '/notifications',
  email,
  emailSubject: "Affectation d'arbitrage mise à jour / Referee assignment updated",
  preference: 'schedule_changes',
});

beforeEach(() => {
  scheduler.sendImmediate.mockReset();
  getAuthAdminUser.mockReset().mockResolvedValue(HIS_ACCOUNT);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the lock message of Marc's duty", () => {
  it('tells Marc, who has no row on the roster of the Event', async () => {
    expect(await locked(tables([PROFILE]))).toEqual([toMarc('marc@example.com')]);
    expect(getAuthAdminUser.mock.calls).toEqual([[MARC]]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('writes to the address of his account, not to one typed on his roster row', async () => {
    const typed = {
      id: 'p-marc',
      event_id: 'e-open',
      global_person_id: HIS_PROFILE,
      claimed_by_user_id: MARC,
      email: 'typed-by-claire@example.com',
    };
    const seed = { ...tables([PROFILE]), persons: { rows: [typed] } };
    expect(await locked(seed)).toEqual([toMarc('marc@example.com')]);
  });

  it('rings his phone only when his account has no address', async () => {
    getAuthAdminUser.mockResolvedValue({ ok: true, status: 200, data: { id: MARC } });
    expect(await locked(tables([PROFILE]))).toEqual([toMarc(null)]);
    expect(warn).not.toHaveBeenCalled();
  });

  // 0: no answer. 200: an answer that is not an account.
  it.each([0, 404, 503, 200])(
    'rings his phone only when his account cannot be read (%i), and the log says so',
    async (status) => {
      getAuthAdminUser.mockResolvedValue({ ok: status === 200, status, data: null });
      expect(await locked(tables([PROFILE]))).toEqual([toMarc(null)]);
      expect(warn.mock.calls).toEqual([[`Lock message of d-marc: account unreadable: ${status}`]]);
    },
  );

  it('reads who holds the profile, and nothing else of it', async () => {
    await locked(tables([PROFILE]));
    // The double ignores projections: a column left out of the read would still be handed back.
    expect(selectsFor(db.from, 'global_persons')).toEqual(['claimed_by_user_id']);
  });

  it('reads the duty with its role and the label of its bout', async () => {
    await locked(tables([PROFILE]));
    expect(selectsFor(db.from, 'referee_assignments')).toEqual([
      'id, person_id, role, matches ( match_number_label )',
    ]);
  });
});

describe('a duty with nobody to tell', () => {
  it.each<[string, SupabaseRow[]]>([
    ['a profile nobody holds', [{ id: HIS_PROFILE, claimed_by_user_id: null, email: 'm@x.fr' }]],
    ['a profile that is gone', []],
    ['the profile of another referee', [{ id: 'gp-anna', claimed_by_user_id: 'u-anna' }]],
  ])('%s: nobody is told, and no account is read', async (_, profiles) => {
    expect(await locked(tables(profiles))).toEqual([]);
    expect(getAuthAdminUser).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a duty that names no referee: no profile is read', async () => {
    expect(await locked(tables([PROFILE], { ...DUTY, person_id: null }))).toEqual([]);
    expect(selectsFor(db.from, 'global_persons')).toEqual([]);
  });

  it('a profile that cannot be read: nobody is told, and the log says so', async () => {
    const seed = { ...tables([]), global_persons: { error: { message: 'boom' } } };
    expect(await locked(seed)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(`Lock message of d-marc: profile unreadable: boom`);
    expect(getAuthAdminUser).not.toHaveBeenCalled();
  });
});
