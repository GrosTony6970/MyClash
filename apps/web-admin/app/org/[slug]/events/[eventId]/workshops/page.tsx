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
import { formatInZone, zonedDay } from '@myclash/time';
import {
  TournamentColorDot,
  accentClassFor,
  useConfirm,
  statusPillTone,
  workshopStatusSemantic,
} from '@myclash/ui';
import { TOURNAMENT_COLORS } from '../tournaments/_lib/tournament-colors';
import { WorkshopScheduleBoard, type WorkshopBreak } from './WorkshopScheduleBoard';
import { Time24Input } from '@/components/Time24Input';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

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
  /** Optional identity color (ColorToken string), like tournaments. */
  color: string | null;
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

const EMPTY_FORM = {
  title: '',
  slug: '',
  category: '',
  level: '',
  language: 'fr',
  capacity: 20,
  durationMinutes: '' as string | number,
  description: '',
  venueId: '' as string,
  color: '' as string,
  status: 'draft',
  day: '',
  start: '',
  end: '',
  instructorIds: [] as string[],
};

export default function WorkshopsAdminPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { confirm, confirmDialog } = useConfirm();
  const { t } = useI18n();

  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Event days + timezone (for the schedule fields + board, resolved in event tz).
  const [eventDays, setEventDays] = useState<string[]>([]);
  const [eventTz, setEventTz] = useState<string>('Europe/Paris');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
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
    void (async () => {
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

  // Create / edit modal. `editingId` null → create, else editing that workshop.
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
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

  function hhmmInZone(iso: string): string {
    return formatInZone(iso, eventTz, { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowCreate(true);
  }

  function openEdit(w: Workshop) {
    const s = w.sessions[0] ?? null;
    setEditingId(w.id);
    setForm({
      title: w.title,
      slug: w.slug,
      category: w.category ?? '',
      level: w.level ?? '',
      language: w.language ?? 'fr',
      capacity: w.capacity ?? 20,
      durationMinutes: w.durationMinutes ?? '',
      description: '',
      venueId: w.venueId ?? '',
      color: w.color ?? '',
      status: w.status,
      day: s?.startsAt ? (zonedDay(s.startsAt, eventTz) ?? '') : '',
      start: s?.startsAt ? hhmmInZone(s.startsAt) : '',
      end: s?.endsAt ? hhmmInZone(s.endsAt) : '',
      instructorIds: w.instructors
        .map((i) => i.globalPersonId)
        .filter((x): x is string => Boolean(x)),
    });
    setFormError(null);
    setShowCreate(true);
    // Enrich with the long description (not present in the list payload).
    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/workshops/${w.id}`, { credentials: 'include' });
        if (!res.ok) return;
        const full = (await res.json()) as { descriptionMd?: string | null };
        setForm((f) => ({ ...f, description: full.descriptionMd ?? '' }));
      } catch {
        /* description just stays blank */
      }
    })();
  }

  function closeModal() {
    setShowCreate(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  // Roster modal
  const [rosterSession, setRosterSession] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [linkingEnrollmentId, setLinkingEnrollmentId] = useState<string | null>(null);
  const [gpSearch, setGpSearch] = useState('');
  const [gpResults, setGpResults] = useState<GlobalPersonResult[]>([]);

  // Session create modal
  // Org venues for the workshop + session venue pickers. Source is
  // the org-level catalogue so a freshly-added org venue is pickable
  // immediately, even before any session here uses it. Filtered to
  // workshop-capable venues only.
  const [venues, setVenues] = useState<EventVenue[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
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

  function sessionTimesFromForm() {
    return workshopSessionTimes({
      day: form.day,
      start: form.start,
      end: form.end || null,
      durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
      tz: eventTz,
    });
  }

  async function handleSubmit() {
    if (!form.title.trim() || !form.slug.trim()) {
      setFormError(t('admin.common.titleAndSlugRequired'));
      return;
    }
    setFormSaving(true);
    setFormError(null);

    try {
      if (editingId) {
        const patchRes = await fetch(`${apiUrl}/api/v1/workshops/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title: form.title.trim(),
            category: form.category.trim() || null,
            level: form.level.trim() || null,
            language: form.language,
            capacity: form.capacity,
            durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
            status: form.status,
            color: form.color || null,
            venueId: form.venueId || null,
            // Only touch the description when one was typed, so editing
            // other fields never silently wipes an existing description.
            ...(form.description.trim() ? { descriptionMd: form.description.trim() } : {}),
          }),
        });
        if (!patchRes.ok) {
          const body = (await patchRes.json()) as { message?: string };
          throw new Error(body.message ?? t('admin.common.saveFailed'));
        }

        // Reconcile instructors against the chosen set.
        const current = workshops.find((w) => w.id === editingId);
        const currentIds = new Set(
          (current?.instructors ?? [])
            .map((i) => i.globalPersonId)
            .filter((x): x is string => Boolean(x)),
        );
        const nextIds = new Set(form.instructorIds);
        for (const id of nextIds) {
          if (!currentIds.has(id)) {
            await fetch(`${apiUrl}/api/v1/workshops/${editingId}/instructors`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ globalPersonId: id }),
            });
          }
        }
        for (const id of currentIds) {
          if (!nextIds.has(id)) {
            await fetch(`${apiUrl}/api/v1/workshops/${editingId}/instructors/${id}`, {
              method: 'DELETE',
              credentials: 'include',
            });
          }
        }

        // Session: upsert when a day+time is set, else delete an existing one.
        const times = sessionTimesFromForm();
        const existing = current?.sessions[0] ?? null;
        if (times) {
          await fetch(`${apiUrl}/api/v1/workshops/${editingId}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              startTime: times.startTime,
              endTime: times.endTime,
              venueId: form.venueId || undefined,
            }),
          });
        } else if (existing) {
          await fetch(`${apiUrl}/api/v1/workshop-sessions/${existing.id}`, {
            method: 'DELETE',
            credentials: 'include',
          });
        }

        closeModal();
        setRefreshKey((k) => k + 1);
        return;
      }

      // ── Create path ──
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
          color: form.color || undefined,
          venueId: form.venueId || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('admin.common.createFailed'));
      }
      const created = (await res.json()) as { id: string };

      const times = sessionTimesFromForm();
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

      for (const globalPersonId of form.instructorIds) {
        await fetch(`${apiUrl}/api/v1/workshops/${created.id}/instructors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ globalPersonId }),
        });
      }

      closeModal();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('admin.common.saveFailed'));
    } finally {
      setFormSaving(false);
    }
  }

  async function changeStatus(w: Workshop, next: string) {
    if (next === w.status) return;
    await fetch(`${apiUrl}/api/v1/workshops/${w.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status: next }),
    });
    setRefreshKey((k) => k + 1);
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
    if (!(await confirm({ title: 'Remove this enrollment?', danger: true }))) return;
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
    // eslint-disable-next-line react-hooks/immutability -- intentional DOM side-effect: sync the URL hash with the active tab
    window.location.hash = next === 'schedule' ? '#schedule' : '#list';
    setTab(next);
  }

  // Workshop-only break blocks for the schedule board.
  const [breaks, setBreaks] = useState<WorkshopBreak[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
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
    color: '',
  });

  function openBreakCreate(dayIndex: number) {
    setBreakForm({ dayIndex, startTime: '12:00', endTime: '13:00', label: '', color: '' });
    setBreakModal({ dayIndex });
  }
  function openBreakEdit(b: WorkshopBreak) {
    setBreakForm({
      dayIndex: b.dayIndex,
      startTime: b.startTime,
      endTime: b.endTime,
      label: b.label ?? '',
      color: b.color ?? '',
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
      color: breakForm.color || null,
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

  // ✕ on a card → delete its session, returning the workshop to the drawer.
  async function handleUnschedule(sessionId: string) {
    await fetch(`${apiUrl}/api/v1/workshop-sessions/${sessionId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    setRefreshKey((k) => k + 1);
  }

  // Drag/resize a break bar on the board → PATCH its new HH:MM window.
  async function handleUpdateBreak(
    b: WorkshopBreak,
    times: { startTime: string; endTime: string },
  ) {
    await fetch(`${apiUrl}/api/v1/workshop-breaks/${b.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(times),
    });
    setRefreshKey((k) => k + 1);
  }

  async function handleDeleteBreakById(id: string) {
    await fetch(`${apiUrl}/api/v1/workshop-breaks/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    setRefreshKey((k) => k + 1);
  }

  return (
    // Full-bleed (no max-width) so the schedule board can use the whole screen,
    // matching the main event schedule page.
    <main className="p-8">
      {/* Header */}
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
              Event
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">Workshops</span>
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">Workshops</h1>
        </div>
        <button
          onClick={openCreate}
          className="bg-accent hover:bg-accent-hover text-accent-foreground font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
        >
          + New workshop
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 border-b border-border">
        {(['list', 'schedule'] as const).map((tk) => (
          <button
            key={tk}
            type="button"
            onClick={() => selectTab(tk)}
            className={[
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
              tab === tk
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-foreground-secondary',
            ].join(' ')}
          >
            {tk === 'list' ? 'Workshop list' : 'Workshop schedule'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : tab === 'schedule' ? (
        <WorkshopScheduleBoard
          workshops={workshops.map((w) => ({
            ...w,
            instructorNames: w.instructors.map((i) => i.displayName),
          }))}
          venues={venues}
          days={eventDays}
          timezone={eventTz}
          breaks={breaks}
          onPlace={(wid, sid, placement) => void handlePlaceSession(wid, sid, placement)}
          onBlockClick={(wid) => {
            const s = workshops.find((w) => w.id === wid)?.sessions[0];
            if (s) void openRoster(s.id);
          }}
          onUnschedule={(sessionId) => void handleUnschedule(sessionId)}
          onAddBreak={openBreakCreate}
          onEditBreak={openBreakEdit}
          onUpdateBreak={(b, times) => void handleUpdateBreak(b, times)}
          onDeleteBreak={(id) => void handleDeleteBreakById(id)}
        />
      ) : workshops.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
          <p className="text-muted text-sm">No workshops yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
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
                  <tr key={w.id} className="border-b border-border hover:bg-background">
                    <td className="relative py-2 pl-3 pr-4">
                      {w.color ? (
                        <span
                          aria-hidden="true"
                          className={`absolute inset-y-0 left-0 w-1 ${accentClassFor(w.color)}`}
                        />
                      ) : null}
                      <p className="font-medium text-foreground">{w.title}</p>
                      {w.instructors.length > 0 && (
                        <p className="text-xs text-muted">
                          {w.instructors.map((i) => i.displayName).join(', ')}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-foreground-secondary">{w.category ?? '—'}</td>
                    <td className="py-2 pr-4 text-foreground-secondary">{w.level ?? '—'}</td>
                    <td className="py-2 pr-4 text-foreground-secondary">{w.capacity ?? '—'}</td>
                    <td className="py-2 pr-4 text-foreground-secondary">
                      {w.durationMinutes != null ? `${w.durationMinutes} min` : '—'}
                    </td>
                    <td className="py-2 pr-4 text-foreground-secondary">{timeRange}</td>
                    <td className="py-2 pr-4 text-foreground-secondary">{venueArea}</td>
                    <td className="py-2 pr-4">
                      <select
                        value={w.status}
                        onChange={(e) => void changeStatus(w, e.target.value)}
                        aria-label="Workshop status"
                        className={`cursor-pointer rounded-full border-0 px-2 py-0.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          statusPillTone(workshopStatusSemantic(w.status), 'light').className
                        }`}
                      >
                        {['draft', 'published', 'running', 'completed'].map((s) => (
                          <option key={s} value={s}>
                            {STATUS_PILL[s] ?? s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => openEdit(w)}
                          className="text-xs font-semibold text-accent hover:text-accent-hover"
                        >
                          Edit
                        </button>
                        {session && (
                          <button
                            onClick={() => void openRoster(session.id)}
                            className="text-xs text-info hover:underline"
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
        <div className="fixed inset-0 bg-slate-950/40 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="font-display font-semibold text-lg sm:text-xl mb-4">
              {editingId ? 'Edit workshop' : 'New workshop'}
            </h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  Title *
                </label>
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
                  className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  Slug *
                </label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                    }))
                  }
                  className="w-full border border-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    placeholder="Longsword, Messer…"
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Level
                  </label>
                  <input
                    type="text"
                    value={form.level}
                    onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                    placeholder="Beginner, Advanced…"
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Language
                  </label>
                  <select
                    value={form.language}
                    onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="fr">FR</option>
                    <option value="en">EN</option>
                    <option value="de">DE</option>
                    <option value="es">ES</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Capacity
                  </label>
                  <input
                    type="number"
                    value={form.capacity}
                    min={1}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, capacity: parseInt(e.target.value) || 1 }))
                    }
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Duration (min, optional)
                  </label>
                  <input
                    type="number"
                    value={form.durationMinutes}
                    min={1}
                    placeholder="e.g. 90"
                    onChange={(e) => onTimingChange('durationMinutes', e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </div>

              {/* Optional scheduling — Day + Start + End auto-complete via Duration */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Day (optional)
                  </label>
                  {eventDays.length > 0 ? (
                    <select
                      value={form.day}
                      onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))}
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Start
                  </label>
                  <Time24Input
                    value={form.start}
                    onChange={(v) => onTimingChange('start', v)}
                    aria-label="Start time"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    End
                  </label>
                  <Time24Input
                    value={form.end}
                    onChange={(v) => onTimingChange('end', v)}
                    aria-label="End time"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  Instructors
                </label>
                {eventInstructors.length === 0 ? (
                  <p className="text-xs text-warning">
                    No instructors tagged yet. Tag participants as instructors on the Participants
                    page.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1 max-h-32 overflow-y-auto border border-border rounded-lg p-2">
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
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  Default venue
                </label>
                <select
                  value={form.venueId}
                  onChange={(e) => setForm((f) => ({ ...f, venueId: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">No default venue</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                {venues.length === 0 && (
                  <p className="mt-1 text-xs text-warning">
                    No workshop-capable venues in this org yet. Add one from /org/{slug}/venues.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  Color
                </label>
                <div className="flex items-center gap-2">
                  <TournamentColorDot color={form.color || null} size="md" />
                  <select
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="">No color</option>
                    {TOURNAMENT_COLORS.map((c) => (
                      <option key={c} value={c}>
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Shown as a left band on the schedule and the public workshop cards.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                />
              </div>
            </div>
            {formError && <p className="text-sm text-danger mt-2">{formError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={closeModal} className="text-sm text-muted px-4 py-2">
                Cancel
              </button>
              <button
                onClick={() => void handleSubmit()}
                disabled={formSaving}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm"
              >
                {formSaving ? 'Saving…' : editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Roster modal */}
      {rosterSession && (
        <div className="fixed inset-0 bg-slate-950/40 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-md p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-lg sm:text-xl">Session roster</h2>
              <button
                onClick={() => setRosterSession(null)}
                className="text-muted hover:text-foreground-secondary text-xl"
              >
                ×
              </button>
            </div>

            {rosterLoading ? (
              <p className="text-muted text-sm">Loading…</p>
            ) : roster.length === 0 ? (
              <p className="text-muted text-sm">No enrollments yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {roster.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between border border-border rounded-lg px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {entry.persons
                          ? `${entry.persons.givenName} ${entry.persons.familyName}`
                          : 'Unknown'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={[
                            'text-xs px-1.5 py-0.5 rounded font-medium',
                            entry.status === 'confirmed'
                              ? 'bg-success/10 text-success'
                              : 'bg-warning/10 text-warning',
                          ].join(' ')}
                        >
                          {entry.status === 'waitlisted'
                            ? `Waitlist #${entry.waitlistPosition}`
                            : 'Confirmed'}
                        </span>
                        {entry.global_person_id ? (
                          <span className="text-xs text-success font-medium">Linked</span>
                        ) : linkingEnrollmentId === entry.id ? (
                          <div className="relative">
                            <input
                              type="search"
                              value={gpSearch}
                              onChange={(e) => setGpSearch(e.target.value)}
                              placeholder="Search global person…"
                              className="border border-border rounded px-2 py-0.5 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            {gpResults.length > 0 && (
                              <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded shadow text-xs max-h-28 overflow-y-auto z-10 w-48">
                                {gpResults.map((gp) => (
                                  <button
                                    key={gp.id}
                                    onClick={() =>
                                      void linkEnrollmentToGlobalPerson(entry.id, gp.id)
                                    }
                                    className="block w-full text-left px-2 py-1 hover:bg-background border-b border-border last:border-0"
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
                              className="ml-1 text-xs text-muted"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setLinkingEnrollmentId(entry.id)}
                            className="text-xs text-warning hover:text-warning-hover"
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
                          className="text-xs text-success hover:underline"
                        >
                          Promote
                        </button>
                      )}
                      {entry.persons && (
                        <button
                          onClick={() => void handleRemove(rosterSession, entry.persons!.id)}
                          className="text-xs text-danger hover:underline"
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
        <div className="fixed inset-0 bg-slate-950/40 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="font-display font-semibold text-lg sm:text-xl mb-4">
              {'id' in breakModal ? 'Edit break' : 'New break'}
            </h2>
            <div className="flex flex-col gap-3">
              {eventDays.length > 1 && (
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Day
                  </label>
                  <select
                    value={breakForm.dayIndex}
                    onChange={(e) =>
                      setBreakForm((f) => ({ ...f, dayIndex: Number(e.target.value) }))
                    }
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    Start
                  </label>
                  <Time24Input
                    value={breakForm.startTime}
                    onChange={(v) => setBreakForm((f) => ({ ...f, startTime: v }))}
                    aria-label="Break start time"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">
                    End
                  </label>
                  <Time24Input
                    value={breakForm.endTime}
                    onChange={(v) => setBreakForm((f) => ({ ...f, endTime: v }))}
                    aria-label="Break end time"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  Label
                </label>
                <input
                  type="text"
                  value={breakForm.label}
                  placeholder="Lunch, changeover…"
                  onChange={(e) => setBreakForm((f) => ({ ...f, label: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  Color
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {['', '#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#64748b'].map(
                    (c) => (
                      <button
                        key={c || 'none'}
                        type="button"
                        aria-label={c ? `Color ${c}` : 'No color'}
                        onClick={() => setBreakForm((f) => ({ ...f, color: c }))}
                        className={[
                          'flex h-6 w-6 items-center justify-center rounded-full border text-[10px]',
                          breakForm.color === c ? 'ring-2 ring-foreground ring-offset-1' : '',
                          c ? '' : 'bg-surface text-muted',
                        ].join(' ')}
                        style={c ? { backgroundColor: c, borderColor: c } : undefined}
                      >
                        {c ? '' : '∅'}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-4">
              {'id' in breakModal ? (
                <button
                  onClick={() => void deleteBreak()}
                  className="text-sm text-danger hover:underline"
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setBreakModal(null)}
                  className="text-sm text-muted px-4 py-2"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveBreak()}
                  className="bg-accent hover:bg-accent-hover text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </main>
  );
}

// Option labels for the status <select>; the pill colour comes from the
// canonical workshopStatusSemantic → statusPillTone helper.
const STATUS_PILL: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  running: 'Running',
  completed: 'Completed',
};
