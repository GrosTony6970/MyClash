import { Injectable, NotFoundException } from '@nestjs/common';
import type { BlockType, ProgrammeBlock } from '@myclash/types';
import { isLiveStatus } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { dayIndexFor, selectProgrammeBlocks, toHHMM } from './select-programme-block';

type ProgrammePhase = 'pool' | 'swiss' | 'bracket' | 'finals';

export interface LiveMatch {
  id: string;
  matchNumberLabel: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  scheduledAt: string | null;
  status: string;
  tournamentName: string | null;
  /** Live score — the public event home renders these on its Live Now cards. */
  redScore: number;
  blueScore: number;
}

export interface LiveLiceState {
  lice: { id: string; name: string; sortOrder: number };
  /**
   * The bout occupying this piste — `running` OR `paused` (see
   * `isLiveStatus`). A halt for a doctor call does not free the strip,
   * and readers that dropped paused bouts made pistes blink out of the
   * spectator boards mid-fight. Read `.status` to pick the cue.
   */
  runningMatch: LiveMatch | null;
  nextMatch: LiveMatch | null;
}

export interface LiveStateResponse {
  currentBlock: ProgrammeBlock | null;
  nextBlock: ProgrammeBlock | null;
  lices: LiveLiceState[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function composeName(
  p: { given_name?: string | null; family_name?: string | null } | null | undefined,
): string | null {
  if (!p) return null;
  const composed = `${p.given_name ?? ''} ${p.family_name ?? ''}`.trim();
  return composed || null;
}

@Injectable()
export class LiveStateService {
  constructor(private readonly supabase: SupabaseService) {}

  async getLiveState(eventIdOrSlug: string): Promise<LiveStateResponse> {
    const now = new Date();

    const eventId = UUID_RE.test(eventIdOrSlug)
      ? eventIdOrSlug
      : await this.resolveSlug(eventIdOrSlug);

    const [eventRes, licesRes] = await Promise.all([
      this.supabase.service.from('events').select('start_date').eq('id', eventId).maybeSingle(),
      this.supabase.service
        .from('lices')
        .select('id, name, sort_order')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true }),
    ]);

    const dayIndex = dayIndexFor(
      (eventRes.data as Record<string, unknown> | null)?.['start_date'] as string | null,
      now.getTime(),
    );

    const lices = (licesRes.data ?? []) as { id: string; name: string; sort_order: number }[];

    const { data: blocksData } = await this.supabase.service
      .from('event_programme_blocks')
      .select('*')
      .eq('event_id', eventId)
      .eq('day_index', dayIndex)
      .order('sort_order', { ascending: true });

    const blocks = (blocksData ?? []).map((r) => this.mapBlock(r as Record<string, unknown>));
    const { current: currentBlock, next: nextBlock } = selectProgrammeBlocks(blocks, toHHMM(now));

    const liceIds = lices.map((l) => l.id);
    let matchRows: Record<string, unknown>[] = [];
    if (liceIds.length > 0) {
      const { data } = await this.supabase.service
        .from('matches')
        .select(
          'id,status,scheduled_at,match_number_label,lice_id,red_score,blue_score,' +
            'red:registrations!matches_red_registration_id_fkey(id,persons(given_name,family_name)),' +
            'blue:registrations!matches_blue_registration_id_fkey(id,persons(given_name,family_name)),' +
            'phases(tournaments(id,name))',
        )
        .in('lice_id', liceIds)
        .in('status', ['running', 'paused', 'scheduled'])
        .order('scheduled_at', { ascending: true, nullsFirst: false });
      matchRows = (data ?? []) as unknown as Record<string, unknown>[];
    }

    const nowIso = now.toISOString();
    const liceStates: LiveLiceState[] = lices.map((lice) => {
      const liceMatches = matchRows.filter((m) => m['lice_id'] === lice.id);
      // `running` wins over `paused` when a piste somehow carries both —
      // an operator who forgot to end a bout should see the one actually
      // being fought, not the stale halt.
      const runningMatch =
        liceMatches.find((m) => m['status'] === 'running') ??
        liceMatches.find((m) => isLiveStatus(m['status'] as string)) ??
        null;
      const nextMatch =
        liceMatches.find(
          (m) =>
            m['status'] === 'scheduled' &&
            (!m['scheduled_at'] || (m['scheduled_at'] as string) >= nowIso),
        ) ??
        liceMatches.find((m) => m['status'] === 'scheduled') ??
        null;
      return {
        lice: { id: lice.id, name: lice.name, sortOrder: lice.sort_order },
        runningMatch: runningMatch ? this.mapLiveMatch(runningMatch) : null,
        nextMatch: nextMatch ? this.mapLiveMatch(nextMatch) : null,
      };
    });

    return { currentBlock, nextBlock, lices: liceStates };
  }

  private async resolveSlug(slug: string): Promise<string> {
    const { data } = await this.supabase.service
      .from('events')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (!data) throw new NotFoundException(`Event not found: ${slug}`);
    return (data as { id: string }).id;
  }

  private mapLiveMatch(m: Record<string, unknown>): LiveMatch {
    // `persons` carries given_name + family_name (no display_name);
    // compose the visible name here. See staff.service.ts formatPersonName
    // for the canonical comment on this constraint.
    const red = m['red'] as {
      persons?: { given_name?: string | null; family_name?: string | null };
    } | null;
    const blue = m['blue'] as {
      persons?: { given_name?: string | null; family_name?: string | null };
    } | null;
    const phases = m['phases'] as { tournaments?: { name?: string } } | null;
    return {
      id: m['id'] as string,
      matchNumberLabel: (m['match_number_label'] as string | null) ?? '',
      redFighterName: composeName(red?.persons),
      blueFighterName: composeName(blue?.persons),
      scheduledAt: (m['scheduled_at'] as string | null) ?? null,
      status: (m['status'] as string) ?? 'scheduled',
      tournamentName: phases?.tournaments?.name ?? null,
      redScore: (m['red_score'] as number | null) ?? 0,
      blueScore: (m['blue_score'] as number | null) ?? 0,
    };
  }

  private mapBlock(r: Record<string, unknown>): ProgrammeBlock {
    return {
      id: r['id'] as string,
      eventId: r['event_id'] as string,
      dayIndex: r['day_index'] as number,
      sortOrder: r['sort_order'] as number,
      blockType: r['block_type'] as BlockType,
      label: r['label'] as string,
      competitionId: (r['competition_id'] as string | null) ?? null,
      competitionPhase: (r['competition_phase'] as ProgrammePhase | null) ?? null,
      workshopId: (r['workshop_id'] as string | null) ?? null,
      liceCount: r['lice_count'] as number,
      startTime: r['start_time'] as string,
      endTime: r['end_time'] as string,
      matchGapSeconds: r['match_gap_seconds'] as number,
      matchDurationMinutes: r['match_duration_minutes'] as number,
      minRestMinutes: r['min_rest_minutes'] as number,
      colorHex: (r['color_hex'] as string | null) ?? null,
      generatedAt: (r['generated_at'] as string | null) ?? null,
    };
  }
}
