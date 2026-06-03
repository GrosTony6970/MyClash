'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * Workshop admin — T-804
 * Route: /org/[slug]/events/[eventId]/workshops
 *
 * AC:
 *   ✓ Create/edit workshops
 *   ✓ Roster view: confirmed + waitlisted, promote/remove actions
 *   ✓ Cancel session stub (notification via T-1201 when available)
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { nextSlugFromName } from './slug-from-name';

interface Workshop {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  level: string | null;
  capacity: number;
  workshopSessions: Array<{
    id: string;
    startTime: string;
    endTime: string;
    location: string | null;
    capacity: number;
    venue_id?: string | null;
    area_id?: string | null;
    venues?: { id: string; name: string } | null;
    venue_areas?: { id: string; name: string } | null;
  }>;
}

interface EventVenue {
  id: string;
  name: string;
  hosts_workshop: boolean;
  venue_areas: Array<{ id: string; name: string }> | null;
}

interface GlobalPersonResult {
  id: string;
  display_name: string;
}

interface RosterEntry {
  id: string;
  status: 'confirmed' | 'waitlisted';
  waitlistPosition: number | null;
  enrolledAt: string;
  global_person_id?: string | null;
  persons: {
    id: string;
    givenName: string;
    familyName: string;
    clubs: { name: string } | null;
  } | null;
}

