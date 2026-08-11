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

export interface CsvImportDuplicate {
  row: number;
  name: string;
  existingEmail: string; // masked
}

export interface CsvImportInvalid {
  row: number;
  reason: string;
  raw: string;
}

export interface CsvImportReport {
  created: number;
  updated: number;
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
  index: number;
  givenName: string;
  familyName: string;
  email?: string;
  status: 'ok' | 'duplicate' | 'invalid';
  invalidReason?: string;
  clubResolution?: ClubResolution;
  globalPersonMatch?: GlobalPersonCandidate;
  defaultAction: 'link' | 'create_new';
}

export interface ImportPreviewResponse {
  summary: { toCreate: number; toLink: number; duplicates: number; invalid: number };
  newClubs: string[];
  rows: PreviewRow[];
}

export interface ImportDecision {
  rowIndex: number;
  action: 'link' | 'create_new';
  globalPersonId?: string;
}
