import { describe, expect, it } from 'vitest';
import { publicAbout, publicInstructors, type PublicInstructorLine } from './instructor-about';

const profile = (over: Record<string, unknown> = {}) => ({
  bio: 'Longsword coach since 2008',
  photo_url: '/storage/v1/object/public/fighter-photos/paul.jpg',
  public_visibility: {},
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
  clubs: { name: 'Salle Lyon' },
  ...over,
});

const line = (over: Partial<PublicInstructorLine> = {}): PublicInstructorLine => ({
  global_person_id: 'gp-paul',
  display_name: 'Paul Martin',
  bio: null,
  affiliation: null,
  photo_url: null,
  global_persons: profile() as never,
  ...over,
});

const NOTHING = { bio: null, club: null, photoUrl: null };

describe('publicAbout — what the Workshop page says about an instructor (3.6)', () => {
  it('shows the profile when the Workshop says nothing (556)', () => {
    expect(publicAbout(line())).toEqual({
      bio: 'Longsword coach since 2008',
      club: 'Salle Lyon',
      photoUrl: '/storage/v1/object/public/fighter-photos/paul.jpg',
    });
  });

  it('takes what the Workshop says over the profile, field by field (560)', () => {
    const about = publicAbout(
      line({ bio: '15 years of dagger', photo_url: '/storage/v1/object/public/w/p.jpg' }),
    );
    expect(about).toEqual({
      bio: '15 years of dagger',
      club: 'Salle Lyon',
      photoUrl: '/storage/v1/object/public/w/p.jpg',
    });
    expect(publicAbout(line({ affiliation: 'guest coach from Lyon' })).club).toBe(
      'guest coach from Lyon',
    );
  });

  it('never shows a profile bio its owner made private (563)', () => {
    const about = publicAbout(
      line({ global_persons: profile({ public_visibility: { bio: false } }) as never }),
    );
    expect(about.bio).toBeNull();
    expect(about.club).toBe('Salle Lyon');
  });

  it('shows a bio written for the Workshop even when the profile bio is private (559)', () => {
    const about = publicAbout(
      line({
        bio: 'Paul, 15 years of dagger',
        global_persons: profile({ public_visibility: { bio: false } }) as never,
      }),
    );
    expect(about.bio).toBe('Paul, 15 years of dagger');
  });

  it('gives an instructor with no profile only what the Workshop says', () => {
    expect(publicAbout(line({ global_persons: null }))).toEqual(NOTHING);
    expect(publicAbout(line({ global_persons: null, affiliation: 'Guest' })).club).toBe('Guest');
  });

  it('shows nothing from the profile of a deleted account, its club included (577)', () => {
    const deleted = profile({ bio: null, photo_url: null, account_deleted_at: '2026-11-01' });
    expect(publicAbout(line({ global_persons: deleted as never }))).toEqual(NOTHING);
    // What the Workshop itself says still shows.
    expect(publicAbout(line({ global_persons: deleted as never, bio: 'Teaches here' })).bio).toBe(
      'Teaches here',
    );
  });

  it('shows nothing from a merged-away or deleted profile (577)', () => {
    for (const gone of [{ merged_into_id: 'gp-other' }, { deleted_at: '2026-10-01' }]) {
      expect(publicAbout(line({ global_persons: profile(gone) as never }))).toEqual(NOTHING);
    }
  });

  it('reads a blank profile value as none', () => {
    const blank = profile({ bio: '   ', photo_url: '', clubs: { name: ' ' } });
    expect(publicAbout(line({ global_persons: blank as never }))).toEqual(NOTHING);
  });
});

describe('publicInstructors', () => {
  it('gives each instructor their own line', () => {
    const lea = line({
      global_person_id: 'gp-lea',
      display_name: 'Léa Roux',
      bio: 'Rapier',
      global_persons: null,
    });
    expect(publicInstructors([line(), lea])).toEqual([
      {
        globalPersonId: 'gp-paul',
        displayName: 'Paul Martin',
        about: {
          bio: 'Longsword coach since 2008',
          club: 'Salle Lyon',
          photoUrl: '/storage/v1/object/public/fighter-photos/paul.jpg',
        },
      },
      {
        globalPersonId: 'gp-lea',
        displayName: 'Léa Roux',
        about: { bio: 'Rapier', club: null, photoUrl: null },
      },
    ]);
  });

  it('reads no lines as no instructors', () => {
    expect(publicInstructors(null)).toEqual([]);
  });
});
