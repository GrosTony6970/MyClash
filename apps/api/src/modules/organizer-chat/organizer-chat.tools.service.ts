import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Read-tool executors for the organizer chatbot. Every tool is scoped to the
 * event and returns compact JSON for the model. Errors are returned as
 * `{ error }` rather than thrown, so a bad query degrades the turn instead of
 * failing the whole request. Queries use `select('*')` and map in JS to avoid
 * the PostgREST "unknown column 400s the whole query" footgun.
 */
@Injectable()
export class OrganizerChatToolsService {
  constructor(private readonly supabase: SupabaseService) {}

  async executeRead(
    eventId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      switch (toolName) {
        case 'list_tournaments':
          return await this.listTournaments(eventId);
        case 'list_phases':
          return await this.listPhases(eventId, str(args['tournamentId']));
        case 'list_pools':
          return await this.listPools(eventId, str(args['tournamentId']));
        case 'list_lices':
          return await this.listLices(eventId);
        case 'list_referees':
          return await this.listReferees(eventId);
        case 'list_unscheduled_matches':
          return await this.listUnscheduledMatches(eventId, str(args['tournamentId']));
        case 'get_tournament_summary':
          return await this.getTournamentSummary(eventId, str(args['tournamentId']));
        default:
          return { error: `Unknown read tool: ${toolName}` };
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'tool failed' };
    }
  }

  private async listTournaments(eventId: string) {
    const rows = await this.rows('tournaments', (q) => q.eq('event_id', eventId));
    return {
      tournaments: rows.map((r) => ({
        id: r['id'],
        name: r['name'] ?? null,
        slug: r['slug'] ?? null,
        weapon: r['weapon'] ?? null,
        rulesetCode: r['ruleset_code'] ?? null,
      })),
    };
  }

  private async listPhases(eventId: string, tournamentId: string) {
    await this.assertTournament(eventId, tournamentId);
    const rows = await this.rows('phases', (q) => q.eq('tournament_id', tournamentId));
    return {
      phases: rows.map((r) => ({
        id: r['id'],
        phaseType: r['phase_type'] ?? null,
      })),
    };
  }

  private async listPools(eventId: string, tournamentId: string) {
    await this.assertTournament(eventId, tournamentId);
    const phaseIds = await this.phaseIds(tournamentId);
    if (phaseIds.length === 0) return { pools: [] };
    const rows = await this.rows('pools', (q) => q.in('phase_id', phaseIds));
    return {
      pools: rows.map((r) => ({
        id: r['id'],
        name: r['name'] ?? null,
        phaseId: r['phase_id'] ?? null,
      })),
    };
  }

  private async listLices(eventId: string) {
    const rows = await this.rows('lices', (q) => q.eq('event_id', eventId));
    return {
      lices: rows
        .map((r) => ({
          id: r['id'],
          name: r['name'] ?? null,
          number: typeof r['sort_order'] === 'number' ? (r['sort_order'] as number) + 1 : null,
        }))
        .sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
    };
  }

  private async listReferees(eventId: string) {
    // person_ids currently set up as referees for the event (referee_assignments
    // keys on global_persons.id post-0063). Enrich with names best-effort.
    const assignments = await this.rows('referee_assignments', (q) => q.eq('event_id', eventId));
    const personIds = unique(
      assignments.map((r) => r['person_id']).filter((v): v is string => typeof v === 'string'),
    );
    if (personIds.length === 0) return { referees: [] };
    let names = new Map<string, string>();
    try {
      const persons = await this.rows('global_persons', (q) => q.in('id', personIds));
      names = new Map(
        persons.map((p) => [
          String(p['id']),
          String(p['display_name'] ?? p['full_name'] ?? p['name'] ?? p['id']),
        ]),
      );
    } catch {
      // names are optional; the id is what assign_referee needs
    }
    return {
      referees: personIds.map((id) => ({ personId: id, name: names.get(id) ?? null })),
    };
  }

  private async listUnscheduledMatches(eventId: string, tournamentId: string) {
    await this.assertTournament(eventId, tournamentId);
    const phaseIds = await this.phaseIds(tournamentId);
    if (phaseIds.length === 0) return { matches: [] };
    const rows = await this.rows('matches', (q) => q.in('phase_id', phaseIds));
    const unscheduled = rows.filter((r) => !r['lice_id'] || !r['scheduled_at']);
    return {
      matches: unscheduled.slice(0, 100).map((r) => ({
        id: r['id'],
        phaseId: r['phase_id'] ?? null,
        poolId: r['pool_id'] ?? null,
        liceId: r['lice_id'] ?? null,
        scheduledAt: r['scheduled_at'] ?? null,
        status: r['status'] ?? null,
      })),
      total: unscheduled.length,
    };
  }

  private async getTournamentSummary(eventId: string, tournamentId: string) {
    await this.assertTournament(eventId, tournamentId);
    const phaseIds = await this.phaseIds(tournamentId);
    const [pools, matches, registrations] = await Promise.all([
      phaseIds.length ? this.rows('pools', (q) => q.in('phase_id', phaseIds)) : Promise.resolve([]),
      phaseIds.length
        ? this.rows('matches', (q) => q.in('phase_id', phaseIds))
        : Promise.resolve([]),
      this.rows('registrations', (q) => q.eq('tournament_id', tournamentId)).catch(() => []),
    ]);
    const completed = matches.filter((m) => m['status'] === 'completed').length;
    return {
      fighters: registrations.length,
      pools: pools.length,
      matches: matches.length,
      completedMatches: completed,
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async assertTournament(eventId: string, tournamentId: string): Promise<void> {
    if (!tournamentId) throw new Error('tournamentId is required');
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('id', tournamentId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Tournament does not belong to this event');
  }

  private async phaseIds(tournamentId: string): Promise<string[]> {
    const rows = await this.rows('phases', (q) => q.eq('tournament_id', tournamentId));
    return rows.map((r) => r['id']).filter((v): v is string => typeof v === 'string');
  }

  private async rows(
    table: string,
    build: (q: QueryBuilder) => QueryBuilder,
  ): Promise<Array<Record<string, unknown>>> {
    const base = this.supabase.service.from(table).select('*') as unknown as QueryBuilder;
    const { data, error } = await build(base);
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<Record<string, unknown>>;
  }
}

/** Minimal structural view of the Supabase filter builder we use here. */
interface QueryBuilder extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(column: string, value: unknown): QueryBuilder;
  in(column: string, values: unknown[]): QueryBuilder;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
