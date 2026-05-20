'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

interface Ruleset {
  code: string;
  version: string;
  label: string;
}
interface PenaltyRuleset {
  id: string;
  name: string;
}

interface TournamentBasics {
  name: string;
  slug: string;
  weapon: string | null;
  category: string | null;
  rulesetCode: string;
  rulesetVersion: string;
  penaltyRulesetId: string | null;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export function BasicsTab({ tournamentId }: { tournamentId: string }) {
  const toast = useToast();
  const [data, setData] = useState<TournamentBasics | null>(null);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [penaltyRulesets, setPenaltyRulesets] = useState<PenaltyRuleset[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`${apiUrl}/api/v1/rulesets`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch(`${apiUrl}/api/v1/penalty-rulesets`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : [],
      ),
    ]).then(([row, r, p]) => {
      if (row) {
        setData({
          name: row.name,
          slug: row.slug,
          weapon: row.weapon,
          category: row.category,
          rulesetCode: row.ruleset_code,
          rulesetVersion: row.ruleset_version,
          penaltyRulesetId: row.penalty_ruleset_id,
        });
      }
      setRulesets(r as Ruleset[]);
      setPenaltyRulesets(p as PenaltyRuleset[]);
    });
  }, [tournamentId]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          weapon: data.weapon ?? undefined,
          category: data.category ?? undefined,
          rulesetCode: data.rulesetCode,
          rulesetVersion: data.rulesetVersion,
          penaltyRulesetId: data.penaltyRulesetId,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(t('organizer.tournaments.settings.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <p className="text-sm text-slate-500">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl text-slate-900">
        {t('organizer.tournaments.settings.basics')}
      </h2>

      <Field label={t('organizer.tournaments.settings.name')}>
        <input
          value={data.name}
          onChange={(e) => setData({ ...data, name: e.target.value })}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>

      <Field label={t('organizer.tournaments.settings.slug')}>
        <input
          value={data.slug}
          disabled
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 font-mono"
        />
        <p className="text-xs text-slate-400 mt-1">
          {t('organizer.tournaments.settings.slugLocked')}
        </p>
      </Field>

      <Field label={t('organizer.tournaments.settings.weapon')}>
        <input
          value={data.weapon ?? ''}
          onChange={(e) => setData({ ...data, weapon: e.target.value || null })}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>

      <Field label={t('organizer.tournaments.settings.category')}>
        <input
          value={data.category ?? ''}
          onChange={(e) => setData({ ...data, category: e.target.value || null })}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>

      <Field label={t('organizer.tournaments.settings.ruleset')}>
        <select
          value={`${data.rulesetCode}:${data.rulesetVersion}`}
          onChange={(e) => {
            const [code, version] = e.target.value.split(':');
            setData({ ...data, rulesetCode: code!, rulesetVersion: version! });
          }}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {rulesets.map((r) => (
            <option key={`${r.code}:${r.version}`} value={`${r.code}:${r.version}`}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('organizer.tournaments.settings.penaltyRuleset')}>
        <select
          value={data.penaltyRulesetId ?? ''}
          onChange={(e) => setData({ ...data, penaltyRulesetId: e.target.value || null })}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">{t('common.none')}</option>
          {penaltyRulesets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
