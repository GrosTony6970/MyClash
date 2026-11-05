'use client';

import type { PhotoMode } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * Strictest to loosest. In a radio group an arrow key selects as it moves, and each selection is
 * saved: from Off, one step must reach Approve first, never Live, or a photo arriving in that
 * moment is stored approved for good.
 */
export const MODE_ORDER = ['off', 'approve', 'live'] as const satisfies readonly PhotoMode[];

const LABEL_KEYS = {
  off: 'organizer.photos.mode.off',
  live: 'organizer.photos.mode.live',
  approve: 'organizer.photos.mode.approve',
} as const satisfies Record<PhotoMode, string>;

const HINT_KEYS = {
  off: 'organizer.photos.mode.offHint',
  live: 'organizer.photos.mode.liveHint',
  approve: 'organizer.photos.mode.approveHint',
} as const satisfies Record<PhotoMode, string>;

/**
 * Off / Approve first / Live. A radio group, not tabs: it is a setting, and a closed `fieldset`
 * locks it on an archived Event. It shows the stored mode; a refused change leaves it there.
 * While a save runs, a change is ignored rather than the inputs closed: closing them would throw
 * the keyboard focus to the page.
 */
export function PhotoModePanel({
  mode,
  readOnly,
  busy,
  onChange,
}: {
  mode: PhotoMode;
  readOnly: boolean;
  busy: boolean;
  onChange: (mode: PhotoMode) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset disabled={readOnly} className="rounded-md border border-border bg-surface p-4">
      <legend className="px-1 text-sm font-bold text-foreground">
        {t('organizer.photos.mode.legend')}
      </legend>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {MODE_ORDER.map((value) => (
          <label key={value} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name="photo-mode"
              value={value}
              checked={mode === value}
              onChange={() => {
                if (!busy) onChange(value);
              }}
              className="mt-1"
            />
            <span>
              <span className="font-semibold text-foreground">{t(LABEL_KEYS[value])}</span>
              <span className="block text-xs text-muted">{t(HINT_KEYS[value])}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
