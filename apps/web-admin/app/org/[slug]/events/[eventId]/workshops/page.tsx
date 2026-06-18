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
import {
  durationFromStartEnd,
  endFromStartDuration,
  workshopSessionTimes,
} from './workshop-session-times';
import { eachDay } from '../schedule/event-days';
import { formatInZone, zonedToUtcIso } from '@myclash/time';
import { WorkshopScheduleBoard, type WorkshopBreak } from './WorkshopScheduleBoard';

/** A `datetime-local` value (YYYY-MM-DDTHH:MM) → UTC instant in the event tz. */
function datetimeLocalToUtc(value: string, tz: string): string | null {
  const [day, hhmm] = value.split('T');
  return zonedToUtcIso(day ?? '', (hhmm ?? '').slice(0, 5), tz);
}

interface NamedRef {
  id: string;
  name: string;
}

interface WorkshopSessionView {
  id: string;
  startsAt: string | null;
  endsAt: string | null;
  locationLabel: string | null;
  venueId: string | null;
  areaId: string | null;
  venue: NamedRef | null;
  area: NamedRef | null;
  capacity: number | null;
  confirmedCount: number;
  status: string | null;
}

interface Workshop {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  level: string | null;
  language: string | null;
  capacity: number | null;
  durationMinutes: number | null;
  status: string;
  // Workshop-level default venue. Sessions inherit this when the
  // operator schedules — they can still override via the session
  // Venue picker.
  venueId: string | null;
  venue: NamedRef | null;
  instructors: Array<{ globalPersonId: string | null; displayName: string }>;
  sessions: WorkshopSessionView[];
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

