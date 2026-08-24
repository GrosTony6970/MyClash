/**
 * The point-value half of tournament statistics: which target values a
 * tournament actually scored at, and who landed the deepest.
 *
 * Split out of `stats.service.ts` when that file crossed the size budget — it
 * had grown to hold five concerns. The seam is real rather than convenient:
 * everything here is a PURE transform of rows already fetched, with no Supabase
 * and no Nest, so it is unit-testable with plain object literals. The service
 * keeps the reads.
 *
 * Backed by `tournament_target_value_stats` (migration 0135), which is the
 * function that first kept the raw `first_strike_value` instead of bucketing it
 * into fixed columns — the shape migration 0189 later took for blow counts too.
 */
import { byCodepoint } from '@myclash/rules/results';

export interface TargetValueRow {
  registrationId: string;
  personId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  pointValue: number;
  cleanHits: number;
}

/** Aggregated point-value stats for a tournament (or a weapon group). */
export interface TargetValueStats {
  /** Highest point value present (the "deep target"); null when there are no clean hits. */
  maxValue: number | null;
  /** Total clean hits per point value, ascending by value (stacked-bar source). */
  distribution: Array<{ value: number; cleanHits: number }>;
  /** Top-5 fighters by clean hits AT maxValue; ties by name. */
  hunters: Array<{ personId: string; name: string; club: string | null; cleanHits: number }>;
}

/**
 * Pure aggregation of target-value rows into { maxValue, distribution, hunters }.
 * Accepts rows from one or several tournaments (concatenated) of the same weapon;
 * the deep-target hunters are merged by personId across them. No Supabase — unit-testable.
 */
export function aggregateTargetValues(rows: TargetValueRow[]): TargetValueStats {
  if (rows.length === 0) return { maxValue: null, distribution: [], hunters: [] };

  // Distribution: sum clean hits per value, ascending.
  const byValue = new Map<number, number>();
  for (const r of rows) byValue.set(r.pointValue, (byValue.get(r.pointValue) ?? 0) + r.cleanHits);
  const distribution = [...byValue.entries()]
    .map(([value, cleanHits]) => ({ value, cleanHits }))
    .sort((a, b) => a.value - b.value);

  const lastBucket = distribution[distribution.length - 1];
  const maxValue = lastBucket ? lastBucket.value : null;

  // Hunters: clean hits AT maxValue, merged by person (a person can span
  // tournaments of the same weapon).
  const byPerson = new Map<
    string,
    { personId: string; name: string; club: string | null; cleanHits: number }
  >();
  for (const r of rows) {
    if (r.pointValue !== maxValue) continue;
    const existing = byPerson.get(r.personId);
    if (existing) {
      existing.cleanHits += r.cleanHits;
      existing.club ??= r.clubName;
    } else {
      byPerson.set(r.personId, {
        personId: r.personId,
        name: `${r.givenName} ${r.familyName}`.trim(),
        club: r.clubName,
        cleanHits: r.cleanHits,
      });
    }
  }

  const hunters = [...byPerson.values()]
    .filter((h) => h.cleanHits > 0)
    .sort(
      // Code points, not the runtime's locale: the same hunters would otherwise
      // list in a different order on a developer's machine and in the container.
      (a, b) =>
        b.cleanHits - a.cleanHits ||
        byCodepoint(a.name, b.name) ||
        byCodepoint(a.personId, b.personId),
    )
    .slice(0, 5);

  return { maxValue, distribution, hunters };
}
