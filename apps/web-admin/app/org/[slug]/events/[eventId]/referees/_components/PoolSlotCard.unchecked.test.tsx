import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { PoolSlotCard, type PoolCardPool, type PoolCardRoleSlot } from './PoolSlotCard';

/**
 * The referee board's card of a team Pool (CLAUDE.md rule 8; ADR-016, 2026-11-13). In slice
 * 1b-1 a team's slots have no names, so the one checker cannot stop one of its Fighters being
 * booked to referee while the team fights: the board's `uncheckedFighters` marks the Pool, and
 * the card says so. A Pool of Fighters carries no such note.
 */
const NOTICE = 'MyClash cannot check these Fighters: this team has Fighters with no name';

const slot: PoolCardRoleSlot = {
  slotIndex: 1,
  displayName: null,
  role: 'arbitre_declarant',
  assignment: null,
  missingReasons: [],
};

const teamPool: PoolCardPool<PoolCardRoleSlot> = {
  id: 'pool-1',
  name: 'Pool A',
  tournamentName: 'Team Longsword',
  scheduledStart: null,
  scheduledEnd: null,
  uncheckedFighters: true,
  members: [
    { sideId: 'team-lyon', registrationId: null, personName: 'Lyon Blades', clubLabel: null },
    { sideId: 'team-paris', registrationId: null, personName: 'Paris Rapiers', clubLabel: null },
  ],
  roleSlots: [slot],
};

const fighterPool: PoolCardPool<PoolCardRoleSlot> = {
  ...teamPool,
  tournamentName: 'Longsword',
  uncheckedFighters: undefined,
  members: [
    { sideId: 'reg-anna', registrationId: 'reg-anna', personName: 'Anna Roux', clubLabel: null },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The card as the referee board renders it (`renderPoolCard` sets no notice prop). */
async function render(pool: PoolCardPool<PoolCardRoleSlot>, showUncheckedNotice?: boolean) {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <PoolSlotCard
          pool={pool}
          liceName={null}
          isReadOnly={false}
          busy={false}
          skillNameById={new Map()}
          skillColorById={new Map()}
          onAssignClick={() => undefined}
          onUnassign={() => undefined}
          {...(showUncheckedNotice === undefined ? {} : { showUncheckedNotice })}
        />
      </I18nProvider>,
    );
  });
}

const note = () => container.querySelector('[role="note"]');

describe('the referee board card of a team Pool', () => {
  it('says MyClash cannot check its Fighters, and lists the teams', async () => {
    await render(teamPool);
    expect(note()?.textContent).toBe(NOTICE);
    expect(container.textContent).toContain('Teams');
    expect(container.textContent).toContain('Lyon Blades');
  });

  it('says nothing of the kind for a Pool of Fighters', async () => {
    await render(fighterPool);
    expect(note()).toBeNull();
    expect(container.textContent).toContain('Fighters');
  });

  it('leaves the note to the page that turns it off (the Pools page says it once)', async () => {
    await render(teamPool, false);
    expect(note()).toBeNull();
  });
});
