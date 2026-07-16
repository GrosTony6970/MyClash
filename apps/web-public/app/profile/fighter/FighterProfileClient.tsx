'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { getDateFormat } from '@myclash/types';
import { Avatar, Button, Card, ClubCombobox, type ClubOption, type ClubValue } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { AvatarCropper } from './AvatarCropper';
import { InsightCard } from './InsightCard';
import { ShareProfile } from '@/components/fighter/ShareProfile';
import { matchHemaRating, medalGlyph, placeHeadline, weaponKey } from '@/lib/weapon-stats';

// Profile-photo upload limits. Mirrors the server cap (15 MB) and the
// PNG/JPEG/WebP allowlist enforced by FightersService.uploadMyPhoto.
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Common HEMA styles/traditions offered as autocomplete for the per-weapon
// "style" field. Free text — users may type anything; these are only hints.
const HEMA_STYLE_SUGGESTIONS = [
  'KDF',
  'German longsword',
  'Italian longsword',
  'Bolognese',
  'Fiore',
  'Meyer',
  'Fabris',
  'Destreza',
  'Radaelli',
  'English (Silver)',
  'Sword & buckler (I.33)',
  'Sabre',
  'Smallsword',
];

interface ClubLink {
  role?: string;
  clubs?: { id?: string | null; name?: string | null } | null;
}

type WeaponLevel = 'just_for_fun' | 'beginner' | 'intermediate' | 'advanced';

interface WeaponLink {
  favorite?: boolean;
  level?: string | null;
  style?: string | null;
  weapon_catalog?: { id?: string; name?: string | null } | null;
}

interface WeaponCatalogEntry {
  id: string;
  name: string;
}

/** A manually imported podium from a tournament not run in the app. */
interface FighterMedal {
  competition: string;
  year: number;
  rank: number;
  weapon: string;
}

interface FighterProfile {
  id: string;
  slug?: string;
  display_name?: string;
  given_name?: string;
  family_name?: string;
  country_code?: string | null;
  dateOfBirth?: string | null;
  bio?: string | null;
  alias?: string | null;
  website_url?: string | null;
  instagram_url?: string | null;
  youtube_url?: string | null;
  practicing_since_year?: number | null;
  public_visibility?: Record<string, boolean> | null;
  photo_url?: string | null;
  clubs?: ClubLink[];
  weapons?: WeaponLink[];
  medals?: FighterMedal[];
}

/** Per-scope combat stats (overall or one weapon), as returned by
 *  buildFighterCareer().finalizeStats — see apps/api fighter-career.ts. */
interface WeaponStat {
  weapon?: string;
  matches: number;
  wins: number;
  losses: number;
  winLossRatio: number | null;
  doubleHits: number;
  exchanges: number;
  doubleHitPercentage: number;
}

/** A fighter's final placement in one completed tournament (server-computed via
 *  the shared computeFinalRanking — same order the public tournament page shows). */
interface FighterPlacement {
  tournamentId: string;
  tournamentName: string;
  tournamentSlug: string;
  eventId: string;
  eventName: string;
  eventSlug: string;
  weapon: string | null;
  date: string | null;
  place: number | null;
  resultKind: string | null;
  totalRanked: number | null;
}

/** Raw per-(event × weapon) combat counts (unfinalized) — the client sums the
 *  buckets matching the selected event+weapon scope, then derives the rates. */
interface FighterEventStat {
  eventKey: string;
  eventId: string;
  eventName: string;
  weapon: string;
  matches: number;
  wins: number;
  losses: number;
  doubleHits: number;
  exchanges: number;
}

/** A received penalty card enriched with its event + weapon (private path). */
interface FighterPenalty {
  eventKey: string;
  eventId: string;
  eventName: string;
  weapon: string;
  card: string;
  category: string | null;
}

interface DashboardResponse {
  profile: FighterProfile;
  career: {
    eventParticipation: Array<{ startDate?: string | null }>;
    tournamentPlacements: FighterPlacement[];
    /** Distinct tournaments with a completed match — what the "tournaments
     *  attended" tile means. `tournamentPlacements` only covers the ones we
     *  could rank, so it undercounts a tournament still in play. */
    tournamentsAttended: number;
    upcoming: unknown[];
    leagueRankings: Array<{
      leagueName: string;
      leagueSlug: string;
      rank: number;
      totalPoints: number;
      medalCount: number;
    }>;
    recentForm: Array<{
      matchId: string;
      date: string | null;
      outcome: 'win' | 'loss' | 'draw';
      ourScore: number;
      opponentScore: number;
    }>;
    currentStreak: { kind: 'win' | 'loss' | 'none'; count: number };
    stats: {
      overall: WeaponStat;
      byWeapon: Array<WeaponStat & { weapon: string }>;
      byYear: Array<WeaponStat & { year: string }>;
      byEvent: FighterEventStat[];
    };
    // Cards received across the fighter's career, present only on the private
    // `/me` dashboard. Filtered + tallied client-side by the selected scope.
    penalties?: FighterPenalty[];
  };
  // Per-weapon HEMA Ratings, surfaced by getMyDashboard when a hema_ratings_id
  // is linked. `ratings[].weapon` may not exactly match the tournament-derived
  // byWeapon keys — matched case-insensitively at render, hidden on no match.
  hemaRatings?: {
    /** Outbound link to the fighter's hemaratings.com profile. */
    detailsUrl?: string;
    ratings: Array<{ weapon: string; rank: number | null; weightedRating: number }>;
  } | null;
  refereeStats?: RefereeStats;
}

interface RefereeStats {
  totalMatches: number;
  averageRefereeTimeMs: number;
  roles: {
    arbitre_declarant: number;
    arbitre_assesseur: number;
    arbitre_table: number;
  };
  cards: {
    yellow: number;
    red: number;
    black: number;
  };
  bestBuddies: Array<{
    userId: string;
    displayName: string | null;
    matchesTogether: number;
  }>;
  history?: Array<{
    matchId: string;
    role: string | null;
    eventName: string | null;
    tournamentName: string | null;
    weapon: string | null;
    scheduledAt: string | null;
    durationMs: number;
  }>;
}

/** An editable imported-medal row. `year` is kept as a string for the input;
 *  it is parsed to a number on save. */
interface MedalFormRow {
  competition: string;
  year: string;
  rank: 1 | 2 | 3;
  weapon: string;
}

interface FormState {
  displayName: string;
  givenName: string;
  familyName: string;
  nationality: string;
  dateOfBirth: string;
  bio: string;
  alias: string;
  websiteUrl: string;
  instagramUrl: string;
  youtubeUrl: string;
  practicingSince: string;
  visibility: Record<string, boolean>;
  photoUrl: string;
  mainClub: ClubValue | null;
  secondaryClubs: ClubValue[];
  previousClubs: ClubValue[];
  selectedWeapons: Record<
    string,
    { name: string; favorite: boolean; level: WeaponLevel | null; style: string }
  >;
  medals: MedalFormRow[];
}

