'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';
import { getStaffLoginUrl } from '@/lib/scoring-url';

interface Props {
  eventSlug: string;
  /** The Lice this screen is showing, as it appears in the URL. */
  currentLiceName: string;
}

const HIDE_AFTER_MS = 4_000;

/**
 * The kiosk's only interactive element: a control bar that is INVISIBLE until
 * someone touches the screen, and fades out again ~4s later.
 *
 * A display is output (`docs/design/display-kiosk.md`) — `cursor-none`, no
 * chrome, nothing that only appears on hover. But the person setting the screens
 * up arrives with one of these URLs and no way to pick a different Lice, and no
 * way to reach the sign-in their PIN actually works on. Idle-hidden is how both
 * hold: the projection stays pure output, and a tap gets you the switcher.
 */
export function DisplayControls({ eventSlug, currentLiceName }: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [liceNames, setLiceNames] = useState<string[]>([]);
  const hideTimer = useRef<number | null>(null);
  const requested = useRef(false);

  const reveal = useCallback(() => {
    setVisible(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS);

    // Fetched on the first reveal, not on mount: a screen nobody touches must
    // cost nothing beyond the match feed it exists to show.
    if (requested.current) return;
    requested.current = true;
    fetch(`${getPublicApiUrl()}/api/v1/events/${encodeURIComponent(eventSlug)}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) return;
        const raw = (await res.json()) as { lices?: Array<Record<string, unknown>> };
        const names = (raw.lices ?? [])
          .map((row) => ({
            name: typeof row['name'] === 'string' ? row['name'] : '',
            sortOrder: typeof row['sort_order'] === 'number' ? row['sort_order'] : 0,
          }))
          .filter((row) => row.name.length > 0)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
          .map((row) => row.name);
        setLiceNames(names);
      })
      .catch(() => {
        // Offline kiosk: the switcher stays empty, the display keeps running.
      });
  }, [eventSlug]);

  useEffect(() => {
    window.addEventListener('pointermove', reveal, { passive: true });
    window.addEventListener('touchstart', reveal, { passive: true });
    window.addEventListener('keydown', reveal);
    return () => {
      window.removeEventListener('pointermove', reveal);
      window.removeEventListener('touchstart', reveal);
      window.removeEventListener('keydown', reveal);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [reveal]);

  return (
    <div
      data-testid="display-controls"
      // `cursor-auto` undoes the stage's `cursor-none` for as long as there is
      // something to click.
      className={`fixed inset-x-0 bottom-0 z-overlay cursor-auto transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      // The bar is faded out, not unmounted — opacity alone is invisible to
      // assistive tech AND to Playwright's visibility check, so this attribute
      // is the honest signal of whether it is on screen.
      aria-hidden={!visible}
    >
      <div className="m-4 rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-muted">
              {t('publicApp.display.switchLice')}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {liceNames.map((name) =>
                // The API resolves the URL segment case-insensitively (ilike),
                // so the marker has to as well or a `/lice/lice%204/` URL shows
                // no current Lice at all.
                name.toLowerCase() === currentLiceName.toLowerCase() ? (
                  <span
                    key={name}
                    className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-sm font-bold text-accent"
                  >
                    {name} · {t('publicApp.display.currentLice')}
                  </span>
                ) : (
                  <Link
                    key={name}
                    href={`/e/${eventSlug}/lice/${encodeURIComponent(name)}/display`}
                    className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent"
                  >
                    {name}
                  </Link>
                ),
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <Link
              href={`/e/${eventSlug}/display`}
              className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground-secondary transition hover:border-accent hover:text-accent"
            >
              {t('publicApp.display.backToHub')}
            </Link>
            <a
              href={getStaffLoginUrl(eventSlug)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-foreground transition hover:bg-accent-hover"
            >
              {t('publicApp.display.staffSignIn')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
