/**
 * public-schedule.service.ts — T-608
 *
 * Returns any Person's schedule with privacy filters applied.
 * Shared between:
 *   - GET /events/:eventId/people/:personId/schedule (public)
 *   - GET /my-schedule (T-805, authenticated)
 *
 * AC:
 *   - matches + referee_slots always included
 *   - workshops included unless hide_workshops_publicly=true AND not own person
 *   - email never returned
 *   - 100ms p95 target (relies on DB indexes on person_id + event_id)
 */

import { Injectable } from '@nestjs/common';
import { DEFAULT_EVENT_TIMEZONE } from '@myclash/time';
import { SupabaseService } from '../supabase/supabase.service';
import { PrivacyService } from './privacy.service';
import { computeMatchKind, fetchBracketRounds, fetchSwissRounds } from './match-kind.util';
import { sideColorsFromScoringConfig, type SideColors } from '../events/side-colors';
import { deriveMatchOutcome } from '../fighters/recent-matches';

export interface ScheduleMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  opponentName: string | null;
  opponentClub: string | null;
  redScore: number;
  blueScore: number;
  /** Result from THIS person's perspective, or null while unfinished. Derived
   *  server-side from `winner_registration_id` because the client knows only
   *  which side it is on, and the recorded winner is authoritative over the
   *  scores — see `deriveMatchOutcome`. */
  outcome: 'win' | 'loss' | 'draw' | null;
  isRed: boolean;
  /**
   * The tournament's configured fighter-side colour tokens. Carried per match
   * because a person's schedule can span tournaments with different palettes.
   * The client resolves tokens to hex via `sideStyle`.
   */
  sideColors: SideColors;
  poolName: string | null;
  tournamentName: string | null;
  /** Tournament (competition) id — pairs with `phase` to key the scheduled
   *  programme block, so the schedule can show the block end instead of the
   *  last match's start. Null when the phase/tournament can't be resolved. */
  tournamentId: string | null;
  /** Coarse programme phase for block lookup — the PROGRAMME taxonomy, which
   *  gained `swiss` as a 4th token in 0164. The key is
   *  `${tournamentId}:${phase}`, so collapsing swiss onto 'bracket' pointed a
   *  Swiss bout at the Bracket block's end time, or at no block at all.
   *  Mirrors the generated `— Pools` / `— Swiss` / `— Bracket` blocks. */
  phase: 'pool' | 'swiss' | 'bracket' | null;
  liceName: string | null;
}

export interface RefereeSlot {
  /** referee_assignments.id — stable render key. `matchId` is '' for every
   *  pool-/lice-scoped row, so it cannot serve as one. */
  id: string;
  matchId: string;
  matchNumberLabel: string;
  scheduledAt: string | null;
  /** The assignment's own window — set for pool-/lice-scoped rows that carry no
   *  match, so the schedule can place them on a day even without a match time. */
  startsAt: string | null;
  endsAt: string | null;
  role: string;
  poolName: string | null;
  poolId: string | null;
  tournamentName: string | null;
  tournamentSlug: string | null;
  liceName: string | null;
  /** 'pool' | 'play_in' | 'final' | 'semi_final' | 'quarter_final' | 'round_of' | 'swiss' | null */
  matchKind: string | null;
  /** fighter count for matchKind === 'round_of' (e.g. 16) */
  roundOfCount: number | null;
  /** Which Swiss round, for matchKind === 'swiss'. Null otherwise. Without it
   *  every Swiss duty of a tournament collapses into one card. */
  swissRound: number | null;
  /** Bracket slot id for bracket matches (null for pool/swiss). */
  bracketSlotId: string | null;
  skillName: string | null;
  skillColor: string | null;
  /** For a pool-/lice-scoped assignment (a whole-pool role like "Déclarant"),
   *  the number of matches in the pool the person covers — so the card shows the
   *  real bout count rather than "1". Null for per-match assignments. */
  poolMatchCount: number | null;
}

export interface WorkshopEnrollment {
  /** workshop_sessions.id (the enrolled session), NOT the parent workshop id. */
  workshopId: string;
  /** Parent workshop slug — deep-links to the workshop in the Workshops tab. */
  workshopSlug: string | null;
  workshopName: string;
  sessionStart: string | null;
  sessionEnd: string | null;
  location: string | null;
}

