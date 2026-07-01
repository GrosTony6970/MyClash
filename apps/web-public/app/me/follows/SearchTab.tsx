'use client';

import { useEffect, useState } from 'react';
import { Avatar, EmptyState } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { FollowButton } from './FollowButton';
import { PersonContextDetails } from './PersonContextDetails';
import { fetchPeopleContext, type PersonContext } from './personContext';
import type { SearchPerson, useDirectoryGroups } from './useDirectoryGroups';

type GroupsApi = ReturnType<typeof useDirectoryGroups>;
type Status = 'idle' | 'loading' | 'ready' | 'error';

interface RawResult {
  id: string;
  slug: string;
  display_name: string;
  photo_url: string | null;
  country_code: string | null;
  clubs: { name: string | null } | null;
}

function toPerson(r: RawResult): SearchPerson {
  return {
    id: r.id,
    slug: r.slug,
    displayName: r.display_name,
    clubName: r.clubs?.name ?? null,
    photoUrl: r.photo_url,
    countryCode: r.country_code,
  };
}

export function SearchTab({ apiUrl, groupsApi }: { apiUrl: string; groupsApi: GroupsApi }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchPerson[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [contextById, setContextById] = useState<Map<string, PersonContext>>(new Map());

  useEffect(() => {
    const term = q.trim();
    const controller = new AbortController();
    // Debounced; the short-query reset runs inside the timer (not synchronously
    // in the effect body) so clearing the box settles to "idle" promptly.
    const handle = setTimeout(
      () => {
        if (term.length < 2) {
          setResults([]);
          setStatus('idle');
          return;
        }
        setStatus('loading');
        fetch(`${apiUrl}/api/v1/fighters?q=${encodeURIComponent(term)}`, {
          credentials: 'include',
          signal: controller.signal,
        })
          .then(async (res) => {
            if (!res.ok) throw new Error('search');
            const rows = (await res.json()) as RawResult[];
            setResults(rows.map(toPerson));
            setStatus('ready');
          })
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setStatus('error');
          });
      },
      term.length < 2 ? 0 : 300,
    );
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [q, apiUrl]);

  // Enrich the visible results with live tournament context (best-effort). All
  // state writes happen in the async callback (not synchronously in the effect
  // body); a guard drops stale responses if results change mid-flight.
  useEffect(() => {
    const ids = results.map((r) => r.id);
    const controller = new AbortController();
    let active = true;
    void fetchPeopleContext(apiUrl, ids, controller.signal).then((map) => {
      if (active) setContextById(map);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [results, apiUrl]);

  return (
    <section className="flex flex-col gap-3">
      <label className="block">
        <span className="sr-only">{t('publicApp.me.people.searchPlaceholder')}</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('publicApp.me.people.searchPlaceholder')}
          className="min-h-[44px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent [touch-action:manipulation]"
        />
      </label>

      {status === 'idle' && (
        <p className="text-sm text-muted">{t('publicApp.me.people.searchHint')}</p>
      )}
      {status === 'loading' && <p className="text-sm text-muted">{t('common.loading')}</p>}
      {status === 'error' && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {t('publicApp.me.people.searchError')}
        </p>
      )}
      {status === 'ready' && results.length === 0 && (
        <EmptyState
          title={t('publicApp.me.people.noResults')}
          description={t('publicApp.me.people.noResultsHint')}
        />
      )}

      {results.map((person) => {
        const memberGroupIds = new Set(
          groupsApi.groups
            .filter((g) => g.members.some((m) => m.globalPersonId === person.id))
            .map((g) => g.id),
        );
        const pickerOpen = openFor === person.id;
        const ctx = contextById.get(person.id);
        return (
          <article
            key={person.id}
            className="rounded-lg border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={person.displayName} src={person.photoUrl ?? undefined} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {person.displayName}
                  </p>
                  {person.clubName && (
                    <p className="truncate text-xs text-muted">{person.clubName}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <FollowButton
                  following={ctx?.isFollowing ?? false}
                  onFollow={() => groupsApi.followPerson(person.id)}
                  onUnfollow={() => groupsApi.unfollowPerson(person.id)}
                />
                <button
                  type="button"
                  onClick={() => setOpenFor(pickerOpen ? null : person.id)}
                  aria-expanded={pickerOpen}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-accent/60 hover:bg-accent/10"
                >
                  {t('publicApp.me.people.addToGroup')}
                </button>
              </div>
            </div>

            <PersonContextDetails ctx={ctx} />

            {pickerOpen && (
              <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
                {groupsApi.groups.length === 0 && (
                  <p className="text-xs text-muted">{t('publicApp.me.groups.emptyPicker')}</p>
                )}
                {groupsApi.groups.map((group) => {
                  const inGroup = memberGroupIds.has(group.id);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      disabled={inGroup}
                      onClick={() => void groupsApi.addMember(group.id, person)}
                      className="flex items-center justify-between rounded-md px-2 py-2 text-left text-sm text-foreground hover:bg-foreground/5 disabled:opacity-50"
                    >
                      <span className="truncate">{group.name}</span>
                      <span className="text-xs font-semibold text-accent">
                        {inGroup
                          ? t('publicApp.me.groups.alreadyIn')
                          : t('publicApp.me.groups.add')}
                      </span>
                    </button>
                  );
                })}
                <NewGroupInline
                  onCreate={(name) => void groupsApi.createGroupWithMember(name, person)}
                />
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

function NewGroupInline({ onCreate }: { onCreate: (name: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setName('');
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-1 flex items-center gap-2 border-t border-border pt-2"
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('publicApp.me.groups.createPlaceholder')}
        maxLength={80}
        className="min-h-[40px] flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <button
        type="submit"
        disabled={name.trim().length === 0}
        className="rounded-md border border-accent/60 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent disabled:opacity-50"
      >
        {t('publicApp.me.groups.create')}
      </button>
    </form>
  );
}
