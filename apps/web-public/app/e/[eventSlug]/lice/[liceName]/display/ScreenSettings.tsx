'use client';

import { useI18n } from '@myclash/next-i18n/client';

interface Props {
  /** Blue is on the left of the scoreboard. */
  mirror: boolean;
  onToggleMirror: () => void;
}

/**
 * The settings of THIS screen, in the kiosk's hidden bar (`DisplayControls`):
 * what the person who sets a TV up changes while standing in front of it. A way
 * to another page is not a setting: it belongs on the hub
 * (`docs/design/display-kiosk.md`).
 */
export function ScreenSettings({ mirror, onToggleMirror }: Props) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onToggleMirror}
      aria-pressed={mirror}
      className={`min-h-[44px] rounded-md border px-3 py-2 text-sm font-semibold transition hover:border-accent hover:text-accent ${
        mirror
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border text-foreground-secondary'
      }`}
    >
      {t('scoring.scoreboard.swapSides')}
    </button>
  );
}
