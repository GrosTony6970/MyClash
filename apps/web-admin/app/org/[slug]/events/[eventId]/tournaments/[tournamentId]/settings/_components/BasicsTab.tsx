'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { withPinnedVersion } from '@/lib/selectable-rulesets';
import { useToast } from '@myclash/ui';
import { useWeaponOptions } from '@/hooks/useWeaponOptions';
import { RepinRulesetDialog } from './RepinRulesetDialog';
import { storedRulesOf, useRepinDialog, type RulesetPair } from './useRepinDialog';
import { apiRequest, failureMessage, isArchivedEventRefusal } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { needsAuditOf, rulesChangeRefusal } from '@/lib/rules-change-refusal';
import { PenaltyPickField } from '../../../_shared/PenaltyPickField';
import { TournamentForfeitRules } from '../../../_shared/TournamentForfeitRules';
import { useForfeitRules, type StoredForfeit } from '../../../_shared/useForfeitRules';
import { sameForm, useSavedSnapshot } from '../../../_shared/useSavedSnapshot';
import type { TabProps } from './tab-props';
import { forfeitSavedAfter, saveBody, savedAfter, type TournamentBasics } from './basics-save';
import { basicsOf, loadBasics, type PenaltyRuleset, type Ruleset } from './basics-load';
import { RulesChangeDialog } from './RulesChangeDialog';
import { useRulesChangeDialog, type RulesHost } from './useRulesChangeDialog';

/** What a refused Save sent: the form, and the forfeit rules it would leave stored. */
interface BasicsSent {
  form: TournamentBasics;
  after: StoredForfeit;
}

const apiUrl = getPublicApiUrl();

