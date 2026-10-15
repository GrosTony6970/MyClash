'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { EventCrumb, OrgCrumb } from '@/components/Crumbs';
import { PageAlert, errorOutcome, type Outcome } from '@/components/PageAlert';
import {
  ConfirmDialog,
  Modal,
  SkillBadge,
  TournamentColorDot,
  fuzzyMatch,
  nameOrUnknown,
  statusLabel,
  statusLabelKey,
  useConfirm,
  useToast,
  type RegistrationStatus,
} from '@myclash/ui';
import { HemaRatingsSuggest } from '@/components/HemaRatingsSuggest';
import { mapGlobalPersonSuggestion, type GlobalPersonSuggestion } from './global-person-mapper';
import { formatRosterName } from './roster-name';
import { editPersonBody } from './edit-person-body';
import { personMatchesFilter, type PersonFilterValue } from './filter-persons';
import { useRosterFilters } from './useRosterFilters';
import { rosterCsv, rosterRows } from './roster-export';
import {
  computeClubPickerRows,
  type ClubPickerRow,
  type ClubSuggestion as ClubPickerSuggestion,
} from './_components/club-picker-rows';
import { DeleteParticipantModal } from './_components/DeleteParticipantModal';
import { MailPassesButton } from './_components/MailPassesButton';
import { WaitingListPanel } from './_components/WaitingListPanel';
import { addToWaitingList, tryRegisterInTournament } from './_components/registration-helpers';
import { useEventStatus } from '../_hooks/useEventStatus';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { downloadCsv } from '@/lib/csv-file';
import { CsvExportMenu } from '@/components/CsvExportMenu';
import type { CsvFormat } from '@myclash/types';
import { ALL_TOURNAMENTS } from '@/lib/tournament-choice';
import { useTournamentChoice } from '@/hooks/useTournamentChoice';

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
  status: RegistrationStatus;
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
  withdrawn: 'bg-danger/10 text-danger',
  disqualified: 'bg-danger/10 text-danger',
};

/**
 * One registration chip: the tournament's colour dot plus a status-toned pill.
 *
 * A fighter can hold half a dozen registrations, so this cell packs many chips
 * into one row — it stays purely presentational and carries no per-chip
 * affordance. The `StatusHelp` ⓘ that used to sit here was dropped for exactly
 * that reason: six overlapping popovers on one row explained nothing.
 */
function RegistrationStatusChip({
  status,
  label,
  tournamentName,
  color,
}: {
  status: string;
  label: string;
  tournamentName: string;
  color?: string | null;
}) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium',
        REG_STATUS_COLORS[status] ?? '',
      ].join(' ')}
      title={tournamentName}
    >
      <TournamentColorDot color={color} />
      {label}
    </span>
  );
}

