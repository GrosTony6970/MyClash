import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { entrantKindMismatch } from '../../common/entrant-kind-refusal';
import type { Upload } from '../../common/read-upload';
import { storedKind } from '../events/tournament-kind';
import { storeEventImage } from '../events/event-assets';
import { FOUGHT_STATUSES } from '../matches/fought-match';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateTeamDto, UpdateTeamDto } from './dto/teams.dto';
import { pickTeamSlug } from './team-slug';
import {
  isSlugTaken,
  teamDeleteRefusal,
  teamInBouts,
  teamSizeLocked,
  teamWriteRefusal,
  tournamentFull,
} from './team-refusals';

const TEAM_COLUMNS = 'id, tournament_id, name, slug, size, seed, color, logo_url';

interface TeamRow {
  id: string;
  tournament_id: string;
  name: string;
  slug: string;
  size: number;
  seed: number | null;
  color: string | null;
  logo_url: string | null;
}

/** A team as the Teams screen reads it. */
export interface TeamView {
  id: string;
  tournamentId: string;
  name: string;
  slug: string;
  size: number;
  seed: number | null;
  color: string | null;
  logoUrl: string | null;
}

/** The Tournament columns a team create reads. */
interface TournamentRow {
  max_participants: number | null;
  team_default_size: number | null;
  entrant_kind: unknown;
}

const toView = (row: TeamRow): TeamView => ({
  id: row.id,
  tournamentId: row.tournament_id,
  name: row.name,
  slug: row.slug,
  size: row.size,
  seed: row.seed,
  color: row.color,
  logoUrl: row.logo_url,
});

/**
 * The teams of a team Tournament: list, create, save, delete, logo. The caller's role is checked
 * on the Tournament of the URL by the controller. That check says nothing about a team id, so
 * every read and write by team id here is scoped to that Tournament too, and answers 404 when the
 * team is not one of its own: an editor of club A must not touch club B's team by its id.
 *
 * In slice 1b a team has no slot rows and no status (rulings 973, plan): its size is the truth.
 */
