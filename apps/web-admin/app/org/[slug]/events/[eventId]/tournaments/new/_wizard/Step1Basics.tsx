'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface Ruleset {
  code: string;
  version: string;
  label: string;
}
interface PenaltyRuleset {
  id: string;
  name: string;
}

function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function Step1Basics({
  eventId,
  initialTournamentId,
  onCreated,
}: {
  eventId: string;
  initialTournamentId: string | null;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [weapon, setWeapon] = useState('');
  const [rulesetCode, setRulesetCode] = useState('TF_v1');
  const [rulesetVersion, setRulesetVersion] = useState('1');
  const [penaltyRulesetId, setPenaltyRulesetId] = useState<string>('');
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [penaltyRulesets, setPenaltyRulesets] = useState<PenaltyRuleset[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch(`${apiUrl}/api/v1/rulesets`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch(`${apiUrl}/api/v1/penalty-rulesets`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : [],
      ),
    ]).then(([r, p]) => {
      setRulesets(r as Ruleset[]);
      setPenaltyRulesets(p as PenaltyRuleset[]);
    });

    if (initialTournamentId) {
      fetch(`${apiUrl}/api/v1/tournaments/${initialTournamentId}`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((row) => {
          if (!row) return;
          setName(row.name);
          setSlug(row.slug);
          setWeapon(row.weapon ?? '');
          setRulesetCode(row.ruleset_code);
          setRulesetVersion(row.ruleset_version);
          setPenaltyRulesetId(row.penalty_ruleset_id ?? '');
        });
    }
  }, [initialTournamentId]);

  async function submit() {
    if (!name.trim()) {
      toast.error(t('organizer.tournaments.wizard.nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      if (initialTournamentId) {
        // Resume flow — PATCH the existing draft
        await fetch(`${apiUrl}/api/v1/tournaments/${initialTournamentId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            weapon: weapon || null,
            rulesetCode,
            rulesetVersion,
            penaltyRulesetId: penaltyRulesetId || null,
          }),
        });
        onCreated(initialTournamentId);
      } else {
        // Initial flow — POST new draft tournament
        const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            slug: slug || slugify(name),
            weapon: weapon || undefined,
            rulesetCode,
            rulesetVersion,
            penaltyRulesetId: penaltyRulesetId || undefined,
          }),
        });
        if (!res.ok) throw new Error('Create failed');
        const created = await res.json();
        const newUrl = `${window.location.pathname}?id=${created.id}&step=2`;
        window.history.replaceState(null, '', newUrl);
        onCreated(created.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl text-slate-900">
        {t('organizer.tournaments.wizard.basics')}
      </h2>

      <label className="block">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          {t('organizer.tournaments.wizard.name')}
        </span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!initialTournamentId) setSlug(slugify(e.target.value));
          }}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          {t('organizer.tournaments.wizard.slug')}
        </span>
        <input
          value={slug}
          onChange={(e) => setSlug(slugify(e.target.value))}
          disabled={!!initialTournamentId}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-50"
        />
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          {t('organizer.tournaments.wizard.weapon')}
        </span>
        <input
          value={weapon}
          onChange={(e) => setWeapon(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          {t('organizer.tournaments.wizard.ruleset')}
        </span>
        <select
          value={`${rulesetCode}:${rulesetVersion}`}
          onChange={(e) => {
            const [c, v] = e.target.value.split(':');
            setRulesetCode(c!);
            setRulesetVersion(v!);
          }}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {rulesets.map((r) => (
            <option key={`${r.code}:${r.version}`} value={`${r.code}:${r.version}`}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          {t('organizer.tournaments.wizard.penaltyRuleset')}
        </span>
        <select
          value={penaltyRulesetId}
          onChange={(e) => setPenaltyRulesetId(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">{t('common.none')}</option>
          {penaltyRulesets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || !name.trim()}
          className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
        >
          {t('actions.next')}
        </button>
      </div>
    </div>
  );
}