const emptyForm: FormState = {
  displayName: '',
  givenName: '',
  familyName: '',
  nationality: '',
  dateOfBirth: '',
  bio: '',
  alias: '',
  websiteUrl: '',
  instagramUrl: '',
  youtubeUrl: '',
  practicingSince: '',
  visibility: {},
  photoUrl: '',
  mainClub: null,
  secondaryClubs: [],
  previousClubs: [],
  selectedWeapons: {},
  medals: [],
};

/** Build the ClubCombobox values for a given role from the profile club links,
 *  carrying the club id so an existing club re-saves by id (never duplicated). */
function clubValuesByRole(clubs: ClubLink[] | undefined, role: string): ClubValue[] {
  return (clubs ?? [])
    .filter((club) => club.role === role && club.clubs?.name)
    .map((club) => ({ clubId: club.clubs?.id ?? null, clubName: club.clubs?.name ?? '' }));
}

/** A picked club re-saves by id; a typed-but-new one saves by name (the API
 *  resolves the name → an unverified club). */
function toClubInput(value: ClubValue): { clubId: string } | { clubName: string } {
  return value.clubId ? { clubId: value.clubId } : { clubName: value.clubName };
}

function formFromProfile(profile: FighterProfile, formatDob: (iso: string) => string): FormState {
  const selectedWeapons: FormState['selectedWeapons'] = {};
  for (const weapon of profile.weapons ?? []) {
    const id = weapon.weapon_catalog?.id;
    const name = weapon.weapon_catalog?.name;
    if (!id || !name) continue;
    selectedWeapons[id] = {
      name,
      favorite: Boolean(weapon.favorite),
      level: (weapon.level as WeaponLevel | null) ?? null,
      style: weapon.style ?? '',
    };
  }

  const mainClubs = clubValuesByRole(profile.clubs, 'main');
  return {
    displayName: profile.display_name ?? '',
    givenName: profile.given_name ?? '',
    familyName: profile.family_name ?? '',
    nationality: profile.country_code ?? '',
    dateOfBirth: formatDob(profile.dateOfBirth ?? ''),
    bio: profile.bio ?? '',
    alias: profile.alias ?? '',
    websiteUrl: profile.website_url ?? '',
    instagramUrl: profile.instagram_url ?? '',
    youtubeUrl: profile.youtube_url ?? '',
    practicingSince: profile.practicing_since_year ? String(profile.practicing_since_year) : '',
    visibility: profile.public_visibility ?? {},
    photoUrl: profile.photo_url ?? '',
    mainClub: mainClubs[0] ?? null,
    secondaryClubs: clubValuesByRole(profile.clubs, 'secondary'),
    previousClubs: clubValuesByRole(profile.clubs, 'previous'),
    selectedWeapons,
    medals: (profile.medals ?? []).map((medal) => ({
      competition: medal.competition,
      year: String(medal.year),
      rank: (medal.rank === 2 || medal.rank === 3 ? medal.rank : 1) as 1 | 2 | 3,
      weapon: medal.weapon,
    })),
  };
}

