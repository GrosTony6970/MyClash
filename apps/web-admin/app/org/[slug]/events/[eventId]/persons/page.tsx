'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ConfirmDialog, useToast } from '@myclash/ui';
import { HemaRatingsSuggest } from '@/components/HemaRatingsSuggest';
import { mapGlobalPersonSuggestion, type GlobalPersonSuggestion } from './global-person-mapper';

interface Person {
  id: string;
  givenName: string;
  familyName: string;
  email: string | null;
  clubLabel: string | null;
  claimStatus: 'unclaimed' | 'guest_active' | 'claimed';
  hemaRatingsId: string | null;
  globalPersonId: string | null;
}

interface Registration {
  id: string;
  personId: string;
  tournamentId: string;
  tournamentName: string;
  status: 'registered' | 'checked_in' | 'done' | 'withdrawn' | 'disqualified';
  seed: number | null;
}

interface Tournament {
  id: string;
  name: string;
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
}

const EMPTY_ADD_FORM: AddForm = {
  givenName: '',
  familyName: '',
  email: '',
  hemaRatingsId: '',
  seed: '',
};

const CLAIM_COLORS: Record<string, string> = {
  unclaimed: 'bg-gray-100 text-gray-500',
  guest_active: 'bg-yellow-100 text-yellow-700',
  claimed: 'bg-green-100 text-green-700',
};

const REG_STATUS_COLORS: Record<string, string> = {
  registered: 'bg-blue-100 text-blue-700',
  checked_in: 'bg-green-100 text-green-700',
  done: 'bg-gray-100 text-gray-500',
  withdrawn: 'bg-red-100 text-red-500',
  disqualified: 'bg-red-200 text-red-700',
};