  // Event days + timezone (for the schedule fields + board, resolved in event tz).
  const [eventDays, setEventDays] = useState<string[]>([]);
  const [eventTz, setEventTz] = useState<string>('Europe/Paris');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/events/${eventId}`, { credentials: 'include' });
        if (!res.ok) return;
        const ev = (await res.json()) as {
          start_date: string;
          end_date?: string | null;
          timezone?: string | null;
        };
        if (cancelled) return;
        setEventDays(eachDay(ev.start_date, ev.end_date ?? null));
        if (ev.timezone) setEventTz(ev.timezone);
      } catch {
        /* day picker just stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, eventId]);

  // Event-tagged instructors (event_instructors) for the workshop picker.
  const [eventInstructors, setEventInstructors] = useState<
    Array<{ personId: string; displayName: string }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/instructors`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const rows = (await res.json()) as Array<{ personId: string; displayName: string }>;
        if (!cancelled) setEventInstructors(rows);
      } catch {
        /* picker stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, eventId, refreshKey]);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '',
    slug: '',
    category: '',
    level: '',
    language: 'fr',
    capacity: 20,
    durationMinutes: '' as string | number,
    description: '',
    venueId: '' as string,
    status: 'draft',
    day: '',
    start: '',
    end: '',
    instructorIds: [] as string[],
  });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reactive timing: Start+End → Duration; Start+Duration → End. Only
  // fills the field the operator is NOT currently editing.
  function onTimingChange(field: 'start' | 'end' | 'durationMinutes', value: string) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === 'start' || field === 'end') {
        const d = durationFromStartEnd(next.start, next.end);
        if (d !== null) next.durationMinutes = d;
        else if (field === 'start' && next.durationMinutes) {
          const e = endFromStartDuration(next.start, Number(next.durationMinutes));
          if (e) next.end = e;
        }
      } else if (field === 'durationMinutes') {
        const e = endFromStartDuration(next.start, value ? Number(value) : null);
        if (e) next.end = e;
      }
      return next;
    });
  }

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

  // Org venues for the workshop + session venue pickers. Source is
  // the org-level catalogue so a freshly-added org venue is pickable
  // immediately, even before any session here uses it. Filtered to
  // workshop-capable venues only.
  const [venues, setVenues] = useState<EventVenue[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgRes = await fetch(
          `${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`,
          { credentials: 'include' },
        );
        if (!orgRes.ok) return;
        const org = (await orgRes.json()) as { id: string };
        if (cancelled) return;
        const venuesRes = await fetch(`${apiUrl}/api/v1/organizations/${org.id}/venues`, {
          credentials: 'include',
        });
        if (!venuesRes.ok) return;
        const data = (await venuesRes.json()) as EventVenue[];
        if (!cancelled) setVenues(data.filter((v) => v.hosts_workshop));
      } catch {
        /* swallow — picker shows empty + the warning hint */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, slug, refreshKey]);

  function openSessionForm(workshopId: string) {
    setSessionFormWorkshopId(workshopId);
    // Pre-fill the venue picker with the workshop's default venue (if
    // any). Operator can still override per session via the dropdown.
    const workshop = workshops.find((w) => w.id === workshopId);
    const defaultVenueId = workshop?.venueId ?? '';
    setSessionForm({
      startTime: '',
      endTime: '',
      location: '',
      venueId: defaultVenueId,
      areaId: '',
    });
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
          startTime: datetimeLocalToUtc(sessionForm.startTime, eventTz),
          endTime: datetimeLocalToUtc(sessionForm.endTime, eventTz),
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
    if (!form.title.trim() || !form.slug.trim()) {
      setFormError('Title and slug are required');
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
          title: form.title.trim(),
          slug: form.slug.trim(),
          category: form.category.trim() || null,
          level: form.level.trim() || null,
          language: form.language,
          capacity: form.capacity,
          durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
          descriptionMd: form.description.trim() || null,
          status: form.status,
          venueId: form.venueId || undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Create failed');
      }
      const created = (await res.json()) as { id: string };

      // Optional scheduling — if a day + start were given, place the
      // workshop's single session now (end derived from duration / +60).
      const times = workshopSessionTimes({
        day: form.day,
        start: form.start,
        end: form.end || null,
        durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
        tz: eventTz,
      });
      if (times) {
        await fetch(`${apiUrl}/api/v1/workshops/${created.id}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            startTime: times.startTime,
            endTime: times.endTime,
            venueId: form.venueId || undefined,
          }),
        });
      }

      // Attach the chosen event-instructors to the new workshop.
      for (const globalPersonId of form.instructorIds) {
        await fetch(`${apiUrl}/api/v1/workshops/${created.id}/instructors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ globalPersonId }),
        });
      }

      setShowCreate(false);
      setForm({
        title: '',
        slug: '',
        category: '',
        level: '',
        language: 'fr',
        capacity: 20,
        durationMinutes: '',
        description: '',
        venueId: '',
        status: 'draft',
        day: '',
        start: '',
        end: '',
        instructorIds: [],
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

  // ── Tabs (#list / #schedule) ────────────────────────────────────────────────────

  const [tab, setTab] = useState<'list' | 'schedule'>('list');
  useEffect(() => {
    const sync = () => setTab(window.location.hash === '#schedule' ? 'schedule' : 'list');
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  function selectTab(next: 'list' | 'schedule') {
    window.location.hash = next === 'schedule' ? '#schedule' : '#list';
    setTab(next);
  }

  // Workshop-only break blocks for the schedule board.
  const [breaks, setBreaks] = useState<WorkshopBreak[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/workshop-breaks`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const rows = (await res.json()) as WorkshopBreak[];
        if (!cancelled) setBreaks(rows);
      } catch {
        /* board just renders no breaks */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, eventId, refreshKey]);

  // Break editor modal (create when id is null, else edit existing).
  const [breakModal, setBreakModal] = useState<WorkshopBreak | { dayIndex: number } | null>(null);
  const [breakForm, setBreakForm] = useState({
    dayIndex: 0,
    startTime: '12:00',
    endTime: '13:00',
    label: '',
  });

  function openBreakCreate(dayIndex: number) {
    setBreakForm({ dayIndex, startTime: '12:00', endTime: '13:00', label: '' });
    setBreakModal({ dayIndex });
  }
  function openBreakEdit(b: WorkshopBreak) {
    setBreakForm({
      dayIndex: b.dayIndex,
      startTime: b.startTime,
      endTime: b.endTime,
      label: b.label ?? '',
    });
    setBreakModal(b);
  }
  async function saveBreak() {
    const editing = breakModal && 'id' in breakModal ? breakModal : null;
    const body = {
      dayIndex: breakForm.dayIndex,
      startTime: breakForm.startTime,
      endTime: breakForm.endTime,
      label: breakForm.label.trim() || null,
    };
    const url = editing
      ? `${apiUrl}/api/v1/workshop-breaks/${editing.id}`
      : `${apiUrl}/api/v1/events/${eventId}/workshop-breaks`;
    await fetch(url, {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    setBreakModal(null);
    setRefreshKey((k) => k + 1);
  }
  async function deleteBreak() {
    const editing = breakModal && 'id' in breakModal ? breakModal : null;
    if (!editing) return;
    await fetch(`${apiUrl}/api/v1/workshop-breaks/${editing.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    setBreakModal(null);
    setRefreshKey((k) => k + 1);
  }

  // Drag/resize on the board → upsert the workshop's single session.
  async function handlePlaceSession(
    workshopId: string,
    _sessionId: string | null,
    placement: { venueId: string; areaId: string | null; startTime: string; endTime: string },
  ) {
    await fetch(`${apiUrl}/api/v1/workshops/${workshopId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        startTime: placement.startTime,
        endTime: placement.endTime,
        venueId: placement.venueId,
        areaId: placement.areaId ?? undefined,
      }),
    });
    setRefreshKey((k) => k + 1);
  }

  return (
    <main className="p-8 max-w-6xl">
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

      {/* Tabs */}
      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {(['list', 'schedule'] as const).map((tk) => (
          <button
            key={tk}
            type="button"
            onClick={() => selectTab(tk)}
            className={[
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
              tab === tk
                ? 'border-red-700 text-red-700'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {tk === 'list' ? 'Workshop list' : 'Workshop schedule'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : tab === 'schedule' ? (
        <WorkshopScheduleBoard
          workshops={workshops}
          venues={venues}
          days={eventDays}
          timezone={eventTz}
          breaks={breaks}
          onPlace={(wid, sid, placement) => void handlePlaceSession(wid, sid, placement)}
          onBlockClick={(wid) => {
            const s = workshops.find((w) => w.id === wid)?.sessions[0];
            if (s) void openRoster(s.id);
          }}
          onAddBreak={openBreakCreate}
          onEditBreak={openBreakEdit}
        />
      ) : workshops.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">No workshops yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4 font-medium">Workshop name</th>
                <th className="py-2 pr-4 font-medium">Category</th>
                <th className="py-2 pr-4 font-medium">Level</th>
                <th className="py-2 pr-4 font-medium">Capacity</th>
                <th className="py-2 pr-4 font-medium">Duration</th>
                <th className="py-2 pr-4 font-medium">Start / End</th>
                <th className="py-2 pr-4 font-medium">Venue</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {workshops.map((w) => {
                const session = w.sessions[0] ?? null;
                const venueLabel = session?.venue?.name ?? w.venue?.name ?? null;
                const areaLabel = session?.area?.name ?? null;
                const venueArea = venueLabel
                  ? areaLabel
                    ? `${venueLabel} · ${areaLabel}`
                    : venueLabel
                  : '—';
                const timeRange =
                  session && session.startsAt
                    ? `${formatInZone(session.startsAt, eventTz, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}${
                        session.endsAt
                          ? ` – ${formatInZone(session.endsAt, eventTz, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`
                          : ''
                      }`
                    : '—';
                return (
                  <tr key={w.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-4">
                      <p className="font-medium text-gray-900">{w.title}</p>
                      {w.instructors.length > 0 && (
                        <p className="text-xs text-gray-400">
                          {w.instructors.map((i) => i.displayName).join(', ')}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{w.category ?? '—'}</td>
                    <td className="py-2 pr-4 text-gray-600">{w.level ?? '—'}</td>
                    <td className="py-2 pr-4 text-gray-600">{w.capacity ?? '—'}</td>
                    <td className="py-2 pr-4 text-gray-600">
                      {w.durationMinutes != null ? `${w.durationMinutes} min` : '—'}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{timeRange}</td>
                    <td className="py-2 pr-4 text-gray-600">{venueArea}</td>
                    <td className="py-2 pr-4">
                      <StatusPill status={w.status} />
                    </td>
                    <td className="py-2">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => openSessionForm(w.id)}
                          className="text-xs font-semibold text-red-700 hover:text-red-800"
                        >
                          {session ? 'Edit time' : 'Schedule'}
                        </button>
                        {session && (
                          <button
                            onClick={() => void openRoster(session.id)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Roster
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">New workshop</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => {
                    const title = e.target.value;
                    setForm((f) => ({
                      ...f,
                      title,
                      slug: nextSlugFromName(f.slug, f.title, title),
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
                    onChange={(e) => onTimingChange('durationMinutes', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>

              {/* Optional scheduling — Day + Start + End auto-complete via Duration */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Day (optional)
                  </label>
                  {eventDays.length > 0 ? (
                    <select
                      value={form.day}
                      onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      <option value="">—</option>
                      {eventDays.map((d) => (
                        <option key={d} value={d}>
                          {new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', {
                            weekday: 'short',
                            day: '2-digit',
                            month: 'short',
                            timeZone: 'UTC',
                          })}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="date"
                      value={form.day}
                      onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start</label>
                  <input
                    type="time"
                    lang="en-GB"
                    value={form.start}
                    onChange={(e) => onTimingChange('start', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">End</label>
                  <input
                    type="time"
                    lang="en-GB"
                    value={form.end}
                    onChange={(e) => onTimingChange('end', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Instructors</label>
                {eventInstructors.length === 0 ? (
                  <p className="text-xs text-amber-600">
                    No instructors tagged yet. Tag participants as instructors on the Participants
                    page.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1 max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2">
                    {eventInstructors.map((ins) => (
                      <label key={ins.personId} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.instructorIds.includes(ins.personId)}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              instructorIds: e.target.checked
                                ? [...f.instructorIds, ins.personId]
                                : f.instructorIds.filter((id) => id !== ins.personId),
                            }))
                          }
                          className="rounded"
                        />
                        {ins.displayName}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Default venue
                </label>
                <select
                  value={form.venueId}
                  onChange={(e) => setForm((f) => ({ ...f, venueId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <option value="">No default venue</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                {venues.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    No workshop-capable venues in this org yet. Add one from /org/{slug}/venues.
                  </p>
                )}
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
                        lang="en-GB"
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
                        lang="en-GB"
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

      {/* Break editor modal */}
      {breakModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold mb-4">
              {'id' in breakModal ? 'Edit break' : 'New break'}
            </h2>
            <div className="flex flex-col gap-3">
              {eventDays.length > 1 && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Day</label>
                  <select
                    value={breakForm.dayIndex}
                    onChange={(e) =>
                      setBreakForm((f) => ({ ...f, dayIndex: Number(e.target.value) }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    {eventDays.map((d, i) => (
                      <option key={d} value={i}>
                        Jour {i + 1}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start</label>
                  <input
                    type="time"
                    lang="en-GB"
                    value={breakForm.startTime}
                    onChange={(e) => setBreakForm((f) => ({ ...f, startTime: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">End</label>
                  <input
                    type="time"
                    lang="en-GB"
                    value={breakForm.endTime}
                    onChange={(e) => setBreakForm((f) => ({ ...f, endTime: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Label</label>
                <input
                  type="text"
                  value={breakForm.label}
                  placeholder="Lunch, changeover…"
                  onChange={(e) => setBreakForm((f) => ({ ...f, label: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
            </div>
            <div className="flex items-center justify-between mt-4">
              {'id' in breakModal ? (
                <button
                  onClick={() => void deleteBreak()}
                  className="text-sm text-red-600 hover:underline"
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setBreakModal(null)}
                  className="text-sm text-gray-500 px-4 py-2"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveBreak()}
                  className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-5 rounded-lg text-sm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-600' },
  published: { label: 'Published', cls: 'bg-green-100 text-green-700' },
  running: { label: 'Running', cls: 'bg-amber-100 text-amber-800' },
  completed: { label: 'Completed', cls: 'bg-blue-100 text-blue-700' },
};

function StatusPill({ status }: { status: string }) {
  const pill = STATUS_PILL[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pill.cls}`}>{pill.label}</span>
  );
}
