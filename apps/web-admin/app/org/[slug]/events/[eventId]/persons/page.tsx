'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ConfirmDialog,
  SkillBadge,
  TournamentColorDot,
  fuzzyMatch,
  useConfirm,
  useToast,
} from '@myclash/ui';
import { t } from '@myclash/i18n';
import { HemaRatingsSuggest } from '@/components/HemaRatingsSuggest';
import { mapGlobalPersonSuggestion, type GlobalPersonSuggestion } from './global-person-mapper';
import { formatRosterName } from './roster-name';
import { personMatchesFilter, type PersonFilterValue } from './filter-persons';
import {
  computeClubPickerRows,
  type ClubSuggestion as ClubPickerSuggestion,
} from './_components/club-picker-rows';
import { DeleteParticipantModal } from './_components/DeleteParticipantModal';
import { WaitingListPanel } from './_components/WaitingListPanel';
import { addToWaitingList, tryRegisterInTournament } from './_components/registration-helpers';
import { useEventStatus } from '../_hooks/useEventStatus';

interface Person {
  id: string;
  givenName: string;
  familyName: string;
  email: string | null;
  clubId: string | null;
  clubLabel: string | null;
  claimStatus: 'unclaimed' | 'guest_active' | 'claimed';
  hemaRatingsId: string | null;
  globalPersonId: string | null;
  claimedByUserId: string | null;
}

interface Registration {
  id: string;
  personId: string;
  tournamentId: string;
  tournamentName: string;
  status: 'registered' | 'checked_in' | 'done' | 'withdrawn' | 'disqualified' | 'waitlist';
  seed: number | null;
  /** Slice 5: position 1..N for waitlist entries; null otherwise. */
  waitlistPosition: number | null;
}

interface Tournament {
  id: string;
  name: string;
  color?: string | null;
  /** Slice 5: waitlist cap surfaced on the per-tournament panel header. */
  maxWaitlist?: number | null;
}

interface ClubSuggestion {
  id: string;
  name: string;
  abbreviation: string | null;
}

interface AddForm {
  givenName: string;
  familyName: string;
  email: string;
  hemaRatingsId: string;
  seed: string;
  isReferee: boolean;
  isInstructor: boolean;
}

const EMPTY_ADD_FORM: AddForm = {
  givenName: '',
  familyName: '',
  email: '',
  hemaRatingsId: '',
  seed: '',
  isReferee: false,
  isInstructor: false,
};

const CLAIM_COLORS: Record<string, string> = {
  unclaimed: 'bg-border text-foreground-secondary',
  guest_active: 'bg-warning/10 text-warning',
  claimed: 'bg-success/10 text-success',
};

const REG_STATUS_COLORS: Record<string, string> = {
  registered: 'bg-info/10 text-info',
  checked_in: 'bg-success/10 text-success',
  done: 'bg-border text-foreground-secondary',
  withdrawn: 'bg-danger/10 text-danger',
  disqualified: 'bg-danger/10 text-danger',
};

