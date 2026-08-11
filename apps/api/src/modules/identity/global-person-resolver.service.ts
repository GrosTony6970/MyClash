import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/** The identity inputs used to match (or mint) a `global_persons` row. */
export interface ResolveGlobalPersonInput {
  givenName: string;
  familyName: string;
  clubId: string | null;
  hemaRatingsId: string | null;
  dateOfBirth: string | null;
  email: string | null;
  genderCategory: string | null;
}

/**
 * Why a fresh `global_persons` row was minted.
 *
 * `unmatchable` is the reason worth warning an organizer about: with no club,
 * no HEMA Ratings id and no email, NO tier below can ever fire — tier 1 needs a
 * ratings id, tiers 2 and 3 need a club, the email tier needs an email. Such a
 * person mints a BRAND NEW identity at every event they attend, so their
 * results never aggregate across events and their league points scatter.
 *
 * `first_sighting` carries at least one matchable identifier, so the next event
 * links to this row instead of minting another. Nothing to fix.
 */
export type MintReason = 'unmatchable' | 'first_sighting';

export interface ResolveGlobalPersonResult {
  id: string;
  /** true when a fresh row was minted; false when an existing identity was reused. */
  created: boolean;
  /** Why the fresh row was minted. `null` whenever an existing identity was reused. */
  mintReason: MintReason | null;
}

/**
 * Pure: which mint reason a set of identifiers implies. Takes the NORMALIZED
 * values (trimmed, lower-cased email) so it agrees with the matching tiers
 * rather than with the caller's raw input — a `hemaRatingsId` of `'   '` is
 * not an identifier.
 */
export function classifyMint(identifiers: {
  clubId: string | null;
  hemaRatingsId: string | null;
  email: string | null;
}): MintReason {
  const matchable = identifiers.clubId ?? identifiers.hemaRatingsId ?? identifiers.email;
  return matchable ? 'first_sighting' : 'unmatchable';
}

interface GpMatchRow {
  id: string;
  email: string | null;
  date_of_birth: string | null;
}

/** Slug seed for newly-created global_persons rows (mirrors the helpers in
 *  persons.service.ts / fighters.service.ts). */
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** Minimal masker for the unique-email error message. */
function maskEmail(email: string): string {
  return email.replace(/^(.).*(@.*)$/, '$1***$2') || '***@***.***';
}

/**
 * Single source of truth for resolving a participant to an existing
 * `global_persons` identity or minting a fresh one. Shared by the
 * persons-create, CSV-import, and tournament-registration paths so a real
 * fighter is never duplicated across events.
 *
 * Matching tiers, most-confident first — anything below produces a fresh row
 * rather than risking a false merge:
 *
 *   Tier 1: exact `hema_ratings_id`.
 *   Tier 2: name + club_id + date_of_birth (all three present).
 *   Tier 3: name + club_id (unique, non-merged) — no DOB. Looser tier that
 *           dedupes rosters imported per-event without email/DOB (the E2E-7
 *           seed) which would otherwise mint a duplicate identity per event.
 *   Email : reuse a row that already owns the email (unique index on
 *           LOWER(email) for unmerged rows) before minting.
 *
 * Each tier only auto-links on a UNIQUE hit; two or more candidates fall
 * through, so ambiguous namesakes still mint fresh. The conservatism is
 * intentional: a wrong auto-merge fragments cross-event identity in ways that
 * take an admin merge tool to undo, while a missed merge is a one-click fix.
 *
 * Tier-3 TRADE-OFF: two genuinely distinct people with an identical name in
 * the same club would collapse into one identity. Accepted deliberately (the
 * global-profiles admin can split them); it is the price of deduping seed/CSV
 * rosters that carry neither email nor date of birth.
 */
