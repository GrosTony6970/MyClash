'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { fetchSelectableRulesets } from '@/lib/selectable-rulesets';
import type { BucketDiff } from '@myclash/rulesets';
import { useToast } from '@myclash/ui';
import { useWeaponOptions } from '@/hooks/useWeaponOptions';
import { RepinRulesetDialog } from './RepinRulesetDialog';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

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
  rulesetCode: string;
  rulesetVersion: string;
  penaltyRulesetId: string | null;
  /** Slice 4: cap on registered + checked_in. Null = unlimited. */
  maxParticipants: number | null;
  /** Slice 4: cap on waitlist size. Null = unlimited. */
  maxWaitlist: number | null;
}

const apiUrl = getPublicApiUrl();

export function BasicsTab({ tournamentId }: { tournamentId: string }) {
  const { t } = useI18n();

  const params = useParams<{ slug: string; eventId: string }>();
  const orgSlug = params.slug;
  const eventId = params.eventId;
  const toast = useToast();
  const weaponOptions = useWeaponOptions();
  const [data, setData] = useState<TournamentBasics | null>(null);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [penaltyRulesets, setPenaltyRulesets] = useState<PenaltyRuleset[]>([]);
  const [saving, setSaving] = useState(false);
  // The ruleset as currently pinned (captured on load). The dropdown mutates
  // `data.ruleset*`; comparing against this detects a pending ruleset change,
  // which is applied through a dedicated flow (never the plain Save) so it can
  // fall back to the audited re-pin ceremony when results already exist.
  const [originalRuleset, setOriginalRuleset] = useState<{ code: string; version: string } | null>(
    null,
  );
  const [repinOpen, setRepinOpen] = useState(false);
  const [repinBusy, setRepinBusy] = useState(false);
  const [repinError, setRepinError] = useState<string | null>(null);
  // The computed per-bucket lineage diff for the pending re-pin, loaded from the
  // read-only preview when the ceremony opens (null while loading / on failure).
  const [repinDiff, setRepinDiff] = useState<BucketDiff | null>(null);

  useEffect(() => {
    if (!orgSlug) return;
    // Resolve org id from slug so we can hit the org-scoped penalty-rulesets
    // endpoint (which filters out other orgs' public rulesets).
    // Silent reads: the tab shows its loading line until the row lands, and
    // every save below reports its own refusal. The org resolve falls back to
    // the platform-wide penalty catalogue, exactly as before.
    void apiRequest<{ id: string }>(
      apiUrl,
      `/api/v1/organizations/slug/${encodeURIComponent(orgSlug)}`,
    ).then((orgRes) => {
      const penaltyEndpoint = orgRes.ok
        ? `/api/v1/organizations/${orgRes.data.id}/penalty-rulesets`
        : '/api/v1/penalty-rulesets';

      return Promise.all([
        apiRequest<Record<string, unknown>>(apiUrl, `/api/v1/tournaments/${tournamentId}`).then(
          (r) => (r.ok ? r.data : null),
        ),
        // Event-scoped, so an org-authored ruleset stays selectable here.
        // The bare /rulesets catalog is registry-only and never contains one.
        fetchSelectableRulesets(apiUrl, eventId),
        apiRequest<PenaltyRuleset[]>(apiUrl, penaltyEndpoint).then((r) => (r.ok ? r.data : [])),
      ]).then(([row, r, p]) => {
        if (row) {
          setData({
            name: row['name'] as string,
            slug: row['slug'] as string,
            weapon: row['weapon'] as string,
            rulesetCode: row['ruleset_code'] as string,
            rulesetVersion: row['ruleset_version'] as string,
            penaltyRulesetId: (row['penalty_ruleset_id'] as string | null) ?? null,
            maxParticipants: (row['max_participants'] as number | null) ?? null,
            maxWaitlist: (row['max_waitlist'] as number | null) ?? null,
          });
          setOriginalRuleset({
            code: row['ruleset_code'] as string,
            version: row['ruleset_version'] as string,
          });
        }
        setRulesets(r as Ruleset[]);
        setPenaltyRulesets(p);
      });
    });
  }, [tournamentId, orgSlug, eventId]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        body: {
          // Send null (not undefined) so selecting "None" actually clears the
          // weapon — the DTO is nullish and the service maps null to a clear.
          name: data.name,
          weapon: data.weapon,
          // Ruleset is deliberately NOT saved here — a ruleset change is applied
          // through `changeRuleset` so it can fall back to the audited re-pin
          // ceremony, and so an unrelated Save never 403s (and loses these
          // edits) when the tournament already has results.
          penaltyRulesetId: data.penaltyRulesetId,
          maxParticipants: data.maxParticipants,
          maxWaitlist: data.maxWaitlist,
        },
      });
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.saveFailed'));
        if (message) toast.error(message);
        return;
      }
      toast.success(t('organizer.tournaments.settings.saved'));
    } finally {
      setSaving(false);
    }
  }

  const rulesetLabel = (code: string, version: string): string =>
    rulesets.find((r) => r.code === code && r.version === version)?.label ?? code;

  /**
   * Apply the pending ruleset change. Tries the ordinary PATCH first (the fast
   * path for a tournament with no results); a 403 means the commit-1 guard
   * blocked it because matches are scored, so we open the audited re-pin
   * ceremony instead.
   */
  async function changeRuleset() {
    if (!data) return;
    setRepinError(null);
    const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournamentId}`, {
      method: 'PATCH',
      body: { rulesetCode: data.rulesetCode, rulesetVersion: data.rulesetVersion },
    });
    if (r.ok) {
      setOriginalRuleset({ code: data.rulesetCode, version: data.rulesetVersion });
      toast.success(t('admin.orgTournaments.changeRulesetSuccess'));
      return;
    }
    // NOT a message, and kept as it was: a 403 here means the commit-1 guard
    // blocked the fast path because matches are scored, so the screen opens the
    // audited re-pin ceremony instead of saying anything.
    if (r.kind === 'unauthenticated' && r.status === 403) {
      setRepinDiff(null);
      setRepinOpen(true);
      // Load the computed lineage diff so the ceremony shows which buckets
      // change before the organiser justifies the re-pin. Advisory — the
      // ceremony still works if the preview fails.
      const preview = await apiRequest<{ diff?: BucketDiff }>(
        apiUrl,
        `/api/v1/tournaments/${tournamentId}/repin-preview?rulesetCode=${encodeURIComponent(
          data.rulesetCode,
        )}&rulesetVersion=${encodeURIComponent(data.rulesetVersion)}`,
      );
      setRepinDiff(preview.ok ? (preview.data.diff ?? null) : null);
      return;
    }
    const message = failureMessage(r, t, t('admin.common.saveFailed'));
    if (message) toast.error(message);
  }

  /** Confirm the ceremony: POST the audited re-pin with the justification. */
  async function repin(justification: string) {
    if (!data) return;
    setRepinBusy(true);
    setRepinError(null);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournamentId}/repin-ruleset`, {
        method: 'POST',
        body: {
          rulesetCode: data.rulesetCode,
          rulesetVersion: data.rulesetVersion,
          justification,
        },
      });
      if (!r.ok) {
        // The 403 here keeps the screen's own sentence: it names the tier the
        // operator would need ("the ruleset's owner"), which the guard's own
        // words do not. Every other refusal now carries the API's reason.
        const message =
          r.kind === 'unauthenticated' && r.status === 403
            ? t('admin.orgTournaments.repinRulesetOwnerOnly')
            : failureMessage(r, t, t('admin.common.saveFailed'));
        if (message) setRepinError(message);
        return;
      }
      setOriginalRuleset({ code: data.rulesetCode, version: data.rulesetVersion });
      setRepinOpen(false);
      toast.success(t('admin.orgTournaments.repinRulesetSuccess'));
    } finally {
      setRepinBusy(false);
    }
  }

  if (!data) return <p className="text-sm text-muted">{t('common.loading')}</p>;

  const rulesetChanged =
    originalRuleset != null &&
    (data.rulesetCode !== originalRuleset.code || data.rulesetVersion !== originalRuleset.version);

  return (
    <div className="space-y-4">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.tournaments.settings.basics')}
      </h2>

      <Field label={t('organizer.tournaments.settings.name')}>
        <input
          value={data.name}
          onChange={(e) => setData({ ...data, name: e.target.value })}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
      </Field>

      <label className="block">
        <span className="block text-xs font-medium text-foreground-secondary mb-1">
          {t('organizer.tournaments.settings.slug')}{' '}
          <span className="font-normal text-muted">
            {t('organizer.tournaments.wizard.slugAutoGenerated')}
          </span>
        </span>
        <input
          value={data.slug}
          disabled
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-muted font-mono"
        />
        <p className="text-xs text-muted mt-1">{t('organizer.tournaments.settings.slugLocked')}</p>
      </label>

      <Field label={t('organizer.tournaments.settings.weapon')}>
        <select
          value={data.weapon ?? ''}
          onChange={(e) => setData({ ...data, weapon: e.target.value || null })}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        >
          <option value="">{t('common.none')}</option>
          {/* Union the current stored value even if it's no longer an active
              catalog entry, so it stays selected until the operator changes it
              (the API accepts an unchanged legacy value). */}
          {(data.weapon && !weaponOptions.includes(data.weapon)
            ? [data.weapon, ...weaponOptions]
            : weaponOptions
          ).map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('organizer.tournaments.settings.ruleset')}>
        <select
          value={`${data.rulesetCode}:${data.rulesetVersion}`}
          onChange={(e) => {
            const [code, version] = e.target.value.split(':');
            setData({ ...data, rulesetCode: code!, rulesetVersion: version! });
          }}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        >
          {rulesets.map((r) => (
            <option key={`${r.code}:${r.version}`} value={`${r.code}:${r.version}`}>
              {r.label}
            </option>
          ))}
        </select>
        {rulesetChanged && (
          <button
            type="button"
            onClick={() => void changeRuleset()}
            className="mt-2 rounded-md border border-accent px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent/10"
          >
            {t('admin.orgTournaments.changeRuleset')}
          </button>
        )}
      </Field>

      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground-secondary">
          {t('organizer.tournaments.settings.penaltyRuleset')}
          <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
            {t('organizer.tournaments.wizard.recommended')}
          </span>
        </span>
        <select
          value={data.penaltyRulesetId ?? ''}
          onChange={(e) => setData({ ...data, penaltyRulesetId: e.target.value || null })}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        >
          <option value="">{t('common.none')}</option>
          {penaltyRulesets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {!data.penaltyRulesetId && (
          <p className="mt-1 text-xs text-warning">
            {t('organizer.tournaments.wizard.penaltyRulesetBlankHint')}
          </p>
        )}
      </label>

      {/* Slice 4: capacity caps. Leaving either field blank means "no cap".
       *  When the participant cap is reached, the registrations create
       *  endpoint returns 409 and the admin UI offers an explicit
       *  'Add to waitlist instead?' confirmation. */}
      <Field label={t('admin.orgTournaments.maxParticipants')}>
        <input
          type="number"
          min={1}
          value={data.maxParticipants ?? ''}
          onChange={(e) =>
            setData({
              ...data,
              maxParticipants: e.target.value === '' ? null : Number(e.target.value),
            })
          }
          placeholder={t('admin.orgTournaments.noCap')}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
      </Field>

      <Field label={t('admin.orgTournaments.maxWaitlist')}>
        <input
          type="number"
          min={0}
          value={data.maxWaitlist ?? ''}
          onChange={(e) =>
            setData({
              ...data,
              maxWaitlist: e.target.value === '' ? null : Number(e.target.value),
            })
          }
          placeholder={t('admin.orgTournaments.noCap')}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
        {data.maxWaitlist != null && data.maxWaitlist > 0 && data.maxParticipants == null && (
          <p className="mt-1 text-xs text-warning">{t('admin.orgTournaments.waitlistNeedsCap')}</p>
        )}
      </Field>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>

      {originalRuleset && (
        <RepinRulesetDialog
          open={repinOpen}
          fromLabel={rulesetLabel(originalRuleset.code, originalRuleset.version)}
          toLabel={rulesetLabel(data.rulesetCode, data.rulesetVersion)}
          diff={repinDiff}
          busy={repinBusy}
          error={repinError}
          onConfirm={(j) => void repin(j)}
          onClose={() => {
            setRepinOpen(false);
            setRepinError(null);
            setRepinDiff(null);
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-foreground-secondary mb-1">{label}</span>
      {children}
    </label>
  );
}
