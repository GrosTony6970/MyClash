import { isReachableEmbed, REACHABLE_COLUMNS } from '../fighters/directory-predicate';
import { isFieldPublic } from '../fighters/public-visibility';

/** A bio, a club line and a photo: what a Workshop or a profile says about an instructor. */
export interface InstructorDetails {
  bio: string | null;
  club: string | null;
  photoUrl: string | null;
}

/** An instructor line with what it says over the profile, and the profile embedded. */
export interface RawLine {
  bio: string | null;
  affiliation: string | null;
  photo_url: string | null;
  global_persons: {
    bio: string | null;
    photo_url: string | null;
    public_visibility: unknown;
    clubs: { name: string | null } | null;
  } | null;
}

/**
 * The public read's instructor columns: the line, its override, and the profile under it, with
 * every column `isReachable` reads (a column left out reads `undefined`, which counts as live).
 */
export const PUBLIC_INSTRUCTOR_COLUMNS = `global_person_id, display_name, bio, affiliation, photo_url, global_persons ( bio, photo_url, public_visibility, ${REACHABLE_COLUMNS.join(', ')}, clubs ( name ) )`;

export function overrideOf(
  line: Pick<RawLine, 'bio' | 'affiliation' | 'photo_url'>,
): InstructorDetails {
  return { bio: line.bio, club: line.affiliation, photoUrl: line.photo_url };
}

/**
 * The profile's values. Its bio only to the person or when the profile shows it (563): an
 * organiser never reads a bio the instructor made private. Photo and club have no switch.
 */
export function profileOf(line: RawLine, own: boolean): InstructorDetails {
  const profile = line.global_persons;
  const bioShown = own || isFieldPublic(profile?.public_visibility, 'bio');
  return {
    bio: bioShown ? (profile?.bio ?? null) : null,
    club: profile?.clubs?.name ?? null,
    photoUrl: profile?.photo_url ?? null,
  };
}

/** A profile value with nothing in it is no value: a profile bio is stored as typed. */
const filled = (value: string | null): string | null => value?.trim() || null;

/**
 * What a visitor of the Workshop page reads about one instructor: per field, what the Workshop
 * says, else what a live profile shows (556, 559). A deleted, merged-away or erased profile gives
 * nothing (577); the Workshop's own words still show. Whether the profile is hidden from the
 * fighter pages is not asked: teaching at a public Event makes the person known there (579).
 */
export function publicAbout(line: RawLine): InstructorDetails {
  const profile: InstructorDetails = isReachableEmbed(line.global_persons)
    ? profileOf(line, false)
    : { bio: null, club: null, photoUrl: null };
  const own = overrideOf(line);
  return {
    bio: own.bio ?? filled(profile.bio),
    club: own.club ?? filled(profile.club),
    photoUrl: own.photoUrl ?? filled(profile.photoUrl),
  };
}

export type PublicInstructorLine = RawLine & {
  global_person_id: string | null;
  display_name: string;
};

/** The instructors of the public Workshop read, each with what the page says about them. */
export function publicInstructors(lines: PublicInstructorLine[] | null | undefined) {
  return (lines ?? []).map((line) => ({
    globalPersonId: line.global_person_id,
    displayName: line.display_name,
    about: publicAbout(line),
  }));
}
