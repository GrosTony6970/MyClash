'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { EntrantKind } from './entrant-kind';

const KINDS: readonly EntrantKind[] = ['individual', 'team'];
const LABEL_KEYS: Record<EntrantKind, string> = {
  individual: 'organizer.tournaments.kind.individual',
  team: 'organizer.tournaments.kind.team',
};

interface EntrantKindFieldProps {
  kind: EntrantKind;
  onKind: (kind: EntrantKind) => void;
  /** The size field's text: blank is no default size. */
  teamDefaultSize: string;
  onTeamDefaultSize: (text: string) => void;
  /** The Tournament holds an entrant: its kind can no longer change. */
  fixed: boolean;
  /** The page's saves are closed (an archived Event, or a reader below admin). */
  disabled?: boolean;
}

/**
 * The first choice of a Tournament: individual Fighters or teams, and a team Tournament's default
 * team size. Shared by the creator's Step 1 and the settings Basics tab. Once the Tournament holds
 * an entrant the database refuses a change of kind, so the choice is closed here with the reason,
 * and its value is not sent; the size stays open, and its value is still sent.
 */
export function EntrantKindField(props: EntrantKindFieldProps) {
  const { kind, onKind, teamDefaultSize, onTeamDefaultSize, fixed, disabled = false } = props;
  const { t } = useI18n();
  return (
    <fieldset className="space-y-2" data-testid="entrant-kind">
      <legend className="text-xs font-medium text-foreground-secondary">
        {t('organizer.tournaments.kind.legend')}
      </legend>
      <div className="flex flex-wrap gap-4">
        {KINDS.map((option) => (
          <label key={option} className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="radio"
              name="entrant-kind"
              value={option}
              checked={kind === option}
              onChange={() => onKind(option)}
              disabled={fixed || disabled}
            />
            {t(LABEL_KEYS[option])}
          </label>
        ))}
      </div>
      {fixed && <p className="text-xs text-muted">{t('organizer.tournaments.kind.fixed')}</p>}
      {kind === 'team' && (
        <>
          <label className="block">
            <span className="block text-xs font-medium text-foreground-secondary mb-1">
              {t('organizer.tournaments.kind.teamDefaultSize')}
            </span>
            <input
              type="number"
              min={1}
              max={10}
              value={teamDefaultSize}
              onChange={(e) => onTeamDefaultSize(e.target.value)}
              disabled={disabled}
              data-testid="team-default-size"
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-muted">{t('organizer.tournaments.kind.forfeitNotForTeams')}</p>
        </>
      )}
    </fieldset>
  );
}
