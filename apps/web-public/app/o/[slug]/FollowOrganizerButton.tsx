'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

type Status = 'loading' | 'anonymous' | 'ready';

interface FollowedOrganization {
  organizationId: string;
}

/**
 * Follow toggle for /o/[slug].
 *
 * Reads the follow state client-side rather than taking it as a prop: that
 * keeps the page itself a cookie-free server fetch, so it stays cacheable and
 * identical for every visitor. The only per-user bit is this button.
 *
 * Visual/state machine mirrors me/follows/FollowButton — local override wins
 * once the user toggles, `busy` guards a double tap, aria-pressed carries the
 * state to assistive tech.
 */
export function FollowOrganizerButton({
  organizationId,
  slug,
  followerCount,
}: {
  organizationId: string;
  slug: string;
  followerCount: number;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>('loading');
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Optimistic delta on top of the server-rendered count, so the number moves
  // with the button instead of waiting for a reload.
  const [delta, setDelta] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const apiUrl = getPublicApiUrl();

    async function load() {
      try {
        const res = await fetch(`${apiUrl}/api/v1/me/follows/organizations`, {
          credentials: 'include',
          signal: controller.signal,
        });
        // 401 is the expected logged-out path, not an error worth surfacing.
        if (res.status === 401) {
          setStatus('anonymous');
          return;
        }
        if (!res.ok) {
          setStatus('anonymous');
          return;
        }
        const rows = (await res.json()) as FollowedOrganization[];
        setFollowing(rows.some((row) => row.organizationId === organizationId));
        setStatus('ready');
      } catch {
        // Aborted or offline — leave the button out rather than showing a
        // control that cannot work.
        if (!controller.signal.aborted) setStatus('anonymous');
      }
    }

    void load();
    return () => controller.abort();
  }, [organizationId]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const apiUrl = getPublicApiUrl();
    try {
      if (following) {
        const res = await fetch(`${apiUrl}/api/v1/me/follows/organizations/${organizationId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (res.ok) {
          setFollowing(false);
          setDelta((d) => d - 1);
        }
      } else {
        const res = await fetch(`${apiUrl}/api/v1/me/follows/organizations`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        });
        if (res.ok) {
          setFollowing(true);
          setDelta((d) => d + 1);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const count = followerCount + delta;

  if (status === 'loading') {
    return (
      <span className="text-sm text-muted">
        {t('publicApp.organizer.followerCount', { count })}
      </span>
    );
  }

  if (status === 'anonymous') {
    // A dead button would be worse than a link that explains itself.
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted">
          {t('publicApp.organizer.followerCount', { count })}
        </span>
        <Link
          href={`/login?next=${encodeURIComponent(`/o/${slug}`)}`}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-accent/60 hover:bg-accent/10"
        >
          {t('publicApp.organizer.signInToFollow')}
        </Link>
      </div>
    );
  }

  const tone = following
    ? 'border-accent/60 bg-accent/10 text-accent'
    : 'border-border text-foreground hover:border-accent/60 hover:bg-accent/10';

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted">
        {t('publicApp.organizer.followerCount', { count })}
      </span>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={following}
        className={`flex-shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default ${tone}`}
      >
        {busy
          ? '…'
          : following
            ? t('publicApp.organizer.following')
            : t('publicApp.organizer.follow')}
      </button>
    </div>
  );
}
