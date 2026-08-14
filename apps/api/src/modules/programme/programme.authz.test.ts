import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ProgrammeService } from './programme.service';
import { LicesService } from '../lices/lices.service';

/**
 * The acceptance criterion for the slice: a member of ANOTHER organisation is
 * refused on every schedule write.
 *
 * These routes had no authorization of any kind. Every one runs through the
 * service-role Supabase client, which is BYPASSRLS, so the org-role assertion
 * is the entire boundary — not defence in depth. `DELETE /programme/full` sat
 * in that set, and it unschedules every match in the event.
 *
 * The check is asserted here rather than read off the code, because the whole
 * defect was a summary line that said "(org admin+)" above a handler that
 * enforced nothing.
 */

const ORG_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const LICE_ID = '11111111-1111-4111-8111-111111111111';
const OUTSIDER = 'member-of-another-org';

/** Refuses everyone, the way `assertOrgRole` refuses a non-member. */
function refusingOrgs() {
  return {
    assertOrgRole: vi.fn(() =>
      Promise.reject(new ForbiddenException('You are not a member of this organization')),
    ),
  };
}

/** Resolves the event/lice rows the authz hop needs, and nothing else. */
function supabaseFor(rows: Record<string, unknown>) {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const key of [
      'select',
      'eq',
      'in',
      'order',
      'insert',
      'update',
      'upsert',
      'delete',
      'not',
    ])
      c[key] = vi.fn(() => c);
    c['maybeSingle'] = vi.fn(() => Promise.resolve(result));
    c['single'] = vi.fn(() => Promise.resolve(result));
    return c;
  };
  return {
    service: {
      from: vi.fn((table: string) => chain(rows[table] ?? { data: null, error: null })),
    },
  };
}

const EVENT_ROWS = {
  events: { data: { organization_id: ORG_OWNER }, error: null },
  lices: { data: { event_id: EVENT_ID }, error: null },
};

function programme() {
  const orgs = refusingOrgs();
  return { svc: new ProgrammeService(supabaseFor(EVENT_ROWS) as never, orgs as never), orgs };
}

function lices() {
  const orgs = refusingOrgs();
  return { svc: new LicesService(supabaseFor(EVENT_ROWS) as never, orgs as never), orgs };
}

describe('a member of another organisation cannot write the programme', () => {
  const cases: Array<[string, (s: ProgrammeService) => Promise<unknown>]> = [
    ['saveBlocks', (s) => s.saveBlocks(EVENT_ID, { blocks: [] } as never, OUTSIDER)],
    ['suggest', (s) => s.suggest(EVENT_ID, {} as never, OUTSIDER)],
    ['generate', (s) => s.generate(EVENT_ID, {}, OUTSIDER)],
    ['createBlock', (s) => s.createBlock(EVENT_ID, {} as never, OUTSIDER)],
    ['moveBlock', (s) => s.moveBlock(EVENT_ID, 'b1', { newStartTime: '10:00' }, OUTSIDER)],
    ['resizeBlock', (s) => s.resizeBlock(EVENT_ID, 'b1', { newEndTime: '11:00' }, OUTSIDER)],
    ['scheduleGroup', (s) => s.scheduleGroup(EVENT_ID, {} as never, OUTSIDER)],
    ['updateBlockLabel', (s) => s.updateBlockLabel(EVENT_ID, 'b1', {} as never, OUTSIDER)],
    ['deleteBlock', (s) => s.deleteBlock(EVENT_ID, 'b1', OUTSIDER)],
    ['resetAll', (s) => s.resetAll(EVENT_ID, OUTSIDER)],
  ];

  for (const [name, call] of cases) {
    it(`refuses ${name}`, async () => {
      const { svc } = programme();
      await expect(call(svc)).rejects.toThrow(ForbiddenException);
    });
  }

  it('asks for the editor bar on the event that owns the row', async () => {
    const { svc, orgs } = programme();

    await expect(svc.resetAll(EVENT_ID, OUTSIDER)).rejects.toThrow(ForbiddenException);

    expect(orgs.assertOrgRole).toHaveBeenCalledWith(ORG_OWNER, OUTSIDER, 'editor');
  });

  /**
   * `scheduleGroupUnchecked` deliberately skips the assertion for the one
   * trusted server-side caller (Swiss round advance). Its name is the warning;
   * this pins that only it behaves that way.
   */
  it('still exposes an unchecked path, named so the omission is deliberate', () => {
    const { svc } = programme();

    expect(typeof (svc as unknown as Record<string, unknown>)['scheduleGroupUnchecked']).toBe(
      'function',
    );
  });
});

describe('a member of another organisation cannot write the lices', () => {
  it('refuses create', async () => {
    const { svc } = lices();
    await expect(svc.create(EVENT_ID, { name: 'Lice 1' } as never, OUTSIDER)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses update', async () => {
    const { svc } = lices();
    await expect(svc.update(LICE_ID, { name: 'Renamed' } as never, OUTSIDER)).rejects.toThrow(
      ForbiddenException,
    );
  });

  /** Deleting a piste unschedules every match on it — ON DELETE SET NULL. */
  it('refuses delete', async () => {
    const { svc } = lices();
    await expect(svc.delete(LICE_ID, OUTSIDER)).rejects.toThrow(ForbiddenException);
  });
});