@Injectable()
export class GlobalPersonResolverService {
  private readonly logger = new Logger(GlobalPersonResolverService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async resolveOrCreateGlobalPerson(
    input: ResolveGlobalPersonInput,
  ): Promise<ResolveGlobalPersonResult> {
    const givenName = input.givenName.trim();
    const familyName = input.familyName.trim();
    const hemaRatingsId = input.hemaRatingsId?.trim() || null;
    const dateOfBirth = input.dateOfBirth?.trim() || null;
    const email = input.email?.trim().toLowerCase() || null;

    // Tier 1 — HEMA Ratings ID.
    if (hemaRatingsId) {
      const { data: hits } = await this.supabase.service
        .from('global_persons')
        .select('id, email, date_of_birth')
        .eq('hema_ratings_id', hemaRatingsId)
        .limit(2);
      const rows = (hits ?? []) as GpMatchRow[];
      if (rows.length === 1) {
        await this.backfillIdentity(rows[0]!, { email, dateOfBirth });
        return { id: rows[0]!.id, created: false, mintReason: null };
      }
    }

    // Tier 2 — name + club + DOB. Each part must be present.
    if (input.clubId && dateOfBirth) {
      const { data: hits } = await this.supabase.service
        .from('global_persons')
        .select('id, email, date_of_birth')
        .ilike('given_name', givenName)
        .ilike('family_name', familyName)
        .eq('club_id', input.clubId)
        .eq('date_of_birth', dateOfBirth)
        .limit(2);
      const rows = (hits ?? []) as GpMatchRow[];
      if (rows.length === 1) {
        await this.backfillIdentity(rows[0]!, { email, dateOfBirth });
        return { id: rows[0]!.id, created: false, mintReason: null };
      }
    }

    // Tier 3 — name + club (unique, non-merged). See the class doc for the
    // deliberate trade-off.
    if (input.clubId) {
      const { data: hits } = await this.supabase.service
        .from('global_persons')
        .select('id, email, date_of_birth')
        .ilike('given_name', givenName)
        .ilike('family_name', familyName)
        .eq('club_id', input.clubId)
        .is('merged_into_id', null)
        .limit(2);
      const rows = (hits ?? []) as GpMatchRow[];
      if (rows.length === 1) {
        await this.backfillIdentity(rows[0]!, { email, dateOfBirth });
        return { id: rows[0]!.id, created: false, mintReason: null };
      }
    }

    // Email link — reuse the identity that already owns this email rather than
    // minting a duplicate (and so the fighter can auto-claim on first login).
    if (email) {
      const { data: existingByEmail } = await this.supabase.service
        .from('global_persons')
        .select('id')
        .ilike('email', email)
        .is('merged_into_id', null)
        .limit(1)
        .maybeSingle();
      if (existingByEmail) {
        return { id: (existingByEmail as { id: string }).id, created: false, mintReason: null };
      }
    }

    // No confident match — mint a fresh global identity.
    const displayName = `${givenName} ${familyName}`.trim();
    const slug = `${slugifyName(`${givenName}-${familyName}`)}-${Date.now().toString(36)}`;
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .insert({
        slug,
        display_name: displayName,
        given_name: givenName,
        family_name: familyName,
        club_id: input.clubId,
        hema_ratings_id: hemaRatingsId,
        date_of_birth: dateOfBirth,
        email,
        gender_category: input.genderCategory ?? null,
        is_fighter: true,
      })
      .select('id')
      .single();
    if (error) {
      // A concurrent insert may have taken the email (unique on LOWER(email)
      // for unmerged rows) — link to it rather than failing.
      if (email && /duplicate key|unique/i.test(error.message)) {
        const { data: collided } = await this.supabase.service
          .from('global_persons')
          .select('id')
          .ilike('email', email)
          .is('merged_into_id', null)
          .limit(1)
          .maybeSingle();
        if (collided)
          return { id: (collided as { id: string }).id, created: false, mintReason: null };
        throw new BadRequestException(
          `Email ${maskEmail(email)} is already linked to another global profile`,
        );
      }
      throw new BadRequestException(error.message);
    }
    return {
      id: (data as { id: string }).id,
      created: true,
      mintReason: classifyMint({ clubId: input.clubId, hemaRatingsId, email }),
    };
  }

  /**
   * After a tier match, fill in email / date_of_birth on the existing row when
   * the column is NULL and the caller supplied a value. Never overwrites.
   * Errors are swallowed (logged): the participant flow must still succeed.
   */
  private async backfillIdentity(
    row: GpMatchRow,
    incoming: { email: string | null; dateOfBirth: string | null },
  ): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (incoming.email && !row.email) updates['email'] = incoming.email;
    if (incoming.dateOfBirth && !row.date_of_birth) updates['date_of_birth'] = incoming.dateOfBirth;
    if (Object.keys(updates).length === 0) return;

    const { error } = await this.supabase.service
      .from('global_persons')
      .update(updates)
      .eq('id', row.id);
    if (error) {
      this.logger.warn(`global_persons backfill failed for ${row.id}: ${error.message}`);
    }
  }
}
