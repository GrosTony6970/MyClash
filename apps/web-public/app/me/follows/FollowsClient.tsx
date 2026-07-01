'use client';

import { useEffect, useMemo, useState } from 'react';
import { Avatar, EmptyState, Switch } from '@myclash/ui';
import { getApiUrl } from '@/lib/api-url';
import { useI18n } from '@/i18n/I18nProvider';
import { PersonContextDetails } from './PersonContextDetails';
import type { PersonFollowing } from './personContext';

type Status = 'loading' | 'ready' | 'error';

/**
 * The "Following" tab — a persistent, flat list of everyone the user follows
 * (via `GET /api/v1/me/following`, backed by directory_follows). A followed
 * fighter shows here even with no upcoming event, enriched with their live
 * tournament context. Match/workshop notify toggles appear only when an active
 * event-follow backs them, and drive the existing per-event follow endpoints.
 */
export default function FollowsClient({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useI18n();
  const apiUrl = useMemo(() => getApiUrl(), []);
  const [follows, setFollows] = useState<PersonFollowing[]>([]);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me/following`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('load');
        setFollows((await res.json()) as PersonFollowing[]);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [apiUrl]);

  async function toggleNotify(
    follow: PersonFollowing,
    key: 'notifyMatchStart' | 'notifyWorkshopStart',
    value: boolean,
  ) {
    const ev = follow.eventFollow;
    if (!ev) return;
    const patch = (f: PersonFollowing, v: boolean): PersonFollowing =>
      f.globalPersonId === follow.globalPersonId && f.eventFollow
        ? { ...f, eventFollow: { ...f.eventFollow, [key]: v } }
        : f;
    setFollows((prev) => prev.map((f) => patch(f, value)));
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${ev.eventId}/follows/${ev.personId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error('patch');
    } catch {
      setFollows((prev) => prev.map((f) => patch(f, !value)));
    }
  }

  async function unfollow(follow: PersonFollowing) {
    const previous = follows;
    setFollows((prev) => prev.filter((f) => f.globalPersonId !== follow.globalPersonId));
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/me/follows/by-global-person/${follow.globalPersonId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('delete');
    } catch {
      setFollows(previous);
    }
  }

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

      {status === 'ready' &&
        follows.map((follow) => (
          <article
            key={follow.globalPersonId}
            className="rounded-lg border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={follow.displayName} src={follow.photoUrl ?? undefined} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {follow.displayName}
                  </p>
                  {follow.clubName && (
                    <p className="truncate text-xs text-muted">{follow.clubName}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void unfollow(follow)}
                className="flex-shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-danger/60 hover:bg-danger/10"
              >
                {t('publicApp.me.follows.unfollow')}
              </button>
            </div>

            <PersonContextDetails ctx={follow} />

            {follow.eventFollow?.active && (
              <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted">
                    {t('publicApp.me.follows.notifyMatch')}
                  </span>
                  <Switch
                    checked={follow.eventFollow.notifyMatchStart}
                    onChange={(v) => void toggleNotify(follow, 'notifyMatchStart', v)}
                    ariaLabel={t('publicApp.me.follows.notifyMatch')}
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted">
                    {t('publicApp.me.follows.notifyWorkshop')}
                  </span>
                  <Switch
                    checked={follow.eventFollow.notifyWorkshopStart}
                    onChange={(v) => void toggleNotify(follow, 'notifyWorkshopStart', v)}
                    ariaLabel={t('publicApp.me.follows.notifyWorkshop')}
                  />
                </label>
              </div>
            )}
          </article>
        ))}
    </>
  );

  // Embedded inside the People hub (the hub supplies the page chrome + header).
  if (embedded) {
    return <div className="flex flex-col gap-3">{body}</div>;
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
