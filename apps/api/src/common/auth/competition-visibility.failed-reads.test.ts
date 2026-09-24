/**
 * A failed read is not a verdict: the insider check behind every hidden-draft
 * gate (rulings 81-83) must fail loudly when it cannot read, never answer
 * "not a member".
 *
 * Until 2026-09-24 `assertOrgRole` ignored its read error, so a failed
 * membership read became "not a member" (a 403), and `isInsider` turned every
 * refusal into `false`: a club member reading a draft Event during a database
 * blip got the unknown answer. On the venues page that answer is `[]`, and the
 * page writes back the list it read — so a blip could detach every venue of the
 * Event with no error on screen. A failed staff read was a 400 carrying the
 * database's own words, and so was a failed bout or piste read. All are now a
 * 5xx.
 */
import 'reflect-metadata';
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase } from '../testing/supabase-chain';
import { OrganizationsService } from '../../modules/organizations/organizations.service';
import { isInsider, matchVisibility, seesHiddenOnLice } from './competition-visibility';
import { assertCanReadEvent } from './event-authz';

const EVENT = { id: 'event-1', organization_id: 'org-a' };
const FAILED = { data: null, error: { message: 'connection reset' } };

function deps(tables: Parameters<typeof mockSupabase>[0]) {
  const db = mockSupabase(tables);
  const supabase = { service: db.service };
  return { supabase, orgs: new OrganizationsService(supabase as never) } as never;
}

const member = { userId: 'u-member', staff: null };
const staff = { userId: 'anonymous', staff: { staffId: 'staff-1', eventId: 'event-1' } };

describe('assertOrgRole on a failed read', () => {
  it('fails loudly instead of calling the caller a stranger', async () => {
    const orgs = new OrganizationsService({
      service: mockSupabase({ organization_members: FAILED }).service,
    } as never);
    const refusal = orgs.assertOrgRole('org-a', 'u-member', 'read_only');
    await expect(refusal).rejects.toThrow(/^membership read failed: connection reset$/);
    await expect(orgs.assertOrgRole('org-a', 'u-member', 'read_only')).rejects.not.toBeInstanceOf(
      HttpException,
    );
  });

  // The sentinels are no user ids: `user_id` is a UUID column, so reading them
  // would fail the cast and read as a failed read. No table is seeded here: a
  // read would throw "unconfigured table", not refuse.
  it('refuses a signed-out sentinel, or no organisation, as not a member, before any read', async () => {
    const orgs = new OrganizationsService({ service: mockSupabase({}).service } as never);
    const refusals = [
      ...['anonymous', 'unknown', ''].map((sentinel) => ['org-a', sentinel]),
      // A ruleset with no owning club names no organisation.
      ['', 'u-member'],
    ];
    for (const [orgId, userId] of refusals) {
      const refusal = orgs.assertOrgRole(orgId!, userId!, 'read_only');
      await expect(refusal, `${orgId}/${userId}`).rejects.toBeInstanceOf(ForbiddenException);
      await expect(orgs.assertOrgRole(orgId!, userId!, 'read_only')).rejects.toThrow(
        'You are not a member of this organization',
      );
    }
  });

  it('still refuses a caller who is not a member', async () => {
    const orgs = new OrganizationsService({
      service: mockSupabase({ organization_members: { rows: [] } }).service,
    } as never);
    await expect(orgs.assertOrgRole('org-a', 'u-stranger', 'read_only')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('isInsider on a failed read (rulings 81-83)', () => {
  it('fails loudly when the membership read fails', async () => {
    const check = () => isInsider(deps({ organization_members: FAILED }), EVENT, member);
    await expect(check()).rejects.toThrow(/^membership read failed: connection reset$/);
  });

  it('fails loudly, with no database words in a 400, when the staff read fails', async () => {
    const check = () => isInsider(deps({ event_staff_accounts: FAILED }), EVENT, staff);
    await expect(check()).rejects.toThrow(/^staff session read failed: connection reset$/);
    await expect(check()).rejects.not.toBeInstanceOf(HttpException);
  });

  it('fails loudly, with no database words in a 400, when the bout or piste read fails', async () => {
    const bout = () => matchVisibility(deps({ matches: FAILED }), 'm-1', member);
    const piste = () => seesHiddenOnLice(deps({ lices: FAILED }), 'l-1', member);
    await expect(bout()).rejects.toThrow(/^bout read failed: connection reset$/);
    await expect(bout()).rejects.not.toBeInstanceOf(HttpException);
    await expect(piste()).rejects.toThrow(/^piste read failed: connection reset$/);
    await expect(piste()).rejects.not.toBeInstanceOf(HttpException);
  });

  it('still answers false for a caller who is not a member', async () => {
    const tables = { organization_members: { rows: [] } };
    expect(await isInsider(deps(tables), EVENT, { userId: 'u-stranger', staff: null })).toBe(false);
  });

  it('still answers true for a member', async () => {
    const tables = {
      organization_members: {
        rows: [{ organization_id: 'org-a', user_id: 'u-member', role: 'read_only' }],
      },
    };
    expect(await isInsider(deps(tables), EVENT, member)).toBe(true);
  });
});

describe('the draft-Event gate on a failed read (assertCanReadEventRow)', () => {
  const draft = {
    events: { rows: [{ id: 'event-1', status: 'draft', organization_id: 'org-a' }] },
  };
  const read = (tables: Parameters<typeof mockSupabase>[0]) =>
    assertCanReadEvent(deps({ ...draft, ...tables }), 'event-1', async () => 'u-member');

  it('fails loudly when the membership read fails, never as an unknown Event', async () => {
    await expect(read({ organization_members: FAILED })).rejects.toThrow(
      /^membership read failed: connection reset$/,
    );
  });

  it('still hides a draft Event from a caller who is not in its club', async () => {
    await expect(read({ organization_members: { rows: [] } })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
