import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScheduleUndo, type ScheduleUndo, type ScheduleUndoEntry } from './useScheduleUndo';

/**
 * Ruled 2026-10-15: the organiser deletes a bar by mistake and presses Ctrl+Z before the
 * server answers the delete. Nothing happened, and nothing was said. Now the early Ctrl+Z is
 * remembered, and once the delete lands the bar comes back by itself. It must never undo the
 * entry BEFORE the delete instead.
 */
const MOVE: ScheduleUndoEntry = {
  kind: 'move',
  matchId: 'm-1',
  from: { liceId: 'l-1', scheduledAt: '2027-06-01T08:00:00Z' },
  to: { liceId: 'l-2', scheduledAt: '2027-06-01T09:00:00Z' },
};
const BLOCK = {
  dayIndex: 0,
  blockType: 'break' as const,
  label: 'Lunch',
  startTime: '12:00',
  endTime: '13:00',
};
const DELETE: ScheduleUndoEntry = { kind: 'delete-block', label: 'Lunch', block: BLOCK };

const applyPositions = vi.fn(async () => true);
const recreateBlock = vi.fn(async () => true);
let history: ScheduleUndo;
let root: Root;
let container: HTMLDivElement;

function Harness({ onHistory }: { onHistory: (latest: ScheduleUndo) => void }) {
  const latest = useScheduleUndo({ activeDay: '2027-06-01', applyPositions, recreateBlock });
  useEffect(() => {
    onHistory(latest);
  });
  return null;
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  applyPositions.mockClear();
  recreateBlock.mockClear();
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root.render(<Harness onHistory={(latest) => (history = latest)} />));
  await act(async () => history.push(MOVE));
});
afterEach(() => act(() => root.unmount()));

describe('Ctrl+Z before a delete is answered', () => {
  it('is remembered, brings the bar back once the delete lands, and leaves the move alone', async () => {
    const landed = history.expectEntry();
    await act(async () => history.undo());
    expect(applyPositions).not.toHaveBeenCalled();
    expect(recreateBlock).not.toHaveBeenCalled();

    await act(async () => landed(DELETE));
    expect(recreateBlock).toHaveBeenCalledWith(BLOCK);
    expect(applyPositions).not.toHaveBeenCalled();
    expect(history.canUndo).toBe(true);
    expect(history.toast).toBeNull();
  });

  it('is dropped when the delete is refused: the bar never left', async () => {
    const landed = history.expectEntry();
    await act(async () => history.undo());
    await act(async () => landed(null));
    expect(recreateBlock).not.toHaveBeenCalled();
    expect(applyPositions).not.toHaveBeenCalled();

    await act(async () => history.undo());
    expect(applyPositions).toHaveBeenCalledWith([{ id: 'm-1', ...MOVE.from }]);
  });

  it('is not needed when the delete lands first: the entry goes to the history and the toast', async () => {
    const landed = history.expectEntry();
    await act(async () => landed(DELETE));
    expect(history.toast).toEqual(DELETE);
    await act(async () => history.undo());
    expect(recreateBlock).toHaveBeenCalledWith(BLOCK);
  });
});
