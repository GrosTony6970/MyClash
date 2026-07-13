'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Avatar, EmptyState, Switch, formatCountryName, useNow } from '@myclash/ui';
import { flagEmoji } from '@/lib/flag';
import { getApiUrl } from '@/lib/api-url';
import { useI18n } from '@/i18n/I18nProvider';
import { Chevron } from './Chevron';
import { usePersistedOpen } from './usePersistedOpen';
import { PersonContextDetails } from './PersonContextDetails';
import type { PersonFollowing } from './personContext';

type Status = 'loading' | 'ready' | 'error';

type NotifyKey = 'notifyMatchStart' | 'notifyWorkshopStart' | 'notifyRefereeStart';

/** Live activity first, otherwise preserve newest-first order (stable sort). */
function liveFirst(list: PersonFollowing[]): PersonFollowing[] {
  return [...list].sort((a, b) => Number(!!b.currentMatch) - Number(!!a.currentMatch));
}

/** The event a followed person belongs to (their tournament's event, or — for a
 *  referee with no registration — the event of the match they're officiating).
 *  Null means idle: no active event. */
function groupKeyOf(f: PersonFollowing): { id: string; name: string } | null {
  if (f.event) return { id: f.event.id, name: f.event.name };
  if (f.currentMatch?.eventName) {
    return {
      id: `slug:${f.currentMatch.eventSlug ?? f.currentMatch.eventName}`,
      name: f.currentMatch.eventName,
    };
  }
  return null;
}

/**
 * The "Following" tab — a persistent, flat list of everyone the user follows
 * (via `GET /api/v1/me/following`, backed by directory_follows). A followed
 * fighter shows here even with no upcoming event, enriched with their live
 * tournament context. Once follows span 2+ events, the list groups into
 * collapsible per-event sections. Match/referee/workshop notify toggles appear
 * only when an active event-follow backs them.
 */
export default function FollowsClient({ embedded = false }: { embedded?: boolean } = {}) {
  const { t, locale } = useI18n();
  const apiUrl = useMemo(() => getApiUrl(), []);
  const now = useNow(apiUrl);
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

  // Partition into event groups + an idle bucket; group only when 2+ events.
  const { eventGroups, idle } = useMemo(() => {
    const byEvent = new Map<string, { name: string; items: PersonFollowing[] }>();
    const idleItems: PersonFollowing[] = [];
    for (const f of follows) {
      const key = groupKeyOf(f);
      if (!key) {
        idleItems.push(f);
        continue;
      }
      const g = byEvent.get(key.id) ?? { name: key.name, items: [] };
      g.items.push(f);
      byEvent.set(key.id, g);
    }
    return { eventGroups: byEvent, idle: idleItems };
  }, [follows]);

  const grouped = eventGroups.size >= 2;

  async function toggleNotify(follow: PersonFollowing, key: NotifyKey, value: boolean) {
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

  function renderCard(follow: PersonFollowing, hideEvent: boolean) {
    const flag = flagEmoji(follow.countryCode);
    const countryName = follow.countryCode ? formatCountryName(follow.countryCode, locale) : null;
    return (
      <article
        key={follow.globalPersonId}
        className="rounded-lg border border-border bg-surface p-4 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/fighters/${follow.slug}`}
            className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Avatar name={follow.displayName} src={follow.photoUrl ?? undefined} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground group-hover:underline">
                {flag && (
                  <span aria-hidden className="mr-1.5">
                    {flag}
                  </span>
                )}
                {follow.displayName}
                {countryName && <span className="sr-only"> · {countryName}</span>}
              </p>
              {follow.clubName && <p className="truncate text-xs text-muted">{follow.clubName}</p>}
            </div>
          </Link>
          <button
            type="button"
            onClick={() => void unfollow(follow)}
            className="flex-shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-danger/60 hover:bg-danger/10"
          >
            {t('publicApp.me.follows.unfollow')}
          </button>
        </div>

        <PersonContextDetails ctx={follow} now={now} hideEvent={hideEvent} />

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
                {t('publicApp.me.follows.notifyReferee')}
              </span>
              <Switch
                checked={follow.eventFollow.notifyRefereeStart}
                onChange={(v) => void toggleNotify(follow, 'notifyRefereeStart', v)}
                ariaLabel={t('publicApp.me.follows.notifyReferee')}
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
    );
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
        follows.length > 0 &&
        (grouped ? (
          <>
            {[...eventGroups.entries()].map(([groupId, g]) => (
              <FollowGroupSection
                key={groupId}
                groupId={groupId}
                title={g.name}
                count={g.items.length}
              >
                {liveFirst(g.items).map((f) => renderCard(f, true))}
              </FollowGroupSection>
            ))}
            {idle.length > 0 && (
              <FollowGroupSection
                key="__idle"
                groupId="__idle"
                title={t('publicApp.me.people.notCompeting')}
                count={idle.length}
              >
                {idle.map((f) => renderCard(f, true))}
              </FollowGroupSection>
            )}
          </>
        ) : (
          liveFirst(follows).map((f) => renderCard(f, false))
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

/** A collapsible event section wrapping its member cards (persisted open state). */
function FollowGroupSection({
  groupId,
  title,
  count,
  children,
}: {
  groupId: string;
  title: string;
  count: number;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = usePersistedOpen(`myclash:following-group-open:${groupId}`, true);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t(open ? 'publicApp.me.groups.collapse' : 'publicApp.me.groups.expand', {
            name: title,
          })}
          className="flex-shrink-0 rounded-md border border-border p-1.5 text-muted hover:bg-foreground/5"
        >
          <Chevron open={open} />
        </button>
        <h2 className="min-w-0 flex-1 truncate font-display text-base font-bold text-foreground">
          {title}
        </h2>
        <span className="flex-shrink-0 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-semibold text-muted">
          {count}
        </span>
      </div>
      {open && <div className="flex flex-col gap-3 p-4">{children}</div>}
    </section>
  );
}
