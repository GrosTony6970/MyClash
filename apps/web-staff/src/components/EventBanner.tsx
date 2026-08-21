'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { api } from '../lib/api';
import { useRememberedEvent } from '../lib/last-event';
import { staffRoutePrefix } from '../lib/nav';
import { eventKindTone, type EventKindTone } from '../lib/event-kind-badge';
import { useStaffSession } from './StaffScreen';

/** Everything the banner shows about the event. Every field may be absent. */
export interface BannerEvent {
  name: string;
  kind?: string | null;
  status?: string | null;
  logoUrl?: string | null;
}

/**
 * Which event this tablet is signed into, and the way out of it.
 *
 * ── Why a volunteer needs this at all ───────────────────────────────────────
 * The login picker badges a test or club event once, and then that warning is
 * gone for the rest of the day. A volunteer handed a borrowed tablet on the
 * second morning of a two-day weekend has no way to tell a real event from
 * yesterday's rehearsal — and checking twenty fighters into a dry run is the
 * failure this exists to prevent. So the badge follows the session onto every
 * screen the account works.
 *
 * ── What "event theme" means here ───────────────────────────────────────────
 * A logo, and nothing else. Colour overrides and font pickers were retired from
 * `themes` in migration 0086, and `docs/design/web-staff.md` rules that this
 * app's accent is always red. There is no per-event colour to show and none is
 * wanted on a surface read at a glance in a sports hall.
 *
 * It scrolls away with the content rather than sticking: the list of people IS
 * the job, and a permanent bar costs a row of it on every screen.
 *
 * Placed by each screen inside its own container — `StaffScreen` owns the data
 * and explains why it does not render this itself. The scoring pad renders none.
 */
export function EventBanner() {
  const { event, accountName } = useStaffSession();
  // Falls back to what this tablet remembers signing into, so a dead network
  // leaves the event named rather than blank. Hard rule 3 in the other
  // direction: the banner must never be a reason a screen waits.
  const remembered = useRememberedEvent();
  const shown: BannerEvent | null = event ?? (remembered ? { name: remembered.name } : null);
  if (!shown) return null;

  return (
    <header className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-3">
      <div className="flex min-w-0 items-center gap-3">
        <EventLogo url={shown.logoUrl ?? null} name={shown.name} />
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold text-foreground">{shown.name}</p>
          <EventBadges kind={shown.kind ?? null} status={shown.status ?? null} />
        </div>
      </div>
      <LogoutControl accountName={accountName} />
    </header>
  );
}

/**
 * The event's own logo, or nothing.
 *
 * Plain `<img>`: these are remote logos on arbitrary hosts, and next/image
 * would need every one of them in remotePatterns — the same reason the roster
 * photos in `PersonRow` are plain too.
 */
function EventLogo({ url, name }: { url: string | null; name: string }) {
  if (!url) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote event logo on an arbitrary host
    <img src={url} alt={name} className="h-9 w-9 shrink-0 rounded object-contain" loading="lazy" />
  );
}

/**
 * Test, club and draft, badged exactly as the login picker badges them.
 *
 * `standard` and `published` get nothing: they are the unremarkable case, and a
 * badge on every event would train volunteers to read past the one that matters.
 */
function EventBadges({ kind, status }: { kind: string | null; status: string | null }) {
  const { t } = useI18n();
  const badge = eventKindTone(kind);

  if (!badge && status !== 'draft') return null;

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1">
      {badge && <Badge tone={badge.tone}>{t(badge.labelKey)}</Badge>}
      {status === 'draft' && <Badge tone="warning">{t('scoring.login.picker.badgeDraft')}</Badge>}
    </div>
  );
}

function Badge({ tone, children }: { tone: EventKindTone; children: string }) {
  const toneClass =
    tone === 'danger'
      ? 'border-danger text-danger'
      : tone === 'warning'
        ? 'border-warning text-warning'
        : 'border-border text-muted';
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${toneClass}`}
    >
      {children}
    </span>
  );
}

/**
 * Who is signed in, and the two taps it takes to stop being them.
 *
 * ── Two taps, not one ───────────────────────────────────────────────────────
 * The button asks before it acts. This is a tablet with 44px targets worked by
 * someone standing over a queue, and an accidental sign-out costs a PIN
 * re-entry with people waiting. The confirmation replaces the button in place
 * rather than opening a dialog: nothing to dismiss, and the volunteer's hand is
 * already there.
 *
 * ── One owner ───────────────────────────────────────────────────────────────
 * This used to live in the /lices header, which meant the desk and the gear
 * table — the two screens on a tablet that genuinely rotates between people —
 * had no way to sign out at all. It is here now and /lices no longer has its
 * own copy.
 */
function LogoutControl({ accountName }: { accountName: string | null }) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);

  if (asking) return <LogoutConfirm onCancel={() => setAsking(false)} />;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {accountName && (
        <span className="max-w-[8rem] truncate text-sm text-muted">{accountName}</span>
      )}
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
      >
        {t('scoring.banner.logout')}
      </button>
    </div>
  );
}

/** The second tap, and the one that actually ends the session. */
function LogoutConfirm({ onCancel }: { onCancel: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);

  async function logout() {
    setLeaving(true);
    try {
      await api.post('/api/v1/staff-auth/logout');
    } catch {
      // The route is public and idempotent, and the cookie is server-bound.
      // A network failure still belongs at the login screen.
    }
    // Prefix-aware: served through the admin proxy this app lives under
    // /staff, and a bare '/login' would leave it for the admin app entirely.
    router.replace(`${staffRoutePrefix(pathname ?? '')}/login`);
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => void logout()}
        disabled={leaving}
        className="min-h-[44px] rounded-lg border border-danger px-4 text-sm font-bold text-danger disabled:opacity-50"
      >
        {t('scoring.banner.logoutConfirm')}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
      >
        {t('scoring.banner.logoutCancel')}
      </button>
    </div>
  );
}
