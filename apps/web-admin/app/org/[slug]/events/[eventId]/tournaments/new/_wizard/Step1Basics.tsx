'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { TournamentColorDot, useToast, WeaponCombobox } from '@myclash/ui';
import { TOURNAMENT_COLORS } from '../../_lib/tournament-colors';
import { WEAPONS, matchWeapon } from './weapon-match';

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
  const [weaponTouched, setWeaponTouched] = useState(false);
  const [rulesetCode, setRulesetCode] = useState('TF_v1');
  const [rulesetVersion, setRulesetVersion] = useState('1');
  const [penaltyRulesetId, setPenaltyRulesetId] = useState<string>('');
  const [color, setColor] = useState<string>('');
  const [maxParticipants, setMaxParticipants] = useState<string>('');
  const [maxWaitlist, setMaxWaitlist] = useState<string>('');
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
          setWeaponTouched(true);
          setRulesetCode(row.ruleset_code);
          setRulesetVersion(row.ruleset_version);
          setPenaltyRulesetId(row.penalty_ruleset_id ?? '');
          setColor((row.color as string | null) ?? '');
          setMaxParticipants(row.max_participants != null ? String(row.max_participants) : '');
          setMaxWaitlist(row.max_waitlist != null ? String(row.max_waitlist) : '');
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
      const parsedMaxParticipants = maxParticipants ? Number(maxParticipants) : null;
      const parsedMaxWaitlist = maxWaitlist ? Number(maxWaitlist) : null;

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
            color: color || null,
            maxParticipants: parsedMaxParticipants,
            maxWaitlist: parsedMaxWaitlist,
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
            color: color || undefined,
            maxParticipants: parsedMaxParticipants ?? undefined,
            maxWaitlist: parsedMaxWaitlist ?? undefined,
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
            const v = e.target.value;
            setName(v);
            if (!initialTournamentId) setSlug(slugify(v));
            if (!weaponTouched) {
              const m = matchWeapon(v);
              if (m) setWeapon(m);
            }
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
        <WeaponCombobox
          value={weapon}
          onChange={(v) => {
            setWeapon(v);
            setWeaponTouched(true);
          }}
          options={WEAPONS}
          placeholder={t('organizer.tournaments.wizard.weaponPlaceholder')}
          emptyHint={t('organizer.tournaments.wizard.weaponCustomHint')}
          aria-label={t('organizer.tournaments.wizard.weapon')}
          className="w-full"
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
        <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
          {t('organizer.tournaments.wizard.penaltyRuleset')}
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            {t('organizer.tournaments.wizard.recommended')}
          </span>
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
        {!penaltyRulesetId && (
          <p className="mt-1 text-xs text-amber-700">
            {t('organizer.tournaments.wizard.penaltyRulesetBlankHint')}
          </p>
        )}
      </label>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-slate-600">
          {t('organizer.tournaments.settings.colorLabel')}
        </legend>
        <div className="flex items-center gap-2">
          <TournamentColorDot color={color || null} size="md" />
          <select
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">{t('organizer.tournaments.settings.colorNone')}</option>
            {TOURNAMENT_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-slate-500">
          {t('organizer.tournaments.settings.colorHelp')}
        </p>
      </fieldset>

      {/* Capacity caps — labels mirror the settings BasicsTab so
          the wizard and post-creation edit page look identical. */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">Max participants</span>
          <input
            type="number"
            min={1}
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(e.target.value)}
            placeholder="No cap"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">Max waitlist</span>
          <input
            type="number"
            min={0}
            value={maxWaitlist}
            onChange={(e) => setMaxWaitlist(e.target.value)}
            placeholder="No cap"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

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
