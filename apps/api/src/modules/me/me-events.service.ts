/**
 * me-events.service.ts
 *
 * Cross-event aggregation for the redesigned personal space (/me):
 *   - listMyEvents(userId): one entry per event the user touches (competitor,
 *     referee, or workshop participant), with the event's tournaments (flagging
 *     the ones the user is registered in + their pool/seed/bib), the referee
 *     tournament/pool, and lightweight counts.
 *   - getUpcoming(userId, limit): the next N time-ordered fights + referee slots
 *     across ALL the user's events, for the dashboard "Next up".
 *
 * Identity chain (reused project-wide):
 *   global_persons.claimed_by_user_id → per-event `persons` (event-scoped) for
 *   registrations + workshop_enrollments; global_persons.id for referee_assignments.
 *
 * NOTE: `workshop_enrollments.user_id` holds the EVENT-SCOPED persons.id (see
 * workshops/enrollment.service.ts), NOT the auth user id.
 */

import { Injectable } from '@nestjs/common';
import { bracketRoundLabel } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { PublicScheduleService } from '../persons/public-schedule.service';

type Row = Record<string, unknown>;

/** Normalised referee match-kind token + (for round_of) the fighter count. */
function computeMatchKind(
  phaseType: string | null,
  bracketRound: number | null,
  bracketSize: number | null,
): { kind: string | null; roundOfCount: number | null } {
  if (phaseType === 'pool') return { kind: 'pool', roundOfCount: null };
  if (phaseType === 'swiss') return { kind: 'swiss', roundOfCount: null };
  if (phaseType === 'single_elim' || phaseType === 'double_elim') {
    if (bracketRound === 0) return { kind: 'play_in', roundOfCount: null };
    if (bracketRound != null && bracketRound > 0) {
      const code = bracketRoundLabel(bracketRound, bracketSize);
      if (code === 'F') return { kind: 'final', roundOfCount: null };
      if (code === 'SF') return { kind: 'semi_final', roundOfCount: null };
      if (code === 'QF') return { kind: 'quarter_final', roundOfCount: null };
      const m = /^R(\d+)$/.exec(code);
      return { kind: 'round_of', roundOfCount: m ? Number(m[1]) : null };
    }
  }
  return { kind: null, roundOfCount: null };
}

export interface MyEventInfo {
  id: string;
  slug: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  timezone: string | null;
}

export interface MyEventTournament {
  id: string;
  slug: string;
  name: string;
  weapon: string | null;
  registered: boolean;
  registrationId: string | null;
  poolName: string | null;
  seed: number | null;
  bibNumber: number | null;
}

