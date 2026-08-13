'use client';

import { useEffect, useState } from 'react';
import { formatInZone } from '@myclash/time';
import { getPublicApiUrl } from '@/lib/api-url';
import { useWeaponOptions } from '@/hooks/useWeaponOptions';
import { useI18n } from '@myclash/next-i18n/client';
import { WorkshopCard, type WorkshopListItem } from '@/components/workshops/WorkshopCard';

// ── Wire shapes (mirror MeEventsService.getInstructorWorkshops) ─────────────────

interface InstructorSession {
  id: string;
  startsAt: string | null;
  endsAt: string | null;
  status: string | null;
  locationLabel: string | null;
  venue: { name: string } | null;
  area: { name: string } | null;
  capacity: number | null;
  confirmedCount: number;
  waitlistCount: number;
}

interface InstructorWorkshop {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  descriptionMd: string | null;
  category: string | null;
  weapon: string | null;
  level: string | null;
  language: string | null;
  color: string | null;
  coverImageUrl: string | null;
  capacity: number | null;
  durationMinutes: number | null;
  sessions: InstructorSession[];
  instructors: Array<{ globalPersonId: string | null; displayName: string }>;
}

interface InstructorGroup {
  event: {
    id: string;
    slug: string;
    name: string;
    timezone: string | null;
    startDate: string | null;
  };
  workshops: InstructorWorkshop[];
}

interface RosterEntry {
  id: string;
  status: string;
  waitlistPosition: number | null;
  personId: string | null;
  persons: {
    id: string;
    givenName: string;
    familyName: string;
    // Event-scoped club (persons.club_id → clubs); null for unaffiliated entrants.
    clubs: { id: string; name: string; abbreviation: string | null } | null;
  } | null;
}