export interface PersonSchedule {
  personId: string;
  /**
   * The event's IANA zone. Every instant below is UTC, and the client groups
   * them into days — which is only correct on the event's clock. Without this
   * the client fell back to the UTC day, so a fighter at an event west of UTC
   * saw an afternoon bout filed under tomorrow.
   */
  timezone: string;
  matches: ScheduleMatch[];
  refereeSlots: RefereeSlot[];
  workshops: WorkshopEnrollment[] | null; // null = hidden by privacy
}

@Injectable()
export class PublicScheduleService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly privacy: PrivacyService,
  ) {}

  async getSchedule(
    eventId: string,
    personId: string,
    requesterPersonId: string | null,
  ): Promise<PersonSchedule> {
    const [matches, refereeSlots, showWorkshops, timezone] = await Promise.all([
      this.fetchMatches(eventId, personId),
      this.fetchRefereeSlots(eventId, personId),
      this.privacy.canSeeWorkshops(personId, requesterPersonId),
      this.fetchTimezone(eventId),
    ]);

    const workshops = showWorkshops ? await this.fetchWorkshops(eventId, personId) : null;

    return { personId, timezone, matches, refereeSlots, workshops };
  }

  /**
   * `events.timezone` is `NOT NULL DEFAULT 'Europe/Paris'` (migration 0102), so
   * the fallback only fires when the row is unreadable — in which case a wrong
   * day heading is a better failure than an empty schedule.
   */
  private async fetchTimezone(eventId: string): Promise<string> {
    const { data } = await this.supabase.service
      .from('events')
      .select('timezone')
      .eq('id', eventId)
      .maybeSingle();
    return (data as { timezone?: string | null } | null)?.timezone ?? DEFAULT_EVENT_TIMEZONE;
  }

  // ── Private fetchers ─────────────────────────────────────────────────────────

  private async fetchMatches(eventId: string, personId: string): Promise<ScheduleMatch[]> {
    // Find registrations for this person in this event's tournaments
    const { data: regs } = await this.supabase.service
      .from('registrations')
      .select('id, tournament_id')
      .eq('person_id', personId);

    if (!regs || regs.length === 0) return [];

    const regIds = (regs as Array<{ id: string }>).map((r) => r.id);

    const { data: matches } = await this.supabase.service
      .from('matches')
      .select(
        `
        id, match_number_label, status, scheduled_at,
        red_score, blue_score, winner_registration_id, end_reason,
        red_registration_id, blue_registration_id,
        pools ( name ),
        lices ( name ),
        phases ( visibility_status, type, tournaments ( id, name, scoring_config_json ) )
      `,
      )
      .or(
        `red_registration_id.in.(${regIds.join(',')}),blue_registration_id.in.(${regIds.join(',')})`,
      )
      .order('scheduled_at', { ascending: true });

    if (!matches) return [];

    const mapped = (matches as Array<Record<string, unknown>>).flatMap((m) => {
      const redReg = (m['red_registration_id'] as string | null) ?? null;
      const blueReg = (m['blue_registration_id'] as string | null) ?? null;
      const isRed = redReg !== null && regIds.includes(redReg);
      const pool = m['pools'] as { name: string } | null;
      const lice = m['lices'] as { name: string } | null;
      const phase = m['phases'] as {
        visibility_status?: string | null;
        type?: string | null;
        tournaments: { id: string; name: string; scoring_config_json?: unknown } | null;
      } | null;
      if (phase?.visibility_status !== 'published') return [];

      const phaseType = phase?.type ?? null;

      return [
        {
          id: m['id'] as string,
          matchNumberLabel: (m['match_number_label'] as string | null) ?? '',
          status: m['status'] as string,
          scheduledAt: (m['scheduled_at'] as string | null) ?? null,
          opponentRegId: isRed ? blueReg : redReg,
          redScore: (m['red_score'] as number) ?? 0,
          blueScore: (m['blue_score'] as number) ?? 0,
          // Decided HERE, not by the page. The client only knows which side it
          // is on; the server knows the registration ids, and the recorded
          // winner is authoritative over the scores — a forfeit or a
          // referee_decision override can award the bout to the fighter behind
          // on points. The page compared the two numbers, so it showed a loss
          // for every such win and, having no third branch, for every draw too.
          outcome:
            (m['status'] as string) === 'completed'
              ? deriveMatchOutcome(
                  {
                    winnerRegistrationId: (m['winner_registration_id'] as string | null) ?? null,
                    redRegistrationId: redReg,
                    blueRegistrationId: blueReg,
                    redScore: (m['red_score'] as number) ?? 0,
                    blueScore: (m['blue_score'] as number) ?? 0,
                    endReason: (m['end_reason'] as string | null) ?? null,
                  },
                  isRed ? 'red' : 'blue',
                )
              : null,
          isRed,
          poolName: pool?.name ?? null,
          tournamentName: phase?.tournaments?.name ?? null,
          tournamentId: phase?.tournaments?.id ?? null,
          // Per-ITEM, not per-response: one person's schedule spans tournaments,
          // and each configures its own side colours.
          sideColors: sideColorsFromScoringConfig(phase?.tournaments?.scoring_config_json),
          phase: (phaseType === 'pool'
            ? 'pool'
            : phaseType === 'swiss'
              ? 'swiss'
              : phaseType
                ? 'bracket'
                : null) as 'pool' | 'swiss' | 'bracket' | null,
          liceName: lice?.name ?? null,
        },
      ];
    });

    // Resolve opponent display names in one batched lookup (the side the
    // viewer is NOT registered on). Finishes the T-608 follow-up.
    const opponentNames = await this.resolveRegistrationNames(
      mapped.map((x) => x.opponentRegId).filter((id): id is string => Boolean(id)),
    );

    return mapped.map(({ opponentRegId, ...rest }) => ({
      ...rest,
      opponentName: opponentRegId ? (opponentNames.get(opponentRegId) ?? null) : null,
      opponentClub: null,
    }));
  }

  /** Batched registration_id → "Given Family" (falls back to global display name). */
  private async resolveRegistrationNames(regIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(regIds)];
    if (unique.length === 0) return new Map();
    const { data } = await this.supabase.service
      .from('registrations')
      .select('id, persons ( given_name, family_name, global_persons ( display_name ) )')
      .in('id', unique);
    const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    const map = new Map<string, string>();
    for (const r of rows) {
      const personRaw = r['persons'];
      const person = (Array.isArray(personRaw) ? personRaw[0] : personRaw) as Record<
        string,
        unknown
      > | null;
      if (!person) continue;
      const given = ((person['given_name'] as string | null) ?? '').trim();
      const family = ((person['family_name'] as string | null) ?? '').trim();
      const gpRaw = person['global_persons'];
      const gp = (Array.isArray(gpRaw) ? gpRaw[0] : gpRaw) as { display_name?: string } | null;
      const name = `${given} ${family}`.trim() || (gp?.display_name ?? '').trim();
      if (name) map.set(String(r['id']), name);
    }
    return map;
  }

  private async fetchRefereeSlots(eventId: string, personId: string): Promise<RefereeSlot[]> {
    // Post-0063: referee_assignments keys on global_persons.id, but this
    // controller takes the event-scoped persons.id. Resolve via
    // persons.global_person_id; absent link → no referee slots.
    const { data: personLink } = await this.supabase.service
      .from('persons')
      .select('global_person_id')
      .eq('id', personId)
      .maybeSingle();
    const globalPersonId =
      (personLink as { global_person_id: string | null } | null)?.global_person_id ?? null;
    if (!globalPersonId) return [];

    // Embed the match (match-scoped rows) AND the assignment's own pool/lice
    // (pool-/lice-scoped rows that carry no match — e.g. a pool "Déclarant").
    const { data } = await this.supabase.service
      .from('referee_assignments')
      .select(
        `
        id, role, starts_at, ends_at, pool_id,
        pools ( id, name, phases ( type, config_json, visibility_status, tournaments ( name, slug ) ) ),
        lices ( name ),
        matches (
          id, match_number_label, scheduled_at, bracket_slot_id,
          pools ( id, name ),
          lices ( name ),
          phases ( visibility_status, type, config_json, tournaments ( name, slug ) )
        )
      `,
      )
      .eq('person_id', globalPersonId)
      .eq('event_id', eventId)
      // Base order for the pool-/lice-scoped rows; match-scoped rows are
      // re-sorted below on their match time, which SQL can't reach from here.
      .order('starts_at', { ascending: true, nullsFirst: false });

    if (!data) return [];

    type PhaseEmbed = {
      visibility_status?: string | null;
      type?: string | null;
      config_json?: { bracketSize?: number } | null;
      tournaments: { name?: string; slug?: string } | null;
    } | null;

    // Carry phaseType/bracketSize alongside each slot for the match-kind derivation
    // below; they're stripped from the returned RefereeSlot.
    type RawSlot = RefereeSlot & { phaseType: string | null; bracketSize: number | null };
    const raw: RawSlot[] = (data as Array<Record<string, unknown>>).flatMap((a) => {
      const match = a['matches'] as Record<string, unknown> | null;
      const matchPool = match?.['pools'] as { id?: string; name?: string } | null;
      const matchLice = match?.['lices'] as { name?: string } | null;
      const matchPhase = match?.['phases'] as PhaseEmbed;
      // Direct assignment-scoped embeds (only set when scope_type is pool/lice).
      const directPool = a['pools'] as { id?: string; name?: string; phases?: PhaseEmbed } | null;
      const directLice = a['lices'] as { name?: string } | null;
      const poolPhase = (directPool?.phases as PhaseEmbed) ?? null;

      // Prefer the match, else fall back to the assignment's own pool/lice.
      const phase = matchPhase ?? poolPhase;
      const pool = matchPool ?? directPool ?? null;
      const lice = matchLice ?? directLice ?? null;

      // Hide rows whose phase isn't published yet (future bracket rounds). Pool
      // phases are published for a live event, so pool "Déclarant" rows pass.
      // Rows with no resolvable phase (rare) are kept rather than silently dropped.
      if (phase && phase.visibility_status !== 'published') return [];

      return {
        id: String(a['id'] ?? ''),
        matchId: (match?.['id'] as string) ?? '',
        matchNumberLabel: (match?.['match_number_label'] as string | null) ?? '',
        scheduledAt: (match?.['scheduled_at'] as string | null) ?? null,
        startsAt: (a['starts_at'] as string | null) ?? null,
        endsAt: (a['ends_at'] as string | null) ?? null,
        role: a['role'] as string,
        poolName: pool?.name ?? null,
        poolId: (pool?.id as string | undefined) ?? (a['pool_id'] as string | null) ?? null,
        tournamentName: phase?.tournaments?.name ?? null,
        tournamentSlug: phase?.tournaments?.slug ?? null,
        liceName: lice?.name ?? null,
        matchKind: null,
        roundOfCount: null,
        swissRound: null,
        bracketSlotId: (match?.['bracket_slot_id'] as string | null) ?? null,
        skillName: null,
        skillColor: null,
        poolMatchCount: null,
        phaseType: (phase?.type as string | null) ?? null,
        bracketSize: phase?.config_json?.bracketSize ?? null,
      };
    });

    // Match kind (pool / bracket round) — bracket round lives on bracket_slots.
    const slotIds = [...new Set(raw.map((s) => s.bracketSlotId).filter((x): x is string => !!x))];
    const roundBySlot = await fetchBracketRounds(this.supabase.service, slotIds);
    // Swiss round (match-scoped) — the number lives on swiss_rounds, so it
    // needs the same follow-up lookup the bracket round does.
    const swissRoundByMatch = await fetchSwissRounds(this.supabase.service, [
      ...new Set(raw.map((s) => s.matchId).filter((id): id is string => Boolean(id))),
    ]);
    for (const s of raw) {
      const round = s.bracketSlotId ? (roundBySlot.get(s.bracketSlotId) ?? null) : null;
      const { kind, roundOfCount, swissRound } = computeMatchKind(
        s.phaseType,
        round,
        s.bracketSize,
        s.matchId ? (swissRoundByMatch.get(s.matchId) ?? null) : null,
      );
      s.matchKind = kind;
      s.roundOfCount = roundOfCount;
      s.swissRound = swissRound;
    }

    // Pool-scoped assignments (no match) carry no direct lice and no match count.
    // From the pool's matches, borrow a representative lice (mirrors the /me
    // overview) and count the bouts the whole-pool role covers.
    const scopePools = [
      ...new Set(raw.filter((s) => !s.matchId && s.poolId).map((s) => s.poolId as string)),
    ];
    if (scopePools.length > 0) {
      const { data: pm } = await this.supabase.service
        .from('matches')
        .select('pool_id, lices ( name )')
        .in('pool_id', scopePools);
      const byPool = new Map<string, { liceName: string | null; count: number }>();
      for (const m of Array.isArray(pm) ? (pm as Array<Record<string, unknown>>) : []) {
        const pid = String(m['pool_id']);
        const lice = m['lices'] as { name?: string } | null;
        const entry = byPool.get(pid) ?? { liceName: null, count: 0 };
        entry.count += 1;
        if (!entry.liceName && lice?.name) entry.liceName = lice.name;
        byPool.set(pid, entry);
      }
      for (const s of raw) {
        if (!s.matchId && s.poolId) {
          const v = byPool.get(s.poolId);
          if (v) {
            if (!s.liceName) s.liceName = v.liceName;
            s.poolMatchCount = v.count;
          }
        }
      }
    }

    // Enrich with the referee skill name + colour (role holds referee_skills.id).
    const roleIds = [...new Set(raw.map((s) => s.role).filter((x): x is string => !!x))];
    if (roleIds.length > 0) {
      const { data: skills } = await this.supabase.service
        .from('referee_skills')
        .select('id, name, color')
        .in('id', roleIds);
      const byId = new Map<string, { name: string; color: string }>();
      for (const s of Array.isArray(skills) ? (skills as Array<Record<string, unknown>>) : []) {
        byId.set(String(s['id']), {
          name: String(s['name'] ?? ''),
          color: String(s['color'] ?? ''),
        });
      }
      for (const slot of raw) {
        const sk = byId.get(slot.role);
        if (sk) {
          slot.skillName = sk.name;
          slot.skillColor = sk.color;
        }
      }
    }

    // Chronological. The display time is the match's `scheduled_at` for a
    // match-scoped row and the assignment's own `starts_at` for a pool-/lice-
    // scoped one, so neither column alone can order the mixed list in SQL.
    // Same key as the schedule view uses (`scheduledAt ?? startsAt`); undated last.
    const startMs = (s: RawSlot): number => {
      const iso = s.scheduledAt ?? s.startsAt;
      return iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY;
    };
    raw.sort((a, b) => startMs(a) - startMs(b));

    return raw.map((s): RefereeSlot => ({
      id: s.id,
      matchId: s.matchId,
      matchNumberLabel: s.matchNumberLabel,
      scheduledAt: s.scheduledAt,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      role: s.role,
      poolName: s.poolName,
      poolId: s.poolId,
      tournamentName: s.tournamentName,
      tournamentSlug: s.tournamentSlug,
      liceName: s.liceName,
      matchKind: s.matchKind,
      roundOfCount: s.roundOfCount,
      swissRound: s.swissRound,
      bracketSlotId: s.bracketSlotId,
      skillName: s.skillName,
      skillColor: s.skillColor,
      poolMatchCount: s.poolMatchCount,
    }));
  }

  private async fetchWorkshops(_eventId: string, personId: string): Promise<WorkshopEnrollment[]> {
    // `user_id` is the event-scoped persons.id, so filtering by it already
    // scopes to this event — there is no `event_id` column on enrollments.
    const { data } = await this.supabase.service
      .from('workshop_enrollments')
      .select(
        `
        workshop_sessions (
          id, starts_at, ends_at, location_label,
          workshops ( title, slug )
        )
      `,
      )
      .eq('user_id', personId);

    if (!data) return [];

    return (data as Array<Record<string, unknown>>).map((e) => {
      const sessionRaw = e['workshop_sessions'];
      const session = (Array.isArray(sessionRaw) ? sessionRaw[0] : sessionRaw) as Record<
        string,
        unknown
      > | null;
      const workshopRaw = session?.['workshops'];
      const workshop = (Array.isArray(workshopRaw) ? workshopRaw[0] : workshopRaw) as {
        title?: string;
        slug?: string;
      } | null;

      return {
        workshopId: (session?.['id'] as string) ?? '',
        workshopSlug: workshop?.slug ?? null,
        workshopName: workshop?.title ?? '',
        sessionStart: (session?.['starts_at'] as string | null) ?? null,
        sessionEnd: (session?.['ends_at'] as string | null) ?? null,
        location: (session?.['location_label'] as string | null) ?? null,
      };
    });
  }
}
