/**
 * The bout's next sequence as the server holds it: one past the highest of its
 * hits, cards and protests.
 *
 * The pad has one counter for the three (`OutboxEntry.sequence`), and each
 * table has its own UNIQUE(match_id, sequence). Seeded from the hits alone, a
 * second tablet took the number of a card or a protest the first one sent: its
 * next card or protest met the constraint, and landed in the held inbox.
 *
 * A voided row keeps its number, so every row counts. The read is left open
 * during the offline drill, like the bout's other reads (`drill-census.test.ts`).
 */
import { apiRequest } from '@myclash/api-client';

const LISTS = ['exchanges', 'penalties', 'protests'] as const;

/**
 * Null when no list answered: offline is the ordinary case and says nothing,
 * and the tablet's own seed is then the whole answer. A list that does not
 * answer adds nothing; the others still count.
 */
export async function serverNextSequence(
  apiUrl: string,
  matchId: string,
  signal: AbortSignal,
): Promise<number | null> {
  const reads = await Promise.all(
    LISTS.map((list) =>
      apiRequest<Array<{ sequence?: number | null }>>(
        apiUrl,
        `/api/v1/matches/${matchId}/${list}`,
        { signal },
      ),
    ),
  );
  const answered = reads.flatMap((read) =>
    read.ok && Array.isArray(read.data) ? [read.data] : [],
  );
  if (answered.length === 0) return null;
  return answered.flat().reduce((max, row) => Math.max(max, row.sequence ?? 0), 0) + 1;
}
