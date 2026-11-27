/**
 * A bracket slot read with its team embeds (`SLOT_TEAM_EMBEDS`) keys each side by the embed. A raw
 * slot row (`phases/seat-columns.ts`'s `SlotSides`) holds team ids, not embeds: given to this
 * reader, its team sides would come back null. The embeds are required, so the compiler refuses it.
 */
import { describe, expect, it } from 'vitest';
import { sideKey } from '@myclash/types/side-key';
import type { SlotSides } from '../phases/seat-columns';
import { slotSideKeys, type EmbeddedSlotSides } from './bracket-slot-sides';

const LIONS = { id: 'team-lions', name: 'Lions', color: '#c0392b', logo_url: null };

describe('the side keys of a slot read with its team embeds', () => {
  it('keys a team side by its embed and a Fighter side by its Registration', () => {
    const slot: EmbeddedSlotSides = {
      registration_a_id: null,
      registration_b_id: 'reg-anna',
      team_a: LIONS,
      team_b: null,
    };

    expect(slotSideKeys(slot)).toEqual({
      a: sideKey(null, 'team-lions'),
      b: sideKey('reg-anna', null),
    });
  });

  it('takes no raw slot row: the compiler refuses it, since its teams would be lost', () => {
    const raw: SlotSides = {
      registration_a_id: null,
      registration_b_id: null,
      team_a_id: 'team-lions',
      team_b_id: 'team-wolves',
    };

    // @ts-expect-error a raw row has team ids, not the team embeds this reads
    const keys = slotSideKeys(raw);

    // What the compiler stops: both team sides come back as no side at all.
    expect(keys).toEqual({ a: null, b: null });
  });
});
