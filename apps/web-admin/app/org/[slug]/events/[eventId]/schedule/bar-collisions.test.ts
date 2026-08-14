import { describe, expect, it } from 'vitest';
import { detectBarCollisions, type BarWindow, type PlacedMatch } from './bar-collisions';

// Slots are 5 minutes on an 08:00 axis, so slot 48 = 12:00 and slot 60 = 13:00.
const LUNCH: BarWindow = { id: 'bar-lunch', label: 'Lunch', startSlot: 48, span: 12 };
const MEETING: BarWindow = { id: 'bar-meet', label: 'Referee meeting', startSlot: 0, span: 6 };

function match(over: Partial<PlacedMatch> = {}): PlacedMatch {
  return { id: 'm1', matchNumberLabel: 'M1', startSlot: 24, span: 2, ...over };
}

describe('detectBarCollisions', () => {
  it('finds nothing on a clear day', () => {
    expect(detectBarCollisions([match()], [LUNCH])).toEqual([]);
  });

  it('finds nothing when there are no bars', () => {
    expect(detectBarCollisions([match({ startSlot: 50 })], [])).toEqual([]);
  });

  /**
   * The defect this exists for: the Blocks view tinted the drag ghost red for
   * exactly this case and then dropped the fight anyway, and the Detailed view
   * never looked. A bout inside the lunch break left no trace on the board.
   */
  it('reports a fight dropped inside the lunch break', () => {
    const collisions = detectBarCollisions([match({ startSlot: 50, span: 2 })], [LUNCH]);

    expect(collisions).toEqual([
      { matchId: 'm1', matchLabel: 'M1', barId: 'bar-lunch', barLabel: 'Lunch' },
    ]);
  });

  it('reports a fight that only clips the start of a bar', () => {
    // Ends at slot 49, one slot inside the 48-start bar.
    expect(detectBarCollisions([match({ startSlot: 47, span: 2 })], [LUNCH])).toHaveLength(1);
  });

  it('reports a fight that only clips the end of a bar', () => {
    // Starts at 59, the bar's last slot.
    expect(detectBarCollisions([match({ startSlot: 59, span: 3 })], [LUNCH])).toHaveLength(1);
  });

  it('treats touching as clear, not as a collision', () => {
    // Ends exactly at 48, where the bar begins.
    expect(detectBarCollisions([match({ startSlot: 46, span: 2 })], [LUNCH])).toEqual([]);
    // Starts exactly at 60, where the bar ends.
    expect(detectBarCollisions([match({ startSlot: 60, span: 2 })], [LUNCH])).toEqual([]);
  });

  it('reports once per bar when a fight spans two of them', () => {
    const wide = match({ startSlot: 0, span: 60 });

    expect(detectBarCollisions([wide], [MEETING, LUNCH])).toHaveLength(2);
  });

  it('gives a zero-span match one slot rather than skipping it', () => {
    expect(detectBarCollisions([match({ startSlot: 48, span: 0 })], [LUNCH])).toHaveLength(1);
  });

  it('names the match and the bar, never their ids, for the banner', () => {
    const [first] = detectBarCollisions([match({ startSlot: 50 })], [LUNCH]);

    expect(first?.matchLabel).toBe('M1');
    expect(first?.barLabel).toBe('Lunch');
  });
});
