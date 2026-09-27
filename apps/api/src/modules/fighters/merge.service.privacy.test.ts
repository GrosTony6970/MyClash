/**
 * A merge moves the merged-away profile's Event rows to the surviving one, and they obey the
 * survivor's privacy choices from then on (ruling 132). So the survivor keeps the STRICTER answer
 * of the two per choice (ruling 157): Léa said "no followers" on one of her two profiles, and the
 * merge must not make her followable. Seeded tables, so the survivor's write names its row.
 */
import { describe, expect, it } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { FighterMergeService } from './merge.service';

type Choices = { hide_workshops_publicly: boolean; allow_being_followed: boolean };
const OPEN: Choices = { hide_workshops_publicly: false, allow_being_followed: true };
const CLOSED: Choices = { hide_workshops_publicly: true, allow_being_followed: false };

async function survivorWrite(source: Choices, target: Choices) {
  const db = mockSupabase({
    global_persons: {
      rows: [
        { id: 'source', merged_into_id: null, deleted_at: null, ...source },
        { id: 'target', merged_into_id: null, deleted_at: null, ...target },
      ],
    },
    persons: { rows: [] },
    workshop_instructors: { rows: [] },
    directory_follows: { rows: [] },
    audit_log: { data: null, error: null },
  });
  await new FighterMergeService(db as never).merge({ sourceId: 'source', targetId: 'target' }, 'a');
  const [write] = writesTo(db, 'global_persons').filter((w) =>
    w.filters.some((f) => f.args[1] === 'target'),
  );
  return write!.row as Record<string, unknown>;
}

describe('FighterMergeService — privacy choices (ruling 157)', () => {
  it("gives the survivor the merged-away profile's stricter answers", async () => {
    expect(await survivorWrite(CLOSED, OPEN)).toMatchObject({
      hide_workshops_publicly: true,
      allow_being_followed: false,
    });
  });

  it("never loosens the survivor's own stricter answers", async () => {
    const row = await survivorWrite(OPEN, CLOSED);
    expect(row).not.toHaveProperty('hide_workshops_publicly');
    expect(row).not.toHaveProperty('allow_being_followed');
  });

  it('writes neither choice when both profiles agree', async () => {
    for (const both of [OPEN, CLOSED]) {
      const row = await survivorWrite(both, both);
      expect(row).not.toHaveProperty('hide_workshops_publicly');
      expect(row).not.toHaveProperty('allow_being_followed');
    }
  });

  it('folds each choice on its own', async () => {
    const hides = { hide_workshops_publicly: true, allow_being_followed: true };
    const refuses = { hide_workshops_publicly: false, allow_being_followed: false };
    expect(await survivorWrite(hides, refuses)).toMatchObject({ hide_workshops_publicly: true });
    expect(await survivorWrite(refuses, hides)).toMatchObject({ allow_being_followed: false });
  });
});

/**
 * The account moves with the Event rows (ruling 159). A merge left Léa's account on the
 * merged-away profile while her Events followed the survivor, so her privacy settings edited
 * choices nothing read. An account owns at most one profile (0063), so the old link goes first.
 */
describe('FighterMergeService — the account link (ruling 159)', () => {
  const profile = (id: string, claimedBy: string | null, extra: Record<string, unknown> = {}) => ({
    id,
    merged_into_id: null,
    deleted_at: null,
    claimed_by_user_id: claimedBy,
    ...OPEN,
    ...extra,
  });
  const claimWrites = (db: ReturnType<typeof mockSupabase>) =>
    writesTo(db, 'global_persons').filter((w) =>
      Object.hasOwn(w.row as object, 'claimed_by_user_id'),
    );
  const release = (from: string) => ({
    table: 'global_persons',
    op: 'update',
    row: { claimed_by_user_id: null },
    filters: [
      { method: 'eq', args: ['id', from] },
      { method: 'eq', args: ['claimed_by_user_id', 'u-lea'] },
    ],
  });
  const take = (to: string) => ({
    table: 'global_persons',
    op: 'update',
    row: { claimed_by_user_id: 'u-lea' },
    filters: [{ method: 'eq', args: ['id', to] }],
  });

  async function merged(sourceClaim: string | null, targetClaim: string | null) {
    const db = mockSupabase({
      global_persons: { rows: [profile('source', sourceClaim), profile('target', targetClaim)] },
      persons: { rows: [] },
      workshop_instructors: { rows: [] },
      directory_follows: { rows: [] },
      audit_log: { data: null, error: null },
    });
    await new FighterMergeService(db as never).merge(
      { sourceId: 'source', targetId: 'target' },
      'a',
    );
    const audit = writesTo(db, 'audit_log')[0]!.row as {
      payload_json: { moved: { claimUserId?: string } };
    };
    return { db, moved: audit.payload_json.moved };
  }

  function reverted(holder: { target: string | null }, claimUserId?: string) {
    return mockSupabase({
      audit_log: [
        {
          data: {
            id: 'audit-1',
            action: 'fighter.merge',
            entity_id: 'source',
            created_at: new Date().toISOString(),
            payload_json: {
              source: { id: 'source' },
              target: { id: 'target' },
              moved: { personIds: [], workshopInstructorIds: [], claimUserId },
            },
          },
          error: null,
        },
        { data: [], error: null },
        { data: null, error: null },
      ],
      global_persons: {
        rows: [
          profile('source', null, { merged_into_id: 'target' }),
          profile('target', holder.target, CLOSED),
        ],
      },
    });
  }

  it("moves the merged-away profile's account to the survivor, letting go of the old link first", async () => {
    const { db, moved } = await merged('u-lea', null);
    expect(claimWrites(db)).toEqual([release('source'), take('target')]);
    expect(moved.claimUserId).toBe('u-lea');
  });

  it('leaves the link where it is when another account owns the survivor, or nobody owned the source', async () => {
    for (const [source, target] of [
      ['u-lea', 'u-other'],
      [null, null],
      [null, 'u-other'],
    ] as const) {
      const { db, moved } = await merged(source, target);
      expect(claimWrites(db)).toEqual([]);
      expect(moved).not.toHaveProperty('claimUserId');
    }
  });

  it('a revert moves the account back to the restored profile', async () => {
    const db = reverted({ target: 'u-lea' }, 'u-lea');
    await new FighterMergeService(db as never).revertMerge('audit-1', 'actor');
    expect(claimWrites(db)).toEqual([release('target'), take('source')]);
  });

  it('a revert links nobody when the account no longer holds the survivor', async () => {
    const db = reverted({ target: null }, 'u-lea');
    await new FighterMergeService(db as never).revertMerge('audit-1', 'actor');
    expect(claimWrites(db)).toEqual([release('target')]);
  });

  it("a revert moves no account when the merge moved none, and leaves the survivor's choices strict (ruling 157)", async () => {
    const db = reverted({ target: 'u-other' });
    await new FighterMergeService(db as never).revertMerge('audit-1', 'actor');
    expect(claimWrites(db)).toEqual([]);
    for (const write of writesTo(db, 'global_persons')) {
      expect(write.row).not.toHaveProperty('allow_being_followed');
      expect(write.row).not.toHaveProperty('hide_workshops_publicly');
    }
  });
});