@Injectable()
export class TeamsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(tournamentId: string): Promise<TeamView[]> {
    const { data, error } = await this.supabase.service
      .from('teams')
      .select(TEAM_COLUMNS)
      .eq('tournament_id', tournamentId)
      .order('seed', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as TeamRow[]).map(toView);
  }

  /**
   * The cap is `tournaments.max_participants`, counted over the Tournament's teams before the
   * insert. Two creates at once can both pass the count and overrun the cap by one: the
   * count-then-insert race the Registrations accept (`registrations.service.ts`,
   * `assertCapacityForCreate`). Named, accepted.
   *
   * Two names that slug alike ("Lyon Blades", "Lyon-Blades"), saved at once, can also pick the
   * same slug: the second insert is refused by `teams_tournament_slug_key`. That insert reads the
   * slugs again and tries once more, with the slug the other team left free. A third save at the
   * same moment that loses twice answers a 400 with the database's text.
   */
  async create(tournamentId: string, dto: CreateTeamDto): Promise<TeamView> {
    const tournament = await this.tournamentOf(tournamentId);
    // An individual Tournament takes no team. Said first, as a Pool seat says it
    // (`assertSeatFitsKind`): its missing team size is not the cause.
    if (storedKind(tournament.entrant_kind) !== 'team') throw entrantKindMismatch();
    const slugs = await this.slugsOf(tournamentId);
    const cap = tournament.max_participants;
    if (cap != null && slugs.length >= cap) throw tournamentFull(slugs.length, cap);
    const size = dto.size ?? tournament.team_default_size;
    if (size == null) {
      throw new BadRequestException({
        code: 'team_size_required',
        message: 'This Tournament has no default team size: send a size.',
      });
    }

    const row = {
      tournament_id: tournamentId,
      name: dto.name,
      size,
      color: dto.color ?? null,
      seed: dto.seed ?? null,
    };
    let written = await this.insertTeam({ ...row, slug: pickTeamSlug(dto.name, new Set(slugs)) });
    if (written.error && isSlugTaken(written.error)) {
      const now = await this.slugsOf(tournamentId);
      written = await this.insertTeam({ ...row, slug: pickTeamSlug(dto.name, new Set(now)) });
    }
    // A Tournament made individual since the read above: the kind trigger (0281) refuses it.
    if (written.error) throw teamWriteRefusal(written.error);
    return toView(written.data as TeamRow);
  }

  private async insertTeam(row: Record<string, unknown>) {
    return this.supabase.service.from('teams').insert(row).select(TEAM_COLUMNS).single();
  }

  /**
   * The slug is kept on a rename: it was the team's address when it was made.
   *
   * The size lock reads the bouts, then writes: a bout started between the two keeps the new
   * size. Accepted: no team bout can start before slice 1b-2 (the pad), and the window is one
   * organiser's save.
   */
  async update(tournamentId: string, teamId: string, dto: UpdateTeamDto): Promise<TeamView> {
    const team = await this.teamOf(tournamentId, teamId);
    if (dto.size !== undefined && dto.size !== team.size && (await this.hasStartedBout(teamId))) {
      throw teamSizeLocked();
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) patch['name'] = dto.name;
    if (dto.size !== undefined) patch['size'] = dto.size;
    if (dto.color !== undefined) patch['color'] = dto.color;
    if (dto.seed !== undefined) patch['seed'] = dto.seed;
    if (dto.logoUrl !== undefined) patch['logo_url'] = dto.logoUrl;

    const { data, error } = await this.supabase.service
      .from('teams')
      .update(patch)
      .eq('id', teamId)
      .eq('tournament_id', tournamentId)
      .select(TEAM_COLUMNS)
      .maybeSingle();
    if (error) throw teamWriteRefusal(error);
    if (!data) throw new NotFoundException(`Team ${teamId} not found`);
    return toView(data as TeamRow);
  }

  /** A team in a Pool with no bout leaves its Pool by cascade (`pool_members`, 0282). */
  async remove(tournamentId: string, teamId: string): Promise<void> {
    await this.teamOf(tournamentId, teamId);
    if (await this.isNamedByBout(teamId)) throw teamInBouts();
    const { error } = await this.supabase.service
      .from('teams')
      .delete()
      .eq('id', teamId)
      .eq('tournament_id', tournamentId);
    if (error) throw teamDeleteRefusal(error);
  }

  /**
   * A team's logo, stored as a Tournament's (`storeEventImage`): the public `event-assets`
   * bucket, PNG, JPEG or WebP up to 10 MB, under `teams/{id}/`.
   */
  async uploadLogo(tournamentId: string, teamId: string, file: Upload): Promise<{ url: string }> {
    await this.teamOf(tournamentId, teamId);
    const url = await storeEventImage(this.supabase.service.storage, `teams/${teamId}`, file);

    const { data, error } = await this.supabase.service
      .from('teams')
      .update({ logo_url: url, updated_at: new Date().toISOString() })
      .eq('id', teamId)
      .eq('tournament_id', tournamentId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Team ${teamId} not found`);
    return { url };
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  private async tournamentOf(tournamentId: string): Promise<TournamentRow> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('max_participants, team_default_size, entrant_kind')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    return data as TournamentRow;
  }

  /** The slugs of the Tournament's teams: one per team, so also their count. */
  private async slugsOf(tournamentId: string): Promise<string[]> {
    const { data, error } = await this.supabase.service
      .from('teams')
      .select('slug')
      .eq('tournament_id', tournamentId);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<{ slug: string }>).map((row) => row.slug);
  }

  /** The team, when it is one of the Tournament's; else 404. */
  private async teamOf(tournamentId: string, teamId: string): Promise<TeamRow> {
    const { data, error } = await this.supabase.service
      .from('teams')
      .select(TEAM_COLUMNS)
      .eq('id', teamId)
      .eq('tournament_id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Team ${teamId} not found`);
    return data as TeamRow;
  }

  /**
   * Whether a bout naming the team has started: running, paused or completed
   * (`FOUGHT_STATUSES`). A scheduled bout has not; a voided one counts for nothing, whether it ran
   * or not.
   */
  private async hasStartedBout(teamId: string): Promise<boolean> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id')
      .or(`red_team_id.eq.${teamId},blue_team_id.eq.${teamId}`)
      .in('status', [...FOUGHT_STATUSES])
      .limit(1);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).length > 0;
  }

  /** Whether any bout names the team, in any status: its key refuses the delete at commit. */
  private async isNamedByBout(teamId: string): Promise<boolean> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id')
      .or(`red_team_id.eq.${teamId},blue_team_id.eq.${teamId}`)
      .limit(1);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).length > 0;
  }
}
