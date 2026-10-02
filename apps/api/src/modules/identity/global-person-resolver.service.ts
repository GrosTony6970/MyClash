import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { personEmailMatchesUser } from '../auth/person-email-match';
import { SupabaseService } from '../supabase/supabase.service';
import { profileOfRosterAddress, profileOfRosterHemaId } from './roster-row-tiers';
import { sameName, type NameParts } from './same-name';

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
 * results never aggregate across events and their league points scatter. An
 * email on the ROW counts, even when the profile is minted without it (ruling
 * 211): the next row with that email and that name finds the profile again
 * through this one (ruling 211a).
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
}

/** What a mint inserts, the address apart: `mint` decides whether the profile may carry it. */
interface MintFields {
  slug: string;
  display_name: string;
  given_name: string;
  family_name: string;
  club_id: string | null;
  hema_ratings_id: string | null;
  date_of_birth: string | null;
  gender_category: string | null;
  is_fighter: true;
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
 *   Email : reuse the row that already owns the email (unique index on
 *           LOWER(email) for unmerged rows), when it has the SAME NAME (operator
 *           ruling 211, `sameName`). An address alone proves nothing: an
 *           organiser's typo, or a brother at the family address, used to put a
 *           roster row on somebody else's profile, and nothing repaired it. A
 *           profile of another name is not linked, and the minted profile then
 *           leaves the address out: the index forbids it twice.
 *   Roster: a tier with an accepted false positive; skipped when any profile
 *           holds the id (see `profileOfRosterHemaId`).
 *   Rows  : before minting, the profile that roster rows carrying this email
 *           AND this name already sit on (rulings 211a-c,
 *           `profileOfRosterAddress`). It is what finds a second spelling again,
 *           or the brother at the family address, whose profiles were minted
 *           without the email.
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
 *
 * A match only LINKS; it writes nothing onto the row it found (operator ruling
 * 35, 2026-09-22): only the fighter or a super admin changes an existing
 * profile's details, as RLS `global_persons_update` says. The resolver used to
 * fill a matched row's EMPTY email and date of birth from the roster — one way
 * an organiser could put their own address on a stranger's unclaimed profile
 * and then claim it (the claim link is mailed to `global_persons.email`, and
 * signing in with that address claims it). A MINTED row takes every field.
 */
@Injectable()
export class GlobalPersonResolverService {
  private readonly logger = new Logger(GlobalPersonResolverService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** What the two roster-row tiers read and log with (`roster-row-tiers.ts`). */
  private get rosterTiers() {
    return { supabase: this.supabase, logger: this.logger };
  }

  async resolveOrCreateGlobalPerson(
    input: ResolveGlobalPersonInput,
  ): Promise<ResolveGlobalPersonResult> {
    const givenName = input.givenName.trim();
    const familyName = input.familyName.trim();
    const hemaRatingsId = input.hemaRatingsId?.trim() || null;
    const dateOfBirth = input.dateOfBirth?.trim() || null;
    const email = input.email?.trim().toLowerCase() || null;

    // Tier 1 — HEMA Ratings ID.
    let idOnAProfile = false;
    if (hemaRatingsId) {
      const { data: hits } = await this.supabase.service
        .from('global_persons')
        .select('id')
        .eq('hema_ratings_id', hemaRatingsId)
        .limit(2);
      const rows = (hits ?? []) as GpMatchRow[];
      if (rows.length === 1) return { id: rows[0]!.id, created: false, mintReason: null };
      idOnAProfile = rows.length > 0;
    }

    // Tier 2 — name + club + DOB. Each part must be present.
    if (input.clubId && dateOfBirth) {
      const { data: hits } = await this.supabase.service
        .from('global_persons')
        .select('id')
        .ilike('given_name', givenName)
        .ilike('family_name', familyName)
        .eq('club_id', input.clubId)
        .eq('date_of_birth', dateOfBirth)
        .limit(2);
      const rows = (hits ?? []) as GpMatchRow[];
      if (rows.length === 1) return { id: rows[0]!.id, created: false, mintReason: null };
    }

    // Tier 3 — name + club (unique, non-merged). See the class doc for the
    // deliberate trade-off.
    if (input.clubId) {
      const { data: hits } = await this.supabase.service
        .from('global_persons')
        .select('id')
        .ilike('given_name', givenName)
        .ilike('family_name', familyName)
        .eq('club_id', input.clubId)
        .is('merged_into_id', null)
        .limit(2);
      const rows = (hits ?? []) as GpMatchRow[];
      if (rows.length === 1) return { id: rows[0]!.id, created: false, mintReason: null };
    }

    // Email link — reuse the identity that already owns this email rather than
    // minting a duplicate (and so the fighter can auto-claim on first login),
    // when it has the row's name (ruling 211).
    const holder = email ? await this.profileByExactEmail(email) : null;
    if (holder && sameName(holder, { givenName, familyName })) {
      return { id: holder.id, created: false, mintReason: null };
    }
    if (holder) this.refusedByName(holder.id);

    // The roster rows that carry the HEMA Ratings id.
    if (hemaRatingsId && !idOnAProfile) {
      const viaRoster = await profileOfRosterHemaId(this.rosterTiers, hemaRatingsId);
      if (viaRoster) return { id: viaRoster, created: false, mintReason: null };
    }

    // Before minting — the roster rows that carry this address and this name.
    const viaRows = email
      ? await profileOfRosterAddress(this.rosterTiers, email, { givenName, familyName })
      : null;
    if (viaRows) return { id: viaRows, created: false, mintReason: null };

    // No confident match — mint a fresh global identity. The address stays on
    // the roster row when a profile of another name holds it.
    return this.mint(
      {
        slug: `${slugifyName(`${givenName}-${familyName}`)}-${Date.now().toString(36)}`,
        display_name: `${givenName} ${familyName}`.trim(),
        given_name: givenName,
        family_name: familyName,
        club_id: input.clubId,
        hema_ratings_id: hemaRatingsId,
        date_of_birth: dateOfBirth,
        gender_category: input.genderCategory ?? null,
        is_fighter: true,
      },
      holder ? null : email,
      classifyMint({ clubId: input.clubId, hemaRatingsId, email }),
    );
  }

  /**
   * Mints a profile. `email` is null when the row has no address, and when its address belongs to
   * a profile of another name: 0075's unique index allows one unmerged profile per address. The
   * reason comes from the caller, decided on what the ROW carries: a row with an address finds its
   * profile again whether or not the profile carries it (`profileOfRosterAddress`).
   *
   * Named race: a profile can take the address between the Email tier's read and this insert,
   * which the index refuses. The holder is read again. With the row's name it is the same person
   * minted twice at once: link it. With another name, mint once more without the address.
   */
  private async mint(
    fields: MintFields,
    email: string | null,
    mintReason: MintReason,
  ): Promise<ResolveGlobalPersonResult> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .insert({ ...fields, email })
      .select('id')
      .single();
    if (!error) return { id: (data as { id: string }).id, created: true, mintReason };
    if (!email || !/duplicate key|unique/i.test(error.message)) {
      throw new BadRequestException(error.message);
    }
    const holder = await this.profileByExactEmail(email);
    if (!holder) {
      throw new BadRequestException(
        `Email ${maskEmail(email)} is already linked to another global profile`,
      );
    }
    if (sameName(holder, { givenName: fields.given_name, familyName: fields.family_name })) {
      return { id: holder.id, created: false, mintReason: null };
    }
    this.refusedByName(holder.id);
    return this.mint(fields, null, mintReason);
  }

