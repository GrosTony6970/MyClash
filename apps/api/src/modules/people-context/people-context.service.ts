import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PoolStandingsService } from '../pool-standings/pool-standings.service';
import { FollowsService } from '../follows/follows.service';

/** The live tournament context shown on a People-hub fighter card. */
export interface PersonContextNextMatch {
  label: string;
  scheduledAt: string | null;
  opponentName: string | null;
  poolName: string | null;
  liceName: string | null;
}

export interface PersonContext {
  globalPersonId: string;
  slug: string;
  displayName: string;
  clubName: string | null;
  photoUrl: string | null;
  countryCode: string | null;
  /** HEMA Ratings id, treated as the fighter's license reference. */
  license: string | null;
  isFollowing: boolean;
  tournament: { id: string; name: string; slug: string } | null;
  poolName: string | null;
  /** Live pool-standing rank in the focus tournament (null if not ranked yet). */
  rank: number | null;
  nextMatch: PersonContextNextMatch | null;
}

const TERMINAL_EVENT_STATUSES = ['completed', 'archived'];
const ACTIVE_MATCH_STATUSES = ['scheduled', 'running'];

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

/**
 * Enriches a set of global persons with their live tournament context —
 * current/next tournament, pool, license, next match, and pool-standing rank —
 * plus the viewer's follow state. Reuses the registrations/pools/matches shapes
 * from PublicScheduleService and rank from PoolStandingsService, batched so the
 * cost is bounded by the number of distinct tournaments, not the number of
 * people. Powers both the Search tab (on-demand) and the Following tab.
 */
@Injectable()
export class PeopleContextService {
  private readonly logger = new Logger(PeopleContextService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly poolStandings: PoolStandingsService,
    private readonly follows: FollowsService,
  ) {}