export default function ParticipantsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const toast = useToast();

  const [persons, setPersons] = useState<Person[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string>('all');
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
  const [pendingDelete, setPendingDelete] = useState<Person | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
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
        if (tRes.ok) setTournaments((await tRes.json()) as Tournament[]);
      })
      .catch((err: unknown) => {
        setLoading(false);
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

  useEffect(() => {
    if (globalSearch.trim().length < 2) {
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
      const q = search.toLowerCase();
      list = list.filter((p) => `${p.givenName} ${p.familyName}`.toLowerCase().includes(q));
    }
    return list;
  }, [persons, registrations, activeTab, search]);

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
    setSelectedTournaments(new Set());
  }

  async function handleAdd() {
    if (!addForm.givenName.trim() || !addForm.familyName.trim()) {
      setAddError('Given name and family name are required');
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
          hemaRatingsId,
          globalPersonId: selectedGlobalId || null,
        }),
      });
      if (!personRes.ok) {
        const body = (await personRes.json()) as { message?: string };
        throw new Error(body.message ?? 'Failed to create participant');
      }
      const person = (await personRes.json()) as { id: string };

      // Per-tournament registrations — capture failures so a network blip
      // on one tournament doesn't silently lose the others.
      const failedTournaments: string[] = [];
      for (const tournamentId of selectedTournaments) {
        const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/registrations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            personId: person.id,
            hemaRatingsId,
            seed: addForm.seed ? parseInt(addForm.seed, 10) : undefined,
          }),
        });
        if (!res.ok) {
          const t = tournaments.find((x) => x.id === tournamentId);
          failedTournaments.push(t?.name ?? tournamentId);
        }
      }
      if (failedTournaments.length > 0) {
        toast.warning(
          `Created participant, but failed to register in: ${failedTournaments.join(', ')}.`,
        );
      } else if (selectedTournaments.size > 0) {
        toast.success(
          `Added ${addForm.givenName.trim()} ${addForm.familyName.trim()} to ${selectedTournaments.size} tournament(s).`,
        );
      }
      closeAddModal();
      refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setAddSaving(false);
    }
  }

  function openEdit(p: Person) {
    setEditPerson(p);
    setEditForm({
      givenName: p.givenName,
      familyName: p.familyName,
      email: p.email ?? '',
      hemaRatingsId: p.hemaRatingsId ?? '',
      seed: '',
    });
    setEditClubSearch(p.clubLabel ?? '');
    setEditClubId(null);
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
      setEditError('Given name and family name are required');
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
        throw new Error(body.message ?? 'Save failed');
      }

      // Diff tournament selection vs the original set.
      const toAdd = [...editSelectedTournaments].filter((id) => !editOriginalTournaments.has(id));
      const toRemove = [...editOriginalTournaments].filter(
        (id) => !editSelectedTournaments.has(id),
      );
      const failed: string[] = [];

      for (const tournamentId of toAdd) {
        const r = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/registrations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            personId: editPerson.id,
            hemaRatingsId: editForm.hemaRatingsId.trim() || null,
          }),
        });
        if (!r.ok) {
          const t = tournaments.find((x) => x.id === tournamentId);
          failed.push(t?.name ?? tournamentId);
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
          const t = tournaments.find((x) => x.id === tournamentId);
          failed.push(t?.name ?? tournamentId);
        }
      }
      if (failed.length > 0) {
        toast.warning(
          `Saved profile, but failed to update tournament assignments for: ${failed.join(', ')}.`,
        );
      } else if (toAdd.length > 0 || toRemove.length > 0) {
        toast.success('Profile and tournament assignments updated.');
      }

      setEditPerson(null);
      refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    setPendingBulkDelete(true);
  }

  /**
   * Delete one person. If the server refuses because they have tournament
   * registrations, cascade-delete the registrations first then retry.
   * Returns true on success, false on irrecoverable failure (so callers can
   * count outcomes).
   */
  async function deletePersonCascading(person: Person): Promise<boolean> {
    const firstRes = await fetch(`${apiUrl}/api/v1/persons/${person.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (firstRes.ok) return true;
    const body = (await firstRes.json().catch(() => null)) as { message?: string } | null;
    const message = body?.message ?? '';
    if (!/tournament registrations/iu.test(message)) {
      toast.error(message || `Could not delete ${person.givenName} ${person.familyName}.`);
      return false;
    }
    // Cascade — drop every registration this person has, then retry.
    const regs = registrations.filter((r) => r.personId === person.id);
    for (const reg of regs) {
      await fetch(`${apiUrl}/api/v1/registrations/${reg.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    }
    const retry = await fetch(`${apiUrl}/api/v1/persons/${person.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!retry.ok) {
      const retryBody = (await retry.json().catch(() => null)) as { message?: string } | null;
      toast.error(
        retryBody?.message ?? `Could not delete ${person.givenName} ${person.familyName}.`,
      );
      return false;
    }
    return true;
  }

  async function handleBulkCheckIn() {
    if (selected.size === 0 || activeTab === 'all') return;
    if (!confirm(`Check in ${selected.size} participant(s)?`)) return;
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

  async function handleBulkUnassign() {
    if (selected.size === 0 || activeTab === 'all') return;
    if (!confirm(`Unassign ${selected.size} participant(s) from this tournament?`)) return;
    setBulkLoading(true);
    for (const personId of selected) {
      const reg = (registrationsByPersonId.get(personId) ?? []).find(
        (r) => r.tournamentId === activeTab,
      );
      if (!reg) continue;
      await fetch(`${apiUrl}/api/v1/registrations/${reg.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    }
    setSelected(new Set());
    setBulkLoading(false);
    refresh();
  }

  async function handleBulkAssign(tournamentId: string) {
    if (selected.size === 0 || !tournamentId) return;
    setBulkLoading(true);
    for (const personId of selected) {
      await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ personId }),
      });
    }
    setSelected(new Set());
    setBulkLoading(false);
    setBulkAssignTournamentId('');
    refresh();
  }

  async function handleDelete(personId: string) {
    const person = persons.find((p) => p.id === personId);
    if (!person) return;
    setPendingDelete(person);
  }

  async function confirmDeleteSingle() {
    if (!pendingDelete) return;
    setBulkLoading(true);
    try {
      const ok = await deletePersonCascading(pendingDelete);
      if (ok) {
        toast.success(`Deleted ${pendingDelete.givenName} ${pendingDelete.familyName}.`);
      }
      setPendingDelete(null);
      refresh();
    } finally {
      setBulkLoading(false);
    }
  }

  async function confirmBulkDelete() {
    setPendingBulkDelete(false);
    setBulkLoading(true);
    try {
      let succeeded = 0;
      let failed = 0;
      for (const personId of selected) {
        const person = persons.find((p) => p.id === personId);
        if (!person) continue;
        const ok = await deletePersonCascading(person);
        if (ok) succeeded += 1;
        else failed += 1;
      }
      if (failed === 0) {
        toast.success(`Deleted ${succeeded} participant(s).`);
      } else {
        toast.warning(`Deleted ${succeeded}, ${failed} failed.`);
      }
      setSelected(new Set());
      refresh();
    } finally {
      setBulkLoading(false);
    }
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
    <main className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href={`/org/${slug}`} className="hover:text-gray-700">
              {slug}
            </Link>
            <span>/</span>
            <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
              Event
            </Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">Participants</span>
          </div>
          <h1 className="text-2xl font-bold">Participants</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/org/${slug}/events/${eventId}/persons/import`}
            className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            CSV import
          </Link>
          <button
            onClick={() => setShowAdd(true)}
            className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
          >
            + Add participant
          </button>
        </div>
      </div>

      <div className="mb-4">
        <input
          type="search"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 w-64"
        />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', ...tournaments.map((t) => t.id)] as string[]).map((tabId) => {
          const label =
            tabId === 'all'
              ? 'All event'
              : (tournaments.find((t) => t.id === tabId)?.name ?? tabId);
          const active = activeTab === tabId;
          return (
            <button
              key={tabId}
              onClick={() => {
                setActiveTab(tabId);
                setSelected(new Set());
              }}
              className={[
                'px-3 py-1.5 rounded-full text-sm font-medium transition-colors border',
                active
                  ? 'bg-red-700 text-white border-red-700'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400',
              ].join(' ')}
            >
              {label}
            </button>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg flex-wrap">
          <span className="text-sm text-gray-600 font-medium">{selected.size} selected</span>
          <button
            onClick={() => void handleBulkDelete()}
            disabled={bulkLoading}
            className="text-sm text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
          >
            Delete selected
          </button>
          {activeTab === 'all' && tournaments.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={bulkAssignTournamentId}
                onChange={(e) => setBulkAssignTournamentId(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs"
              >
                <option value="">Assign to tournament…</option>
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {bulkAssignTournamentId && (
                <button
                  onClick={() => void handleBulkAssign(bulkAssignTournamentId)}
                  disabled={bulkLoading}
                  className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  Assign
                </button>
              )}
            </div>
          )}
          {activeTab !== 'all' && (
            <>
              <button
                onClick={() => void handleBulkCheckIn()}
                disabled={bulkLoading}
                className="text-sm text-green-700 hover:text-green-900 font-medium disabled:opacity-50"
              >
                Check in selected
              </button>
              <button
                onClick={() => void handleBulkUnassign()}
                disabled={bulkLoading}
                className="text-sm text-orange-600 hover:text-orange-800 font-medium disabled:opacity-50"
              >
                Unassign from {tournaments.find((t) => t.id === activeTab)?.name ?? 'tournament'}
              </button>
              {tournaments.filter((t) => t.id !== activeTab).length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    value={bulkAssignTournamentId}
                    onChange={(e) => setBulkAssignTournamentId(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs"
                  >
                    <option value="">Assign to another…</option>
                    {tournaments
                      .filter((t) => t.id !== activeTab)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                  {bulkAssignTournamentId && (
                    <button
                      onClick={() => void handleBulkAssign(bulkAssignTournamentId)}
                      disabled={bulkLoading}
                      className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Assign
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : filteredPersons.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">No participants found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === filteredPersons.length && filteredPersons.length > 0}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Club</th>
                <th className="py-2 pr-4 font-medium">Claim status</th>
                <th className="py-2 pr-4 font-medium">Tournaments</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPersons.map((p) => {
                const regs = registrationsByPersonId.get(p.id) ?? [];
                const displayRegs =
                  activeTab === 'all' ? regs : regs.filter((r) => r.tournamentId === activeTab);
                return (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <p className="font-medium text-gray-900">
                        {p.givenName} {p.familyName}
                      </p>
                      {p.email && <p className="text-xs text-gray-400 font-mono">{p.email}</p>}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{p.clubLabel ?? '—'}</td>
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
                        <span className="text-gray-400 text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {displayRegs.map((r) => (
                            <span
                              key={r.id}
                              className={[
                                'text-xs px-2 py-0.5 rounded-full font-medium',
                                REG_STATUS_COLORS[r.status] ?? '',
                              ].join(' ')}
                              title={r.tournamentName}
                            >
                              {activeTab === 'all' ? r.tournamentName : r.status.replace('_', ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void handleDelete(p.id)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Claim-status legend. Pills match the column palette exactly so the
          column reads as documented. */}
      <div className="mt-3 flex flex-col gap-1 text-xs text-gray-600 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <span className="font-semibold text-gray-500">Claim status:</span>
        <span className="inline-flex items-center gap-2">
          <span className={`${CLAIM_COLORS.unclaimed} px-2 py-0.5 rounded-full font-medium`}>
            unclaimed
          </span>
          <span>no MyClash account yet; organizer added them, no claim made</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className={`${CLAIM_COLORS.guest_active} px-2 py-0.5 rounded-full font-medium`}>
            guest active
          </span>
          <span>guest session active (followed the event, no permanent account)</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className={`${CLAIM_COLORS.claimed} px-2 py-0.5 rounded-full font-medium`}>
            claimed
          </span>
          <span>linked to a real MyClash account</span>
        </span>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete participant"
        description={
          pendingDelete
            ? (() => {
                const regCount = registrations.filter(
                  (r) => r.personId === pendingDelete.id,
                ).length;
                const name = `${pendingDelete.givenName} ${pendingDelete.familyName}`;
                return regCount > 0
                  ? `Delete ${name}? They are registered in ${regCount} tournament(s) — those registrations will also be removed.`
                  : `Delete ${name} from this event roster?`;
              })()
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={bulkLoading}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDeleteSingle()}
      />

      <ConfirmDialog
        open={pendingBulkDelete}
        title="Delete participants"
        description={`Delete ${selected.size} participant(s)? Any tournament registrations they have will also be removed.`}
        confirmLabel="Delete all"
        danger
        busy={bulkLoading}
        onCancel={() => setPendingBulkDelete(false)}
        onConfirm={() => void confirmBulkDelete()}
      />

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">Add participant</h2>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Search global profiles by name
              </label>
              <input
                type="search"
                value={globalSearch}
                onChange={(e) => {
                  setGlobalSearch(e.target.value);
                  setSelectedGlobalId(null);
                }}
                placeholder="Type a name to search…"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              />
              {globalSuggestions.length > 0 && !selectedGlobalId && (
                <div className="border border-gray-200 rounded-lg mt-1 max-h-36 overflow-y-auto">
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
                            ? 'w-full text-left px-3 py-2 text-sm bg-slate-50 text-slate-400 border-b border-gray-100 last:border-0 cursor-not-allowed'
                            : 'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0'
                        }
                      >
                        <span className="font-medium">{g.displayName}</span>
                        {g.clubLabel && (
                          <span className="text-gray-400 ml-2 text-xs">{g.clubLabel}</span>
                        )}
                        {alreadyAdded && (
                          <span className="ml-2 text-xs italic text-slate-500">
                            already in event
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedGlobalId && (
                <p className="text-xs text-green-700 mt-1">
                  Linked to global profile.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setSelectedGlobalId(null);
                      setGlobalSearch('');
                    }}
                  >
                    Clear
                  </button>
                </p>
              )}
            </div>

            <hr className="my-3 border-gray-100" />

            <p className="mb-3 text-sm font-semibold text-slate-700">
              Or create profile manually if it does not exist:
            </p>

            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Given name *
                  </label>
                  <input
                    type="text"
                    value={addForm.givenName}
                    onChange={(e) => setAddForm((f) => ({ ...f, givenName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Family name *
                  </label>
                  <input
                    type="text"
                    value={addForm.familyName}
                    onChange={(e) => setAddForm((f) => ({ ...f, familyName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Club</label>
                <input
                  type="search"
                  value={clubSearch}
                  onChange={(e) => {
                    setClubSearch(e.target.value);
                    setSelectedClubId(null);
                    setSelectedClubLabel('');
                  }}
                  placeholder="Search by name or abbreviation…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                {clubSuggestions.length > 0 && !selectedClubId && (
                  <div className="border border-gray-200 rounded-lg mt-1 max-h-36 overflow-y-auto">
                    {clubSuggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedClubId(c.id);
                          setSelectedClubLabel(c.name);
                          setClubSearch(c.name);
                          setClubSuggestions([]);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.abbreviation && (
                          <span className="text-gray-400 ml-2 text-xs">{c.abbreviation}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {selectedClubId && (
                  <p className="text-xs text-green-700 mt-1">
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
                      Clear
                    </button>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  HEMA Ratings ID (optional)
                </label>
                <input
                  type="text"
                  value={addForm.hemaRatingsId}
                  onChange={(e) => setAddForm((f) => ({ ...f, hemaRatingsId: e.target.value }))}
                  placeholder="Paste an ID or pick from the suggestions below"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              <HemaRatingsSuggest
                apiUrl={apiUrl}
                personName={`${addForm.givenName} ${addForm.familyName}`.trim()}
                selectedId={addForm.hemaRatingsId}
                onSelect={(s) => setAddForm((f) => ({ ...f, hemaRatingsId: s?.id ?? '' }))}
              />

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Seed (optional)
                </label>
                <input
                  type="number"
                  value={addForm.seed}
                  onChange={(e) => setAddForm((f) => ({ ...f, seed: e.target.value }))}
                  min="1"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              {tournaments.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Register in tournaments (optional)
                  </label>
                  <div className="flex flex-col gap-1.5">
                    {tournaments.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTournaments.has(t.id)}
                          onChange={() =>
                            setSelectedTournaments((prev) => {
                              const next = new Set(prev);
                              if (next.has(t.id)) next.delete(t.id);
                              else next.add(t.id);
                              return next;
                            })
                          }
                          className="rounded"
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {addError && (
              <p className="text-sm text-red-600 mt-3" role="alert">
                {addError}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={closeAddModal}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleAdd()}
                disabled={addSaving}
                className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
              >
                {addSaving ? 'Adding…' : 'Add participant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editPerson && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">Edit participant</h2>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Given name *
                  </label>
                  <input
                    type="text"
                    value={editForm.givenName}
                    onChange={(e) => setEditForm((f) => ({ ...f, givenName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Family name *
                  </label>
                  <input
                    type="text"
                    value={editForm.familyName}
                    onChange={(e) => setEditForm((f) => ({ ...f, familyName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Club</label>
                <input
                  type="search"
                  value={editClubSearch}
                  onChange={(e) => {
                    setEditClubSearch(e.target.value);
                    setEditClubId(null);
                    setEditClubLabel('');
                  }}
                  placeholder="Search club…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                {editClubSuggestions.length > 0 && !editClubId && (
                  <div className="border border-gray-200 rounded-lg mt-1 max-h-36 overflow-y-auto">
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
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.abbreviation && (
                          <span className="text-gray-400 ml-2 text-xs">{c.abbreviation}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {editClubId && (
                  <p className="text-xs text-green-700 mt-1">
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
                      Clear
                    </button>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  HEMA Ratings ID
                </label>
                <input
                  type="text"
                  value={editForm.hemaRatingsId}
                  onChange={(e) => setEditForm((f) => ({ ...f, hemaRatingsId: e.target.value }))}
                  placeholder="hr-12345"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              {tournaments.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Tournaments
                  </label>
                  <div className="flex flex-col gap-1.5">
                    {tournaments.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editSelectedTournaments.has(t.id)}
                          onChange={() =>
                            setEditSelectedTournaments((prev) => {
                              const next = new Set(prev);
                              if (next.has(t.id)) next.delete(t.id);
                              else next.add(t.id);
                              return next;
                            })
                          }
                          className="rounded"
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {editError && (
              <p className="text-sm text-red-600 mt-3" role="alert">
                {editError}
              </p>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setEditPerson(null)}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleEditSave()}
                disabled={editSaving}
                className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
              >
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