export default function WorkshopsAdminPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    category: '',
    level: '',
    language: 'fr',
    capacity: 20,
    durationMinutes: '' as string | number,
    description: '',
  });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Roster modal
  const [rosterSession, setRosterSession] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [linkingEnrollmentId, setLinkingEnrollmentId] = useState<string | null>(null);
  const [gpSearch, setGpSearch] = useState('');
  const [gpResults, setGpResults] = useState<GlobalPersonResult[]>([]);

  // Session create modal
  const [sessionFormWorkshopId, setSessionFormWorkshopId] = useState<string | null>(null);
  const [sessionForm, setSessionForm] = useState({
    startTime: '',
    endTime: '',
    location: '',
    venueId: '' as string,
    areaId: '' as string,
  });
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Event venues for the session form's Venue + Area pickers. Only
  // workshop-capable venues are eligible.
  const [venues, setVenues] = useState<EventVenue[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/events/${eventId}/venues`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as EventVenue[];
        if (!cancelled) setVenues(data.filter((v) => v.hosts_workshop));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiUrl, eventId, refreshKey]);

  function openSessionForm(workshopId: string) {
    setSessionFormWorkshopId(workshopId);
    setSessionForm({ startTime: '', endTime: '', location: '', venueId: '', areaId: '' });
    setSessionError(null);
  }

  async function handleCreateSession() {
    if (!sessionFormWorkshopId) return;
    if (!sessionForm.startTime || !sessionForm.endTime) {
      setSessionError('Start and end time are required');
      return;
    }
    setSessionSaving(true);
    setSessionError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/workshops/${sessionFormWorkshopId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startTime: new Date(sessionForm.startTime).toISOString(),
          endTime: new Date(sessionForm.endTime).toISOString(),
          location: sessionForm.location.trim() || undefined,
          venueId: sessionForm.venueId || undefined,
          areaId: sessionForm.areaId || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Create session failed');
      }
      setSessionFormWorkshopId(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : 'Create session failed');
    } finally {
      setSessionSaving(false);
    }
  }

  // ── Fetch workshops ────────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/workshops`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        setLoading(false);
        if (res.ok) setWorkshops((await res.json()) as Workshop[]);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventId, apiUrl, refreshKey]);

  // ── Create workshop ────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!form.name.trim() || !form.slug.trim()) {
      setFormError('Name and slug are required');
      return;
    }
    setFormSaving(true);
    setFormError(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/workshops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim(),
          category: form.category.trim() || null,
          level: form.level.trim() || null,
          language: form.language,
          capacity: form.capacity,
          durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
          description: form.description.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Create failed');
      }

      setShowCreate(false);
      setForm({
        name: '',
        slug: '',
        category: '',
        level: '',
        language: 'fr',
        capacity: 20,
        durationMinutes: '',
        description: '',
      });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setFormSaving(false);
    }
  }

  // ── Roster ────────────────────────────────────────────────────────────────────

  async function openRoster(sessionId: string) {
    setRosterSession(sessionId);
    setRosterLoading(true);
    const res = await fetch(`${apiUrl}/api/v1/workshop-sessions/${sessionId}/roster`, {
      credentials: 'include',
    });
    if (res.ok) setRoster((await res.json()) as RosterEntry[]);
    setRosterLoading(false);
  }

  async function handlePromote(sessionId: string, personId: string) {
    await fetch(`${apiUrl}/api/v1/workshop-sessions/${sessionId}/promote/${personId}`, {
      method: 'POST',
      credentials: 'include',
    });
    await openRoster(sessionId);
  }

  async function handleRemove(sessionId: string, _personId: string) {
    if (!confirm('Remove this enrollment?')) return;
    await fetch(`${apiUrl}/api/v1/workshop-sessions/${sessionId}/enroll`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await openRoster(sessionId);
  }

  // ── Global person search for enrollment linking ────────────────────────────

  useEffect(() => {
    if (gpSearch.trim().length < 2) {
      const timer = setTimeout(() => setGpResults([]), 0);
      return () => clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/api/v1/global-persons?q=${encodeURIComponent(gpSearch)}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          if (res.ok) setGpResults((await res.json()) as GlobalPersonResult[]);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [gpSearch, apiUrl]);

  async function linkEnrollmentToGlobalPerson(enrollmentId: string, globalPersonId: string) {
    await fetch(`${apiUrl}/api/v1/global-persons/${globalPersonId}/link-workshop-enrollment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ enrollmentId }),
    });
    setLinkingEnrollmentId(null);
    setGpSearch('');
    setGpResults([]);
    if (rosterSession) await openRoster(rosterSession);
  }

  return (
    <main className="p-8 max-w-4xl">
      {/* Header */}
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
            <span className="text-gray-900 font-medium">Workshops</span>
          </div>
          <h1 className="text-2xl font-bold">Workshops</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
        >
          + New workshop
        </button>
      </div>

      {/* Workshop list */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : workshops.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">No workshops yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {workshops.map((w) => (
            <div key={w.id} className="border border-gray-200 rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="font-semibold text-gray-900">{w.name}</h2>
                  <div className="flex gap-1.5 mt-1">
                    {w.category && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {w.category}
                      </span>
                    )}
                    {w.level && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                        {w.level}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">Cap: {w.capacity}</span>
                  </div>
                </div>
              </div>

              {/* Sessions */}
              <div className="flex flex-col gap-2">
                {w.workshopSessions.map((s) => {
                  const venueLabel = s.venues?.name ?? null;
                  const areaLabel = s.venue_areas?.name ?? null;
                  const venueArea = venueLabel
                    ? areaLabel
                      ? `${venueLabel} · ${areaLabel}`
                      : venueLabel
                    : null;
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-medium text-gray-700">
                          {new Date(s.startTime).toLocaleDateString('fr-FR', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                        <span className="text-gray-500 ml-2">
                          {new Date(s.startTime).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {venueArea && ` · ${venueArea}`}
                          {!venueArea && s.location && ` · ${s.location}`}
                        </span>
                      </div>
                      <button
                        onClick={() => void openRoster(s.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Roster
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => openSessionForm(w.id)}
                  className="self-start text-xs font-semibold text-red-700 hover:text-red-800"
                >
                  + Add session
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">New workshop</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) => ({
                      ...f,
                      name,
                      slug: nextSlugFromName(f.slug, f.name, name),
                    }));
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Slug *</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                    }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    placeholder="Longsword, Messer…"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Level</label>
                  <input
                    type="text"
                    value={form.level}
                    onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                    placeholder="Beginner, Advanced…"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Language</label>
                  <select
                    value={form.language}
                    onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="fr">FR</option>
                    <option value="en">EN</option>
                    <option value="de">DE</option>
                    <option value="es">ES</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Capacity</label>
                  <input
                    type="number"
                    value={form.capacity}
                    min={1}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, capacity: parseInt(e.target.value) || 1 }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Duration (min, optional)
                  </label>
                  <input
                    type="number"
                    value={form.durationMinutes}
                    min={1}
                    placeholder="e.g. 90"
                    onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 resize-none"
                />
              </div>
            </div>
            {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowCreate(false)}
                className="text-sm text-gray-500 px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={formSaving}
                className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm"
              >
                {formSaving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session create modal */}
      {sessionFormWorkshopId &&
        (() => {
          const pickedVenue = venues.find((v) => v.id === sessionForm.venueId) ?? null;
          const areas = pickedVenue?.venue_areas ?? [];
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <h2 className="text-lg font-bold mb-4">New session</h2>
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Start *
                      </label>
                      <input
                        type="datetime-local"
                        value={sessionForm.startTime}
                        onChange={(e) =>
                          setSessionForm((f) => ({ ...f, startTime: e.target.value }))
                        }
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">End *</label>
                      <input
                        type="datetime-local"
                        value={sessionForm.endTime}
                        onChange={(e) => setSessionForm((f) => ({ ...f, endTime: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Venue</label>
                    <select
                      value={sessionForm.venueId}
                      onChange={(e) =>
                        setSessionForm((f) => ({ ...f, venueId: e.target.value, areaId: '' }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      <option value="">No venue</option>
                      {venues.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    {venues.length === 0 && (
                      <p className="mt-1 text-xs text-amber-600">
                        No workshop-capable venues for this event yet. Add one from the Venues tab.
                      </p>
                    )}
                  </div>
                  {pickedVenue && areas.length >= 2 && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Area</label>
                      <select
                        value={sessionForm.areaId}
                        onChange={(e) => setSessionForm((f) => ({ ...f, areaId: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                      >
                        <option value="">Whole venue</option>
                        {areas.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Location label (optional)
                    </label>
                    <input
                      type="text"
                      value={sessionForm.location}
                      placeholder="Door A, mat 2…"
                      onChange={(e) => setSessionForm((f) => ({ ...f, location: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>
                </div>
                {sessionError && <p className="text-sm text-red-600 mt-2">{sessionError}</p>}
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    onClick={() => setSessionFormWorkshopId(null)}
                    className="text-sm text-gray-500 px-4 py-2"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleCreateSession()}
                    disabled={sessionSaving}
                    className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm"
                  >
                    {sessionSaving ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Roster modal */}
      {rosterSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Session roster</h2>
              <button
                onClick={() => setRosterSession(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            {rosterLoading ? (
              <p className="text-gray-400 text-sm">Loading…</p>
            ) : roster.length === 0 ? (
              <p className="text-gray-400 text-sm">No enrollments yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {roster.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {entry.persons
                          ? `${entry.persons.givenName} ${entry.persons.familyName}`
                          : 'Unknown'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={[
                            'text-xs px-1.5 py-0.5 rounded font-medium',
                            entry.status === 'confirmed'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-yellow-100 text-yellow-700',
                          ].join(' ')}
                        >
                          {entry.status === 'waitlisted'
                            ? `Waitlist #${entry.waitlistPosition}`
                            : 'Confirmed'}
                        </span>
                        {entry.global_person_id ? (
                          <span className="text-xs text-emerald-600 font-medium">Linked</span>
                        ) : linkingEnrollmentId === entry.id ? (
                          <div className="relative">
                            <input
                              type="search"
                              value={gpSearch}
                              onChange={(e) => setGpSearch(e.target.value)}
                              placeholder="Search global person…"
                              className="border border-gray-300 rounded px-2 py-0.5 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                            {gpResults.length > 0 && (
                              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded shadow text-xs max-h-28 overflow-y-auto z-10 w-48">
                                {gpResults.map((gp) => (
                                  <button
                                    key={gp.id}
                                    onClick={() =>
                                      void linkEnrollmentToGlobalPerson(entry.id, gp.id)
                                    }
                                    className="block w-full text-left px-2 py-1 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                                  >
                                    {gp.display_name}
                                  </button>
                                ))}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                setLinkingEnrollmentId(null);
                                setGpSearch('');
                                setGpResults([]);
                              }}
                              className="ml-1 text-xs text-gray-400"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setLinkingEnrollmentId(entry.id)}
                            className="text-xs text-amber-600 hover:text-amber-800"
                          >
                            Link
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {entry.status === 'waitlisted' && entry.persons && (
                        <button
                          onClick={() => void handlePromote(rosterSession, entry.persons!.id)}
                          className="text-xs text-green-600 hover:underline"
                        >
                          Promote
                        </button>
                      )}
                      {entry.persons && (
                        <button
                          onClick={() => void handleRemove(rosterSession, entry.persons!.id)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
