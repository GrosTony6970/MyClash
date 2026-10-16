/**
 * When a bout a hit or a card just decided ended.
 *
 * Now, for a person with a network. For a row a tablet sent late, the time of that row
 * (`causedAt`): the queue may arrive an hour after the hit. Never before the bout started, or
 * was last put back in play: a hit made at 10:06 may arrive after the desk's Reopen of 10:30,
 * since a hit is not refused for its age, and a bout cannot end before it was in play.
 */
export function endedAtOf(causedAt: string | undefined, bout: Record<string, unknown>): string {
  if (!causedAt) return new Date().toISOString();
  const marks = [bout['started_at'], bout['back_in_play_at']].filter(
    (mark): mark is string => typeof mark === 'string',
  );
  return marks.reduce(
    (latest, mark) => (Date.parse(mark) > Date.parse(latest) ? mark : latest),
    causedAt,
  );
}
