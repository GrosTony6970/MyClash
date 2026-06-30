/**
 * Build the "block" model for the schedule board: collapse scheduled matches
 * into ONE block per pool / per bracket round. A run fanned across several
 * lices is a single block that SPANS those lice columns (`liceIds`), sized to
 * its ACTUAL span (first fight start → last fight end), with the nested match
 * details (code · start · lice · fighters) for the inline accordion + per-lice
 * counts. The span is deliberately NOT padded — pipelined rounds must touch,
 * not overlap, so the board matches the detailed grid.
 *
 * Pure: no React, no I/O.
 */
import { parseBracketRound } from './bracket-round-group';

export interface BlockMatchInput {
  id: string;
  liceId: string | null;
  scheduledAt: string | null;
  poolId: string | null;
  poolName: string | null;
  roundCode?: string;
  phaseType: string | null;
  tournamentName: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  /** Match length in minutes — drives block height + retime-on-resize. */
  durationMinutes?: number;
  /** 'scheduled' | 'running' | 'completed' — drives the block status accent. */
  status?: string;
}

export interface ScheduleBlockMatch {
  id: string;
  /** The lice this match sits on (a wide block holds matches from several lices). */
  liceId: string;
  code: string;
  startIso: string;
  durationMinutes?: number;
  status?: string;
  redFighterName: string | null;
  blueFighterName: string | null;
}

export interface ScheduleBlock {
  key: string;
  /** Every lice this block occupies; min→max = its column span. Length 1 for a pool. */
  liceIds: string[];
  label: string;
  tournamentName: string | null;
  kind: 'pool' | 'bracket' | 'other';
  startIso: string;
  /** Last fight's start + its duration — the run's true end, never padded. */
  endIso: string;
  matchCount: number;
  matches: ScheduleBlockMatch[];
}

/** Median gap (ms) between consecutive sorted start times; null if <2. */
function medianGapMs(sortedMs: number[]): number | null {
  if (sortedMs.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < sortedMs.length; i++) gaps.push(sortedMs[i]! - sortedMs[i - 1]!);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid]! : Math.round((gaps[mid - 1]! + gaps[mid]!) / 2);
}

export function buildScheduleBlocks(matches: BlockMatchInput[]): ScheduleBlock[] {
  // Group scheduled matches by RUN: pool → pool id, bracket → round token,
  // else the match's own id (a standalone block). The lice is NOT part of the
  // key, so a run fanned across several lices is ONE block spanning them.
  const groups = new Map<string, { kind: ScheduleBlock['kind']; matches: BlockMatchInput[] }>();
  for (const m of matches) {
    if (!m.liceId || !m.scheduledAt) continue;
    let runKey: string;
    let kind: ScheduleBlock['kind'];
    if (m.poolId) {
      runKey = `pool:${m.poolId}`;
      kind = 'pool';
    } else {
      const round = parseBracketRound(m.roundCode);
      if (round) {
        runKey = `round:${m.tournamentName ?? ''}|${round.token}`;
        kind = 'bracket';
      } else {
        runKey = `solo:${m.id}`;
        kind = 'other';
      }
    }
    const groupKey = `${runKey}|${kind}`;
    const g = groups.get(groupKey) ?? { kind, matches: [] };
    g.matches.push(m);
    groups.set(groupKey, g);
  }

  const blocks: ScheduleBlock[] = [];
  for (const [groupKey, group] of groups) {
    const { kind } = group;
    const sorted = [...group.matches].sort((a, b) =>
      a.scheduledAt! < b.scheduledAt! ? -1 : a.scheduledAt! > b.scheduledAt! ? 1 : 0,
    );
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const startMs = new Date(first.scheduledAt!).getTime();
    const lastMs = new Date(last.scheduledAt!).getTime();
    const intervalMs = medianGapMs(sorted.map((m) => new Date(m.scheduledAt!).getTime())) ?? 0;
    // End at the LAST fight's real finish — its own duration, falling back to the
    // run's median gap (then a nominal 5 min for a single-match block). No padding,
    // so back-to-back rounds touch instead of overlapping.
    const lastDurationMin = last.durationMinutes ?? (intervalMs > 0 ? intervalMs / 60_000 : 5);
    const endMs = lastMs + lastDurationMin * 60_000;

    const label =
      kind === 'pool'
        ? (first.poolName ?? 'Pool')
        : kind === 'bracket'
          ? (parseBracketRound(first.roundCode)?.label ?? 'Bracket')
          : (first.roundCode ?? first.id);

    // Distinct lices this run occupies, ordered for a deterministic span.
    const liceIds = [...new Set(sorted.map((m) => m.liceId!))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );

    blocks.push({
      key: groupKey,
      liceIds,
      label,
      tournamentName: first.tournamentName,
      kind,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      matchCount: sorted.length,
      matches: sorted.map((m) => ({
        id: m.id,
        liceId: m.liceId!,
        code: m.roundCode ?? m.id,
        startIso: m.scheduledAt!,
        durationMinutes: m.durationMinutes,
        status: m.status,
        redFighterName: m.redFighterName,
        blueFighterName: m.blueFighterName,
      })),
    });
  }

  return blocks.sort((a, b) => {
    const al = a.liceIds[0] ?? '';
    const bl = b.liceIds[0] ?? '';
    return al < bl ? -1 : al > bl ? 1 : a.startIso < b.startIso ? -1 : 1;
  });
}
