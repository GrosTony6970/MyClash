'use client';

/**
 * Workshop admin — T-804
 * Route: /org/[slug]/events/[eventId]/workshops
 *
 * AC:
 *   ✓ Create/edit workshops
 *   ✓ Roster view: confirmed + waitlisted, promote/remove actions
 *   ✓ Cancel session stub (notification via T-1201 when available)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { EventCrumb, OrgCrumb } from '@/components/Crumbs';
import { useWeaponOptions } from '@/hooks/useWeaponOptions';
import { nextSlugFromName } from './slug-from-name';
import {
  applySessionEdits,
  blankLine,
  linesOf,
  removedSessions,
  sessionEdits,
  type ExistingSession,
  type SessionLine,
} from './session-edits';
import { WorkshopSessionsField } from './WorkshopSessionsField';
import { sessionPlaceLabel, sessionTimeRange } from './workshop-row-sessions';
import { eachDay, isCancelledSession } from '@myclash/schedule-core';
import { localeToBcp47 } from '@myclash/time';
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  Modal,
  TournamentColorDot,
  accentClassFor,
  fuzzyMatch,
  useConfirm,
  useToast,
  useSortableList,
  statusPillClass,
  workshopStatusSemantic,
  statusLabel,
} from '@myclash/ui';
import { TOURNAMENT_COLORS } from '../tournaments/_lib/tournament-colors';
import { WorkshopScheduleBoard, type WorkshopBreak } from './WorkshopScheduleBoard';
import { useInstructorClashes } from './use-instructor-clashes';
import { sessionDeleteQuestion } from './session-delete-question';
import { workshopDeleteQuestion, workshopDeleteRefusal } from './workshop-delete';
import { WorkshopLogoField } from './WorkshopLogoField';
import { WorkshopsTableHeader } from './WorkshopsTableHeader';
import {
  deriveWorkshopFilterOptions,
  isWorkshopFilterActive,
  workshopMatchesFilter,
  workshopSearchHaystack,
  workshopSortValue,
} from './filter-workshops';
import { rosterRequests } from './roster-requests';
import { RosterAddPerson } from './RosterAddPerson';
import { RosterCheckIn } from './RosterCheckIn';
import { RosterMessage } from './RosterMessage';
import { RosterSheetActions } from './RosterSheetActions';
import { RosterName } from './RosterName';
import { useWorkshopListFilters } from './useWorkshopListFilters';
import { useEventStatus } from '../_hooks/useEventStatus';
import { Time24Input } from '@/components/Time24Input';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

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
  /** Weapon/discipline (free text), like tournaments. */
  weapon: string | null;
  language: string | null;
  capacity: number | null;
  durationMinutes: number | null;
  status: string;
  /** Optional identity color (ColorToken string), like tournaments. */
  color: string | null;
  /** Workshop logo (square) public URL, or null. */
  coverImageUrl: string | null;
  // Workshop-level default venue. Sessions inherit this when the
  // operator schedules — they can still override via the session
  // Venue picker.
  venueId: string | null;
  venue: NamedRef | null;
  /** The front desk ticks this Workshop's people on the day they arrive (rulings 540, 543). */
  autoCheckIn?: boolean;
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
  /** A refusal stays on the roster, so the person cannot book again (ruling 538 labels it). */
  status: 'confirmed' | 'waitlisted' | 'refused';
  waitlistPosition: number | null;
  enrolledAt: string;
  /** The booking's roster row: what the roster's requests name (`roster-requests.ts`). */
  personId: string;
  global_person_id?: string | null;
  /** No account holds the booking's roster row (ruling 264). */
  guest: boolean;
  /** When the person was ticked present in this session (rulings 539-547). */
  checkedInAt?: string | null;
  persons: {
    id: string;
    givenName: string;
    familyName: string;
    clubs: { name: string } | null;
  } | null;
}

/** A roster badge's colours, by the booking's state. */
const BADGE_TONE: Record<RosterEntry['status'], string> = {
  confirmed: 'bg-success/10 text-success',
  waitlisted: 'bg-warning/10 text-warning',
  refused: 'bg-danger/10 text-danger',
};

const EMPTY_FORM = {
  title: '',
  slug: '',
  category: '',
  level: '',
  weapon: '',
  language: 'fr',
  capacity: 20,
  durationMinutes: '' as string | number,
  description: '',
  venueId: '' as string,
  color: '' as string,
  status: 'draft',
  /** Off by default (543). */
  autoCheckIn: false,
  /** One line per session (rulings 515, 524). */
  sessions: [blankLine('')] as SessionLine[],
  instructorIds: [] as string[],
};

