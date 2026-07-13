import { Injectable, Logger } from '@nestjs/common';
import { computeFinalRanking, type PoolEntry, type RankingSlot } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { PoolStandingsService, type StandingsRow } from '../pool-standings/pool-standings.service';
import { PhasesService } from '../phases/phases.service';
import { FollowsService } from '../follows/follows.service';

/** A live or upcoming commitment on a People-hub fighter card — a bout they're
 *  fighting or (kind === 'referee') a match they're officiating. */
export interface PersonContextMatch {
  kind: 'fight' | 'referee';
  matchId: string;
  label: string;
  /** Server match status ('scheduled' | 'running' | 'paused' | …). */
  status: string;
  scheduledAt: string | null;
  opponentName: string | null;
  poolName: string | null;
  liceName: string | null;
  /** Public event slug, for a deep link to the match page. */
  eventSlug: string | null;
  /** Referee-only: officiating skill name + colour, and the event name (used for
   *  the eyebrow when the followee is only refereeing, with no registration). */
  skillName: string | null;
  skillColor: string | null;
  eventName: string | null;
}

/** A fighter's tournament placement once the tournament is decided. */
export interface PersonContextFinalRank {
  place: number;
  resultKind: string;
  totalRanked: number;
}

/** The most recent completed result for an idle followee (no active event). */
export interface PersonContextLastResult {
  eventName: string;
  eventSlug: string;
  tournamentName: string;
  tournamentSlug: string;
  weapon: string | null;
  finalRank: PersonContextFinalRank | null;
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
  /** Parent event of the focus tournament (shown above the tournament name). */
  event: { id: string; name: string; slug: string } | null;
  tournament: { id: string; name: string; slug: string; weapon: string | null } | null;
  poolName: string | null;
  /** Live pool-standing rank in the focus tournament (null if not ranked yet). */
  rank: number | null;
  /** Full-tournament placement — null until the bracket Final is decided. */
  finalRank: PersonContextFinalRank | null;
  /** For idle followees (no active event): their most recent completed result. */
  lastResult: PersonContextLastResult | null;
  /** In-progress bout, or the live match they're refereeing (fight takes priority). */
  currentMatch: PersonContextMatch | null;
  nextMatch: PersonContextMatch | null;
}

/** Focus tournament with its parent event, as returned by fetchTournaments. */
interface FocusTournament {
  id: string;
  name: string;
  slug: string;
  weapon: string | null;
  event: { id: string; name: string; slug: string } | null;
}

const TERMINAL_EVENT_STATUSES = ['completed', 'archived'];
const ACTIVE_MATCH_STATUSES = ['scheduled', 'running', 'paused'];
const LIVE_MATCH_STATUSES = ['running', 'paused'];

function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

/**
 * Enriches a set of global persons with their live tournament context —
 * current/next tournament, pool, license, live + next match, live refereeing,
 * and pool-standing + final rank — plus the viewer's follow state. Reuses the
 * registrations/pools/matches shapes from PublicScheduleService, rank from
 * PoolStandingsService, and the shared computeFinalRanking (bracket + standings)
 * from FightersService.computeOnePlacement, batched so the cost is bounded by
 * the number of distinct tournaments, not the number of people. Powers both the
 * Search tab (on-demand) and the Following tab.
 */
