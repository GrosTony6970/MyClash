'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { FormField, TournamentColorDot, statusLabel } from '@myclash/ui';
import { TOURNAMENT_COLORS } from '../../tournaments/_lib/tournament-colors';
import type { TeamForm } from '../team-form';

/** The seat list's heading: the FormField eyebrow, for a list that is not a field. */
const EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-muted';

/**
 * The team dialog's fields, on `FormField` (the light admin field, known-deviations D6): name,
 * size, seed and colour (the Tournament palette).
 */
export function TeamFields({
  form,
  onChange,
}: {
  form: TeamForm;
  onChange: (form: TeamForm) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <FormField
        label={t('organizer.teams.name')}
        data-testid="team-name"
        value={form.name}
        onChange={(e) => onChange({ ...form, name: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label={t('organizer.teams.size')}
          hint={t('organizer.teams.sizeHint')}
          type="number"
          min={1}
          max={10}
          data-testid="team-size"
          value={form.size}
          onChange={(e) => onChange({ ...form, size: e.target.value })}
        />
        <FormField
          label={t('organizer.teams.seed')}
          hint={t('organizer.teams.seedHint')}
          type="number"
          min={1}
          data-testid="team-seed"
          value={form.seed}
          onChange={(e) => onChange({ ...form, seed: e.target.value })}
        />
      </div>
      <ColorField value={form.color} onChange={(color) => onChange({ ...form, color })} />
    </div>
  );
}

function ColorField({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const { t } = useI18n();
  return (
    <FormField label={t('organizer.teams.color')}>
      <span className="flex items-center gap-2">
        <TournamentColorDot color={value || null} size="md" />
        <select
          aria-label={t('organizer.teams.color')}
          data-testid="team-color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="">{t('organizer.teams.colorNone')}</option>
          {TOURNAMENT_COLORS.map((c) => (
            <option key={c} value={c}>
              {statusLabel('color', c, t)}
            </option>
          ))}
        </select>
      </span>
    </FormField>
  );
}

/**
 * The team's seats, numbered by its size and empty: in slice 1b a team names no members (ruling
 * 973). Read-only.
 */
export function SeatList({ size }: { size: string }) {
  const { t } = useI18n();
  const count = Number(size);
  const seats = Number.isInteger(count) && count >= 1 && count <= 10 ? count : 0;
  return (
    <div className="space-y-1">
      <p className={EYEBROW}>{t('organizer.teams.seats')}</p>
      <ol className="flex flex-wrap gap-2" data-testid="team-seats">
        {Array.from({ length: seats }, (_, i) => (
          <li
            key={i}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground-secondary"
          >
            {t('organizer.teams.seat', { n: i + 1 })}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted">{t('organizer.teams.seatsHelp')}</p>
    </div>
  );
}
