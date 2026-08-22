'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';

type TargetType = 'all' | 'fighters' | 'referees' | 'fighters_and_referees' | 'specific_persons';
type Severity = 'info' | 'warning' | 'alert';

interface Person {
  id: string;
  givenName: string;
  familyName: string;
  email: string;
  clubLabel: string | null;
}

interface BroadcastHistory {
  id: string;
  severity: Severity;
  targetType: TargetType;
  title: string;
  body: string;
  recipientCount: number;
  createdAt: string;
}

const severityClasses: Record<Severity, string> = {
  info: 'border-green-300 bg-green-50 text-green-900',
  warning: 'border-yellow-300 bg-yellow-50 text-yellow-900',
  alert: 'border-red-300 bg-red-50 text-red-900',
};

export default function EventNotificationsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const searchParams = useSearchParams();
  const { slug, eventId } = params;
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();

  const initialTarget = searchParams.get('targetType') as TargetType | null;
  const initialSeverity = searchParams.get('severity') as Severity | null;
  const [targetType, setTargetType] = useState<TargetType>(
    initialTarget &&
      ['all', 'fighters', 'referees', 'fighters_and_referees', 'specific_persons'].includes(
        initialTarget,
      )
      ? initialTarget
      : 'all',
  );
  const [severity, setSeverity] = useState<Severity>(
    initialSeverity && ['info', 'warning', 'alert'].includes(initialSeverity)
      ? initialSeverity
      : 'info',
  );
  const [title, setTitle] = useState(searchParams.get('title') ?? '');
  const [body, setBody] = useState(searchParams.get('body') ?? '');
  const [tournamentId] = useState(searchParams.get('tournamentId'));
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<BroadcastHistory[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      apiRequest<Person[]>(apiUrl, `/api/v1/events/${eventId}/persons`, {
        signal: controller.signal,
      }),
      apiRequest<BroadcastHistory[]>(apiUrl, `/api/v1/events/${eventId}/notifications/broadcasts`, {
        signal: controller.signal,
      }),
    ]).then(([peopleResponse, historyResponse]) => {
      if (peopleResponse.ok) setPeople(peopleResponse.data);
      if (historyResponse.ok) setHistory(historyResponse.data);
      // Both lists were tolerant and stay tolerant, but a refusal only ever
      // reached the catch on a dropped connection — so a 403 on the recipient
      // list left an empty picker with nothing to explain it.
      const failed = [peopleResponse, historyResponse].find((r) => !r.ok);
      if (failed && !failed.ok) {
        const message = failureMessage(failed, t, t('organizer.broadcast.loadError'));
        if (message) setMessage(message);
      }
    });
    return () => controller.abort();
  }, [apiUrl, eventId, t]);

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter((person) =>
      `${person.givenName} ${person.familyName} ${person.email} ${person.clubLabel ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }, [people, search]);

  async function sendBroadcast() {
    if (!title.trim() || !body.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await apiRequest<{ recipientCount: number }>(
        apiUrl,
        `/api/v1/events/${eventId}/notifications/broadcast`,
        {
          method: 'POST',
          body: {
            targetType,
            severity,
            title: title.trim(),
            body: body.trim(),
            tournamentId: tournamentId ?? undefined,
            personIds: targetType === 'specific_persons' ? Array.from(selected) : undefined,
          },
        },
      );
      if (!r.ok) {
        // A refused broadcast says whether it was the recipient list, the
        // severity or the event's own state. `throw new Error('send failed')`
        // put all three behind one sentence.
        const message = failureMessage(r, t, t('organizer.broadcast.sendError'));
        if (message) setMessage(message);
        return;
      }
      setMessage(t('organizer.broadcast.sent', { count: r.data.recipientCount }));
      setTitle('');
      setBody('');
      const historyResponse = await apiRequest<BroadcastHistory[]>(
        apiUrl,
        `/api/v1/events/${eventId}/notifications/broadcasts`,
      );
      if (historyResponse.ok) setHistory(historyResponse.data);
    } finally {
      setBusy(false);
    }
  }

  function togglePerson(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const targetOptions: Array<{ value: TargetType; label: string }> = [
    { value: 'all', label: t('organizer.broadcast.targetAll') },
    { value: 'fighters', label: t('organizer.broadcast.targetFighters') },
    { value: 'referees', label: t('organizer.broadcast.targetReferees') },
    { value: 'fighters_and_referees', label: t('organizer.broadcast.targetFightersAndReferees') },
    { value: 'specific_persons', label: t('organizer.broadcast.targetSpecific') },
  ];
  const severityOptions: Array<{ value: Severity; label: string }> = [
    { value: 'info', label: t('organizer.broadcast.info') },
    { value: 'warning', label: t('organizer.broadcast.warning') },
    { value: 'alert', label: t('organizer.broadcast.alert') },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        <BackLink
          href={`/org/${slug}/events/${eventId}`}
          label={t('organizer.broadcast.backToEvent')}
        />
        <span>/</span>
        <span className="font-medium text-foreground">{t('organizer.broadcast.navLabel')}</span>
      </div>

      <header className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl">
          {t('organizer.broadcast.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-foreground-secondary">
          {t('organizer.broadcast.description')}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {t('organizer.broadcast.target')}
            </p>
            <div className="flex flex-wrap gap-2">
              {targetOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTargetType(option.value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    targetType === option.value
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-foreground-secondary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {targetType === 'specific_persons' && (
            <div className="mb-5 rounded-lg border border-border p-3">
              <label className="mb-2 block text-sm font-medium text-foreground-secondary">
                {t('organizer.broadcast.people')}
              </label>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('organizer.broadcast.searchPeople')}
                className="mb-3 w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
              <div className="max-h-52 overflow-auto">
                {filteredPeople.length === 0 ? (
                  <p className="text-sm text-muted">{t('organizer.broadcast.emptyPeople')}</p>
                ) : (
                  filteredPeople.map((person) => (
                    <label key={person.id} className="flex items-center gap-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(person.id)}
                        onChange={() => togglePerson(person.id)}
                      />
                      <span>
                        <span className="font-medium">
                          {person.givenName} {person.familyName}
                        </span>
                        <span className="ml-2 text-muted">{person.email}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {t('organizer.broadcast.severity')}
            </p>
            <div className="flex gap-2">
              {severityOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSeverity(option.value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                    severity === option.value
                      ? severityClasses[option.value]
                      : 'border-border text-foreground-secondary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-foreground-secondary">
                {t('organizer.broadcast.messageTitle')}
              </span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-foreground-secondary">
                {t('organizer.broadcast.messageBody')}
              </span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={1000}
                rows={5}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
          </div>

          {message && <p className="mt-4 text-sm text-foreground-secondary">{message}</p>}

          <button
            type="button"
            disabled={busy || !title.trim() || !body.trim()}
            onClick={() => void sendBroadcast()}
            className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:bg-border"
          >
            {busy ? t('organizer.broadcast.sending') : t('organizer.broadcast.send')}
          </button>
        </section>

        <aside>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {t('organizer.broadcast.preview')}
          </p>
          <div className={`rounded-xl border p-4 ${severityClasses[severity]}`}>
            <p className="text-xs font-bold uppercase">{t(`organizer.broadcast.${severity}`)}</p>
            <h2 className="mt-2 font-bold">{title || t('organizer.broadcast.messageTitle')}</h2>
            <p className="mt-2 text-sm">{body || t('organizer.broadcast.messageBody')}</p>
          </div>
        </aside>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.broadcast.history')}
        </h2>
        {history.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
            {t('organizer.broadcast.emptyHistory')}
          </p>
        ) : (
          <div className="space-y-3">
            {history.map((item) => (
              <article key={item.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${severityClasses[item.severity]}`}
                    >
                      {t(`organizer.broadcast.${item.severity}`)}
                    </span>
                    <h3 className="mt-2 font-semibold text-foreground">{item.title}</h3>
                    <p className="mt-1 text-sm text-foreground-secondary">{item.body}</p>
                  </div>
                  <p className="text-right text-xs text-muted">
                    {t('organizer.broadcast.recipients', { count: item.recipientCount })}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