@Injectable()
export class PeopleContextService {
  private readonly logger = new Logger(PeopleContextService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly poolStandings: PoolStandingsService,
    private readonly phases: PhasesService,
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
        event: null,
        tournament: null,
        poolName: null,
        rank: null,
        finalRank: null,
        lastResult: null,
        currentMatch: null,
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

    // 2b. Live refereeing — resolved before the registration-based early returns,
    //     since a followed person may only be officiating (no registration). A
    //     live fight, if any, overrides this in the compose step below.
    const refereeNowByGlobal = await this.fetchRefereeNow(ids);
    for (const [gp, refMatch] of refereeNowByGlobal) {
      const ctx = base.get(gp);
      if (ctx) ctx.currentMatch = refMatch;
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

    // 4-7. Active-tournament enrichment (skipped when nobody has an active event).
    if (activePersonIds.length > 0) {
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

      if (regIds.length > 0) {
        // 5. Live + next (scheduled) fights for those registrations. Ascending by
        //    time, so the first scheduled match seen per global person is their next
        //    one; any running/paused match is their current bout.
        const fightsByGlobal = await this.fetchFights(regIds, regToGlobal);

        // Focus registration per global person: the current bout's registration, else
        // the next match's, else — when they have no live/upcoming match — their first
        // active registration, so the card still shows the tournament they're entered in.
        const focusRegByGlobal = new Map<string, string>();
        for (const [gp, regList] of globalToRegIds) {
          const fights = fightsByGlobal.get(gp);
          const fromMatch = fights?.current?.focusRegId ?? fights?.next?.focusRegId;
          focusRegByGlobal.set(gp, fromMatch ?? regList[0]!);
        }

        const focusRegIds = [...focusRegByGlobal.values()];
        const focusTournamentIds = [
          ...new Set(focusRegIds.map((rid) => regToTournament.get(rid)!).filter(Boolean)),
        ];

        // 6. Tournament (+ event) names, pool names, and pool + final ranks (batched).
        const [tournamentById, poolByReg, rankingByReg] = await Promise.all([
          this.fetchTournaments(focusTournamentIds),
          this.fetchPoolNames(focusRegIds),
          this.fetchRankings(focusTournamentIds),
        ]);

        // 7. Compose.
        for (const [gp, ctx] of base) {
          const focusReg = focusRegByGlobal.get(gp);
          if (focusReg) {
            const tId = regToTournament.get(focusReg);
            const trec = tId ? tournamentById.get(tId) : undefined;
            ctx.tournament = trec
              ? { id: trec.id, name: trec.name, slug: trec.slug, weapon: trec.weapon }
              : null;
            ctx.event = trec?.event ?? null;
            ctx.poolName = poolByReg.get(focusReg) ?? null;
            const ranking = rankingByReg.get(focusReg);
            ctx.rank = ranking?.poolRank ?? null;
            ctx.finalRank = ranking?.finalRank ?? null;
          }
          const fights = fightsByGlobal.get(gp);
          const eventSlug = ctx.event?.slug ?? null;
          if (fights?.next) ctx.nextMatch = { ...fights.next.match, eventSlug };
          // A live bout takes visual precedence over live refereeing.
          if (fights?.current) ctx.currentMatch = { ...fights.current.match, eventSlug };
        }
      }
    }

    // 8. Idle fallback: people with no active tournament and no live activity get
    //    their most recent completed result, so the card is never a dead end.
    const idleIds = [...base.entries()]
      .filter(([, ctx]) => !ctx.tournament && !ctx.currentMatch)
      .map(([gp]) => gp);
    const lastResults = await this.fetchLastResults(idleIds);
    for (const [gp, lr] of lastResults) {
      const ctx = base.get(gp);
      if (ctx) ctx.lastResult = lr;
    }

    return [...base.values()];
  }

  /** Current (running/paused) bout + earliest upcoming (scheduled) match per global
   *  person, each tagged with the registration it's tied to. */
  private async fetchFights(
    regIds: string[],
    regToGlobal: Map<string, string>,
  ): Promise<
    Map<
      string,
      {
        current: { match: PersonContextMatch; focusRegId: string } | null;
        next: { match: PersonContextMatch; focusRegId: string } | null;
      }
    >
  > {
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
    interface Pending {
      focusRegId: string;
      opponentRegId: string | null;
      matchId: string;
      label: string;
      status: string;
      scheduledAt: string | null;
      poolName: string | null;
      liceName: string | null;
    }
    const currentByGp = new Map<string, Pending>();
    const nextByGp = new Map<string, Pending>();
    const opponentRegIds = new Set<string>();

    for (const m of rows) {
      const phase = one(m['phases']);
      if (phase?.['visibility_status'] !== 'published') continue;
      const redReg = (m['red_registration_id'] as string | null) ?? null;
      const blueReg = (m['blue_registration_id'] as string | null) ?? null;
      const myReg = redReg && regToGlobal.has(redReg) ? redReg : blueReg;
      if (!myReg || !regToGlobal.has(myReg)) continue;
      const gp = regToGlobal.get(myReg)!;
      const status = String(m['status'] ?? '');
      const isLive = LIVE_MATCH_STATUSES.includes(status);
      // Live goes to `current`, scheduled to `next`; keep the first of each (asc).
      const bucket = isLive ? currentByGp : nextByGp;
      if (bucket.has(gp)) continue;
      const opponentRegId = myReg === redReg ? blueReg : redReg;
      if (opponentRegId) opponentRegIds.add(opponentRegId);
      bucket.set(gp, {
        focusRegId: myReg,
        opponentRegId,
        matchId: (m['id'] as string) ?? '',
        label: (m['match_number_label'] as string | null) ?? '',
        status,
        scheduledAt: (m['scheduled_at'] as string | null) ?? null,
        poolName: (one(m['pools'])?.['name'] as string | undefined) ?? null,
        liceName: (one(m['lices'])?.['name'] as string | undefined) ?? null,
      });
    }

    const opponentNames = await this.resolveRegistrationNames([...opponentRegIds]);
    const toMatch = (p: Pending): PersonContextMatch => ({
      kind: 'fight',
      matchId: p.matchId,
      label: p.label,
      status: p.status,
      scheduledAt: p.scheduledAt,
      opponentName: p.opponentRegId ? (opponentNames.get(p.opponentRegId) ?? null) : null,
      poolName: p.poolName,
      liceName: p.liceName,
      eventSlug: null,
      skillName: null,
      skillColor: null,
      eventName: null,
    });

    const result = new Map<
      string,
      {
        current: { match: PersonContextMatch; focusRegId: string } | null;
        next: { match: PersonContextMatch; focusRegId: string } | null;
      }
    >();
    const gps = new Set<string>([...currentByGp.keys(), ...nextByGp.keys()]);
    for (const gp of gps) {
      const cur = currentByGp.get(gp);
      const nxt = nextByGp.get(gp);
      result.set(gp, {
        current: cur ? { match: toMatch(cur), focusRegId: cur.focusRegId } : null,
        next: nxt ? { match: toMatch(nxt), focusRegId: nxt.focusRegId } : null,
      });
    }
    return result;
  }

  /** The live (running/paused) match each global person is refereeing, if any. */
  private async fetchRefereeNow(globalIds: string[]): Promise<Map<string, PersonContextMatch>> {
    const result = new Map<string, PersonContextMatch>();
    if (globalIds.length === 0) return result;
    const { data } = await this.supabase.service
      .from('referee_assignments')
      .select(
        `person_id, role,
         matches (
           id, status, scheduled_at, match_number_label,
           lices ( name ), pools ( name ),
           phases ( visibility_status, tournaments ( slug, events ( slug, name ) ) )
         )`,
      )
      .in('person_id', globalIds)
      .eq('scope_type', 'match')
      .not('match_id', 'is', null);

    interface Pending {
      role: string | null;
      matchId: string;
      label: string;
      status: string;
      scheduledAt: string | null;
      poolName: string | null;
      liceName: string | null;
      eventSlug: string | null;
      eventName: string | null;
    }
    const pendingByGp = new Map<string, Pending>();
    const roleIds = new Set<string>();
    for (const a of (data ?? []) as Array<Record<string, unknown>>) {
      const gp = a['person_id'] as string;
      if (pendingByGp.has(gp)) continue; // one live referee slot per person
      const match = one(a['matches']);
      if (!match) continue;
      const status = String(match['status'] ?? '');
      if (!LIVE_MATCH_STATUSES.includes(status)) continue;
      const phase = one(match['phases']);
      if (phase?.['visibility_status'] !== 'published') continue;
      const tournament = phase ? one(phase['tournaments']) : null;
      const event = tournament ? one(tournament['events']) : null;
      const role = (a['role'] as string | null) ?? null;
      if (role) roleIds.add(role);
      pendingByGp.set(gp, {
        role,
        matchId: (match['id'] as string) ?? '',
        label: (match['match_number_label'] as string | null) ?? '',
        status,
        scheduledAt: (match['scheduled_at'] as string | null) ?? null,
        poolName: (one(match['pools'])?.['name'] as string | undefined) ?? null,
        liceName: (one(match['lices'])?.['name'] as string | undefined) ?? null,
        eventSlug: (event?.['slug'] as string | undefined) ?? null,
        eventName: (event?.['name'] as string | undefined) ?? null,
      });
    }

    const skillByRole = await this.fetchRefereeSkills([...roleIds]);
    for (const [gp, p] of pendingByGp) {
      const sk = p.role ? skillByRole.get(p.role) : undefined;
      result.set(gp, {
        kind: 'referee',
        matchId: p.matchId,
        label: p.label,
        status: p.status,
        scheduledAt: p.scheduledAt,
        opponentName: null,
        poolName: p.poolName,
        liceName: p.liceName,
        eventSlug: p.eventSlug,
        skillName: sk?.name ?? null,
        skillColor: sk?.color ?? null,
        eventName: p.eventName,
      });
    }
    return result;
  }

  /** Referee skill id (referee_assignments.role) → name + colour. */
  private async fetchRefereeSkills(
    roleIds: string[],
  ): Promise<Map<string, { name: string; color: string }>> {
    const map = new Map<string, { name: string; color: string }>();
    if (roleIds.length === 0) return map;
    const { data } = await this.supabase.service
      .from('referee_skills')
      .select('id, name, color')
      .in('id', roleIds);
    for (const s of (data ?? []) as Array<Record<string, unknown>>) {
      map.set(s['id'] as string, {
        name: String(s['name'] ?? ''),
        color: String(s['color'] ?? ''),
      });
    }
    return map;
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

  private async fetchTournaments(tournamentIds: string[]): Promise<Map<string, FocusTournament>> {
    const map = new Map<string, FocusTournament>();
    if (tournamentIds.length === 0) return map;
    const { data } = await this.supabase.service
      .from('tournaments')
      .select('id, name, slug, weapon, events ( id, name, slug )')
      .in('id', tournamentIds);
    for (const t of (data ?? []) as Array<Record<string, unknown>>) {
      const ev = one(t['events']);
      map.set(t['id'] as string, {
        id: t['id'] as string,
        name: (t['name'] as string) ?? '',
        slug: (t['slug'] as string) ?? '',
        weapon: (t['weapon'] as string | null) ?? null,
        event: ev
          ? {
              id: ev['id'] as string,
              name: (ev['name'] as string) ?? '',
              slug: (ev['slug'] as string) ?? '',
            }
          : null,
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

  /**
   * registration_id → live pool rank + final placement, one standings + bracket
   * pass per tournament. Final rank reuses the shared computeFinalRanking (bracket
   * slots + overall pool score), mirroring FightersService.computeOnePlacement; it
   * stays null until the bracket Final is decided.
   */
  private async fetchRankings(
    tournamentIds: string[],
  ): Promise<Map<string, { poolRank: number | null; finalRank: PersonContextFinalRank | null }>> {
    const map = new Map<
      string,
      { poolRank: number | null; finalRank: PersonContextFinalRank | null }
    >();
    await Promise.all(
      tournamentIds.map(async (tId) => {
        let rows: StandingsRow[] = [];
        try {
          const standings = await this.poolStandings.getPoolStandings(tId, 'overall');
          rows = 'rows' in standings ? standings.rows : [];
        } catch (err) {
          // No pool phase / unregistered ruleset / etc. — rank stays null.
          this.logger.debug(
            `rank lookup skipped for tournament ${tId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return;
        }
        for (const row of rows)
          map.set(row.registrationId, { poolRank: row.rank, finalRank: null });

        // Final placement (best-effort). computeFinalRanking returns [] until the
        // Final is decided, so finalRank stays null during the pool/bracket phases.
        try {
          const poolEntries: PoolEntry[] = rows.map((row) => {
            const rawScore = row.stats?.['score'];
            const score = typeof rawScore === 'number' ? rawScore : Number(rawScore);
            return {
              registrationId: row.registrationId,
              fighterName: row.displayName,
              clubAbbrev: row.club?.abbreviation ?? row.club?.name ?? null,
              poolScore: Number.isFinite(score) ? score : null,
            };
          });
          const bracket = await this.phases.getTournamentBracket(tId);
          if (bracket?.slots?.length) {
            const slots: RankingSlot[] = bracket.slots.map((slot) => ({
              id: slot.id,
              round: slot.round,
              position: slot.position,
              status: slot.status,
              redRegistrationId: slot.redRegistrationId ?? null,
              blueRegistrationId: slot.blueRegistrationId ?? null,
              redFighterName: slot.redFighterName ?? null,
              blueFighterName: slot.blueFighterName ?? null,
              redClubAbbrev: slot.redClubAbbrev ?? null,
              blueClubAbbrev: slot.blueClubAbbrev ?? null,
              redScore: slot.redScore ?? null,
              blueScore: slot.blueScore ?? null,
            }));
            // 2-arg call (no explicit bronzeSlotId) to match the public FinalRankingTab.
            const ranking = computeFinalRanking(slots, poolEntries);
            for (const entry of ranking) {
              const existing = map.get(entry.registrationId) ?? { poolRank: null, finalRank: null };
              existing.finalRank = {
                place: entry.place,
                resultKind: entry.resultKind,
                totalRanked: ranking.length,
              };
              map.set(entry.registrationId, existing);
            }
          }
        } catch (err) {
          this.logger.debug(
            `final-rank lookup skipped for tournament ${tId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }),
    );
    return map;
  }

  /**
   * For idle followees (no active event), their most recent completed result:
   * the latest-starting completed tournament they competed in, with its final
   * placement (or overall pool rank for pool-only tournaments). Reuses
   * fetchRankings, so cost is bounded by the number of distinct tournaments.
   */
  private async fetchLastResults(
    globalIds: string[],
  ): Promise<Map<string, PersonContextLastResult>> {
    const result = new Map<string, PersonContextLastResult>();
    if (globalIds.length === 0) return result;

    const { data } = await this.supabase.service
      .from('registrations')
      .select(
        `id, status,
         persons!inner ( global_person_id ),
         tournaments!inner (
           id, name, slug, weapon, status,
           events!inner ( name, slug, start_date, is_test_event )
         )`,
      )
      .in('persons.global_person_id', globalIds)
      .eq('tournaments.status', 'completed')
      .neq('status', 'withdrawn');

    interface Candidate {
      registrationId: string;
      tournamentId: string;
      tournamentName: string;
      tournamentSlug: string;
      weapon: string | null;
      eventName: string;
      eventSlug: string;
      startDate: string;
    }
    // Keep the latest-starting completed tournament per global person.
    const bestByGlobal = new Map<string, Candidate>();
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const person = one(r['persons']);
      const gp = person?.['global_person_id'] as string | undefined;
      if (!gp) continue;
      const t = one(r['tournaments']);
      if (!t) continue;
      const ev = one(t['events']);
      if (!ev || ev['is_test_event'] === true) continue;
      const startDate = (ev['start_date'] as string | null) ?? '';
      const cand: Candidate = {
        registrationId: r['id'] as string,
        tournamentId: t['id'] as string,
        tournamentName: (t['name'] as string) ?? '',
        tournamentSlug: (t['slug'] as string) ?? '',
        weapon: (t['weapon'] as string | null) ?? null,
        eventName: (ev['name'] as string) ?? '',
        eventSlug: (ev['slug'] as string) ?? '',
        startDate,
      };
      const existing = bestByGlobal.get(gp);
      if (!existing || startDate > existing.startDate) bestByGlobal.set(gp, cand);
    }
    if (bestByGlobal.size === 0) return result;

    const tournamentIds = [...new Set([...bestByGlobal.values()].map((c) => c.tournamentId))];
    const rankings = await this.fetchRankings(tournamentIds);
    for (const [gp, c] of bestByGlobal) {
      const ranking = rankings.get(c.registrationId);
      // Prefer the decided final placement; fall back to overall pool rank.
      const finalRank: PersonContextFinalRank | null =
        ranking?.finalRank ??
        (ranking?.poolRank != null
          ? { place: ranking.poolRank, resultKind: 'pool', totalRanked: 0 }
          : null);
      result.set(gp, {
        eventName: c.eventName,
        eventSlug: c.eventSlug,
        tournamentName: c.tournamentName,
        tournamentSlug: c.tournamentSlug,
        weapon: c.weapon,
        finalRank,
      });
    }
    return result;
  }
}