  async enrich(globalPersonIds: string[], viewerUserId: string | null): Promise<PersonContext[]> {
    const ids = [...new Set(globalPersonIds.filter(Boolean))];
    if (ids.length === 0) return [];

    // 1. Base identity (name / club / photo / license).
    const { data: gpData } = await this.supabase.service
      .from('global_persons')
      .select('id, slug, display_name, photo_url, country_code, hema_ratings_id, clubs ( name )')
      .in('id', ids);
    const base = new Map<string, PersonContext>();
    for (const r of (gpData ?? []) as Array<Record<string, unknown>>) {
      base.set(r['id'] as string, {
        globalPersonId: r['id'] as string,
        slug: (r['slug'] as string) ?? '',
        displayName: (r['display_name'] as string) ?? '',
        clubName: (one(r['clubs'])?.['name'] as string | undefined) ?? null,
        photoUrl: (r['photo_url'] as string | null) ?? null,
        countryCode: (r['country_code'] as string | null) ?? null,
        license: (r['hema_ratings_id'] as string | null) ?? null,
        isFollowing: false,
        tournament: null,
        poolName: null,
        rank: null,
        nextMatch: null,
      });
    }

    // 2. Follow state (viewer-scoped).
    if (viewerUserId) {
      const followed = await this.follows.filterFollowedGlobalPersons(viewerUserId, ids);
      for (const gp of followed) {
        const ctx = base.get(gp);
        if (ctx) ctx.isFollowing = true;
      }
    }

    // 3. Active event-scoped persons for these globals (non-terminal, non-test).
    const { data: personData } = await this.supabase.service
      .from('persons')
      .select('id, global_person_id, events!inner ( status, is_test_event )')
      .in('global_person_id', ids);
    const personToGlobal = new Map<string, string>();
    for (const r of (personData ?? []) as Array<Record<string, unknown>>) {
      const ev = one(r['events']);
      const active =
        !!ev &&
        ev['is_test_event'] !== true &&
        !TERMINAL_EVENT_STATUSES.includes(String(ev['status'] ?? ''));
      if (active) personToGlobal.set(r['id'] as string, r['global_person_id'] as string);
    }
    const activePersonIds = [...personToGlobal.keys()];
    if (activePersonIds.length === 0) return [...base.values()];

    // 4. Registrations for those persons (drives tournament / pool / rank / match).
    const { data: regData } = await this.supabase.service
      .from('registrations')
      .select('id, person_id, tournament_id, status')
      .in('person_id', activePersonIds)
      .neq('status', 'withdrawn');
    const regToGlobal = new Map<string, string>(); // registrationId → globalPersonId
    const regToTournament = new Map<string, string>();
    const globalToRegIds = new Map<string, string[]>();
    for (const r of (regData ?? []) as Array<Record<string, unknown>>) {
      const regId = r['id'] as string;
      const gp = personToGlobal.get(r['person_id'] as string);
      if (!gp) continue;
      regToGlobal.set(regId, gp);
      regToTournament.set(regId, r['tournament_id'] as string);
      const list = globalToRegIds.get(gp) ?? [];
      list.push(regId);
      globalToRegIds.set(gp, list);
    }
    const regIds = [...regToGlobal.keys()];
    if (regIds.length === 0) return [...base.values()];

    // 5. Next (scheduled/running) matches for those registrations. Ascending by
    //    time, so the first match seen per global person is their next one and
    //    picks the "focus" registration/tournament.
    const nextMatchByGlobal = await this.fetchNextMatches(regIds, regToGlobal);

    // Focus registration per global person: the next match's registration, or —
    // when they have no upcoming match — their first active registration, so the
    // card still shows the tournament they're entered in.
    const focusRegByGlobal = new Map<string, string>();
    for (const [gp, regList] of globalToRegIds) {
      const fromMatch = nextMatchByGlobal.get(gp)?.focusRegId;
      focusRegByGlobal.set(gp, fromMatch ?? regList[0]!);
    }

    const focusRegIds = [...focusRegByGlobal.values()];
    const focusTournamentIds = [
      ...new Set(focusRegIds.map((rid) => regToTournament.get(rid)!).filter(Boolean)),
    ];

    // 6. Tournament names + pool names + ranks (batched).
    const [tournamentById, poolByReg, rankByReg] = await Promise.all([
      this.fetchTournaments(focusTournamentIds),
      this.fetchPoolNames(focusRegIds),
      this.fetchRanks(focusTournamentIds),
    ]);

    // 7. Compose.
    for (const [gp, ctx] of base) {
      const focusReg = focusRegByGlobal.get(gp);
      if (focusReg) {
        const tId = regToTournament.get(focusReg);
        ctx.tournament = (tId && tournamentById.get(tId)) || null;
        ctx.poolName = poolByReg.get(focusReg) ?? null;
        ctx.rank = rankByReg.get(focusReg) ?? null;
      }
      const nm = nextMatchByGlobal.get(gp);
      if (nm) ctx.nextMatch = nm.match;
    }

    return [...base.values()];
  }

