'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { usePrompt } from '@myclash/ui';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

interface StaffAccount {
  id: string;
  display_name: string;
  username: string;
  role: 'arbitre_table' | 'event_staff';
  status: 'active' | 'disabled';
  liceIds: string[];
}

interface Lice {
  id: string;
  name: string;
}

interface EventInfo {
  id: string;
  slug: string;
  name: string;
}

export default function EventStaffPage() {
  const { slug, eventId } = useParams<{ slug: string; eventId: string }>();
  const { t } = useI18n();
  const { prompt, promptDialog } = usePrompt();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const publicAppUrl = process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] ?? 'https://app.myclash.fr';

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [lices, setLices] = useState<Lice[]>([]);
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    pin: '',
    role: 'arbitre_table' as 'arbitre_table' | 'event_staff',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const liceMap = useMemo(() => new Map(lices.map((lice) => [lice.id, lice.name])), [lices]);

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
    const pin = await prompt({ title: t('organizer.staff.pin') });
    if (!pin) return;
    await fetch(`${apiUrl}/api/v1/events/${eventId}/staff-accounts/${account.id}/reset-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ pin }),
    });
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

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    window.setTimeout(() => setCopied(null), 1500);
  }

  return (
    <main className="max-w-5xl p-8">
      <Link
        href={`/org/${slug}/events/${eventId}`}
        className="text-sm text-gray-500 hover:underline"
      >
        {t('organizer.staff.backToEvent')}
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{t('organizer.staff.title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('organizer.staff.description')}</p>

      <form
        onSubmit={(event) => void createAccount(event)}
        className="mt-6 grid gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-5"
      >
        <input
          required
          value={form.displayName}
          onChange={(event) =>
            setForm((current) => ({ ...current, displayName: event.target.value }))
          }
          placeholder={t('organizer.staff.displayName')}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          required
          value={form.username}
          onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
          placeholder={t('organizer.staff.username')}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          required
          value={form.pin}
          inputMode="numeric"
          onChange={(event) => setForm((current) => ({ ...current, pin: event.target.value }))}
          placeholder={t('organizer.staff.pin')}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={form.role}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              role: event.target.value as 'arbitre_table' | 'event_staff',
            }))
          }
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="arbitre_table">{t('organizer.staff.roles.arbitre_table')}</option>
          <option value="event_staff">{t('organizer.staff.roles.event_staff')}</option>
        </select>
        <button className="rounded bg-red-700 px-4 py-2 text-sm font-bold text-white">
          {t('organizer.staff.create')}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      {loading && <p className="mt-8 text-sm text-gray-500">{t('organizer.staff.loading')}</p>}

      {!loading && accounts.length === 0 && (
        <p className="mt-8 rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          {t('organizer.staff.empty')}
        </p>
      )}

      <div className="mt-6 space-y-4">
        {accounts.map((account) => (
          <section key={account.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-bold">{account.display_name}</h2>
                <p className="text-sm text-gray-500">
                  {account.username} - {t(`organizer.staff.roles.${account.role}`)} -{' '}
                  {t(`organizer.staff.${account.status}`)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void resetPin(account)}
                  className="rounded border px-3 py-2 text-sm"
                >
                  {t('organizer.staff.resetPin')}
                </button>
                <button
                  onClick={() => void toggleStatus(account)}
                  className="rounded border px-3 py-2 text-sm"
                >
                  {account.status === 'active'
                    ? t('organizer.staff.disable')
                    : t('organizer.staff.enable')}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <h3 className="text-sm font-bold text-gray-700">
                {t('organizer.staff.assignments')}
              </h3>
              <div className="mt-2 flex flex-wrap gap-3">
                {lices.map((lice) => (
                  <label key={lice.id} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={account.liceIds.includes(lice.id)}
                      onChange={(event) =>
                        void setAccountLices(account, lice.id, event.target.checked)
                      }
                    />
                    {lice.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <h3 className="text-sm font-bold text-gray-700">
                {t('organizer.staff.displayUrls')}
              </h3>
              <div className="mt-2 space-y-2">
                {account.liceIds.map((liceId) => {
                  const liceName = liceMap.get(liceId) ?? liceId;
                  const url = `${publicAppUrl}/e/${event?.slug ?? eventId}/lice/${encodeURIComponent(liceName)}/display`;
                  return (
                    <div
                      key={liceId}
                      className="flex items-center justify-between gap-3 rounded bg-gray-50 px-3 py-2 text-sm"
                    >
                      <span className="truncate">{url}</span>
                      <button onClick={() => void copyUrl(url)} className="shrink-0 text-red-700">
                        {copied === url
                          ? t('organizer.staff.copied')
                          : t('organizer.staff.copyUrl')}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </div>

      {promptDialog}
    </main>
  );
}
