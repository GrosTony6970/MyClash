/**
 * Per-lice schedule drift: how late (or early) each lice is running vs its
 * plan. For a lice, the currently-running match drives it (how late it
 * started); otherwise the last completed match (how late it finished vs its
 * planned end = scheduled + slot duration). Lices with nothing started are
 * omitted (no drift to report). Positive = late, negative = ahead.
 *
 * Pure: no React, no I/O. A heuristic — `durationMinutes` is the planned slot.
 */
export interface DriftMatch {
  liceId: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: string;
  durationMinutes: number;
  matchNumberLabel: string;
}

export interface LiceDrift {
  driftMin: number;
  basisLabel: string;
}

export function computeLiceDrift(matches: DriftMatch[]): Map<string, LiceDrift> {
  const byLice = new Map<string, DriftMatch[]>();
  for (const m of matches) {
    if (!m.liceId || !m.scheduledAt) continue;
    const arr = byLice.get(m.liceId) ?? [];
    arr.push(m);
    byLice.set(m.liceId, arr);
  }

  const out = new Map<string, LiceDrift>();
  for (const [liceId, list] of byLice) {
    const running = list
      .filter((m) => m.status === 'running' && m.startedAt)
      .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? 1 : -1))[0];
    if (running) {
      const driftMin = Math.round(
        (new Date(running.startedAt!).getTime() - new Date(running.scheduledAt!).getTime()) /
          60_000,
      );
      out.set(liceId, { driftMin, basisLabel: running.matchNumberLabel });
      continue;
    }
    const completed = list
      .filter((m) => m.status === 'completed' && m.endedAt)
      .sort((a, b) => (a.endedAt! < b.endedAt! ? 1 : -1))[0];
    if (completed) {
      const plannedEnd =
        new Date(completed.scheduledAt!).getTime() + completed.durationMinutes * 60_000;
      const driftMin = Math.round((new Date(completed.endedAt!).getTime() - plannedEnd) / 60_000);
      out.set(liceId, { driftMin, basisLabel: completed.matchNumberLabel });
    }
  }
  return out;
}