  /** Earliest upcoming match per global person (+ the registration it's tied to). */
  private async fetchNextMatches(
    regIds: string[],
    regToGlobal: Map<string, string>,
  ): Promise<Map<string, { match: PersonContextNextMatch; focusRegId: string }>> {
    const result = new Map<string, { match: PersonContextNextMatch; focusRegId: string }>();
    const inList = regIds.join(',');
    const { data } = await this.supabase.service
      .from('matches')
      .select(
        `id, match_number_label, status, scheduled_at,
         red_registration_id, blue_registration_id,
         pools ( name ), lices ( name ),
         phases ( visibility_status )`,
      )
      .or(`red_registration_id.in.(${inList}),blue_registration_id.in.(${inList})`)
      .in('status', ACTIVE_MATCH_STATUSES)
      .order('scheduled_at', { ascending: true });

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const opponentRegIds = new Set<string>();
    // First pass: pick each global person's earliest match (rows are asc).
    interface Pending {
      focusRegId: string;
      opponentRegId: string | null;
      label: string;
      scheduledAt: string | null;
      poolName: string | null;
      liceName: string | null;
    }
    const pending = new Map<string, Pending>();
    for (const m of rows) {
      const phase = one(m['phases']);
      if (phase?.['visibility_status'] !== 'published') continue;
      const redReg = (m['red_registration_id'] as string | null) ?? null;
      const blueReg = (m['blue_registration_id'] as string | null) ?? null;
      const myReg = redReg && regToGlobal.has(redReg) ? redReg : blueReg;
      if (!myReg || !regToGlobal.has(myReg)) continue;
      const gp = regToGlobal.get(myReg)!;
      if (pending.has(gp)) continue; // earliest already captured
      const opponentRegId = myReg === redReg ? blueReg : redReg;
      if (opponentRegId) opponentRegIds.add(opponentRegId);
      pending.set(gp, {
        focusRegId: myReg,
        opponentRegId,
        label: (m['match_number_label'] as string | null) ?? '',
        scheduledAt: (m['scheduled_at'] as string | null) ?? null,
        poolName: (one(m['pools'])?.['name'] as string | undefined) ?? null,
        liceName: (one(m['lices'])?.['name'] as string | undefined) ?? null,
      });
    }

    const opponentNames = await this.resolveRegistrationNames([...opponentRegIds]);
    for (const [gp, p] of pending) {
      result.set(gp, {
        focusRegId: p.focusRegId,
        match: {
          label: p.label,
          scheduledAt: p.scheduledAt,
          opponentName: p.opponentRegId ? (opponentNames.get(p.opponentRegId) ?? null) : null,
          poolName: p.poolName,
          liceName: p.liceName,
        },
      });
    }
    return result;
  }

  /** Batched registration_id → "Given Family" (falls back to global display name). */
  private async resolveRegistrationNames(regIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(regIds)];
    if (unique.length === 0) return new Map();
    const { data } = await this.supabase.service
      .from('registrations')
      .select('id, persons ( given_name, family_name, global_persons ( display_name ) )')
      .in('id', unique);
    const map = new Map<string, string>();
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const person = one(r['persons']);
      if (!person) continue;
      const given = ((person['given_name'] as string | null) ?? '').trim();
      const family = ((person['family_name'] as string | null) ?? '').trim();
      const gp = one(person['global_persons']);
      const name = `${given} ${family}`.trim() || ((gp?.['display_name'] as string) ?? '').trim();
      if (name) map.set(r['id'] as string, name);
    }
    return map;
  }

  private async fetchTournaments(
    tournamentIds: string[],
  ): Promise<Map<string, { id: string; name: string; slug: string }>> {
    const map = new Map<string, { id: string; name: string; slug: string }>();
    if (tournamentIds.length === 0) return map;
    const { data } = await this.supabase.service
      .from('tournaments')
      .select('id, name, slug')
      .in('id', tournamentIds);
    for (const t of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(t['id'] as string, {
        id: t['id'] as string,
        name: (t['name'] as string) ?? '',
        slug: (t['slug'] as string) ?? '',
      });
    }
    return map;
  }

  private async fetchPoolNames(regIds: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (regIds.length === 0) return map;
    const { data } = await this.supabase.service
      .from('pool_members')
      .select('registration_id, pools ( name )')
      .in('registration_id', regIds);
    for (const m of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(
        m['registration_id'] as string,
        (one(m['pools'])?.['name'] as string | undefined) ?? null,
      );
    }
    return map;
  }

  /** registration_id → live pool-standing rank, one standings call per tournament. */
  private async fetchRanks(tournamentIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    await Promise.all(
      tournamentIds.map(async (tId) => {
        try {
          const standings = await this.poolStandings.getPoolStandings(tId, 'overall');
          const rows = 'rows' in standings ? standings.rows : [];
          for (const row of rows) map.set(row.registrationId, row.rank);
        } catch (err) {
          // No pool phase / unregistered ruleset / etc. — rank stays null.
          this.logger.debug(
            `rank lookup skipped for tournament ${tId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }),
    );
    return map;
  }
}
