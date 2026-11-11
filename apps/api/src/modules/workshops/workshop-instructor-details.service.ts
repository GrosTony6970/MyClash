import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Upload } from '../../common/read-upload';
import { ensurePublicBucket } from '../../common/storage-bucket';
import { SupabaseService } from '../supabase/supabase.service';
import { type InstructorDetails, overrideOf, profileOf, type RawLine } from './instructor-about';
import {
  ALLOWED_WORKSHOP_LOGO_MIME_TYPES,
  WORKSHOP_LOGO_BUCKET,
  WORKSHOP_LOGO_MAX_BYTES,
} from './workshop-assets';
import { instructorPhotoLink, instructorPhotoPath, ownPhotoKey } from './workshop-instructor-photo';
import { textOrNull } from './workshop-text';
import { WorkshopsService } from './workshops.service';

/**
 * One instructor line of a Workshop: what this Workshop says over the profile (rulings 556, 560),
 * and the profile it falls back to, shown as the empty boxes' grey hint (563).
 */
export interface InstructorDetailsView {
  override: InstructorDetails;
  profile: InstructorDetails;
}

/**
 * What a Workshop says about one of its instructors, written by an organiser for any line and by
 * the instructor for their own (ruling 558). Each door sends only the boxes it changed (two
 * writers, as the Workshop's two texts): a box not sent is left as it is.
 */
@Injectable()
export class WorkshopInstructorDetailsService {
  private readonly logger = new Logger(WorkshopInstructorDetailsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly workshops: WorkshopsService,
  ) {}

  async getDetails(
    workshopId: string,
    globalPersonId: string,
    userId: string,
  ): Promise<InstructorDetailsView> {
    const own = await this.workshops.assertCanWriteInstructorLine(
      workshopId,
      globalPersonId,
      userId,
    );
    const { data, error } = await this.supabase.service
      .from('workshop_instructors')
      .select(
        'bio, affiliation, photo_url, global_persons ( bio, photo_url, public_visibility, clubs ( name ) )',
      )
      .eq('workshop_id', workshopId)
      .eq('global_person_id', globalPersonId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('This person does not teach this Workshop.');
    const line = data as unknown as RawLine;
    return { override: overrideOf(line), profile: profileOf(line, own) };
  }

  /**
   * The id of a line the caller may write (558), checked before anything is read: the photo
   * route asks it before it reads the file. 404 when the person does not teach this Workshop.
   */
  async writableLine(workshopId: string, globalPersonId: string, userId: string): Promise<string> {
    await this.workshops.assertCanWriteInstructorLine(workshopId, globalPersonId, userId);
    const { data, error } = await this.supabase.service
      .from('workshop_instructors')
      .select('id')
      .eq('workshop_id', workshopId)
      .eq('global_person_id', globalPersonId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('This person does not teach this Workshop.');
    return (data as { id: string }).id;
  }

  /**
   * Stores the line's photo, shows it, and deletes the one it replaces (562). `lineId` comes from
   * `writableLine`. The new file is written first; when the line is gone meanwhile (an untick),
   * the file is taken back and the answer is 404.
   */
  async uploadPhoto(lineId: string, file: Upload): Promise<{ url: string }> {
    if (!file.buffer.length) throw new BadRequestException('No photo file uploaded.');
    if (!ALLOWED_WORKSHOP_LOGO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Photo upload must be a PNG, JPEG, or WebP image.');
    }
    const storage = this.supabase.service.storage;
    await ensurePublicBucket(
      storage,
      WORKSHOP_LOGO_BUCKET,
      WORKSHOP_LOGO_MAX_BYTES,
      ALLOWED_WORKSHOP_LOGO_MIME_TYPES,
    );
    const path = instructorPhotoPath(lineId, file.mimetype, Date.now());
    const stored = await storage
      .from(WORKSHOP_LOGO_BUCKET)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
    if (stored.error) throw new BadRequestException(stored.error.message);

    const url = instructorPhotoLink(path);
    let before: string | null;
    try {
      before = await this.setPhoto(lineId, url);
    } catch (cause) {
      await this.dropFile(lineId, path);
      throw cause;
    }
    await this.dropFile(lineId, ownPhotoKey(before, lineId));
    return { url };
  }

  /** Takes the line's photo away, so the profile's shows again, and deletes its file (562). */
  async removePhoto(lineId: string): Promise<{ url: null }> {
    const before = await this.setPhoto(lineId, null);
    await this.dropFile(lineId, ownPhotoKey(before, lineId));
    return { url: null };
  }

  /** Points the line at `url` and answers the link it held before. 404 when the line is gone. */
  private async setPhoto(lineId: string, url: string | null): Promise<string | null> {
    const lines = () => this.supabase.service.from('workshop_instructors');
    const { data: line, error: readError } = await lines()
      .select('photo_url')
      .eq('id', lineId)
      .maybeSingle();
    if (readError) throw new BadRequestException(readError.message);
    if (!line) throw new NotFoundException('This person no longer teaches this Workshop.');
    const { data, error } = await lines()
      .update({ photo_url: url })
      .eq('id', lineId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('This person no longer teaches this Workshop.');
    return (line as { photo_url: string | null }).photo_url;
  }

  /**
   * Deletes one file of the line. The photo already changed, so a failure is logged with its key
   * and the answer stands; the file goes with the line's folder at its untick or erasure.
   */
  private async dropFile(lineId: string, path: string | null): Promise<void> {
    if (!path) return;
    const { error } = await this.supabase.service.storage.from(WORKSHOP_LOGO_BUCKET).remove([path]);
    if (error) {
      this.logger.warn(
        `Instructor line ${lineId}: the photo ${path} stays in ${WORKSHOP_LOGO_BUCKET}: ${error.message}`,
      );
    }
  }

  /** Writes the boxes sent: blank clears, absent keeps. Answers the line's details as stored. */
  async updateDetails(
    workshopId: string,
    globalPersonId: string,
    userId: string,
    dto: { bio?: string | null; club?: string | null },
  ): Promise<InstructorDetails> {
    await this.workshops.assertCanWriteInstructorLine(workshopId, globalPersonId, userId);
    const updates: Record<string, string | null> = {};
    const bio = textOrNull(dto.bio);
    const club = textOrNull(dto.club);
    if (bio !== undefined) updates['bio'] = bio;
    if (club !== undefined) updates['affiliation'] = club;

    const lines = this.supabase.service.from('workshop_instructors');
    const query =
      Object.keys(updates).length > 0
        ? lines.update(updates).select('bio, affiliation, photo_url')
        : lines.select('bio, affiliation, photo_url');
    const { data, error } = await query
      .eq('workshop_id', workshopId)
      .eq('global_person_id', globalPersonId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('This person does not teach this Workshop.');
    return overrideOf(data as Pick<RawLine, 'bio' | 'affiliation' | 'photo_url'>);
  }
}
