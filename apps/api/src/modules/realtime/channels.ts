/**
 * Canonical Supabase Realtime channel names for MyClash.
 *
 * Channel names are client-defined labels. Clients subscribe using
 * `postgres_changes` filters that match table + filter, then attach to the
 * channel name below as a human-readable scope label.
 *
 * See ARCHITECTURE.md §9.1 for the full channel contract.
 */
export const Channels = {
  /** New exchange, voided exchange, score update on a specific match. */
  matchExchanges: (matchId: string) => `match:${matchId}:exchanges`,

  /** Clock state changes (start/halt/resume/end) on a specific match. */
  matchClock: (matchId: string) => `match:${matchId}:clock`,

  /** Current and next match on a specific Lice (piste). */
  liceCurrentMatch: (liceId: string) => `lice:${liceId}:current`,

  /** High-level event notifications (match started/ended, podium published). */
  event: (eventId: string) => `event:${eventId}`,

  /** Pool standings deltas for a specific event. */
  eventStandings: (eventId: string) => `event:${eventId}:standings`,
} as const;
