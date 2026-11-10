import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isFieldPublic } from '../fighters/public-visibility';
import { SupabaseService } from '../supabase/supabase.service';
import { textOrNull } from './workshop-text';
import { WorkshopsService } from './workshops.service';

/** A bio, a club line and a photo: what a Workshop or a profile says about an instructor. */
export interface InstructorDetails {
  bio: string | null;
  club: string | null;
  photoUrl: string | null;
}

/**
 * One instructor line of a Workshop: what this Workshop says over the profile (rulings 556, 560),
 * and the profile it falls back to, shown as the empty boxes' grey hint (563).
 */
export interface InstructorDetailsView {
  override: InstructorDetails;
  profile: InstructorDetails;
}

interface RawLine {
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

function overrideOf(line: Pick<RawLine, 'bio' | 'affiliation' | 'photo_url'>): InstructorDetails {
  return { bio: line.bio, club: line.affiliation, photoUrl: line.photo_url };
}

/**
 * The profile's values. Its bio only to the person or when the profile shows it (563): an
 * organiser never reads a bio the instructor made private. Photo and club have no switch.
 */
function profileOf(line: RawLine, own: boolean): InstructorDetails {
  const profile = line.global_persons;
  const bioShown = own || isFieldPublic(profile?.public_visibility, 'bio');
  return {
    bio: bioShown ? (profile?.bio ?? null) : null,
    club: profile?.clubs?.name ?? null,
    photoUrl: profile?.photo_url ?? null,
  };
}

/**
 * What a Workshop says about one of its instructors, written by an organiser for any line and by
 * the instructor for their own (ruling 558). Each door sends only the boxes it changed (two
 * writers, as the Workshop's two texts): a box not sent is left as it is.
 */
@Injectable()
export class WorkshopInstructorDetailsService {
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