export function BasicsTab({
  tournamentId,
  readOnly,
  readOnlyWhy,
  onDirtyChange,
  onRulesSaved,
  onNameSaved,
}: TabProps & {
  /** The name the server took: the page's header shows it. */
  onNameSaved?: (name: string) => void;
}) {
  const { t } = useI18n();

  const params = useParams<{ slug: string; eventId: string }>();
  const orgSlug = params.slug;
  const eventId = params.eventId;
  const toast = useToast();
  const weaponOptions = useWeaponOptions();
  const [data, setData] = useState<TournamentBasics | null>(null);
  // Save and the ruleset change each mark the fields they sent: a picked ruleset not applied
  // yet is unsaved too.
  const markSaved = useSavedSnapshot(data, onDirtyChange);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [penaltyRulesets, setPenaltyRulesets] = useState<PenaltyRuleset[]>([]);
  const [saving, setSaving] = useState(false);
  // The ruleset as currently pinned (captured on load). The dropdown mutates
  // `data.ruleset*`; comparing against this detects a pending ruleset change,
  // which is applied through a dedicated flow (never the plain Save) so it can
  // fall back to the audited re-pin ceremony when results already exist.
  const [originalRuleset, setOriginalRuleset] = useState<RulesetPair | null>(null);
  // Set from the Tournament's own read and from each Save, never from the None read: its rules
  // have no changes, and the Tournament's stay stored.
  const [stored, setStored] = useState<StoredForfeit | null>(null);
  const forfeitRead = useForfeitRules(eventId, tournamentId, data?.penaltyRulesetId ?? '', stored);
  // The new pair is pinned, and the picker's choice is saved.
  const rulesetApplied = (to: RulesetPair) => {
    setOriginalRuleset(to);
    markSaved((saved) =>
      saved ? { ...saved, rulesetCode: to.code, rulesetVersion: to.version } : saved,
    );
  };
  const repin = useRepinDialog({
    tournamentId,
    // A coded refusal is worded by the hook. The owner bar's 403 carries no rules code: the
    // screen's own sentence names the tier the operator would need. Every other refusal carries
    // the API's reason (the hook's fallback).
    otherRefusal: (r) =>
      r.kind === 'unauthenticated' && r.status === 403 && !isArchivedEventRefusal(r)
        ? t('admin.orgTournaments.repinRulesetOwnerOnly')
        : null,
    onRepinned: (to) => {
      rulesetApplied(to);
      onRulesSaved?.();
      toast.success(t('admin.orgTournaments.repinRulesetSuccess'));
    },
  });
  const rememberRules = repin.remember;
  const audit = useRulesChangeDialog<BasicsSent>(tournamentId);

  useEffect(() => {
    if (!orgSlug) return;
    void loadBasics(orgSlug, tournamentId, eventId).then(({ row, rulesets, penaltyRulesets }) => {
      if (row) {
        const { form, forfeit } = basicsOf(row);
        setData(form);
        markSaved(form);
        setStored({ pin: form.penaltyRulesetId, forfeit });
        setOriginalRuleset({ code: form.rulesetCode, version: form.rulesetVersion });
        rememberRules(storedRulesOf(row));
      }
      setRulesets(rulesets);
      setPenaltyRulesets(penaltyRulesets);
    });
  }, [tournamentId, orgSlug, eventId, markSaved, rememberRules]);

  /**
   * The audited save's host (`useRulesChangeDialog`): it sent the forfeit rules alone, so only
   * they are marked saved (ruling 151); the row it read back, or a later read of it, becomes what
   * the next audit and re-pin send back, unless a later save or read was remembered since.
   */
  const auditHost = (): RulesHost<BasicsSent> => ({
    stored: repin.stored!,
    saved: (row, { form: sent, after }) => {
      markSaved((saved) => forfeitSavedAfter(saved, after.forfeit));
      setData((now) =>
        now && sameForm(now.forfeitRules, sent.forfeitRules)
          ? { ...now, forfeitRules: after.forfeit }
          : now,
      );
      setStored((before) => ({ pin: before?.pin ?? null, forfeit: after.forfeit }));
      if (row) rememberRules(storedRulesOf(row));
    },
    stamp: repin.stamp,
    reread: (row, at) => {
      if (repin.stamp() === at) rememberRules(storedRulesOf(row));
    },
    onRulesSaved,
  });

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const sent = data;
      const { body, stored: after } = saveBody(sent, stored);
      const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        body,
      });
      if (!r.ok) {
        const locked = needsAuditOf(r);
        if (locked) audit.open({ ...locked, body, sent: { form: sent, after } });
        else {
          const message =
            rulesChangeRefusal(r, t) ?? failureMessage(r, t, t('admin.common.saveFailed'));
          if (message) toast.error(message);
        }
        return;
      }
      // The written row (the PATCH answers it): its name and card pin are what a re-pin then
      // confirms and sends back.
      rememberRules(storedRulesOf(r.data as Record<string, unknown>));
      // The form and its snapshot take the changes as now stored, a Reset sent gone: an edit made
      // while the Save was out stays in the form, unsaved.
      markSaved((saved) => savedAfter(saved, sent, after.forfeit));
      setData((now) =>
        now && sameForm(now.forfeitRules, sent.forfeitRules)
          ? { ...now, forfeitRules: after.forfeit }
          : now,
      );
      setStored(after);
      onNameSaved?.(sent.name);
      onRulesSaved?.();
      toast.success(t('organizer.tournaments.settings.saved'));
    } finally {
      setSaving(false);
    }
  }

  const rulesetChoices = originalRuleset
    ? withPinnedVersion(rulesets, originalRuleset, (code, version) =>
        t('organizer.tournaments.settings.rulesetEarlierEndRules', { code, version }),
      )
    : rulesets;
  const rulesetLabel = (code: string, version: string): string =>
    rulesetChoices.find((r) => r.code === code && r.version === version)?.label ?? code;

  /**
   * Apply the pending ruleset change. Tries the ordinary PATCH first (the fast path for a
   * Tournament that has not started); the lock's coded refusal (`rules_change_needs_audit`, its
   * list empty: the pair moves only through the re-pin) opens the audited re-pin instead. Every
   * other refusal is said (an archived Event's too, ruling 234).
   */
  async function changeRuleset() {
    if (!data) return;
    const to = { code: data.rulesetCode, version: data.rulesetVersion };
    const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournamentId}`, {
      method: 'PATCH',
      body: { rulesetCode: to.code, rulesetVersion: to.version },
    });
    if (r.ok) {
      rememberRules(storedRulesOf(r.data as Record<string, unknown>));
      rulesetApplied(to);
      onRulesSaved?.();
      toast.success(t('admin.orgTournaments.changeRulesetSuccess'));
      return;
    }
    if (needsAuditOf(r)) {
      await repin.open(to);
      return;
    }
    const message = rulesChangeRefusal(r, t) ?? failureMessage(r, t, t('admin.common.saveFailed'));
    if (message) toast.error(message);
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
          {rulesetChoices.map((r) => (
            <option key={`${r.code}:${r.version}`} value={`${r.code}:${r.version}`}>
              {r.label}
            </option>
          ))}
        </select>
        {rulesetChanged && (
          <button
            type="button"
            onClick={() => void changeRuleset()}
            disabled={readOnly}
            className="mt-2 rounded-md border border-accent px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent/10"
          >
            {t('admin.orgTournaments.changeRuleset')}
          </button>
        )}
      </Field>

      <PenaltyPickField
        value={data.penaltyRulesetId ?? ''}
        options={penaltyRulesets}
        onChange={(id) => setData({ ...data, penaltyRulesetId: id || null })}
      />
      <TournamentForfeitRules
        shown={forfeitRead}
        saved={stored?.forfeit ?? null}
        value={data.forfeitRules}
        onChange={(forfeitRules) => setData({ ...data, forfeitRules })}
        disabled={readOnly}
      />

      {/* Slice 4: capacity caps. Leaving either field blank means "no cap".
       *  When the participant cap is reached, the registrations create
       *  endpoint returns 409 and the admin UI offers an explicit
       *  'Add to waitlist instead?' confirmation. */}
      <Field label={t('admin.orgTournaments.maxParticipants')}>
        <input
          aria-label={t('admin.orgTournaments.maxParticipants')}
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
          aria-label={t('admin.orgTournaments.maxWaitlist')}
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
        disabled={saving || readOnly}
        title={readOnlyWhy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>

      {originalRuleset && repin.stored && repin.target && (
        <RepinRulesetDialog
          fromLabel={rulesetLabel(originalRuleset.code, originalRuleset.version)}
          toLabel={rulesetLabel(repin.target.code, repin.target.version)}
          tournamentName={repin.stored.name}
          preview={repin.preview}
          previewError={repin.previewError}
          busy={repin.busy}
          error={repin.error}
          onConfirm={(words) => void repin.confirm(words)}
          onClose={repin.close}
        />
      )}
      {repin.stored && (
        <RulesChangeDialog dialog={audit} tournamentName={repin.stored.name} host={auditHost} />
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