export default function WorkshopsAdminPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = getPublicApiUrl();
  const { confirm, confirmDialog } = useConfirm();
  // New here. Ten writes on this page had NO success check at all — the board
  // writes especially, where a refusal just made the card snap back on the
  // next refresh with nothing said.
  const toast = useToast();
  const { t, locale } = useI18n();
  // An archived Event takes no save from this page but the roster's "Link" (ruling 377).
  const { isReadOnly } = useEventStatus(eventId);

  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Event days + timezone (for the schedule fields + board, resolved in event tz).
  const [eventDays, setEventDays] = useState<string[]>([]);
  const [eventTz, setEventTz] = useState<string>('Europe/Paris');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Silent: the day picker just stays empty.
      const r = await apiRequest<{
        start_date: string;
        end_date?: string | null;
        timezone?: string | null;
      }>(apiUrl, `/api/v1/events/${eventId}`);
      if (!r.ok || cancelled) return;
      setEventDays(eachDay(r.data.start_date, r.data.end_date ?? null));
      if (r.data.timezone) setEventTz(r.data.timezone);
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
      // Silent: the instructor picker stays empty.
      const r = await apiRequest<Array<{ personId: string; displayName: string }>>(
        apiUrl,
        `/api/v1/events/${eventId}/instructors`,
      );
      if (r.ok && !cancelled) setEventInstructors(r.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, eventId, refreshKey]);

  // Weapon options for the workshop editor — the active shared weapon_catalog
  // (same strict source as tournaments). The stored value must be a catalog
  // entry; the API rejects anything else.
  const weaponOptions = useWeaponOptions();

  // Create / edit modal. `editingId` null → create, else editing that workshop.
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Workshop logo staging. The workshop may not exist yet (create path),
  // so we hold the baked PNG blob and POST it to /workshops/:id/logo
  // after the create/patch resolves the id — mirroring the deferred
  // session + instructor writes below. `logoRemoved` clears an existing
  // logo on save; `existingLogoUrl` is the currently-saved logo (edit).
  const [logoBlob, setLogoBlob] = useState<Blob | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [existingLogoUrl, setExistingLogoUrl] = useState<string | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);

  const WORKSHOP_LOGO_MAX_BYTES = 15 * 1024 * 1024;

  function resetLogoState() {
    setLogoBlob(null);
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setExistingLogoUrl(null);
    setLogoRemoved(false);
  }

  function stageLogo(blob: Blob, previewUrl: string) {
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return previewUrl;
    });
    setLogoBlob(blob);
    setLogoRemoved(false);
  }

  function clearLogo() {
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setLogoBlob(null);
    // Only mark a server-side removal when there was a saved logo.
    setLogoRemoved(Boolean(existingLogoUrl));
    setExistingLogoUrl(null);
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    resetLogoState();
    setShowCreate(true);
  }

  function openEdit(w: Workshop) {
    setEditingId(w.id);
    resetLogoState();
    setExistingLogoUrl(w.coverImageUrl ?? null);
    setForm({
      title: w.title,
      slug: w.slug,
      category: w.category ?? '',
      level: w.level ?? '',
      weapon: w.weapon ?? '',
      language: w.language ?? 'fr',
      capacity: w.capacity ?? 20,
      durationMinutes: w.durationMinutes ?? '',
      description: '',
      venueId: w.venueId ?? '',
      color: w.color ?? '',
      status: w.status,
      autoCheckIn: w.autoCheckIn === true,
      sessions: linesOf(w.sessions, eventTz, w.venueId ?? ''),
      instructorIds: w.instructors
        .map((i) => i.globalPersonId)
        .filter((x): x is string => Boolean(x)),
    });
    setFormError(null);
    setShowCreate(true);
    // Enrich with the long description (not present in the list payload).
    void (async () => {
      // Silent: the description just stays blank, and the save below only
      // touches it when one was typed.
      const r = await apiRequest<{ descriptionMd?: string | null }>(
        apiUrl,
        `/api/v1/workshops/${w.id}`,
      );
      if (r.ok) setForm((f) => ({ ...f, description: r.data.descriptionMd ?? '' }));
    })();
  }

  function closeModal() {
    setShowCreate(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    resetLogoState();
  }

  // Roster modal
  const [rosterSession, setRosterSession] = useState<string | null>(null);
  // A cancelled session's roster promotes nobody (ruling 526; the server refuses it too).
  const rosterCancelled = workshops.some((w) =>
    w.sessions.some((s) => s.id === rosterSession && isCancelledSession(s)),
  );
  const rosterWorkshop = workshops.find((w) => w.sessions.some((s) => s.id === rosterSession));
  const rosterSessionRow = rosterWorkshop?.sessions.find((s) => s.id === rosterSession);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  /**
   * The roster reads, one owner. `seq` numbers each read: only the last one asked lands, so a
   * slow answer (another session's, or an older read of this one) is dropped. `of` is the session
   * whose list is on screen, null once the dialog closes. Refs, not state: a Promote's answer
   * re-reads from the render that sent it, whose state is old.
   */
  const rosterRead = useRef<{ seq: number; of: string | null }>({ seq: 0, of: null });
  const closeRoster = () => {
    rosterRead.current.of = null;
    setRosterSession(null);
  };
  // Who a message from the roster reaches: seats and waiting list, as the server counts them.
  const rosterBooked = roster.filter(
    (e) => e.status === 'confirmed' || e.status === 'waitlisted',
  ).length;
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
      // Silent: the picker shows empty plus its warning hint.
      const orgRes = await apiRequest<{ id: string }>(
        apiUrl,
        `/api/v1/organizations/slug/${encodeURIComponent(slug)}`,
      );
      if (!orgRes.ok || cancelled) return;
      const venuesRes = await apiRequest<EventVenue[]>(
        apiUrl,
        `/api/v1/organizations/${orgRes.data.id}/venues`,
      );
      if (venuesRes.ok && !cancelled) {
        setVenues(venuesRes.data.filter((v) => v.hosts_workshop));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, slug, refreshKey]);

  // ── Fetch workshops ────────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<Workshop[]>(apiUrl, `/api/v1/events/${eventId}/workshops`, {
      signal: controller.signal,
    }).then((r) => {
      setLoading(false);
      if (r.ok) {
        setWorkshops(r.data);
        return;
      }
      // No message is the unmount, or the refresh that replaced this read. An
      // empty list and a refused list used to look identical.
      const message = failureMessage(r, t, t('admin.common.loadFailed'));
      if (message) toast.error(message);
    });
    return () => controller.abort();
  }, [eventId, apiUrl, refreshKey, t, toast]);

  // ── Create workshop ────────────────────────────────────────────────────────────

  const formDuration = form.durationMinutes ? Number(form.durationMinutes) : null;

  /**
   * Send the form's sessions of `workshopId` (rulings 515, 524, 525). A refused call keeps the
   * form open with what was created so far: the ids are written into the lines, so a second save
   * does not create them again. Answers whether every call landed.
   */
  async function saveSessions(workshopId: string, existing: ExistingSession[]): Promise<boolean> {
    const calls = sessionEdits(form.sessions, existing, eventTz, formDuration, form.venueId);
    const done = await applySessionEdits(calls, form.sessions, async (call) => {
      const r =
        call.method === 'POST'
          ? await apiRequest<{ id: string }>(apiUrl, `/api/v1/workshops/${workshopId}/sessions`, {
              method: 'POST',
              body: call.body,
            })
          : await apiRequest<{ id: string }>(
              apiUrl,
              `/api/v1/workshop-sessions/${call.sessionId}`,
              {
                method: call.method,
                ...(call.method === 'PATCH' ? { body: call.body } : {}),
              },
            );
      return r.ok ? { ok: true, id: r.data?.id } : { ok: false, failure: r };
    });
    if (!done.failure) return true;
    setForm((f) => ({ ...f, sessions: done.lines }));
    const message = failureMessage(done.failure, t, t('admin.common.saveFailed'));
    if (message) setFormError(message);
    setRefreshKey((k) => k + 1);
    return false;
  }

  // POST the staged (cropped) logo blob after the workshop id exists.
  // Throws on failure so the caller surfaces the error and keeps the
  // modal open for a retry (the workshop itself is already saved).
  async function uploadStagedLogo(workshopId: string) {
    if (!logoBlob) return;
    const fd = new FormData();
    fd.append('file', new File([logoBlob], 'logo.png', { type: 'image/png' }));
    const r = await apiRequest(apiUrl, `/api/v1/workshops/${workshopId}/logo`, {
      method: 'POST',
      body: fd,
    });
    if (!r.ok) {
      // Still throws: the caller keeps the modal open for a retry because the
      // workshop itself is already saved. No signal here, so the abort
      // `failureMessage` answers null for cannot arrive.
      const reason = t('admin.common.saveFailed');
      throw new Error(failureMessage(r, t, reason) ?? reason);
    }
  }

  /**
   * Deleting a session deletes its bookings with it: ask first when it holds any.
   * The roster is read now, because the list on this page is as old as its last
   * load and a fighter may have booked since.
   */
  async function mayDeleteSession(sessionId: string): Promise<boolean> {
    const workshop = workshops.find((w) => w.sessions.some((s) => s.id === sessionId));
    const roster = await apiRequest<RosterEntry[]>(
      apiUrl,
      `/api/v1/workshop-sessions/${sessionId}/roster`,
    );
    const booked = roster.ok
      ? roster.data.filter((e) => e.status === 'confirmed' || e.status === 'waitlisted').length
      : null;
    const cancelled = workshop?.sessions.some((s) => s.id === sessionId && isCancelledSession(s));
    const question = sessionDeleteQuestion(workshop?.title ?? '', booked, t, cancelled);
    return !question || confirm(question);
  }

  async function handleSubmit() {
    if (!form.title.trim() || !form.slug.trim()) {
      setFormError(t('admin.common.titleAndSlugRequired'));
      return;
    }
    setFormSaving(true);
    setFormError(null);

    try {
      // A session whose line was removed, or whose day was cleared, is deleted with its
      // bookings: each is asked about before anything is sent, and inside the saving state, so
      // the Escape that answers the question does not close the form behind it too.
      const current = editingId ? workshops.find((w) => w.id === editingId) : undefined;
      for (const dropped of removedSessions(
        form.sessions,
        current?.sessions ?? [],
        eventTz,
        formDuration,
      )) {
        if (!(await mayDeleteSession(dropped.id))) return;
      }
      if (editingId) {
        const patchRes = await apiRequest(apiUrl, `/api/v1/workshops/${editingId}`, {
          method: 'PATCH',
          body: {
            title: form.title.trim(),
            category: form.category.trim() || null,
            level: form.level.trim() || null,
            weapon: form.weapon.trim() || null,
            language: form.language,
            capacity: form.capacity,
            durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
            status: form.status,
            color: form.color || null,
            venueId: form.venueId || null,
            autoCheckIn: form.autoCheckIn,
            // Clear a saved logo when the operator removed it. Setting a
            // new logo goes through the dedicated upload endpoint below.
            ...(logoRemoved ? { coverImageUrl: null } : {}),
            // Only touch the description when one was typed, so editing
            // other fields never silently wipes an existing description.
            ...(form.description.trim() ? { descriptionMd: form.description.trim() } : {}),
          },
        });
        if (!patchRes.ok) {
          const message = failureMessage(patchRes, t, t('admin.common.saveFailed'));
          if (message) setFormError(message);
          return;
        }

        // Reconcile instructors against the chosen set.
        const currentIds = new Set(
          (current?.instructors ?? [])
            .map((i) => i.globalPersonId)
            .filter((x): x is string => Boolean(x)),
        );
        const nextIds = new Set(form.instructorIds);
        for (const id of nextIds) {
          if (!currentIds.has(id)) {
            await apiRequest(apiUrl, `/api/v1/workshops/${editingId}/instructors`, {
              method: 'POST',
              body: { globalPersonId: id },
            });
          }
        }
        for (const id of currentIds) {
          if (!nextIds.has(id)) {
            await apiRequest(apiUrl, `/api/v1/workshops/${editingId}/instructors/${id}`, {
              method: 'DELETE',
            });
          }
        }

        // Sessions: a refusal keeps the form open, the Workshop itself is saved.
        if (!(await saveSessions(editingId, current?.sessions ?? []))) return;

        await uploadStagedLogo(editingId);

        closeModal();
        setRefreshKey((k) => k + 1);
        return;
      }

      // ── Create path ──
      const r = await apiRequest<{ id: string }>(apiUrl, `/api/v1/events/${eventId}/workshops`, {
        method: 'POST',
        body: {
          title: form.title.trim(),
          slug: form.slug.trim(),
          category: form.category.trim() || null,
          level: form.level.trim() || null,
          weapon: form.weapon.trim() || undefined,
          language: form.language,
          capacity: form.capacity,
          durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
          descriptionMd: form.description.trim() || null,
          status: form.status,
          color: form.color || undefined,
          venueId: form.venueId || undefined,
          autoCheckIn: form.autoCheckIn,
        },
      });
      if (!r.ok) {
        // A slug already used on this event is refused by name — and it is the
        // most common thing to get wrong on this form.
        const message = failureMessage(r, t, t('admin.common.createFailed'));
        if (message) setFormError(message);
        return;
      }
      const created = r.data;

      for (const globalPersonId of form.instructorIds) {
        await apiRequest(apiUrl, `/api/v1/workshops/${created.id}/instructors`, {
          method: 'POST',
          body: { globalPersonId },
        });
      }

      // A refused session leaves the Workshop created: the form turns to editing it, so a second
      // save sends the sessions left, not a second Workshop (its slug would be refused).
      if (!(await saveSessions(created.id, []))) {
        setEditingId(created.id);
        return;
      }

      await uploadStagedLogo(created.id);

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
    const r = await apiRequest(apiUrl, `/api/v1/workshops/${w.id}`, {
      method: 'PATCH',
      body: { status: next },
    });
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.common.saveFailed'));
      if (message) toast.error(message);
      return;
    }
    setRefreshKey((k) => k + 1);
  }

  // ── Roster ────────────────────────────────────────────────────────────────────

  async function openRoster(sessionId: string) {
    // Another session's list must not stand in for this one's when the read fails: its names
    // would show under this session, and its count would head this session's message.
    if (rosterRead.current.of !== sessionId) setRoster([]);
    const read = ++rosterRead.current.seq;
    rosterRead.current.of = sessionId;
    setRosterSession(sessionId);
    setRosterLoading(true);
    const r = await apiRequest<RosterEntry[]>(
      apiUrl,
      `/api/v1/workshop-sessions/${sessionId}/roster`,
    );
    if (rosterRead.current.seq !== read) return;
    if (r.ok) {
      setRoster(r.data);
    } else {
      const message = failureMessage(r, t, t('admin.common.loadFailed'));
      if (message) toast.error(message);
    }
    setRosterLoading(false);
  }

  /**
   * The roster read again after a write, only while the dialog still shows that session: a slow
   * answer to a Remove reopened a roster the organiser had closed, or switched it back.
   */
  async function rereadRoster(sessionId: string) {
    if (rosterRead.current.of === sessionId) await openRoster(sessionId);
  }

  async function handlePromote(sessionId: string, entry: RosterEntry) {
    const { path, method } = rosterRequests(sessionId, entry).promote;
    const r = await apiRequest(apiUrl, path, { method });
    if (!r.ok) {
      // A full session refuses the promotion by name. The write had no success
      // check at all, so the roster just re-rendered unchanged.
      const message = failureMessage(r, t, t('admin.common.promoteFailed'));
      if (message) toast.error(message);
      return;
    }
    await rereadRoster(sessionId);
  }

  // Delete the Workshop being edited: one nobody is booked on (operator ruling, 2026-11-09).
  async function handleDeleteWorkshop() {
    const workshop = workshops.find((w) => w.id === editingId);
    if (!workshop || !(await confirm(workshopDeleteQuestion(workshop.title, t)))) return;
    const r = await apiRequest(apiUrl, `/api/v1/workshops/${workshop.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const message = workshopDeleteRefusal(r, t);
      if (message) toast.error(message);
      return;
    }
    closeModal();
    setRefreshKey((k) => k + 1);
  }

  async function handleRemove(sessionId: string, entry: RosterEntry) {
    if (
      !(await confirm({
        confirmLabel: t('actions.confirm'),
        cancelLabel: t('actions.cancel'),
        title: t('admin.common.confirmRemoveEnrollment'),
        danger: true,
      }))
    )
      return;
    const { path, method } = rosterRequests(sessionId, entry).remove;
    const r = await apiRequest(apiUrl, path, { method });
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.common.removeFailed'));
      if (message) toast.error(message);
      return;
    }
    await rereadRoster(sessionId);
  }

  // ── Global person search for enrollment linking ────────────────────────────

  useEffect(() => {
    if (gpSearch.trim().length < 2) {
      const timer = setTimeout(() => setGpResults([]), 0);
      return () => clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // NOT behaviour-preserving, and that is the point: this one sent NO
      // credentials at all. `/global-persons` refuses an anonymous caller
      // outright, so on a cross-origin API base URL the person picker returned
      // nothing and said nothing — same-origin it worked only because the
      // cookie rides along by default. The seam always sends them.
      void apiRequest<GlobalPersonResult[]>(
        apiUrl,
        `/api/v1/global-persons?q=${encodeURIComponent(gpSearch)}`,
        { signal: controller.signal },
      ).then((r) => {
        if (r.ok) setGpResults(r.data);
      });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [gpSearch, apiUrl]);

  async function linkEnrollmentToGlobalPerson(enrollmentId: string, globalPersonId: string) {
    const r = await apiRequest(
      apiUrl,
      `/api/v1/global-persons/${globalPersonId}/link-workshop-enrollment`,
      { method: 'PATCH', body: { enrollmentId } },
    );
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.common.saveFailed'));
      if (message) toast.error(message);
      return;
    }
    setLinkingEnrollmentId(null);
    setGpSearch('');
    setGpResults([]);
    if (rosterSession) await rereadRoster(rosterSession);
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
  // An instructor busy elsewhere at the same time turns the card red (rulings 553-555).
  const personClashes = useInstructorClashes(apiUrl, eventId, tab === 'schedule', workshops, t);

  // ── List header: fuzzy search + column filters + sort ───────────────────────────
  //
  // The whole list is fetched in one go (no server paging), so everything here
  // is a client-side derivation. Filter values live in the query string so a
  // reload or a back-navigation lands the organiser back on the same view.

  const { query, filter, setQuery, setFilter, clear: clearFilters } = useWorkshopListFilters();

  // Options come from the loaded rows: category and level are free text, so
  // there is no enum to read them from.
  const filterOptions = useMemo(() => deriveWorkshopFilterOptions(workshops), [workshops]);
  const filteredWorkshops = useMemo(
    () =>
      workshops.filter(
        (w) => fuzzyMatch(query, workshopSearchHaystack(w)) && workshopMatchesFilter(w, filter),
      ),
    [workshops, query, filter],
  );
  const getWorkshopSortValue = useCallback((row: Workshop, key: string) => {
    return workshopSortValue(row, key);
  }, []);
  const {
    sorted: visibleWorkshops,
    sortKey,
    direction,
    toggle: toggleSort,
  } = useSortableList(filteredWorkshops, getWorkshopSortValue);
  const filterActive = isWorkshopFilterActive(filter, query);

  // Workshop-only break blocks for the schedule board.
  const [breaks, setBreaks] = useState<WorkshopBreak[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Silent: the board just renders no breaks.
      const r = await apiRequest<WorkshopBreak[]>(
        apiUrl,
        `/api/v1/events/${eventId}/workshop-breaks`,
      );
      if (r.ok && !cancelled) setBreaks(r.data);
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
    const path = editing
      ? `/api/v1/workshop-breaks/${editing.id}`
      : `/api/v1/events/${eventId}/workshop-breaks`;
    const r = await apiRequest(apiUrl, path, { method: editing ? 'PATCH' : 'POST', body });
    if (!r.ok) {
      // A break overlapping a placed session is refused by name; the write had
      // no success check, so the modal closed as if it had worked.
      const message = failureMessage(r, t, t('admin.common.saveFailed'));
      if (message) toast.error(message);
      return;
    }
    setBreakModal(null);
    setRefreshKey((k) => k + 1);
  }
  async function deleteBreak() {
    const editing = breakModal && 'id' in breakModal ? breakModal : null;
    if (!editing) return;
    const r = await apiRequest(apiUrl, `/api/v1/workshop-breaks/${editing.id}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.common.deleteFailed'));
      if (message) toast.error(message);
      return;
    }
    setBreakModal(null);
    setRefreshKey((k) => k + 1);
  }

  // Drag/resize on the board → move the session it names, or add a session when it names none.
  async function handlePlaceSession(
    workshopId: string,
    sessionId: string | null,
    placement: { venueId: string; areaId: string | null; startTime: string; endTime: string },
  ) {
    // The race this touches: the board is optimistic, and the refresh below is
    // what reconciles it. A refused placement used to leave the card where the
    // operator dropped it until that refresh silently moved it back.
    // The whole place is sent: an update keeps a field it is not sent, so a card dropped on a
    // venue with no rooms sends its room as null.
    const body = {
      startTime: placement.startTime,
      endTime: placement.endTime,
      venueId: placement.venueId,
      areaId: placement.areaId,
    };
    const r = sessionId
      ? await apiRequest(apiUrl, `/api/v1/workshop-sessions/${sessionId}`, {
          method: 'PATCH',
          body,
        })
      : await apiRequest(apiUrl, `/api/v1/workshops/${workshopId}/sessions`, {
          method: 'POST',
          body,
        });
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.common.saveFailed'));
      if (message) toast.error(message);
    }
    setRefreshKey((k) => k + 1);
  }

  // ✕ on a card → delete its session, returning the workshop to the drawer.
  async function handleUnschedule(sessionId: string) {
    if (!(await mayDeleteSession(sessionId))) return;
    const r = await apiRequest(apiUrl, `/api/v1/workshop-sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.common.deleteFailed'));
      if (message) toast.error(message);
    }
    setRefreshKey((k) => k + 1);
  }

  // Drag/resize a break bar on the board → PATCH its new HH:MM window.
  async function handleUpdateBreak(
    b: WorkshopBreak,
    times: { startTime: string; endTime: string },
  ) {
    const r = await apiRequest(apiUrl, `/api/v1/workshop-breaks/${b.id}`, {
      method: 'PATCH',
      body: times,
    });
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.common.saveFailed'));
      if (message) toast.error(message);
    }
    setRefreshKey((k) => k + 1);
  }

  async function handleDeleteBreakById(id: string) {
    const r = await apiRequest(apiUrl, `/api/v1/workshop-breaks/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.common.deleteFailed'));
      if (message) toast.error(message);
    }
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
            <OrgCrumb slug={slug} className="hover:text-foreground-secondary" />
            <span>/</span>
            <EventCrumb
              slug={slug}
              eventId={eventId}
              className="hover:text-foreground-secondary"
              fallback={t('organizer.workshopsPage.breadcrumbEvent')}
            />
            <span>/</span>
            <span className="text-foreground font-medium">
              {t('organizer.workshopsPage.breadcrumbWorkshops')}
            </span>
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('organizer.workshopsPage.title')}
          </h1>
        </div>
        <button
          onClick={openCreate}
          disabled={isReadOnly}
          title={isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
          className="bg-accent hover:bg-accent-hover text-accent-foreground font-semibold py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {t('organizer.workshopsPage.newWorkshop')}
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
            {tk === 'list'
              ? t('organizer.workshopsPage.tabList')
              : t('organizer.workshopsPage.tabSchedule')}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted text-sm">{t('organizer.workshopsPage.loading')}</p>
      ) : tab === 'schedule' ? (
        <WorkshopScheduleBoard
          workshops={workshops.map((w) => ({
            ...w,
            instructorNames: w.instructors.map((i) => i.displayName),
            // Drawn struck through, its room free (rulings 526, 528).
            sessions: w.sessions.map((s) => ({ ...s, cancelled: isCancelledSession(s) })),
          }))}
          venues={venues}
          days={eventDays}
          timezone={eventTz}
          breaks={breaks}
          readOnly={isReadOnly}
          personClashes={personClashes.lines}
          busyUnchecked={personClashes.unchecked}
          onPlace={(wid, sid, placement) => void handlePlaceSession(wid, sid, placement)}
          onBlockClick={(_wid, sessionId) => void openRoster(sessionId)}
          onUnschedule={isReadOnly ? undefined : (sessionId) => void handleUnschedule(sessionId)}
          onAddBreak={isReadOnly ? undefined : openBreakCreate}
          onEditBreak={isReadOnly ? undefined : openBreakEdit}
          onUpdateBreak={isReadOnly ? undefined : (b, times) => void handleUpdateBreak(b, times)}
          onDeleteBreak={isReadOnly ? undefined : (id) => void handleDeleteBreakById(id)}
        />
      ) : workshops.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
          <p className="text-muted text-sm">{t('organizer.workshopsPage.empty')}</p>
        </div>
      ) : (
        <>
          {filterActive && (
            <div className="mb-2 flex items-center justify-end gap-3 text-xs text-muted">
              <span>
                {t('organizer.workshopsPage.filters.matchCount', {
                  count: visibleWorkshops.length,
                  total: workshops.length,
                })}
              </span>
              <button
                type="button"
                onClick={clearFilters}
                className="font-semibold text-accent hover:text-accent-hover"
              >
                {t('organizer.workshopsPage.filters.clear')}
              </button>
            </div>
          )}
          {/* The header controls widen the columns past a laptop viewport;
              the table scrolls inside DataTable's overflow-x-auto rather than
              squeezing the schedule column into four wrapped lines. */}
          <DataTable className="min-w-[72rem]">
            <DataTableHead>
              <WorkshopsTableHeader
                sortKey={sortKey}
                direction={direction}
                onToggleSort={toggleSort}
                query={query}
                onQueryChange={setQuery}
                filter={filter}
                onFilterChange={setFilter}
                options={filterOptions}
              />
            </DataTableHead>
            <tbody>
              {visibleWorkshops.length === 0 && (
                <DataTableRow>
                  <DataTableCell colSpan={9} className="text-center text-muted">
                    {t('organizer.workshopsPage.filters.emptyFiltered')}
                  </DataTableCell>
                </DataTableRow>
              )}
              {visibleWorkshops.map((w) => {
                // Every session on its own line (ruling 515); a Workshop with none says '—'.
                const sessions = w.sessions.length > 0 ? w.sessions : [null];
                const bcp47 = localeToBcp47(locale);
                return (
                  <DataTableRow key={w.id}>
                    <DataTableCell className="relative">
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
                    </DataTableCell>
                    <DataTableCell className="text-foreground-secondary">
                      {w.category ?? '—'}
                    </DataTableCell>
                    <DataTableCell className="text-foreground-secondary">
                      {w.level ?? '—'}
                    </DataTableCell>
                    <DataTableCell className="text-foreground-secondary">
                      {w.capacity ?? '—'}
                    </DataTableCell>
                    <DataTableCell className="text-foreground-secondary">
                      {w.durationMinutes != null
                        ? t('organizer.workshopsPage.board.minutesShort', {
                            min: w.durationMinutes,
                          })
                        : '—'}
                    </DataTableCell>
                    <DataTableCell className="whitespace-nowrap text-foreground-secondary">
                      {sessions.map((s, i) => (
                        <p key={s?.id ?? i}>
                          {/* A cancelled session: struck through and named (ruling 526). */}
                          <span className={s && isCancelledSession(s) ? 'line-through' : undefined}>
                            {s ? sessionTimeRange(s, eventTz, bcp47) : '—'}
                          </span>
                          {s && isCancelledSession(s) && (
                            <span className="ml-1 font-semibold">
                              · {statusLabel('workshopSession', 'cancelled', t)}
                            </span>
                          )}
                        </p>
                      ))}
                    </DataTableCell>
                    <DataTableCell className="text-foreground-secondary">
                      {sessions.map((s, i) => (
                        <p key={s?.id ?? i}>{sessionPlaceLabel(s, w.venue?.name ?? null)}</p>
                      ))}
                    </DataTableCell>
                    <DataTableCell>
                      <select
                        value={w.status}
                        onChange={(e) => void changeStatus(w, e.target.value)}
                        disabled={isReadOnly}
                        aria-label={t('organizer.workshopsPage.statusAria')}
                        className={`${statusPillClass(workshopStatusSemantic(w.status), 'light', {
                          size: 'sm',
                        })} cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
                      >
                        {['draft', 'published', 'running', 'completed'].map((s) => (
                          <option key={s} value={s}>
                            {STATUS_KEYS[s] ? t(STATUS_KEYS[s]) : s}
                          </option>
                        ))}
                      </select>
                    </DataTableCell>
                    <DataTableCell>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => openEdit(w)}
                          disabled={isReadOnly}
                          title={
                            isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined
                          }
                          className="text-xs font-semibold text-accent hover:text-accent-hover disabled:opacity-50"
                        >
                          {t('organizer.workshopsPage.edit')}
                        </button>
                        {/* One roster per session; with several, each names its time. */}
                        {w.sessions.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => void openRoster(s.id)}
                            className="text-xs text-info hover:underline"
                          >
                            {w.sessions.length > 1
                              ? t('organizer.workshopsPage.rosterOf', {
                                  when: sessionTimeRange(s, eventTz, bcp47),
                                })
                              : t('organizer.workshopsPage.roster')}
                          </button>
                        ))}
                      </div>
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </tbody>
          </DataTable>
        </>
      )}

      {/* Create modal */}
      <Modal
        open={showCreate}
        onClose={closeModal}
        busy={formSaving}
        size="md"
        title={
          editingId
            ? t('organizer.workshopsPage.editWorkshop')
            : t('organizer.workshopsPage.newWorkshopTitle')
        }
        footer={
          <>
            {editingId && (
              <button
                onClick={() => void handleDeleteWorkshop()}
                disabled={formSaving}
                className="mr-auto text-sm text-danger hover:underline disabled:opacity-50"
              >
                {t('organizer.workshopsPage.delete')}
              </button>
            )}
            <button onClick={closeModal} className="text-sm text-muted px-4 py-2">
              {t('organizer.schedulePage.editPopover.cancel')}
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={formSaving}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm"
            >
              {formSaving
                ? t('organizer.schedulePage.planner.saving')
                : editingId
                  ? t('organizer.schedulePage.editPopover.save')
                  : t('organizer.workshopsPage.create')}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1">
              {t('organizer.workshopsPage.titleLabel')}
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
              {t('organizer.workshopsPage.slugLabel')}
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
          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1">
              {t('organizer.workshopsPage.weaponLabel')}
            </label>
            <select
              value={form.weapon}
              onChange={(e) => setForm((f) => ({ ...f, weapon: e.target.value }))}
              aria-label={t('organizer.workshopsPage.weaponLabel')}
              className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">—</option>
              {/* Union an edited workshop's stored weapon even if it's no
                      longer an active catalog entry, so it stays selected. */}
              {(form.weapon && !weaponOptions.includes(form.weapon)
                ? [form.weapon, ...weaponOptions]
                : weaponOptions
              ).map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                {t('organizer.workshopsPage.categoryLabel')}
              </label>
              <input
                aria-label={t('organizer.workshopsPage.categoryLabel')}
                type="text"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder={t('organizer.workshopsPage.categoryPlaceholder')}
                className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                {t('organizer.workshopsPage.levelLabel')}
              </label>
              <input
                aria-label={t('organizer.workshopsPage.levelLabel')}
                type="text"
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                placeholder={t('organizer.workshopsPage.levelPlaceholder')}
                className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                {t('organizer.workshopsPage.languageLabel')}
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
                {t('organizer.workshopsPage.capacityLabel')}
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
                {t('organizer.workshopsPage.durationLabel')}
              </label>
              <input
                aria-label={t('organizer.workshopsPage.durationLabel')}
                type="number"
                value={form.durationMinutes}
                min={1}
                placeholder={t('organizer.workshopsPage.durationPlaceholder')}
                onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {/* The sessions, one line each (rulings 515, 524, 525) */}
          <WorkshopSessionsField
            lines={form.sessions}
            onChange={(sessions) => setForm((f) => ({ ...f, sessions }))}
            days={eventDays}
            venues={venues}
            workshopVenueId={form.venueId}
            durationMinutes={formDuration}
          />

          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1">
              {t('organizer.workshopsPage.statusLabel')}
            </label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="draft">{t('organizer.workshopsPage.statusDraft')}</option>
              <option value="published">{t('organizer.workshopsPage.statusPublished')}</option>
              <option value="running">{t('organizer.workshopsPage.statusRunning')}</option>
              <option value="completed">{t('organizer.workshopsPage.statusCompleted')}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1">
              {t('organizer.workshopsPage.instructorsLabel')}
            </label>
            {eventInstructors.length === 0 ? (
              <p className="text-xs text-warning">{t('organizer.workshopsPage.noInstructors')}</p>
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
          {/* The front desk ticks this Workshop's people on the day they arrive (540, 543). */}
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.autoCheckIn}
                onChange={(e) => setForm((f) => ({ ...f, autoCheckIn: e.target.checked }))}
                className="rounded"
              />
              {t('organizer.workshopsPage.autoCheckIn')}
            </label>
            <p className="mt-1 text-xs text-muted">
              {t('organizer.workshopsPage.autoCheckInHint')}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1">
              {t('organizer.workshopsPage.defaultVenueLabel')}
            </label>
            <select
              value={form.venueId}
              onChange={(e) => setForm((f) => ({ ...f, venueId: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">{t('organizer.workshopsPage.noDefaultVenue')}</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            {venues.length === 0 && (
              <p className="mt-1 text-xs text-warning">
                {t('organizer.workshopsPage.noOrgVenues', { slug })}
              </p>
            )}
          </div>
          <WorkshopLogoField
            existingUrl={existingLogoUrl}
            previewUrl={logoPreview}
            maxBytes={WORKSHOP_LOGO_MAX_BYTES}
            disabled={formSaving}
            onStage={stageLogo}
            onClear={clearLogo}
          />
          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1">
              {t('organizer.schedulePage.editPopover.colorLabel')}
            </label>
            <div className="flex items-center gap-2">
              <TournamentColorDot color={form.color || null} size="md" />
              <select
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">{t('organizer.workshopsPage.noColor')}</option>
                {TOURNAMENT_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {statusLabel('color', c, t)}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-1 text-xs text-muted">{t('organizer.workshopsPage.colorHint')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-secondary mb-1">
              {t('organizer.workshopsPage.descriptionLabel')}
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
      </Modal>

      {/* Roster modal */}
      {rosterSession && (
        <Modal
          open
          onClose={closeRoster}
          size="md"
          title={t('organizer.workshopsPage.rosterTitle')}
        >
          {rosterWorkshop && rosterSessionRow && (
            <RosterSheetActions
              workshop={rosterWorkshop}
              session={rosterSessionRow}
              roster={roster}
              tz={eventTz}
              rereading={rosterLoading}
            />
          )}
          {rosterLoading ? (
            <p className="text-muted text-sm">{t('organizer.workshopsPage.loading')}</p>
          ) : roster.length === 0 ? (
            <p className="text-muted text-sm">{t('organizer.workshopsPage.noEnrollments')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {roster.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between border border-border rounded-lg px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <RosterName
                      name={
                        entry.persons
                          ? `${entry.persons.givenName} ${entry.persons.familyName}`
                          : null
                      }
                      guest={entry.guest}
                      club={entry.persons?.clubs?.name ?? null}
                    />
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded font-medium ${BADGE_TONE[entry.status]}`}
                      >
                        {entry.status === 'waitlisted'
                          ? t('organizer.workshopsPage.waitlistBadge', {
                              position: entry.waitlistPosition,
                            })
                          : entry.status === 'refused'
                            ? t('organizer.workshopsPage.refusedBadge')
                            : t('organizer.workshopsPage.confirmedBadge')}
                      </span>
                      {entry.global_person_id ? (
                        <span className="text-xs text-success font-medium">
                          {t('organizer.workshopsPage.linked')}
                        </span>
                      ) : linkingEnrollmentId === entry.id ? (
                        <div className="relative">
                          <input
                            aria-label={t('organizer.workshopsPage.searchGlobalPersonPlaceholder')}
                            type="search"
                            value={gpSearch}
                            onChange={(e) => setGpSearch(e.target.value)}
                            placeholder={t('organizer.workshopsPage.searchGlobalPersonPlaceholder')}
                            className="border border-border rounded px-2 py-0.5 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                          {gpResults.length > 0 && (
                            <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded shadow text-xs max-h-28 overflow-y-auto z-10 w-48">
                              {gpResults.map((gp) => (
                                <button
                                  key={gp.id}
                                  onClick={() => void linkEnrollmentToGlobalPerson(entry.id, gp.id)}
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
                          {t('organizer.workshopsPage.link')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <RosterCheckIn
                      apiUrl={apiUrl}
                      sessionId={rosterSession}
                      booking={entry}
                      name={
                        entry.persons
                          ? `${entry.persons.givenName} ${entry.persons.familyName}`
                          : t('organizer.workshopsPage.unknownPerson')
                      }
                      readOnly={isReadOnly}
                      cancelled={rosterCancelled}
                      onSaved={(bookingId, checkedInAt) =>
                        setRoster((rows) =>
                          rows.map((row) => (row.id === bookingId ? { ...row, checkedInAt } : row)),
                        )
                      }
                    />
                    {entry.status === 'waitlisted' && !rosterCancelled && (
                      <button
                        onClick={() => void handlePromote(rosterSession, entry)}
                        disabled={isReadOnly}
                        className="text-xs text-success hover:underline disabled:opacity-50"
                      >
                        {t('organizer.workshopsPage.promote')}
                      </button>
                    )}
                    <button
                      onClick={() => void handleRemove(rosterSession, entry)}
                      disabled={isReadOnly}
                      title={
                        isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined
                      }
                      className="text-xs text-danger hover:underline disabled:opacity-50"
                    >
                      {t('organizer.workshopsPage.remove')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* A cancelled session takes nobody (the server refuses it too). One box per session. */}
          {!rosterCancelled && (
            <RosterAddPerson
              key={`add-${rosterSession}`}
              apiUrl={apiUrl}
              eventId={eventId}
              sessionId={rosterSession}
              onRoster={new Set(roster.map((entry) => entry.personId))}
              onAdded={() => rereadRoster(rosterSession)}
              readOnly={isReadOnly}
              rereading={rosterLoading}
            />
          )}
          {/* A cancelled session does nothing (532). Not hidden while the same roster is read
              again after a Remove or a Promote: the draft and the "Sent" line stay. Another
              session's roster starts empty (`openRoster`), so the box waits for its read. */}
          {rosterWorkshop && !rosterCancelled && rosterBooked > 0 && (
            <RosterMessage
              key={rosterSession}
              apiUrl={apiUrl}
              workshopId={rosterWorkshop.id}
              sessionId={rosterSession}
              count={rosterBooked}
              confirm={confirm}
              readOnly={isReadOnly}
              rereading={rosterLoading}
            />
          )}
        </Modal>
      )}

      {/* Break editor modal */}
      {breakModal && (
        <Modal
          open
          onClose={() => setBreakModal(null)}
          size="sm"
          title={
            'id' in breakModal
              ? t('organizer.workshopsPage.editBreak')
              : t('organizer.workshopsPage.newBreak')
          }
          footer={
            <div className="flex w-full items-center justify-between gap-3">
              {'id' in breakModal ? (
                <button
                  onClick={() => void deleteBreak()}
                  className="text-sm text-danger hover:underline"
                >
                  {t('organizer.workshopsPage.delete')}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setBreakModal(null)}
                  className="text-sm text-muted px-4 py-2"
                >
                  {t('organizer.schedulePage.editPopover.cancel')}
                </button>
                <button
                  onClick={() => void saveBreak()}
                  className="bg-accent hover:bg-accent-hover text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm"
                >
                  {t('organizer.schedulePage.editPopover.save')}
                </button>
              </div>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            {eventDays.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  {t('organizer.workshopsPage.dayLabel')}
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
                      {t('organizer.schedulePage.planner.dayTab', { n: i + 1 })}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  {t('organizer.schedulePage.editPopover.startLabel')}
                </label>
                <Time24Input
                  value={breakForm.startTime}
                  onChange={(v) => setBreakForm((f) => ({ ...f, startTime: v }))}
                  aria-label={t('organizer.workshopsPage.breakStartAria')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  {t('organizer.schedulePage.editPopover.endLabel')}
                </label>
                <Time24Input
                  value={breakForm.endTime}
                  onChange={(v) => setBreakForm((f) => ({ ...f, endTime: v }))}
                  aria-label={t('organizer.workshopsPage.breakEndAria')}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                {t('organizer.schedulePage.planner.labelLabel')}
              </label>
              <input
                aria-label={t('organizer.schedulePage.planner.labelLabel')}
                type="text"
                value={breakForm.label}
                placeholder={t('organizer.workshopsPage.breakLabelPlaceholder')}
                onChange={(e) => setBreakForm((f) => ({ ...f, label: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                {t('organizer.schedulePage.editPopover.colorLabel')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {['', '#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#64748b'].map((c) => (
                  <button
                    key={c || 'none'}
                    type="button"
                    aria-label={
                      c
                        ? t('organizer.workshopsPage.colorAria', { hex: c })
                        : t('organizer.workshopsPage.noColor')
                    }
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
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
      {confirmDialog}
    </main>
  );
}

// i18n keys for the status <select> option labels; the pill styling comes from
// the canonical workshopStatusSemantic → statusPillClass helper, which a
// <select> can share even though it can never be a <StatusBadge>.
const STATUS_KEYS: Record<string, string> = {
  draft: 'organizer.workshopsPage.statusDraft',
  published: 'organizer.workshopsPage.statusPublished',
  running: 'organizer.workshopsPage.statusRunning',
  completed: 'organizer.workshopsPage.statusCompleted',
};