export function InstructorDashboard() {
  const { t, locale } = useI18n();
  const tag = locale === 'fr' ? 'fr-FR' : 'en-GB';
  const apiUrl = getPublicApiUrl();

  const [groups, setGroups] = useState<InstructorGroup[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me/instructor-workshops`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401) {
          window.location.replace('/login');
          return;
        }
        if (!res.ok) throw new Error('instructor-workshops');
        const body = (await res.json()) as { events: InstructorGroup[] };
        setGroups(body.events);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(true);
      });
    return () => controller.abort();
  }, [apiUrl]);

  const loading = groups === null && !error;

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.me.instructor.eyebrow')}
          </p>
          <h1 className="mt-2 font-display text-2xl font-bold text-foreground sm:text-3xl">
            {t('publicApp.me.instructor.title')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            {t('publicApp.me.instructor.subtitle')}
          </p>
        </header>

        {loading && (
          <section className="rounded-lg border border-border bg-surface p-5 text-sm font-semibold text-muted shadow-sm">
            {t('publicApp.me.instructor.loading')}
          </section>
        )}

        {error && (
          <section className="rounded-lg border border-danger/30 bg-danger/5 p-5 text-sm font-semibold text-danger">
            {t('publicApp.me.instructor.loadError')}
          </section>
        )}

        {groups && groups.length === 0 && (
          <section className="rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
            <p className="text-sm font-semibold text-foreground">
              {t('publicApp.me.instructor.empty')}
            </p>
            <p className="mt-1 text-sm text-muted">{t('publicApp.me.instructor.emptyHint')}</p>
          </section>
        )}

        {groups?.map((group) => (
          <section key={group.event.id} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {group.event.name}
            </h2>
            <div className="flex flex-col gap-3">
              {group.workshops.map((w) => (
                <WorkshopManageCard
                  key={w.id}
                  workshop={w}
                  tz={group.event.timezone ?? 'Europe/Paris'}
                  tag={tag}
                  apiUrl={apiUrl}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

// ── Workshop card: chips + edit / notify panels + sessions ──────────────────────

function WorkshopManageCard({
  workshop,
  tz,
  tag,
  apiUrl,
}: {
  workshop: InstructorWorkshop;
  tz: string;
  tag: string;
  apiUrl: string;
}) {
  const { t } = useI18n();
  // Local copy so instructor edits reflect immediately without a full reload.
  const [fields, setFields] = useState({
    weapon: workshop.weapon ?? '',
    level: workshop.level ?? '',
    language: workshop.language ?? '',
    descriptionMd: workshop.descriptionMd ?? '',
  });
  const [panel, setPanel] = useState<'none' | 'edit' | 'notify' | 'feedback'>('none');

  // Reflect local instructor edits live on the shared card; empty → null so the
  // card falls back to shortDescription and hides blank tag pills.
  const cardWorkshop: WorkshopListItem = {
    ...workshop,
    weapon: fields.weapon || null,
    level: fields.level || null,
    language: fields.language || null,
    descriptionMd: fields.descriptionMd || null,
  };

  return (
    <WorkshopCard
      workshop={cardWorkshop}
      timezone={tz}
      showLocation
      footer={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPanel(panel === 'edit' ? 'none' : 'edit')}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-background"
            >
              {t('publicApp.me.instructor.edit')}
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === 'notify' ? 'none' : 'notify')}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-background"
            >
              {t('publicApp.me.instructor.notify')}
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === 'feedback' ? 'none' : 'feedback')}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-background"
            >
              {t('publicApp.me.instructor.feedback')}
            </button>
          </div>

          {panel === 'edit' && (
            <EditPanel
              workshopId={workshop.id}
              apiUrl={apiUrl}
              fields={fields}
              onSaved={(next) => {
                setFields(next);
                setPanel('none');
              }}
            />
          )}
          {panel === 'notify' && <NotifyPanel workshopId={workshop.id} apiUrl={apiUrl} />}
          {panel === 'feedback' && <FeedbackPanel workshopId={workshop.id} apiUrl={apiUrl} />}

          <div className="flex flex-col divide-y divide-border border-t border-border">
            {workshop.sessions.length === 0 ? (
              <p className="py-2 text-sm text-muted">{t('publicApp.me.instructor.notScheduled')}</p>
            ) : (
              workshop.sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  capacity={workshop.capacity}
                  tz={tz}
                  tag={tag}
                  apiUrl={apiUrl}
                />
              ))
            )}
          </div>
        </div>
      }
    />
  );
}

// ── Edit panel ──────────────────────────────────────────────────────────────────

function EditPanel({
  workshopId,
  apiUrl,
  fields,
  onSaved,
}: {
  workshopId: string;
  apiUrl: string;
  fields: { weapon: string; level: string; language: string; descriptionMd: string };
  onSaved: (next: {
    weapon: string;
    level: string;
    language: string;
    descriptionMd: string;
  }) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(fields);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const weaponOptions = useWeaponOptions();
  // Union the stored weapon if it's no longer an active catalog entry, so it
  // stays selectable (the API keeps an unchanged legacy value without re-checking).
  const weaponChoices =
    draft.weapon && !weaponOptions.includes(draft.weapon)
      ? [draft.weapon, ...weaponOptions]
      : weaponOptions;

  async function save() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/workshops/${workshopId}/instructor`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          weapon: draft.weapon.trim() || null,
          level: draft.level.trim() || null,
          language: draft.language.trim() || null,
          descriptionMd: draft.descriptionMd.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('save');
      onSaved(draft);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          {t('publicApp.me.instructor.weaponLabel')}
          <select
            className={inputClass}
            value={draft.weapon}
            onChange={(e) => setDraft((d) => ({ ...d, weapon: e.target.value }))}
          >
            <option value="">—</option>
            {weaponChoices.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          {t('publicApp.me.instructor.levelLabel')}
          <input
            className={inputClass}
            value={draft.level}
            onChange={(e) => setDraft((d) => ({ ...d, level: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          {t('publicApp.me.instructor.languageLabel')}
          <input
            className={inputClass}
            value={draft.language}
            onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value }))}
          />
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-muted">
        {t('publicApp.me.instructor.descriptionLabel')}
        <textarea
          rows={3}
          className={`${inputClass} resize-none`}
          value={draft.descriptionMd}
          onChange={(e) => setDraft((d) => ({ ...d, descriptionMd: e.target.value }))}
        />
      </label>
      {error && (
        <p className="mt-2 text-sm text-danger">{t('publicApp.me.instructor.saveError')}</p>
      )}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {t('publicApp.me.instructor.save')}
        </button>
      </div>
    </div>
  );
}

// ── Notify panel ────────────────────────────────────────────────────────────────

function NotifyPanel({ workshopId, apiUrl }: { workshopId: string; apiUrl: string }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';

  async function send() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(false);
    setSentCount(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/workshops/${workshopId}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      if (!res.ok) throw new Error('notify');
      const result = (await res.json()) as { recipientCount: number };
      setSentCount(result.recipientCount);
      setTitle('');
      setBody('');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        {t('publicApp.me.instructor.notifyTitleLabel')}
        <input
          className={inputClass}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-muted">
        {t('publicApp.me.instructor.notifyBodyLabel')}
        <textarea
          rows={3}
          maxLength={1000}
          className={`${inputClass} resize-none`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {error && (
        <p className="mt-2 text-sm text-danger">{t('publicApp.me.instructor.sendError')}</p>
      )}
      {sentCount !== null && (
        <p className="mt-2 text-sm text-success">
          {t('publicApp.me.instructor.sent', { count: sentCount })}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={busy || !title.trim() || !body.trim()}
          onClick={() => void send()}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? t('publicApp.me.instructor.sending') : t('publicApp.me.instructor.send')}
        </button>
      </div>
    </div>
  );
}

// ── Feedback panel (instructor view — anonymous) ────────────────────────────────

interface FeedbackSummary {
  average: number | null;
  count: number;
  distribution: Record<string, number>;
  comments: Array<{ rating: number; comment: string; createdAt: string }>;
}

function Stars({ value }: { value: number }) {
  return (
    // gold-text, not gold: a ★ is a non-text glyph and WCAG 1.4.11 wants 3:1,
    // which --color-gold (2.06:1 on light) misses. gold-text aliases straight
    // back to the bright gold under the dark scope.
    <span className="text-sm tabular-nums text-gold-text" aria-hidden="true">
      {'★'.repeat(Math.round(value))}
      <span className="text-muted">{'★'.repeat(Math.max(0, 5 - Math.round(value)))}</span>
    </span>
  );
}

function FeedbackPanel({ workshopId, apiUrl }: { workshopId: string; apiUrl: string }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/workshops/${workshopId}/feedback`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('feedback');
        setSummary((await res.json()) as FeedbackSummary);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(true);
      });
    return () => controller.abort();
  }, [apiUrl, workshopId]);

  return (
    <div className="rounded-md border border-border bg-background p-3">
      {error && <p className="text-sm text-danger">{t('publicApp.me.instructor.feedbackError')}</p>}
      {!error && summary === null && (
        <p className="text-sm text-muted">{t('publicApp.me.instructor.feedbackLoading')}</p>
      )}
      {summary && summary.count === 0 && (
        <p className="text-sm text-muted">{t('publicApp.me.instructor.feedbackEmpty')}</p>
      )}
      {summary && summary.count > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {summary.average}
            </span>
            {summary.average !== null && <Stars value={summary.average} />}
            <span className="text-xs text-muted">
              {t('publicApp.me.instructor.feedbackCount', { count: summary.count })}
            </span>
          </div>
          {summary.comments.length > 0 && (
            <ul className="flex flex-col gap-2">
              {summary.comments.map((c, i) => (
                <li key={i} className="rounded border border-border bg-surface p-2 text-sm">
                  <Stars value={c.rating} />
                  <p className="mt-1 text-foreground">{c.comment}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Session row: counts + expandable roster with accept/refuse ──────────────────

function SessionRow({
  session,
  capacity,
  tz,
  tag,
  apiUrl,
}: {
  session: InstructorSession;
  capacity: number | null;
  tz: string;
  tag: string;
  apiUrl: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [rosterError, setRosterError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadRoster() {
    try {
      const res = await fetch(`${apiUrl}/api/v1/workshop-sessions/${session.id}/roster`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('roster');
      setRoster((await res.json()) as RosterEntry[]);
    } catch {
      setRosterError(true);
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && roster === null && !rosterError) await loadRoster();
  }

  async function moderate(personId: string, action: 'accept' | 'refuse') {
    setBusyId(personId);
    setActionError(false);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/workshop-sessions/${session.id}/enrollments/${personId}/${action}`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) throw new Error('moderate');
      await loadRoster();
    } catch {
      setActionError(true);
    } finally {
      setBusyId(null);
    }
  }

  // When the roster is loaded, derive counts from it so accept/refuse reflect live.
  const confirmedCount = roster
    ? roster.filter((r) => r.status === 'confirmed').length
    : session.confirmedCount;
  const waitlistCount = roster
    ? roster.filter((r) => r.status === 'waitlisted').length
    : session.waitlistCount;

  const dateLabel = session.startsAt
    ? formatInZone(session.startsAt, tz, { weekday: 'short', day: 'numeric', month: 'short' }, tag)
    : t('publicApp.me.instructor.notScheduled');
  const timeLabel = session.startsAt
    ? formatInZone(session.startsAt, tz, { hour: '2-digit', minute: '2-digit' }, tag)
    : null;
  const capLabel =
    capacity == null ? t('publicApp.me.instructor.capacityUnlimited') : String(capacity);

  return (
    <div className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium text-foreground">{dateLabel}</span>
          {timeLabel && <span className="text-muted"> · {timeLabel}</span>}
          {session.venue && <span className="text-muted"> · {session.venue.name}</span>}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-foreground">
            {t('publicApp.me.instructor.attendees')}:{' '}
            <span className="font-semibold tabular-nums">
              {confirmedCount}/{capLabel}
            </span>
          </span>
          {waitlistCount > 0 && (
            <span className="text-muted">
              {t('publicApp.me.instructor.waitlist')}:{' '}
              <span className="font-semibold tabular-nums">{waitlistCount}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => void toggle()}
            className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground hover:bg-background"
          >
            {open
              ? t('publicApp.me.instructor.hideRoster')
              : t('publicApp.me.instructor.viewRoster')}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 rounded-md border border-border bg-background p-3">
          {rosterError && (
            <p className="text-sm text-danger">{t('publicApp.me.instructor.rosterError')}</p>
          )}
          {!rosterError && roster === null && (
            <p className="text-sm text-muted">{t('publicApp.me.instructor.rosterLoading')}</p>
          )}
          {roster && roster.length === 0 && (
            <p className="text-sm text-muted">{t('publicApp.me.instructor.rosterEmpty')}</p>
          )}
          {roster && roster.length > 0 && (
            <>
              {actionError && (
                <p className="mb-2 text-sm text-danger">
                  {t('publicApp.me.instructor.actionError')}
                </p>
              )}
              <RosterLists
                roster={roster}
                busyId={busyId}
                onModerate={(personId, action) => void moderate(personId, action)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RosterLists({
  roster,
  busyId,
  onModerate,
}: {
  roster: RosterEntry[];
  busyId: string | null;
  onModerate: (personId: string, action: 'accept' | 'refuse') => void;
}) {
  const { t } = useI18n();
  const confirmed = roster.filter((r) => r.status === 'confirmed');
  const waitlisted = roster
    .filter((r) => r.status === 'waitlisted')
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));
  const refused = roster.filter((r) => r.status === 'refused');

  const nameOf = (r: RosterEntry): string =>
    r.persons
      ? `${r.persons.givenName} ${r.persons.familyName}`.trim() ||
        t('publicApp.me.instructor.unnamedParticipant')
      : t('publicApp.me.instructor.unnamedParticipant');

  // Quiet secondary line, same treatment as the public participant lists: the
  // abbreviation when the club has one, otherwise the full name.
  const clubOf = (r: RosterEntry): string | null =>
    r.persons?.clubs ? (r.persons.clubs.abbreviation ?? r.persons.clubs.name) : null;

  const actionButton = (r: RosterEntry, action: 'accept' | 'refuse') => {
    if (!r.personId) return null;
    const personId = r.personId;
    const label =
      action === 'accept'
        ? t('publicApp.me.instructor.accept')
        : t('publicApp.me.instructor.refuse');
    const tone =
      action === 'accept'
        ? 'border-success/40 text-success hover:bg-success/10'
        : 'border-danger/40 text-danger hover:bg-danger/10';
    return (
      <button
        type="button"
        disabled={busyId === personId}
        onClick={() => onModerate(personId, action)}
        className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-semibold disabled:opacity-50 ${tone}`}
      >
        {label}
      </button>
    );
  };

  const row = (r: RosterEntry, action: 'accept' | 'refuse') => {
    const club = clubOf(r);
    return (
      <li key={r.id} className="flex items-center justify-between gap-2 text-sm text-foreground">
        {/* min-w-0 on every link of the chain, or the club overflows the card. */}
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{nameOf(r)}</span>
          {club && (
            <span className="min-w-0 shrink-[9999] truncate text-xs text-muted">{club}</span>
          )}
        </span>
        {actionButton(r, action)}
      </li>
    );
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {t('publicApp.me.instructor.confirmed')} ({confirmed.length})
        </p>
        {confirmed.length === 0 ? (
          <p className="text-sm text-muted">—</p>
        ) : (
          <ul className="flex flex-col gap-1">{confirmed.map((r) => row(r, 'refuse'))}</ul>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {t('publicApp.me.instructor.waitlisted')} ({waitlisted.length})
        </p>
        {waitlisted.length === 0 ? (
          <p className="text-sm text-muted">—</p>
        ) : (
          <ol className="flex flex-col gap-1">{waitlisted.map((r) => row(r, 'accept'))}</ol>
        )}
      </div>
      {refused.length > 0 && (
        <div className="sm:col-span-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {t('publicApp.me.instructor.refused')} ({refused.length})
          </p>
          <ul className="flex flex-col gap-1">{refused.map((r) => row(r, 'accept'))}</ul>
        </div>
      )}
    </div>
  );
}
