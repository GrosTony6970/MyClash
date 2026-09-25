import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import {
  loadBootstrap,
  loadRefereeConflictInputs,
  loadScheduleAndProgramme,
} from './schedule-reads';
import { useScheduleData } from './useScheduleData';

/**
 * The schedule board's "load failed" banner against the 30 s re-read (ruling 110a).
 *
 * The board is re-read every 30 s even while the live channel is up. A failed
 * re-read raises the banner; it used to stay up after every later re-read
 * succeeded, so one wifi blip left a red alert on a board that was fine. A good
 * re-read now takes down the banner a failed re-read raised, and only that one:
 * a failed first load is not something the re-read repairs.
 */

vi.mock('./schedule-reads', () => ({
  loadBootstrap: vi.fn(),
  loadRefereeConflictInputs: vi.fn(),
  loadScheduleAndProgramme: vi.fn(),
}));
vi.mock('./useRefereeCrewConflicts', () => ({ useRefereeCrewConflicts: () => ({ result: null }) }));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => {} }));

const BOOTSTRAP_OK = {
  ok: true,
  data: { lices: [], matches: [], timezone: 'Europe/Paris', days: [], programmeBlocks: [] },
};
const RELOAD_OK = { ok: true, matches: [], programmeBlocks: [] };
const failure = (source: 'lices' | 'schedule') => ({
  ok: false,
  source,
  failure: { kind: 'network' },
});

type Board = ReturnType<typeof useScheduleData>;
let board: Board;

/** Hands the hook's latest value out after each render (never during one). */
function Probe({ onBoard }: { onBoard: (value: Board) => void }) {
  const value = useScheduleData({ eventId: 'ev1', apiUrl: 'http://api.test', isBusy: () => false });
  useEffect(() => onBoard(value));
  return null;
}

async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let root: Root;

async function openBoard() {
  root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <Probe
          onBoard={(value) => {
            board = value;
          }}
        />
      </I18nProvider>,
    );
  });
  await settle();
}

async function reread(result: unknown) {
  vi.mocked(loadScheduleAndProgramme).mockResolvedValueOnce(result as never);
  await act(async () => board.refetchScheduleAndBlocks());
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(loadBootstrap).mockReset();
  vi.mocked(loadScheduleAndProgramme).mockReset();
  vi.mocked(loadRefereeConflictInputs).mockResolvedValue({
    ok: false,
    failure: { kind: 'aborted' },
  } as never);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('schedule board banner against the 30 s re-read', () => {
  it('a good re-read takes down the banner a failed re-read raised', async () => {
    vi.mocked(loadBootstrap).mockResolvedValue(BOOTSTRAP_OK as never);
    await openBoard();
    expect(board.fetchError).toBeNull();

    await reread(failure('schedule'));
    expect(board.fetchError).not.toBeNull();

    await reread(RELOAD_OK);
    expect(board.fetchError).toBeNull();
  });

  it('a good re-read leaves up the banner of a failed first load', async () => {
    vi.mocked(loadBootstrap).mockResolvedValue(failure('lices') as never);
    await openBoard();
    const firstLoad = board.fetchError;
    expect(firstLoad).not.toBeNull();

    await reread(RELOAD_OK);
    expect(board.fetchError).toBe(firstLoad);
  });
});