export default function ParticipantsPage() {
  const { t } = useI18n();

  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = getPublicApiUrl();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { isReadOnly } = useEventStatus(eventId);

  const [persons, setPersons] = useState<Person[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  // The tab is in the address, so a dashboard row's link and a refresh keep it. Opened bare,
  // the roster shows every Tournament: it never opens on the last one picked (ruled 2026-10-14).
  // No choice before the list first lands: "all" would replace a link's Tournament.
  const [tabsKnown, setTabsKnown] = useState(false);
  const [chosenTab, setActiveTab] = useTournamentChoice(
    eventId,
    tabsKnown ? [ALL_TOURNAMENTS, ...tournaments.map((tour) => tour.id)] : [],
    { remember: false },
  );
  const activeTab = chosenTab || ALL_TOURNAMENTS;
  // Inline header filters: 'all' | 'none' | clubId, and referee tri-state. In the address.
  const {
    search,
    setSearch,
    clubFilter,
    setClubFilter,
    refereeFilter,
    setRefereeFilter,
    instructorFilter,
    setInstructorFilter,
  } = useRosterFilters();
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
      // The query holds the Tournament tab: keep it.
      const { pathname, search } = window.location;
      window.history.replaceState(null, '', `${pathname}${search}${desired}`);
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
  const addFormId = useId();
  const addGivenName = useRef<HTMLInputElement>(null);
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  /** The roster's own read failed: said on the page, not in a window. */
  const [readFailure, setReadFailure] = useState<Outcome | null>(null);
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
    const init = { signal: controller.signal };
    void Promise.all([
      apiRequest<Person[]>(apiUrl, `/api/v1/events/${eventId}/persons`, init),
      apiRequest<Registration[]>(apiUrl, `/api/v1/events/${eventId}/registrations`, init),
      apiRequest<Array<Tournament & { max_waitlist?: number | null }>>(
        apiUrl,
        `/api/v1/events/${eventId}/tournaments`,
        init,
      ),
    ]).then(([pRes, rRes, tRes]) => {
      setLoading(false);
      // A list that did not land knows no Tournament: the tab shows "all" and writes nothing.
      if (tRes.ok) setTabsKnown(true);
      if (pRes.ok) setPersons(pRes.data);
      if (rRes.ok) setRegistrations(rRes.data);
      if (tRes.ok) {
        setTournaments(
          tRes.data.map((tournament) => ({
            id: tournament.id,
            name: tournament.name,
            color: tournament.color ?? null,
            maxWaitlist: tournament.maxWaitlist ?? tournament.max_waitlist ?? null,
          })),
        );
      }
      // The three lists were tolerant and stay tolerant — the roster draws from
      // whatever landed — but a refusal reached nothing at all, so an empty
      // roster and a refused roster looked identical. It is the PAGE's alert: it
      // once went to the Add window's line, and showed only when that opened.
      const failed = [pRes, rRes, tRes].find((r) => !r.ok);
      const message =
        failed && !failed.ok ? failureMessage(failed, t, t('admin.orgPersons.loadError')) : null;
      setReadFailure(message ? errorOutcome(message) : null);
    });
    return () => controller.abort();
  }, [eventId, apiUrl, refreshKey, t]);

  // Fetch the event's referee list once per refresh.
  // Post-0063: every row carries a personId; userId is a derived display field.
  useEffect(() => {
    const controller = new AbortController();
    // Silent: this only decides which rows show the referee pill, and the
    // roster read above already reports a refusal.
    void apiRequest<Array<{ personId: string; userId: string | null }>>(
      apiUrl,
      `/api/v1/events/${eventId}/referees`,
      { signal: controller.signal },
    ).then((r) => {
      if (!r.ok) return;
      setRefereePersonIds(new Set(r.data.map((row) => row.personId)));
    });
    return () => controller.abort();
  }, [eventId, apiUrl, refreshKey]);

  // Fetch the event's instructor roster once per refresh (mirrors referees).
  useEffect(() => {
    const controller = new AbortController();
    // Silent, same reason as the referee roster above.
    void apiRequest<Array<{ personId: string; displayName: string }>>(
      apiUrl,
      `/api/v1/events/${eventId}/instructors`,
      { signal: controller.signal },
    ).then((r) => {
      if (!r.ok) return;
      setInstructorPersonIds(new Set(r.data.map((row) => row.personId)));
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
      // Silent: a suggestion list that will not load shows nothing, and the
      // operator can still type the name in full.
      void apiRequest<Array<Record<string, unknown>>>(
        apiUrl,
        `/api/v1/global-persons?q=${encodeURIComponent(globalSearch)}`,
      ).then((r) => {
        if (r.ok) setGlobalSuggestions(r.data.map(mapGlobalPersonSuggestion));
      });
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
      void apiRequest<ClubSuggestion[]>(
        apiUrl,
        `/api/v1/clubs?q=${encodeURIComponent(clubSearch)}&searchAbv=true`,
      ).then((r) => {
        if (r.ok) setClubSuggestions(r.data);
      });
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
      void apiRequest<ClubSuggestion[]>(
        apiUrl,
        `/api/v1/clubs?q=${encodeURIComponent(editClubSearch)}&searchAbv=true`,
      ).then((r) => {
        if (r.ok) setEditClubSuggestions(r.data);
      });
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

  /** The rows on screen as a CSV for the desk (O19). */
  function exportRoster(format: CsvFormat) {
    const rows = rosterRows(
      filteredPersons,
      registrationsByPersonId,
      activeTab,
      refereePersonIds,
      instructorPersonIds,
      formatRosterName,
    );
    downloadCsv('roster.csv', rosterCsv(rows, activeTab !== ALL_TOURNAMENTS, t, format));
  }

  /** Empties the person and the club; the ticked Tournaments stay (O16, the next walk-in). */
  function clearAddPerson() {
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
  }

  function closeAddModal() {
    setShowAdd(false);
    clearAddPerson();
    setSelectedTournaments(new Set());
  }

  function pickProfile(g: GlobalPersonSuggestion) {
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
  }

  function pickClubRow(row: ClubPickerRow) {
    if (row.kind === 'existing') {
      setSelectedClubId(row.club.id);
      setSelectedClubLabel(row.club.name);
      setClubSearch(row.club.name);
    } else {
      setNewClubName(row.name);
      setSelectedClubId(null);
      setSelectedClubLabel('');
    }
    setClubSuggestions([]);
  }

  // The club list as shown under the club field: none once a club is picked or named.
  const addClubRows =
    selectedClubId || newClubName
      ? []
      : computeClubPickerRows(clubSearch, clubSuggestions as ClubPickerSuggestion[]);

  /**
   * Enter in a search field picks its first suggestion while the list shows (O16, ruled
   * 2026-10-14); with no list, Enter saves the form as anywhere else.
   */
  function enterPicks(event: React.KeyboardEvent, pick: (() => void) | null) {
    if (event.key !== 'Enter' || !pick) return;
    event.preventDefault();
    pick();
  }

  async function handleAdd(another: boolean) {
    if (!addForm.givenName.trim() || !addForm.familyName.trim()) {
      setAddError(t('admin.common.givenAndFamilyNameRequired'));
      return;
    }
    setAddSaving(true);
    setAddError(null);
    const hemaRatingsId = addForm.hemaRatingsId.trim() || null;
    try {
      // The API refuses a same-name entry that carries no email, because with
      // no email there is nothing else to tell two people apart. It is a
      // suspicion, not a fact, so the refusal is resolvable: confirm once and
      // re-send. `details.resolution` is the API saying which flag clears it.
      type CreatedPerson = {
        id: string;
        globalPersonId: string | null;
        claimedByUserId?: string | null;
        mintedIdentity?: 'unmatchable' | 'first_sighting' | null;
      };
      const postPerson = (allowDuplicateName: boolean) =>
        apiRequest<CreatedPerson>(apiUrl, `/api/v1/events/${eventId}/persons`, {
          method: 'POST',
          body: {
            givenName: addForm.givenName.trim(),
            familyName: addForm.familyName.trim(),
            email: addForm.email.trim() || null,
            clubId: selectedClubId || null,
            newClubName: newClubName || null,
            hemaRatingsId,
            globalPersonId: selectedGlobalId || null,
            ...(allowDuplicateName ? { allowDuplicateName: true } : {}),
          },
        });

      let personRes = await postPerson(false);
      if (
        !personRes.ok &&
        personRes.kind === 'http' &&
        personRes.status === 409 &&
        personRes.details?.['resolution'] === 'allowDuplicateName'
      ) {
        const confirmed = await confirm({
          cancelLabel: t('actions.cancel'),
          title: t('admin.orgPersons.duplicateNameTitle'),
          description: t('admin.orgPersons.duplicateNameBody', {
            name: `${addForm.givenName.trim()} ${addForm.familyName.trim()}`,
          }),
          confirmLabel: t('admin.orgPersons.duplicateNameConfirm'),
        });
        if (!confirmed) {
          setAddSaving(false);
          return;
        }
        personRes = await postPerson(true);
      }
      if (!personRes.ok) {
        const message = failureMessage(personRes, t, t('admin.common.createParticipantFailed'));
        if (message) setAddError(message);
        return;
      }
      const person = personRes.data;

      // Post-0063: referee registration keys on the person's global_persons.id.
      // The backend's ensureEventReferee also accepts the event-scoped
      // persons.id as a fallback (resolves to global via the persons row),
      // so participants whose globalPersonId isn't cached on this surface
      // still get auto-registered when isReferee is checked.
      if (addForm.isReferee) {
        const refereeId = person.globalPersonId ?? person.id;
        void apiRequest(apiUrl, `/api/v1/events/${eventId}/referees/${refereeId}`, {
          method: 'POST',
        }).then((r) => {
          if (r.ok) return;
          const message = failureMessage(r, t, t('organizer.persons.refereeRegistrationFailed'));
          if (message) toast.warning(message);
        });
      }

      // Instructor tagging — same id-resolution rules as referees.
      if (addForm.isInstructor) {
        const instructorId = person.globalPersonId ?? person.id;
        void apiRequest(apiUrl, `/api/v1/events/${eventId}/instructors/${instructorId}`, {
          method: 'POST',
        }).then((r) => {
          if (r.ok) return;
          const message = failureMessage(r, t, t('organizer.persons.instructorRegistrationFailed'));
          if (message) toast.warning(message);
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
      // Every add says so (O16): at a desk queue, the window may stay open for the next one.
      if (failedTournaments.length > 0) {
        toast.warning(
          t('admin.orgPersons.toastCreatedRegisterFailed', {
            list: failedTournaments.join(', '),
          }),
        );
      } else if (selectedTournaments.size > 0 && fullPending.length === 0) {
        toast.success(
          t('admin.orgPersons.toastAddedToTournaments', {
            name: personName,
            count: selectedTournaments.size,
          }),
        );
      } else {
        toast.success(t('admin.orgPersons.toastAdded', { name: personName }));
      }
      // The identity this add minted can never be matched again — no club, no
      // HEMA Ratings id, no email — so the same person mints another one at the
      // next event and their results never join up. Warn, never block: the
      // participant is already saved and the fix is editing their details.
      if (person.mintedIdentity === 'unmatchable') {
        toast.warning(t('admin.orgPersons.toastUnmatchableIdentity', { name: personName }));
      }
      // A full Tournament asks at once, over the window: before the next person is typed.
      if (fullPending.length > 0) setWaitlistPrompt(fullPending);
      if (another) {
        clearAddPerson();
        addGivenName.current?.focus();
      } else {
        closeAddModal();
      }
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
      const saved = await apiRequest(apiUrl, `/api/v1/persons/${editPerson.id}`, {
        method: 'PATCH',
        body: editPersonBody(editPerson, editForm, editClubId),
      });
      if (!saved.ok) {
        const message = failureMessage(saved, t, t('admin.common.saveFailed'));
        if (message) setEditError(message);
        return;
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
        const r = await apiRequest(apiUrl, `/api/v1/registrations/${reg.id}`, {
          method: 'DELETE',
        });
        if (!r.ok) {
          const tour = tournaments.find((x) => x.id === tournamentId);
          failed.push(tour?.name ?? tournamentId);
        }
      }
      if (failed.length > 0) {
        toast.warning(t('admin.orgPersons.toastSavedAssignFailed', { list: failed.join(', ') }));
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
          const r = await apiRequest(
            apiUrl,
            `/api/v1/events/${eventId}/referees/${editPerson.globalPersonId}`,
            { method: editForm.isReferee ? 'POST' : 'DELETE' },
          );
          if (!r.ok) {
            const message = failureMessage(r, t, t('organizer.persons.refereeUpdateFailed'));
            if (message) toast.warning(message);
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
          const r = await apiRequest(
            apiUrl,
            `/api/v1/events/${eventId}/instructors/${editPerson.globalPersonId}`,
            { method: editForm.isInstructor ? 'POST' : 'DELETE' },
          );
          if (!r.ok) {
            const message = failureMessage(r, t, t('organizer.persons.instructorUpdateFailed'));
            if (message) toast.warning(message);
          }
        }
      }

      setEditPerson(null);
      refresh();
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
    if (
      !(await confirm({
        confirmLabel: t('actions.confirm'),
        cancelLabel: t('actions.cancel'),
        title: t('admin.orgPersons.confirmCheckIn', { count: selected.size }),
      }))
    )
      return;
    setBulkLoading(true);
    let checkInFailures = 0;
    for (const personId of selected) {
      const reg = (registrationsByPersonId.get(personId) ?? []).find(
        (r) => r.tournamentId === activeTab,
      );
      if (!reg) continue;
      const r = await apiRequest(apiUrl, `/api/v1/registrations/${reg.id}/status`, {
        method: 'PATCH',
        body: { status: 'checked_in' },
      });
      // The write had no success check at all, so a refused bulk check-in
      // reported nothing and the roster silently kept the old status.
      if (!r.ok) checkInFailures += 1;
    }
    if (checkInFailures > 0) {
      toast.warning(
        t('organizer.persons.bulk.checkInPartial', { failed: String(checkInFailures) }),
      );
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
      const personName = nameOrUnknown(
        person ? `${person.givenName} ${person.familyName}` : null,
        'fighter',
        t,
      );
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
      toast.warning(
        t('admin.orgPersons.toastRegisterFailedFor', { list: erroredNames.join(', ') }),
      );
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
        confirmLabel: t('actions.confirm'),
        cancelLabel: t('actions.cancel'),
        title: t('organizer.persons.bulk.registerRefereeConfirm', { count: selected.size }),
      }))
    ) {
      return;
    }
    await bulkReferee('POST', 'organizer.persons.bulk.registerRefereeToast');
  }

  /**
   * One write per selected person. A refused write used to be counted out in silence
   * under a green toast: now the toast says how many were refused, and they stay
   * selected, so the next press tries them again.
   */
  async function bulkReferee(method: 'POST' | 'DELETE', doneKey: string) {
    setBulkLoading(true);
    const refused = new Set<string>();
    let reason: string | null = null;
    for (const personId of selected) {
      const person = persons.find((p) => p.id === personId);
      // Mirror the single-person path at the "Add referee" toggle:
      // fall back to event-scoped id when globalPersonId is absent
      // — ensureEventReferee resolves either.
      const targetId = person?.globalPersonId ?? personId;
      const r = await apiRequest(apiUrl, `/api/v1/events/${eventId}/referees/${targetId}`, {
        method,
      });
      if (!r.ok) {
        refused.add(personId);
        // The first refusal's words: counts alone do not say what to fix.
        reason ??= failureMessage(r, t, t('organizer.persons.bulk.refereeRefusedReason'));
      }
    }
    const done = selected.size - refused.size;
    setSelected(refused);
    setBulkLoading(false);
    refresh();
    if (refused.size === 0) toast.success(t(doneKey, { count: done }));
    else {
      const counts = { done: String(done), refused: String(refused.size), reason: reason ?? '' };
      toast.warning(t('organizer.persons.bulk.refereePartial', counts));
    }
  }

  async function handleBulkUnregisterReferee() {
    if (selected.size === 0) return;
    if (
      !(await confirm({
        confirmLabel: t('actions.confirm'),
        cancelLabel: t('actions.cancel'),
        title: t('organizer.persons.bulk.unregisterRefereeConfirm', { count: selected.size }),
        danger: true,
      }))
    ) {
      return;
    }
    await bulkReferee('DELETE', 'organizer.persons.bulk.unregisterRefereeToast');
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
    <main className="mx-auto max-w-[110rem] p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <OrgCrumb slug={slug} className="hover:text-foreground-secondary" />
            <span>/</span>
            <EventCrumb
              slug={slug}
              eventId={eventId}
              className="hover:text-foreground-secondary"
              fallback={t('admin.orgPersons.breadcrumbEvent')}
            />
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
          <MailPassesButton eventId={eventId} disabled={isReadOnly} />
          <Link
            href={`/org/${slug}/events/${eventId}/persons/import`}
            data-testid="persons-import-link"
            className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {t('admin.orgPersons.csvImport')}
          </Link>
          {/* A read, not a save: open on an archived Event too. Closed over the waiting
              list, which is not the rows it would write. */}
          <CsvExportMenu
            label={t('organizer.persons.export.button')}
            onExport={exportRoster}
            disabled={mode === 'waiting-list' || filteredPersons.length === 0}
            className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
          />
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

      <PageAlert outcome={readFailure} className="mb-4" />

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
          readOnly={isReadOnly}
        />
      )}

      {mode === 'persons' && (
        <>
          <div className="flex gap-2 mb-4 flex-wrap">
            {(['all', ...tournaments.map((tour) => tour.id)] as string[]).map((tabId) => {
              const label =
                tabId === 'all'
                  ? t('admin.orgPersons.tabAllParticipants')
                  : (tournaments.find((tour) => tour.id === tabId)?.name ?? tabId);
              const active = activeTab === tabId;
              const count =
                tabId === 'all'
                  ? persons.length
                  : registrations.filter((r) => r.tournamentId === tabId).length;
              return (
                <button
                  key={tabId}
                  aria-pressed={active}
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
                          disabled={bulkLoading || isReadOnly}
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
                              disabled={bulkLoading || isReadOnly}
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
                          setInstructorFilter(
                            e.target.value as NonNullable<PersonFilterValue['instructor']>,
                          )
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
                              {statusLabel('claim', p.claimStatus, t)}
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
                                    <RegistrationStatusChip
                                      key={r.id}
                                      status={r.status}
                                      label={
                                        activeTab === 'all'
                                          ? r.tournamentName
                                          : statusLabel('registration', r.status, t)
                                      }
                                      tournamentName={r.tournamentName}
                                      color={tour?.color}
                                    />
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
                              {/* Open on an archived Event too: the row's own fields
                                stay editable for the export (ruling 222b). */}
                              <button
                                onClick={() => openEdit(p)}
                                className="text-xs text-info hover:underline"
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
                {t(statusLabelKey('claim', 'unclaimed'))}
              </span>
              <span>{t('admin.orgPersons.claimUnclaimedHint')}</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <span className={`${CLAIM_COLORS.guest_active} px-2 py-0.5 rounded-full font-medium`}>
                {t(statusLabelKey('claim', 'guest_active'))}
              </span>
              <span>{t('admin.orgPersons.claimGuestActiveHint')}</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <span className={`${CLAIM_COLORS.claimed} px-2 py-0.5 rounded-full font-medium`}>
                {t(statusLabelKey('claim', 'claimed'))}
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
                displayName: nameOrUnknown(`${p.givenName} ${p.familyName}`, 'person', t),
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
                  toast.warning(
                    t('admin.orgPersons.toastRemovedSkipped', {
                      count: succeeded.length,
                      skipped: skippedDetails,
                    }),
                  );
                } else if (succeeded.length === 0 && skipped.length > 0) {
                  toast.warning(t('admin.orgPersons.toastSkipped', { skipped: skippedDetails }));
                }
                refresh();
              }}
            />
          )}

          <Modal
            open={showAdd}
            onClose={closeAddModal}
            busy={addSaving}
            size="md"
            title={t('admin.orgPersons.addParticipantTitle')}
            footer={
              <>
                <button
                  type="button"
                  onClick={closeAddModal}
                  className="text-sm text-muted hover:text-foreground-secondary px-4 py-2"
                >
                  {t('admin.orgPersons.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdd(true)}
                  data-testid="persons-add-another"
                  disabled={addSaving}
                  className="border border-border hover:bg-background disabled:opacity-50 text-foreground-secondary font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
                >
                  {t('admin.orgPersons.addAnother')}
                </button>
                <button
                  type="submit"
                  form={addFormId}
                  data-testid="persons-add-submit"
                  disabled={addSaving}
                  className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
                >
                  {addSaving
                    ? t('admin.orgPersons.adding')
                    : t('admin.orgPersons.addParticipantTitle')}
                </button>
              </>
            }
          >
            {/* A real form: Enter saves (O16). The footer's submit names it by id. */}
            <form
              id={addFormId}
              onSubmit={(event) => {
                event.preventDefault();
                void handleAdd(false);
              }}
            >
              <div className="mb-4">
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  {t('admin.orgPersons.searchGlobalProfiles')}
                </label>
                <input
                  aria-label={t('admin.orgPersons.searchNamePlaceholder')}
                  type="search"
                  value={globalSearch}
                  onChange={(e) => {
                    setGlobalSearch(e.target.value);
                    setSelectedGlobalId(null);
                  }}
                  onKeyDown={(e) => {
                    const first = selectedGlobalId
                      ? undefined
                      : globalSuggestions.find((g) => !existingGlobalIds.has(g.id));
                    enterPicks(e, first ? () => pickProfile(first) : null);
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
                            if (!alreadyAdded) pickProfile(g);
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
                      ref={addGivenName}
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
                    aria-label={t('admin.orgPersons.clubSearchPlaceholder')}
                    type="search"
                    value={clubSearch}
                    onChange={(e) => {
                      setClubSearch(e.target.value);
                      setSelectedClubId(null);
                      setSelectedClubLabel('');
                      setNewClubName(null);
                    }}
                    onKeyDown={(e) => {
                      const first = addClubRows[0];
                      enterPicks(e, first ? () => pickClubRow(first) : null);
                    }}
                    placeholder={t('admin.orgPersons.clubSearchPlaceholder')}
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  {addClubRows.length > 0 && (
                    <div className="border border-border rounded-lg mt-1 max-h-36 overflow-y-auto">
                      {addClubRows.map((row, idx) =>
                        row.kind === 'existing' ? (
                          <button
                            key={`existing-${row.club.id}`}
                            type="button"
                            onClick={() => pickClubRow(row)}
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
                            onClick={() => pickClubRow(row)}
                            className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-accent/10 border-b border-border last:border-0 font-medium"
                          >
                            {t('admin.orgPersons.createNewClub', { name: row.name })}
                          </button>
                        ),
                      )}
                    </div>
                  )}
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
                    aria-label={t('admin.orgPersons.hemaRatingsIdOptional')}
                    type="text"
                    value={addForm.hemaRatingsId}
                    onChange={(e) => setAddForm((f) => ({ ...f, hemaRatingsId: e.target.value }))}
                    placeholder={t('admin.orgPersons.hemaRatingsIdPlaceholder')}
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>

                <HemaRatingsSuggest
                  apiUrl={apiUrl}
                  eventId={eventId}
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
                    onChange={(e) => setAddForm((f) => ({ ...f, isInstructor: e.target.checked }))}
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
            </form>
          </Modal>

          {editPerson && (
            <Modal
              open
              onClose={() => setEditPerson(null)}
              busy={editSaving}
              size="md"
              title={t('admin.orgPersons.editParticipantTitle')}
              footer={
                <>
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
                </>
              }
            >
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
                    aria-label={t('admin.orgPersons.searchClubPlaceholder')}
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
                    aria-label={t('admin.orgPersons.hemaRatingsId')}
                    type="text"
                    value={editForm.hemaRatingsId}
                    onChange={(e) => setEditForm((f) => ({ ...f, hemaRatingsId: e.target.value }))}
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
                      disabled={isReadOnly}
                      title={
                        isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined
                      }
                      onChange={(e) => setEditForm((f) => ({ ...f, isReferee: e.target.checked }))}
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
                      disabled={isReadOnly}
                      title={
                        isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined
                      }
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
                            disabled={isReadOnly}
                            title={
                              isReadOnly
                                ? t('organizer.deletionRequest.archivedReadOnly')
                                : undefined
                            }
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
            </Modal>
          )}
        </>
      )}

      <ConfirmDialog
        cancelLabel={t('actions.cancel')}
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
