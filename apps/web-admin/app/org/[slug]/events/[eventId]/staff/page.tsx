'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, usePrompt } from '@myclash/ui';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';
import { StaffAccountCard } from './StaffAccountCard';
import { StaffLoginLink } from './StaffLoginLink';
import type { EventInfo, Lice, StaffAccount } from './types';

export default function EventStaffPage() {
  const { slug, eventId } = useParams<{ slug: string; eventId: string }>();
  const { t } = useI18n();
  const { prompt, promptDialog } = usePrompt();
  const apiUrl = getPublicApiUrl();
  const publicAppUrl = process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] ?? 'https://app.myclash.fr';
  // The scoring pad is where a referee's PIN actually works — the public app's
  // Sign in is the spectator door and cannot produce a staff session.
  const scoringUrl = process.env['NEXT_PUBLIC_SCORING_URL'] ?? 'https://scoring.myclash.fr';

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [lices, setLices] = useState<Lice[]>([]);
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    pin: '',
    role: 'arbitre_table' as 'arbitre_table' | 'event_staff',
  });
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Every URL on this page — staff login, display hub, per-Lice display —
  // resolves the event by SLUG on the server. The id is not a substitute, so
  // there is nothing to show until the event has loaded.
  const eventSlug = event?.slug ?? null;

  async function load() {
    try {
      const [eventRes, staffRes, licesRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/events/${eventId}`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/events/${eventId}/staff-accounts`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, { credentials: 'include' }),
      ]);
      if (!staffRes.ok) throw new Error('staff failed');
      if (eventRes.ok) setEvent((await eventRes.json()) as EventInfo);
      setAccounts((await staffRes.json()) as StaffAccount[]);
      setLices(licesRes.ok ? ((await licesRes.json()) as Lice[]) : []);
    } catch {
      setError(t('organizer.staff.loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}`, { credentials: 'include' }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/staff-accounts`, { credentials: 'include' }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, { credentials: 'include' }),
    ])
      .then(async ([eventRes, staffRes, licesRes]) => {
        if (cancelled) return;
        if (!staffRes.ok) throw new Error('staff failed');
        if (eventRes.ok) setEvent((await eventRes.json()) as EventInfo);
        setAccounts((await staffRes.json()) as StaffAccount[]);
        setLices(licesRes.ok ? ((await licesRes.json()) as Lice[]) : []);
      })
      .catch(() => {
        if (!cancelled) setError(t('organizer.staff.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, apiUrl, t]);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/staff-accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      setError(t('organizer.staff.createError'));
      return;
    }
    setForm({ displayName: '', username: '', pin: '', role: 'arbitre_table' });
    setShowPin(false);
    await load();
  }

  async function toggleStatus(account: StaffAccount) {
    await fetch(`${apiUrl}/api/v1/events/${eventId}/staff-accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status: account.status === 'active' ? 'disabled' : 'active' }),
    });
    await load();
  }

  async function resetPin(account: StaffAccount) {
    const pin = await prompt({ title: t('organizer.staff.pin'), masked: true });
    if (!pin) return;
    setError(null);
    setNotice(null);
    // The new PIN is never echoed back, so a silent failure here is
    // indistinguishable from a typo at the tablet an hour later.
    const res = await fetch(
      `${apiUrl}/api/v1/events/${eventId}/staff-accounts/${account.id}/reset-pin`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pin }),
      },
    );
    if (res.ok) setNotice(t('organizer.staff.resetPinDone'));
    else setError(t('organizer.staff.resetPinError'));
  }

  async function setAccountLices(account: StaffAccount, liceId: string, checked: boolean) {
    const next = checked
      ? [...account.liceIds, liceId]
      : account.liceIds.filter((existing) => existing !== liceId);
    await fetch(`${apiUrl}/api/v1/events/${eventId}/staff-accounts/${account.id}/lices`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ liceIds: next }),
    });
    setAccounts((current) =>
      current.map((item) => (item.id === account.id ? { ...item, liceIds: next } : item)),
    );
  }

  return (
    <main className="mx-auto max-w-[110rem] p-8">
      <Button variant="back" size="sm" asChild>
        <Link href={`/org/${slug}/events/${eventId}`}>← {t('organizer.staff.backToEvent')}</Link>
      </Button>
      <h1 className="mt-3 font-display font-bold text-2xl sm:text-3xl">
        {t('organizer.staff.title')}
      </h1>
      <p className="mt-1 text-sm text-muted">{t('organizer.staff.description')}</p>

      {eventSlug && (
        <section className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-display font-semibold text-lg">{t('organizer.staff.staffLogin')}</h2>
          <div className="mt-2 space-y-2">
            <StaffLoginLink
              label={t('organizer.staff.staffLoginUrl')}
              description={t('organizer.staff.staffLoginHelp')}
              url={`${scoringUrl}/login?event=${encodeURIComponent(eventSlug)}`}
              withQr
            />
            <StaffLoginLink
              label={t('organizer.staff.displayHubUrl')}
              url={`${publicAppUrl}/e/${eventSlug}/display`}
            />
          </div>
        </section>
      )}

      <form
        onSubmit={(event) => void createAccount(event)}
        className="mt-6 grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-5"
      >
        <input
          required
          value={form.displayName}
          onChange={(event) =>
            setForm((current) => ({ ...current, displayName: event.target.value }))
          }
          placeholder={t('organizer.staff.displayName')}
          className="rounded border border-border px-3 py-2 text-sm"
        />
        <input
          required
          value={form.username}
          onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
          placeholder={t('organizer.staff.username')}
          className="rounded border border-border px-3 py-2 text-sm"
        />
        <div className="relative">
          <input
            required
            value={form.pin}
            type={showPin ? 'text' : 'password'}
            autoComplete="off"
            inputMode="numeric"
            onChange={(event) => setForm((current) => ({ ...current, pin: event.target.value }))}
            placeholder={t('organizer.staff.pin')}
            className="w-full rounded border border-border py-2 pl-3 pr-16 text-sm"
          />
          <button
            type="button"
            onClick={() => setShowPin((current) => !current)}
            className="absolute inset-y-0 right-2 text-xs font-semibold text-accent"
          >
            {showPin ? t('organizer.staff.hidePin') : t('organizer.staff.showPin')}
          </button>
        </div>
        <select
          value={form.role}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              role: event.target.value as 'arbitre_table' | 'event_staff',
            }))
          }
          className="rounded border border-border px-3 py-2 text-sm"
        >
          <option value="arbitre_table">{t('organizer.staff.roles.arbitre_table')}</option>
          <option value="event_staff">{t('organizer.staff.roles.event_staff')}</option>
        </select>
        <button className="rounded bg-accent px-4 py-2 text-sm font-bold text-accent-foreground">
          {t('organizer.staff.create')}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {notice && <p className="mt-4 text-sm text-success">{notice}</p>}
      {loading && <p className="mt-8 text-sm text-muted">{t('organizer.staff.loading')}</p>}

      {!loading && accounts.length === 0 && (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-sm text-muted">
          {t('organizer.staff.empty')}
        </p>
      )}

      <div className="mt-6 space-y-4">
        {accounts.map((account) => (
          <StaffAccountCard
            key={account.id}
            account={account}
            lices={lices}
            publicAppUrl={publicAppUrl}
            scoringUrl={scoringUrl}
            eventSlug={eventSlug}
            onToggleStatus={(target) => void toggleStatus(target)}
            onResetPin={(target) => void resetPin(target)}
            onSetLices={(target, liceId, checked) => void setAccountLices(target, liceId, checked)}
          />
        ))}
      </div>

      {promptDialog}
    </main>
  );
}
