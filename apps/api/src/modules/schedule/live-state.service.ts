import { Injectable, NotFoundException } from '@nestjs/common';
import type { BlockType, ProgrammeBlock } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';

type ProgrammePhase = 'pool' | 'bracket' | 'finals';

export interface LiveMatch {
  id: string;
  matchNumberLabel: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  scheduledAt: string | null;
  status: string;
  tournamentName: string | null;
}

export interface LiveLiceState {
  lice: { id: string; name: string; sortOrder: number };
  runningMatch: LiveMatch | null;
  nextMatch: LiveMatch | null;
}

export interface LiveStateResponse {
  currentBlock: ProgrammeBlock | null;
  nextBlock: ProgrammeBlock | null;
  lices: LiveLiceState[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    const startDate = new Date(
      ((eventRes.data as Record<string, unknown> | null)?.['start_date'] as string) ?? '',
    );
    const dayIndex = isNaN(startDate.getTime())
      ? 0
      : Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));

    const lices = (licesRes.data ?? []) as { id: string; name: string; sort_order: number }[];

    const { data: blocksData } = await this.supabase.service
      .from('event_programme_blocks')
      .select('*')
      .eq('event_id', eventId)
      .eq('day_index', dayIndex)
      .order('sort_order', { ascending: true });

    const blocks = (blocksData ?? []).map((r) => this.mapBlock(r as Record<string, unknown>));
    const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let currentBlock: ProgrammeBlock | null = null;
    let nextBlock: ProgrammeBlock | null = null;
    for (const block of blocks) {
      const start = block.startTime.slice(0, 5);
      const end = block.endTime.slice(0, 5);
      if (start <= nowHHMM && nowHHMM <= end) {
        currentBlock = block;
      } else if (start > nowHHMM && !nextBlock) {
        nextBlock = block;
      }
    }

    const liceIds = lices.map((l) => l.id);
    let matchRows: Record<string, unknown>[] = [];
    if (liceIds.length > 0) {
      const { data } = await this.supabase.service
        .from('matches')
        .select(
          'id,status,scheduled_at,match_number_label,lice_id,' +
            'red:registrations!matches_red_registration_id_fkey(id,persons(display_name)),' +
            'blue:registrations!matches_blue_registration_id_fkey(id,persons(display_name)),' +
            'phases(tournaments(id,name))',
        )
        .in('lice_id', liceIds)
        .in('status', ['running', 'scheduled'])
        .order('scheduled_at', { ascending: true, nullsFirst: false });
      matchRows = (data ?? []) as unknown as Record<string, unknown>[];
    }

    const nowIso = now.toISOString();
    const liceStates: LiveLiceState[] = lices.map((lice) => {
      const liceMatches = matchRows.filter((m) => m['lice_id'] === lice.id);
      const runningMatch = liceMatches.find((m) => m['status'] === 'running') ?? null;
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
    const red = m['red'] as { persons?: { display_name?: string } } | null;
    const blue = m['blue'] as { persons?: { display_name?: string } } | null;
    const phases = m['phases'] as { tournaments?: { name?: string } } | null;
    return {
      id: m['id'] as string,
      matchNumberLabel: (m['match_number_label'] as string | null) ?? '',
      redFighterName: red?.persons?.display_name ?? null,
      blueFighterName: blue?.persons?.display_name ?? null,
      scheduledAt: (m['scheduled_at'] as string | null) ?? null,
      status: (m['status'] as string) ?? 'scheduled',
      tournamentName: phases?.tournaments?.name ?? null,
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
      generatedAt: (r['generated_at'] as string | null) ?? null,
    };
  }
}
