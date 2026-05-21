'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { TournamentColorDot, useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

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
interface DisplayState {
  sideColors: { red: string; blue: string };
  buttons: { clean: CleanButton[]; afterblow: AfterblowButton[] };
}

const DEFAULTS: DisplayState = {
  sideColors: { red: 'red', blue: 'blue' },
  buttons: {
    clean: [{ label: 'Point', value: 1, visible: true }],
    afterblow: [{ label: 'Afterblow', attackerPts: 1, defenderPts: 1, visible: true }],
  },
};

const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'black', 'white'];

/** Full ColorToken palette from @myclash/ui — used for the tournament
 *  identity color (separate from sideColors). */
const TOURNAMENT_COLORS = [
  'red',
  'blue',
  'green',
  'amber',
  'violet',
  'teal',
  'orange',
  'purple',
  'yellow',
  'gold',
  'silver',
  'bronze',
  'slate',
  'black',
  'white',
];

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
  const [tournamentColor, setTournamentColor] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        setTournamentColor((row.color as string | null) ?? '');
        const sc = (row.scoring_config ?? {}) as {
          display?: { sideColors?: { red: string; blue: string } };
          buttons?: { clean?: CleanButton[]; afterblow?: AfterblowButton[] };
        };
        setData({
          sideColors: sc.display?.sideColors ?? DEFAULTS.sideColors,
          buttons: {
            clean: sc.buttons?.clean ?? DEFAULTS.buttons.clean,
            afterblow: sc.buttons?.afterblow ?? DEFAULTS.buttons.afterblow,
          },
        });
      });
  }, [tournamentId]);

  async function saveAndAdvance() {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scoringConfig: {
            display: { sideColors: data.sideColors },
            buttons: data.buttons,
          },
          color: tournamentColor || null,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(t('organizer.tournaments.settings.saved'));
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?id=${tournamentId}&step=4`,
      );
      onNext();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="font-display text-xl text-slate-900">
        {t('organizer.tournaments.wizard.display')}
      </h2>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-slate-600">
          {t('organizer.tournaments.settings.sideColors')}
        </legend>
        <div className="flex gap-3">
          {(['red', 'blue'] as const).map((side) => (
            <label key={side} className="flex-1">
              <span className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">
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
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
        <legend className="text-xs font-medium text-slate-600">
          {t('organizer.tournaments.settings.colorLabel')}
        </legend>
        <div className="flex items-center gap-2">
          <TournamentColorDot color={tournamentColor || null} size="md" />
          <select
            value={tournamentColor}
            onChange={(e) => setTournamentColor(e.target.value)}
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

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-slate-600">
          {t('organizer.tournaments.settings.cleanButtons')}
        </legend>
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
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Label"
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
              className="w-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
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
              className="text-xs text-red-700 hover:underline"
            >
              Remove
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
          className="text-xs text-slate-700 hover:underline"
        >
          + Add clean button
        </button>
      </fieldset>

      {rulesetCode === 'TF_v1' && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-slate-600">
            {t('organizer.tournaments.settings.afterblowButtons')}
          </legend>
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
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Label"
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
                className="w-16 rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                className="w-16 rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                className="text-xs text-red-700 hover:underline"
              >
                Remove
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
            className="text-xs text-slate-700 hover:underline"
          >
            + Add afterblow button
          </button>
        </fieldset>
      )}

      <div className="flex justify-between mt-6">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t('actions.back')}
        </button>
        <button
          type="button"
          onClick={() => void saveAndAdvance()}
          disabled={saving}
          className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('actions.next')}
        </button>
      </div>
    </div>
  );
}
