'use client';

import { Button } from '@myclash/ui';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../../../src/i18n/I18nProvider';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export default function NewTournamentPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const router = useRouter();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [eventName, setEventName] = useState(eventId);
  const [name, setName] = useState('');
  const [slugValue, setSlugValue] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [weapon, setWeapon] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const event = (await res.json()) as { name?: string };
        setEventName(event.name ?? eventId);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl, eventId]);

  async function submit() {
    if (!name.trim() || !slugValue.trim()) {
      setError(t('organizer.newTournament.validation.required'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slugValue.trim(),
          weapon: weapon.trim() || null,
          category: category.trim() || null,
          rulesetCode: 'TF_v1',
          rulesetVersion: '1',
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.newTournament.validation.createFailed'));
      }
      router.push(`/org/${slug}/events/${eventId}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.newTournament.validation.createFailed'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="max-w-2xl p-6 lg:p-8">
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1d4ed8]">{eventName}</p>
        <h1 className="mt-2 text-3xl font-bold text-[#0f172a]">
          {t('organizer.newTournament.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t('organizer.newTournament.description')}</p>
      </div>

      {error && (
        <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            {t('organizer.newTournament.name')}
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlugValue(slugify(event.target.value));
              }}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder={t('organizer.newTournament.namePlaceholder')}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            {t('organizer.newTournament.slug')}
            <div className="flex overflow-hidden rounded-md border border-slate-300">
              <span className="border-r border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400">
                /t/
              </span>
              <input
                value={slugValue}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlugValue(event.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, ''));
                }}
                className="flex-1 px-3 py-2 text-sm outline-none"
                placeholder={t('organizer.newTournament.slugPlaceholder')}
              />
            </div>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              {t('organizer.newTournament.weapon')}
              <input
                value={weapon}
                onChange={(event) => setWeapon(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder={t('organizer.newTournament.weaponPlaceholder')}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              {t('organizer.newTournament.category')}
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder={t('organizer.newTournament.categoryPlaceholder')}
              />
            </label>
          </div>
        </div>
        <div className="mt-6 flex justify-between gap-3">
          <Button
            type="button"
            variant="back"
            onClick={() => router.push(`/org/${slug}/events/${eventId}`)}
          >
            {t('organizer.newTournament.cancel')}
          </Button>
          <Button
            type="button"
            variant="next"
            loading={saving}
            disabled={saving}
            onClick={() => void submit()}
          >
            {saving ? t('organizer.newTournament.creating') : t('organizer.newTournament.create')}
          </Button>
        </div>
      </section>
    </main>
  );
}
