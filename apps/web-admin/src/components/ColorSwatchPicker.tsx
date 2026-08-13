'use client';

/**
 * ColorSwatchPicker — a curated grid of hexes plus a free-form colour input.
 *
 * `defaultColor` is what makes the grid honest. A surface that renders
 * something when nothing has been picked (an org's event-card stripe, a
 * programme block's bar) passes that colour in, and the picker rings its
 * swatch. Without it the grid used to be seeded with a placeholder — the org
 * page rang slate while its own preview drew red — which is the one thing a
 * colour picker must never do. Omit the prop only when the surface genuinely
 * has no default.
 *
 * The palette is 16 hues x 3 shades, laid out 8 across so each column holds one
 * hue: rows 1-3 are the warm-to-teal half, rows 4-6 the cool-to-neutral half.
 * Every default in @myclash/types/branding appears here, or it could not be
 * ringed. These are raw hexes on purpose — they ARE the value being edited, not
 * decoration, so semantic tokens have nothing to say about them.
 */

import { useI18n } from '@myclash/next-i18n/client';

export const SWATCH_PALETTE: readonly string[] = [
  // red · orange · amber · yellow · lime · green · emerald · teal
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#dc2626',
  '#ea580c',
  '#d97706',
  '#ca8a04',
  '#65a30d',
  '#16a34a',
  '#059669',
  '#0d9488',
  '#991b1b',
  '#9a3412',
  '#92400e',
  '#854d0e',
  '#3f6212',
  '#166534',
  '#065f46',
  '#115e59',
  // cyan · sky · blue · indigo · violet · purple · pink · slate
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
  '#64748b',
  '#0891b2',
  '#0284c7',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#9333ea',
  '#db2777',
  '#475569',
  '#155e75',
  '#075985',
  '#1e40af',
  '#3730a3',
  '#5b21b6',
  '#6b21a8',
  '#9d174d',
  '#1e293b',
];

/**
 * Seeds the native colour input when there is neither a value nor a default.
 * `<input type="color">` has no empty state — left blank it reports #000000,
 * which would be a picked colour the operator never chose.
 */
const CUSTOM_INPUT_SEED = '#64748b';

function CustomColorInput({
  effective,
  onChange,
}: {
  effective: string;
  onChange: (hex: string) => void;
}) {
  const { t } = useI18n();
  const shown = effective || CUSTOM_INPUT_SEED;
  return (
    <label className="flex items-center gap-2 text-xs font-normal text-muted">
      <span>{t('admin.common.colorCustom')}</span>
      <input
        type="color"
        value={shown}
        onChange={(ev) => onChange(ev.target.value)}
        className="h-7 w-10 cursor-pointer rounded border border-border"
      />
      <span className="font-mono uppercase">{shown}</span>
    </label>
  );
}

export function ColorSwatchPicker({
  value,
  onChange,
  ariaLabel,
  defaultColor,
}: {
  value: string;
  onChange: (hex: string) => void;
  ariaLabel?: string;
  /**
   * What the surface beside this picker renders while `value` is empty. Rings
   * that swatch and seeds the custom input.
   */
  defaultColor?: string;
}) {
  const effective = (value || defaultColor || '').toLowerCase();
  return (
    <div className="grid gap-2">
      <div role="radiogroup" aria-label={ariaLabel ?? 'Color'} className="grid grid-cols-8 gap-1.5">
        {SWATCH_PALETTE.map((hex) => {
          const selected = hex.toLowerCase() === effective;
          return (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={hex}
              title={hex}
              onClick={() => onChange(hex)}
              style={{ backgroundColor: hex }}
              className={[
                'h-7 w-7 rounded border transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-accent',
                selected ? 'border-strong ring-2 ring-strong ring-offset-1' : 'border-border',
              ].join(' ')}
            />
          );
        })}
      </div>
      <CustomColorInput effective={effective} onChange={onChange} />
    </div>
  );
}
