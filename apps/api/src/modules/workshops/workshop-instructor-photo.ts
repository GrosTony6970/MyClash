import { EXTENSIONS, storedObjectOf } from '../exports/archive-images';
import type { SupabaseService } from '../supabase/supabase.service';
import { WORKSHOP_INSTRUCTOR_PHOTO_MAX_BYTES } from '@myclash/types';
import { WORKSHOP_LOGO_BUCKET } from './workshop-assets';
import type { UploadLimit } from '../../common/read-upload';

type Storage = SupabaseService['service']['storage'];

/**
 * The photo a Workshop shows of one of its instructors, over their profile's (rulings 556, 560).
 * It lives beside the Workshop's cover, in the same bucket, under the same size and types.
 */
export const WORKSHOP_INSTRUCTOR_PHOTO_UPLOAD: UploadLimit = {
  maxBytes: WORKSHOP_INSTRUCTOR_PHOTO_MAX_BYTES,
  tooLarge: 'Photo upload exceeds the 15 MB size limit.',
};

/**
 * The folder of one instructor line's photos: the shape an archive restore writes too
 * (`${table}/${newId}`), so this one rule finds a line's files however they got there.
 */
export function instructorPhotoFolder(lineId: string): string {
  return `workshop_instructors/${lineId}`;
}

/** Where a new photo of the line is stored, by its type. */
export function instructorPhotoPath(lineId: string, mimetype: string, now: number): string {
  return `${instructorPhotoFolder(lineId)}/photo-${now}.${EXTENSIONS[mimetype] ?? 'jpg'}`;
}

/** The same-origin link a stored photo is shown by, as profile photos are. */
export function instructorPhotoLink(path: string): string {
  return `/storage/v1/object/public/${WORKSHOP_LOGO_BUCKET}/${path}`;
}

/**
 * The stored file a line's link names, when it is one of THIS line's photos; null for any other
 * link (another line's file, the Workshop's cover, a link to elsewhere). Only such a file is ever
 * deleted when the photo is replaced or removed (ruling 562).
 */
export function ownPhotoKey(link: unknown, lineId: string): string | null {
  const object = storedObjectOf(link);
  if (!object || object.bucket !== WORKSHOP_LOGO_BUCKET) return null;
  return object.path.startsWith(`${instructorPhotoFolder(lineId)}/`) ? object.path : null;
}

/** A bucket or a file already gone is no error: a new server has no bucket until its first upload. */
const NOT_FOUND = /not found/iu;

/**
 * Deletes every photo of one line: at its untick and at its person's erasure. Any failure but
 * "not found" throws, so the caller stops before the line goes and can be tried again.
 */
export async function deleteInstructorPhotoFolder(
  storage: Storage,
  lineId: string,
): Promise<number> {
  const folder = instructorPhotoFolder(lineId);
  const bucket = storage.from(WORKSHOP_LOGO_BUCKET);
  const { data, error } = await bucket.list(folder);
  if (error && !NOT_FOUND.test(error.message)) {
    throw new Error(
      `The photos of instructor line ${lineId} could not be listed: ${error.message}`,
    );
  }
  const keys = (data ?? [])
    .map((entry) => (entry as { name?: unknown } | null)?.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .map((name) => `${folder}/${name}`);
  if (keys.length === 0) return 0;
  const removed = await bucket.remove(keys);
  if (removed.error && !NOT_FOUND.test(removed.error.message)) {
    throw new Error(
      `The photos of instructor line ${lineId} could not be deleted: ${removed.error.message}`,
    );
  }
  return keys.length;
}

type Db = SupabaseService['service'];

type Deleted = { workshopId: string } | { eventId: string } | { organizationId: string };

function idsOf(read: { data: unknown; error: { message: string } | null }, what: string) {
  if (read.error) throw new Error(`The ${what} were not read: ${read.error.message}`);
  return ((read.data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

/** The Workshops a delete takes, one Event at a time: no read nears the 1000-row cap. */
async function workshopsOf(db: Db, of: Deleted): Promise<string[]> {
  if ('workshopId' in of) return [of.workshopId];
  const eventIds =
    'eventId' in of
      ? [of.eventId]
      : idsOf(
          await db.from('events').select('id').eq('organization_id', of.organizationId),
          'Events',
        );
  const workshopIds: string[] = [];
  for (const eventId of eventIds) {
    const read = await db.from('workshops').select('id').eq('event_id', eventId);
    workshopIds.push(...idsOf(read, 'Workshops'));
  }
  return workshopIds;
}

/**
 * Deletes the instructor photos of a Workshop, or of every Workshop of an Event or of a club,
 * before it is deleted. The delete's cascade takes the lines, and then nothing names their files:
 * they would stay served at the link the public Workshop page showed (slice 3.6), and no erasure
 * would find them. Any failure throws, so the caller stops before its delete and can be tried
 * again.
 */
export async function deleteInstructorPhotosOf(db: Db, of: Deleted): Promise<void> {
  for (const workshopId of await workshopsOf(db, of)) {
    const read = await db.from('workshop_instructors').select('id').eq('workshop_id', workshopId);
    for (const lineId of idsOf(read, 'instructor lines')) {
      await deleteInstructorPhotoFolder(db.storage, lineId);
    }
  }
}
