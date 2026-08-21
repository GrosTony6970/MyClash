'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatLocalizedDate } from '@myclash/types';
import { useToast } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureCode } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { DashboardToday } from '@/components/me/DashboardToday';

interface PersonalSpaceResponse {
  user: {
    id: string;
    email: string;
    display_name?: string;
  };
  profiles: {
    globalPerson: Record<string, unknown> | null;
    claimedPersons: Record<string, unknown>[];
  };
  commitments: {
    refereeAssignments: Record<string, unknown>[];
    workshopEnrollments: Record<string, unknown>[];
  };
  counts: {
    claimedPersons: number;
    events: number;
    refereeAssignments: number;
    workshopEnrollments: number;
  };
  claimable: ClaimablePerson[];
}

interface ClaimablePerson {
  id: string;
  name: string;
  eventName: string;
}

interface GlobalPersonSearchResult {
  id: string;
  slug: string;
  display_name: string;
  given_name: string;
  family_name: string;
  country_code: string | null;
  hema_ratings_id: string | null;
  club_label: string | null;
}

function roleEnabled(profile: Record<string, unknown> | null, key: string) {
  return Boolean(profile?.[key]);
}

export function PersonalSpaceDashboard() {
  // Resolved here, not handed down from the server page: a server-resolved URL
  // is the docker-internal host, which the browser can't reach.
  const apiUrl = getPublicApiUrl();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<PersonalSpaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Success feedback for flows that land here with a marker param:
  // claim-confirm redirects to /me?claimed=1, reset-password to
  // /me?password_reset=1. These were written but never read — the user got
  // zero confirmation. window APIs (not useSearchParams) on purpose: the
  // repo's React Compiler setup bails out on useSearchParams.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const claimed = params.get('claimed') === '1';
    const passwordReset = params.get('password_reset') === '1';
    if (!claimed && !passwordReset) return;
    if (claimed) toast.success(t('publicApp.me.claimedSuccess'));
    if (passwordReset) toast.success(t('publicApp.me.passwordResetSuccess'));
    params.delete('claimed');
    params.delete('password_reset');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void apiRequest<PersonalSpaceResponse>(apiUrl, '/api/v1/me/personal-space', {
      signal: controller.signal,
    }).then((result) => {
      if (result.ok) {
        setData(result.data);
      } else if (result.kind === 'aborted') {
        // A newer effect owns the screen; setting `loading` would fight it.
        return;
      } else if (result.kind === 'unauthenticated' && result.status === 401) {
        // Only a 401. A 403 means signed in and not allowed, and bouncing that
        // to the login form asks the competitor to fix the one thing that is
        // not wrong.
        window.location.replace('/login');
        return;
      } else {
        setError(true);
      }
      setLoading(false);
    });

    return () => controller.abort();
  }, [apiUrl]);

  // Re-fetch after a user action (e.g. claiming a profile). Not called from an
  // effect, so it stays clear of the set-state-in-effect rule.
  async function reload(): Promise<void> {
    // Keeps the current state on failure: the screen is already showing
    // something true, and a refresh that could not run is not worth an error.
    const result = await apiRequest<PersonalSpaceResponse>(apiUrl, '/api/v1/me/personal-space');
    if (result.ok) setData(result.data);
  }

  const globalPerson = data?.profiles.globalPerson ?? null;
  const displayName =
    data?.user.display_name ||
    (typeof globalPerson?.['display_name'] === 'string'
      ? (globalPerson['display_name'] as string)
      : data?.user.email);

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.personalSpace.eyebrow')}
          </p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.personalSpace.title')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-secondary">
            {t('publicApp.personalSpace.subtitle', {
              name: displayName ?? t('common.unknown'),
            })}
          </p>
        </header>

        <DashboardToday />

        {loading && (
          <section className="rounded-lg border border-border bg-surface p-5 text-sm font-semibold text-foreground-secondary shadow-sm">
            {t('publicApp.personalSpace.loading')}
          </section>
        )}

        {error && (
          <section className="rounded-lg border border-danger/30 bg-danger/10 p-5 text-sm font-semibold text-danger">
            {t('publicApp.personalSpace.loadError')}
          </section>
        )}

        {data && (
          <>
            {data.claimable.length > 0 && (
              <ClaimableCard
                apiUrl={apiUrl}
                claimable={data.claimable}
                onClaimed={() => void reload()}
              />
            )}

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={t('publicApp.personalSpace.stats.claimedProfiles')}
                value={data.counts.claimedPersons}
                hint={t('publicApp.personalSpace.stats.emptyHint')}
              />
              <StatCard
                label={t('publicApp.personalSpace.stats.events')}
                value={data.counts.events}
                href="/"
                hint={t('publicApp.personalSpace.stats.emptyHint')}
              />
              <StatCard
                label={t('publicApp.personalSpace.stats.refereeAssignments')}
                value={data.counts.refereeAssignments}
                href="/me/referee"
                hint={t('publicApp.personalSpace.stats.emptyHint')}
              />
              <StatCard
                label={t('publicApp.personalSpace.stats.workshops')}
                value={data.counts.workshopEnrollments}
                hint={t('publicApp.personalSpace.stats.emptyHint')}
              />
            </section>

            <section className="grid gap-4">
              <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
                <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
                  {t('publicApp.personalSpace.profileTitle')}
                </h2>
                {globalPerson ? (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <RolePill
                        active={roleEnabled(globalPerson, 'is_fighter')}
                        label={t('publicApp.personalSpace.roles.fighter')}
                        linkedText={t('publicApp.personalSpace.roles.fighterLinked')}
                        href="/me/fighter"
                      />
                      <RolePill
                        active={roleEnabled(globalPerson, 'is_referee')}
                        label={t('publicApp.personalSpace.roles.referee')}
                        linkedText={t('publicApp.personalSpace.roles.refereeLinked')}
                        href="/me/referee"
                      />
                      <RolePill
                        active={roleEnabled(globalPerson, 'is_workshop_participant')}
                        label={t('publicApp.personalSpace.roles.workshopParticipant')}
                        linkedText={t('publicApp.personalSpace.roles.workshopLinked')}
                        href="/"
                      />
                      <RolePill
                        active={roleEnabled(globalPerson, 'is_instructor')}
                        label={t('publicApp.personalSpace.roles.instructor')}
                        linkedText={t('publicApp.personalSpace.roles.instructorLinked')}
                        href="/me/instructor"
                      />
                    </div>
                    {typeof globalPerson['date_of_birth'] === 'string' &&
                      globalPerson['date_of_birth'] && (
                        <p className="mt-4 text-sm text-foreground-secondary">
                          <span className="font-semibold text-foreground-secondary">
                            {t('publicApp.personalSpace.dateOfBirthLabel')}:
                          </span>{' '}
                          <span className="tabular-nums">
                            {formatLocalizedDate(globalPerson['date_of_birth'] as string, locale)}
                          </span>
                        </p>
                      )}
                    <UnlinkButton
                      apiUrl={apiUrl}
                      onUnlinked={() => {
                        setData((current) =>
                          current
                            ? {
                                ...current,
                                profiles: { ...current.profiles, globalPerson: null },
                              }
                            : current,
                        );
                      }}
                    />
                  </>
                ) : (
                  <ClaimSearchSection apiUrl={apiUrl} />
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

type ClaimUiState =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'sent'; redactedEmail: string }
  | { kind: 'pending' }
  | { kind: 'error'; code: string };

function ClaimSearchSection({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalPersonSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [claim, setClaim] = useState<ClaimUiState>({ kind: 'idle' });

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      // Below the search threshold — nothing to fetch. We deliberately
      // do NOT setResults([]) here; rendering already gates on
      // `trimmed.length >= 2`, so stale results stay in state but
      // remain hidden until the user types enough to fetch fresh ones.
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void apiRequest<GlobalPersonSearchResult[]>(
        apiUrl,
        `/api/v1/me/global-person-search?q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
      ).then((result) => {
        // An abort is the next keystroke's search taking over; clearing the
        // rows or the spinner here would flicker the list it is replacing.
        if (result.ok) setResults(result.data);
        else if (result.kind === 'aborted') return;
        else setResults([]);
        setSearching(false);
      });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiUrl, query]);

  const showResults = query.trim().length >= 2;

  async function startClaim(candidate: GlobalPersonSearchResult): Promise<void> {
    setClaim({ kind: 'requesting' });
    type ClaimReply =
      { status: 'confirmation_sent'; redactedEmail: string } | { status: 'pending_approval' };

    const result = await apiRequest<ClaimReply>(apiUrl, '/api/v1/me/global-person-claim', {
      method: 'POST',
      body: { globalPersonId: candidate.id },
    });

    if (!result.ok) {
      if (result.kind === 'aborted') return;
      // The machine-readable half. The render below tells `already_pending`
      // from `already_claimed`; anything else lands on the generic sentence.
      setClaim({
        kind: 'error',
        code: failureCode(result) ?? (result.kind === 'network' ? 'network' : 'unknown'),
      });
      return;
    }

    if (result.data.status === 'pending_approval') {
      setClaim({ kind: 'pending' });
    } else {
      setClaim({ kind: 'sent', redactedEmail: result.data.redactedEmail });
    }
  }

  if (claim.kind === 'pending') {
    return (
      <div className="mt-4 rounded-md border border-info/30 bg-info/10 p-4">
        <p className="text-sm font-bold text-info">{t('publicApp.claim.pendingTitle')}</p>
        <p className="mt-2 text-sm text-info">{t('publicApp.claim.pendingDescription')}</p>
      </div>
    );
  }

  if (claim.kind === 'sent') {
    return (
      <div className="mt-4 rounded-md border border-success/30 bg-success/10 p-4">
        <p className="text-sm font-bold text-success">{t('publicApp.claim.sentTitle')}</p>
        <p className="mt-2 text-sm text-success">
          {t('publicApp.claim.sentDescription', { email: claim.redactedEmail })}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-foreground-secondary">
        {t('publicApp.claim.searchTitle')}
      </p>
      <p className="mt-1 text-sm leading-6 text-muted">{t('publicApp.claim.searchDescription')}</p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('publicApp.claim.searchPlaceholder')}
        className="mt-3 w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        aria-label={t('publicApp.claim.searchPlaceholder')}
      />
      {claim.kind === 'error' && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {claim.code === 'already_pending'
            ? t('publicApp.claim.errors.alreadyPending')
            : claim.code === 'already_claimed'
              ? t('publicApp.claim.errors.alreadyClaimed')
              : t('publicApp.claim.errors.generic')}
        </p>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {showResults && searching && (
          <li className="text-sm text-muted">{t('publicApp.claim.searching')}</li>
        )}
        {showResults && !searching && results.length === 0 && (
          <li className="text-sm text-muted">{t('publicApp.claim.noResults')}</li>
        )}
        {showResults &&
          results.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{row.display_name}</p>
                <p className="truncate text-xs text-muted">
                  {[
                    row.club_label,
                    row.country_code,
                    row.hema_ratings_id ? `HEMA #${row.hema_ratings_id}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || t('publicApp.claim.noClub')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void startClaim(row)}
                disabled={claim.kind === 'requesting'}
                className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground hover:bg-accent-hover disabled:opacity-60"
              >
                {t('publicApp.claim.thisIsMe')}
              </button>
            </li>
          ))}
      </ul>
      <p className="mt-4 text-xs text-muted">
        {t('publicApp.claim.findEventsFallback')}{' '}
        <Link href="/" className="font-bold text-accent hover:underline">
          {t('publicApp.personalSpace.findEvents')}
        </Link>
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number;
  href?: string;
  hint?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-3 text-3xl font-black tabular-nums text-foreground">{value}</p>
      {value === 0 && hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  const base = 'block rounded-lg border border-border bg-surface p-5 shadow-sm';
  if (href) {
    return (
      <Link href={href} className={`${base} transition hover:border-accent/40 hover:shadow-md`}>
        {body}
      </Link>
    );
  }
  return <article className={base}>{body}</article>;
}

function RolePill({
  active,
  label,
  linkedText,
  href,
}: {
  active: boolean;
  label: string;
  linkedText: string;
  href?: string;
}) {
  const { t } = useI18n();
  const className = [
    'block rounded-md border px-3 py-3 text-sm font-bold',
    active
      ? 'border-success/40 bg-success/10 text-foreground'
      : 'border-border bg-background text-muted',
    href
      ? active
        ? 'transition hover:border-success/60'
        : 'transition hover:border-accent/50'
      : '',
  ].join(' ');

  const content = active ? (
    <>
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success px-2 py-0.5 text-xs font-semibold text-success-foreground">
          <span aria-hidden="true">✓</span>
          {t('publicApp.personalSpace.roles.linkedPill')}
        </span>
      </div>
      <p className="mt-1 text-xs font-medium text-success">{linkedText}</p>
    </>
  ) : (
    label
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}

type UnlinkUi = { kind: 'idle' } | { kind: 'confirming' } | { kind: 'pending' } | { kind: 'error' };

function UnlinkButton({ apiUrl, onUnlinked }: { apiUrl: string; onUnlinked: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<UnlinkUi>({ kind: 'idle' });

  async function unlink(): Promise<void> {
    setState({ kind: 'pending' });
    const result = await apiRequest(apiUrl, '/api/v1/me/global-person-link', { method: 'DELETE' });
    if (!result.ok) {
      setState({ kind: 'error' });
      return;
    }
    onUnlinked();
    setState({ kind: 'idle' });
  }

  if (state.kind === 'confirming' || state.kind === 'pending') {
    return (
      <div
        className="mt-4 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
        role="alertdialog"
        aria-modal="true"
        aria-label={t('publicApp.personalSpace.unlinkConfirmTitle')}
      >
        <p className="font-semibold">{t('publicApp.personalSpace.unlinkConfirmTitle')}</p>
        <p className="mt-1">{t('publicApp.personalSpace.unlinkConfirmBody')}</p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void unlink()}
            disabled={state.kind === 'pending'}
            className="rounded-md bg-warning px-3 py-1.5 text-xs font-bold text-warning-foreground hover:bg-warning-hover disabled:opacity-60"
          >
            {state.kind === 'pending'
              ? t('common.loading')
              : t('publicApp.personalSpace.unlinkConfirmYes')}
          </button>
          <button
            type="button"
            onClick={() => setState({ kind: 'idle' })}
            disabled={state.kind === 'pending'}
            className="rounded-md border border-warning/40 px-3 py-1.5 text-xs font-bold text-warning hover:bg-warning/10 disabled:opacity-60"
          >
            {t('actions.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {state.kind === 'error' && (
        <p className="mb-2 text-xs text-danger" role="alert">
          {t('publicApp.personalSpace.unlinkError')}
        </p>
      )}
      <button
        type="button"
        onClick={() => setState({ kind: 'confirming' })}
        className="text-xs font-semibold text-muted underline-offset-2 hover:text-foreground-secondary hover:underline"
      >
        {t('publicApp.personalSpace.unlinkAction')}
      </button>
    </div>
  );
}

function ClaimableCard({
  apiUrl,
  claimable,
  onClaimed,
}: {
  apiUrl: string;
  claimable: ClaimablePerson[];
  onClaimed: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function claim(personIds: string[]): Promise<void> {
    setBusy(true);
    setError(false);
    const result = await apiRequest(apiUrl, '/api/v1/me/claim-persons', {
      method: 'POST',
      body: { personIds },
    });
    setBusy(false);
    if (result.ok) onClaimed();
    else setError(true);
  }

  return (
    <section className="rounded-lg border border-accent/30 bg-accent/5 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('publicApp.personalSpace.claimable.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-foreground-secondary">
            {t('publicApp.personalSpace.claimable.description')}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void claim(claimable.map((c) => c.id))}
          className="rounded-md bg-accent px-3 py-2 text-sm font-bold text-accent-foreground transition hover:bg-accent-hover disabled:opacity-60"
        >
          {busy
            ? t('common.loading')
            : t('publicApp.personalSpace.claimable.claimAll', { count: claimable.length })}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {t('publicApp.personalSpace.claimable.error')}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {claimable.map((person) => (
          <li
            key={person.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2"
          >
            <span className="min-w-0">
              <span className="font-semibold text-foreground">{person.name}</span>
              {person.eventName && (
                <span className="text-sm text-muted"> · {person.eventName}</span>
              )}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void claim([person.id])}
              className="shrink-0 rounded-md border border-accent/40 px-3 py-1.5 text-xs font-bold text-accent transition hover:bg-accent/10 disabled:opacity-60"
            >
              {t('publicApp.personalSpace.claimable.claim')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
