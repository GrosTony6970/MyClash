'use client';

import { useEffect, useRef, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';
import { validateLogoFile } from '../../../../../../../../src/lib/validate-logo-file';
import {
  buildDisplayConfigFromRow,
  DISPLAY_DEFAULTS,
  type DisplayState,
} from './buildDisplayConfigFromRow';
import { DisplayPreview } from './DisplayPreview';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
const DEFAULTS: DisplayState = DISPLAY_DEFAULTS;

const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'black', 'white'];

export function Step3Display({
  tournamentId,
  onNext,
  onBack,
}: {
  tournamentId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<DisplayState>(DEFAULTS);
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  // The RULESET's own answer, not a guess from its code. `false` until the row
  // loads, so the fieldset appears rather than flickering away.
  const [hasAfterblow, setHasAfterblow] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const logoInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        setHasAfterblow(Boolean(row.ruleset_grammar?.hasAfterblow));
        setLogoUrl((row.logo_url as string | null) ?? null);
        // Pluck-not-spread, same as Step 2 / Step 4. The column is
        // `scoring_config_json` (the `_json` suffix matters — Step 3
        // previously read `row.scoring_config` and silently fell back
        // to defaults, hiding every saved button on reload).
        setData(
          buildDisplayConfigFromRow(
            (row.scoring_config_json ?? {}) as Record<string, unknown>,
            DEFAULTS,
          ),
        );
      });
  }, [tournamentId]);

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
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/logo`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.events.logoUploadFailed'));
      }
      const { url } = (await res.json()) as { url: string };
      setLogoUrl(url);
      toast.success(t('organizer.events.logoUploadSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('organizer.events.logoUploadFailed'));
    } finally {
      setUploadingLogo(false);
      if (logoInput.current) logoInput.current.value = '';
    }
  }

  async function removeLogo() {
    setUploadingLogo(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoUrl: null }),
      });
      if (!res.ok) throw new Error(t('admin.common.removeFailed'));
      setLogoUrl(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.common.somethingWentWrong'));
    } finally {
      setUploadingLogo(false);
    }
  }

  async function saveAndAdvance() {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Tournament identity color (`color`) is now set in
          // Step 1 Basics; this PATCH no longer overwrites it.
          scoringConfig: {
            display: { sideColors: data.sideColors },
            buttons: data.buttons,
          },
          wizardStep: 3,
        }),
      });
      if (!res.ok) throw new Error(t('admin.common.saveFailed'));
      toast.success(t('organizer.tournaments.settings.saved'));
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?id=${tournamentId}&step=4`,
      );
      onNext();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('admin.common.somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.tournaments.wizard.display')}
      </h2>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:gap-6">
        <div className="space-y-6">
          <fieldset className="space-y-2">
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
                        {c}
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
          disabled={saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('actions.next')}
        </button>
      </div>
    </div>
  );
}
