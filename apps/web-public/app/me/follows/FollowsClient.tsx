'use client';

import { useEffect, useMemo, useState } from 'react';
import { EmptyState, Switch } from '@myclash/ui';
import { getApiUrl } from '@/lib/api-url';
import { useI18n } from '@/i18n/I18nProvider';

interface Follow {
  id: string;
  personId: string;
  personName: string;
  personClub: string | null;
  notifyMatchStart: boolean;
  notifyWorkshopStart: boolean;
  nextEvent: { type: string; label: string; scheduledAt: string | null } | null;
  eventId: string;
  eventName: string | null;
  eventSlug: string | null;
}

type Status = 'loading' | 'ready' | 'error';

/**
 * Cross-event "people you follow" list. Reads the aggregated
 * `GET /api/v1/me/follows`, groups by event, and drives notify-toggles +
 * unfollow through the EXISTING event-scoped follow endpoints. Resolves the API
 * URL on the client (avoids leaking the internal host to the browser).
 */
export default function FollowsClient({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useI18n();
  const apiUrl = useMemo(() => getApiUrl(), []);
  const [follows, setFollows] = useState<Follow[]>([]);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me/follows`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('load');
        setFollows((await res.json()) as Follow[]);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [apiUrl]);

  async function toggleNotify(
    follow: Follow,
    key: 'notifyMatchStart' | 'notifyWorkshopStart',
    value: boolean,
  ) {
    setFollows((prev) => prev.map((f) => (f.id === follow.id ? { ...f, [key]: value } : f)));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/events/${follow.eventId}/follows/${follow.personId}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: value }),
        },
      );
      if (!res.ok) throw new Error('patch');
    } catch {
      setFollows((prev) => prev.map((f) => (f.id === follow.id ? { ...f, [key]: !value } : f)));
    }
  }

  async function unfollow(follow: Follow) {
    const previous = follows;
    setFollows((prev) => prev.filter((f) => f.id !== follow.id));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/events/${follow.eventId}/follows/${follow.personId}`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      );
      if (!res.ok) throw new Error('delete');
    } catch {
      setFollows(previous);
    }
  }

  // Group by event, preserving the created_at-desc order the API returns.
  const grouped = useMemo(() => {
    const map = new Map<string, { eventName: string | null; follows: Follow[] }>();
    for (const follow of follows) {
      const group = map.get(follow.eventId) ?? { eventName: follow.eventName, follows: [] };
      group.follows.push(follow);
      map.set(follow.eventId, group);
    }
    return [...map.entries()];
  }, [follows]);

  const body = (
    <>
      {status === 'loading' && <p className="text-sm text-muted">{t('common.loading')}</p>}
      {status === 'error' && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {t('publicApp.me.follows.loadError')}
        </p>
      )}

      {status === 'ready' && follows.length === 0 && (
        <EmptyState
          title={t('publicApp.me.follows.empty')}
          description={t('publicApp.me.follows.emptyHint')}
        />
      )}

      {grouped.map(([eventId, group]) => (
        <section key={eventId} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            {group.eventName ?? t('common.unknown')}
          </h2>
          {group.follows.map((follow) => (
            <article
              key={follow.id}
              className="rounded-lg border border-border bg-surface p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {follow.personName}
                  </p>
                  {follow.personClub && (
                    <p className="truncate text-xs text-muted">{follow.personClub}</p>
                  )}
                  {follow.nextEvent && (
                    <p className="mt-1 truncate text-xs text-accent">
                      {t('publicApp.me.follows.next', { label: follow.nextEvent.label })}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void unfollow(follow)}
                  className="flex-shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-danger/60 hover:bg-danger/10"
                >
                  {t('publicApp.me.follows.unfollow')}
                </button>
              </div>

              <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted">
                    {t('publicApp.me.follows.notifyMatch')}
                  </span>
                  <Switch
                    checked={follow.notifyMatchStart}
                    onChange={(v) => void toggleNotify(follow, 'notifyMatchStart', v)}
                    ariaLabel={t('publicApp.me.follows.notifyMatch')}
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted">
                    {t('publicApp.me.follows.notifyWorkshop')}
                  </span>
                  <Switch
                    checked={follow.notifyWorkshopStart}
                    onChange={(v) => void toggleNotify(follow, 'notifyWorkshopStart', v)}
                    ariaLabel={t('publicApp.me.follows.notifyWorkshop')}
                  />
                </label>
              </div>
            </article>
          ))}
        </section>
      ))}
    </>
  );

  // Embedded inside the People hub (the hub supplies the page chrome + header).
  if (embedded) {
    return <div className="flex flex-col gap-6">{body}</div>;
  }

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.personalShell.role')}
          </p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.me.follows.title')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">{t('publicApp.me.follows.subtitle')}</p>
        </header>
        {body}
      </div>
    </main>
  );
}
