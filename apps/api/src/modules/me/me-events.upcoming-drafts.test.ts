/**
 * `GET /me/upcoming` (ruling 164): a draft Event is left out for a signed-in caller who is neither
 * a member of its club nor an ACTIVE staff session of it, and its schedule is not even read.
 * `getSchedule` leaves out her bouts in a draft Tournament for everyone; its double here answers
 * as it does. Rows in me-events.drafts.fixtures.ts.
 */
import 'reflect-metadata';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import {
  baseTables,
  clubMember,
  meController,
  scheduleDouble,
  signedIn,
  type Tables,
  withStaff,
} from './me-events.drafts.fixtures';

let db: ReturnType<typeof mockSupabase>;
let upcomingOf: ReturnType<typeof scheduleDouble>;

function seed(tables: Tables = baseTables()) {
  db = mockSupabase(tables);
}

const upcoming = async (req: object = signedIn) =>
  (await meController(db, upcomingOf).upcoming(req as never, '20')).map((item) => item.eventId);

beforeEach(() => {
  seed();
  upcomingOf = scheduleDouble();
});

describe('/me/upcoming leaves out an Event hidden from her (ruling 164)', () => {
  it("reads no schedule of a draft Event for an outsider, and her public Events' ones", async () => {
    expect(await upcoming()).toEqual(['e-pub']);
    expect(upcomingOf.mock.calls.map((call) => call[0])).toEqual(['e-pub', 'e-only']);
  });

  it('shows a member of the club the draft Event too', async () => {
    seed(clubMember());
    expect(await upcoming()).toEqual(['e-pub', 'e-draft']);
  });

  it('shows the draft Event to its own active staff session only', async () => {
    expect(await upcoming(withStaff('staff-draft', 'e-draft'))).toEqual(['e-pub', 'e-draft']);
    expect(await upcoming(withStaff('staff-pub', 'e-pub'))).toEqual(['e-pub']);
  });

  it('shows a disabled staff session only what an outsider sees', async () => {
    expect(await upcoming(withStaff('staff-off', 'e-pub'))).toEqual(['e-pub']);
    expect(upcomingOf.mock.calls.map((call) => call[0])).toEqual(['e-pub', 'e-only']);
  });

  it('refuses a caller with no login before reading anything', async () => {
    const failure = await upcoming({ headers: {} }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnauthorizedException);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('5xxs when the Events cannot be read', async () => {
    seed({ ...baseTables(), events: { data: null, error: { message: 'boom' } } });
    const failure = await upcoming().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect(String(failure)).toContain('events read failed: boom');
  });
});
