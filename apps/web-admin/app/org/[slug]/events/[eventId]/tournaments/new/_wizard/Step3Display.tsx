'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useRef, useState } from 'react';
import { useToast, statusLabel } from '@myclash/ui';
import { TOURNAMENT_SIDE_COLORS } from '@myclash/types';
import { validateLogoFile } from '../../../../../../../../src/lib/validate-logo-file';
import { DISPLAY_FORM } from '../../_shared/display-form';
import { RulesFormState } from '../../_shared/RulesFormState';
import { useEffectiveRules } from '../../_shared/useEffectiveRules';
import { RulesChangeElsewhere } from './RulesChangeElsewhere';
import { DisplayPreview } from './DisplayPreview';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

// Derived, not retyped: this list used to hardcode 8 of the 11 tokens the API
// accepts, so grey, brown and pink were fully styled and validated server-side
// but unreachable from the UI.
const COLORS = TOURNAMENT_SIDE_COLORS;

/**
 * The scoring buttons and side colours in force (`effectiveRules.scoring`), and a Next that sends
 * only what the organiser changed, with the step (operator rulings 43, 46): an untouched Next
 * sends `{ wizardStep: 3 }`. The logo saves at once.
 */
export function Step3Display({
  tournamentId,
  onNext,
  onBack,
  readOnly,
}: {
  tournamentId: string;
  onNext: () => void;
  onBack: () => void;
  /** The Event is archived: the server refuses the step's saves, so they are closed. */
  readOnly: boolean;
}) {
  const { t } = useI18n();

  const toast = useToast();
  const rules = useEffectiveRules(tournamentId, DISPLAY_FORM);
  const { form: data, setForm: setData, saving } = rules;
  // Set by an upload or a removal; until then, the row's own.
  const [newLogo, setNewLogo] = useState<string | null | undefined>(undefined);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInput = useRef<HTMLInputElement | null>(null);

  const heading = (
    <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
      {t('organizer.tournaments.wizard.display')}
    </h2>
  );
  if (!data) {
    // The step indicator above stays the way out (Back, or another step).
    return (
      <div className="space-y-6">
        {heading}
        <RulesFormState status={rules.status} onRetry={rules.reload} />
      </div>
    );
  }

  const rulesetCode = String(rules.row?.['ruleset_code'] ?? '');
  // The RULESET's own answer, not a guess from its code.
  const hasAfterblow = Boolean(
    (rules.row?.['ruleset_grammar'] as { hasAfterblow?: boolean } | undefined)?.hasAfterblow,
  );
  const logoUrl =
    newLogo === undefined ? ((rules.row?.['logo_url'] as string | null) ?? null) : newLogo;

  async function uploadLogo(file: File) {
    const check = validateLogoFile(file);
    if (!check.ok) {
      toast.error(t(check.errorKey));
      return;
    }
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await apiRequest<{ url: string }>(
        apiUrl,
        `/api/v1/tournaments/${tournamentId}/logo`,
        { method: 'POST', body: fd },
      );
      if (!r.ok) {
        const message = failureMessage(r, t, t('organizer.events.logoUploadFailed'));
        if (message) toast.error(message);
        return;
      }
      setNewLogo(r.data.url);
      toast.success(t('organizer.events.logoUploadSuccess'));
    } finally {
      setUploadingLogo(false);
      if (logoInput.current) logoInput.current.value = '';
    }
  }

  async function removeLogo() {
    setUploadingLogo(true);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        body: { logoUrl: null },
      });
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.removeFailed'));
        if (message) toast.error(message);
        return;
      }
      setNewLogo(null);
    } finally {
      setUploadingLogo(false);
    }
  }

  async function saveAndAdvance() {
    // Recorded, not inferred: the step is sent with whatever changed, alone when nothing did.
    if ((await rules.save({ wizardStep: 3 })) !== 'saved') return;
    toast.success(t('organizer.tournaments.settings.saved'));
    window.history.replaceState(null, '', `${window.location.pathname}?id=${tournamentId}&step=4`);
    onNext();
  }

  return (
    <div className="space-y-6">
      {heading}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:gap-6">
        <div className="space-y-6">
          {/* Closed whole on an archived Event: a picked file is an upload at once. */}
          <fieldset disabled={readOnly} className="space-y-2">
            <legend className="text-xs font-medium text-foreground-secondary">
              {t('organizer.tournaments.settings.logoLabel')}
            </legend>
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 rounded-full overflow-hidden border border-border bg-background flex items-center justify-center shrink-0">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo from external API origin; next/image optimization not configured for this host
                  <img
                    src={logoUrl}
                    alt={t('organizer.tournaments.settings.logoPreviewAlt')}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-[10px] text-muted">—</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input
                    ref={logoInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadLogo(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => logoInput.current?.click()}
                    disabled={uploadingLogo}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
                  >
                    {uploadingLogo
                      ? t('organizer.tournaments.settings.logoUploading')
                      : logoUrl
                        ? t('organizer.tournaments.settings.logoReplace')
                        : t('organizer.tournaments.settings.logoUpload')}
                  </button>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => void removeLogo()}
                      disabled={uploadingLogo}
                      className="rounded-md px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                    >
                      {t('organizer.tournaments.settings.logoRemove')}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-muted">
                  {t('organizer.tournaments.settings.logoHelp')}
                </p>
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-foreground-secondary">
              {t('organizer.tournaments.settings.sideColors')}
            </legend>
            <div className="flex gap-3">
              {(['red', 'blue'] as const).map((side) => (
                <label key={side} className="flex-1">
                  <span className="block text-[11px] uppercase tracking-wide text-muted mb-1">
                    {side}
                  </span>
                  <select
                    value={data.sideColors[side]}
                    onChange={(e) =>
                      setData({
                        ...data,
                        sideColors: { ...data.sideColors, [side]: e.target.value },
                      })
                    }
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                  >
                    {COLORS.map((c) => (
                      <option key={c} value={c}>
                        {statusLabel('color', c, t)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-foreground-secondary">
              {t('organizer.tournaments.settings.cleanButtons')}
            </legend>
            {data.buttons.clean.length > 0 && (
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted">
                <span className="flex-1" aria-hidden />
                <span className="w-20">
                  {t('organizer.tournaments.settings.buttonValueHeader')}
                </span>
                {/* Invisible spacers mirror the trailing checkbox + Remove so the header sits over its field. */}
                <span aria-hidden className="invisible w-4" />
                <span aria-hidden className="invisible w-14" />
              </div>
            )}
            {data.buttons.clean.map((btn, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  aria-label={t('organizer.fieldNames.buttonName', { n: i + 1 })}
                  value={btn.label}
                  onChange={(e) =>
                    setData({
                      ...data,
                      buttons: {
                        ...data.buttons,
                        clean: data.buttons.clean.map((b, j) =>
                          j === i ? { ...b, label: e.target.value } : b,
                        ),
                      },
                    })
                  }
                  className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
                  placeholder={t('admin.orgTournaments.buttonLabelPlaceholder')}
                />
                <input
                  type="number"
                  value={btn.value}
                  onChange={(e) =>
                    setData({
                      ...data,
                      buttons: {
                        ...data.buttons,
                        clean: data.buttons.clean.map((b, j) =>
                          j === i ? { ...b, value: Number(e.target.value) } : b,
                        ),
                      },
                    })
                  }
                  className="w-20 rounded-md border border-border px-3 py-2 text-sm"
                />
                <input
                  type="checkbox"
                  checked={btn.visible}
                  onChange={(e) =>
                    setData({
                      ...data,
                      buttons: {
                        ...data.buttons,
                        clean: data.buttons.clean.map((b, j) =>
                          j === i ? { ...b, visible: e.target.checked } : b,
                        ),
                      },
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setData({
                      ...data,
                      buttons: {
                        ...data.buttons,
                        clean: data.buttons.clean.filter((_, j) => j !== i),
                      },
                    })
                  }
                  className="text-xs text-danger hover:underline"
                >
                  {t('admin.orgTournaments.remove')}
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setData({
                  ...data,
                  buttons: {
                    ...data.buttons,
                    clean: [...data.buttons.clean, { label: '', value: 1, visible: true }],
                  },
                })
              }
              className="text-xs text-foreground-secondary hover:underline"
            >
              {t('admin.orgTournaments.addCleanButton')}
            </button>
          </fieldset>

          {/* Driven by the ruleset, not by its name. The literal
              `rulesetCode === 'TF_v1'` hid these controls from every custom
              ruleset that HAS afterblow — leaving buttons on the referee's pad
              that nobody could edit — and showed them for rulesets that do
              not. */}
          {hasAfterblow && (
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-foreground-secondary">
                {t('organizer.tournaments.settings.afterblowButtons')}
              </legend>
              {data.buttons.afterblow.length > 0 && (
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted">
                  <span className="flex-1" aria-hidden />
                  <span className="w-16">
                    {t('organizer.tournaments.settings.afterblowAttackerHeader')}
                  </span>
                  <span className="w-16">
                    {t('organizer.tournaments.settings.afterblowDefenderHeader')}
                  </span>
                  {/* Invisible spacers mirror the trailing checkbox + Remove so the headers stay over their fields. */}
                  <span aria-hidden className="invisible w-4" />
                  <span aria-hidden className="invisible w-14" />
                </div>
              )}
              {data.buttons.afterblow.map((btn, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    aria-label={t('organizer.fieldNames.buttonName', { n: i + 1 })}
                    value={btn.label}
                    onChange={(e) =>
                      setData({
                        ...data,
                        buttons: {
                          ...data.buttons,
                          afterblow: data.buttons.afterblow.map((b, j) =>
                            j === i ? { ...b, label: e.target.value } : b,
                          ),
                        },
                      })
                    }
                    className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
                    placeholder={t('admin.orgTournaments.buttonLabelPlaceholder')}
                  />
                  <input
                    type="number"
                    value={btn.attackerPts}
                    onChange={(e) =>
                      setData({
                        ...data,
                        buttons: {
                          ...data.buttons,
                          afterblow: data.buttons.afterblow.map((b, j) =>
                            j === i ? { ...b, attackerPts: Number(e.target.value) } : b,
                          ),
                        },
                      })
                    }
                    className="w-16 rounded-md border border-border px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    value={btn.defenderPts}
                    onChange={(e) =>
                      setData({
                        ...data,
                        buttons: {
                          ...data.buttons,
                          afterblow: data.buttons.afterblow.map((b, j) =>
                            j === i ? { ...b, defenderPts: Number(e.target.value) } : b,
                          ),
                        },
                      })
                    }
                    className="w-16 rounded-md border border-border px-3 py-2 text-sm"
                  />
                  <input
                    type="checkbox"
                    checked={btn.visible}
                    onChange={(e) =>
                      setData({
                        ...data,
                        buttons: {
                          ...data.buttons,
                          afterblow: data.buttons.afterblow.map((b, j) =>
                            j === i ? { ...b, visible: e.target.checked } : b,
                          ),
                        },
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setData({
                        ...data,
                        buttons: {
                          ...data.buttons,
                          afterblow: data.buttons.afterblow.filter((_, j) => j !== i),
                        },
                      })
                    }
                    className="text-xs text-danger hover:underline"
                  >
                    {t('admin.orgTournaments.remove')}
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setData({
                    ...data,
                    buttons: {
                      ...data.buttons,
                      afterblow: [
                        ...data.buttons.afterblow,
                        { label: '', attackerPts: 1, defenderPts: 1, visible: true },
                      ],
                    },
                  })
                }
                className="text-xs text-foreground-secondary hover:underline"
              >
                {t('admin.orgTournaments.addAfterblowButton')}
              </button>
            </fieldset>
          )}
        </div>
        <DisplayPreview data={data} logoUrl={logoUrl} rulesetCode={rulesetCode} />
      </div>

      {rules.needsAudit && <RulesChangeElsewhere tournamentId={tournamentId} tab="display" />}
      <div className="flex justify-between mt-6">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background"
        >
          {t('actions.back')}
        </button>
        <button
          type="button"
          onClick={() => void saveAndAdvance()}
          disabled={saving || readOnly}
          title={readOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('actions.next')}
        </button>
      </div>
    </div>
  );
}
