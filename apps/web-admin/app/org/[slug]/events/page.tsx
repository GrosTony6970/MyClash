'use client';

/**
 * /org/[slug]/events — redirect shim
 *
 * Resolves the org by slug → loads its events (already sorted server-side
 * by start_date DESC) → router.replace to the latest event's hub. Falls
 * back to /org/[slug]/events/manage when:
 *   - the org has zero events,
 *   - the slug doesn't resolve,
 *   - any API call fails.
 *
 * The full list / management UI lives at /org/[slug]/events/manage and
 * is reachable from the event switcher dropdown in the shell header.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useI18n } from '../../../../src/i18n/I18nProvider';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export default function EventsRedirectPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    const controller = new AbortController();
    const managePath = `/org/${slug}/events/manage`;

    (async () => {
      try {
        const orgRes = await fetch(
          `${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`,
          { credentials: 'include', signal: controller.signal },
        );
        if (!orgRes.ok) {
          router.replace(managePath);
          return;
        }
        const org = (await orgRes.json()) as { id: string };

        const eventsRes = await fetch(`${apiUrl}/api/v1/organizations/${org.id}/events`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!eventsRes.ok) {
          router.replace(managePath);
          return;
        }
        const events = (await eventsRes.json()) as Array<{ id: string }>;
        if (events.length === 0) {
          router.replace(managePath);
          return;
        }
        // Events are sorted by start_date DESC server-side — first is latest.
        router.replace(`/org/${slug}/events/${events[0]!.id}`);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        router.replace(managePath);
      }
    })();

    return () => controller.abort();
  }, [slug, router]);

  return (
    <main className="p-8">
      <p className="text-sm text-slate-500">{t('organizer.events.redirecting')}</p>
    </main>
  );
}