export default function ParticipantsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { isReadOnly } = useEventStatus(eventId);

  const [persons, setPersons] = useState<Person[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string>('all');
  // Inline header filters: 'all' | 'none' | clubId, and referee tri-state.
  const [clubFilter, setClubFilter] = useState('all');
  const [refereeFilter, setRefereeFilter] = useState<PersonFilterValue['referee']>('all');
  const [instructorFilter, setInstructorFilter] = useState<PersonFilterValue['instructor']>('all');
  /** Slice 5: top-level mode toggle. 'persons' shows the existing roster
   *  view; 'waiting-list' renders per-tournament waitlist tables instead. */
  const [mode, setMode] = useState<'persons' | 'waiting-list'>(() => {
    if (typeof window === 'undefined') return 'persons';
    return window.location.hash === '#waiting-list' ? 'waiting-list' : 'persons';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const desired = mode === 'waiting-list' ? '#waiting-list' : '';
    if (window.location.hash !== desired) {
      window.history.replaceState(null, '', `${window.location.pathname}${desired}`);
    }
  }, [mode]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Global profiles already linked to a person in this event. Used to grey out
  // matching suggestions in the Add-Participant typeahead so operators can't
  // accidentally create a duplicate. The server has its own guard for the
  // direct-API case.
  const existingGlobalIds = useMemo(
    () => new Set(persons.map((p) => p.globalPersonId).filter((id): id is string => Boolean(id))),
    [persons],
  );
  const [bulkAssignTournamentId, setBulkAssignTournamentId] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  // Tournament-full → offer waiting-list. Each row is a (person,
  // tournament) pair that came back 409 + reason='tournament_full'
  // from POST /api/v1/tournaments/<id>/registrations. The dialog
  // confirms once and fans the writes out via addToWaitingList.
  type WaitlistRow = {
    tournamentId: string;
    tournamentName: string;
    personId: string;
    personName: string;
    registeredCount: number;
    maxParticipants: number;
    body: Record<string, unknown>;
  };
  const [waitlistPrompt, setWaitlistPrompt] = useState<WaitlistRow[] | null>(null);
  const [waitlistBusy, setWaitlistBusy] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [selectedTournaments, setSelectedTournaments] = useState<Set<string>>(new Set());
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalSuggestions, setGlobalSuggestions] = useState<GlobalPersonSuggestion[]>([]);
  const [selectedGlobalId, setSelectedGlobalId] = useState<string | null>(null);
  const [clubSearch, setClubSearch] = useState('');
  const [clubSuggestions, setClubSuggestions] = useState<ClubSuggestion[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [selectedClubLabel, setSelectedClubLabel] = useState('');
  const [newClubName, setNewClubName] = useState<string | null>(null);
  const [editPerson, setEditPerson] = useState<Person | null>(null);
  const [editForm, setEditForm] = useState<AddForm>(EMPTY_ADD_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editClubSearch, setEditClubSearch] = useState('');
  const [editClubSuggestions, setEditClubSuggestions] = useState<ClubSuggestion[]>([]);
  const [editClubId, setEditClubId] = useState<string | null>(null);
  const [editClubLabel, setEditClubLabel] = useState('');
  // Tournament assignments inside the Edit modal. Initialized to the
  // participant's current registrations in openEdit(); on save we diff
  // against the original set and fan POST/DELETE per added/removed id.
  const [editSelectedTournaments, setEditSelectedTournaments] = useState<Set<string>>(new Set());
  const [editOriginalTournaments, setEditOriginalTournaments] = useState<Set<string>>(new Set());
  // Set when the user has triggered any of the three delete surfaces;
  // the DeleteParticipantModal renders against this state. `scope` is
  // a tournamentId for the per-tournament Unassign path, null for the
  // per-row / bulk delete paths.
  const [deleteModal, setDeleteModal] = useState<{
    persons: Person[];
    scope: string | null;
  } | null>(null);
  // Post-0063: event_referees keys exclusively on person_id (= global_persons.id).
  // Claimed-vs-unclaimed is purely a display distinction now.
  const [refereePersonIds, setRefereePersonIds] = useState<Set<string>>(new Set());
  // Event-scoped instructor roster (event_instructors), keyed on
  // global_persons.id — mirrors referees but with no global flag.
  const [instructorPersonIds, setInstructorPersonIds] = useState<Set<string>>(new Set());
  type SortKey = 'name' | 'club' | 'claim' | 'tournaments' | 'referee' | 'instructor';
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional loading flag before the fetch fan-out
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/persons`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/registrations`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([pRes, rRes, tRes]) => {
        setLoading(false);
        if (pRes.ok) setPersons((await pRes.json()) as Person[]);
        if (rRes.ok) setRegistrations((await rRes.json()) as Registration[]);
        if (tRes.ok) {
          const raw = (await tRes.json()) as Array<Tournament & { max_waitlist?: number | null }>;
          setTournaments(
            raw.map((t) => ({
              id: t.id,
              name: t.name,
              color: t.color ?? null,
              maxWaitlist: t.maxWaitlist ?? t.max_waitlist ?? null,
            })),
          );
        }
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventId, apiUrl, refreshKey]);

  // Fetch the event's referee list once per refresh.
  // Post-0063: every row carries a personId; userId is a derived display field.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/referees`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const rows = (await res.json()) as Array<{
          personId: string;
          userId: string | null;
        }>;
        const persons = new Set<string>();
        for (const r of rows) persons.add(r.personId);
        setRefereePersonIds(persons);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventId, apiUrl, refreshKey]);

  // Fetch the event's instructor roster once per refresh (mirrors referees).
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/instructors`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const rows = (await res.json()) as Array<{ personId: string; displayName: string }>;
        const ids = new Set<string>();
        for (const r of rows) ids.add(r.personId);
        setInstructorPersonIds(ids);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventId, apiUrl, refreshKey]);

  const registrationsByPersonId = useMemo(() => {
    const map = new Map<string, Registration[]>();
    for (const reg of registrations) {
      const list = map.get(reg.personId) ?? [];
      map.set(reg.personId, [...list, reg]);
    }
    return map;
  }, [registrations]);

  // Distinct clubs on the roster, for the Club header filter, sorted by name.
  const clubOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of persons) {
      if (p.clubId && p.clubLabel) byId.set(p.clubId, p.clubLabel);
    }
    return Array.from(byId.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [persons]);

  useEffect(() => {
    if (globalSearch.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale suggestions when the query is too short
      setGlobalSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/api/v1/global-persons?q=${encodeURIComponent(globalSearch)}`, {
        credentials: 'include',
      })
        .then(async (res) => {
          if (!res.ok) return;
          const rows = (await res.json()) as Array<Record<string, unknown>>;
          setGlobalSuggestions(rows.map(mapGlobalPersonSuggestion));
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [globalSearch, apiUrl]);

  useEffect(() => {
    if (!showAdd || selectedClubId || clubSearch.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale club suggestions when the picker is inactive
      if (!selectedClubId) setClubSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/api/v1/clubs?q=${encodeURIComponent(clubSearch)}&searchAbv=true`, {
        credentials: 'include',
      })
        .then(async (res) => {
          if (res.ok) setClubSuggestions((await res.json()) as ClubSuggestion[]);
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [clubSearch, showAdd, selectedClubId, apiUrl]);

  useEffect(() => {
    if (!editPerson || editClubId || editClubSearch.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale club suggestions when the edit picker is inactive
      if (!editClubId) setEditClubSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/api/v1/clubs?q=${encodeURIComponent(editClubSearch)}&searchAbv=true`, {
        credentials: 'include',
      })
        .then(async (res) => {
          if (res.ok) setEditClubSuggestions((await res.json()) as ClubSuggestion[]);
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [editClubSearch, editPerson, editClubId, apiUrl]);

  const filteredPersons = useMemo(() => {
    let list = persons;
    if (activeTab !== 'all') {
      const ids = new Set(
        registrations.filter((r) => r.tournamentId === activeTab).map((r) => r.personId),
      );
      list = list.filter((p) => ids.has(p.id));
    }
    if (search.trim()) {
      // Diacritic-insensitive, matching the standings/clubs search behavior.
      list = list.filter((p) => fuzzyMatch(search, `${p.givenName} ${p.familyName}`));
    }
    if (clubFilter !== 'all' || refereeFilter !== 'all' || instructorFilter !== 'all') {
      list = list.filter((p) =>
        personMatchesFilter(
          p,
          { club: clubFilter, referee: refereeFilter, instructor: instructorFilter },
          refereePersonIds,
          instructorPersonIds,
        ),
      );
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    const sorted = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return (
            `${a.familyName} ${a.givenName}`.localeCompare(`${b.familyName} ${b.givenName}`) * dir
          );
        case 'club':
          return (a.clubLabel ?? '').localeCompare(b.clubLabel ?? '') * dir;
        case 'claim':
          return a.claimStatus.localeCompare(b.claimStatus) * dir;
        case 'tournaments': {
          const ac = registrationsByPersonId.get(a.id)?.length ?? 0;
          const bc = registrationsByPersonId.get(b.id)?.length ?? 0;
          return (ac - bc) * dir;
        }
        case 'referee': {
          // refereePersonIds holds global_persons.id values; the row's id is
          // event-scoped. Match on globalPersonId.
          const ar = a.globalPersonId ? refereePersonIds.has(a.globalPersonId) : false;
          const br = b.globalPersonId ? refereePersonIds.has(b.globalPersonId) : false;
          return (Number(br) - Number(ar)) * dir; // true first when asc
        }
        case 'instructor': {
          const ai = a.globalPersonId ? instructorPersonIds.has(a.globalPersonId) : false;
          const bi = b.globalPersonId ? instructorPersonIds.has(b.globalPersonId) : false;
          return (Number(bi) - Number(ai)) * dir;
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [
    persons,
    registrations,
    activeTab,
    search,
    clubFilter,
    refereeFilter,
    instructorFilter,
    sortKey,
    sortDir,
    registrationsByPersonId,
    refereePersonIds,
    instructorPersonIds,
  ]);

  function closeAddModal() {
    setShowAdd(false);
    setAddForm(EMPTY_ADD_FORM);
    setAddError(null);
    setGlobalSearch('');
    setGlobalSuggestions([]);
    setSelectedGlobalId(null);
    setClubSearch('');
    setClubSuggestions([]);
    setSelectedClubId(null);
    setSelectedClubLabel('');
    setNewClubName(null);
    setSelectedTournaments(new Set());
  }

  async function handleAdd() {
    if (!addForm.givenName.trim() || !addForm.familyName.trim()) {
      setAddError(t('admin.common.givenAndFamilyNameRequired'));
      return;
    }
    setAddSaving(true);
    setAddError(null);
    const hemaRatingsId = addForm.hemaRatingsId.trim() || null;
    try {
      const personRes = await fetch(`${apiUrl}/api/v1/events/${eventId}/persons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          givenName: addForm.givenName.trim(),
          familyName: addForm.familyName.trim(),
          email: addForm.email.trim() || null,
          clubId: selectedClubId || null,
          newClubName: newClubName || null,
          hemaRatingsId,
          globalPersonId: selectedGlobalId || null,
        }),
      });
      if (!personRes.ok) {
        const body = (await personRes.json()) as { message?: string };
        throw new Error(body.message ?? t('admin.common.createParticipantFailed'));
      }
      const person = (await personRes.json()) as {
        id: string;
        globalPersonId: string | null;
        claimedByUserId?: string | null;
      };

      // Post-0063: referee registration keys on the person's global_persons.id.
      // The backend's ensureEventReferee also accepts the event-scoped
      // persons.id as a fallback (resolves to global via the persons row),
      // so participants whose globalPersonId isn't cached on this surface
      // still get auto-registered when isReferee is checked.
      if (addForm.isReferee) {
        const refereeId = person.globalPersonId ?? person.id;
        const url = `${apiUrl}/api/v1/events/${eventId}/referees/${refereeId}`;
        fetch(url, { method: 'POST', credentials: 'include' })
          .then(async (res) => {
            if (!res.ok) {
              const body = (await res.json().catch(() => null)) as { message?: string } | null;
              console.error('Referee registration failed', res.status, body);
              toast.warning(t('organizer.persons.refereeRegistrationFailed'));
            }
          })
          .catch((err: unknown) => {
            console.error('Referee registration network error', err);
            toast.warning(t('organizer.persons.refereeRegistrationFailed'));
          });
      }

      // Instructor tagging — same id-resolution rules as referees.
      if (addForm.isInstructor) {
        const instructorId = person.globalPersonId ?? person.id;
        const url = `${apiUrl}/api/v1/events/${eventId}/instructors/${instructorId}`;
        fetch(url, { method: 'POST', credentials: 'include' })
          .then(async (res) => {
            if (!res.ok) {
              const body = (await res.json().catch(() => null)) as { message?: string } | null;
              console.error('Instructor tagging failed', res.status, body);
              toast.warning(t('organizer.persons.instructorRegistrationFailed'));
            }
          })
          .catch((err: unknown) => {
            console.error('Instructor tagging network error', err);
            toast.warning(t('organizer.persons.instructorRegistrationFailed'));
          });
      }

      // Per-tournament registrations — capture failures so a network blip
      // on one tournament doesn't silently lose the others. Full
      // tournaments (409 + reason='tournament_full') route into the
      // waiting-list confirm dialog rather than the generic "failed"
      // toast so the operator can act on them with one click.
      const failedTournaments: string[] = [];
      const fullPending: WaitlistRow[] = [];
      const personName = `${addForm.givenName.trim()} ${addForm.familyName.trim()}`.trim();
      for (const tournamentId of selectedTournaments) {
        const body = {
          personId: person.id,
          hemaRatingsId,
          seed: addForm.seed ? parseInt(addForm.seed, 10) : undefined,
        };
        const outcome = await tryRegisterInTournament(apiUrl, tournamentId, body);
        if (outcome.status === 'full') {
          const tour = tournaments.find((x) => x.id === tournamentId);
          fullPending.push({
            tournamentId,
            tournamentName: tour?.name ?? tournamentId,
            personId: person.id,
            personName,
            registeredCount: outcome.registeredCount,
            maxParticipants: outcome.maxParticipants,
            body,
          });
        } else if (outcome.status === 'error') {
          const tour = tournaments.find((x) => x.id === tournamentId);
          failedTournaments.push(tour?.name ?? tournamentId);
        }
      }
      if (failedTournaments.length > 0) {
        toast.warning(
          `Created participant, but failed to register in: ${failedTournaments.join(', ')}.`,
        );
      } else if (selectedTournaments.size > 0 && fullPending.length === 0) {
        toast.success(
          t('admin.orgPersons.toastAddedToTournaments', {
            name: personName,
            count: selectedTournaments.size,
          }),
        );
      }
      if (fullPending.length > 0) setWaitlistPrompt(fullPending);
      closeAddModal();
      refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t('admin.common.somethingWentWrong'));
    } finally {
      setAddSaving(false);
    }
  }

  function openEdit(p: Person) {
    setEditPerson(p);
    const currentlyReferee = p.globalPersonId ? refereePersonIds.has(p.globalPersonId) : false;
    const currentlyInstructor = p.globalPersonId
      ? instructorPersonIds.has(p.globalPersonId)
      : false;
    setEditForm({
      givenName: p.givenName,
      familyName: p.familyName,
      email: p.email ?? '',
      hemaRatingsId: p.hemaRatingsId ?? '',
      seed: '',
      isReferee: currentlyReferee,
      isInstructor: currentlyInstructor,
    });
    setEditClubSearch(p.clubLabel ?? '');
    // Load the current club_id from the loaded Person so a Save that
    // doesn't touch the club picker round-trips it in the PATCH body
    // instead of stomping the column to null (prod regression
    // reported on the persons page).
    setEditClubId(p.clubId ?? null);
    setEditClubLabel(p.clubLabel ?? '');
    setEditError(null);
    const initial = new Set(
      registrations.filter((r) => r.personId === p.id).map((r) => r.tournamentId),
    );
    setEditSelectedTournaments(initial);
    setEditOriginalTournaments(initial);
  }

  async function handleEditSave() {
    if (!editPerson) return;
    if (!editForm.givenName.trim() || !editForm.familyName.trim()) {
      setEditError(t('admin.common.givenAndFamilyNameRequired'));
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/persons/${editPerson.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          givenName: editForm.givenName.trim(),
          familyName: editForm.familyName.trim(),
          email: editForm.email.trim() || null,
          clubId: editClubId || null,
          hemaRatingsId: editForm.hemaRatingsId.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('admin.common.saveFailed'));
      }

      // Diff tournament selection vs the original set.
      const toAdd = [...editSelectedTournaments].filter((id) => !editOriginalTournaments.has(id));
      const toRemove = [...editOriginalTournaments].filter(
        (id) => !editSelectedTournaments.has(id),
      );
      const failed: string[] = [];
      const fullPending: WaitlistRow[] = [];
      const editPersonName = `${editPerson.givenName} ${editPerson.familyName}`.trim();

      for (const tournamentId of toAdd) {
        const body = {
          personId: editPerson.id,
          hemaRatingsId: editForm.hemaRatingsId.trim() || null,
        };
        const outcome = await tryRegisterInTournament(apiUrl, tournamentId, body);
        if (outcome.status === 'full') {
          const tour = tournaments.find((x) => x.id === tournamentId);
          fullPending.push({
            tournamentId,
            tournamentName: tour?.name ?? tournamentId,
            personId: editPerson.id,
            personName: editPersonName,
            registeredCount: outcome.registeredCount,
            maxParticipants: outcome.maxParticipants,
            body,
          });
        } else if (outcome.status === 'error') {
          const tour = tournaments.find((x) => x.id === tournamentId);
          failed.push(tour?.name ?? tournamentId);
        }
      }
      for (const tournamentId of toRemove) {
        const reg = registrations.find(
          (x) => x.personId === editPerson.id && x.tournamentId === tournamentId,
        );
        if (!reg) continue;
        const r = await fetch(`${apiUrl}/api/v1/registrations/${reg.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!r.ok) {
          const tour = tournaments.find((x) => x.id === tournamentId);
          failed.push(tour?.name ?? tournamentId);
        }
      }
      if (failed.length > 0) {
        toast.warning(
          `Saved profile, but failed to update tournament assignments for: ${failed.join(', ')}.`,
        );
      } else if ((toAdd.length > 0 || toRemove.length > 0) && fullPending.length === 0) {
        toast.success(t('admin.orgPersons.toastProfileUpdated'));
      }
      if (fullPending.length > 0) setWaitlistPrompt(fullPending);

      // Post-0063: referee endpoints key on global_persons.id, NOT the
      // event-scoped persons.id. refereePersonIds holds global ids too.
      const wasReferee = editPerson.globalPersonId
        ? refereePersonIds.has(editPerson.globalPersonId)
        : false;
      if (editForm.isReferee !== wasReferee) {
        if (!editPerson.globalPersonId) {
          toast.warning(t('organizer.persons.refereeUpdateFailed'));
        } else {
          const url = `${apiUrl}/api/v1/events/${eventId}/referees/${editPerson.globalPersonId}`;
          const method = editForm.isReferee ? 'POST' : 'DELETE';
          const r = await fetch(url, { method, credentials: 'include' });
          if (!r.ok) {
            toast.warning(t('organizer.persons.refereeUpdateFailed'));
          }
        }
      }

      // Instructor tag toggle (event-scoped; keys on global_persons.id).
      const wasInstructor = editPerson.globalPersonId
        ? instructorPersonIds.has(editPerson.globalPersonId)
        : false;
      if (editForm.isInstructor !== wasInstructor) {
        if (!editPerson.globalPersonId) {
          toast.warning(t('organizer.persons.instructorUpdateFailed'));
        } else {
          const url = `${apiUrl}/api/v1/events/${eventId}/instructors/${editPerson.globalPersonId}`;
          const method = editForm.isInstructor ? 'POST' : 'DELETE';
          const r = await fetch(url, { method, credentials: 'include' });
          if (!r.ok) {
            toast.warning(t('organizer.persons.instructorUpdateFailed'));
          }
        }
      }

      setEditPerson(null);
      refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t('admin.common.saveFailed'));
    } finally {
      setEditSaving(false);
    }
  }

  function handleBulkDelete() {
    if (selected.size === 0) return;
    const targets = Array.from(selected)
      .map((id) => persons.find((p) => p.id === id))
      .filter((p): p is Person => !!p);
    if (targets.length === 0) return;
    setDeleteModal({ persons: targets, scope: null });
  }

  async function handleBulkCheckIn() {
    if (selected.size === 0 || activeTab === 'all') return;
    if (!(await confirm({ title: t('admin.orgPersons.confirmCheckIn', { count: selected.size }) })))
      return;
    setBulkLoading(true);
    for (const personId of selected) {
      const reg = (registrationsByPersonId.get(personId) ?? []).find(
        (r) => r.tournamentId === activeTab,
      );
      if (!reg) continue;
      await fetch(`${apiUrl}/api/v1/registrations/${reg.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'checked_in' }),
      });
    }
    setSelected(new Set());
    setBulkLoading(false);
    refresh();
  }

  function handleBulkUnassign() {
    if (selected.size === 0 || activeTab === 'all') return;
    const targets = Array.from(selected)
      .map((id) => persons.find((p) => p.id === id))
      .filter((p): p is Person => !!p);
    if (targets.length === 0) return;
    // Route through the same usage-probe modal as the other delete
    // surfaces — scoped to the active tournament tab.
    setDeleteModal({ persons: targets, scope: activeTab });
  }

  async function handleBulkAssign(tournamentId: string) {
    if (selected.size === 0 || !tournamentId) return;
    setBulkLoading(true);
    const tour = tournaments.find((x) => x.id === tournamentId);
    const tournamentName = tour?.name ?? tournamentId;
    const fullPending: WaitlistRow[] = [];
    const erroredNames: string[] = [];
    for (const personId of selected) {
      const person = persons.find((p) => p.id === personId);
      const personName = person
        ? `${person.givenName} ${person.familyName}`.trim()
        : personId.slice(0, 8);
      const body = { personId };
      const outcome = await tryRegisterInTournament(apiUrl, tournamentId, body);
      if (outcome.status === 'full') {
        fullPending.push({
          tournamentId,
          tournamentName,
          personId,
          personName,
          registeredCount: outcome.registeredCount,
          maxParticipants: outcome.maxParticipants,
          body,
        });
      } else if (outcome.status === 'error') {
        erroredNames.push(personName);
      }
    }
    if (erroredNames.length > 0) {
      toast.warning(`Could not register: ${erroredNames.join(', ')}.`);
    }
    if (fullPending.length > 0) setWaitlistPrompt(fullPending);
    setSelected(new Set());
    setBulkLoading(false);
    setBulkAssignTournamentId('');
    refresh();
  }

  /**
   * Operator confirmed the offer-waiting-list dialog. Fan out a
   * waitlist POST per row; toast a summary; close the dialog. Errors
   * keep the row on the dialog so the operator can retry, but the
   * MVP just toasts a partial-failure summary and closes.
   */
  async function confirmWaitlist() {
    const rows = waitlistPrompt;
    if (!rows || rows.length === 0) return;
    setWaitlistBusy(true);
    let ok = 0;
    let failed = 0;
    for (const row of rows) {
      const result = await addToWaitingList(apiUrl, row.tournamentId, row.body);
      if (result.ok) ok += 1;
      else failed += 1;
    }
    if (ok > 0 && failed === 0) {
      toast.success(
        ok === 1
          ? t('organizer.persons.addedToWaitingListSingular')
          : t('organizer.persons.addedToWaitingListPlural', { count: ok }),
      );
    } else if (ok > 0 && failed > 0) {
      toast.warning(t('organizer.persons.addToWaitingListPartial', { ok, failed }));
    } else {
      toast.error(t('organizer.persons.addToWaitingListAllFailed'));
    }
    setWaitlistPrompt(null);
    setWaitlistBusy(false);
    refresh();
  }

  async function handleBulkRegisterReferee() {
    if (selected.size === 0) return;
    if (
      !(await confirm({
        title: t('organizer.persons.bulk.registerRefereeConfirm', { count: selected.size }),
      }))
    ) {
      return;
    }
    setBulkLoading(true);
    let ok = 0;
    for (const personId of selected) {
      const person = persons.find((p) => p.id === personId);
      // Mirror the single-person path at the "Add referee" toggle:
      // fall back to event-scoped id when globalPersonId is absent
      // — ensureEventReferee resolves either.
      const targetId = person?.globalPersonId ?? personId;
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referees/${targetId}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) ok += 1;
    }
    setSelected(new Set());
    setBulkLoading(false);
    refresh();
    toast.success(t('organizer.persons.bulk.registerRefereeToast', { count: ok }));
  }

  async function handleBulkUnregisterReferee() {
    if (selected.size === 0) return;
    if (
      !(await confirm({
        title: t('organizer.persons.bulk.unregisterRefereeConfirm', { count: selected.size }),
        danger: true,
      }))
    ) {
      return;
    }
    setBulkLoading(true);
    let ok = 0;
    for (const personId of selected) {
      const person = persons.find((p) => p.id === personId);
      const targetId = person?.globalPersonId ?? personId;
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referees/${targetId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) ok += 1;
    }
    setSelected(new Set());
    setBulkLoading(false);
    refresh();
    toast.success(t('organizer.persons.bulk.unregisterRefereeToast', { count: ok }));
  }

  function handleDelete(personId: string) {
    const person = persons.find((p) => p.id === personId);
    if (!person) return;
    setDeleteModal({ persons: [person], scope: null });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filteredPersons.length && filteredPersons.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredPersons.map((p) => p.id)));
    }
  }

  return (
    <main className="mx-auto max-w-7xl p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
              {slug}
            </Link>
            <span>/</span>
            <Link
              href={`/org/${slug}/events/${eventId}`}
              className="hover:text-foreground-secondary"
            >
              {t('admin.orgPersons.breadcrumbEvent')}
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">
              {t('admin.orgPersons.breadcrumbParticipants')}
            </span>
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('admin.orgPersons.pageTitle')}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/org/${slug}/events/${eventId}/persons/import`}
            data-testid="persons-import-link"
            className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {t('admin.orgPersons.csvImport')}
          </Link>
          <button
            onClick={() => setShowAdd(true)}
            data-testid="persons-add"
            disabled={isReadOnly}
            title={isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
            className="bg-accent hover:bg-accent-hover text-accent-foreground font-semibold py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {t('admin.orgPersons.addParticipantButton')}
          </button>
        </div>
      </div>

      {/* Slice 5: top-level mode toggle. 'Persons' is the existing roster
       *  view; 'Waiting list' renders per-tournament queue tables instead. */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-surface p-0.5">
        <button
          type="button"
          onClick={() => setMode('persons')}
          className={[
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            mode === 'persons'
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground-secondary hover:bg-background',
          ].join(' ')}
        >
          {t('admin.orgPersons.modePersons')}
        </button>
        <button
          type="button"
          onClick={() => setMode('waiting-list')}
          className={[
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            mode === 'waiting-list'
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground-secondary hover:bg-background',
          ].join(' ')}
        >
          {t('admin.orgPersons.modeWaitingList')}
        </button>
      </div>

      {mode === 'waiting-list' && (
        <WaitingListPanel
          apiUrl={apiUrl}
          tournaments={tournaments}
          registrations={registrations}
          personById={
            new Map(
              persons.map((p) => [
                p.id,
                {
                  id: p.id,
                  givenName: p.givenName,
                  familyName: p.familyName,
                  clubLabel: p.clubLabel,
                },
              ]),
            )
          }
          onChange={refresh}
        />
      )}

      {mode === 'persons' && (
        <>
          <div className="flex gap-2 mb-4 flex-wrap">
            {(['all', ...tournaments.map((tour) => tour.id)] as string[]).map((tabId) => {
              const label =
                tabId === 'all'
                  ? t('admin.orgPersons.tabAllEvent')
                  : (tournaments.find((tour) => tour.id === tabId)?.name ?? tabId);
              const active = activeTab === tabId;
              const count =
                tabId === 'all'
                  ? persons.length
                  : registrations.filter((r) => r.tournamentId === tabId).length;
              return (
                <button
                  key={tabId}
                  onClick={() => {
                    setActiveTab(tabId);
                    setSelected(new Set());
                  }}
                  className={[
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-colors border inline-flex items-center',
                    active
                      ? 'bg-accent text-accent-foreground border-accent'
                      : 'bg-surface text-foreground-secondary border-border hover:border-border',
                  ].join(' ')}
                >
                  {label}
                  <span
                    className={[
                      'ml-1.5 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full text-xs font-semibold tabular-nums',
                      active
                        ? 'bg-accent-foreground/20 text-accent-foreground'
                        : 'bg-border text-foreground-secondary',
                    ].join(' ')}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {selected.size > 0 && (
            <div className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <div className="flex items-center gap-3 text-sm font-medium text-foreground-secondary">
                {selected.size} {t('organizer.persons.bulk.selected')}
              </div>

              {((activeTab === 'all' && tournaments.length > 0) || activeTab !== 'all') && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t('organizer.persons.bulk.section.tournament')}
                  </span>
                  {activeTab === 'all' && tournaments.length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        value={bulkAssignTournamentId}
                        onChange={(e) => setBulkAssignTournamentId(e.target.value)}
                        className="rounded border border-border px-2 py-1 text-xs"
                      >
                        <option value="">{t('organizer.persons.bulk.assignToTournament')}</option>
                        {tournaments.map((tour) => (
                          <option key={tour.id} value={tour.id}>
                            {tour.name}
                          </option>
                        ))}
                      </select>
                      {bulkAssignTournamentId && (
                        <button
                          onClick={() => void handleBulkAssign(bulkAssignTournamentId)}
                          disabled={bulkLoading}
                          className="rounded bg-info px-2 py-1 text-xs text-info-foreground hover:bg-info-hover disabled:opacity-50"
                        >
                          {t('organizer.persons.bulk.assign')}
                        </button>
                      )}
                    </div>
                  )}
                  {activeTab !== 'all' && (
                    <>
                      <button
                        onClick={() => void handleBulkCheckIn()}
                        disabled={bulkLoading || isReadOnly}
                        title={
                          isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined
                        }
                        className="text-sm font-medium text-success hover:text-success-hover disabled:opacity-50"
                      >
                        {t('organizer.persons.bulk.checkIn')}
                      </button>
                      <button
                        onClick={() => void handleBulkUnassign()}
                        disabled={bulkLoading || isReadOnly}
                        title={
                          isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined
                        }
                        className="text-sm font-medium text-warning hover:text-warning-hover disabled:opacity-50"
                      >
                        {t('organizer.persons.bulk.unassignFrom', {
                          tournament: tournaments.find((tour) => tour.id === activeTab)?.name ?? '',
                        })}
                      </button>
                      {tournaments.filter((tour) => tour.id !== activeTab).length > 0 && (
                        <div className="flex items-center gap-2">
                          <select
                            value={bulkAssignTournamentId}
                            onChange={(e) => setBulkAssignTournamentId(e.target.value)}
                            className="rounded border border-border px-2 py-1 text-xs"
                          >
                            <option value="">{t('organizer.persons.bulk.assignToAnother')}</option>
                            {tournaments
                              .filter((tour) => tour.id !== activeTab)
                              .map((tour) => (
                                <option key={tour.id} value={tour.id}>
                                  {tour.name}
                                </option>
                              ))}
                          </select>
                          {bulkAssignTournamentId && (
                            <button
                              onClick={() => void handleBulkAssign(bulkAssignTournamentId)}
                              disabled={bulkLoading}
                              className="rounded bg-info px-2 py-1 text-xs text-info-foreground hover:bg-info-hover disabled:opacity-50"
                            >
                              {t('organizer.persons.bulk.assign')}
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Referee bulk actions — always available, all tabs */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {t('organizer.persons.bulk.section.referee')}
                </span>
                <button
                  onClick={() => void handleBulkRegisterReferee()}
                  disabled={bulkLoading || isReadOnly}
                  title={isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
                  className="text-sm font-medium text-indigo-700 hover:text-indigo-900 disabled:opacity-50"
                >
                  {t('organizer.persons.bulk.registerReferee')}
                </button>
                <button
                  onClick={() => void handleBulkUnregisterReferee()}
                  disabled={bulkLoading || isReadOnly}
                  title={isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
                  className="text-sm font-medium text-foreground-secondary hover:text-foreground disabled:opacity-50"
                >
                  {t('organizer.persons.bulk.unregisterReferee')}
                </button>
              </div>

              {/* Danger zone — separated, restyled */}
              <div className="flex items-center gap-3 border-t border-border pt-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-danger">
                  {t('organizer.persons.bulk.section.danger')}
                </span>
                <button
                  onClick={() => void handleBulkDelete()}
                  disabled={bulkLoading || isReadOnly}
                  title={isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
                  className="rounded-md px-2.5 py-1 text-sm font-semibold text-danger ring-1 ring-danger/30 hover:bg-danger/10 disabled:opacity-50"
                >
                  {t('organizer.persons.bulk.deleteFromEvent')}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-muted text-sm">{t('admin.orgPersons.loading')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="py-2 pr-3 w-8">
                      <input
                        type="checkbox"
                        checked={
                          selected.size === filteredPersons.length && filteredPersons.length > 0
                        }
                        onChange={toggleAll}
                        className="rounded"
                      />
                    </th>
                    <SortableTh
                      label={t('admin.orgPersons.colName')}
                      sortKey="name"
                      activeKey={sortKey}
                      dir={sortDir}
                      onClick={() => toggleSort('name')}
                    >
                      <input
                        type="search"
                        placeholder={t('organizer.persons.searchPlaceholder')}
                        aria-label={t('organizer.persons.searchPlaceholder')}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-36 rounded-lg border border-border px-2 py-1 text-xs font-normal focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </SortableTh>
                    <SortableTh
                      label={t('admin.orgPersons.colClub')}
                      sortKey="club"
                      activeKey={sortKey}
                      dir={sortDir}
                      onClick={() => toggleSort('club')}
                    >
                      <select
                        value={clubFilter}
                        onChange={(e) => setClubFilter(e.target.value)}
                        aria-label={t('organizer.persons.filterByClub')}
                        className="max-w-36 rounded-lg border border-border px-2 py-1 text-xs font-normal text-foreground-secondary focus:outline-none focus:ring-2 focus:ring-accent"
                      >
                        <option value="all">{t('organizer.persons.allClubs')}</option>
                        <option value="none">{t('organizer.persons.noClub')}</option>
                        {clubOptions.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </SortableTh>
                    <SortableTh
                      label={t('admin.orgPersons.colClaimStatus')}
                      sortKey="claim"
                      activeKey={sortKey}
                      dir={sortDir}
                      onClick={() => toggleSort('claim')}
                    />
                    <SortableTh
                      label={t('admin.orgPersons.colTournaments')}
                      sortKey="tournaments"
                      activeKey={sortKey}
                      dir={sortDir}
                      onClick={() => toggleSort('tournaments')}
                    />
                    <SortableTh
                      label={t('organizer.persons.refereeColumn')}
                      sortKey="referee"
                      activeKey={sortKey}
                      dir={sortDir}
                      onClick={() => toggleSort('referee')}
                    >
                      <select
                        value={refereeFilter}
                        onChange={(e) =>
                          setRefereeFilter(e.target.value as PersonFilterValue['referee'])
                        }
                        aria-label={t('organizer.persons.filterByReferee')}
                        className="rounded-lg border border-border px-2 py-1 text-xs font-normal text-foreground-secondary focus:outline-none focus:ring-2 focus:ring-accent"
                      >
                        <option value="all">{t('organizer.persons.refereeFilterAll')}</option>
                        <option value="referee">{t('organizer.persons.refereeFilterOnly')}</option>
                        <option value="non_referee">
                          {t('organizer.persons.refereeFilterNon')}
                        </option>
                      </select>
                    </SortableTh>
                    <SortableTh
                      label={t('organizer.persons.instructorColumn')}
                      sortKey="instructor"
                      activeKey={sortKey}
                      dir={sortDir}
                      onClick={() => toggleSort('instructor')}
                    >
                      <select
                        value={instructorFilter}
                        onChange={(e) =>
                          setInstructorFilter(e.target.value as PersonFilterValue['instructor'])
                        }
                        aria-label={t('organizer.persons.filterByInstructor')}
                        className="rounded-lg border border-border px-2 py-1 text-xs font-normal text-foreground-secondary focus:outline-none focus:ring-2 focus:ring-accent"
                      >
                        <option value="all">{t('organizer.persons.instructorFilterAll')}</option>
                        <option value="instructor">
                          {t('organizer.persons.instructorFilterOnly')}
                        </option>
                        <option value="non_instructor">
                          {t('organizer.persons.instructorFilterNon')}
                        </option>
                      </select>
                    </SortableTh>
                    <th className="sticky right-0 z-10 bg-surface py-2 pl-3 font-medium whitespace-nowrap shadow-[inset_1px_0_0_var(--color-border)]">
                      {t('admin.orgPersons.colActions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPersons.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-sm text-muted">
                        {t('admin.orgPersons.noParticipantsFound')}
                      </td>
                    </tr>
                  ) : (
                    filteredPersons.map((p) => {
                      const regs = registrationsByPersonId.get(p.id) ?? [];
                      const displayRegs =
                        activeTab === 'all'
                          ? regs
                          : regs.filter((r) => r.tournamentId === activeTab);
                      return (
                        <tr key={p.id} className="group border-b border-border hover:bg-background">
                          <td className="py-2 pr-3">
                            <input
                              type="checkbox"
                              checked={selected.has(p.id)}
                              onChange={() => toggleSelect(p.id)}
                              className="rounded"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <p className="font-medium text-foreground">
                              {formatRosterName({
                                familyName: p.familyName,
                                givenName: p.givenName,
                              })}
                            </p>
                            {p.email && <p className="text-xs text-muted font-mono">{p.email}</p>}
                          </td>
                          <td className="py-2 pr-4 text-foreground-secondary">
                            {p.clubLabel ?? '—'}
                          </td>
                          <td className="py-2 pr-4">
                            <span
                              className={[
                                'text-xs px-2 py-0.5 rounded-full font-medium',
                                CLAIM_COLORS[p.claimStatus] ?? '',
                              ].join(' ')}
                            >
                              {p.claimStatus.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-2 pr-4">
                            {displayRegs.length === 0 ? (
                              <span className="text-muted text-xs">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {displayRegs.map((r) => {
                                  const tour = tournaments.find(
                                    (tour) => tour.id === r.tournamentId,
                                  );
                                  return (
                                    <span
                                      key={r.id}
                                      className={[
                                        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium',
                                        REG_STATUS_COLORS[r.status] ?? '',
                                      ].join(' ')}
                                      title={r.tournamentName}
                                    >
                                      <TournamentColorDot color={tour?.color} />
                                      {activeTab === 'all'
                                        ? r.tournamentName
                                        : r.status.replace('_', ' ')}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            {p.globalPersonId && refereePersonIds.has(p.globalPersonId) ? (
                              <SkillBadge
                                color="violet"
                                label={
                                  !p.claimedByUserId
                                    ? `${t('organizer.persons.refereeTag')} · ${t('organizer.persons.refereeUnclaimedBadge')}`
                                    : t('organizer.persons.refereeTag')
                                }
                              />
                            ) : null}
                          </td>
                          <td className="py-2 pr-4">
                            {p.globalPersonId && instructorPersonIds.has(p.globalPersonId) ? (
                              <SkillBadge
                                color="amber"
                                label={t('organizer.persons.instructorTag')}
                              />
                            ) : null}
                          </td>
                          <td className="sticky right-0 z-10 bg-surface py-2 pl-3 whitespace-nowrap shadow-[inset_1px_0_0_var(--color-border)] group-hover:bg-background">
                            <div className="flex gap-2">
                              <button
                                onClick={() => openEdit(p)}
                                disabled={isReadOnly}
                                title={
                                  isReadOnly
                                    ? t('organizer.deletionRequest.archivedReadOnly')
                                    : undefined
                                }
                                className="text-xs text-info hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {t('admin.orgPersons.edit')}
                              </button>
                              <button
                                onClick={() => void handleDelete(p.id)}
                                disabled={isReadOnly}
                                title={
                                  isReadOnly
                                    ? t('organizer.deletionRequest.archivedReadOnly')
                                    : undefined
                                }
                                className="text-xs text-danger hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {t('admin.orgPersons.delete')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Claim-status legend. Pills match the column palette exactly so the
          column reads as documented. */}
          <div className="mt-3 flex flex-col gap-1 text-xs text-foreground-secondary sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <span className="font-semibold text-muted">
              {t('admin.orgPersons.claimStatusLegend')}
            </span>
            <span className="inline-flex items-center gap-2">
              <span className={`${CLAIM_COLORS.unclaimed} px-2 py-0.5 rounded-full font-medium`}>
                {t('admin.orgPersons.claimUnclaimed')}
              </span>
              <span>{t('admin.orgPersons.claimUnclaimedHint')}</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <span className={`${CLAIM_COLORS.guest_active} px-2 py-0.5 rounded-full font-medium`}>
                {t('admin.orgPersons.claimGuestActive')}
              </span>
              <span>{t('admin.orgPersons.claimGuestActiveHint')}</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <span className={`${CLAIM_COLORS.claimed} px-2 py-0.5 rounded-full font-medium`}>
                {t('admin.orgPersons.claimClaimed')}
              </span>
              <span>{t('admin.orgPersons.claimClaimedHint')}</span>
            </span>
          </div>

          {deleteModal && (
            <DeleteParticipantModal
              apiUrl={apiUrl}
              eventId={eventId}
              persons={deleteModal.persons.map((p) => ({
                id: p.id,
                displayName: `${p.givenName} ${p.familyName}`.trim() || p.id,
              }))}
              tournamentId={deleteModal.scope}
              registrationsInScope={registrations.map((r) => ({
                registrationId: r.id,
                personId: r.personId,
                tournamentId: r.tournamentId,
              }))}
              onClose={() => setDeleteModal(null)}
              onDeleted={({ succeeded, skipped }) => {
                setDeleteModal(null);
                setSelected(new Set());
                const skippedDetails = skipped.map((s) => `${s.name}: ${s.reason}`).join(' · ');
                if (succeeded.length > 0 && skipped.length === 0) {
                  toast.success(
                    t('admin.orgPersons.toastRemovedParticipants', { count: succeeded.length }),
                  );
                } else if (succeeded.length > 0 && skipped.length > 0) {
                  toast.warning(`Removed ${succeeded.length} · Skipped: ${skippedDetails}`);
                } else if (succeeded.length === 0 && skipped.length > 0) {
                  toast.warning(`Skipped: ${skippedDetails}`);
                }
                refresh();
              }}
            />
          )}

          {showAdd && (
            <div className="fixed inset-0 bg-slate-950/40 flex items-center justify-center z-50 p-4">
              <div className="bg-surface rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                <h2 className="font-display font-semibold text-lg sm:text-xl mb-4">
                  {t('admin.orgPersons.addParticipantTitle')}
                </h2>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    {t('admin.orgPersons.searchGlobalProfiles')}
                  </label>
                  <input
                    type="search"
                    value={globalSearch}
                    onChange={(e) => {
                      setGlobalSearch(e.target.value);
                      setSelectedGlobalId(null);
                    }}
                    placeholder={t('admin.orgPersons.searchNamePlaceholder')}
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  {globalSuggestions.length > 0 && !selectedGlobalId && (
                    <div className="border border-border rounded-lg mt-1 max-h-36 overflow-y-auto">
                      {globalSuggestions.map((g) => {
                        const alreadyAdded = existingGlobalIds.has(g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            disabled={alreadyAdded}
                            onClick={() => {
                              if (alreadyAdded) return;
                              setSelectedGlobalId(g.id);
                              setGlobalSearch(g.displayName);
                              setGlobalSuggestions([]);
                              setAddForm((f) => ({
                                ...f,
                                givenName: g.givenName,
                                familyName: g.familyName,
                                hemaRatingsId: g.hemaRatingsId ?? '',
                              }));
                              if (g.clubLabel) {
                                setSelectedClubId(g.clubId);
                                setSelectedClubLabel(g.clubLabel);
                                setClubSearch(g.clubLabel);
                                setClubSuggestions([]);
                              }
                            }}
                            className={
                              alreadyAdded
                                ? 'w-full text-left px-3 py-2 text-sm bg-background text-muted border-b border-border last:border-0 cursor-not-allowed'
                                : 'w-full text-left px-3 py-2 text-sm hover:bg-background border-b border-border last:border-0'
                            }
                          >
                            <span className="font-medium">{g.displayName}</span>
                            {g.clubLabel && (
                              <span className="text-muted ml-2 text-xs">{g.clubLabel}</span>
                            )}
                            {alreadyAdded && (
                              <span className="ml-2 text-xs italic text-muted">
                                {t('admin.orgPersons.alreadyInEvent')}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {selectedGlobalId && (
                    <p className="text-xs text-success mt-1">
                      {t('admin.orgPersons.linkedToGlobalProfile')}{' '}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => {
                          setSelectedGlobalId(null);
                          setGlobalSearch('');
                        }}
                      >
                        {t('admin.orgPersons.clear')}
                      </button>
                    </p>
                  )}
                </div>

                <hr className="my-3 border-border" />

                <p className="mb-3 text-sm font-semibold text-foreground-secondary">
                  {t('admin.orgPersons.orCreateManually')}
                </p>

                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">
                        {t('admin.orgPersons.givenName')}
                      </label>
                      <input
                        type="text"
                        data-testid="person-given-name"
                        value={addForm.givenName}
                        onChange={(e) => setAddForm((f) => ({ ...f, givenName: e.target.value }))}
                        className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">
                        {t('admin.orgPersons.familyName')}
                      </label>
                      <input
                        type="text"
                        data-testid="person-family-name"
                        value={addForm.familyName}
                        onChange={(e) => setAddForm((f) => ({ ...f, familyName: e.target.value }))}
                        className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                      {t('admin.orgPersons.email')}
                    </label>
                    <input
                      type="email"
                      value={addForm.email}
                      onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                      {t('admin.orgPersons.club')}
                    </label>
                    <input
                      type="search"
                      value={clubSearch}
                      onChange={(e) => {
                        setClubSearch(e.target.value);
                        setSelectedClubId(null);
                        setSelectedClubLabel('');
                        setNewClubName(null);
                      }}
                      placeholder={t('admin.orgPersons.clubSearchPlaceholder')}
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    {!selectedClubId &&
                      !newClubName &&
                      (() => {
                        const rows = computeClubPickerRows(
                          clubSearch,
                          clubSuggestions as ClubPickerSuggestion[],
                        );
                        if (rows.length === 0) return null;
                        return (
                          <div className="border border-border rounded-lg mt-1 max-h-36 overflow-y-auto">
                            {rows.map((row, idx) =>
                              row.kind === 'existing' ? (
                                <button
                                  key={`existing-${row.club.id}`}
                                  type="button"
                                  onClick={() => {
                                    setSelectedClubId(row.club.id);
                                    setSelectedClubLabel(row.club.name);
                                    setClubSearch(row.club.name);
                                    setClubSuggestions([]);
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-background border-b border-border last:border-0"
                                >
                                  <span className="font-medium">{row.club.name}</span>
                                  {row.club.abbreviation && (
                                    <span className="text-muted ml-2 text-xs">
                                      {row.club.abbreviation}
                                    </span>
                                  )}
                                </button>
                              ) : (
                                <button
                                  key={`create-${idx}`}
                                  type="button"
                                  data-testid="new-club-create-row"
                                  onClick={() => {
                                    setNewClubName(row.name);
                                    setSelectedClubId(null);
                                    setSelectedClubLabel('');
                                    setClubSuggestions([]);
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-accent/10 border-b border-border last:border-0 font-medium"
                                >
                                  {t('admin.orgPersons.createNewClub', { name: row.name })}
                                </button>
                              ),
                            )}
                          </div>
                        );
                      })()}
                    {selectedClubId && (
                      <p className="text-xs text-success mt-1">
                        {selectedClubLabel}{' '}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            setSelectedClubId(null);
                            setSelectedClubLabel('');
                            setClubSearch('');
                          }}
                        >
                          {t('admin.orgPersons.clear')}
                        </button>
                      </p>
                    )}
                    {newClubName && (
                      <p className="text-xs text-success mt-1" data-testid="new-club-chip">
                        {t('admin.orgPersons.newClubPrefix')}{' '}
                        <span className="font-medium">{newClubName}</span>{' '}
                        {t('admin.orgPersons.newClubSuffix')}{' '}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            setNewClubName(null);
                            setClubSearch('');
                          }}
                        >
                          {t('admin.orgPersons.clear')}
                        </button>
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                      {t('admin.orgPersons.hemaRatingsIdOptional')}
                    </label>
                    <input
                      type="text"
                      value={addForm.hemaRatingsId}
                      onChange={(e) => setAddForm((f) => ({ ...f, hemaRatingsId: e.target.value }))}
                      placeholder={t('admin.orgPersons.hemaRatingsIdPlaceholder')}
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>

                  <HemaRatingsSuggest
                    apiUrl={apiUrl}
                    personName={`${addForm.givenName} ${addForm.familyName}`.trim()}
                    selectedId={addForm.hemaRatingsId}
                    onSelect={(s) => setAddForm((f) => ({ ...f, hemaRatingsId: s?.id ?? '' }))}
                  />

                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                      {t('admin.orgPersons.seedOptional')}
                    </label>
                    <input
                      type="number"
                      value={addForm.seed}
                      onChange={(e) => setAddForm((f) => ({ ...f, seed: e.target.value }))}
                      min="1"
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>

                  <label className="mt-3 inline-flex items-center gap-2 text-sm text-foreground-secondary">
                    <input
                      type="checkbox"
                      checked={addForm.isReferee}
                      disabled={isReadOnly}
                      onChange={(e) => setAddForm((f) => ({ ...f, isReferee: e.target.checked }))}
                    />
                    {t('organizer.persons.addAsReferee')}
                  </label>

                  <label className="inline-flex items-center gap-2 text-sm text-foreground-secondary">
                    <input
                      type="checkbox"
                      checked={addForm.isInstructor}
                      disabled={isReadOnly}
                      onChange={(e) =>
                        setAddForm((f) => ({ ...f, isInstructor: e.target.checked }))
                      }
                    />
                    {t('organizer.persons.addAsInstructor')}
                  </label>

                  {tournaments.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-2">
                        {t('admin.orgPersons.registerInTournaments')}
                      </label>
                      <div className="flex flex-col gap-1.5">
                        {tournaments.map((tour) => (
                          <label
                            key={tour.id}
                            className="flex items-center gap-2 text-sm cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedTournaments.has(tour.id)}
                              onChange={() =>
                                setSelectedTournaments((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(tour.id)) next.delete(tour.id);
                                  else next.add(tour.id);
                                  return next;
                                })
                              }
                              className="rounded"
                            />
                            {tour.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {addError && (
                  <p className="text-sm text-danger mt-3" role="alert">
                    {addError}
                  </p>
                )}

                <div className="flex justify-end gap-2 mt-5">
                  <button
                    onClick={closeAddModal}
                    className="text-sm text-muted hover:text-foreground-secondary px-4 py-2"
                  >
                    {t('admin.orgPersons.cancel')}
                  </button>
                  <button
                    onClick={() => void handleAdd()}
                    data-testid="persons-add-submit"
                    disabled={addSaving}
                    className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
                  >
                    {addSaving
                      ? t('admin.orgPersons.adding')
                      : t('admin.orgPersons.addParticipantTitle')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {editPerson && (
            <div className="fixed inset-0 bg-slate-950/40 flex items-center justify-center z-50 p-4">
              <div className="bg-surface rounded-xl shadow-xl w-full max-w-md p-6">
                <h2 className="font-display font-semibold text-lg sm:text-xl mb-4">
                  {t('admin.orgPersons.editParticipantTitle')}
                </h2>
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">
                        {t('admin.orgPersons.givenName')}
                      </label>
                      <input
                        type="text"
                        value={editForm.givenName}
                        onChange={(e) => setEditForm((f) => ({ ...f, givenName: e.target.value }))}
                        className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">
                        {t('admin.orgPersons.familyName')}
                      </label>
                      <input
                        type="text"
                        value={editForm.familyName}
                        onChange={(e) => setEditForm((f) => ({ ...f, familyName: e.target.value }))}
                        className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                      {t('admin.orgPersons.email')}
                    </label>
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                      {t('admin.orgPersons.club')}
                    </label>
                    <input
                      type="search"
                      value={editClubSearch}
                      onChange={(e) => {
                        setEditClubSearch(e.target.value);
                        setEditClubId(null);
                        setEditClubLabel('');
                      }}
                      placeholder={t('admin.orgPersons.searchClubPlaceholder')}
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    {editClubSuggestions.length > 0 && !editClubId && (
                      <div className="border border-border rounded-lg mt-1 max-h-36 overflow-y-auto">
                        {editClubSuggestions.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setEditClubId(c.id);
                              setEditClubLabel(c.name);
                              setEditClubSearch(c.name);
                              setEditClubSuggestions([]);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-background border-b border-border last:border-0"
                          >
                            <span className="font-medium">{c.name}</span>
                            {c.abbreviation && (
                              <span className="text-muted ml-2 text-xs">{c.abbreviation}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    {editClubId && (
                      <p className="text-xs text-success mt-1">
                        {editClubLabel}{' '}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            setEditClubId(null);
                            setEditClubLabel('');
                            setEditClubSearch('');
                          }}
                        >
                          {t('admin.orgPersons.clear')}
                        </button>
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                      {t('admin.orgPersons.hemaRatingsId')}
                    </label>
                    <input
                      type="text"
                      value={editForm.hemaRatingsId}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, hemaRatingsId: e.target.value }))
                      }
                      placeholder={t('admin.orgPersons.hemaRatingsIdShortPlaceholder')}
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                  {/* R6: referee checkbox is always enabled. Unclaimed persons
                  get a person_id-keyed event_referees row; once they claim,
                  the row auto-flips to user_id-keyed. */}
                  <div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editForm.isReferee}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, isReferee: e.target.checked }))
                        }
                        className="rounded"
                      />
                      <span className="text-foreground-secondary">
                        {t('organizer.persons.addAsReferee')}
                      </span>
                    </label>
                    {!editPerson.claimedByUserId && editForm.isReferee && (
                      <p className="text-xs text-muted mt-1">
                        {t('organizer.persons.refereeUnclaimedHint')}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editForm.isInstructor}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, isInstructor: e.target.checked }))
                        }
                        className="rounded"
                      />
                      <span className="text-foreground-secondary">
                        {t('organizer.persons.addAsInstructor')}
                      </span>
                    </label>
                  </div>
                  {tournaments.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-2">
                        {t('admin.orgPersons.tournaments')}
                      </label>
                      <div className="flex flex-col gap-1.5">
                        {tournaments.map((tour) => (
                          <label
                            key={tour.id}
                            className="flex items-center gap-2 text-sm cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={editSelectedTournaments.has(tour.id)}
                              onChange={() =>
                                setEditSelectedTournaments((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(tour.id)) next.delete(tour.id);
                                  else next.add(tour.id);
                                  return next;
                                })
                              }
                              className="rounded"
                            />
                            {tour.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {editError && (
                  <p className="text-sm text-danger mt-3" role="alert">
                    {editError}
                  </p>
                )}
                <div className="flex justify-end gap-2 mt-5">
                  <button
                    onClick={() => setEditPerson(null)}
                    className="text-sm text-muted hover:text-foreground-secondary px-4 py-2"
                  >
                    {t('admin.orgPersons.cancel')}
                  </button>
                  <button
                    onClick={() => void handleEditSave()}
                    disabled={editSaving}
                    className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
                  >
                    {editSaving ? t('admin.orgPersons.saving') : t('admin.orgPersons.saveChanges')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={waitlistPrompt !== null && waitlistPrompt.length > 0}
        title={t('organizer.persons.tournamentFullTitle')}
        description={
          waitlistPrompt && waitlistPrompt.length > 0 ? (
            <div>
              <p>{t('organizer.persons.tournamentFullDescription')}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {waitlistPrompt.map((row, idx) => (
                  <li key={`${row.tournamentId}-${row.personId}-${idx}`}>
                    {t('organizer.persons.tournamentFullEntry', {
                      tournamentName: row.tournamentName,
                      count: row.registeredCount,
                      max: row.maxParticipants,
                      personName: row.personName,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            ''
          )
        }
        confirmLabel={t('organizer.persons.addToWaitingList')}
        busy={waitlistBusy}
        onConfirm={() => void confirmWaitlist()}
        onCancel={() => setWaitlistPrompt(null)}
      />
      {confirmDialog}
    </main>
  );
}

function SortableTh<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  children,
}: {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: 'asc' | 'desc';
  onClick: () => void;
  /** Optional inline filter control rendered next to the label (the
   *  sort trigger is the label button, so the control doesn't need any
   *  event gymnastics to avoid sorting). */
  children?: ReactNode;
}) {
  const active = activeKey === sortKey;
  const ariaSort: 'ascending' | 'descending' | 'none' = active
    ? dir === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none';
  return (
    <th className="py-2 pr-4 font-medium" aria-sort={ariaSort}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClick}
          className="inline-flex items-center gap-1 hover:text-foreground-secondary focus:outline-none"
        >
          <span>{label}</span>
          <span className={active ? 'text-foreground-secondary' : 'text-muted'}>
            {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </button>
        {children}
      </div>
    </th>
  );
}
