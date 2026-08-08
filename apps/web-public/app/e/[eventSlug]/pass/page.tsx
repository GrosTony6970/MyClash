'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { getPublicApiUrl } from '@/lib/api-url';
import { readStoredPass, writeStoredPass, type StoredPass } from '@/lib/event-pass';
import { useI18n } from '../../../../src/i18n/I18nProvider';

/**
 * My event pass — the QR the desk scans.
 *
 * Lives on `/e/[eventSlug]` rather than under `/me` ON PURPOSE. `/me` requires a
 * claimed account (PublicPersonalShell bounces anything else to /login), and at
 * a real HEMA event most participants are GUESTS — a device that picked itself
 * off the roster and has no account at all. A pass only the minority can hold is
 * not a fast lane. This surface serves both, because the API resolves either
 * identity through ParticipantIdentityService.
 *
 * Three entry paths land here:
 *   /e/<slug>/pass          — issue (or re-show) this device's own pass
 *   /e/<slug>/pass?t=<tok>  — an emailed pass, rendered straight from the link
 *
 * The token is kept on the device, not re-fetched, so the QR still renders in a
 * sports hall with no signal — which is the only place it is ever presented.
 * See `src/lib/event-pass.ts` and migration 0176 for why the API cannot simply
 * hand the same token back.
 */
export default function EventPassPage() {
  const { t } = useI18n();
  const { eventSlug } = useParams<{ eventSlug: string }>();
  const emailed = useEmailedToken();

  return (
    <main id="main-content" className="mx-auto max-w-md px-4 py-8">
      <h1
        className="mb-1 font-display text-2xl font-bold sm:text-3xl"
        style={{ color: 'var(--color-accent)' }}
      >
        {t('publicApp.pass.title')}
      </h1>
      <p className="mb-6 text-sm text-foreground-secondary">{t('publicApp.pass.subtitle')}</p>

      {emailed ? (
        <EmailedPass eventSlug={eventSlug} token={emailed} />
      ) : (
        <OwnPass eventSlug={eventSlug} />
      )}
    </main>
  );
}

/**
 * The `?t=` token from an emailed link.
 *
 * Read straight off `window.location` through `useSyncExternalStore`, not
 * `useSearchParams` — that hook makes the React Compiler bail out of the whole
 * page, and the staff login page reads its own querystring this way for the
 * same reason. The querystring cannot change without a navigation, so the
 * subscription is a no-op and the server snapshot is empty, which is what keeps
 * hydration matching.
 */
const subscribeQuery = (): (() => void) => () => {};
const readEmailedToken = (): string | null => new URLSearchParams(window.location.search).get('t');
const noToken = (): string | null => null;

function useEmailedToken(): string | null {
  return useSyncExternalStore(subscribeQuery, readEmailedToken, noToken);
}

// ── The participant's own pass ───────────────────────────────────────────────

/** Issue on first visit, then render from the device on every later one. */
function OwnPass({ eventSlug }: { eventSlug: string }) {
  const { t } = useI18n();
  const { pass, state } = useOwnPass(eventSlug);

  if (state === 'loading') {
    return <p className="text-sm text-muted">{t('publicApp.pass.loading')}</p>;
  }
  if (state === 'unauthenticated') {
    return <Notice text={t('publicApp.pass.signInNeeded')} />;
  }
  if (!pass) {
    return <Notice text={t('publicApp.pass.unavailable')} />;
  }

  return (
    <>
      <PassCode token={pass.token} />
      <p className="mt-4 text-center text-xs text-muted">{t('publicApp.pass.deviceNote')}</p>
    </>
  );
}

type OwnPassState = 'loading' | 'ready' | 'unauthenticated' | 'failed';

/**
 * This device's pass: the stored one if it holds a live one, otherwise a freshly
 * issued one.
 *
 * At module scope and state-free, and ALWAYS asynchronous even on the
 * cache-hit path, so the effect below holds no synchronous setState —
 * `react-hooks/set-state-in-effect` is an error in this repo, and an effect that
 * branches into a direct setState for the fast path is writing around the rule
 * rather than through it.
 */
function resolveOwnPass(
  eventSlug: string,
): Promise<{ state: OwnPassState; pass: StoredPass | null }> {
  // The device's own copy wins and costs no network — this is what makes the
  // pass render at a venue with no signal.
  const stored = readStoredPass(eventSlug);
  if (stored) return Promise.resolve({ state: 'ready', pass: stored });

  return fetch(`${getPublicApiUrl()}/api/v1/events/${eventSlug}/pass`, {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (res) => {
      if (!res.ok) {
        return {
          state: res.status === 401 ? ('unauthenticated' as const) : ('failed' as const),
          pass: null,
        };
      }
      const pass = (await res.json()) as StoredPass;
      writeStoredPass(eventSlug, pass);
      return { state: 'ready' as const, pass };
    })
    .catch(() => ({ state: 'failed' as const, pass: null }));
}

function useOwnPass(eventSlug: string) {
  const [pass, setPass] = useState<StoredPass | null>(null);
  const [state, setState] = useState<OwnPassState>('loading');

  useEffect(() => {
    let cancelled = false;
    void resolveOwnPass(eventSlug).then((result) => {
      if (cancelled) return;
      setPass(result.pass);
      setState(result.state);
    });
    return () => {
      cancelled = true;
    };
  }, [eventSlug]);

  return { pass, state };
}

// ── An emailed pass ──────────────────────────────────────────────────────────

interface PassPreview {
  givenName: string;
  familyName: string;
  eventName: string;
}

function previewPass(token: string): Promise<PassPreview | null> {
  return fetch(`${getPublicApiUrl()}/api/v1/event-passes/${encodeURIComponent(token)}`)
    .then((res) => (res.ok ? (res.json() as Promise<PassPreview>) : null))
    .catch(() => null);
}

/**
 * A pass that arrived by email.
 *
 * The QR renders from the link immediately — the preview is confirmation, not a
 * gate, so a fighter on bad signal is never left holding a blank screen. What
 * the preview adds is being TOLD when a pass is dead, instead of finding out at
 * the desk with a queue behind you.
 */
function EmailedPass({ eventSlug, token }: { eventSlug: string; token: string }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<PassPreview | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void previewPass(token).then((result) => {
      if (cancelled) return;
      setPreview(result);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Keep it, so returning to /e/<slug>/pass without the link still works.
  useEffect(() => {
    writeStoredPass(eventSlug, { token, expiresAt: null });
  }, [eventSlug, token]);

  return (
    <>
      {preview && (
        <p className="mb-3 text-center text-sm font-semibold text-foreground">
          {preview.givenName} {preview.familyName} · {preview.eventName}
        </p>
      )}
      <PassCode token={token} />
      {checked && !preview && <Notice text={t('publicApp.pass.linkExpired')} />}
    </>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────────────

/**
 * Dark-on-white regardless of theme, and large.
 *
 * Both existing QR sites in this repo force `bg-white` with the same comment: a
 * tinted or themed symbol will not read. This one is also sized for a phone held
 * at arm's length under sports-hall lighting, not for a share card.
 */
function PassCode({ token }: { token: string }) {
  return (
    <div className="flex justify-center">
      <div className="rounded-xl bg-white p-4">
        <QRCodeSVG value={token} size={240} />
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-foreground-secondary">
      {text}
    </p>
  );
}