  /** The trace of a refused email link (ruling 211). The id only: a name in a log is personal data. */
  private refusedByName(profileId: string): void {
    this.logger.log(
      `email link refused: global_persons ${profileId} holds the address under another name`,
    );
  }

  /**
   * The unmerged profile that carries EXACTLY this address (operator ruling
   * 49(a), 2026-09-22), or null.
   *
   * The read has to be an `ilike` — the stored address may differ in case, and
   * 0075's unique index is on `LOWER(email)` — but `ilike` also reads `_` and
   * `%` in the address as wildcards, and PostgREST turns `*` into `%`. A roster
   * address is whatever an organiser typed, so `m_martin@x.fr` found and linked
   * `m.martin@x.fr`'s profile; its owner's next sign-in then claimed the row
   * (`claimed-person-sync.ts`). Only an exact match is kept now.
   *
   * No `.limit()`: it would cut the exact row off behind look-alikes, which is
   * the lesson ruling 47 left on the sign-in email step.
   *
   * Claimed profiles count too, not only unclaimed ones — the point is to reuse
   * one identity across events rather than to decide who owns it. The address
   * here is whatever an ORGANISER typed on a roster row, so it is not proof of
   * anything about the caller; that is why a match only links, and writes
   * nothing onto the row it found (ruling 35, in the class docstring above).
   *
   * At most one row can survive the filter, so there is no "which one" to pick:
   * `ilike` is anchored at both ends, so a stored address padded with spaces is
   * never returned in the first place, and two unmerged rows cannot share a
   * lowered address — 0075's unique index on `LOWER(email)` forbids it.
   *
   * The profile comes back with its NAME: the caller links it only to a row of
   * the same name (ruling 211).
   */
  private async profileByExactEmail(email: string): Promise<(GpMatchRow & NameParts) | null> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('id, email, given_name, family_name')
      .ilike('email', email)
      .is('merged_into_id', null);
    if (error) {
      this.logger.warn(`email link: candidate read failed: ${error.message}`);
      return null;
    }
    const rows = (data ?? []) as Array<{
      id: string;
      email: string | null;
      given_name: string | null;
      family_name: string | null;
    }>;
    const row = rows.find((candidate) => personEmailMatchesUser(candidate.email, email));
    return row ? { id: row.id, givenName: row.given_name, familyName: row.family_name } : null;
  }
}
