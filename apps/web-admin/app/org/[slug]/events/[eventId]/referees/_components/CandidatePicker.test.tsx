import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { BoardCandidatePicker } from './BoardCandidatePicker';
import { CandidatePicker } from './CandidatePicker';
import { filterCandidates } from './candidate-filter';
import type { AssignAnswer, AssignmentBoardRoleSlot, PickerCandidate } from './useAssignmentBoard';

/**
 * The assign-a-referee picker lists every referee of the Event in three groups. With
 * forty of them, a named referee was a scroll away (quick win O9): a search field,
 * focused when the picker opens, keeps the people whose name or club matches.
 */

const candidate = (personId: string, displayName: string, clubLabel: string | null) =>
  ({
    personId,
    userId: null,
    displayName,
    clubLabel,
    qualifications: [],
    boutsThatDay: null,
  }) satisfies PickerCandidate;

const GERALDINE = candidate('gp-1', 'Géraldine Roux', 'Lyon HEMA');
const MARC = candidate('gp-2', 'Marc Petit', 'Grenoble AMHE');
const ANA = { ...candidate('gp-3', 'Ana Lyon', null), reasons: [] };
const TOM = { ...candidate('gp-4', 'Tom Faure', 'Lyon HEMA'), reasons: [] };

const SLOT: AssignmentBoardRoleSlot = {
  slotIndex: 0,
  displayName: 'Main referee',
  allowedSkillIds: [],
  role: 'main',
  assignment: null,
  missingReasons: [],
  candidates: { recommended: [GERALDINE, MARC], warning: [ANA], blocked: [TOM] },
};

describe('filterCandidates', () => {
  it('keeps everybody for an empty query', () => {
    expect(filterCandidates([GERALDINE, MARC], '  ')).toEqual([GERALDINE, MARC]);
  });

  it('matches the name with no accent, and the club', () => {
    expect(filterCandidates([GERALDINE, MARC], 'geral')).toEqual([GERALDINE]);
    expect(filterCandidates([GERALDINE, MARC], 'grenoble')).toEqual([MARC]);
  });

  it('needs every word, in any order', () => {
    expect(filterCandidates([GERALDINE, MARC, TOM], 'lyon roux')).toEqual([GERALDINE]);
  });
});

describe('the picker search', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider locale="en">
          <CandidatePicker
            pool={{ name: 'Pool A', tournamentName: 'Longsword' }}
            slot={SLOT}
            refusal={null}
            busy={false}
            onAssign={vi.fn()}
            onCancel={vi.fn()}
          />
        </I18nProvider>,
      );
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const field = () => document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  const names = () =>
    [...document.body.querySelectorAll('[role="dialog"] li p:first-child')].map(
      (p) => p.textContent,
    );
  const search = async (value: string) => {
    await act(async () => {
      const proto = Object.getPrototypeOf(field()) as object;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field(), value);
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('opens with every candidate and the search field focused, with a name', () => {
    expect(names()).toEqual(['Géraldine Roux', 'Marc Petit', 'Ana Lyon', 'Tom Faure']);
    expect(document.activeElement).toBe(field());
    expect(field().getAttribute('aria-label')).toBe('Search referees');
  });

  it('keeps the matches of every group, and counts what it shows', async () => {
    await search('lyon');
    expect(names()).toEqual(['Géraldine Roux', 'Ana Lyon', 'Tom Faure']);
    expect(document.body.textContent).toContain('Recommended (1)');
    expect(document.body.textContent).toContain('Needs confirmation (1)');
    expect(document.body.textContent).toContain('Not possible (1)');
  });

  it('says so when nobody matches', async () => {
    await search('zorro');
    expect(names()).toEqual([]);
    expect(document.body.textContent).toContain('No referee matches "zorro".');
  });
});

/**
 * A refused assignment showed its reason on the page, BEHIND the open picker's backdrop
 * (quick win O8): the organiser clicked again and met the same refusal. The picker of a
 * board now shows the reason inside itself, and sends one assignment at a time.
 */
const SAVED: AssignAnswer = { assigned: true, refusal: null };
const refused = (refusal: string): AssignAnswer => ({ assigned: false, refusal });

describe('the picker of a board', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();

  async function open(
    manualAssign: (...args: [string, string, string, boolean]) => Promise<AssignAnswer>,
    busy = false,
  ) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onClose.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider locale="en">
          <BoardCandidatePicker
            target={{
              pool: { id: 'pool-a', name: 'Pool A', tournamentName: 'Longsword' },
              slot: SLOT,
            }}
            manualAssign={manualAssign}
            busy={busy}
            onClose={onClose}
          />
        </I18nProvider>,
      );
    });
  }
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const pickButtons = () => [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] li button'),
  ];
  const pickFirst = async () => {
    await act(async () => pickButtons()[0]!.click());
  };

  it('shows a refusal inside the picker, and stays open', async () => {
    const assign = vi.fn(async () => refused('Géraldine fights at that time'));
    await open(assign);
    await pickFirst();
    expect(assign).toHaveBeenCalledWith('pool-a', 'main', 'gp-1', false);
    expect(document.body.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe(
      'Géraldine fights at that time',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes once the assignment is saved', async () => {
    await open(vi.fn(async () => SAVED));
    await pickFirst();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends one assignment at a time: a second click while the first is out sends nothing', async () => {
    let land: (answer: AssignAnswer) => void = () => undefined;
    const assign = vi.fn(
      () =>
        new Promise<AssignAnswer>((resolve) => {
          land = resolve;
        }),
    );
    await open(assign);
    await pickFirst();
    expect(pickButtons().every((button) => button.disabled)).toBe(true);
    await act(async () => pickButtons()[1]!.click());
    expect(assign).toHaveBeenCalledTimes(1);
    await act(async () => land(refused('refused')));
    expect(pickButtons().every((button) => !button.disabled)).toBe(true);
  });

  it('sends one assignment for two clicks that land before the screen draws again', async () => {
    const assign = vi.fn(() => new Promise<AssignAnswer>(() => undefined));
    await open(assign);
    await act(async () => {
      pickButtons()[0]!.click();
      pickButtons()[1]!.click();
    });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('cannot be cancelled while an assignment is out: its refusal would show nowhere', async () => {
    await open(vi.fn(() => new Promise<AssignAnswer>(() => undefined)));
    await pickFirst();
    const cancel = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent === 'Cancel')!;
    expect(cancel.disabled).toBe(true);
  });

  it('offers nothing to pick while the board is busy', async () => {
    await open(
      vi.fn(async () => SAVED),
      true,
    );
    expect(pickButtons().length).toBeGreaterThan(0);
    expect(pickButtons().every((button) => button.disabled)).toBe(true);
  });
});
