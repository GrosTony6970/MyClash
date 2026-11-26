import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import type {
  AssignmentBoardPool,
  AssignmentBoardRoleSlot,
} from '../../referees/_components/useAssignmentBoard';
import { RefereesTab } from './RefereesTab';

/**
 * The bracket's Referees tab: one card per bout, grouped by round. A referee must know
 * WHERE to go, so each card names its piste beside its time, as the Pools and Swiss
 * cards do.
 */

const slot = (role: string, displayName: string | null): AssignmentBoardRoleSlot => ({
  slotIndex: 0,
  displayName: null,
  allowedSkillIds: [],
  role,
  assignment: displayName
    ? {
        id: `a-${role}-${displayName}`,
        userId: null,
        personId: null,
        displayName,
        status: 'assigned',
        autoAssigned: false,
      }
    : null,
  missingReasons: [],
  candidates: { recommended: [], warning: [], blocked: [] },
});

const bout = (
  code: string,
  liceId: string | null,
  roleSlots: AssignmentBoardRoleSlot[] = [],
): AssignmentBoardPool => ({
  id: `match-${code}`,
  name: code,
  tournamentId: 't1',
  tournamentName: 'Longsword Open',
  liceId,
  scheduledStart: '2027-05-01T07:00:00.000Z',
  scheduledEnd: null,
  kind: 'bracket',
  members: [],
  roleSlots,
});

let pools: AssignmentBoardPool[] = [];

vi.mock('../../referees/_components/useAssignmentBoard', () => ({
  useAssignmentBoard: () => ({
    board: { pools, unscheduledPools: [], candidates: [], locked: false },
    allBoardPools: pools,
    loading: false,
    busy: false,
    error: null,
    skillNameById: new Map(),
    skillColorById: new Map(),
    liceNameById: new Map([['L2', 'Piste 2']]),
    manualAssign: vi.fn(),
    unassign: vi.fn(),
  }),
}));

let container: HTMLDivElement;
let root: Root;

async function render(boardPools: AssignmentBoardPool[]) {
  pools = boardPools;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <RefereesTab eventId="ev1" tournamentId="t1" isReadOnly={false} />
      </I18nProvider>,
    );
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The card of one bout, found by its code. */
const card = (code: string) =>
  [...container.querySelectorAll('div.rounded-lg')].find((el) =>
    el.querySelector('p.font-semibold')?.textContent?.includes(code),
  );

describe('a bracket bout card', () => {
  beforeEach(async () => {
    await render([bout('LSW-B-R16-M7', 'L2'), bout('LSW-B-R16-M5', null)]);
  });

  it('names its piste beside its time', () => {
    expect(card('LSW-B-R16-M7')?.textContent).toMatch(/Piste 2 · \d{2}:\d{2}/);
  });

  it('shows only the time while the bout has no piste', () => {
    const text = card('LSW-B-R16-M5')?.textContent ?? '';
    expect(text).toMatch(/\d{2}:\d{2}/);
    expect(text).not.toContain('Piste');
    expect(text).not.toContain('·');
  });
});
