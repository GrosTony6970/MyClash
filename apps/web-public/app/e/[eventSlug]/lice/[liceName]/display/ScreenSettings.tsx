'use client';

import { useFullscreen } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

interface Props {
  /** Blue is on the left of the scoreboard. */
  mirror: boolean;
  onToggleMirror: () => void;
}

/** One look for a setting that is on and one for a setting that is off. */
const settingClass = (on: boolean) =>
  `min-h-[44px] rounded-md border px-3 py-2 text-sm font-semibold transition hover:border-accent hover:text-accent ${
    on ? 'border-accent bg-accent/10 text-accent' : 'border-border text-foreground-secondary'
  }`;

/**
 * The settings of THIS screen, in the kiosk's hidden bar (`DisplayControls`):
 * what the person who sets a TV up changes while standing in front of it. A way
 * to another page is not a setting: it belongs on the hub
 * (`docs/design/display-kiosk.md`).
 */
export function ScreenSettings({ mirror, onToggleMirror }: Props) {
  const { t } = useI18n();
  const fullscreen = useFullscreen();
  return (
    <>
      <button
        type="button"
        onClick={onToggleMirror}
        aria-pressed={mirror}
        className={settingClass(mirror)}
      >
        {t('scoring.scoreboard.swapSides')}
      </button>
      {fullscreen.supported && (
        // Its words say where the screen stands, so it has no `aria-pressed`:
        // "Exit fullscreen, pressed" says two things at once.
        <button
          type="button"
          onClick={fullscreen.toggle}
          className={settingClass(fullscreen.active)}
        >
          {t(
            fullscreen.active
              ? 'scoring.scoreboard.exitFullscreen'
              : 'scoring.scoreboard.fullscreen',
          )}
        </button>
      )}
    </>
  );
}
