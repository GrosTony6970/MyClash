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
