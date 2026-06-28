'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { getDateFormat } from '@myclash/types';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface ClubLink {
  role?: string;
  clubs?: { name?: string | null } | null;
}

interface WeaponLink {
  favorite?: boolean;
  weapon_catalog?: { id?: string; name?: string | null } | null;
}

interface WeaponCatalogEntry {
  id: string;
  name: string;
}

interface FighterProfile {
  id: string;
  display_name?: string;
  given_name?: string;
  family_name?: string;
  country_code?: string | null;
  dateOfBirth?: string | null;
  bio?: string | null;
  photo_url?: string | null;
  clubs?: ClubLink[];
  weapons?: WeaponLink[];
}

interface DashboardResponse {
  profile: FighterProfile;
  career: {
    stats: {
      overall: {
        wins: number;
        losses: number;
        doubleHitPercentage: number;
        matches: number;
      };
    };
  };
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

interface FormState {
  displayName: string;
  givenName: string;
  familyName: string;
  nationality: string;
  dateOfBirth: string;
  bio: string;
  photoUrl: string;
  mainClub: string;
  secondaryClubs: string;
  previousClubs: string;
  selectedWeapons: Record<string, { name: string; favorite: boolean }>;
}

const emptyForm: FormState = {
  displayName: '',
  givenName: '',
  familyName: '',
  nationality: '',
  dateOfBirth: '',
  bio: '',
  photoUrl: '',
  mainClub: '',
  secondaryClubs: '',
  previousClubs: '',
  selectedWeapons: {},
};

function clubsByRole(clubs: ClubLink[] | undefined, role: string): string {
  return (clubs ?? [])
    .filter((club) => club.role === role)
    .map((club) => club.clubs?.name)
    .filter((name): name is string => Boolean(name))
    .join(', ');
}

function splitNames(value: string): Array<{ clubName: string }> {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((clubName) => ({ clubName }));
}

function formFromProfile(profile: FighterProfile, formatDob: (iso: string) => string): FormState {
  const selectedWeapons: FormState['selectedWeapons'] = {};
  for (const weapon of profile.weapons ?? []) {
    const id = weapon.weapon_catalog?.id;
    const name = weapon.weapon_catalog?.name;
    if (!id || !name) continue;
    selectedWeapons[id] = { name, favorite: Boolean(weapon.favorite) };
  }

  return {
    displayName: profile.display_name ?? '',
    givenName: profile.given_name ?? '',
    familyName: profile.family_name ?? '',
    nationality: profile.country_code ?? '',
    dateOfBirth: formatDob(profile.dateOfBirth ?? ''),
    bio: profile.bio ?? '',
    photoUrl: profile.photo_url ?? '',
    mainClub: clubsByRole(profile.clubs, 'main'),
    secondaryClubs: clubsByRole(profile.clubs, 'secondary'),
    previousClubs: clubsByRole(profile.clubs, 'previous'),
    selectedWeapons,
  };
}

function formatDuration(
  ms: number,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (ms <= 0) return t('common.none');
  return t('publicApp.fighterProfile.minutes', { count: Math.round(ms / 60000) });
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
  // Roster registrations matching the logged-in user's email but not yet
  // claimed — surfaced as a confirm-to-claim step instead of dead-ending when
  // no Fighter profile is linked yet.
  const [claimable, setClaimable] = useState<
    Array<{ id: string; name: string; eventName: string }>
  >([]);
  const [claiming, setClaiming] = useState(false);

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
      else selectedWeapons[weapon.id] = { name: weapon.name, favorite: false };
      return { ...current, selectedWeapons };
    });
  };

  const toggleFavorite = (weapon: WeaponCatalogEntry) => {
    setForm((current) => ({
      ...current,
      selectedWeapons: {
        ...current.selectedWeapons,
        [weapon.id]: {
          name: weapon.name,
          favorite: !current.selectedWeapons[weapon.id]?.favorite,
        },
      },
    }));
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
        photoUrl: form.photoUrl || undefined,
        mainClub: form.mainClub ? { clubName: form.mainClub } : undefined,
        secondaryClubs: splitNames(form.secondaryClubs),
        previousClubs: splitNames(form.previousClubs),
        weapons: selectedWeaponRows,
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
      <section className="rounded-xl border border-gray-800 bg-gray-950 p-4 text-sm text-gray-400">
        {t('publicApp.fighterProfile.loadingDashboard')}
      </section>
    );
  }

  if (error && !dashboard) {
    // No Fighter profile linked yet. If the user has roster registrations on
    // their email, offer to claim one (which links the profile and unlocks the
    // dashboard); otherwise point them to their personal space.
    if (claimable.length > 0) {
      return (
        <section className="rounded-xl border border-gray-800 bg-gray-950 p-4">
          <h2 className="font-display font-semibold text-lg sm:text-xl text-gray-100">
            {t('publicApp.personalSpace.claimable.title')}
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            {t('publicApp.personalSpace.claimable.description')}
          </p>
          <ul className="mt-3 space-y-2">
            {claimable.map((person) => (
              <li
                key={person.id}
                className="flex items-center justify-between gap-3 rounded-md border border-gray-800 bg-gray-900 px-3 py-2"
              >
                <span className="min-w-0 text-sm text-gray-100">
                  <span className="font-semibold">{person.name}</span>
                  {person.eventName && <span className="text-gray-400"> — {person.eventName}</span>}
                </span>
                <button
                  type="button"
                  disabled={claiming}
                  onClick={() => claim(person.id)}
                  className="shrink-0 rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-60"
                >
                  {t('publicApp.personalSpace.claimable.claim')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      );
    }
    return (
      <section className="rounded-xl border border-red-900 bg-red-950/30 p-4">
        <p className="text-sm text-red-200">{error}</p>
        <p className="mt-2 text-xs text-gray-400">{t('publicApp.fighterProfile.accessRequired')}</p>
        <a
          href="/me"
          className="mt-3 inline-block rounded-md border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
        >
          {t('publicApp.fighterProfile.goToPersonalSpace')}
        </a>
      </section>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <section className="rounded-xl border border-gray-800 bg-gray-950 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('publicApp.fighterProfile.displayName')}
            value={form.displayName}
            onChange={(value) => updateField('displayName', value)}
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
            label={t('publicApp.fighterProfile.photoUrl')}
            value={form.photoUrl}
            onChange={(value) => updateField('photoUrl', value)}
          />
        </div>

        <label className="mt-3 block text-sm" htmlFor="fighter-profile-bio">
          <span className="text-gray-300">{t('publicApp.fighterProfile.bio')}</span>
          <textarea
            id="fighter-profile-bio"
            aria-label={t('publicApp.fighterProfile.bio')}
            className="mt-1 min-h-28 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-amber-500"
            value={form.bio}
            onChange={(event) => updateField('bio', event.target.value)}
          />
        </label>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field
            label={t('publicApp.fighterProfile.mainClub')}
            value={form.mainClub}
            onChange={(value) => updateField('mainClub', value)}
          />
          <Field
            label={t('publicApp.fighterProfile.secondaryClubs')}
            value={form.secondaryClubs}
            hint={t('publicApp.fighterProfile.clubNamesHelp')}
            onChange={(value) => updateField('secondaryClubs', value)}
          />
          <Field
            label={t('publicApp.fighterProfile.previousClubs')}
            value={form.previousClubs}
            hint={t('publicApp.fighterProfile.clubNamesHelp')}
            onChange={(value) => updateField('previousClubs', value)}
          />
        </div>

        <div className="mt-4">
          <h2 className="mb-2 font-display font-semibold text-lg sm:text-xl text-white">
            {t('publicApp.fighterProfile.weapons')}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {weapons.map((weapon) => {
              const selected = Boolean(form.selectedWeapons[weapon.id]);
              const selectedId = `fighter-weapon-${weapon.id}`;
              const favoriteId = `fighter-weapon-favorite-${weapon.id}`;
              return (
                <div
                  key={weapon.id}
                  className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-3 py-2"
                >
                  <label
                    className="flex items-center gap-2 text-sm text-gray-200"
                    htmlFor={selectedId}
                  >
                    <input
                      id={selectedId}
                      type="checkbox"
                      aria-label={weapon.name}
                      checked={selected}
                      onChange={() => toggleWeapon(weapon)}
                    />
                    {weapon.name}
                  </label>
                  <label
                    className="flex items-center gap-1 text-xs text-gray-400"
                    htmlFor={favoriteId}
                  >
                    <input
                      id={favoriteId}
                      type="checkbox"
                      aria-label={`${weapon.name} ${t('publicApp.fighterProfile.favorite')}`}
                      checked={Boolean(form.selectedWeapons[weapon.id]?.favorite)}
                      disabled={!selected}
                      onChange={() => toggleFavorite(weapon)}
                    />
                    {t('publicApp.fighterProfile.favorite')}
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? t('common.loading') : t('actions.save')}
          </button>
          {message && <p className="text-sm text-green-300">{message}</p>}
          {error && <p className="text-sm text-red-300">{error}</p>}
        </div>
      </section>

      {dashboard && (
        <aside className="rounded-xl border border-gray-800 bg-gray-950 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-amber-400">
            {t('publicApp.fighterProfile.stats')}
          </h2>
          <div className="grid gap-2">
            <DashboardStat
              label={t('publicApp.fighterProfile.totalWins')}
              value={dashboard.career.stats.overall.wins}
            />
            <DashboardStat
              label={t('publicApp.fighterProfile.totalLosses')}
              value={dashboard.career.stats.overall.losses}
            />
            <DashboardStat
              label={t('publicApp.fighterProfile.doubleHitPercentage')}
              value={`${dashboard.career.stats.overall.doubleHitPercentage.toFixed(2)}%`}
            />
          </div>
          {dashboard.refereeStats && dashboard.refereeStats.totalMatches > 0 && (
            <div className="mt-5 border-t border-gray-800 pt-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-amber-400">
                {t('publicApp.fighterProfile.refereeing')}
              </h2>
              <div className="grid gap-2">
                <DashboardStat
                  label={t('publicApp.fighterProfile.refereeMatches')}
                  value={dashboard.refereeStats.totalMatches}
                />
                <DashboardStat
                  label={t('publicApp.fighterProfile.averageRefereeTime')}
                  value={formatDuration(dashboard.refereeStats.averageRefereeTimeMs, t)}
                />
                <DashboardStat
                  label={t('publicApp.fighterProfile.yellowCards')}
                  value={dashboard.refereeStats.cards.yellow}
                />
                <DashboardStat
                  label={t('publicApp.fighterProfile.redCards')}
                  value={dashboard.refereeStats.cards.red}
                />
                <DashboardStat
                  label={t('publicApp.fighterProfile.blackCards')}
                  value={dashboard.refereeStats.cards.black}
                />
              </div>
            </div>
          )}
        </aside>
      )}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  placeholder?: string;
}) {
  const inputId = useId();
  return (
    <label className="block text-sm" htmlFor={inputId}>
      <span className="text-gray-300">{label}</span>
      <input
        id={inputId}
        type={type}
        aria-label={label}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-amber-500"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

function DashboardStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-3">
      <p className="text-[11px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-white">{value}</p>
    </div>
  );
}
