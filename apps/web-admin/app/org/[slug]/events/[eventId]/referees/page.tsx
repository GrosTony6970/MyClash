'use client';

/**
 * Referee admin — T-906 (rework)
 * Route: /org/[slug]/events/[eventId]/referees
 *
 * Dynamic skill columns, per-row availability toggles, assignment summary.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { SkillBadge, tintBgClassFor, useToast } from '@myclash/ui';
import { t } from '@myclash/i18n';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RefereeSkill {
  id: string;
  eventId: string | null;
  name: string;
  color: string;
  isSystem: boolean;
  sortOrder: number;
}

interface EventRefereeRow {
  userId: string;
  personId: string | null;
  displayName: string;
  clubLabel: string | null;
  qualifications: Array<{ skillId: string; rating: number | null }>;
  availableAllTournaments: boolean;
  availableAllEventDuration: boolean;
  assignments: Array<{ tournamentId: string; tournamentName: string; matchCount: number }>;
  totalMatchCount: number;
}

// qual id lookup: key = `${personId}:${skillId}` → qualId
type QualIdMap = Map<string, string>;

// ── Sub-components ────────────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(value === star ? null : star)}
          className={[
            'text-lg leading-none transition-colors',
            (value ?? 0) >= star ? 'text-amber-400' : 'text-gray-300',
          ].join(' ')}
          title={t('organizer.refereesPage.ratingTooltip', { star })}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:opacity-50',
        checked ? 'bg-red-600' : 'bg-gray-200',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
          checked ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );
}

// ── Color token list for the skill modal ─────────────────────────────────────

const COLOR_OPTIONS: string[] = [
  'red',
  'blue',
  'green',
  'purple',
  'orange',
  'amber',
  'teal',
  'yellow',
  'violet',
  'slate',
  'gold',
  'silver',
  'bronze',
  'black',
  'white',
];

// ── Skill modal ───────────────────────────────────────────────────────────────

interface SkillModalProps {
  mode: 'add' | 'edit';
  initial?: { name: string; color: string };
  skillId?: string;
  eventId: string;
  apiUrl: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}

function SkillModal({
  mode,
  initial,
  skillId,
  eventId,
  apiUrl,
  onClose,
  onSaved,
  onDeleted,
}: SkillModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? 'blue');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  async function handleSave() {
    if (!name.trim()) {
      setError(t('organizer.refereesPage.skillNameRequired'));
      return;
    }
    setSaving(true);
    setError(null);

    try {
      let res: Response;
      if (mode === 'add') {
        res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-skills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name: name.trim(), color }),
        });
      } else {
        res = await fetch(`${apiUrl}/api/v1/referee-skills/${skillId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name: name.trim(), color }),
        });
      }

      if (!res.ok) {
        setError(t('organizer.refereesPage.skillSaveFailed'));
        return;
      }

      onSaved();
    } catch {
      setError(t('organizer.refereesPage.skillSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!skillId) return;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/referee-skills/${skillId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.status === 409) {
        // Parse conflict message — format: "Cannot delete skill: N active qualification(s) still reference it"
        let count: number | null = null;
        try {
          const body = (await res.json()) as { message?: string };
          const msg = body.message ?? '';
          const match = /(\d+)\s+active/.exec(msg);
          if (match) count = parseInt(match[1] ?? '0', 10);
        } catch {
          // ignore parse error
        }
        if (count !== null && count > 0) {
          setError(t('organizer.refereesPage.skillDeleteConflict', { count }));
        } else {
          setError(t('organizer.refereesPage.skillDeleteInUse'));
        }
        return;
      }

      if (!res.ok) {
        setError(t('organizer.refereesPage.skillDeleteFailed'));
        return;
      }

      onDeleted?.();
    } catch {
      setError(t('organizer.refereesPage.skillDeleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    /* backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold mb-4">
          {mode === 'add'
            ? t('organizer.refereesPage.addCustomSkill')
            : t('organizer.refereesPage.editSkill')}
        </h2>

        {error && (
          <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('organizer.refereesPage.skillName')}
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              placeholder={t('organizer.refereesPage.skillNamePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('organizer.refereesPage.skillColor')}
            </label>
            <select
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              {COLOR_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
            <div className="mt-1">
              <SkillBadge
                color={color}
                label={name || t('organizer.refereesPage.preview')}
                size="sm"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-6">
          <div>
            {mode === 'edit' && (
              <button
                onClick={() => void handleDelete()}
                disabled={deleting || saving}
                className="text-sm text-red-600 hover:text-red-800 border border-red-200 rounded-lg px-3 py-1.5 disabled:opacity-50"
              >
                {deleting
                  ? t('organizer.refereesPage.deleting')
                  : t('organizer.refereesPage.deleteSkill')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving || deleting}
              className="text-sm text-gray-600 border border-gray-300 rounded-lg px-4 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            >
              {t('organizer.refereesPage.cancel')}
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || deleting || !name.trim()}
              className="text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg px-4 py-1.5 disabled:opacity-50"
            >
              {saving ? t('organizer.refereesPage.saving') : t('organizer.refereesPage.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface GlobalPersonResult {
  id: string;
  given_name: string;
  family_name: string;
  display_name: string;
}

interface PersonResult {
  id: string;
  given_name: string;
  family_name: string;
  club_label: string | null;
}

export default function RefereesPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  // ── Data state ──────────────────────────────────────────────────────────────
  const [skills, setSkills] = useState<RefereeSkill[]>([]);
  const [referees, setReferees] = useState<EventRefereeRow[]>([]);
  const [qualIdMap, setQualIdMap] = useState<QualIdMap>(new Map());
  const [loading, setLoading] = useState(true);
  // Ref (not state) so it does not re-trigger the effect when it flips.
  // Prevents full-table flash on subsequent refetches (refereesKey increments).
  const hasLoadedOnceRef = useRef(false);

  // ── Refresh keys ────────────────────────────────────────────────────────────
  const [skillsKey, setSkillsKey] = useState(0);
  const [refereesKey, setRefereesKey] = useState(0);

  // ── Search state ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<PersonResult[]>([]);

  // ── Saving state ────────────────────────────────────────────────────────────
  const [savingQual, setSavingQual] = useState<string | null>(null);

  // ── Global person link state ────────────────────────────────────────────────
  const [linkingPersonId, setLinkingPersonId] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalResults, setGlobalResults] = useState<GlobalPersonResult[]>([]);

  // ── Skill modal state ───────────────────────────────────────────────────────
  const [skillModal, setSkillModal] = useState<{
    mode: 'add' | 'edit';
    skillId?: string;
    initial?: { name: string; color: string };
  } | null>(null);

  // ── Toast ───────────────────────────────────────────────────────────────────
  const toast = useToast();

  // ── Fetch skills catalog ────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/referee-skills`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as RefereeSkill[];
        setSkills(data);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventId, apiUrl, skillsKey]);

  // ── Fetch referees (enriched) + qual id map ─────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    // Only show the full-page loading skeleton on initial mount.
    // Subsequent refetches (refereesKey increments) keep existing data visible.
    if (!hasLoadedOnceRef.current) setLoading(true);

    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/referees`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/referee-qualifications`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([refRes, qualRes]) => {
        setLoading(false);
        hasLoadedOnceRef.current = true;
        if (!refRes.ok || !qualRes.ok) return;

        const refData = (await refRes.json()) as EventRefereeRow[];
        setReferees(refData);

        // Build qual id map: key = `${personId}:${skillId}` → qualId
        // The old endpoint returns records with personId (as person_id) and role (= skillId)
        const rawQuals = (await qualRes.json()) as Array<{
          id: string;
          personId?: string;
          person_id?: string;
          role: string;
        }>;
        const map = new Map<string, string>();
        for (const q of rawQuals) {
          const pid = q.personId ?? q.person_id;
          if (pid) map.set(`${pid}:${q.role}`, q.id);
        }
        setQualIdMap(map);
      })
      .catch((err: unknown) => {
        setLoading(false);
        hasLoadedOnceRef.current = true;
        if (err instanceof Error && err.name === 'AbortError') return;
      });

    return () => controller.abort();
  }, [eventId, apiUrl, refereesKey]);

  // ── Person search ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (search.trim().length < 2) {
      const timer = setTimeout(() => setSearchResults([]), 0);
      return () => clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/api/v1/events/${eventId}/persons/lookup?q=${encodeURIComponent(search)}`, {
        signal: controller.signal,
        credentials: 'include',
      })
        .then(async (res) => {
          if (res.ok) setSearchResults((await res.json()) as PersonResult[]);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, eventId, apiUrl]);

  // ── Global person search ────────────────────────────────────────────────────

  useEffect(() => {
    if (globalSearch.trim().length < 2) {
      const timer = setTimeout(() => setGlobalResults([]), 0);
      return () => clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/api/v1/global-persons?q=${encodeURIComponent(globalSearch)}&roles=referee`, {
        signal: controller.signal,
        credentials: 'include',
      })
        .then(async (res) => {
          if (res.ok) setGlobalResults((await res.json()) as GlobalPersonResult[]);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [globalSearch, apiUrl]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function addReferee(userId: string) {
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referees/${userId}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.addRefereeFailed'));
      }
    } catch {
      toast.error(t('organizer.refereesPage.addRefereeFailed'));
    }
    setRefereesKey((k) => k + 1);
  }

  async function upsertQualification(personId: string, skillId: string, rating: number | null) {
    setSavingQual(`${personId}-${skillId}`);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-qualifications`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ personId, role: skillId, rating }),
      });
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.qualificationSaveFailed'));
      }
      setRefereesKey((k) => k + 1);
    } catch {
      toast.error(t('organizer.refereesPage.qualificationSaveFailed'));
      setRefereesKey((k) => k + 1);
    } finally {
      setSavingQual(null);
    }
  }

  async function removeQualification(personId: string, skillId: string) {
    // Look up the qual UUID from our local map
    const qualId = qualIdMap.get(`${personId}:${skillId}`);
    if (!qualId) {
      // Fallback: refetch in case id map is stale
      setRefereesKey((k) => k + 1);
      return;
    }
    setSavingQual(`${personId}-${skillId}`);
    try {
      const res = await fetch(`${apiUrl}/api/v1/referee-qualifications/${qualId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.qualificationRemoveFailed'));
      }
      setRefereesKey((k) => k + 1);
    } catch {
      toast.error(t('organizer.refereesPage.qualificationRemoveFailed'));
      setRefereesKey((k) => k + 1);
    } finally {
      setSavingQual(null);
    }
  }

  async function updateAvailability(
    userId: string,
    patch: { availableAllTournaments?: boolean; availableAllEventDuration?: boolean },
  ) {
    // Optimistic update
    setReferees((prev) =>
      prev.map((r) =>
        r.userId === userId
          ? {
              ...r,
              availableAllTournaments: patch.availableAllTournaments ?? r.availableAllTournaments,
              availableAllEventDuration:
                patch.availableAllEventDuration ?? r.availableAllEventDuration,
            }
          : r,
      ),
    );

    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referees/${userId}/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(patch),
    });

    if (!res.ok) {
      // Revert
      setRefereesKey((k) => k + 1);
      toast.error(t('organizer.refereesPage.availabilitySaveFailed'));
    }
  }

  async function linkToGlobalPerson(qualificationId: string, globalPersonId: string) {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/global-persons/${globalPersonId}/link-referee-qualification`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ qualificationId }),
        },
      );
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.linkProfileFailed'));
      }
    } catch {
      toast.error(t('organizer.refereesPage.linkProfileFailed'));
    }
    setLinkingPersonId(null);
    setGlobalSearch('');
    setGlobalResults([]);
    setRefereesKey((k) => k + 1);
  }

  async function createAndLinkGlobalPerson(ref: EventRefereeRow) {
    const nameParts = ref.displayName.split(' ');
    const givenName = nameParts[0] ?? ref.displayName;
    const familyName = nameParts.slice(1).join(' ') || givenName;
    try {
      const res = await fetch(`${apiUrl}/api/v1/global-persons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          givenName,
          familyName,
          displayName: ref.displayName,
          isReferee: true,
        }),
      });
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.createProfileFailed'));
        setRefereesKey((k) => k + 1);
        return;
      }
      const gp = (await res.json()) as { id: string };
      // Find any qual id for this person
      const firstQualId = Array.from(qualIdMap.entries()).find(([key]) =>
        key.startsWith(`${ref.personId}:`),
      )?.[1];
      if (firstQualId) await linkToGlobalPerson(firstQualId, gp.id);
    } catch {
      toast.error(t('organizer.refereesPage.createProfileFailed'));
      setRefereesKey((k) => k + 1);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="p-8 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href={`/org/${slug}`} className="hover:text-gray-700">
              {slug}
            </Link>
            <span>/</span>
            <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
              {t('organizer.refereesPage.eventBreadcrumb')}
            </Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">
              {t('organizer.refereesPage.refereesTitle')}
            </span>
          </div>
          <h1 className="text-2xl font-bold">{t('organizer.refereesPage.pageTitle')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSkillModal({ mode: 'add' })}
            className="border border-red-300 text-red-700 hover:bg-red-50 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            + {t('organizer.refereesPage.addCustomSkill')}
          </button>
          <Link
            href={`/org/${slug}/events/${eventId}/pools`}
            className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {t('organizer.refereesPage.backToPools')}
          </Link>
        </div>
      </div>

      {/* Add referee search */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-medium text-gray-700 mb-2">
          {t('organizer.refereesPage.addRefereeButton')}
        </p>
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('organizer.refereesPage.searchParticipantPlaceholder')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
              {searchResults.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {p.given_name} {p.family_name}
                    </p>
                    {p.club_label && <p className="text-xs text-gray-400">{p.club_label}</p>}
                  </div>
                  <button
                    onClick={() => {
                      void addReferee(p.id);
                      setSearch('');
                      setSearchResults([]);
                    }}
                    className="text-xs border border-gray-300 rounded px-2 py-0.5 hover:bg-gray-100"
                  >
                    {t('organizer.refereesPage.addQualification')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Referee table */}
      {loading ? (
        <p className="text-gray-400 text-sm">{t('organizer.refereesPage.loading')}</p>
      ) : referees.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">{t('organizer.refereesPage.noReferees')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                {/* Name column */}
                <th className="py-2 pr-4 font-medium whitespace-nowrap">
                  {t('organizer.refereesPage.personColumn')}
                </th>

                {/* Skill columns */}
                {skills.map((skill) => (
                  <th
                    key={skill.id}
                    className={[
                      'py-2 px-3 font-medium text-center whitespace-nowrap rounded-t',
                      tintBgClassFor(skill.color),
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>{skill.name}</span>
                      {!skill.isSystem && (
                        <button
                          onClick={() =>
                            setSkillModal({
                              mode: 'edit',
                              skillId: skill.id,
                              initial: { name: skill.name, color: skill.color },
                            })
                          }
                          className="text-gray-400 hover:text-gray-700 ml-0.5"
                          title={t('organizer.refereesPage.editSkill')}
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  </th>
                ))}

                {/* Availability columns */}
                <th className="py-2 px-3 font-medium text-center whitespace-nowrap">
                  {t('organizer.refereesPage.availableAllTournaments')}
                </th>
                <th className="py-2 px-3 font-medium text-center whitespace-nowrap">
                  {t('organizer.refereesPage.availableAllEventDuration')}
                </th>

                {/* Assignment summary */}
                <th className="py-2 px-3 font-medium whitespace-nowrap">
                  {t('organizer.refereesPage.assignedTo')}
                </th>

                {/* Total matches */}
                <th className="py-2 px-3 font-medium text-center whitespace-nowrap">
                  {t('organizer.refereesPage.totalMatches')}
                </th>
              </tr>
            </thead>
            <tbody>
              {referees.map((ref) => (
                <tr key={ref.userId} className="border-b border-gray-100 hover:bg-gray-50">
                  {/* Name cell */}
                  <td className="py-3 pr-4 align-top">
                    <p className="font-medium text-gray-900">{ref.displayName}</p>
                    {ref.clubLabel && <p className="text-xs text-gray-400">{ref.clubLabel}</p>}
                    {ref.personId ? (
                      <span className="text-xs text-emerald-600 font-medium">
                        {t('organizer.refereesPage.globalProfileLinked')}
                      </span>
                    ) : (
                      <div className="mt-1">
                        {linkingPersonId === ref.userId ? (
                          <div className="flex flex-col gap-1">
                            <input
                              type="search"
                              value={globalSearch}
                              onChange={(e) => setGlobalSearch(e.target.value)}
                              placeholder={t(
                                'organizer.refereesPage.searchGlobalPersonsPlaceholder',
                              )}
                              className="border border-gray-300 rounded px-2 py-1 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                            {globalResults.length > 0 && (
                              <div className="bg-white border border-gray-200 rounded shadow text-xs max-h-32 overflow-y-auto">
                                {globalResults.map((gp) => (
                                  <button
                                    key={gp.id}
                                    onClick={() => {
                                      // Find any qual id for this user
                                      const firstQualId = Array.from(qualIdMap.entries()).find(
                                        ([key]) => key.startsWith(`${ref.personId}:`),
                                      )?.[1];
                                      if (firstQualId) void linkToGlobalPerson(firstQualId, gp.id);
                                    }}
                                    className="block w-full text-left px-2 py-1 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                                  >
                                    {gp.display_name}
                                  </button>
                                ))}
                              </div>
                            )}
                            <div className="flex gap-1">
                              <button
                                onClick={() => void createAndLinkGlobalPerson(ref)}
                                className="text-xs text-amber-600 hover:text-amber-800"
                              >
                                {t('organizer.refereesPage.createGlobalProfile')}
                              </button>
                              <button
                                onClick={() => {
                                  setLinkingPersonId(null);
                                  setGlobalSearch('');
                                  setGlobalResults([]);
                                }}
                                className="text-xs text-gray-400 hover:text-gray-600"
                              >
                                {t('organizer.refereesPage.cancel')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setLinkingPersonId(ref.userId)}
                            className="text-xs text-amber-600 hover:text-amber-800"
                          >
                            {t('organizer.refereesPage.linkGlobalProfile')}
                          </button>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Skill cells */}
                  {skills.map((skill) => {
                    const qual = ref.qualifications.find((q) => q.skillId === skill.id);
                    const isSaving = savingQual === `${ref.personId}-${skill.id}`;
                    return (
                      <td key={skill.id} className="py-3 px-3 text-center align-top">
                        {qual ? (
                          <div className="flex flex-col items-center gap-1">
                            <SkillBadge color={skill.color} label={skill.name} />
                            <StarRating
                              value={qual.rating}
                              onChange={(v) => {
                                if (ref.personId) {
                                  void upsertQualification(ref.personId, skill.id, v);
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                if (ref.personId) {
                                  void removeQualification(ref.personId, skill.id);
                                }
                              }}
                              disabled={isSaving}
                              className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
                            >
                              {t('organizer.refereesPage.removeQualification')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              if (ref.personId) {
                                void upsertQualification(ref.personId, skill.id, null);
                              }
                            }}
                            disabled={isSaving || !ref.personId}
                            className="text-xs text-gray-400 hover:text-gray-600 border border-dashed border-gray-300 rounded px-2 py-0.5 disabled:opacity-50"
                            title={
                              !ref.personId
                                ? t('organizer.refereesPage.linkProfileFirst')
                                : undefined
                            }
                          >
                            {t('organizer.refereesPage.addQualification')}
                          </button>
                        )}
                      </td>
                    );
                  })}

                  {/* Available all tournaments toggle */}
                  <td className="py-3 px-3 text-center align-middle">
                    <div className="flex justify-center">
                      <Toggle
                        checked={ref.availableAllTournaments}
                        onChange={(v) =>
                          void updateAvailability(ref.userId, { availableAllTournaments: v })
                        }
                      />
                    </div>
                  </td>

                  {/* Available all event duration toggle */}
                  <td className="py-3 px-3 text-center align-middle">
                    <div className="flex justify-center">
                      <Toggle
                        checked={ref.availableAllEventDuration}
                        onChange={(v) =>
                          void updateAvailability(ref.userId, { availableAllEventDuration: v })
                        }
                      />
                    </div>
                  </td>

                  {/* Assignment summary cell */}
                  <td className="py-3 px-3 align-top">
                    {ref.assignments.length === 0 ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {ref.assignments.slice(0, 3).map((a) => (
                          <span
                            key={a.tournamentId}
                            className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded px-2 py-0.5"
                          >
                            {a.tournamentName}
                            <span className="text-gray-400">·</span>
                            {a.matchCount}{' '}
                            {a.matchCount === 1
                              ? t('organizer.refereesPage.match')
                              : t('organizer.refereesPage.matches')}
                          </span>
                        ))}
                        {ref.assignments.length > 3 && (
                          <span
                            className="text-xs text-gray-500 cursor-default"
                            title={ref.assignments
                              .slice(3)
                              .map(
                                (a) =>
                                  `${a.tournamentName} · ${a.matchCount} ${a.matchCount === 1 ? t('organizer.refereesPage.match') : t('organizer.refereesPage.matches')}`,
                              )
                              .join(', ')}
                          >
                            {t('organizer.refereesPage.moreCount', {
                              count: ref.assignments.length - 3,
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Total matches */}
                  <td className="py-3 px-3 text-center align-middle">
                    <span className="font-medium text-gray-900">{ref.totalMatchCount}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Skill modal */}
      {skillModal && (
        <SkillModal
          mode={skillModal.mode}
          skillId={skillModal.skillId}
          initial={skillModal.initial}
          eventId={eventId}
          apiUrl={apiUrl}
          onClose={() => setSkillModal(null)}
          onSaved={() => {
            setSkillModal(null);
            setSkillsKey((k) => k + 1);
            setRefereesKey((k) => k + 1);
          }}
          onDeleted={() => {
            setSkillModal(null);
            setSkillsKey((k) => k + 1);
            setRefereesKey((k) => k + 1);
          }}
        />
      )}
    </main>
  );
}
