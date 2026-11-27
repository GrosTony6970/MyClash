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

async function render(boardPools: AssignmentBoardPool[], locale: 'en' | 'fr' = 'en') {
  pools = boardPools;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
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

/**
 * A French organiser read "ROUND OF 16" over the bouts: the round headings came from an
 * English label. They are named in the reader's language, like the bracket's columns.
 */
describe('the round headings', () => {
  const headings = () => [...container.querySelectorAll('h3')].map((h) => h.textContent);

  it("are in the reader's language", async () => {
    await render([bout('LSW-B-R16-M1', null), bout('LSW-B-QF-M1', null)], 'fr');
    expect(headings()).toEqual(['Tableau de 16', 'Quarts de finale']);
  });

  it('name a bout with no round by its phase, never "Other"', async () => {
    await render([bout('LSW-B-M7', null)], 'fr');
    expect(headings()).toEqual(['Tableau']);
  });
});

/**
 * The organiser types a referee's name to see every bout that referee works on.
 * Accents, case and word order do not count; a bout with nobody on it drops out.
 */
describe('the referee-name filter', () => {
  beforeEach(async () => {
    await render([
      bout('LSW-B-R16-M1', null, [slot('assessor', 'Mathieu Bellini')]),
      bout('LSW-B-R16-M2', null, [slot('table', 'François Berdou')]),
      bout('LSW-B-R16-M3', null, [slot('main', null)]),
    ]);
  });

  const field = () =>
    container.querySelector<HTMLInputElement>('input[aria-label="Find a referee"]')!;
  const shownCodes = () =>
    [...container.querySelectorAll('div.rounded-lg p.font-semibold.text-foreground')].map((p) =>
      p.textContent?.replace('Longsword Open – ', ''),
    );
  const search = async (value: string) => {
    await act(async () => {
      const proto = Object.getPrototypeOf(field()) as object;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field(), value);
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('shows every bout while empty', () => {
    expect(shownCodes()).toEqual(['LSW-B-R16-M1', 'LSW-B-R16-M2', 'LSW-B-R16-M3']);
  });

  it('keeps only the bouts the named referee holds a slot on', async () => {
    await search('bellini');
    expect(shownCodes()).toEqual(['LSW-B-R16-M1']);
  });

  it('ignores accents and case', async () => {
    await search('FRANCOIS');
    expect(shownCodes()).toEqual(['LSW-B-R16-M2']);
  });

  it('says so when no bout matches, and shows them all again once cleared', async () => {
    await search('zzz');
    expect(shownCodes()).toEqual([]);
    expect(container.textContent).toContain('No bout has a referee matching "zzz".');
    await search('');
    expect(shownCodes()).toEqual(['LSW-B-R16-M1', 'LSW-B-R16-M2', 'LSW-B-R16-M3']);
  });
});
