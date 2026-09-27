/**
 * What a fighter merge records, and what the surviving profile takes from the merged-away one.
 * Pure: `merge.service.ts` does the reads and writes.
 */

export type FighterRow = Record<string, unknown> & {
  id: string;
  display_name?: string | null;
  merged_into_id?: string | null;
  deleted_at?: string | null;
  claimed_by_user_id?: string | null;
};

export interface MergeAuditPayload {
  source: FighterRow;
  target: FighterRow;
  moved: {
    personIds: string[];
    /** @deprecated registrations now follow persons.global_person_id, no direct cascade. */
    registrationIds?: string[];
    workshopInstructorIds: string[];
    /**
     * The accounts whose directory follow moved to the survivor (ruling 116). Account ids, not
     * follow ids: the audit screen names an account. Absent from audit logs before ruling 116.
     */
    directoryFollowerUserIds?: string[];
    /**
     * The account whose link moved from the merged-away profile to the survivor (ruling 159).
     * Absent when none moved, and from audit logs before ruling 159.
     */
    claimUserId?: string;
  };
  reason: string | null;
}

/** The survivor's blanks, filled from the merged-away profile, and its privacy choices. */
export function fillTargetFields(source: FighterRow, target: FighterRow): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const field of ['photo_url', 'hema_ratings_id', 'bio', 'country_code', 'gender_category']) {
    if (!target[field] && source[field]) updates[field] = source[field];
  }
  // The source's Event rows move to the target and obey its privacy choices from now on, so the
  // target keeps the stricter answer of the two per choice (ruling 157). A revert gives the source
  // back its own row, whose choices this never touched.
  if (source['hide_workshops_publicly'] === true && target['hide_workshops_publicly'] !== true) {
    updates['hide_workshops_publicly'] = true;
  }
  if (source['allow_being_followed'] === false && target['allow_being_followed'] !== false) {
    updates['allow_being_followed'] = false;
  }
  updates['updated_at'] = new Date().toISOString();
  return updates;
}

/**
 * The account that moves to the survivor (ruling 159): the one that owned the merged-away profile,
 * whose Events now follow the survivor — unless another account owns the survivor.
 */
export function claimToMove(source: FighterRow, target: FighterRow): string | null {
  return source.claimed_by_user_id && !target.claimed_by_user_id ? source.claimed_by_user_id : null;
}