export function FighterProfileClient({ apiUrl }: { apiUrl: string }) {
  const { t, locale } = useI18n();
  const dateFormat = useMemo(() => getDateFormat(locale), [locale]);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [weapons, setWeapons] = useState<WeaponCatalogEntry[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Profile-photo upload: a picked file opens the cropper (cropImageSrc holds
  // its object URL); a successful crop uploads and updates the header preview.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // Roster registrations matching the logged-in user's email but not yet
  // claimed — surfaced as a confirm-to-claim step instead of dead-ending when
  // no Fighter profile is linked yet.
  const [claimable, setClaimable] = useState<
    Array<{ id: string; name: string; eventName: string }>
  >([]);
  const [claiming, setClaiming] = useState(false);

  // Async fuzzy club search powering every ClubCombobox (main + secondary +
  // previous). The combobox stays API-agnostic; the URL lives here.
  const searchClubs = useCallback(
    async (query: string): Promise<ClubOption[]> => {
      const url = `${apiUrl}/api/v1/clubs?q=${encodeURIComponent(query)}&searchAbv=true`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return [];
      const data = (await res.json()) as
        | Array<{ id: string; name: string; city?: string | null; abbreviation?: string | null }>
        | {
            clubs?: Array<{
              id: string;
              name: string;
              city?: string | null;
              abbreviation?: string | null;
            }>;
          };
      const rows = Array.isArray(data) ? data : (data.clubs ?? []);
      return rows
        .filter((c) => c.id && c.name)
        .map((c) => ({
          id: c.id,
          name: c.name,
          city: c.city ?? null,
          abbreviation: c.abbreviation ?? null,
        }));
    },
    [apiUrl],
  );

  const loadClaimable = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/me/personal-space`, { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as {
        claimable?: Array<{ id: string; name: string; eventName: string }>;
      };
      setClaimable(Array.isArray(data.claimable) ? data.claimable : []);
    } catch {
      // ignore — fall back to the generic access-required message
    }
  }, [apiUrl]);

  // No synchronous setLoading(true) here: the initial mount relies on the
  // `loading` state's initial `true`, and the claim re-load sets it from its
  // async callback below. Keeping it out of `load` lets the mount effect call
  // load() without tripping set-state-in-effect.
  const load = useCallback(() => {
    Promise.all([
      fetch(`${apiUrl}/api/v1/fighters/me/dashboard`, { credentials: 'include' }),
      fetch(`${apiUrl}/api/v1/weapons`, { credentials: 'include' }),
    ])
      .then(async ([dashboardResponse, weaponsResponse]) => {
        if (!dashboardResponse.ok) {
          // Logged in but no Fighter profile linked yet → offer the
          // confirm-to-claim step rather than a dead-end error.
          await loadClaimable();
          setError(t('publicApp.fighterProfile.loadError'));
          return;
        }
        const nextDashboard = (await dashboardResponse.json()) as DashboardResponse;
        const nextWeapons = weaponsResponse.ok
          ? ((await weaponsResponse.json()) as WeaponCatalogEntry[])
          : [];
        setDashboard(nextDashboard);
        setWeapons(nextWeapons);
        setError(null);
        setForm(formFromProfile(nextDashboard.profile, dateFormat.format));
      })
      .catch(() => {
        setError(t('publicApp.fighterProfile.loadError'));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiUrl, t, dateFormat, loadClaimable]);

  const claim = (personId: string) => {
    setClaiming(true);
    fetch(`${apiUrl}/api/v1/me/claim-persons`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personIds: [personId] }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('claim');
        // Claiming links the global profile → the dashboard now resolves.
        setClaimable([]);
        setLoading(true);
        load();
      })
      .catch(() => {
        setError(t('publicApp.personalSpace.claimable.error'));
      })
      .finally(() => {
        setClaiming(false);
      });
  };

  useEffect(() => {
    load();
  }, [load]);

  const selectedWeaponRows = useMemo(
    () =>
      Object.entries(form.selectedWeapons).map(([weaponId, weapon]) => ({
        weaponId,
        weaponName: weapon.name,
        favorite: weapon.favorite,
        level: weapon.level,
        style: weapon.style.trim() || null,
      })),
    [form.selectedWeapons],
  );

  const updateField = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleWeapon = (weapon: WeaponCatalogEntry) => {
    setForm((current) => {
      const selectedWeapons = { ...current.selectedWeapons };
      if (selectedWeapons[weapon.id]) delete selectedWeapons[weapon.id];
      else
        selectedWeapons[weapon.id] = { name: weapon.name, favorite: false, level: null, style: '' };
      return { ...current, selectedWeapons };
    });
  };

  const toggleFavorite = (weapon: WeaponCatalogEntry) => {
    setForm((current) => {
      const existing = current.selectedWeapons[weapon.id];
      if (!existing) return current;
      return {
        ...current,
        selectedWeapons: {
          ...current.selectedWeapons,
          [weapon.id]: { ...existing, favorite: !existing.favorite },
        },
      };
    });
  };

  const setWeaponLevel = (weapon: WeaponCatalogEntry, level: WeaponLevel | null) => {
    setForm((current) => {
      const existing = current.selectedWeapons[weapon.id];
      if (!existing) return current;
      return {
        ...current,
        selectedWeapons: {
          ...current.selectedWeapons,
          [weapon.id]: { ...existing, level },
        },
      };
    });
  };

  const setWeaponStyle = (weapon: WeaponCatalogEntry, style: string) => {
    setForm((current) => {
      const existing = current.selectedWeapons[weapon.id];
      if (!existing) return current;
      return {
        ...current,
        selectedWeapons: {
          ...current.selectedWeapons,
          [weapon.id]: { ...existing, style },
        },
      };
    });
  };

  // Toggle a field's public visibility. Every toggle here defaults to public, so
  // store the flipped explicit boolean.
  const toggleVisibility = (key: string, currentlyVisible: boolean) => {
    setForm((current) => ({
      ...current,
      visibility: { ...current.visibility, [key]: !currentlyVisible },
    }));
  };

  const addMedal = () => {
    setForm((current) => ({
      ...current,
      medals: [...current.medals, { competition: '', year: '', rank: 1, weapon: '' }],
    }));
  };

  const updateMedal = (index: number, patch: Partial<MedalFormRow>) => {
    setForm((current) => {
      const medals = current.medals.slice();
      medals[index] = { ...medals[index], ...patch } as MedalFormRow;
      return { ...current, medals };
    });
  };

  const removeMedal = (index: number) => {
    setForm((current) => {
      const medals = current.medals.slice();
      medals.splice(index, 1);
      return { ...current, medals };
    });
  };

  // Picked a file → validate, then open the cropper. Reset the input value so
  // re-picking the same file fires onChange again.
  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMessage(null);
    setError(null);
    if (file.size > PHOTO_MAX_BYTES) {
      setError(t('publicApp.fighterProfile.photoTooLarge'));
      return;
    }
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      setError(t('publicApp.fighterProfile.photoWrongType'));
      return;
    }
    setCropImageSrc(URL.createObjectURL(file));
  };

  const closeCropper = () => {
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc);
    setCropImageSrc(null);
  };

  // Cropper produced a square blob → upload it and reflect the new URL locally
  // (header avatar + the dashboard profile) so it appears without a reload.
  const onCropSave = (blob: Blob) => {
    setPhotoBusy(true);
    setError(null);
    const body = new FormData();
    body.append('file', blob, 'avatar.jpg');
    fetch(`${apiUrl}/api/v1/fighters/me/photo`, {
      method: 'POST',
      credentials: 'include',
      body,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('photo');
        const { url } = (await response.json()) as { url: string };
        setForm((current) => ({ ...current, photoUrl: url }));
        setDashboard((current) =>
          current ? { ...current, profile: { ...current.profile, photo_url: url } } : current,
        );
        // Nudge the personal-space shell (sibling, /me-only mount) to refresh its
        // sidebar avatar without a full reload.
        window.dispatchEvent(new CustomEvent('myclash:profile-photo', { detail: { url } }));
        setMessage(t('publicApp.fighterProfile.saveSuccess'));
        closeCropper();
      })
      .catch(() => setError(t('publicApp.fighterProfile.photoError')))
      .finally(() => setPhotoBusy(false));
  };

  const onRemovePhoto = () => {
    setPhotoBusy(true);
    setMessage(null);
    setError(null);
    fetch(`${apiUrl}/api/v1/fighters/me/photo`, {
      method: 'DELETE',
      credentials: 'include',
    })
      .then((response) => {
        if (!response.ok) throw new Error('photo');
        setForm((current) => ({ ...current, photoUrl: '' }));
        setDashboard((current) =>
          current ? { ...current, profile: { ...current.profile, photo_url: null } } : current,
        );
        window.dispatchEvent(new CustomEvent('myclash:profile-photo', { detail: { url: null } }));
      })
      .catch(() => setError(t('publicApp.fighterProfile.photoError')))
      .finally(() => setPhotoBusy(false));
  };

  const save = () => {
    if (!dashboard) return;
    // Convert the locale-formatted DOB back to ISO before PATCH.
    // Empty is fine (DOB optional); non-empty + unparseable surfaces
    // an inline error and aborts before we leak a malformed value.
    let dateOfBirthIso: string | undefined;
    if (form.dateOfBirth.trim()) {
      const parsed = dateFormat.parse(form.dateOfBirth);
      if (!parsed) {
        setError(t('publicApp.fighterProfile.errors.dobFormat'));
        return;
      }
      dateOfBirthIso = parsed;
    }
    // Year the fighter started HEMA. Send null (clear) unless it's a plausible
    // 4-digit year in the DTO's accepted range, to avoid a 400 on partial input.
    const practicingSinceRaw = form.practicingSince.trim();
    const practicingSinceNum = Number(practicingSinceRaw);
    const practicingSinceYear =
      practicingSinceRaw &&
      Number.isInteger(practicingSinceNum) &&
      practicingSinceNum >= 1900 &&
      practicingSinceNum <= 2100
        ? practicingSinceNum
        : null;
    setSaving(true);
    setMessage(null);
    setError(null);
    fetch(`${apiUrl}/api/v1/fighters/me/profile`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fighterId: dashboard.profile.id,
        displayName: form.displayName,
        givenName: form.givenName,
        familyName: form.familyName,
        countryCode: form.nationality || undefined,
        dateOfBirth: dateOfBirthIso,
        bio: form.bio || undefined,
        // null-to-clear for the new identity fields (see project_zod_null_to_clear).
        alias: form.alias.trim() || null,
        websiteUrl: form.websiteUrl.trim() || null,
        instagramUrl: form.instagramUrl.trim() || null,
        youtubeUrl: form.youtubeUrl.trim() || null,
        practicingSinceYear,
        publicVisibility: form.visibility,
        mainClub: form.mainClub ? toClubInput(form.mainClub) : undefined,
        secondaryClubs: form.secondaryClubs.map(toClubInput),
        previousClubs: form.previousClubs.map(toClubInput),
        weapons: selectedWeaponRows,
        // Drop incomplete rows client-side; the DTO enforces the rest.
        medals: form.medals
          .filter((medal) => medal.competition.trim() && medal.weapon && Number(medal.year))
          .map((medal) => ({
            competition: medal.competition.trim(),
            year: Number(medal.year),
            rank: medal.rank,
            weapon: medal.weapon,
          })),
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('save');
        const profile = (await response.json()) as FighterProfile;
        setDashboard((current) => (current ? { ...current, profile } : current));
        setForm(formFromProfile(profile, dateFormat.format));
        setMessage(t('publicApp.fighterProfile.saveSuccess'));
      })
      .catch(() => {
        setError(t('publicApp.fighterProfile.saveError'));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  if (loading) {
    return (
      <Card className="text-sm text-muted">{t('publicApp.fighterProfile.loadingDashboard')}</Card>
    );
  }

  if (error && !dashboard) {
    // No Fighter profile linked yet. If the user has roster registrations on
    // their email, offer to claim one (which links the profile and unlocks the
    // dashboard); otherwise point them to their personal space.
    if (claimable.length > 0) {
      return (
        <Card>
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('publicApp.personalSpace.claimable.title')}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {t('publicApp.personalSpace.claimable.description')}
          </p>
          <ul className="mt-3 space-y-2">
            {claimable.map((person) => (
              <li
                key={person.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
              >
                <span className="min-w-0 text-sm text-foreground">
                  <span className="font-semibold">{person.name}</span>
                  {person.eventName && <span className="text-muted"> — {person.eventName}</span>}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={claiming}
                  onClick={() => claim(person.id)}
                >
                  {t('publicApp.personalSpace.claimable.claim')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      );
    }
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm text-danger">{error}</p>
        <p className="mt-2 text-xs text-muted">{t('publicApp.fighterProfile.accessRequired')}</p>
        <Button asChild variant="secondary" size="sm" className="mt-3">
          <a href="/me">{t('publicApp.fighterProfile.goToPersonalSpace')}</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="lg:col-span-2">
        <InsightCard apiUrl={apiUrl} />
      </div>
      <Card className="order-2 lg:order-none">
        <div className="mb-5 flex items-center gap-4">
          <Avatar
            size="xl"
            name={form.displayName || form.givenName || '?'}
            src={form.photoUrl || undefined}
          />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold text-foreground">
              {form.displayName || form.givenName || form.familyName}
            </p>
            {form.alias && <p className="truncate text-sm italic text-muted">{form.alias}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={onPickFile}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={photoBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {form.photoUrl
                  ? t('publicApp.fighterProfile.photoChange')
                  : t('publicApp.fighterProfile.photoUpload')}
              </Button>
              {form.photoUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={photoBusy}
                  disabled={photoBusy}
                  onClick={onRemovePhoto}
                >
                  {t('publicApp.fighterProfile.photoRemove')}
                </Button>
              )}
            </div>
          </div>
        </div>
        {dashboard?.profile.slug && (
          <div className="mb-4">
            <ShareProfile slug={dashboard.profile.slug} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('publicApp.fighterProfile.displayName')}
            value={form.displayName}
            onChange={(value) => updateField('displayName', value)}
          />
          <Field
            label={t('publicApp.fighterProfile.alias')}
            value={form.alias}
            onChange={(value) => updateField('alias', value)}
            maxLength={100}
            hint={t('publicApp.fighterProfile.aliasHint')}
          />
          <Field
            label={t('publicApp.fighterProfile.nationality')}
            value={form.nationality}
            onChange={(value) => updateField('nationality', value.toUpperCase().slice(0, 2))}
          />
          <Field
            label={t('publicApp.fighterProfile.givenName')}
            value={form.givenName}
            onChange={(value) => updateField('givenName', value)}
          />
          <Field
            label={t('publicApp.fighterProfile.familyName')}
            value={form.familyName}
            onChange={(value) => updateField('familyName', value)}
          />
          <Field
            label={t('publicApp.fighterProfile.dateOfBirth')}
            type="text"
            value={form.dateOfBirth}
            onChange={(value) => updateField('dateOfBirth', value)}
            placeholder={dateFormat.placeholder}
            hint={
              form.dateOfBirth && !dateFormat.parse(form.dateOfBirth)
                ? t('publicApp.fighterProfile.errors.dobFormat')
                : undefined
            }
          />
          <Field
            label={t('publicApp.fighterProfile.practicingSince')}
            type="number"
            value={form.practicingSince}
            onChange={(value) =>
              updateField('practicingSince', value.replace(/[^\d]/g, '').slice(0, 4))
            }
            placeholder={t('publicApp.fighterProfile.practicingSincePlaceholder')}
          />
        </div>

        <label className="mt-3 block text-sm" htmlFor="fighter-profile-bio">
          <span className="text-foreground-secondary">{t('publicApp.fighterProfile.bio')}</span>
          <textarea
            id="fighter-profile-bio"
            aria-label={t('publicApp.fighterProfile.bio')}
            className="mt-1 min-h-28 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            value={form.bio}
            onChange={(event) => updateField('bio', event.target.value)}
          />
        </label>

        <div className="mt-4">
          <h2 className="mb-2 font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('publicApp.fighterProfile.links')}
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label={t('publicApp.fighterProfile.website')}
              type="url"
              value={form.websiteUrl}
              onChange={(value) => updateField('websiteUrl', value)}
              placeholder={t('publicApp.fighterProfile.linkPlaceholder')}
            />
            <Field
              label={t('publicApp.fighterProfile.instagram')}
              type="url"
              value={form.instagramUrl}
              onChange={(value) => updateField('instagramUrl', value)}
              placeholder={t('publicApp.fighterProfile.linkPlaceholder')}
            />
            <Field
              label={t('publicApp.fighterProfile.youtube')}
              type="url"
              value={form.youtubeUrl}
              onChange={(value) => updateField('youtubeUrl', value)}
              placeholder={t('publicApp.fighterProfile.linkPlaceholder')}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <ClubField label={t('publicApp.fighterProfile.mainClub')}>
            <ClubCombobox
              value={form.mainClub}
              onChange={(value) => setForm((current) => ({ ...current, mainClub: value }))}
              searchClubs={searchClubs}
              placeholder={t('publicApp.fighterProfile.clubSearchPlaceholder')}
              createLabel={(q) => t('publicApp.fighterProfile.clubCreate', { name: q })}
              noMatchLabel={t('publicApp.fighterProfile.clubNoMatch')}
              clearLabel={t('publicApp.fighterProfile.clubClear')}
              aria-label={t('publicApp.fighterProfile.mainClub')}
            />
          </ClubField>
          <ClubField
            label={t('publicApp.fighterProfile.secondaryClubs')}
            hint={t('publicApp.fighterProfile.clubMultiHelp')}
          >
            <ClubMultiField
              values={form.secondaryClubs}
              onChange={(values) => setForm((current) => ({ ...current, secondaryClubs: values }))}
              searchClubs={searchClubs}
              t={t}
            />
          </ClubField>
          <ClubField
            label={t('publicApp.fighterProfile.previousClubs')}
            hint={t('publicApp.fighterProfile.clubMultiHelp')}
          >
            <ClubMultiField
              values={form.previousClubs}
              onChange={(values) => setForm((current) => ({ ...current, previousClubs: values }))}
              searchClubs={searchClubs}
              t={t}
            />
          </ClubField>
        </div>

        <div className="mt-4">
          <h2 className="mb-2 font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('publicApp.fighterProfile.weapons')}
          </h2>
          <p className="mb-2 text-xs text-muted">{t('publicApp.fighterProfile.weaponsHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {weapons.map((weapon) => {
              const entry = form.selectedWeapons[weapon.id];
              return (
                <WeaponCard
                  key={weapon.id}
                  name={weapon.name}
                  selected={Boolean(entry)}
                  favorite={Boolean(entry?.favorite)}
                  level={entry?.level ?? null}
                  style={entry?.style ?? ''}
                  onToggle={() => toggleWeapon(weapon)}
                  onToggleFavorite={() => toggleFavorite(weapon)}
                  onLevelChange={(level) => setWeaponLevel(weapon, level)}
                  onStyleChange={(style) => setWeaponStyle(weapon, style)}
                  t={t}
                />
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <h2 className="mb-2 font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('publicApp.fighterProfile.medalsImportTitle')}
          </h2>
          <p className="mb-2 text-xs text-muted">
            {t('publicApp.fighterProfile.medalsImportHint')}
          </p>
          <div className="space-y-2">
            {form.medals.map((medal, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-lg border border-border bg-background px-3 py-2 sm:grid-cols-[1fr_6rem_8rem_1fr_auto] sm:items-end"
              >
                <label className="block text-xs">
                  <span className="text-foreground-secondary">
                    {t('publicApp.fighterProfile.medalCompetition')}
                  </span>
                  <input
                    type="text"
                    aria-label={t('publicApp.fighterProfile.medalCompetition')}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    value={medal.competition}
                    onChange={(event) => updateMedal(index, { competition: event.target.value })}
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-foreground-secondary">
                    {t('publicApp.fighterProfile.medalYear')}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label={t('publicApp.fighterProfile.medalYear')}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    value={medal.year}
                    onChange={(event) => updateMedal(index, { year: event.target.value })}
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-foreground-secondary">
                    {t('publicApp.fighterProfile.medalRank')}
                  </span>
                  <select
                    aria-label={t('publicApp.fighterProfile.medalRank')}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    value={medal.rank}
                    onChange={(event) =>
                      updateMedal(index, { rank: Number(event.target.value) as 1 | 2 | 3 })
                    }
                  >
                    <option value={1}>{t('publicApp.fighterProfile.medalRankGold')}</option>
                    <option value={2}>{t('publicApp.fighterProfile.medalRankSilver')}</option>
                    <option value={3}>{t('publicApp.fighterProfile.medalRankBronze')}</option>
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="text-foreground-secondary">
                    {t('publicApp.fighterProfile.medalWeaponLabel')}
                  </span>
                  <select
                    aria-label={t('publicApp.fighterProfile.medalWeaponLabel')}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    value={medal.weapon}
                    onChange={(event) => updateMedal(index, { weapon: event.target.value })}
                  >
                    <option value="">{t('publicApp.fighterProfile.statsForWeapon')}</option>
                    {weapons.map((weapon) => (
                      <option key={weapon.id} value={weapon.name}>
                        {weapon.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => removeMedal(index)}
                  className="justify-self-start text-xs font-semibold text-danger hover:underline sm:pb-2 sm:justify-self-auto"
                >
                  {t('publicApp.fighterProfile.medalRemove')}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addMedal}
            className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:text-foreground"
          >
            {t('publicApp.fighterProfile.medalAdd')}
          </button>
        </div>

        <div className="mt-4">
          <h2 className="mb-1 font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('publicApp.fighterProfile.visibilityTitle')}
          </h2>
          <p className="mb-2 text-xs text-muted">{t('publicApp.fighterProfile.visibilityHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { key: 'alias', label: t('publicApp.fighterProfile.alias') },
              { key: 'bio', label: t('publicApp.fighterProfile.bio') },
              { key: 'links', label: t('publicApp.fighterProfile.links') },
              { key: 'practicingSince', label: t('publicApp.fighterProfile.practicingSince') },
            ].map(({ key, label }) => {
              const visible = form.visibility[key] ?? true;
              return (
                <label
                  key={key}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => toggleVisibility(key, visible)}
                    className="h-4 w-4 accent-accent"
                    aria-label={label}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {visible
                      ? t('publicApp.fighterProfile.visibilityPublic')
                      : t('publicApp.fighterProfile.visibilityHidden')}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button variant="primary" onClick={save} loading={saving} disabled={saving}>
            {t('actions.save')}
          </Button>
          {message && <p className="text-sm text-success">{message}</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </Card>

      {dashboard && (
        <FighterStatsCard dashboard={dashboard} t={t} className="order-1 lg:order-none" />
      )}

      {cropImageSrc && (
        <AvatarCropper
          imageSrc={cropImageSrc}
          busy={photoBusy}
          onCancel={closeCropper}
          onSave={onCropSave}
          t={t}
        />
      )}
    </div>
  );
}

/** Label + hint wrapper around a club control (combobox or multi-combobox). */
function ClubField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="block text-sm">
      <span className="text-foreground-secondary">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  );
}

/** A list of clubs as stacked ClubComboboxes (clearing a row removes it); the
 *  trailing empty combobox appends a new club when picked/created. */
function ClubMultiField({
  values,
  onChange,
  searchClubs,
  t,
}: {
  values: ClubValue[];
  onChange: (values: ClubValue[]) => void;
  searchClubs: (query: string) => Promise<ClubOption[]>;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const comboProps = {
    searchClubs,
    placeholder: t('publicApp.fighterProfile.clubSearchPlaceholder'),
    createLabel: (q: string) => t('publicApp.fighterProfile.clubCreate', { name: q }),
    noMatchLabel: t('publicApp.fighterProfile.clubNoMatch'),
    clearLabel: t('publicApp.fighterProfile.clubClear'),
  };
  return (
    <div className="flex flex-col gap-2">
      {values.map((value, index) => (
        <ClubCombobox
          key={value.clubId ?? `name-${index}`}
          value={value}
          onChange={(next) => {
            const list = values.slice();
            if (next === null) list.splice(index, 1);
            else list[index] = next;
            onChange(list);
          }}
          aria-label={t('publicApp.fighterProfile.clubRowLabel', { index: index + 1 })}
          {...comboProps}
        />
      ))}
      <ClubCombobox
        key={`add-${values.length}`}
        value={null}
        onChange={(next) => {
          if (next) onChange([...values, next]);
        }}
        aria-label={t('publicApp.fighterProfile.clubAdd')}
        {...comboProps}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const inputId = useId();
  return (
    <label className="block text-sm" htmlFor={inputId}>
      <span className="text-foreground-secondary">{label}</span>
      <input
        id={inputId}
        type={type}
        aria-label={label}
        placeholder={placeholder}
        maxLength={maxLength}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function DashboardStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <p className="text-[11px] uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/** Stable per-event key — must match the server's `eventKeyOf` (fighter-career.ts)
 *  so event-picker keys line up with placements. Falls back to the event name. */
function eventKeyOf(eventId: string, eventName: string): string {
  return eventId || `name:${eventName || 'unknown'}`;
}

type TFn = (key: string, values?: Record<string, string | number>) => string;

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.98l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.95z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

/** One weapon in the picker: tap the card to (de)select it, tap the star to
 *  favourite it, and pick a self-rated level once selected. */
function WeaponCard({
  name,
  selected,
  favorite,
  level,
  style,
  onToggle,
  onToggleFavorite,
  onLevelChange,
  onStyleChange,
  t,
}: {
  name: string;
  selected: boolean;
  favorite: boolean;
  level: WeaponLevel | null;
  style: string;
  onToggle: () => void;
  onToggleFavorite: () => void;
  onLevelChange: (level: WeaponLevel | null) => void;
  onStyleChange: (style: string) => void;
  t: TFn;
}) {
  const levelId = useId();
  const styleId = useId();
  const styleListId = useId();
  return (
    <div
      className={[
        'rounded-lg border px-3 py-2 transition-colors',
        selected ? 'border-accent bg-accent/5' : 'border-border bg-background',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          aria-label={name}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground [touch-action:manipulation]"
        >
          <span
            aria-hidden
            className={[
              'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
              selected
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border text-transparent',
            ].join(' ')}
          >
            <CheckIcon />
          </span>
          <span className="min-w-0 truncate">{name}</span>
        </button>
        <button
          type="button"
          onClick={onToggleFavorite}
          disabled={!selected}
          aria-pressed={favorite}
          aria-label={`${name} — ${t('publicApp.fighterProfile.favorite')}`}
          className={[
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition-colors [touch-action:manipulation]',
            'disabled:opacity-30 enabled:hover:text-accent',
            favorite ? 'text-accent' : 'text-muted',
          ].join(' ')}
        >
          <StarIcon filled={favorite} />
        </button>
      </div>
      {selected && (
        <label htmlFor={levelId} className="mt-2 flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">{t('publicApp.fighterProfile.weaponLevel')}</span>
          <select
            id={levelId}
            value={level ?? ''}
            onChange={(event) => onLevelChange((event.target.value || null) as WeaponLevel | null)}
            className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent [touch-action:manipulation]"
          >
            <option value="">{t('publicApp.fighterProfile.levelUnset')}</option>
            <option value="just_for_fun">{t('publicApp.fighterProfile.levelJustForFun')}</option>
            <option value="beginner">{t('publicApp.fighterProfile.levelBeginner')}</option>
            <option value="intermediate">{t('publicApp.fighterProfile.levelIntermediate')}</option>
            <option value="advanced">{t('publicApp.fighterProfile.levelAdvanced')}</option>
          </select>
        </label>
      )}
      {selected && (
        <label htmlFor={styleId} className="mt-2 flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">{t('publicApp.fighterProfile.weaponStyle')}</span>
          <input
            id={styleId}
            type="text"
            list={styleListId}
            value={style}
            maxLength={100}
            placeholder={t('publicApp.fighterProfile.weaponStylePlaceholder')}
            onChange={(event) => onStyleChange(event.target.value)}
            className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent [touch-action:manipulation]"
          />
          <datalist id={styleListId}>
            {HEMA_STYLE_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </label>
      )}
    </div>
  );
}

/** Tokenized chip styling for a recent-form result (win/loss/draw). */
function formChipClass(outcome: 'win' | 'loss' | 'draw'): string {
  const base = 'inline-flex h-6 w-6 items-center justify-center rounded text-xs font-bold';
  if (outcome === 'win') return `${base} bg-success/15 text-success`;
  if (outcome === 'loss') return `${base} bg-danger/15 text-danger`;
  return `${base} bg-foreground/10 text-muted`;
}

/** Career statistics card with a Global / per-weapon dropdown. The combat tiles
 *  shift with the selected weapon; the lower block holds weapon-independent
 *  career totals. HEMA rank only appears on a weapon with a matching rating. */
function FighterStatsCard({
  dashboard,
  t,
  className,
}: {
  dashboard: DashboardResponse;
  t: TFn;
  className?: string;
}) {
  const career = dashboard.career;
  const fought = career.stats.byWeapon.filter((weapon) => weapon.matches > 0);
  const byEvent = career.stats.byEvent ?? [];
  const penaltyList = career.penalties;
  const manualMedals = dashboard.profile.medals ?? [];
  const [statTab, setStatTab] = useState<string>('global'); // weapon scope
  const [eventTab, setEventTab] = useState<string>('global'); // event scope

  // Weapon filter options: the union of weapons the fighter actually fought and
  // weapons they only have imported medals for, deduped by normalized key. The
  // option value is the key; the label is the first display name we saw.
  const weaponOptions = (() => {
    const byKey = new Map<string, string>();
    for (const weapon of fought) {
      const key = weaponKey(weapon.weapon);
      if (key && !byKey.has(key)) byKey.set(key, weapon.weapon);
    }
    for (const medal of manualMedals) {
      const key = weaponKey(medal.weapon);
      if (key && !byKey.has(key)) byKey.set(key, medal.weapon);
    }
    return [...byKey.entries()].map(([key, label]) => ({ key, label }));
  })();

  // Event filter options: every event the fighter fought a completed match in,
  // unioned with events they only received a card in (no completed match).
  const eventOptions = (() => {
    const byKey = new Map<string, string>();
    for (const bucket of byEvent) {
      if (bucket.matches > 0 && !byKey.has(bucket.eventKey))
        byKey.set(bucket.eventKey, bucket.eventName);
    }
    for (const penalty of penaltyList ?? []) {
      if (!byKey.has(penalty.eventKey)) byKey.set(penalty.eventKey, penalty.eventName);
    }
    return [...byKey.entries()].map(([key, label]) => ({ key, label: label || key }));
  })();

  const inEvent = (evKey: string) => eventTab === 'global' || evKey === eventTab;
  const inWeapon = (weapon: string | null | undefined) =>
    statTab === 'global' || (weapon != null && weaponKey(weapon) === statTab);

  // Combat tiles: sum the raw per-(event × weapon) buckets matching the current
  // scope, then derive the rates (mirrors the server's finalizeStats). A weapon
  // with only imported medals has no bucket → naturally reads as zero.
  const active: WeaponStat = (() => {
    const acc = { matches: 0, wins: 0, losses: 0, doubleHits: 0, exchanges: 0 };
    for (const bucket of byEvent) {
      if (!inEvent(bucket.eventKey) || !inWeapon(bucket.weapon)) continue;
      acc.matches += bucket.matches;
      acc.wins += bucket.wins;
      acc.losses += bucket.losses;
      acc.doubleHits += bucket.doubleHits;
      acc.exchanges += bucket.exchanges;
    }
    return {
      ...acc,
      winLossRatio: acc.losses === 0 ? (acc.wins > 0 ? acc.wins : null) : acc.wins / acc.losses,
      doubleHitPercentage:
        acc.exchanges === 0 ? 0 : Math.round((acc.doubleHits / acc.exchanges) * 10000) / 100,
    };
  })();

  // Received penalty cards, scoped to the selected event + weapon: color counts
  // + top-3 reason categories (see the Penalties section below).
  const scopedPenalties = (penaltyList ?? []).filter(
    (penalty) => inEvent(penalty.eventKey) && inWeapon(penalty.weapon),
  );
  const penaltyCounts = { yellow: 0, red: 0, black: 0 };
  for (const penalty of scopedPenalties) {
    if (penalty.card === 'yellow' || penalty.card === 'red' || penalty.card === 'black')
      penaltyCounts[penalty.card] += 1;
  }
  const topReasons = (() => {
    const counts = new Map<string, number>();
    for (const penalty of scopedPenalties) {
      const key = penalty.category?.trim() || t('common.unknown');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([category, count]) => ({ category, count }));
  })();
  // The whole penalty section shows only when there are cards in the current
  // scope (the field itself is present only on the private `/me` path).
  const hasPenalties = scopedPenalties.length > 0;

  // Podium placements + imported medals, scoped to the selected event + weapon.
  // Only count tournaments we could actually rank (a decided bracket or pool).
  // Imported medals have no in-app event → shown only in the global-event view.
  const placements = career.tournamentPlacements.filter(
    (placement) =>
      placement.place != null &&
      inEvent(eventKeyOf(placement.eventId, placement.eventName)) &&
      (statTab === 'global' ||
        (placement.weapon != null && weaponKey(placement.weapon) === statTab)),
  );
  const scopedManual =
    eventTab !== 'global'
      ? []
      : statTab === 'global'
        ? manualMedals
        : manualMedals.filter((medal) => weaponKey(medal.weapon) === statTab);
  const medals = {
    gold:
      placements.filter((placement) => placement.place === 1).length +
      scopedManual.filter((medal) => medal.rank === 1).length,
    silver:
      placements.filter((placement) => placement.place === 2).length +
      scopedManual.filter((medal) => medal.rank === 2).length,
    bronze:
      placements.filter((placement) => placement.place === 3).length +
      scopedManual.filter((medal) => medal.rank === 3).length,
  };

  const hema =
    statTab === 'global' ? null : matchHemaRating(statTab, dashboard.hemaRatings?.ratings ?? []);

  const timeline = (career.stats.byYear ?? [])
    .filter((year) => year.year !== 'unknown' && year.matches > 0)
    .sort((a, b) => b.year.localeCompare(a.year));
  const streak = career.currentStreak;
  const showInsights = career.recentForm.length > 0 || timeline.length > 0;

  const winRate =
    active.matches === 0 ? '—' : `${Math.round((active.wins / active.matches) * 100)}%`;
  const ratio = active.winLossRatio == null ? '—' : active.winLossRatio.toFixed(2);

  const years = (career.eventParticipation ?? [])
    .map((event) => event.startDate?.slice(0, 4))
    .filter((year): year is string => Boolean(year));
  const activeSince = years.length ? years.reduce((a, b) => (a < b ? a : b)) : null;

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-accent">
          {t('publicApp.fighterProfile.stats')}
        </h2>
        {dashboard.hemaRatings?.detailsUrl && (
          <a
            href={dashboard.hemaRatings.detailsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-accent hover:underline"
          >
            {t('publicApp.fighterProfile.hemaProfileLink')} ↗
          </a>
        )}
      </div>

      {(eventOptions.length > 0 || weaponOptions.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* Global resets BOTH scopes; the event + weapon selects narrow every
              tile below (combat, medals, and penalties), like the referee card. */}
          <button
            type="button"
            onClick={() => {
              setEventTab('global');
              setStatTab('global');
            }}
            aria-pressed={eventTab === 'global' && statTab === 'global'}
            className={[
              'min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors [touch-action:manipulation]',
              eventTab === 'global' && statTab === 'global'
                ? 'bg-accent text-accent-foreground'
                : 'border border-border text-muted hover:text-foreground',
            ].join(' ')}
          >
            {t('publicApp.fighterProfile.statsGlobalTab')}
          </button>
          {eventOptions.length > 0 && (
            <select
              aria-label={t('publicApp.fighterProfile.statsForEvent')}
              value={eventTab === 'global' ? '' : eventTab}
              onChange={(event) => setEventTab(event.target.value || 'global')}
              className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent [touch-action:manipulation]"
            >
              <option value="">{t('publicApp.fighterProfile.statsForEvent')}</option>
              {eventOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
          {weaponOptions.length > 0 && (
            <select
              aria-label={t('publicApp.fighterProfile.statsForWeapon')}
              value={statTab === 'global' ? '' : statTab}
              onChange={(event) => setStatTab(event.target.value || 'global')}
              className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent [touch-action:manipulation]"
            >
              <option value="">{t('publicApp.fighterProfile.statsForWeapon')}</option>
              {weaponOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 rounded-lg border border-border bg-background px-3 py-3">
          <p className="text-[11px] uppercase tracking-widest text-muted">
            {t('publicApp.fighterProfile.medals')}
          </p>
          <div className="mt-1 flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="text-lg leading-none">
                🥇
              </span>
              <span className="text-xl font-black tabular-nums text-foreground">{medals.gold}</span>
              <span className="sr-only">{t('publicApp.fighterProfile.medalsGold')}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="text-lg leading-none">
                🥈
              </span>
              <span className="text-xl font-black tabular-nums text-foreground">
                {medals.silver}
              </span>
              <span className="sr-only">{t('publicApp.fighterProfile.medalsSilver')}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="text-lg leading-none">
                🥉
              </span>
              <span className="text-xl font-black tabular-nums text-foreground">
                {medals.bronze}
              </span>
              <span className="sr-only">{t('publicApp.fighterProfile.medalsBronze')}</span>
            </span>
          </div>
        </div>
        <DashboardStat label={t('publicApp.fighterProfile.matches')} value={active.matches} />
        <DashboardStat label={t('publicApp.fighterProfile.totalWins')} value={active.wins} />
        <DashboardStat label={t('publicApp.fighterProfile.totalLosses')} value={active.losses} />
        <DashboardStat label={t('publicApp.fighterProfile.winRate')} value={winRate} />
        <DashboardStat label={t('publicApp.fighterProfile.winLossRatio')} value={ratio} />
        <DashboardStat
          label={t('publicApp.fighterProfile.doubleHitPercentage')}
          value={`${active.doubleHitPercentage.toFixed(2)}%`}
        />
        <DashboardStat label={t('publicApp.fighterProfile.doubleHits')} value={active.doubleHits} />
        <DashboardStat label={t('publicApp.fighterProfile.exchanges')} value={active.exchanges} />
        {statTab !== 'global' && (
          <div className="col-span-2 rounded-lg border border-border bg-background px-3 py-3">
            <p className="text-[11px] uppercase tracking-widest text-muted">
              {t('publicApp.fighterProfile.hemaRank')}
            </p>
            {hema != null ? (
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-xl font-black tabular-nums text-foreground">
                  {hema.rank != null ? `#${hema.rank}` : '—'}
                </span>
                <span className="text-sm text-muted">
                  {t('publicApp.fighterProfile.hemaRatingValue', {
                    rating: Math.round(hema.weightedRating),
                  })}
                </span>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted">
                {dashboard.hemaRatings == null
                  ? t('publicApp.fighterProfile.hemaNotLinked')
                  : t('publicApp.fighterProfile.hemaNoWeaponRating')}
              </p>
            )}
          </div>
        )}
      </div>

      {hasPenalties && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.fighterProfile.penaltiesReceived')}
          </h3>
          {/* Card-colour counts — emoji glyphs (like the medals tile) rather than
              raw colour classes, so it stays within the tokenized palette. */}
          <div className="rounded-lg border border-border bg-background px-3 py-3">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="text-lg leading-none">
                  🟨
                </span>
                <span className="text-xl font-black tabular-nums text-foreground">
                  {penaltyCounts.yellow}
                </span>
                <span className="sr-only">{t('publicApp.fighterProfile.penaltyYellow')}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="text-lg leading-none">
                  🟥
                </span>
                <span className="text-xl font-black tabular-nums text-foreground">
                  {penaltyCounts.red}
                </span>
                <span className="sr-only">{t('publicApp.fighterProfile.penaltyRed')}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="text-lg leading-none">
                  ⬛
                </span>
                <span className="text-xl font-black tabular-nums text-foreground">
                  {penaltyCounts.black}
                </span>
                <span className="sr-only">{t('publicApp.fighterProfile.penaltyBlack')}</span>
              </span>
            </div>
          </div>

          {topReasons.length > 0 && (
            <>
              <p className="mb-2 mt-3 text-[11px] uppercase tracking-widest text-muted">
                {t('publicApp.fighterProfile.topPenalties')}
              </p>
              <ul className="space-y-1.5">
                {topReasons.map((reason, index) => (
                  <li
                    key={`${reason.category}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {reason.category}
                    </span>
                    <span className="flex-shrink-0 text-sm font-black tabular-nums text-foreground">
                      {reason.count}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4">
        <DashboardStat
          label={t('publicApp.fighterProfile.eventsAttended')}
          value={career.eventParticipation.length}
        />
        <DashboardStat
          label={t('publicApp.fighterProfile.tournamentsAttended')}
          value={career.tournamentsAttended}
        />
        {career.upcoming.length > 0 && (
          <DashboardStat
            label={t('publicApp.fighterProfile.upcoming')}
            value={career.upcoming.length}
          />
        )}
        {activeSince && (
          <DashboardStat label={t('publicApp.fighterProfile.activeSince')} value={activeSince} />
        )}
        {career.leagueRankings.map((league, index) => (
          <Link
            key={`${league.leagueName}-${index}`}
            href={`/me/leagues/${league.leagueSlug}`}
            className="block rounded-lg transition-opacity hover:opacity-80"
          >
            <DashboardStat
              label={league.leagueName}
              value={t('publicApp.fighterProfile.leagueValue', {
                rank: league.rank,
                points: league.totalPoints,
              })}
            />
          </Link>
        ))}
      </div>

      {(placements.length > 0 || scopedManual.length > 0) && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.fighterProfile.resultsTitle')}
          </h3>
          <ul className="space-y-1.5">
            {placements.map((placement) => (
              <li key={placement.tournamentId}>
                <a
                  href={`/e/${placement.eventSlug}/t/${placement.tournamentSlug}#finalranking`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 hover:bg-foreground/5"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {medalGlyph(placement.place) && (
                      <span aria-hidden className="text-base leading-none">
                        {medalGlyph(placement.place)}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {placement.tournamentName}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {[placement.eventName, placement.weapon, placement.date?.slice(0, 4)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-right">
                    <span className="block text-sm font-bold text-foreground">
                      {placeHeadline(placement.place, t)}
                    </span>
                    {placement.totalRanked != null && (
                      <span className="block text-xs text-muted">
                        {t('publicApp.fighterProfile.resultOfTotal', {
                          total: placement.totalRanked,
                        })}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            ))}
            {scopedManual.map((medal, index) => (
              <li key={`manual-${medal.year}-${medal.competition}-${index}`}>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {medalGlyph(medal.rank) && (
                      <span aria-hidden className="text-base leading-none">
                        {medalGlyph(medal.rank)}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {medal.competition}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {[medal.weapon, medal.year].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-right">
                    <span className="block text-sm font-bold text-foreground">
                      {placeHeadline(medal.rank, t)}
                    </span>
                    <span className="block text-xs text-muted">
                      {t('publicApp.fighterProfile.medalImportedTag')}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showInsights && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.fighterProfile.insightsTitle')}
          </h3>

          {streak.kind !== 'none' && streak.count > 1 && (
            <p className="mb-2 text-xs font-semibold text-muted">
              {t(
                streak.kind === 'win'
                  ? 'publicApp.fighterProfile.streakWin'
                  : 'publicApp.fighterProfile.streakLoss',
                { count: streak.count },
              )}
            </p>
          )}

          {career.recentForm.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold text-muted">
                {t('publicApp.fighterProfile.recentForm')}
              </p>
              <div className="flex flex-wrap gap-1">
                {career.recentForm.map((formMatch) => (
                  <span
                    key={formMatch.matchId}
                    className={formChipClass(formMatch.outcome)}
                    title={`${formMatch.ourScore}-${formMatch.opponentScore}`}
                  >
                    {formMatch.outcome === 'win'
                      ? t('publicApp.fighterProfile.formWinShort')
                      : formMatch.outcome === 'loss'
                        ? t('publicApp.fighterProfile.formLossShort')
                        : t('publicApp.fighterProfile.formDrawShort')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {timeline.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">
                {t('publicApp.fighterProfile.timeline')}
              </p>
              <ul className="space-y-1">
                {timeline.map((year) => (
                  <li key={year.year} className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">{year.year}</span>
                    <span className="text-muted">
                      {t('publicApp.fighterProfile.timelineRecord', {
                        wins: year.wins,
                        losses: year.losses,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