export interface MyEventRefereeOf {
  tournamentName: string | null;
  poolName: string | null;
  role: string | null;
  skillName: string | null;
  skillColor: string | null;
  liceName: string | null;
  venueName: string | null;
  /** 'pool' | 'play_in' | 'final' | 'semi_final' | 'quarter_final' | 'round_of' | 'swiss' | null */
  matchKind: string | null;
  /** fighter count for matchKind === 'round_of' (e.g. 16) */
  roundOfCount: number | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface MyEvent {
  event: MyEventInfo;
  roles: { isCompetitor: boolean; isReferee: boolean; isWorkshopParticipant: boolean };
  tournaments: MyEventTournament[];
  refereeOf: MyEventRefereeOf[];
  counts: { matches: number; refereeSlots: number; workshops: number };
}

export interface UpcomingItem {
  kind: 'fight' | 'referee';
  eventId: string;
  eventSlug: string;
  eventName: string;
  eventTimezone: string | null;
  scheduledAt: string;
  matchId: string;
  matchNumberLabel: string;
  tournamentName: string | null;
  poolName: string | null;
  liceName: string | null;
  opponentName: string | null;
  isRed: boolean | null;
  role: string | null;
}

/** PostgREST embeds resolve to an object (1:1) or an array (1:N); normalise to one. */
function one<T = Row>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

export interface MyLeagueGroup {
  groupKey: string;
  rank: number;
  totalPoints: number;
  participationCount: number;
  medalCount: number;
}

export interface MyLeague {
  leagueId: string;
  leagueName: string;
  leagueSlug: string;
  seasonYear: number;
  logoUrl: string | null;
  groups: MyLeagueGroup[];
}

@Injectable()
export class MeEventsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly schedule: PublicScheduleService,
  ) {}

  // ── /me/leagues ───────────────────────────────────────────────────────────

  /** Every published+public league the signed-in fighter is ranked in, grouped
   *  by league (one entry per ranking_group_key the fighter appears in). Powers
   *  the personal-space "My leagues" surface + its self-highlighted classement. */
  async listMyLeagues(userId: string): Promise<{ fighterId: string | null; leagues: MyLeague[] }> {
    const fighterId = await this.resolveGlobalPersonId(userId);
    if (!fighterId) return { fighterId: null, leagues: [] };

    const { data } = await this.supabase.service
      .from('league_rankings')
      .select(
        'ranking_group_key, rank, total_points, participation_count, medal_count, leagues(id, name, slug, season_year, logo_url, public_visibility, status)',
      )
      .eq('fighter_id', fighterId);

    const rows = Array.isArray(data) ? (data as Row[]) : [];
    const byLeague = new Map<string, MyLeague>();
    for (const row of rows) {
      const league = one(row['leagues']);
      // Only leagues with a live public classement to open.
      if (!league || league['public_visibility'] !== true || league['status'] !== 'published') {
        continue;
      }
      const leagueId = String(league['id']);
      let entry = byLeague.get(leagueId);
      if (!entry) {
        entry = {
          leagueId,
          leagueName: String(league['name'] ?? ''),
          leagueSlug: String(league['slug'] ?? ''),
          seasonYear: Number(league['season_year'] ?? 0),
          logoUrl: (league['logo_url'] as string | null) ?? null,
          groups: [],
        };
        byLeague.set(leagueId, entry);
      }
      entry.groups.push({
        groupKey: String(row['ranking_group_key'] ?? ''),
        rank: Number(row['rank'] ?? 0),
        totalPoints: Number(row['total_points'] ?? 0),
        participationCount: Number(row['participation_count'] ?? 0),
        medalCount: Number(row['medal_count'] ?? 0),
      });
    }

    const bestRank = (league: MyLeague) => Math.min(...league.groups.map((g) => g.rank));
    return {
      fighterId,
      leagues: [...byLeague.values()]
        .map((league) => ({
          ...league,
          groups: [...league.groups].sort((a, b) => a.rank - b.rank),
        }))
        .sort((a, b) => b.seasonYear - a.seasonYear || bestRank(a) - bestRank(b)),
    };
  }

  // ── /me/events ────────────────────────────────────────────────────────────

  async listMyEvents(userId: string): Promise<MyEvent[]> {
    const [claimedPersons, globalPersonId] = await Promise.all([
      this.fetchClaimedPersons(userId),
      this.resolveGlobalPersonId(userId),
    ]);

    const personIds = claimedPersons.map((p) => p.id);

    const [refAssignments, workshopEvents, registrations] = await Promise.all([
      this.fetchRefereeAssignments(globalPersonId),
      this.fetchWorkshopEventIds(personIds),
      this.fetchRegistrations(personIds),
    ]);

    // Build the event set (union of competitor / referee / workshop events).
    const events = new Map<string, MyEvent>();
    const ensure = (info: MyEventInfo | null): MyEvent | null => {
      if (!info) return null;
      let entry = events.get(info.id);
      if (!entry) {
        entry = {
          event: info,
          roles: { isCompetitor: false, isReferee: false, isWorkshopParticipant: false },
          tournaments: [],
          refereeOf: [],
          counts: { matches: 0, refereeSlots: 0, workshops: 0 },
        };
        events.set(info.id, entry);
      }
      return entry;
    };

    for (const p of claimedPersons) ensure(p.event);
    for (const a of refAssignments) {
      const entry = ensure(a.event);
      if (!entry) continue;
      entry.roles.isReferee = true;
      entry.counts.refereeSlots += 1;
      entry.refereeOf.push({
        tournamentName: a.tournamentName,
        poolName: a.poolName,
        role: a.role,
        skillName: a.skillName,
        skillColor: a.skillColor,
        liceName: a.liceName,
        venueName: a.venueName,
        matchKind: a.matchKind,
        roundOfCount: a.roundOfCount,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
      });
    }
    for (const info of workshopEvents.values()) {
      const entry = ensure(info);
      if (!entry) continue;
      entry.roles.isWorkshopParticipant = true;
      entry.counts.workshops += 1;
    }

    // Tournaments for every touched event + the user's registration flags.
    const eventIds = [...events.keys()];
    const [allTournaments, matchCounts] = await Promise.all([
      this.fetchTournamentsForEvents(eventIds),
      this.fetchMatchCounts(registrations.map((r) => r.id)),
    ]);
    const regByTournament = new Map(registrations.map((r) => [r.tournamentId, r]));
    const tournamentToEvent = new Map(allTournaments.map((t) => [t.id, t.eventId]));

    for (const t of allTournaments) {
      const entry = events.get(t.eventId);
      if (!entry) continue;
      const reg = regByTournament.get(t.id);
      if (reg) {
        entry.roles.isCompetitor = true;
      }
      entry.tournaments.push({
        id: t.id,
        slug: t.slug,
        name: t.name,
        weapon: t.weapon,
        registered: Boolean(reg),
        registrationId: reg?.id ?? null,
        poolName: reg?.poolName ?? null,
        seed: reg?.seed ?? null,
        bibNumber: reg?.bibNumber ?? null,
      });
    }

    // Match counts (user's fights) per event, mapped via registration→tournament→event.
    for (const mc of matchCounts) {
      const reg = registrations.find((r) => r.id === mc.registrationId);
      if (!reg) continue;
      const eventId = tournamentToEvent.get(reg.tournamentId);
      if (!eventId) continue;
      const entry = events.get(eventId);
      if (entry) entry.counts.matches += mc.count;
    }

    // Sort: live first, then by start date desc.
    return [...events.values()].sort((a, b) => {
      const liveA = a.event.status === 'running' || a.event.status === 'published' ? 0 : 1;
      const liveB = b.event.status === 'running' || b.event.status === 'published' ? 0 : 1;
      if (liveA !== liveB) return liveA - liveB;
      return (b.event.startDate ?? '').localeCompare(a.event.startDate ?? '');
    });
  }

  // ── /me/upcoming ──────────────────────────────────────────────────────────

  async getUpcoming(userId: string, limit: number): Promise<UpcomingItem[]> {
    const claimedPersons = await this.fetchClaimedPersons(userId);
    const targets = claimedPersons.flatMap((p) =>
      p.event ? [{ personId: p.id, event: p.event }] : [],
    );
    if (targets.length === 0) return [];

    const schedules = await Promise.all(
      targets.map(async (t) => ({
        event: t.event,
        schedule: await this.schedule.getSchedule(t.event.id, t.personId, t.personId),
      })),
    );

    const items: UpcomingItem[] = [];
    for (const { event: info, schedule } of schedules) {
      for (const m of schedule.matches) {
        if (!m.scheduledAt) continue;
        items.push({
          kind: 'fight',
          eventId: info.id,
          eventSlug: info.slug,
          eventName: info.name,
          eventTimezone: info.timezone,
          scheduledAt: m.scheduledAt,
          matchId: m.id,
          matchNumberLabel: m.matchNumberLabel,
          tournamentName: m.tournamentName,
          poolName: m.poolName,
          liceName: m.liceName,
          opponentName: m.opponentName,
          isRed: m.isRed,
          role: null,
        });
      }
      for (const s of schedule.refereeSlots) {
        if (!s.scheduledAt) continue;
        items.push({
          kind: 'referee',
          eventId: info.id,
          eventSlug: info.slug,
          eventName: info.name,
          eventTimezone: info.timezone,
          scheduledAt: s.scheduledAt,
          matchId: s.matchId,
          matchNumberLabel: s.matchNumberLabel,
          tournamentName: s.tournamentName,
          poolName: s.poolName,
          liceName: null,
          opponentName: null,
          isRed: null,
          role: s.role,
        });
      }
    }

    return items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, limit);
  }

  // ── Private fetchers ────────────────────────────────────────────────────────

  private async fetchClaimedPersons(
    userId: string,
  ): Promise<Array<{ id: string; eventId: string; event: MyEventInfo | null }>> {
    const { data } = await this.supabase.service
      .from('persons')
      .select(
        'id, event_id, events(id, slug, name, start_date, end_date, status, timezone, is_test_event)',
      )
      .eq('claimed_by_user_id', userId);
    const rows = Array.isArray(data) ? (data as Row[]) : [];
    return rows.map((r) => ({
      id: String(r['id']),
      eventId: String(r['event_id']),
      event: this.mapEvent(one(r['events'])),
    }));
  }

  private async resolveGlobalPersonId(userId: string): Promise<string | null> {
    const { data } = await this.supabase.service
      .from('global_persons')
      .select('id')
      .eq('claimed_by_user_id', userId)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  private async fetchRefereeAssignments(globalPersonId: string | null): Promise<
    Array<{
      event: MyEventInfo | null;
      role: string | null;
      tournamentName: string | null;
      poolName: string | null;
      skillName: string | null;
      skillColor: string | null;
      liceName: string | null;
      venueName: string | null;
      matchKind: string | null;
      roundOfCount: number | null;
      startsAt: string | null;
      endsAt: string | null;
    }>
  > {
    if (!globalPersonId) return [];
    const { data } = await this.supabase.service
      .from('referee_assignments')
      .select(
        `
        role, starts_at, ends_at, pool_id,
        events ( id, slug, name, start_date, end_date, status, timezone, is_test_event ),
        pools ( name, phases ( type, config_json, tournaments ( name ) ) ),
        matches (
          bracket_slot_id,
          pools ( name, phases ( type, config_json, tournaments ( name ) ) ),
          phases ( type, config_json, tournaments ( name ) ),
          lices ( name, venues ( name ) )
        ),
        lices ( name, venues ( name ) )
      `,
      )
      .eq('person_id', globalPersonId);
    const rows = Array.isArray(data) ? (data as Row[]) : [];

    const assignments = rows.map((r) => {
      const pool = one(r['pools']);
      const match = one(r['matches']);
      const matchPool = match ? one(match['pools']) : null;
      const lice = (match ? one(match['lices']) : null) ?? one(r['lices']);
      const venue = lice ? one(lice['venues']) : null;
      const phase = one(pool?.['phases']) ?? one(matchPool?.['phases']) ?? one(match?.['phases']);
      const phaseType = (phase?.['type'] as string | undefined) ?? null;
      const config = (phase?.['config_json'] as { bracketSize?: number } | null) ?? null;
      return {
        event: this.mapEvent(one(r['events'])),
        role: (r['role'] as string | null) ?? null,
        tournamentName:
          this.tournamentNameFrom(pool) ??
          this.tournamentNameFrom(matchPool) ??
          this.tournamentNameFrom(match),
        poolName:
          (pool?.['name'] as string | undefined) ??
          (matchPool?.['name'] as string | undefined) ??
          null,
        skillName: null as string | null,
        skillColor: null as string | null,
        liceName: (lice?.['name'] as string | undefined) ?? null,
        venueName: (venue?.['name'] as string | undefined) ?? null,
        phaseType,
        bracketSize: config?.bracketSize ?? null,
        bracketSlotId: (match?.['bracket_slot_id'] as string | null) ?? null,
        matchKind: null as string | null,
        roundOfCount: null as number | null,
        startsAt: (r['starts_at'] as string | null) ?? null,
        endsAt: (r['ends_at'] as string | null) ?? null,
        poolId: (r['pool_id'] as string | null) ?? null,
      };
    });

    // Bracket round (match-scoped) — resolved without a matches→bracket_slots embed.
    const slotIds = [
      ...new Set(assignments.map((a) => a.bracketSlotId).filter((x): x is string => !!x)),
    ];
    const roundBySlot = new Map<string, number | null>();
    if (slotIds.length > 0) {
      const { data: slots } = await this.supabase.service
        .from('bracket_slots')
        .select('id, round')
        .in('id', slotIds);
      for (const s of Array.isArray(slots) ? (slots as Row[]) : []) {
        roundBySlot.set(String(s['id']), (s['round'] as number | null) ?? null);
      }
    }
    for (const a of assignments) {
      const round = a.bracketSlotId ? (roundBySlot.get(a.bracketSlotId) ?? null) : null;
      const { kind, roundOfCount } = computeMatchKind(a.phaseType, round, a.bracketSize);
      a.matchKind = kind;
      a.roundOfCount = roundOfCount;
    }

    // Pool-scoped assignments carry no direct lice — borrow a representative
    // scheduled match's lice/venue from within the pool.
    const poolsNeedingLice = [
      ...new Set(assignments.filter((a) => !a.liceName && a.poolId).map((a) => a.poolId as string)),
    ];
    if (poolsNeedingLice.length > 0) {
      const { data: pm } = await this.supabase.service
        .from('matches')
        .select('pool_id, lices ( name, venues ( name ) )')
        .in('pool_id', poolsNeedingLice)
        .not('lice_id', 'is', null);
      const byPool = new Map<string, { liceName: string | null; venueName: string | null }>();
      for (const m of Array.isArray(pm) ? (pm as Row[]) : []) {
        const pid = String(m['pool_id']);
        if (byPool.has(pid)) continue;
        const lice = one(m['lices']);
        const venue = lice ? one(lice['venues']) : null;
        byPool.set(pid, {
          liceName: (lice?.['name'] as string | undefined) ?? null,
          venueName: (venue?.['name'] as string | undefined) ?? null,
        });
      }
      for (const a of assignments) {
        const v = a.poolId ? byPool.get(a.poolId) : undefined;
        if (!a.liceName && v) {
          a.liceName = v.liceName;
          a.venueName = v.venueName;
        }
      }
    }

    // Skill name + colour from the role id (referee_skills).
    const roleIds = [...new Set(assignments.map((a) => a.role).filter((x): x is string => !!x))];
    if (roleIds.length > 0) {
      const { data: skills } = await this.supabase.service
        .from('referee_skills')
        .select('id, name, color')
        .in('id', roleIds);
      const byId = new Map<string, { name: string; color: string }>();
      for (const s of Array.isArray(skills) ? (skills as Row[]) : []) {
        byId.set(String(s['id']), {
          name: String(s['name'] ?? ''),
          color: String(s['color'] ?? ''),
        });
      }
      for (const a of assignments) {
        const skill = a.role ? byId.get(a.role) : undefined;
        if (skill) {
          a.skillName = skill.name;
          a.skillColor = skill.color;
        }
      }
    }

    return assignments.map((a) => ({
      event: a.event,
      role: a.role,
      tournamentName: a.tournamentName,
      poolName: a.poolName,
      skillName: a.skillName,
      skillColor: a.skillColor,
      liceName: a.liceName,
      venueName: a.venueName,
      matchKind: a.matchKind,
      roundOfCount: a.roundOfCount,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
    }));
  }

  private tournamentNameFrom(node: Row | null): string | null {
    if (!node) return null;
    const phases = one(node['phases']);
    const tournaments = phases ? one(phases['tournaments']) : null;
    return (tournaments?.['name'] as string | undefined) ?? null;
  }

  private async fetchWorkshopEventIds(
    personIds: string[],
  ): Promise<Map<string, MyEventInfo | null>> {
    if (personIds.length === 0) return new Map();
    const { data } = await this.supabase.service
      .from('workshop_enrollments')
      .select(
        'workshop_sessions ( workshops ( event_id, events ( id, slug, name, start_date, end_date, status, timezone, is_test_event ) ) )',
      )
      .in('user_id', personIds)
      .in('status', ['confirmed', 'intent', 'waitlisted']);
    const rows = Array.isArray(data) ? (data as Row[]) : [];
    const map = new Map<string, MyEventInfo | null>();
    for (const r of rows) {
      const session = one(r['workshop_sessions']);
      const workshop = session ? one(session['workshops']) : null;
      const event = workshop ? this.mapEvent(one(workshop['events'])) : null;
      if (event) map.set(event.id, event);
    }
    return map;
  }

  private async fetchRegistrations(personIds: string[]): Promise<
    Array<{
      id: string;
      tournamentId: string;
      seed: number | null;
      bibNumber: number | null;
      poolName: string | null;
    }>
  > {
    if (personIds.length === 0) return [];
    const { data } = await this.supabase.service
      .from('registrations')
      .select('id, tournament_id, seed, bib_number, status')
      .in('person_id', personIds)
      .neq('status', 'withdrawn');
    const rows = Array.isArray(data) ? (data as Row[]) : [];
    const regs = rows.map((r) => ({
      id: String(r['id']),
      tournamentId: String(r['tournament_id']),
      seed: (r['seed'] as number | null) ?? null,
      bibNumber: (r['bib_number'] as number | null) ?? null,
      poolName: null as string | null,
    }));

    // Resolve each registration's pool (if any) via pool_members → pools.
    const regIds = regs.map((r) => r.id);
    if (regIds.length > 0) {
      const { data: members } = await this.supabase.service
        .from('pool_members')
        .select('registration_id, pools ( name )')
        .in('registration_id', regIds);
      const memberRows = Array.isArray(members) ? (members as Row[]) : [];
      const poolByReg = new Map<string, string | null>();
      for (const m of memberRows) {
        const pool = one(m['pools']);
        poolByReg.set(String(m['registration_id']), (pool?.['name'] as string | undefined) ?? null);
      }
      for (const r of regs) r.poolName = poolByReg.get(r.id) ?? null;
    }
    return regs;
  }

  private async fetchTournamentsForEvents(
    eventIds: string[],
  ): Promise<
    Array<{ id: string; eventId: string; slug: string; name: string; weapon: string | null }>
  > {
    if (eventIds.length === 0) return [];
    const { data } = await this.supabase.service
      .from('tournaments')
      .select('id, event_id, slug, name, weapon')
      .in('event_id', eventIds)
      .order('name', { ascending: true });
    const rows = Array.isArray(data) ? (data as Row[]) : [];
    return rows.map((t) => ({
      id: String(t['id']),
      eventId: String(t['event_id']),
      slug: String(t['slug']),
      name: String(t['name']),
      weapon: (t['weapon'] as string | null) ?? null,
    }));
  }

  private async fetchMatchCounts(
    registrationIds: string[],
  ): Promise<Array<{ registrationId: string; count: number }>> {
    if (registrationIds.length === 0) return [];
    const ids = registrationIds.join(',');
    const { data } = await this.supabase.service
      .from('matches')
      .select('red_registration_id, blue_registration_id')
      .or(`red_registration_id.in.(${ids}),blue_registration_id.in.(${ids})`);
    const rows = Array.isArray(data) ? (data as Row[]) : [];
    const counts = new Map<string, number>();
    const bump = (id: unknown) => {
      if (typeof id === 'string' && registrationIds.includes(id)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    };
    for (const m of rows) {
      bump(m['red_registration_id']);
      bump(m['blue_registration_id']);
    }
    return [...counts.entries()].map(([registrationId, count]) => ({ registrationId, count }));
  }

  private mapEvent(row: Row | null): MyEventInfo | null {
    if (!row) return null;
    // Test events are hidden from the personal space. mapEvent is the single
    // choke point for every /me source (competitor, referee, workshop), so
    // dropping them here keeps listMyEvents + getUpcoming test-free.
    if (row['is_test_event'] === true) return null;
    return {
      id: String(row['id']),
      slug: String(row['slug']),
      name: String(row['name']),
      startDate: (row['start_date'] as string | null) ?? null,
      endDate: (row['end_date'] as string | null) ?? null,
      status: String(row['status'] ?? ''),
      timezone: (row['timezone'] as string | null) ?? null,
    };
  }
}
