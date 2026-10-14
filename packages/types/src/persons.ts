/**
 * Shared types for the Persons domain.
 * Used by both the API and frontend apps.
 */

export type ClaimStatus = 'unclaimed' | 'guest_active' | 'claimed';

export interface Person {
  id: string;
  eventId: string;
  givenName: string;
  familyName: string;
  email: string | null;
  clubId: string | null;
  clubLabel: string | null; // denormalized for display
  hemaRatingsId: string | null;
  dateOfBirth: string | null;
  genderCategory: string | null;
  notes: string | null;
  claimStatus: ClaimStatus;
  claimedByUserId: string | null;
  globalPersonId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Why adding a participant minted a BRAND NEW global identity.
 *
 * `unmatchable` — the participant carries no club, no HEMA Ratings id and no
 * email, so no matching tier can ever fire and they will mint a fresh identity
 * at every event they attend. Their results never aggregate and their league
 * points scatter across identities that never add up.
 * `first_sighting` — at least one matchable identifier is present, so the next
 * event links to this identity instead. Informational.
 */
export type IdentityMintReason = 'unmatchable' | 'first_sighting';

/**
 * The create-participant response: the stored person, plus a fact about THIS
 * add that is deliberately not a Person field — it describes the write, not the
 * row, and would read as null on every subsequent fetch.
 */
export interface PersonCreated extends Person {
  /** Set when the add minted a new global identity; `null` when one was reused. */
  mintedIdentity: IdentityMintReason | null;
}

export interface PersonPublic {
  id: string;
  givenName: string;
  familyName: string;
  clubLabel: string | null;
  maskedEmail: string;
  claimStatus: ClaimStatus;
}

export interface CreatePersonDto {
  givenName: string;
  familyName: string;
  email?: string;
  clubId?: string;
  hemaRatingsId?: string;
  dateOfBirth?: string;
  genderCategory?: string;
  notes?: string;
}

export interface UpdatePersonDto {
  givenName?: string;
  familyName?: string;
  email?: string;
  clubId?: string | null;
  hemaRatingsId?: string | null;
  dateOfBirth?: string | null;
  genderCategory?: string | null;
  notes?: string | null;
}

// ── CSV import report ─────────────────────────────────────────────────────────

/**
 * Why an imported row was skipped or refused. The server sends the code and
 * each page words it in the reader's language; both CSV imports (an Event's
 * roster, the super admin's Global Profiles) use it.
 */
export const IMPORT_ROW_REASONS = [
  'no_file',
  'unreadable_file',
  'missing_given_name',
  'missing_family_name',
  'invalid_email',
  'invalid_date_of_birth',
  'already_on_roster',
  'repeated_in_file',
  'not_saved',
  'no_profile_to_overwrite',
] as const;
export type ImportRowReason = (typeof IMPORT_ROW_REASONS)[number];

/** A reason, with the cell it is about as the file holds it (a bad email or date). */
export interface ImportRowProblem {
  reason: ImportRowReason;
  value?: string;
}

export interface CsvImportDuplicate {
  /** The row's line in the file; the header is line 1. */
  line: number;
  name: string;
  reason: 'already_on_roster' | 'repeated_in_file';
  existingEmail: string | null; // masked
}

export interface CsvImportInvalid extends ImportRowProblem {
  /** The row's line in the file (the header is line 1); null when the whole file is refused. */
  line: number | null;
  raw: string;
}

export interface CsvImportReport {
  created: number;
  duplicates: CsvImportDuplicate[];
  invalid: CsvImportInvalid[];
  newClubsForReview: string[];
  /**
   * Names of imported people whose global identity was minted with nothing to
   * match on next time — no club, no HEMA Ratings id, no email. They mint a
   * fresh identity at every future event, so their results never aggregate.
   * Names rather than ids: this list is read by a human.
   */
  unmatchableIdentities: string[];
}

// ── Import preview (two-pass flow) ───────────────────────────────────────────

export interface ClubResolution {
  confidence: 'exact_abv' | 'high' | 'medium' | 'new';
  resolvedName: string;
  abbreviation?: string;
}

export interface GlobalPersonCandidate {
  id: string;
  displayName: string;
  clubName: string | null;
  abbreviation: string | null;
  email: string | null;
}

export interface PreviewRow {
  /** The row's place among the file's rows, from 0: the key a decision names. */
  index: number;
  /** The row's line in the file (the header is line 1); null when the whole file is refused. */
  line: number | null;
  givenName: string;
  familyName: string;
  email?: string;
  status: 'ok' | 'duplicate' | 'invalid';
  /** Why a duplicate or invalid row is skipped. */
  reason?: ImportRowReason;
  value?: string;
  clubResolution?: ClubResolution;
  globalPersonMatch?: GlobalPersonCandidate;
  defaultAction: 'link' | 'create_new';
}

export interface ImportPreviewResponse {
  summary: { toCreate: number; toLink: number; duplicates: number; invalid: number };
  newClubs: string[];
  /** The file's headers, as written, that name no column this import reads. */
  unknownColumns: string[];
  rows: PreviewRow[];
}

export interface ImportDecision {
  rowIndex: number;
  action: 'link' | 'create_new';
  globalPersonId?: string;
}
