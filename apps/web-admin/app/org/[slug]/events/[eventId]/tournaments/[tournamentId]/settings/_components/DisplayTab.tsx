'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '@myclash/ui';
import { TOURNAMENT_SIDE_COLORS } from '@myclash/types';
import { validateLogoFile } from '../../../../../../../../../src/lib/validate-logo-file';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

interface CleanButton {
  label: string;
  value: number;
  visible: boolean;
}
interface AfterblowButton {
  label: string;
  attackerPts: number;
  defenderPts: number;
  visible: boolean;
}
interface PenaltyEntry {
  id: string;
  ref_number: number;
  short_name: string;
  group_number: number;
  sanctions: string[];
}
interface DisplayState {
  sideColors: { red: string; blue: string };
  buttons: { clean: CleanButton[]; afterblow: AfterblowButton[] };
  /** Ruleset-entry ref_numbers pinned as scoreboard quick-pick chips. */
  quickPenalties: number[];
}

const DEFAULTS: DisplayState = {
  sideColors: { red: 'red', blue: 'blue' },
  buttons: {
    clean: [{ label: 'Point', value: 1, visible: true }],
    afterblow: [{ label: 'Afterblow', attackerPts: 1, defenderPts: 1, visible: true }],
  },
  quickPenalties: [],
};

// Derived, not retyped — see Step3Display: the old literal list reached only 8
// of the 11 tokens the API accepts.
const COLORS = TOURNAMENT_SIDE_COLORS;

export function DisplayTab({ tournamentId }: { tournamentId: string }) {
  const { t } = useI18n();

  const toast = useToast();
  const [data, setData] = useState<DisplayState>(DEFAULTS);
  const [penaltyEntries, setPenaltyEntries] = useState<PenaltyEntry[]>([]);
  // The ruleset's own answer — see the fieldset comment below.
  const [hasAfterblow, setHasAfterblow] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const logoInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Silent reads: the tab shows its defaults until the row lands, and every
    // save below reports its own refusal.
    void apiRequest<Record<string, unknown>>(apiUrl, `/api/v1/tournaments/${tournamentId}`).then(
      (r) => {
        if (r.ok) {
          const row = r.data;
          setHasAfterblow(
            Boolean(
              (row['ruleset_grammar'] as { hasAfterblow?: boolean } | undefined)?.hasAfterblow,
            ),
          );
          setLogoUrl((row['logo_url'] as string | null) ?? null);
          // The column is `scoring_config_json` (the `_json` suffix
          // matters — DisplayTab previously read `row.scoring_config`
          // and silently fell back to defaults, mirroring the Step 3
          // wizard bug).
          const sc = (row['scoring_config_json'] ?? {}) as {
            display?: { sideColors?: { red: string; blue: string }; quickPenalties?: number[] };
            buttons?: { clean?: CleanButton[]; afterblow?: AfterblowButton[] };
          };
          setData({
            sideColors: sc.display?.sideColors ?? DEFAULTS.sideColors,
            buttons: {
              clean: sc.buttons?.clean ?? DEFAULTS.buttons.clean,
              afterblow: sc.buttons?.afterblow ?? DEFAULTS.buttons.afterblow,
            },
            quickPenalties: sc.display?.quickPenalties ?? [],
          });
        }
      },
    );

    // Effective penalty ruleset entries → the quick-pick pin picker below.
    void apiRequest<{ penalty_ruleset_entries?: PenaltyEntry[] }>(
      apiUrl,
      `/api/v1/tournaments/${tournamentId}/penalty-ruleset`,
    ).then((r) => {
      const entries = [...(r.ok ? (r.data.penalty_ruleset_entries ?? []) : [])];
      entries.sort((a, b) => a.group_number - b.group_number || a.ref_number - b.ref_number);
      setPenaltyEntries(entries);
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
      setLogoUrl(r.data.url);
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
      setLogoUrl(null);
    } finally {
      setUploadingLogo(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        body: {
          scoringConfig: {
            display: { sideColors: data.sideColors, quickPenalties: data.quickPenalties },
            buttons: data.buttons,
          },
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

  function toggleQuick(ref: number) {
    setData((d) => ({
      ...d,
      quickPenalties: d.quickPenalties.includes(ref)
        ? d.quickPenalties.filter((r) => r !== ref)
        : [...d.quickPenalties, ref],
    }));
  }

  return (
    <div className="space-y-6">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.tournaments.settings.display')}
      </h2>

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
            <p className="text-[11px] text-muted">{t('organizer.tournaments.settings.logoHelp')}</p>
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
                {side === 'red'
                  ? t('organizer.tournaments.settings.sideFighter1')
                  : t('organizer.tournaments.settings.sideFighter2')}
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
            {/* name column is labelled by the legend */}
            <span className="w-20">{t('organizer.tournaments.settings.buttonValueHeader')}</span>
            {/* Invisible spacers mirror the trailing checkbox + Remove so "Value" sits over its field. */}
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
                  buttons: { ...data.buttons, clean: data.buttons.clean.filter((_, j) => j !== i) },
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

      {/* Driven by the ruleset, not by its name — see Step3Display. */}
      {hasAfterblow && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-foreground-secondary">
            {t('organizer.tournaments.settings.afterblowButtons')}
          </legend>
          {data.buttons.afterblow.length > 0 && (
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted">
              <span className="flex-1" aria-hidden />
              {/* name column is labelled by the legend */}
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

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-foreground-secondary">
          {t('organizer.tournaments.settings.quickPenalties')}
        </legend>
        <p className="text-[11px] text-muted">
          {t('organizer.tournaments.settings.quickPenaltiesHelp')}
        </p>
        {penaltyEntries.length === 0 ? (
          <p className="text-[11px] text-muted">
            {t('organizer.tournaments.settings.quickPenaltiesEmpty')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {penaltyEntries.map((e) => (
              <label
                key={e.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-background"
              >
                <input
                  type="checkbox"
                  checked={data.quickPenalties.includes(e.ref_number)}
                  onChange={() => toggleQuick(e.ref_number)}
                />
                <span className="font-mono text-xs text-muted">{e.ref_number}</span>
                <span className="flex-1 truncate">{e.short_name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
    </div>
  );
}
