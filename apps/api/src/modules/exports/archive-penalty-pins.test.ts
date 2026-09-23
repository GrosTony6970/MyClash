/**
 * An archive restore is the fifth penalty-ruleset pin door (operator ruling
 * 67). A restored Event or Tournament keeps only a pin the target organisation
 * may pin — the built-in, a shared ruleset, or its own — and the restore says
 * how many pins it cleared.
 *
 * The stories: Mallory hand-edits an archive so its Tournament pins Club B's
 * private ruleset and restores it into her own Event; Sam, admin of both clubs,
 * restores a Club B Event into Club A. Either way Club A's members would read
 * Club B's rules through the restored Tournament.
 */
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { ArchiveService } from './archive.service';

const BUILT_IN = '66666666-6666-4666-8666-666666666666';
const SHARED_B = '77777777-7777-4777-8777-777777777777';
const PRIVATE_A = '88888888-8888-4888-8888-888888888888';
const PRIVATE_B = '99999999-9999-4999-8999-999999999999';
const NOBODY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CONFIRMATION = 'RESTORE MYCLASH ARCHIVE';

const RULESETS = {
  rows: [
    {
      id: PRIVATE_B,
      version: '1.0.4',
      built_in: false,
      public_visibility: false,
      owner_organization_id: 'org-b',
    },
    {
      id: PRIVATE_A,
      version: '2.1.0',
      built_in: false,
      public_visibility: false,
      owner_organization_id: 'org-a',
    },
    {
      id: SHARED_B,
      version: '3.0.0',
      built_in: false,
      public_visibility: true,
      owner_organization_id: 'org-b',
    },
    {
      id: BUILT_IN,
      version: '1.0.0',
      built_in: true,
      public_visibility: false,
      owner_organization_id: null,
    },
  ],
};

let db: ReturnType<typeof mockSupabase>;
let service: ArchiveService;

function build(penaltyRulesets: object = RULESETS) {
  db = mockSupabase({
    penalty_rulesets: penaltyRulesets,
    events: {
      rows: [
        { id: 'event-a', organization_id: 'org-a', slug: 'home', name: 'Home', status: 'draft' },
      ],
    },
    tournaments: { rows: [] },
    lices: { rows: [] },
    audit_log: { rows: [] },
  });
  const orgs = { assertOrgRole: vi.fn(async () => undefined) };
  service = new ArchiveService({ service: db.service } as never, orgs as never);
}

beforeEach(() => build());

function tournament(id: string, penaltyRulesetId: string | null) {
  return {
    id,
    event_id: 'event-b',
    slug: id,
    name: id,
    penalty_ruleset_id: penaltyRulesetId,
    penalty_ruleset_version: penaltyRulesetId ? 'archived-version' : null,
  };
}

function archive(scope: 'event' | 'tournament', tournaments: Record<string, unknown>[]) {
  return Buffer.from(
    JSON.stringify({
      manifest: 'myclash.archive.v1',
      version: 1,
      generatedAt: new Date().toISOString(),
      scope,
      include: 'structure',
      source: {
        eventId: 'event-b',
        eventSlug: 'away',
        eventName: 'Away',
        eventStatus: 'completed',
      },
      data: {
        events: [
          {
            id: 'event-b',
            organization_id: 'org-b',
            slug: 'away',
            name: 'Away',
            status: 'completed',
            penalty_ruleset_id: PRIVATE_B,
            penalty_ruleset_version: '1.0.4',
          },
        ],
        tournaments,
      },
      reports: { tournaments: [] },
    }),
  );
}

/** Every row written to `table`, a batch insert unrolled. */
const rowsOf = (table: string) =>
  writesTo(db, table).flatMap(
    (write) => (Array.isArray(write.row) ? write.row : [write.row]) as Record<string, unknown>[],
  );

const pinOf = (row: Record<string, unknown> | undefined) => ({
  id: row?.['penalty_ruleset_id'],
  version: row?.['penalty_ruleset_version'],
});

describe('archive restore penalty pins', () => {
  it('clears the pins the target club may not pin, keeps the rest, and counts the cleared ones', async () => {
    const result = await service.restoreArchiveCopy(
      archive('event', [
        tournament('t-foreign', PRIVATE_B),
        tournament('t-shared', SHARED_B),
        tournament('t-own', PRIVATE_A),
        tournament('t-builtin', BUILT_IN),
        tournament('t-missing', NOBODY),
        tournament('t-none', null),
      ]),
      'u-admin-ab',
      { targetOrganizationId: 'org-a', confirmation: CONFIRMATION },
    );

    const [event] = rowsOf('events');
    expect(pinOf(event)).toEqual({ id: null, version: null });
    const bySlug = new Map(rowsOf('tournaments').map((row) => [String(row['slug']), pinOf(row)]));
    expect(bySlug.get('t-foreign')).toEqual({ id: null, version: null });
    // A kept pin keeps the version the archive froze, not today's.
    expect(bySlug.get('t-shared')).toEqual({ id: SHARED_B, version: 'archived-version' });
    expect(bySlug.get('t-own')).toEqual({ id: PRIVATE_A, version: 'archived-version' });
    expect(bySlug.get('t-builtin')).toEqual({ id: BUILT_IN, version: 'archived-version' });
    expect(bySlug.get('t-missing')).toEqual({ id: null, version: null });
    expect(bySlug.get('t-none')).toEqual({ id: null, version: null });
    // The Event's own pin, the foreign Tournament pin and the missing one.
    expect(result.droppedPenaltyRulesetPins).toBe(3);
  });

  it("clears a hand-edited Tournament pin to another club's private ruleset", async () => {
    const result = await service.restoreArchiveCopy(
      archive('tournament', [tournament('t-edited', PRIVATE_B)]),
      'u-admin-a',
      { targetEventId: 'event-a', confirmation: CONFIRMATION },
    );

    const [restored] = rowsOf('tournaments');
    expect(pinOf(restored)).toEqual({ id: null, version: null });
    expect(result.droppedPenaltyRulesetPins).toBe(1);
  });

  it('keeps a Tournament pin to its own club’s ruleset and clears nothing', async () => {
    const result = await service.restoreArchiveCopy(
      archive('tournament', [tournament('t-own', PRIVATE_A)]),
      'u-admin-a',
      { targetEventId: 'event-a', confirmation: CONFIRMATION },
    );

    const [restored] = rowsOf('tournaments');
    expect(pinOf(restored)).toEqual({ id: PRIVATE_A, version: 'archived-version' });
    expect(result.droppedPenaltyRulesetPins).toBe(0);
  });

  it('fails the restore on a failed ruleset read, before anything is written', async () => {
    build({ data: null, error: { message: 'connection reset' } });
    await expect(
      service.restoreArchiveCopy(
        archive('tournament', [tournament('t-own', PRIVATE_A)]),
        'u-admin-a',
        { targetEventId: 'event-a', confirmation: CONFIRMATION },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writesTo(db, 'tournaments')).toEqual([]);
  });
});
