/**
 * Build the per-lice "block list" model for the schedule view: collapse a
 * lice's scheduled matches into ONE block per pool / per bracket round, with
 * a rounded-up-to-30-min time span and the nested match details (code · start
 * · fighters) for the inline accordion.
 *
 * Pure: no React, no I/O.
 */
import { roundUpToHalfHourMin } from './round-duration';
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
}

export interface ScheduleBlockMatch {
  id: string;
  code: string;
  startIso: string;
  redFighterName: string | null;
  blueFighterName: string | null;
}

export interface ScheduleBlock {
  key: string;
  liceId: string;
  label: string;
  tournamentName: string | null;
  kind: 'pool' | 'bracket' | 'other';
  startIso: string;
  /** Start + the block's duration rounded UP to the next 30 min. */
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
  // Group scheduled matches by (lice, run): pool → pool id, bracket → round
  // token, else the match's own id (a standalone block).
  const groups = new Map<string, BlockMatchInput[]>();
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
    const groupKey = `${m.liceId}|${runKey}|${kind}`;
    const arr = groups.get(groupKey) ?? [];
    arr.push(m);
    groups.set(groupKey, arr);
  }

  const blocks: ScheduleBlock[] = [];
  for (const [groupKey, groupMatches] of groups) {
    const sorted = [...groupMatches].sort((a, b) =>
      a.scheduledAt! < b.scheduledAt! ? -1 : a.scheduledAt! > b.scheduledAt! ? 1 : 0,
    );
    const first = sorted[0]!;
    const startMs = new Date(first.scheduledAt!).getTime();
    const lastMs = new Date(sorted[sorted.length - 1]!.scheduledAt!).getTime();
    const intervalMs = medianGapMs(sorted.map((m) => new Date(m.scheduledAt!).getTime())) ?? 0;
    // Actual span includes the last match's slot (+ one interval); single-match
    // blocks fall back to a nominal 5 min, then everything rounds up to 30.
    const actualMin = (lastMs - startMs) / 60_000 + (intervalMs > 0 ? intervalMs / 60_000 : 5);
    const endMs = startMs + roundUpToHalfHourMin(actualMin) * 60_000;

    const kind: ScheduleBlock['kind'] = groupKey.endsWith('|pool')
      ? 'pool'
      : groupKey.endsWith('|bracket')
        ? 'bracket'
        : 'other';
    const label =
      kind === 'pool'
        ? (first.poolName ?? 'Pool')
        : kind === 'bracket'
          ? (parseBracketRound(first.roundCode)?.label ?? 'Bracket')
          : (first.roundCode ?? first.id);

    blocks.push({
      key: groupKey,
      liceId: first.liceId!,
      label,
      tournamentName: first.tournamentName,
      kind,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      matchCount: sorted.length,
      matches: sorted.map((m) => ({
        id: m.id,
        code: m.roundCode ?? m.id,
        startIso: m.scheduledAt!,
        redFighterName: m.redFighterName,
        blueFighterName: m.blueFighterName,
      })),
    });
  }

  return blocks.sort((a, b) =>
    a.liceId < b.liceId ? -1 : a.liceId > b.liceId ? 1 : a.startIso < b.startIso ? -1 : 1,
  );
}
